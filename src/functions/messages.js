const { app } = require('@azure/functions');
const {
    ActivityHandler,
    CloudAdapter,
    ConfigurationBotFrameworkAuthentication,
    TurnContext
} = require('botbuilder');

// ============================================================================
// BOT FRAMEWORK AUTHENTICATION & ADAPTER CONFIGURATION
// ============================================================================

/**
 * Configure Bot Framework authentication using environment variables.
 * In local testing, if MicrosoftAppId is not set, CloudAdapter allows anonymous local/emulator calls.
 * In production, when MicrosoftAppId is set, CloudAdapter strictly validates incoming Bot Framework JWT tokens.
 */
const appId = process.env.BOT_ID || process.env.MicrosoftAppId || '';
const botConfig = {
    ...process.env,
    MicrosoftAppId: appId,
    MicrosoftAppPassword: process.env.BOT_PASSWORD || process.env.MicrosoftAppPassword || '',
    MicrosoftAppType: appId ? (process.env.BOT_APP_TYPE || 'SingleTenant') : 'MultiTenant',
    MicrosoftAppTenantId: process.env.BOT_TENANT_ID || process.env.MicrosoftAppTenantId || ''
};

const botAuthentication = new ConfigurationBotFrameworkAuthentication(botConfig);
const adapter = new CloudAdapter(botAuthentication);

// Global adapter turn error handler
adapter.onTurnError = async (context, error) => {
    console.error('[finchat-teams] Bot turn error:', error.message);
    try {
        if (context.activity && context.activity.serviceUrl) {
            await context.sendActivity(
                'Sorry, Finora AI encountered an unexpected error processing your request. Please try again.'
            );
        }
    } catch (sendErr) {
        console.error('[finchat-teams] Failed to send turn error message:', sendErr.message);
    }
};

// ============================================================================
// CHAT ENDPOINT RESOLUTION (LOCAL vs AZURE)
// ============================================================================

function getFinoraChatUrl() {
    // 1. Explicit environment variable override
    let url = process.env.FINORA_CHAT_URL;

    // 2. Running in Azure Function App environment
    if (!url && process.env.WEBSITE_HOSTNAME) {
        url = `https://${process.env.WEBSITE_HOSTNAME}/api/chat`;
    }

    // 3. Local environment fallback (Azure Functions Core Tools standard port 7071)
    if (!url) {
        const port = process.env.FUNCTIONS_CUSTOMHANDLER_PORT || process.env.PORT || 7071;
        url = `http://localhost:${port}/api/chat`;
    }

    // Ensure endpoint ends with /api/chat if only base host URL was provided
    if (!url.endsWith('/api/chat') && !url.includes('/api/')) {
        url = url.replace(/\/+$/, '') + '/api/chat';
    }

    return url;
}

// ============================================================================
// HELPER: CLEAN TEAMS MESSAGE TEXT
// ============================================================================

