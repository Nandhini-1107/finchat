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
const botConfig = {
    ...process.env,
    MicrosoftAppId: process.env.BOT_ID || '',
    MicrosoftAppPassword: process.env.BOT_PASSWORD || '',
    MicrosoftAppType: process.env.BOT_APP_TYPE || 'SingleTenant',
    MicrosoftAppTenantId: process.env.BOT_TENANT_ID || ''
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
    if (process.env.FINORA_CHAT_URL) {
        return process.env.FINORA_CHAT_URL;
    }
    // 2. Running in Azure Function App environment
    if (process.env.WEBSITE_HOSTNAME) {
        return `https://${process.env.WEBSITE_HOSTNAME}/api/chat`;
    }
    // 3. Local environment fallback (Azure Functions Core Tools standard port 7071)
    const port = process.env.FUNCTIONS_CUSTOMHANDLER_PORT || process.env.PORT || 7071;
    return `http://localhost:${port}/api/chat`;
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
// FINORA AI TEAMS ACTIVITY HANDLER
// ============================================================================

class FinchatTeamsBot extends ActivityHandler {
    constructor() {
        super();

        // Handle user message activities
        this.onMessage(async (context, next) => {
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
                            answer: greetingMsg
                        });
                    }
                    await next();
                    return;
                }

                console.log(`[finchat-teams] Question received: "${question}"`);

                const chatUrl = getFinoraChatUrl();
                console.log(`[finchat-teams] Forwarding question to Finora chat endpoint: ${chatUrl}`);

                // Forward question to existing /api/chat endpoint using the exact request contract: { "question": "..." }
                const response = await fetch(chatUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ question }),
                    signal: AbortSignal.timeout(60000)
                });

                if (!response.ok) {
                    throw new Error(`Finora chat endpoint returned HTTP ${response.status}: ${response.statusText}`);
                }

                const result = await response.json();

                if (!result || typeof result.answer !== 'string' || !result.answer.trim()) {
                    throw new Error('No answer returned from Finora backend.');
                }

                // If running in Teams (serviceUrl present), deliver answer through Bot Framework connector
                if (context.activity.serviceUrl) {
                    await context.sendActivity({
                        type: 'message',
                        text: result.answer
                    });
                    console.log('[finchat-teams] Answer delivered successfully via Bot Framework connector.');
                }

                // Also attach response to turnState so local tests / direct HTTP calls get the answer directly
                const httpResponse = context.turnState && context.turnState.get('httpResponse');
                if (httpResponse) {
                    httpResponse.send({
                        status: result.status || 'success',
                        answer: result.answer,
                        sources: result.sources || [],
                        grounded: result.grounded,
                        document_name: result.document_name,
                        page: result.page,
                        insufficientEvidence: result.insufficientEvidence
                    });
                }

            } catch (error) {
                console.error('[finchat-teams] Processing error:', error.message);

                const fallbackMsg = 'Unable to process your question right now. Please try again later.';
                try {
                    if (context.activity.serviceUrl) {
                        await context.sendActivity(fallbackMsg);
                    }
                } catch { }

                const httpResponse = context.turnState && context.turnState.get('httpResponse');
                if (httpResponse) {
                    httpResponse.status(500).send({
                        status: 'ERROR',
                        answer: fallbackMsg,
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
        this.headers[name.toLowerCase()] = String(value);
        return this;
    }

    send(body) {
        this.body = body;
        return this;
    }

    end(body) {
        if (body !== undefined) {
            this.body = body;
        }
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

        } catch (error) {
            context.error('[finchat-teams] Messaging endpoint failed:', error.message);

            return {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    status: 'ERROR',
                    bot: 'finchat-teams',
                    message: 'Bot message processing failed.',
                    error: error.message
                })
            };
        }
    }
});
