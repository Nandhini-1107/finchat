require('../utils/config');
const { AppError, sanitizeErrorMessage } = require('../utils/errors');
const { EXTENDED_INDEX_FIELDS } = require('./search-document');

const API_VERSION = '2024-07-01';
const INDEX_VERSION = 'v2.0';

let schemaPromise = null;

/**
 * Returns current index version marker and checks if schema migration / re-indexing is required.
 */
function getIndexVersionMarker() {
    return {
        version: INDEX_VERSION,
        embeddingModel: 'text-embedding-3-small',
        dimensions: 1536
    };
}

/**
 * Triggers re-indexing path in SQL by marking documents IndexingStatus = 'Pending'.
 */
async function triggerReindexingPath(documentId = null) {
    const { getPool } = require('./sql');
    const p = await getPool();
    if (documentId) {
        await p.request()
            .input('DocId', require('mssql').BigInt, Number(documentId))
            .query("UPDATE dbo.Documents SET IndexingStatus = 'Pending' WHERE DocumentId = @DocId");
    } else {
        await p.request().query("UPDATE dbo.Documents SET IndexingStatus = 'Pending' WHERE IngestionStatus = 'Succeeded' AND ISNULL(ConflictHold, 0) = 0");
    }
    return { status: 'ReindexingTriggered', indexVersion: INDEX_VERSION };
}

function searchConfig() {
    const endpoint = (process.env.AZURE_SEARCH_ENDPOINT || '').replace(/\/+$/, '');
    const indexName = process.env.AZURE_SEARCH_INDEX || 'finance-hr-documents';
    const adminKey = (process.env.AZURE_SEARCH_ADMIN_KEY || '').trim();
    return { endpoint, indexName, adminKey };
}

function indexUrl(endpoint, indexName) {
    return `${endpoint}/indexes/${encodeURIComponent(indexName)}?api-version=${API_VERSION}`;
}

async function readError(response) {
    const body = await response.json().catch(() => null);
    const message = body && body.error && body.error.message
        ? body.error.message
        : `HTTP ${response.status}`;
    return sanitizeErrorMessage(message);
}

function definitionForUpdate(index, fields) {
    const body = {
        name: index.name,
        fields
    };
    const keep = [
        'vectorSearch',
        'semantic',
        'scoringProfiles',
        'suggesters',
        'analyzers',
        'tokenizers',
        'tokenFilters',
        'charFilters',
        'normalizers',
        'corsOptions',
        'encryptionKey',
        'similarity',
        'defaultScoringProfile'
    ];
    for (const key of keep) {
        if (index[key] != null) body[key] = index[key];
    }
    return body;
}

/**
 * Adds provenance and authority fields to the existing index.
 * Does not change id, title, content, source, or contentVector.
 */
async function ensureSearchIndexFields() {
    if (!schemaPromise) {
        schemaPromise = updateSearchIndexFields().catch(error => {
            schemaPromise = null;
            throw error;
        });
    }
    return schemaPromise;
}

async function updateSearchIndexFields() {
    const { endpoint, indexName, adminKey } = searchConfig();

    if (!endpoint) {
        throw new AppError('Azure AI Search endpoint is missing (AZURE_SEARCH_ENDPOINT).', 500);
    }

    if (!adminKey) {
        return {
            ready: false,
            updated: false,
            indexName,
            reason: 'AZURE_SEARCH_ADMIN_KEY is not set. Extended search fields were not added.'
        };
    }

    const url = indexUrl(endpoint, indexName);
    const headers = { 'api-key': adminKey, Accept: 'application/json' };
    const currentResponse = await fetch(url, { headers });

    if (!currentResponse.ok) {
        throw new AppError(
            `Unable to read Azure AI Search index "${indexName}": ${await readError(currentResponse)}`,
            502
        );
    }

    const index = await currentResponse.json();
    const existingNames = new Set((index.fields || []).map(field => field.name));
    const missing = EXTENDED_INDEX_FIELDS.filter(field => !existingNames.has(field.name));

    if (missing.length === 0) {
        return { ready: true, updated: false, indexName, added: [] };
    }

    const nextFields = [...(index.fields || []), ...missing];
    const updateResponse = await fetch(url, {
        method: 'PUT',
        headers: {
            ...headers,
            'Content-Type': 'application/json',
            'If-Match': '*'
        },
        body: JSON.stringify(definitionForUpdate(index, nextFields))
    });

    if (!updateResponse.ok) {
        throw new AppError(
            `Unable to add fields to Azure AI Search index "${indexName}": ${await readError(updateResponse)}`,
            502
        );
    }

    return {
        ready: true,
        updated: true,
        indexName,
        added: missing.map(field => field.name)
    };
}

function resetSearchIndexSchemaCache() {
    schemaPromise = null;
}

module.exports = {
    ensureSearchIndexFields,
    resetSearchIndexSchemaCache,
    getIndexVersionMarker,
    triggerReindexingPath,
    INDEX_VERSION
};
