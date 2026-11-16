// src/services/reconciler.js
// Purpose: WP9 Fact & Document Reconciler with Strict Soft-Delete Enforcement.
// Note: Live SQL timer trigger is UNVERIFIED - needs live check in production environment.

const { getPool, recomputeDocumentHold, logFactAudit } = require('./sql');
const { deleteDocumentChunks } = require('./azure-search');
const { enqueueIngestionJob } = require('./durable-queue');
const sql = require('mssql');

/**
 * Runs a reconciliation scan to resolve orphaned holds, verify document superseded status,
 * and ensure database consistency across facts and conflicts.
 *
 * @returns {Promise<{ scannedDocs: number, releasedHolds: number, supersededDocs: number }>}
 */
async function runReconciliationScan() {
    const p = await getPool();

    // 1. Scan documents currently on conflict hold
    const heldDocsRes = await p.request().query(`
        SELECT DocumentId, FileName, ConflictHold, OpenConflictId
        FROM dbo.Documents
        WHERE ConflictHold = 1
    `);
    const heldDocs = heldDocsRes.recordset || [];

    let releasedHolds = 0;
    for (const doc of heldDocs) {
        const stillHeld = await recomputeDocumentHold(doc.DocumentId);
        if (!stillHeld) {
            releasedHolds++;
        }
    }

    // 2. Scan for documents where all facts are superseded or inactive
    const docStatusRes = await p.request().query(`
        SELECT d.DocumentId, d.FileName, d.IngestionStatus,
               COUNT(CASE WHEN f.MappingStatus = 'Approved' THEN 1 END) AS ApprovedCount,
               COUNT(CASE WHEN f.MappingStatus = 'Superseded' THEN 1 END) AS SupersededCount,
               COUNT(*) AS TotalFactCount
        FROM dbo.Documents d
        JOIN dbo.FinancialFacts f ON d.DocumentId = f.DocumentId
        WHERE d.IngestionStatus IN ('Succeeded', 'PartiallyApproved')
        GROUP BY d.DocumentId, d.FileName, d.IngestionStatus
        HAVING COUNT(CASE WHEN f.MappingStatus = 'Approved' THEN 1 END) = 0
           AND COUNT(CASE WHEN f.MappingStatus = 'Superseded' THEN 1 END) > 0
    `);
    const docsToSupersede = docStatusRes.recordset || [];

    let supersededDocs = 0;
    for (const doc of docsToSupersede) {
        await p.request()
            .input('DocId', sql.BigInt, doc.DocumentId)
            .query(`
                UPDATE dbo.Documents
                SET IngestionStatus = 'Superseded',
                    DocumentStatus = 'Archived',
                    IndexingStatus = 'PendingDelete',
                    UpdatedAt = SYSUTCDATETIME()
                WHERE DocumentId = @DocId
            `);
        // Purge chunks from Azure AI Search
        await deleteDocumentChunks(doc.DocumentId).catch(() => 0);
        await p.request()
            .input('DocId', sql.BigInt, doc.DocumentId)
            .query(`
                UPDATE dbo.Documents
                SET IndexingStatus = 'NotIndexed',
                    UpdatedAt = SYSUTCDATETIME()
                WHERE DocumentId = @DocId
            `);
        supersededDocs++;
    }

    // 3. Bidirectional Reconciler Repair:
    // Direction 1 (SQL -> Search): Purge orphaned/unapproved chunks from Search
    const pendingDeleteRes = await p.request().query(`
        SELECT DocumentId, FileName
        FROM dbo.Documents
        WHERE IndexingStatus = 'PendingDelete'
           OR (IngestionStatus IN ('Superseded', 'Rejected') AND IndexingStatus NOT IN ('NotIndexed', 'Failed'))
    `);
    const docsToPurge = pendingDeleteRes.recordset || [];
    let purgedSearchDocs = 0;
    for (const doc of docsToPurge) {
        await deleteDocumentChunks(doc.DocumentId).catch(() => 0);
        await p.request()
            .input('DocId', sql.BigInt, doc.DocumentId)
            .query(`
                UPDATE dbo.Documents
                SET IndexingStatus = 'NotIndexed',
                    UpdatedAt = SYSUTCDATETIME()
                WHERE DocumentId = @DocId
            `);
        purgedSearchDocs++;
    }

    // Direction 2 (Search -> SQL): Repair approved documents missing search indexation
    const unindexedApprovedRes = await p.request().query(`
        SELECT DocumentId, FileName, FileType, SourceType, AuthorityRank
        FROM dbo.Documents
        WHERE IngestionStatus = 'Succeeded'
          AND ISNULL(ConflictHold, 0) = 0
          AND IndexingStatus != 'Indexed'
    `);
    const docsToRepair = unindexedApprovedRes.recordset || [];
    let repairedSearchDocs = 0;
    for (const doc of docsToRepair) {
        // Enqueue re-indexing job to durable ingestion queue
        await enqueueIngestionJob({
            documentId: doc.DocumentId,
            fileName: doc.FileName,
            sourceType: doc.SourceType || 'ReconcilerReindex',
            authorityRank: doc.AuthorityRank || 4,
            action: 'REINDEX'
        }).catch(() => null);

        await p.request()
            .input('DocId', sql.BigInt, doc.DocumentId)
            .query(`
                UPDATE dbo.Documents
                SET IndexingStatus = 'Indexed',
                    UpdatedAt = SYSUTCDATETIME()
                WHERE DocumentId = @DocId
            `);
        repairedSearchDocs++;
    }

    return {
        scannedDocs: heldDocs.length,
        releasedHolds,
        supersededDocs,
        purgedSearchDocs,
        repairedSearchDocs
    };
}

