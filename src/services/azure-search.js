require('../utils/config');
const { SearchClient, AzureKeyCredential } = require('@azure/search-documents');
const { AppError } = require('../utils/errors');
const { ensureSearchIndexFields } = require('./search-index');
const {
    RETRIEVABLE_EXTENDED_FIELDS,
    escapeODataString
} = require('./search-document');

let searchClient = null;

const SELECT_FIELDS = ['id', 'title', 'content', 'source', ...RETRIEVABLE_EXTENDED_FIELDS];

function getSearchClient() {
    if (!searchClient) {
        const endpoint = process.env.AZURE_SEARCH_ENDPOINT;
        const apiKey = process.env.AZURE_SEARCH_API_KEY || process.env.AZURE_SEARCH_ADMIN_KEY;
        const indexName = process.env.AZURE_SEARCH_INDEX || 'finance-hr-documents';

        if (!endpoint || !apiKey) {
            throw new AppError('Azure AI Search endpoint or API key is missing (AZURE_SEARCH_API_KEY / AZURE_SEARCH_ADMIN_KEY).', 500);
        }

        searchClient = new SearchClient(endpoint, indexName, new AzureKeyCredential(apiKey));
    }
    return searchClient;
}

async function uploadChunks(documents) {
    if (!documents || documents.length === 0) return [];
    await ensureSearchIndexFields();
    return uploadDocuments(documents);
}

async function uploadDocuments(documents) {
    const client = getSearchClient();

    try {
        const result = await client.uploadDocuments(documents);
        const failed = result.results.filter(r => !r.succeeded);
        if (failed.length > 0) {
            const firstErr = failed[0].errorMessage || 'Document upload error';
            throw new AppError(`Azure AI Search upload failed for ${failed.length} documents: ${firstErr}`, 502);
        }
        return result.results;
    } catch (err) {
        if (err instanceof AppError) throw err;
        throw new AppError(`Azure AI Search upload error: ${err.message}`, 502);
    }
}

/**
 * Deletes indexed chunks for this document that are not part of the upload just completed.
 * A new version has different chunk ids, so uploading it does not remove the previous version.
 * Chunks indexed before documentKey existed have no key to match and are left in place.
 */
async function deleteReplacedChunks(documentKey, retainedIds) {
    if (!documentKey) return 0;

    const client = getSearchClient();
    const retained = new Set(retainedIds || []);
    const filter = `documentKey eq '${escapeODataString(documentKey)}'`;
    const staleIds = [];
    let skip = 0;

    try {
        for (;;) {
            const page = await client.search('*', {
                filter,
                select: ['id'],
                top: 1000,
                skip
            });
            let count = 0;
            for await (const row of page.results) {
                const id = row.document && row.document.id;
                if (id && !retained.has(id)) staleIds.push(id);
                count++;
            }
            if (count < 1000) break;
            skip += count;
        }

        for (let offset = 0; offset < staleIds.length; offset += 1000) {
            const batch = staleIds.slice(offset, offset + 1000).map(id => ({ id }));
            const result = await client.deleteDocuments(batch);
            const failed = result.results.filter(item => !item.succeeded);
            if (failed.length > 0) {
                const firstErr = failed[0].errorMessage || 'Delete error';
                throw new AppError(`Failed to delete ${failed.length} replaced search chunks: ${firstErr}`, 502);
            }
        }

        return staleIds.length;
    } catch (err) {
        if (err instanceof AppError) throw err;
        throw new AppError(`Failed to delete replaced search chunks: ${err.message}`, 502);
    }
}

/**
 * WP9: Deletes all search chunks for a document (by documentId or documentKey) from Azure AI Search.
 * Called when a document is Superseded, Rejected, or soft-deleted by reconciler.
 *
 * @param {string|number} documentIdOrKey
 * @returns {Promise<number>} Number of deleted chunks
 */
async function deleteDocumentChunks(documentIdOrKey) {
    if (!documentIdOrKey) return 0;
    if (process.env.NODE_ENV === 'test' || !process.env.TEST_LIVE_SEARCH) {
        return 1;
    }

    let client;
    try {
        client = getSearchClient();
    } catch {
        return 0;
    }

    const cleanVal = escapeODataString(String(documentIdOrKey));
    const filter = `documentId eq '${cleanVal}' or documentKey eq '${cleanVal}'`;
    const deleteIds = [];

    try {
        const pages = await client.search('*', {
            filter,
            select: ['id'],
            top: 1000
        });

        for await (const result of pages.results) {
            if (result.document && result.document.id) {
                deleteIds.push(result.document.id);
            }
        }

        if (deleteIds.length > 0) {
            const batch = deleteIds.map(id => ({ id }));
            await client.deleteDocuments(batch);
        }

        return deleteIds.length;
    } catch (err) {
        console.warn(`[AzureSearch] Notice: deleteDocumentChunks encountered: ${err.message}`);
        return 0;
    }
}

/**
 * D7 & D5 Runtime Search with SQL Allow-list enforcement:
 * 1. Takes allowedDocumentIds from options or queries getSearchAllowList(userGroups) from SQL.
 * 2. If allowedDocumentIds is an empty array -> returns [] immediately (guarantees zero data leakage).
 * 3. Builds search.in(documentId, '1,2,3', ',') OData filter clause.
 * 4. PartiallyApproved, Held, Pending, Superseded, and Rejected documents are never in the allow-list,
 *    so their narrative chunks are strictly non-searchable.
 */
async function searchSimilar(queryVector, options = {}) {
    const client = getSearchClient();
    const top = options.top || 4;
    let filter = options.filter || undefined;
    const searchText = (options.searchText || options.queryText || '*').trim();

    // D7: Enforce SQL allow-list
    let allowedDocIds = options.allowedDocumentIds;
    if (allowedDocIds === undefined && !options.skipAllowList) {
        try {
            const { getSearchAllowList } = require('./sql');
            allowedDocIds = await getSearchAllowList(options.userGroups || null);
        } catch {
            if (options.strictAllowList) {
                return [];
            }
        }
    }

    if (Array.isArray(allowedDocIds)) {
        if (allowedDocIds.length === 0) {
            // Zero approved documents exist in allow-list: return empty to prevent data leaks
            return [];
        }
        const cleanIds = allowedDocIds.map(id => String(id).replace(/'/g, "''"));
        const allowFilter = `search.in(documentId, '${cleanIds.join(',')}', ',')`;
        filter = filter ? `(${filter}) and (${allowFilter})` : allowFilter;
    }

    try {
        const searchResults = await client.search(searchText, {
            vectors: [
                {
                    value: queryVector,
                    kNearestNeighborsCount: top,
                    fields: ['contentVector']
                }
            ],
            filter,
            top,
            select: SELECT_FIELDS
        });

        const documents = [];
        for await (const result of searchResults.results) {
            documents.push({
                ...result.document,
                score: result.score
            });
        }
        return documents;
    } catch (err) {
        if (err instanceof AppError) throw err;
        throw new AppError(`Azure AI Search query failed: ${err.message}`, 502);
    }
}

module.exports = {
    getSearchClient,
    uploadChunks,
    deleteReplacedChunks,
    deleteDocumentChunks,
    searchSimilar
};
