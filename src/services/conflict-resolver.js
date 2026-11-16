// conflict-resolver.js
// Purpose: Dynamic Multi-fact Conflict Detection and Human Approval Governance.
// Architecture: Fully dynamic business identity comparison without hardcoded metrics or entities.
// Strict Rule: NEVER automatically resolve conflicts. Source authority is displayed for reference only.

require('../utils/config');
const crypto = require('crypto');
const { areValuesEqual } = require('./unit-normalizer');
const { getPool, createFactConflict } = require('./sql');
const { generateLogicalIdentity } = require('../../contracts/extracted-facts');

/**
 * Normalizes an identity string token (trims, collapses whitespace, lowercase).
 */
function normalizeToken(val) {
    if (val === null || val === undefined) return 'unknown';
    const s = String(val).trim().toLowerCase().replace(/\s+/g, ' ');
    return s.length > 0 ? s : 'unknown';
}

/**
 * Builds a deterministic canonical business identity string for a fact.
 * Identity fields: Metric, Entity, Period, ReportingBasis, ReportingScope, NormalizedUnit, Currency, Dimensions.
 */
function buildFactIdentityKey(fact) {
    if (!fact) return null;

    const metric = fact.canonicalMetric || fact.CanonicalMetric || fact.metric || fact.Metric || fact.originalLabel || fact.OriginalLabel;
    const entity = fact.entityName || fact.EntityName || fact.entity || fact.Entity || fact.entityLabel || fact.EntityLabel || 'Global';
    const period = fact.periodName || fact.PeriodName || fact.periodLabel || fact.PeriodLabel || fact.period || fact.Period || 'General';
    const basis = fact.reportingBasis || fact.ReportingBasis || 'Actual';
    const scope = fact.reportingScope || fact.ReportingScope || 'Consolidated';
    const unit = fact.normalizedUnit || fact.NormalizedUnit || fact.unit || fact.Unit || 'amount';
    const currency = (unit === 'amount' || unit === 'monetary') ? (fact.currency || fact.Currency || null) : null;

    let dims = fact.dimensions || fact.Dimensions || {};
    if (typeof dims === 'string') {
        try {
            dims = JSON.parse(dims);
        } catch {
            dims = {};
        }
    }

    const parts = [
        `metric=${normalizeToken(metric)}`,
        `entity=${normalizeToken(entity)}`,
        `period=${normalizeToken(period)}`,
        `basis=${normalizeToken(basis)}`,
        `scope=${normalizeToken(scope)}`,
        `unit=${normalizeToken(unit)}`
    ];

    if (currency) {
        parts.push(`curr=${normalizeToken(currency)}`);
    }

    // Sort dimension keys alphabetically
    const dimKeys = Object.keys(dims).sort();
    dimKeys.forEach(k => {
        parts.push(`${normalizeToken(k)}=${normalizeToken(dims[k])}`);
    });

    const keyString = parts.join('|');
    const keyHash = crypto.createHash('sha256').update(keyString, 'utf8').digest('hex');

    return {
        keyString,
        keyHash,
        metric,
        entity,
        period,
        reportingBasis: basis,
        reportingScope: scope,
        unit,
        currency,
        dimensions: dims
    };
}

/**
 * Checks whether two facts have identical business identity.
 * Strictly:
 * - Different entities are NOT identical.
 * - Different periods are NOT identical.
 * - Different reporting bases (Actual vs Budget) are NOT identical.
 * - Different dimensions are NOT identical.
 * - Different currencies (AED vs USD) are NOT identical (never convert currencies).
 */
function areFactsIdenticalIdentity(factA, factB) {
    if (!factA || !factB) return false;

    const idA = buildFactIdentityKey(factA);
    const idB = buildFactIdentityKey(factB);

    if (!idA || !idB) return false;

    // Direct check of keyHash for exact identity match
    return idA.keyHash === idB.keyHash;
}

