// src/services/observability.js
// Purpose: WP18 Observability, Audit Logs & Financial Governance Metrics Service.

const { getPool } = require('./sql');
const sql = require('mssql');

/**
 * Retrieves comprehensive governance and pipeline observability metrics.
 *
 * @returns {Promise<Object>} Metrics payload
 */
async function getSystemGovernanceMetrics() {
    const p = await getPool();

    // 1. Documents distribution by IngestionStatus and ConflictHold
    const docMetricsRes = await p.request().query(`
        SELECT 
            COUNT(*) AS TotalDocuments,
            COUNT(CASE WHEN IngestionStatus = 'Succeeded' THEN 1 END) AS SucceededDocuments,
            COUNT(CASE WHEN IngestionStatus = 'PendingApproval' THEN 1 END) AS PendingApprovalDocuments,
            COUNT(CASE WHEN IngestionStatus = 'PartiallyApproved' THEN 1 END) AS PartiallyApprovedDocuments,
            COUNT(CASE WHEN IngestionStatus = 'Rejected' THEN 1 END) AS RejectedDocuments,
            COUNT(CASE WHEN IngestionStatus = 'Superseded' THEN 1 END) AS SupersededDocuments,
            COUNT(CASE WHEN IngestionStatus = 'Failed' THEN 1 END) AS FailedDocuments,
            COUNT(CASE WHEN ISNULL(ConflictHold, 0) = 1 THEN 1 END) AS HeldDocuments
        FROM dbo.Documents
    `);
    const docMetrics = docMetricsRes.recordset[0] || {};

    // 2. Financial Facts distribution by MappingStatus
    const factMetricsRes = await p.request().query(`
        SELECT 
            COUNT(*) AS TotalFacts,
            COUNT(CASE WHEN MappingStatus = 'Approved' THEN 1 END) AS ApprovedFacts,
            COUNT(CASE WHEN MappingStatus = 'NeedsReview' THEN 1 END) AS NeedsReviewFacts,
            COUNT(CASE WHEN MappingStatus = 'Pending' THEN 1 END) AS PendingFacts,
            COUNT(CASE WHEN MappingStatus = 'Rejected' THEN 1 END) AS RejectedFacts,
            COUNT(CASE WHEN MappingStatus = 'Superseded' THEN 1 END) AS SupersededFacts
        FROM dbo.FinancialFacts
    `);
    const factMetrics = factMetricsRes.recordset[0] || {};

    // 3. Conflicts distribution by ConflictStatus
    const conflictMetricsRes = await p.request().query(`
        SELECT 
            COUNT(*) AS TotalConflicts,
            COUNT(CASE WHEN ConflictStatus IN ('PendingApproval', 'PendingReview', 'Detected', 'Potential', 'Escalated') THEN 1 END) AS ActiveConflicts,
            COUNT(CASE WHEN ConflictStatus IN ('ApprovedExisting', 'ApprovedIncoming') THEN 1 END) AS ResolvedConflicts,
            COUNT(CASE WHEN ConflictStatus = 'Moot' THEN 1 END) AS MootConflicts
        FROM dbo.FactConflicts
    `);
    const conflictMetrics = conflictMetricsRes.recordset[0] || {};

    return {
        timestamp: new Date().toISOString(),
        documents: docMetrics,
        facts: factMetrics,
        conflicts: conflictMetrics,
        health: {
            isHealthy: (docMetrics.FailedDocuments || 0) === 0,
            hasActiveHolds: (docMetrics.HeldDocuments || 0) > 0
        }
    };
}

/**
 * Retrieves audit trail logs for specific facts, documents, or general system events.
 *
 * @param {Object} [options]
 * @param {number|string} [options.documentId]
 * @param {number|string} [options.factId]
 * @param {number} [options.limit=100]
 * @returns {Promise<Array<Object>>}
 */
async function getAuditTrail({ documentId = null, factId = null, limit = 100 } = {}) {
    const p = await getPool();
    const req = p.request().input('Limit', sql.Int, limit);

    let whereClause = '1=1';
    if (documentId) {
        req.input('DocumentId', sql.BigInt, Number(documentId));
        whereClause += ' AND DocumentId = @DocumentId';
    }
    if (factId) {
        req.input('FactId', sql.BigInt, Number(factId));
        whereClause += ' AND FactId = @FactId';
    }

    const query = `
        SELECT TOP (@Limit) AuditId, FactId, DocumentId, ActionType, OldValue, NewValue, ActionReason, ActionBy, ActionAt
        FROM dbo.FactAudit
        WHERE ${whereClause}
        ORDER BY AuditId DESC
    `;

    const res = await req.query(query);
    return res.recordset || [];
}

module.exports = {
    getSystemGovernanceMetrics,
    getAuditTrail
};

