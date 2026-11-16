// src/services/extracted-facts-validator.js
// Purpose: Runtime validation for ExtractedFactsV1 contract envelopes.
// Enforces structural integrity, identity hash consistency, mutual exclusion sum invariants,
// and precision-safe values without modifying input objects.

const crypto = require('crypto');
const { CONTRACT_VERSION, IDENTITY_KEY_VERSION } = require('../../contracts/extracted-facts');

/**
 * Validates a complete ExtractedFactsV1 runtime envelope.
 * 
 * @param {object} envelope - The extracted facts envelope to validate.
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
function validateExtractedFactsEnvelope(envelope) {
    const errors = [];
    const warnings = [];

    // 1. Root-level checks
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
        return {
            valid: false,
            errors: ['ExtractedFactsV1 envelope must be a non-null object.'],
            warnings: []
        };
    }

    if (envelope.contractVersion !== CONTRACT_VERSION) {
        errors.push(`Invalid or missing contractVersion: expected "${CONTRACT_VERSION}", got "${envelope.contractVersion}".`);
    }

    const docId = envelope.documentId;
    if (!docId || typeof docId !== 'string' || docId.trim().length === 0) {
        errors.push('Root "documentId" is required and must be a non-empty string.');
    }

    // 2. Extraction Metadata
    const meta = envelope.extractionMetadata;
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
        errors.push('Root "extractionMetadata" is required and must be an object.');
    } else {
        if (!meta.extractedAt || typeof meta.extractedAt !== 'string') {
            errors.push('extractionMetadata.extractedAt is required.');
        }
        if (!meta.engineVersion || typeof meta.engineVersion !== 'string') {
            errors.push('extractionMetadata.engineVersion is required.');
        }
    }

    // 3. Facts Array
    const facts = envelope.facts;
    if (!Array.isArray(facts)) {
        errors.push('Root "facts" property is required and must be an array.');
        return { valid: false, errors, warnings };
    }

    // 4. Validation Summary
    const summary = envelope.validationSummary;
    if (!summary || typeof summary !== 'object' || Array.isArray(summary)) {
        errors.push('Root "validationSummary" is required and must be an object.');
    } else {
        if (summary.totalFactsCount !== facts.length) {
            errors.push(`validationSummary.totalFactsCount (${summary.totalFactsCount}) does not match facts.length (${facts.length}).`);
        }

        // Check mutual exclusion sum rule
        const sumStatuses = (summary.validFactsCount || 0) +
                            (summary.suspectFactsCount || 0) +
                            (summary.unvalidatedFactsCount || 0) +
                            (summary.calculationMismatchCount || 0) +
                            (summary.outOfRangeCount || 0) +
                            (summary.invalidFactsCount || 0);

        if (sumStatuses !== summary.totalFactsCount) {
            errors.push(`Validation status counts sum (${sumStatuses}) does not equal totalFactsCount (${summary.totalFactsCount}). Must be mutually exclusive.`);
        }
    }

    // 5. Inspect individual facts
    const seenFactIds = new Set();

    facts.forEach((fact, index) => {
        const path = `facts[${index}]`;

        if (!fact || typeof fact !== 'object' || Array.isArray(fact)) {
            errors.push(`${path}: must be an object.`);
            return;
        }

        // factId
        if (!fact.factId || typeof fact.factId !== 'string' || fact.factId.trim().length === 0) {
            errors.push(`${path}: factId is required and must be a non-empty string.`);
        } else {
            if (seenFactIds.has(fact.factId)) {
                errors.push(`${path}: duplicate factId "${fact.factId}".`);
            }
            seenFactIds.add(fact.factId);
        }

        // logicalIdentity
        const li = fact.logicalIdentity;
        if (!li || typeof li !== 'object' || Array.isArray(li)) {
            errors.push(`${path}: logicalIdentity is required and must be an object.`);
        } else {
            if (li.identityKeyVersion !== IDENTITY_KEY_VERSION) {
                errors.push(`${path}.logicalIdentity.identityKeyVersion: expected "${IDENTITY_KEY_VERSION}", got "${li.identityKeyVersion}".`);
            }
            if (!li.keyString || typeof li.keyString !== 'string') {
                errors.push(`${path}.logicalIdentity.keyString: is required.`);
            } else {
                // Verify SHA-256 hash
                const expectedHash = crypto.createHash('sha256').update(li.keyString, 'utf8').digest('hex');
                if (li.keyHash !== expectedHash) {
                    errors.push(`${path}.logicalIdentity.keyHash mismatch: expected "${expectedHash}", got "${li.keyHash}".`);
                }
            }
            if (!['complete', 'partial', 'sparse'].includes(li.completeness)) {
                errors.push(`${path}.logicalIdentity.completeness: must be complete, partial, or sparse.`);
            }
            if (typeof li.isComparableForConflict !== 'boolean') {
                errors.push(`${path}.logicalIdentity.isComparableForConflict: must be boolean.`);
            }
        }

        // rawValue & normalizedValue
        if (!('rawValue' in fact)) {
            errors.push(`${path}: rawValue is required.`);
        }

        if (fact.normalizedValue !== null && fact.normalizedValue !== undefined) {
            if (typeof fact.normalizedValue !== 'string') {
                errors.push(`${path}.normalizedValue: must be string or null, got ${typeof fact.normalizedValue}.`);
            } else if (!/^-?\d+\.\d{8}$/.test(fact.normalizedValue)) {
                errors.push(`${path}.normalizedValue: string must be formatted to exact 8 decimal places: "${fact.normalizedValue}".`);
            }
        }

        // Temporal semantics
        if (fact.temporalType && !['duration', 'instant', 'unknown'].includes(fact.temporalType)) {
            errors.push(`${path}.temporalType: invalid temporalType "${fact.temporalType}".`);
        }
        if (fact.temporalType === 'duration') {
            if (fact.periodStart && !/^\d{4}-\d{2}-\d{2}$/.test(fact.periodStart)) {
                errors.push(`${path}.periodStart: must be YYYY-MM-DD.`);
            }
            if (fact.periodEnd && !/^\d{4}-\d{2}-\d{2}$/.test(fact.periodEnd)) {
                errors.push(`${path}.periodEnd: must be YYYY-MM-DD.`);
            }
        }
        if (fact.temporalType === 'instant') {
            if (fact.asOfDate && !/^\d{4}-\d{2}-\d{2}$/.test(fact.asOfDate)) {
                errors.push(`${path}.asOfDate: must be YYYY-MM-DD.`);
            }
        }

        // Unit and conditional currency
        const unit = fact.normalizedUnit;
        if (unit === 'amount') {
            if (!fact.currency && fact.logicalIdentity?.isComparableForConflict) {
                errors.push(`${path}: monetary amount missing currency cannot be comparable for conflict.`);
            }
        } else if (['ratio', 'headcount', 'count', 'shares'].includes(unit)) {
            if (fact.currency !== null && fact.currency !== undefined) {
                warnings.push(`${path}: non-monetary unit "${unit}" has unnecessary currency "${fact.currency}".`);
            }
        }

        // sourceEvidence
        const se = fact.sourceEvidence;
        if (!se || typeof se !== 'object' || Array.isArray(se)) {
            errors.push(`${path}: sourceEvidence is required and must be an object.`);
        } else {
            if (!se.documentId || (docId && se.documentId !== docId)) {
                errors.push(`${path}.sourceEvidence.documentId: must match envelope documentId "${docId}".`);
            }
            if (!se.elementId) {
                errors.push(`${path}.sourceEvidence.elementId: is required.`);
            }
            if (!['table', 'paragraph'].includes(se.elementType)) {
                errors.push(`${path}.sourceEvidence.elementType: must be 'table' or 'paragraph'.`);
            }
        }

        // Execution status fields
        if (!fact.extractionMethod) errors.push(`${path}: extractionMethod is required.`);
        if (!fact.validationStatus) errors.push(`${path}: validationStatus is required.`);
        if (!fact.mappingStatus) errors.push(`${path}: mappingStatus is required.`);
        if (!fact.conflictStatus) errors.push(`${path}: conflictStatus is required.`);
        if (typeof fact.confidence !== 'number') errors.push(`${path}: confidence must be a number.`);
    });

    return {
        valid: errors.length === 0,
        errors,
        warnings
    };
}

module.exports = {
    validateExtractedFactsEnvelope
};

