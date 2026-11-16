// contracts/extracted-facts.js
// Purpose: Contract constants, logical identity generator, and envelope adapter
// for ExtractedFactsV1.

const crypto = require('crypto');

const CONTRACT_VERSION = 'ExtractedFactsV1';
const IDENTITY_KEY_VERSION = 'v1.2';

/**
 * Normalizes an identity string token (trims, collapses whitespace, lowercase)
 */
function normalizeToken(val) {
    if (val === null || val === undefined) return 'unknown';
    const s = String(val).trim().toLowerCase().replace(/\s+/g, ' ');
    return s.length > 0 ? s : 'unknown';
}

/**
 * Deterministic generation of logical identity according to ExtractedFactsV1 v1.2 spec
 */
function generateLogicalIdentity(fact) {
    const entity = fact.entityLabel || fact.entity || null;
    const metric = fact.metricLabel || fact.metric || null;
    const period = fact.periodLabel || fact.period || null;
    const temporalType = fact.temporalType || (fact.asOfDate && !fact.periodStart ? 'instant' : 'duration');
    const reportingBasis = fact.reportingBasis || 'Unknown';
    const reportingScope = fact.reportingScope || 'Entity';
    const normalizedUnit = fact.normalizedUnit || fact.unit || 'amount';
    const currency = (normalizedUnit === 'amount') ? (fact.currency || null) : null;
    const dimensions = fact.dimensions && typeof fact.dimensions === 'object' ? fact.dimensions : {};

    // 1. Build canonical key string components
    const parts = [
        `entity=${normalizeToken(entity)}`,
        `metric=${normalizeToken(metric)}`,
        `period=${normalizeToken(period)}`,
        `type=${normalizeToken(temporalType)}`,
        `basis=${normalizeToken(reportingBasis)}`,
        `scope=${normalizeToken(reportingScope)}`,
        `unit=${normalizeToken(normalizedUnit)}`
    ];

    if (normalizedUnit === 'amount') {
        parts.push(`curr=${normalizeToken(currency)}`);
    }

    // Sort dimension keys alphabetically for deterministic stability
    const dimKeys = Object.keys(dimensions).sort();
    dimKeys.forEach(k => {
        parts.push(`${normalizeToken(k)}=${normalizeToken(dimensions[k])}`);
    });

    const keyString = parts.join('|');
    const keyHash = crypto.createHash('sha256').update(keyString, 'utf8').digest('hex');

    // 2. Determine completeness
    let completeness = 'complete';
    const isMonetary = normalizedUnit === 'amount';

    if (!entity || !metric || !period || (isMonetary && !currency)) {
        const missingCount = (!entity ? 1 : 0) + (!metric ? 1 : 0) + (!period ? 1 : 0) + ((isMonetary && !currency) ? 1 : 0);
        if (missingCount >= 2) {
            completeness = 'sparse';
        } else {
            completeness = 'partial';
        }
    }

    // 3. Determine conflict comparability gate
    // Essential fields: entity != null, metric != null, period != null, basis != 'Unknown', unit != null, and if monetary: currency != null
    const isComparableForConflict = Boolean(
        entity && entity.trim().length > 0 &&
        metric && metric.trim().length > 0 &&
        period && period.trim().length > 0 &&
        reportingBasis && reportingBasis !== 'Unknown' &&
        normalizedUnit &&
        (!isMonetary || (currency && currency.trim().length > 0))
    );

    return {
        identityKeyVersion: IDENTITY_KEY_VERSION,
        keyString,
        keyHash,
        completeness,
        isComparableForConflict,
        components: {
            entity,
            metric,
            period,
            temporalType,
            reportingBasis,
            reportingScope,
            normalizedUnit,
            currency,
            dimensions
        }
    };
}

/**
 * Adapts an array of raw expected-facts and document context into a complete
 * ExtractedFactsV1 runtime envelope for contract validation.
 */