/**
 * Detects conflicts between incoming extracted facts and existing approved master facts.
 *
 * @param {Array<Object>} incomingFacts Array of extracted facts from incoming document
 * @param {Array<Object>} existingApprovedFacts Array of existing approved facts from database
 * @param {Object} [options]
 * @param {number} [options.tolerance=0.001]
 * @param {number} [options.tolerancePercentage=0.01]
 * @param {number} [options.authorityRank=4]
 * @param {string} [options.authoritySource='Preliminary']
 * @param {string} [options.fileName='Incoming Document']
 * @param {number|string} [options.documentId]
 * @param {string} [options.modifiedUserEmail]
 * @returns {Array<Object>} List of detected conflicts with status 'PendingApproval'
 */
function detectFinancialFactConflicts(incomingFacts = [], existingApprovedFacts = [], options = {}) {
    const tolerance = options.tolerance !== undefined ? Number(options.tolerance) : 0.001;
    const tolerancePct = options.tolerancePercentage !== undefined ? Number(options.tolerancePercentage) : 0.01;

    const conflicts = [];
    if (!Array.isArray(incomingFacts) || incomingFacts.length === 0) return conflicts;
    if (!Array.isArray(existingApprovedFacts) || existingApprovedFacts.length === 0) return conflicts;

    // Filter existing facts to only active, approved or pending facts
    const activeExisting = existingApprovedFacts.filter(f => {
        const mappingStatus = f.MappingStatus || f.mappingStatus || 'Approved';
        const docStatus = f.IngestionStatus || f.ingestionStatus || 'Succeeded';
        return (mappingStatus === 'Approved' || mappingStatus === 'Pending') &&
               (docStatus === 'Succeeded' || docStatus === 'Completed' || docStatus === 'PendingApproval' || docStatus === 'PartiallyApproved' || docStatus === null || docStatus === undefined);
    });

    incomingFacts.forEach((incoming, idx) => {
        const incomingIdentity = buildFactIdentityKey(incoming);
        if (!incomingIdentity) return;

        const rawIncomingVal = incoming.normalizedValue ?? incoming.NormalizedValue ?? incoming.numericValue ?? incoming.NumericValue;
        const incomingVal = (rawIncomingVal !== undefined && rawIncomingVal !== null) ? Number(rawIncomingVal) : null;

        if (incomingVal === null || isNaN(incomingVal)) return;

        // Find matching existing facts with identical business identity
        for (const existing of activeExisting) {
            // Skip if comparing a fact against itself from the same document
            if (options.documentId && (existing.DocumentId === options.documentId || existing.documentId === options.documentId)) {
                continue;
            }

            const existingIdentity = buildFactIdentityKey(existing);
            if (!existingIdentity) continue;

            if (incomingIdentity.keyHash !== existingIdentity.keyHash) {
                // Not the same business identity (different metric, entity, period, basis, dims, or currency)
                continue;
            }

            const existingVal = existing.NormalizedValue !== undefined && existing.NormalizedValue !== null
                ? Number(existing.NormalizedValue)
                : (existing.NumericValue !== undefined && existing.NumericValue !== null ? Number(existing.NumericValue) : null);

            if (existingVal === null || isNaN(existingVal)) continue;

            // Check numeric tolerance
            const diff = Number((incomingVal - existingVal).toFixed(4));
            const absDiff = Math.abs(diff);

            // Check absolute tolerance
            if (absDiff <= tolerance) {
                // Within rounding tolerance: NOT a conflict
                continue;
            }

            // Check percentage tolerance if applicable
            if (existingVal !== 0) {
                const diffPercentage = Number(((absDiff / Math.abs(existingVal)) * 100).toFixed(4));
                if (diffPercentage <= tolerancePct) {
                    // Within percentage tolerance: NOT a conflict
                    continue;
                }
            }

            // GENUINE CONFLICT DETECTED
            const diffPct = existingVal !== 0
                ? Number((Math.abs(diff / existingVal) * 100).toFixed(2))
                : null;

            const existingFileName = existing.SourceFileName || existing.FileName || existing.fileName || 'Existing Master';
            const incomingFileName = options.fileName || incoming.sourceFileName || 'Incoming Document';

            const existingAuthCategory = existing.AuthorityCategory || existing.AuthorityType || 'Master Authority';
            const existingAuthRank = existing.AuthorityPriority ?? existing.AuthorityRank ?? 2;
            const incomingAuthRank = options.authorityRank ?? incoming.authorityRank ?? 4;
            const incomingAuthCategory = options.authoritySource || `Priority Rank ${incomingAuthRank}`;

            conflicts.push({
                conflictType: 'ValueMismatch',
                conflictStatus: 'PendingApproval', // Strictly NO auto-resolve!
                metric: incomingIdentity.metric,
                entity: incomingIdentity.entity,
                periodLabel: incomingIdentity.period,
                reportingBasis: incomingIdentity.reportingBasis,
                reportingScope: incomingIdentity.reportingScope,
                dimensions: incomingIdentity.dimensions,
                currency: incomingIdentity.currency,
                unit: incomingIdentity.unit,
                incomingValue: incomingVal,
                existingValue: existingVal,
                differenceValue: diff,
                differencePercentage: diffPct,
                toleranceApplied: tolerance,
                existingFact: existing,
                incomingFact: incoming,
                incomingFactIndex: idx,
                existingFactId: existing.FactId || existing.factId || null,
                existingDocumentId: existing.DocumentId || existing.documentId || null,
                incomingDocumentId: options.documentId || null,
                existingFileName,
                incomingFileName,
                existingAuthority: existingAuthCategory,
                existingAuthorityRank: existingAuthRank,
                incomingAuthority: incomingAuthCategory,
                incomingAuthorityRank: incomingAuthRank,
                modifiedUserEmail: options.modifiedUserEmail || null,
                conflictDescription: `Value mismatch on ${incomingIdentity.metric} (${incomingIdentity.entity}) for ${incomingIdentity.period}: Existing ${existingVal} vs Incoming ${incomingVal}`
            });
        }
    });

    return conflicts;
}

