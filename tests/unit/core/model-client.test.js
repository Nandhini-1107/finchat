const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { AzureOpenAI } = require('openai');
const {
    getClient,
    getActiveModelInfo,
    resetModelClients,
    chatCompletion,
    validateModelConfiguration,
    isArabicText
} = require('../../../src/services/model-client');
const {
    generateBatchEmbeddings,
    getEmbeddingClient,
    resetEmbeddingClient
} = require('../../../src/services/embeddings');

describe('Pure Azure OpenAI Dual Deployments (Fast / Strong) & Zero Third-Party LLMs', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
        process.env = { ...originalEnv };
        resetModelClients();
        resetEmbeddingClient();
    });

    test('1. Environment-only Dual Deployments: getClient selects fast vs strong based on tier', () => {
        process.env.AZURE_OPENAI_ENDPOINT = 'https://contoso-openai.services.ai.azure.com';
        process.env.AZURE_OPENAI_API_KEY = 'test-azure-key';
        process.env.AZURE_OPENAI_FAST_DEPLOYMENT = 'gpt-4o-mini';
        process.env.AZURE_OPENAI_STRONG_DEPLOYMENT = 'gpt-4o';

        const fastClient = getClient('fast');
        assert.ok(fastClient);
        assert.equal(fastClient.provider, 'azure');
        assert.equal(fastClient.model, 'gpt-4o-mini');
        assert.equal(fastClient.tier, 'fast');
        assert.ok(fastClient.client instanceof AzureOpenAI);

        const strongClient = getClient('strong');
        assert.ok(strongClient);
        assert.equal(strongClient.provider, 'azure');
        assert.equal(strongClient.model, 'gpt-4o');
        assert.equal(strongClient.tier, 'strong');
        assert.ok(strongClient.client instanceof AzureOpenAI);
    });

    test('2. Startup Verification: validateModelConfiguration succeeds with required env and fails when missing', () => {
        process.env.AZURE_OPENAI_ENDPOINT = 'https://contoso-openai.services.ai.azure.com';
        process.env.AZURE_OPENAI_API_KEY = 'test-azure-key';
        process.env.AZURE_OPENAI_FAST_DEPLOYMENT = 'gpt-4o-mini';

        assert.doesNotThrow(() => validateModelConfiguration());

        delete process.env.AZURE_OPENAI_API_KEY;
        assert.throws(
            () => validateModelConfiguration(),
            /Azure OpenAI configuration missing/
        );
    });

    test('3. Zero Third-Party Fallback: Throws 500 AppError when Azure OpenAI is not configured', () => {
        delete process.env.AZURE_OPENAI_ENDPOINT;
        delete process.env.AZURE_OPENAI_API_KEY;
        delete process.env.AZURE_OPENAI_FAST_DEPLOYMENT;
        delete process.env.AZURE_OPENAI_STRONG_DEPLOYMENT;
        delete process.env.AZURE_OPENAI_CHAT_DEPLOYMENT;

        assert.throws(
            () => getClient('fast'),
            {
                name: 'AppError',
                message: /No LLM model configured in env/
            }
        );
    });

    test('4. Deterministic Arabic Language Detection: Accurately identifies Arabic text via Unicode blocks', () => {
        assert.equal(isArabicText('الإيرادات السنوية لشركة كونتوسو'), true, 'Standard Modern Arabic text');
        assert.equal(isArabicText('صافي الربح: 500,000 درهم'), true, 'Arabic text with numbers and punctuation');
        assert.equal(isArabicText('Contoso Retail LLC Annual Revenue'), false, 'English financial query');
        assert.equal(isArabicText('Q1 2026 EBITDA 12.5% increase'), false, 'English alphanumeric statement');
        assert.equal(isArabicText(''), false, 'Empty string');
        assert.equal(isArabicText(null), false, 'Null input');
    });

    test('5. chatCompletion extracts and returns token usage from Azure OpenAI', async () => {
        process.env.AZURE_OPENAI_ENDPOINT = 'https://contoso-openai.services.ai.azure.com';
        process.env.AZURE_OPENAI_API_KEY = 'test-key';
        process.env.AZURE_OPENAI_FAST_DEPLOYMENT = 'gpt-4o-mini';

        const target = getClient('fast');
        target.client.chat = {
            completions: {
                create: async () => ({
                    choices: [{ message: { content: 'Audited financial summary' } }],
                    usage: { prompt_tokens: 25, completion_tokens: 10, total_tokens: 35 }
                })
            }
        };

        const res = await chatCompletion({ messages: [{ role: 'user', content: 'What was Q1 revenue?' }] });
        assert.equal(res.text, 'Audited financial summary');
        assert.equal(res.provider, 'azure');
        assert.equal(res.model, 'gpt-4o-mini');
        assert.equal(res.tier, 'fast');
        assert.equal(res.usage.inputTokens, 25);
        assert.equal(res.usage.outputTokens, 10);
        assert.equal(res.usage.totalTokens, 35);
    });
});

describe('Single Embedding Model (text-embedding-3-small)', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
        process.env = { ...originalEnv };
        resetEmbeddingClient();
    });

    test('generateBatchEmbeddings throws when Azure embedding configuration is missing from env', async () => {
        delete process.env.AZURE_EMBEDDING_ENDPOINT;
        delete process.env.AZURE_EMBEDDING_API_KEY;
        delete process.env.AZURE_EMBEDDING_DEPLOYMENT;

        await assert.rejects(
            async () => {
                await generateBatchEmbeddings(['test text']);
            },
            {
                name: 'AppError',
                message: /Azure embedding model is not configured/
            }
        );
    });

    test('getEmbeddingClient() creates an official AzureOpenAI instance with text-embedding-3-small', () => {
        process.env.AZURE_EMBEDDING_ENDPOINT = 'https://my-resource.services.ai.azure.com';
        process.env.AZURE_EMBEDDING_API_KEY = 'test-key';
        process.env.AZURE_EMBEDDING_DEPLOYMENT = 'text-embedding-3-small';

        const client = getEmbeddingClient();
        assert.ok(client);
        assert.ok(client instanceof AzureOpenAI);
    });
});