function serializeExpectedFactsToContractEnvelope(docObj, expectedFacts, options = {}) {
    const docId = docObj.document?.documentId || docObj.document_id || 'doc-unknown';
    const fileName = docObj.document?.fileName || `${docId}.json`;
    const docDate = docObj.document?.metadata?.asOfDate || null;

    const facts = (expectedFacts || []).map((exp, idx) => {
        const factId = exp.factId || `${docId}_fact_${idx + 1}`;
        const logicalIdentity = generateLogicalIdentity(exp);

        const isError = exp.expectedValidationStatus === 'error' || exp.normalizedValue === null;
        const validationStatus = isError ? 'invalid' : 'valid';

        // Source evidence mapping
        const sourceEvidence = {
            documentId: docId,
            elementId: exp.sourceLocation?.match(/([A-Za-z0-9_-]+_[A-Za-z0-9_-]+)/)?.[1] || `${docId}_el_1`,
            elementType: exp.sourceLocation?.toLowerCase().includes('paragraph') ? 'paragraph' : 'table',
            tableId: exp.sourceLocation?.toLowerCase().includes('table') ? (exp.sourceLocation?.match(/Table\s+([A-Za-z0-9_-]+)/i)?.[1] || null) : null,
            pageNumber: exp.sourceLocation?.toLowerCase().includes('page') ? parseInt(exp.sourceLocation.match(/Page\s+(\d+)/i)?.[1] || '1', 10) : 1,
            sheetName: exp.sourceLocation?.toLowerCase().includes('sheet') ? (exp.sourceLocation.match(/Sheet:\s*([^;]+)/i)?.[1]?.trim() || null) : null,
            sourceFileName: exp.sourceFileName || fileName,
            originalCellValue: exp.rawValue,
            formattedValue: exp.originalTextValue,
            formula: exp.formula || null
        };

        return {
            factId,
            logicalIdentity,
            metricLabel: exp.metricLabel,
            canonicalMetricId: null,
            canonicalMetricName: null,
            entityLabel: exp.entityLabel,
            canonicalEntityId: null,
            canonicalEntityName: null,
            periodLabel: exp.periodLabel,
            canonicalPeriodId: null,
            periodType: exp.periodLabel?.startsWith('Q') ? 'Quarter' : (exp.periodLabel?.startsWith('FY') ? 'Annual' : 'Instant'),
            temporalType: exp.temporalType || 'duration',
            periodStart: exp.periodStart || null,
            periodEnd: exp.periodEnd || null,
            asOfDate: exp.asOfDate || null,
            documentPublicationDate: docDate,
            reportingBasis: exp.reportingBasis || 'Actual',
            auditStatus: exp.auditStatus || 'Audited',
            reportingScope: exp.reportingScope || 'Entity',
            dimensions: exp.dimensions || {},
            rawValue: exp.rawValue,
            originalTextValue: exp.originalTextValue,
            normalizedValue: exp.normalizedValue,
            numericValue: exp.normalizedValue !== null ? Number(exp.normalizedValue) : null,
            originalUnit: exp.originalUnit,
            normalizedUnit: exp.normalizedUnit,
            scale: exp.scale || null,
            currency: exp.currency || null,
            factCategory: 'ProfitLoss',
            extractionMethod: sourceEvidence.elementType === 'paragraph' ? 'deterministic_paragraph' : 'deterministic_table',
            extractionStatus: 'success',
            validationStatus,
            mappingStatus: 'approved',
            conflictStatus: 'clean',
            confidence: 1.0,
            sourceEvidence
        };
    });

    // Compute validation summary obeying mutual exclusion invariant
    const totalFactsCount = facts.length;
    const validFactsCount = facts.filter(f => f.validationStatus === 'valid').length;
    const invalidFactsCount = facts.filter(f => f.validationStatus === 'invalid').length;

    const validationSummary = {
        totalFactsCount,
        validFactsCount,
        suspectFactsCount: 0,
        unvalidatedFactsCount: 0,
        calculationMismatchCount: 0,
        outOfRangeCount: 0,
        invalidFactsCount,
        pendingMappingCount: 0,
        unmappedCount: 0,
        conflictsDetectedCount: 0,
        warnings: []
    };

    return {
        contractVersion: CONTRACT_VERSION,
        documentId: docId,
        extractionMetadata: {
            extractedAt: options.extractedAt || new Date().toISOString(),
            engineVersion: options.engineVersion || '1.0.0-golden',
            sourceFileName: fileName,
            documentPublicationDate: docDate,
            totalFactsCount,
            tableFactsCount: facts.filter(f => f.sourceEvidence.elementType === 'table').length,
            paragraphFactsCount: facts.filter(f => f.sourceEvidence.elementType === 'paragraph').length,
            llmFallbackFactsCount: 0,
            processingTimeMs: 15.5
        },
        facts,
        validationSummary
    };
}

module.exports = {
    CONTRACT_VERSION,
    IDENTITY_KEY_VERSION,
    generateLogicalIdentity,
    serializeExpectedFactsToContractEnvelope
};