/**
 * Detects conflicts across existing documents in the database.
 * Preserved for backward compatibility, updated to set PendingApproval instead of AutoResolved.
 */
async function detectAndResolveConflicts(documentId = null) {
    const pool = await getPool();

    let query = `
        SELECT f.FactId, f.DocumentId,
               ISNULL(m.CanonicalMetric, f.Metric) AS Metric,
               ISNULL(e.EntityName, f.Entity) AS Entity,
               ISNULL(p.PeriodName, f.PeriodLabel) AS PeriodLabel,
               f.EntityId, f.MetricId, f.PeriodId,
               ISNULL(f.ReportingBasis, 'Actual') AS ReportingBasis,
               ISNULL(f.ReportingScope, 'Consolidated') AS ReportingScope,
               ISNULL(f.NormalizedValue, f.NumericValue) AS NormalizedValue,
               f.OriginalValue, f.Currency, f.SourceLocation,
               ISNULL(r.Priority, ISNULL(d.AuthorityRank, 4)) AS AuthorityPriority,
               ISNULL(f.AuthorityRank, d.AuthorityRank) AS AuthorityRank,
               d.FileName AS SourceFileName,
               r.SourceType AS AuthorityType,
               d.ModifiedByUserEmail, d.ModifiedByEmail, d.CreatedByUserEmail, d.CreatedByEmail
        FROM dbo.FinancialFacts f
        JOIN dbo.Documents d ON f.DocumentId = d.DocumentId
        LEFT JOIN dbo.Entities e ON f.EntityId = e.EntityId
        LEFT JOIN dbo.Metrics m ON f.MetricId = m.MetricId
        LEFT JOIN dbo.Periods p ON f.PeriodId = p.PeriodId
        LEFT JOIN dbo.SourceAuthorityRanks r ON d.AuthorityRank = r.AuthorityRank
        WHERE (f.NormalizedValue IS NOT NULL OR f.NumericValue IS NOT NULL)
          AND (f.MappingStatus = 'Approved' OR f.MappingStatus = 'Pending' OR f.MappingStatus IS NULL)
          AND (d.IngestionStatus = 'Succeeded' OR d.IngestionStatus = 'Completed' OR d.IngestionStatus = 'PendingApproval' OR d.IngestionStatus IS NULL)
    `;

    if (documentId) {
        const numId = Number(documentId);
        if (!isNaN(numId) && numId > 0) {
            query += ` AND f.DocumentId = ${numId}`;
        }
    }

    const result = await pool.request().query(query);
    const allFacts = result.recordset;

    // Group facts by complete business identity
    const grouped = new Map();
    for (const f of allFacts) {
        const identity = buildFactIdentityKey(f);
        if (!identity) continue;
        const key = identity.keyHash;
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key).push(f);
    }

    const detectedConflicts = [];

    for (const [, factsInGroup] of grouped.entries()) {
        if (factsInGroup.length < 2) continue;

        // Group across distinct documents
        const docMap = new Map();
        for (const f of factsInGroup) {
            if (!docMap.has(f.DocumentId)) docMap.set(f.DocumentId, []);
            docMap.get(f.DocumentId).push(f);
        }
        if (docMap.size < 2) continue;

        // Sort ascending by authority priority (Priority 1 is highest)
        factsInGroup.sort((a, b) => (a.AuthorityPriority || 4) - (b.AuthorityPriority || 4));
        const highestAuthFact = factsInGroup[0];

        for (let i = 1; i < factsInGroup.length; i++) {
            const compFact = factsInGroup[i];
            if (highestAuthFact.DocumentId === compFact.DocumentId) continue;

            const isIdentical = areValuesEqual(highestAuthFact.NormalizedValue, compFact.NormalizedValue);
            if (isIdentical) continue;

            const diff = Number((compFact.NormalizedValue - highestAuthFact.NormalizedValue).toFixed(4));
            const diffPct = highestAuthFact.NormalizedValue !== 0
                ? Number((Math.abs(diff / highestAuthFact.NormalizedValue) * 100).toFixed(2))
                : null;

            // STRICT PHASE 4.4 GOVERNANCE: Always set PendingApproval. Never AutoResolve!
            const conflictStatus = 'PendingApproval';
            const resolutionNotes = `Value mismatch on ${highestAuthFact.Metric} (${highestAuthFact.Entity}) in ${highestAuthFact.PeriodLabel}: Existing (${highestAuthFact.SourceFileName})=${highestAuthFact.NormalizedValue} vs Incoming (${compFact.SourceFileName})=${compFact.NormalizedValue}. Difference: ${diff}. Held for human approval.`;

            const conflictId = await createFactConflict({
                entityId: highestAuthFact.EntityId,
                metricId: highestAuthFact.MetricId,
                periodId: highestAuthFact.PeriodId,
                reportingBasis: highestAuthFact.ReportingBasis,
                reportingScope: highestAuthFact.ReportingScope,
                conflictType: 'ValueMismatch',
                conflictStatus,
                conflictDescription: `Value mismatch on ${highestAuthFact.Metric} (${highestAuthFact.Entity}): ${highestAuthFact.NormalizedValue} vs ${compFact.NormalizedValue}`,
                differenceValue: diff,
                differencePercentage: diffPct,
                toleranceApplied: 0.001,
                selectedFactId: null,
                resolutionReason: resolutionNotes,
                factIds: [highestAuthFact.FactId, compFact.FactId]
            });

            detectedConflicts.push({
                conflictId,
                fact1: highestAuthFact,
                fact2: compFact,
                difference: diff,
                status: conflictStatus,
                notes: resolutionNotes
            });
        }
    }

    return detectedConflicts;
}