function cleanTeamsText(rawText) {
    if (!rawText) return '';
    // Strip simple HTML tags that Teams desktop/web clients frequently wrap around messages
    return rawText
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

// ============================================================================
// HELPER: EXTRACT VERIFIED ENTRA IDENTITY FROM BOT ACTIVITY
// ============================================================================

function extractUserIdentity(context) {
    const activity = context.activity || {};
    const from = activity.from || {};
    const conversation = activity.conversation || {};
    const channelData = activity.channelData || {};

    const aadObjectId = from.aadObjectId || from.id || '';
    const userName = from.name || '';
    const userEmail = from.email || from.userPrincipalName || from.upn || (channelData.user && channelData.user.email) || '';
    const tenantId = conversation.tenantId || (channelData.tenant && channelData.tenant.id) || process.env.TENANT_ID || '';

    // Extract user groups/roles if available in channel data
    let userGroups = activity.userGroups || (channelData.user && channelData.user.groups) || '';
    if (Array.isArray(userGroups)) {
        userGroups = userGroups.join(',');
    }

    return {
        aadObjectId,
        userName,
        userEmail,
        tenantId,
        userGroups
    };
}

// ============================================================================
// FINORA AI TEAMS ACTIVITY HANDLER (LIGHTWEIGHT COMMUNICATION BRIDGE)
// ============================================================================

class FinchatTeamsBot extends ActivityHandler {
    constructor() {
        super();

        // Handle user message activities
        this.onMessage(async (context, next) => {
            const correlationId = `teams-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

            try {
                // Support standard Bot activity text, or raw text/question in local test calls
                let question = context.activity.text || context.activity.question || '';

                // Remove bot @mention token in Teams channel/group conversations
                if (context.activity.entities && context.activity.recipient) {
                    question = TurnContext.removeRecipientMention(context.activity) || question;
                }
                question = cleanTeamsText(question);

                // Handle empty or whitespace-only messages
                if (!question) {
                    const greetingMsg = 'Hello! I am Finora AI. Please ask me a question about company financials or HR policies.';
                    if (context.activity.serviceUrl) {
                        await context.sendActivity(greetingMsg);
                    }
                    if (context.turnState && context.turnState.get('httpResponse')) {
                        context.turnState.get('httpResponse').send({
                            status: 'success',
                            answer: greetingMsg,
                            correlationId
                        });
                    }
                    await next();
                    return;
                }

                const identity = extractUserIdentity(context);
                const chatUrl = getFinoraChatUrl();
                const timeoutMs = Number(process.env.FINORA_CHAT_TIMEOUT_MS) || 60000;

                console.log(`[finchat-teams] [${correlationId}] Forwarding message to backend: ${chatUrl} (User: "${identity.userName || identity.userEmail || identity.aadObjectId || 'Unknown'}", Tenant: "${identity.tenantId || 'N/A'}")`);

                // Build request headers forwarding verified Microsoft Entra identity
                const requestHeaders = {
                    'Content-Type': 'application/json',
                    'x-correlation-id': correlationId,
                    'x-user-id': identity.aadObjectId,
                    'x-user-name': identity.userName,
                    'x-user-email': identity.userEmail,
                    'x-user-tenant-id': identity.tenantId
                };
                if (identity.userGroups) {
                    requestHeaders['x-user-groups'] = identity.userGroups;
                }

                // Build payload matching backend /api/chat contract
                const requestBody = {
                    question,
                    userId: identity.aadObjectId || null,
                    userName: identity.userName || null,
                    userEmail: identity.userEmail || null,
                    tenantId: identity.tenantId || null,
                    userGroups: identity.userGroups || null,
                    correlationId
                };

                // Forward question to existing /api/chat endpoint strictly as a communication bridge
                const response = await fetch(chatUrl, {
                    method: 'POST',
                    headers: requestHeaders,
                    body: JSON.stringify(requestBody),
                    signal: AbortSignal.timeout(timeoutMs)
                });

                // Handle specific HTTP status codes from backend
                if (response.status === 403) {
                    const errorJson = await response.json().catch(() => null);
                    const deniedAnswer = (errorJson && errorJson.answer) || 'Access denied: You do not have the required permissions to access this information.';
                    console.warn(`[finchat-teams] [${correlationId}] Backend access denied (HTTP 403): ${deniedAnswer}`);

                    if (context.activity.serviceUrl) {
                        await context.sendActivity(deniedAnswer);
                    }
                    const httpResponse = context.turnState && context.turnState.get('httpResponse');
                    if (httpResponse) {
                        httpResponse.status(403).send({
                            status: 'FORBIDDEN',
                            answer: deniedAnswer,
                            correlationId
                        });
                    }
                    await next();
                    return;
                }

                if (response.status === 409) {
                    const infoJson = await response.json().catch(() => null);
                    const procAnswer = (infoJson && infoJson.answer) || 'The requested document is currently being processed. Please try again shortly.';
                    console.log(`[finchat-teams] [${correlationId}] Backend document processing (HTTP 409): ${procAnswer}`);

                    if (context.activity.serviceUrl) {
                        await context.sendActivity(procAnswer);
                    }
                    const httpResponse = context.turnState && context.turnState.get('httpResponse');
                    if (httpResponse) {
                        httpResponse.status(409).send({
                            status: 'PROCESSING',
                            answer: procAnswer,
                            correlationId
                        });
                    }
                    await next();
                    return;
                }

                if (!response.ok) {
                    const errorText = await response.text().catch(() => '');
                    console.error(`[finchat-teams] [${correlationId}] Backend returned HTTP ${response.status}: ${response.statusText}. Response body: ${errorText.slice(0, 500)}`);
                    throw new Error(`Finora chat endpoint returned HTTP ${response.status}: ${response.statusText}`);
                }

                const result = await response.json();

                if (!result || typeof result.answer !== 'string' || !result.answer.trim()) {
                    console.error(`[finchat-teams] [${correlationId}] Invalid backend response format:`, JSON.stringify(result).slice(0, 500));
                    throw new Error('No valid answer returned from Finora backend.');
                }

                // Preserve answer verbatim without regenerating, summarizing, or modifying financial content
                let finalAnswer = result.answer;

                // Preserve source references returned by the backend if not already cited in answer text
                if (Array.isArray(result.sources) && result.sources.length > 0) {
                    const alreadyCited = result.sources.some(s => typeof s === 'string' && finalAnswer.includes(s));
                    if (!alreadyCited && !finalAnswer.includes('Sources:') && !finalAnswer.includes('**Sources:**')) {
                        finalAnswer += `\n\n**Sources:** ${result.sources.join(', ')}`;
                    }
                }

                // Deliver answer through Bot Framework connector in Teams
                if (context.activity.serviceUrl) {
                    await context.sendActivity({
                        type: 'message',
                        text: finalAnswer
                    });
                    console.log(`[finchat-teams] [${correlationId}] Answer delivered successfully via Bot Framework connector.`);
                }

                // Also attach response to turnState so local tests / direct HTTP calls get the answer directly
                const httpResponse = context.turnState && context.turnState.get('httpResponse');
                if (httpResponse) {
                    httpResponse.send({
                        status: result.status || 'success',
                        answer: finalAnswer,
                        sources: result.sources || [],
                        grounded: result.grounded,
                        document_name: result.document_name,
                        page: result.page,
                        hasUnresolvedConflict: result.hasUnresolvedConflict,
                        insufficientEvidence: result.insufficientEvidence,
                        correlationId
                    });
                }

            } catch (error) {
                console.error(`[finchat-teams] [${correlationId}] Processing error:`, error.message);
                if (error.name === 'TimeoutError' || error.name === 'AbortError') {
                    console.error(`[finchat-teams] [${correlationId}] Backend call timed out waiting for /api/chat response.`);
                }
                if (error.stack) {
                    console.error(`[finchat-teams] [${correlationId}] Stack:`, error.stack);
                }

                const fallbackMsg = 'Unable to process your question right now. Please try again later.';
                try {
                    if (context.activity.serviceUrl) {
                        await context.sendActivity(fallbackMsg);
                    }
                } catch (sendErr) {
                    console.error(`[finchat-teams] [${correlationId}] Failed to send fallback message:`, sendErr.message);
                }

                const httpResponse = context.turnState && context.turnState.get('httpResponse');
                if (httpResponse) {
                    httpResponse.status(500).send({
                        status: 'ERROR',
                        answer: fallbackMsg,
                        correlationId,
                        error: error.message
                    });
                }
            }

            await next();
        });

        // Handle member added events (welcome message when bot is added to Teams)
        this.onMembersAdded(async (context, next) => {
            const membersAdded = context.activity.membersAdded || [];
            const botId = context.activity.recipient ? context.activity.recipient.id : null;

            for (const member of membersAdded) {
                if (member.id !== botId) {
                    const welcomeMsg = 'Hello! I am Finora AI, your financial and HR intelligence assistant. Ask me questions about company performance, financial reports, or HR policies.';
                    if (context.activity.serviceUrl) {
                        await context.sendActivity(welcomeMsg);
                    }
                }
            }

            await next();
        });
    }
}

const finchatBot = new FinchatTeamsBot();

// ============================================================
// MINIMAL WEB RESPONSE ADAPTER FOR AZURE FUNCTIONS V4
// ============================================================

/**
 * Lightweight HTTP response adapter compatible with Bot Framework CloudAdapter.
 * Bridges Bot Framework's Express-style response calls (status, header, send, end)
 * into an Azure Functions v4 HttpResponseInit object.
 */
class BotHttpResponse {
    constructor() {
        this.statusCode = 200;
        this.headers = {};
        this.body = undefined;
    }

    status(code) {
        this.statusCode = code;
        return this;
    }

    header(name, value) {
        this.headers[name] = value;
        return this;
    }

    send(data) {
        if (typeof data === 'object' && data !== null) {
            this.body = JSON.stringify(data);
            if (!this.headers['Content-Type']) {
                this.headers['Content-Type'] = 'application/json';
            }
        } else {
            this.body = data !== undefined ? String(data) : '';
        }
        return this;
    }

    end() {
        return this;
    }
}

// ============================================================
// AZURE FUNCTION V4 HTTP TRIGGER: POST /api/messages
// ============================================================

app.http('messages', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'messages',
    handler: async (request, context) => {
        context.log('[finchat-teams] Incoming request on /api/messages.');

        try {
            // Parse incoming payload
            const body = await request.json().catch(() => null);

            if (!body || typeof body !== 'object') {
                context.warn('[finchat-teams] Rejected request: Missing or invalid JSON body.');
                return {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        status: 'ERROR',
                        bot: 'finchat-teams',
                        message: 'Invalid or missing activity payload. Expected JSON body.'
                    })
                };
            }

            // Normalise into Bot Framework Activity format if sent as a direct question
            const activity = { ...body };
            if (!activity.type) {
                activity.type = 'message';
            }
            if (!activity.text && activity.question) {
                activity.text = activity.question;
            }
            if (!activity.conversation) {
                activity.conversation = { id: 'local-test-conversation' };
            }
            if (!activity.channelId) {
                activity.channelId = 'emulator';
            }
            if (!activity.from) {
                activity.from = { id: 'local-user', name: 'Local User' };
            }
            if (!activity.recipient) {
                activity.recipient = { id: 'finchat-teams', name: 'Finora AI' };
            }

            // Construct Express-compatible WebRequest object for CloudAdapter
            const headers = {};
            for (const [key, value] of request.headers.entries()) {
                headers[key.toLowerCase()] = value;
            }

            const botRequest = {
                method: request.method,
                headers,
                body: activity
            };

            const botResponse = new BotHttpResponse();

            // Process activity through CloudAdapter (validates JWT, executes bot turn)
            await adapter.process(botRequest, botResponse, async (turnContext) => {
                turnContext.turnState.set('httpResponse', botResponse);
                await finchatBot.run(turnContext);
            });

            return {
                status: botResponse.statusCode || 200,
                headers: {
                    'Content-Type': 'application/json',
                    ...(botResponse.headers || {})
                },
                body: botResponse.body === undefined
                    ? undefined
                    : typeof botResponse.body === 'string'
                        ? botResponse.body
                        : JSON.stringify(botResponse.body)
            };

        } catch (err) {
            context.error('[finchat-teams] Fatal request processing error:', err.message);
            if (err.stack) {
                context.error('[finchat-teams] Fatal stack:', err.stack);
            }

            return {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    status: 'ERROR',
                    bot: 'finchat-teams',
                    message: 'Internal server error processing bot activity.',
                    error: err.message
                })
            };
        }
    }
});