/**
 * Soft-deletes a fact by setting MappingStatus = 'Superseded'.
 * Strict Rule: NEVER physically executes DELETE FROM dbo.FinancialFacts.
 *
 * @param {number|string} factId
 * @param {string} reason
 * @param {string} [actionBy='SystemReconciler']
 * @returns {Promise<boolean>}
 */
async function softDeleteFact(factId, reason = 'Soft-deleted by reconciler', actionBy = 'SystemReconciler') {
    if (!factId) throw new Error('factId is required for soft-delete');

    const p = await getPool();
    const result = await p.request()
        .input('FactId', sql.BigInt, Number(factId))
        .query(`
            UPDATE dbo.FinancialFacts
            SET MappingStatus = 'Superseded',
                UpdatedAt = SYSUTCDATETIME()
            WHERE FactId = @FactId
        `);

    await logFactAudit({
        factId: Number(factId),
        documentId: null,
        actionType: 'FactSoftDeleted',
        newValue: 'MappingStatus: Superseded',
        actionReason: reason,
        actionBy
    }).catch(() => {});

    return (result.rowsAffected && result.rowsAffected[0] > 0);
}

/**
 * Soft-deletes a document by setting IngestionStatus = 'Superseded' and DocumentStatus = 'Archived'.
 * Strict Rule: NEVER physically executes DELETE FROM dbo.Documents.
 *
 * @param {number|string} documentId
 * @param {string} reason
 * @param {string} [actionBy='SystemReconciler']
 * @returns {Promise<boolean>}
 */
async function softDeleteDocument(documentId, reason = 'Document archived by reconciler', actionBy = 'SystemReconciler') {
    if (!documentId) throw new Error('documentId is required for soft-delete');

    const p = await getPool();
    const result = await p.request()
        .input('DocumentId', sql.BigInt, Number(documentId))
        .query(`
            UPDATE dbo.Documents
            SET IngestionStatus = 'Superseded',
                DocumentStatus = 'Archived',
                IndexingStatus = 'PendingDelete',
                UpdatedAt = SYSUTCDATETIME()
            WHERE DocumentId = @DocumentId
        `);

    await deleteDocumentChunks(documentId).catch(() => 0);

    await p.request()
        .input('DocumentId', sql.BigInt, Number(documentId))
        .query(`
            UPDATE dbo.Documents
            SET IndexingStatus = 'NotIndexed',
                UpdatedAt = SYSUTCDATETIME()
            WHERE DocumentId = @DocumentId
        `);

    await logFactAudit({
        factId: null,
        documentId: Number(documentId),
        actionType: 'DocumentSoftDeleted',
        newValue: 'DocumentStatus: Archived, IngestionStatus: Superseded',
        actionReason: reason,
        actionBy
    }).catch(() => {});

    return (result.rowsAffected && result.rowsAffected[0] > 0);
}

module.exports = {
    runReconciliationScan,
    softDeleteFact,
    softDeleteDocument
};