/**
 * Retrieves facts enriched with conflict governance context.
 * Strict Phase 4.4 Rule: Unapproved facts (Pending, Rejected, Superseded) and facts from
 * documents with PendingApproval ingestion status are EXCLUDED from active retrieval.
 */
async function getFactsWithConflictContext(documentId = null, userGroups = null) {
    const pool = await getPool();

    let query = `
        SELECT f.FactId, f.DocumentId,
               ISNULL(m.CanonicalMetric, f.Metric) AS Metric,
               ISNULL(e.EntityName, f.Entity) AS Entity,
               ISNULL(p.PeriodName, f.PeriodLabel) AS PeriodLabel,
               f.FactDate,
               ISNULL(f.NormalizedValue, f.NumericValue) AS NumericValue,
               f.NormalizedValue, f.OriginalValue, f.OriginalLabel,
               f.TextValue, f.Unit, f.NormalizedUnit, f.Currency, f.SourceLocation,
               ISNULL(r.Priority, ISNULL(d.AuthorityRank, 4)) AS AuthorityPriority,
               ISNULL(f.AuthorityRank, d.AuthorityRank) AS AuthorityRank,
               f.ValidationStatus, f.MappingStatus, f.CreatedAt,
               d.FileName AS SourceFileName,
               d.AllowedUserGroups,
               d.IngestionStatus,
               r.SourceType AS AuthorityType
        FROM dbo.FinancialFacts f
        JOIN dbo.Documents d ON f.DocumentId = d.DocumentId
        LEFT JOIN dbo.Entities e ON f.EntityId = e.EntityId
        LEFT JOIN dbo.Metrics m ON f.MetricId = m.MetricId
        LEFT JOIN dbo.Periods p ON f.PeriodId = p.PeriodId
        LEFT JOIN dbo.SourceAuthorityRanks r ON d.AuthorityRank = r.AuthorityRank
        WHERE f.MappingStatus = 'Approved'
          AND ISNULL(d.ConflictHold, 0) = 0
          AND (d.IngestionStatus IN ('Succeeded', 'Completed', 'PartiallyApproved') OR d.IngestionStatus IS NULL)
    `;

    if (documentId) {
        const numId = Number(documentId);
        if (!isNaN(numId) && numId > 0) {
            query += ` AND f.DocumentId = ${numId}`;
        }
    }

    query += ' ORDER BY f.FactId ASC';
    const factsResult = await pool.request().query(query);
    let facts = factsResult.recordset;

    // Apply document ACL check if userGroups is provided
    if (userGroups && Array.isArray(userGroups)) {
        const cleanUserGroups = userGroups.map(g => String(g).trim().toLowerCase());
        facts = facts.filter(fact => {
            if (!fact.AllowedUserGroups) return true;
            const allowed = fact.AllowedUserGroups.split(',').map(g => g.trim().toLowerCase());
            return cleanUserGroups.some(ug => allowed.includes(ug)) || allowed.includes('*');
        });
    }

    // Retrieve active conflicts & conflict records (including Escalated conflicts awaiting admin decision)
    const conflictsResult = await pool.request().query(`
        SELECT c.ConflictId, c.ConflictStatus, c.ConflictDescription, c.ResolutionReason,
               c.SelectedFactId, cr.FactId, cr.FactRole
        FROM dbo.FactConflicts c
        LEFT JOIN dbo.FactConflictRecords cr ON c.ConflictId = cr.ConflictId
        WHERE c.ConflictStatus IN ('PendingApproval', 'PendingReview', 'Detected', 'Potential', 'Escalated')
    `);
    const conflictRecords = conflictsResult.recordset;

    return facts.map(fact => {
        const matchingConflict = conflictRecords.find(c => c.FactId === fact.FactId);
        if (matchingConflict) {
            return {
                ...fact,
                hasConflict: true,
                conflictId: matchingConflict.ConflictId,
                conflictStatus: matchingConflict.ConflictStatus,
                conflictExplanation: matchingConflict.ResolutionReason || matchingConflict.ConflictDescription,
                isAuthoritative: false // While conflict is pending, cannot be authoritative!
            };
        }
        return {
            ...fact,
            hasConflict: false,
            conflictStatus: null,
            conflictExplanation: null,
            isAuthoritative: true
        };
    });
}

module.exports = {
    detectFinancialFactConflicts,
    buildFactIdentityKey,
    areFactsIdenticalIdentity,
    detectAndResolveConflicts,
    getFactsWithConflictContext
};
