require('../utils/config');
const { AzureOpenAI } = require('openai');
const { AppError } = require('../utils/errors');

let fastClient = null;
let strongClient = null;

const ARABIC_REGEX = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

/**
 * Deterministic Arabic language check using Unicode character block boundaries.
 */
function isArabicText(text) {
    if (!text || typeof text !== 'string') return false;
    return ARABIC_REGEX.test(text);
}

/**
 * Validates Azure OpenAI environment configuration at startup.
 */
function validateModelConfiguration() {
    const endpoint = (process.env.AZURE_OPENAI_ENDPOINT || '').trim();
    const apiKey = (process.env.AZURE_OPENAI_API_KEY || '').trim();
    const fastDeployment = (process.env.AZURE_OPENAI_FAST_DEPLOYMENT || process.env.AZURE_OPENAI_CHAT_DEPLOYMENT || '').trim();
    const strongDeployment = (process.env.AZURE_OPENAI_STRONG_DEPLOYMENT || process.env.AZURE_OPENAI_CHAT_DEPLOYMENT || '').trim();

    if (!endpoint || !apiKey) {
        throw new AppError('Azure OpenAI configuration missing: AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_API_KEY must be set in environment.', 500);
    }

    if (!fastDeployment && !strongDeployment) {
        throw new AppError('Azure OpenAI deployment missing: either AZURE_OPENAI_FAST_DEPLOYMENT or AZURE_OPENAI_STRONG_DEPLOYMENT must be configured.', 500);
    }

    return true;
}

/**
 * Retrieves Azure OpenAI client for the requested tier ('fast' or 'strong').
 * Environment-only deployment selection.
 */
function getClient(tier = 'fast') {
    const rawEndpoint = (process.env.AZURE_OPENAI_ENDPOINT || '').trim().replace(/\/+$/, '');
    const cleanEndpoint = rawEndpoint.replace(/\/openai(\/v1)?$/, '');
    const apiKey = (process.env.AZURE_OPENAI_API_KEY || '').trim();
    const apiVersion = (process.env.AZURE_OPENAI_API_VERSION || process.env.OPENAI_API_VERSION || '2024-06-01').trim();

    if (!cleanEndpoint || !apiKey) {
        throw new AppError('No LLM model configured in env. Please set AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_API_KEY in local.settings.json or .env.', 500);
    }

    const isStrong = tier === 'strong';
    const deployment = isStrong
        ? (process.env.AZURE_OPENAI_STRONG_DEPLOYMENT || process.env.AZURE_OPENAI_CHAT_DEPLOYMENT || 'gpt-4o').trim()
        : (process.env.AZURE_OPENAI_FAST_DEPLOYMENT || process.env.AZURE_OPENAI_CHAT_DEPLOYMENT || 'gpt-4o-mini').trim();

    if (isStrong) {
        if (!strongClient) {
            strongClient = new AzureOpenAI({
                endpoint: cleanEndpoint,
                apiKey,
                apiVersion,
                deployment,
                maxRetries: 2,
                timeout: Number(process.env.AZURE_OPENAI_TIMEOUT_SECONDS || 45) * 1000
            });
        }
        return { client: strongClient, model: deployment, provider: 'azure', tier: 'strong' };
    }

    if (!fastClient) {
        fastClient = new AzureOpenAI({
            endpoint: cleanEndpoint,
            apiKey,
            apiVersion,
            deployment,
            maxRetries: 2,
            timeout: Number(process.env.AZURE_OPENAI_TIMEOUT_SECONDS || 30) * 1000
        });
    }
    return { client: fastClient, model: deployment, provider: 'azure', tier: 'fast' };
}

/**
 * Returns the active model name and provider for a given tier.
 */
function getActiveModelInfo(tier = 'fast') {
    const { model, provider } = getClient(tier);
    return { model, provider };
}

/**
 * Executes a chat completion call using the specified Azure OpenAI tier ('fast' or 'strong').
 */
async function chatCompletion({ messages, maxTokens, temperature, responseFormat, timeoutMs, jobId, correlationId, tier = 'fast' }) {
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
        throw new AppError('Messages array is required for chat completion.', 400);
    }

    const { client, model, provider } = getClient(tier);
    const activeJobId = jobId || correlationId || null;
    const jobTag = activeJobId ? `[Job: ${activeJobId}] ` : '';

    console.log(`${jobTag}[LLM Selection] Chosen LLM for Job ID "${activeJobId || 'N/A'}": Model="${model}" (Provider: ${provider}, Tier: ${tier})`);

    const options = Number.isInteger(timeoutMs) ? { timeout: timeoutMs } : undefined;

    const payload = {
        model,
        messages,
        max_tokens: Number(maxTokens || process.env.LLM_MAX_TOKENS || 4096),
        temperature: Number(temperature !== undefined ? temperature : (process.env.LLM_TEMPERATURE || 0.1))
    };
    if (responseFormat) {
        payload.response_format = responseFormat;
    }

    try {
        const response = await client.chat.completions.create(payload, options);

        const inputTokens = response.usage?.prompt_tokens || 0;
        const outputTokens = response.usage?.completion_tokens || 0;
        const totalTokens = response.usage?.total_tokens || (inputTokens + outputTokens);

        console.log(`${jobTag}[TokenUsage] Provider: ${provider} | Model: ${model} | Tier: ${tier} | Input Tokens: ${inputTokens} | Output Tokens: ${outputTokens} | Total Tokens: ${totalTokens}`);

        return {
            text: response.choices?.[0]?.message?.content || '',
            choices: response.choices,
            provider,
            model,
            tier,
            jobId: activeJobId,
            usage: {
                inputTokens,
                outputTokens,
                totalTokens
            },
            raw: response
        };
    } catch (err) {
        throw new AppError(`LLM call failed (${model}): ${err.message}`, 502);
    }
}

/**
 * Resets the cached LLM clients (used in unit tests).
 */
function resetModelClients() {
    fastClient = null;
    strongClient = null;
}

module.exports = {
    chatCompletion,
    getClient,
    getActiveModelInfo,
    resetModelClients,
    validateModelConfiguration,
    isArabicText
};
