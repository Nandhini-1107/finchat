'use strict';

const { normalizeFinancialNumber } = require('../numeric-normalizer');

/**
 * Independent Evidence Validation Policy Engine (financial-validation-v1).
 * Implements 12 mandatory validation gates + source relationship integrity,
 * explicit structured check outcomes (PASS, FAIL, UNKNOWN, NOT_APPLICABLE),
 * standardized review reason codes, and centralized deterministic status decision.
 *
 * ValidationStatus is determined strictly by source evidence and gate outcomes,
 * never by confidence score, metric/entity registry approval, or document authority rank.
 */

const VALIDATION_POLICY_VERSION = 'financial-validation-v1';

const MANDATORY_GATE_NAMES = [
    'financialRelevance',
    'sourceEvidence',
    'numericIntegrity',
    'numericNormalization',
    'metricAssociation',
    'entityAssociation',
    'periodAssociation',
    'currencyAssociation',
    'unitAssociation',
    'scaleAssociation',
    'reportingBasis',
    'reportingScope',
    'sourceRelationship'
];

const VALID_BASES = new Set([
    'Actual', 'Budget', 'Forecast', 'Target', 'Requirement', 'Threshold', 'Estimate', 'Restated'
]);

const VALID_UNITS = new Set([
    'Amount', 'Currency', 'Percentage', 'Ratio', 'Count'
]);

const NON_FINANCIAL_METRIC_RE = /^(?:document\s+version|version|section|page|reference\s+number|ref\s*no|expected\s+facts?|expected\s+observations?|expected\s+testing\s+results|approval\s+date|establishment\s+year)$/i;
const INVALID_METRIC_FRAGMENT_RE = /^(?:in|for|and|to|from|during|of|with|the|at|by|we\s+also\s+paid|reported\s+revenue|in\s+FY\s*(?:20)?\d{2}\s*(?:and)?|FY\s*(?:20)?\d{2}|Q[1-4]|20\d{2})$/i;

function makeCheck(name, { mandatory = true, applicable = true, outcome, reasonCode = null, explanation, evidenceIds = [], sourceLocation = null, expected = null, actual = null }) {
    return {
        name,
        mandatory,
        applicable,
        outcome,
        reasonCode,
        explanation,
        evidenceIds,
        sourceLocation,
        expected,
        actual
    };
}

/**
 * Exact decimal comparison without floating-point inaccuracy.
 */
function exactDecimalsMatch(expectedDecimalStr, actualNumeric, actualExactDecimal) {
    if (expectedDecimalStr === null || expectedDecimalStr === undefined) return false;
    if (actualExactDecimal !== null && actualExactDecimal !== undefined) {
        const a = String(actualExactDecimal).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
        const b = String(expectedDecimalStr).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
        return a === b;
    }
    if (actualNumeric === null || actualNumeric === undefined || Number.isNaN(actualNumeric)) return false;
    const expNum = Number(expectedDecimalStr);
    if (Number.isNaN(expNum)) return false;
    return Math.abs(expNum - actualNumeric) <= 1e-9 * Math.max(1, Math.abs(expNum));
}

/**
 * Centralized Final Validation Decision Function (Section 9).
 * Deterministic and auditable:
 * - Rejected if confirmed NON_FINANCIAL or INVALID
 * - NeedsReview if any applicable mandatory check is not PASS, or checks are missing/malformed
 * - Validated only when all applicable mandatory checks PASS
 */
function determineValidationStatus(validationResult) {
    if (!validationResult || typeof validationResult !== 'object') {
        return 'NeedsReview';
    }

    const {
        candidateClassification,
        checks,
        classificationEvidence
    } = validationResult;

    const confirmedNonFinancial =
        candidateClassification === 'NON_FINANCIAL' &&
        classificationEvidence?.verified === true;

    const confirmedInvalid =
        candidateClassification === 'INVALID' &&
        classificationEvidence?.verified === true;

    if (confirmedNonFinancial || confirmedInvalid) {
        return 'Rejected';
    }

    if (
        candidateClassification !== 'FINANCIAL' &&
        candidateClassification !== 'OPERATIONAL'
    ) {
        return 'NeedsReview';
    }

    if (!Array.isArray(checks) || checks.length === 0) {
        return 'NeedsReview';
    }

    // Ensure every mandatory gate was executed
    const executedNames = new Set(checks.map(c => c.name));
    for (const gateName of MANDATORY_GATE_NAMES) {
        if (!executedNames.has(gateName)) {
            return 'NeedsReview';
        }
    }

    const requiredChecks = checks.filter(
        check => check.mandatory === true && check.applicable === true
    );

    if (requiredChecks.length === 0) {
        return 'NeedsReview';
    }

    const hasBlockingFailure = requiredChecks.some(
        check => check.outcome !== 'PASS'
    );

    if (hasBlockingFailure) {
        return 'NeedsReview';
    }

    return 'Validated';
}

/**
 * Computes evidence-based extraction confidence (Section 10).
 * Derived from check outcomes and evidence provenance; NEVER overrides ValidationStatus.
 */
function computeEvidenceConfidence(checks, fact) {
    const applicable = checks.filter(c => c.applicable);
    if (applicable.length === 0) return 0;

    const passCount = applicable.filter(c => c.outcome === 'PASS').length;
    const failCount = applicable.filter(c => c.outcome === 'FAIL').length;
    const unknownCount = applicable.filter(c => c.outcome === 'UNKNOWN').length;

    if (failCount > 0) {
        return Math.max(0.05, Number((0.40 - failCount * 0.12).toFixed(2)));
    }

    const inheritedCount = (fact.contextEvidenceIds || []).length;
    const inheritancePenalty = inheritedCount > 0 ? Math.min(0.06, inheritedCount * 0.015) : 0;
    const unknownPenalty = unknownCount * 0.14;
    const baseScore = (passCount / applicable.length) * 0.99;

    return Math.max(0.10, Math.min(0.99, Number((baseScore - inheritancePenalty - unknownPenalty).toFixed(2))));
}

function evaluateFactGates(fact, tableMap, paraMap) {
    const detailedChecks = [];
    const reviewReasons = new Set();
    const loc = fact.sourceLocation || fact.sourceLocationText || null;
    const evIds = fact.contextEvidenceIds || [];

    const metricTrimmed = fact.metric ? String(fact.metric).trim() : '';
    const rawStr = fact.rawValue !== null && fact.rawValue !== undefined ? String(fact.rawValue).trim() : '';

    // Gate 1: Financial relevance
    const isNonFinancialType = fact.candidateType === 'DocumentVersion' || fact.candidateType === 'NonFinancial';
    const isNonFinancialMetric = NON_FINANCIAL_METRIC_RE.test(metricTrimmed);
    const isRelevant = !isNonFinancialType && !isNonFinancialMetric;
    const candidateClassification = isRelevant
        ? (fact.unit === 'Count' ? 'OPERATIONAL' : 'FINANCIAL')
        : 'NON_FINANCIAL';

    detailedChecks.push(makeCheck('financialRelevance', {
        mandatory: true,
        applicable: true,
        outcome: isRelevant ? 'PASS' : 'FAIL',
        reasonCode: isRelevant ? null : 'NON_FINANCIAL_CANDIDATE',
        explanation: isRelevant
            ? 'Candidate represents a genuine financial or operational observation'
            : 'Candidate represents non-financial document metadata or identifier',
        evidenceIds: evIds,
        sourceLocation: loc,
        actual: fact.candidateType || fact.unit
    }));
    if (!isRelevant) reviewReasons.add('NON_FINANCIAL_CANDIDATE');

    // Gate 2: Original source evidence
    let sourceValid = false;
    let sourceExplanation = 'Missing source location or evidence';
    let sourceReason = 'SOURCE_EVIDENCE_MISSING';

    if (!loc) {
        sourceExplanation = 'Missing source location';
    } else if (fact.sourceType === 'Table') {
        const tbl = tableMap.get(fact.sourceTableId);
        if (!tbl) {
            sourceExplanation = `Source table ${fact.sourceTableId} not found`;
        } else {
            const localR = fact.sourceRow - (tbl.rowOffset || 0);
            const localC = fact.sourceColumn - (tbl.colOffset || 0);
            if (localR < 0 || localR >= tbl.grid.length || localC < 0 || localC >= (tbl.grid[localR]?.length || 0)) {
                sourceExplanation = `Table coordinates out of bounds (${fact.sourceRow}, ${fact.sourceColumn})`;
                sourceReason = 'SOURCE_EVIDENCE_INCOMPLETE';
            } else {
                const cellText = String(tbl.grid[localR][localC] ?? '').trim();
                if (cellText.includes(rawStr) || rawStr.includes(cellText)) {
                    sourceValid = true;
                    sourceExplanation = 'Table cell coordinates and raw content verified';
                    sourceReason = null;
                } else {
                    sourceExplanation = `Cell content mismatch: expected "${rawStr}", found "${cellText}"`;
                    sourceReason = 'SOURCE_EVIDENCE_INCOMPLETE';
                }
            }
        }
    } else if (fact.sourceType === 'Paragraph') {
        const para = paraMap.get(fact.sourceBlockId);
        if (!para) {
            sourceExplanation = `Source paragraph ${fact.sourceBlockId} not found`;
        } else if (!rawStr || !para.content.includes(rawStr)) {
            sourceExplanation = `Raw value "${rawStr}" not verified in source paragraph`;
            sourceReason = 'SOURCE_EVIDENCE_INCOMPLETE';
        } else {
            sourceValid = true;
            sourceExplanation = 'Paragraph source block and raw token verified';
            sourceReason = null;
        }
    } else if (fact.sourceEvidence && rawStr && String(fact.sourceEvidence).includes(rawStr)) {
        sourceValid = true;
        sourceExplanation = 'Source evidence text verified';
        sourceReason = null;
    }

    detailedChecks.push(makeCheck('sourceEvidence', {
        mandatory: true,
        applicable: true,
        outcome: sourceValid ? 'PASS' : 'FAIL',
        reasonCode: sourceReason,
        explanation: sourceExplanation,
        evidenceIds: evIds,
        sourceLocation: loc,
        actual: rawStr
    }));
    if (!sourceValid) reviewReasons.add(sourceReason);

    // Gate 3: Numeric token integrity
    const hasRawToken = rawStr.length > 0;
    const looksMerged = /\d{4,}[A-Za-z]+\d{4,}/.test(rawStr) || /\d+\.\d+\.\d+/.test(rawStr);
    const hasNumericChars = /[\d\u0660-\u0669]/.test(rawStr);
    const tokenIntact = hasRawToken && hasNumericChars && !looksMerged;

    let tokenReason = null;
    if (!hasRawToken || !hasNumericChars) tokenReason = 'NUMERIC_TOKEN_CORRUPTED';
    else if (looksMerged) tokenReason = 'NUMERIC_TOKEN_MERGED';

    detailedChecks.push(makeCheck('numericIntegrity', {
        mandatory: true,
        applicable: true,
        outcome: tokenIntact ? 'PASS' : 'FAIL',
        reasonCode: tokenReason,
        explanation: tokenIntact
            ? 'Source numeric token is independent and structurally intact'
            : `Source numeric token is invalid or corrupted: "${rawStr}"`,
        evidenceIds: evIds,
        sourceLocation: loc,
        actual: rawStr
    }));
    if (!tokenIntact) reviewReasons.add(tokenReason);

    // Gate 4: Exact numeric normalization
    const effScale = fact.scaleMultiplier || 1;
    const recalc = normalizeFinancialNumber(rawStr, effScale);
    const normValid =
        fact.numericValue !== null &&
        fact.numericValue !== undefined &&
        !Number.isNaN(fact.numericValue) &&
        !recalc.isMissing &&
        exactDecimalsMatch(recalc.exactDecimal, fact.numericValue, fact.exactDecimal);

    detailedChecks.push(makeCheck('numericNormalization', {
        mandatory: true,
        applicable: true,
        outcome: normValid ? 'PASS' : 'FAIL',
        reasonCode: normValid ? null : 'NUMERIC_NORMALIZATION_MISMATCH',
        explanation: normValid
            ? 'Normalized decimal value matches independent exact recalculation'
            : `Normalization mismatch: expected ${recalc.exactDecimal}, got ${fact.numericValue}`,
        evidenceIds: evIds,
        sourceLocation: loc,
        expected: recalc.exactDecimal,
        actual: fact.exactDecimal || String(fact.numericValue)
    }));
    if (!normValid) reviewReasons.add('NUMERIC_NORMALIZATION_MISMATCH');

    // Gate 5: Metric relationship
    const hasMetric = metricTrimmed.length > 0 && /[A-Za-z\u0600-\u06FF]{2,}/.test(metricTrimmed);
    const isInvalidMetricPhrase = INVALID_METRIC_FRAGMENT_RE.test(metricTrimmed) || NON_FINANCIAL_METRIC_RE.test(metricTrimmed);
    const metricValid = hasMetric && !isInvalidMetricPhrase;
    const metricReason = !hasMetric ? 'METRIC_MISSING' : (isInvalidMetricPhrase ? 'METRIC_PHRASE_INCOMPLETE' : null);

    detailedChecks.push(makeCheck('metricAssociation', {
        mandatory: true,
        applicable: true,
        outcome: metricValid ? 'PASS' : 'FAIL',
        reasonCode: metricReason,
        explanation: metricValid
            ? `Metric "${metricTrimmed}" is a valid financial or operational label`
            : `Invalid or missing metric label: "${metricTrimmed}"`,
        evidenceIds: evIds,
        sourceLocation: loc,
        actual: metricTrimmed
    }));
    if (!metricValid) reviewReasons.add(metricReason);

    // Gate 6: Entity association
    const entityStr = fact.entity ? String(fact.entity).trim() : '';
    const isUnknownEntityPlaceholder = /^(unknown|unspecified|n\/a|\?)$/i.test(entityStr);
    const isDuplicatedEntity = entityStr.length > 6 && /^(.{3,})\s+\1$/i.test(entityStr);
    const entityValid = entityStr.length > 0 && !isUnknownEntityPlaceholder && !isDuplicatedEntity;
    let entityOutcome = 'PASS';
    let entityReason = null;

    if (!entityStr || isUnknownEntityPlaceholder) {
        entityOutcome = 'UNKNOWN';
        entityReason = 'ENTITY_MISSING';
    } else if (isDuplicatedEntity) {
        entityOutcome = 'FAIL';
        entityReason = 'ENTITY_TEXT_CORRUPTED';
    }

    detailedChecks.push(makeCheck('entityAssociation', {
        mandatory: true,
        applicable: true,
        outcome: entityOutcome,
        reasonCode: entityReason,
        explanation: entityValid
            ? `Entity "${entityStr}" is supported by document or local context`
            : `Reporting entity could not be reliably resolved (${entityReason})`,
        evidenceIds: evIds,
        sourceLocation: loc,
        actual: entityStr || null
    }));
    if (!entityValid) reviewReasons.add(entityReason);

    // Gate 7: Reporting period / date
    const periodStr = fact.periodLabel ? String(fact.periodLabel).trim() : '';
    const isPeriodPlaceholder = /^(unknown|unspecified|not specified|n\/a|\?)$/i.test(periodStr);
    const hasAsOfDate = Boolean(fact.asOfDate && String(fact.asOfDate).trim());
    const periodValid = (periodStr.length > 0 && !isPeriodPlaceholder) || hasAsOfDate;

    detailedChecks.push(makeCheck('periodAssociation', {
        mandatory: true,
        applicable: true,
        outcome: periodValid ? 'PASS' : 'UNKNOWN',
        reasonCode: periodValid ? null : 'PERIOD_MISSING',
        explanation: periodValid
            ? `Reporting period/date "${periodStr || fact.asOfDate}" resolved`
            : 'Reporting period or financial date is missing',
        evidenceIds: evIds,
        sourceLocation: loc,
        actual: periodStr || fact.asOfDate || null
    }));
    if (!periodValid) reviewReasons.add('PERIOD_MISSING');

    // Gate 8: Currency and unit
    const isNonMonetaryUnit = fact.unit === 'Percentage' || fact.unit === 'Ratio' || fact.unit === 'Count';
    const currStr = fact.currency ? String(fact.currency).trim() : '';
    let currOutcome = 'PASS';
    let currReason = null;
    let currApplicable = true;

    if (isNonMonetaryUnit) {
        if (currStr) {
            currOutcome = 'FAIL';
            currReason = 'UNIT_MISMATCH';
        } else {
            currOutcome = 'NOT_APPLICABLE';
            currApplicable = false;
        }
    } else if (!currStr) {
        currOutcome = 'UNKNOWN';
        currReason = 'CURRENCY_MISSING';
    }

    detailedChecks.push(makeCheck('currencyAssociation', {
        mandatory: true,
        applicable: currApplicable,
        outcome: currOutcome,
        reasonCode: currReason,
        explanation: currOutcome === 'NOT_APPLICABLE'
            ? `Currency is not applicable for ${fact.unit} observations`
            : (currOutcome === 'PASS'
                ? `Currency "${currStr}" is supported by source evidence`
                : 'Currency is missing for monetary observation'),
        evidenceIds: evIds,
        sourceLocation: loc,
        actual: currStr || null
    }));
    if (currReason) reviewReasons.add(currReason);

    // Gate 9 (Unit check): Unit classification
    const unitValid = Boolean(fact.unit && VALID_UNITS.has(fact.unit));
    detailedChecks.push(makeCheck('unitAssociation', {
        mandatory: true,
        applicable: true,
        outcome: unitValid ? 'PASS' : 'FAIL',
        reasonCode: unitValid ? null : 'UNIT_MISMATCH',
        explanation: unitValid
            ? `Measurement unit "${fact.unit}" is valid`
            : `Unsupported or missing unit "${fact.unit}"`,
        evidenceIds: evIds,
        sourceLocation: loc,
        actual: fact.unit || null
    }));
    if (!unitValid) reviewReasons.add('UNIT_MISMATCH');

    // Gate 10 (Scale multiplier): Scale check
    const scaleVal = fact.scaleMultiplier !== undefined && fact.scaleMultiplier !== null ? Number(fact.scaleMultiplier) : 1;
    let scaleOutcome = 'PASS';
    let scaleApplicable = true;
    let scaleReason = null;

    if (isNonMonetaryUnit && scaleVal > 1) {
        scaleOutcome = 'FAIL';
        scaleReason = 'SCALE_MISMATCH';
    } else if (scaleVal === 1) {
        scaleOutcome = 'NOT_APPLICABLE';
        scaleApplicable = false;
    }

    detailedChecks.push(makeCheck('scaleAssociation', {
        mandatory: true,
        applicable: scaleApplicable,
        outcome: scaleOutcome,
        reasonCode: scaleReason,
        explanation: scaleOutcome === 'NOT_APPLICABLE'
            ? 'Unscaled actual unit (scaleMultiplier = 1)'
            : (scaleOutcome === 'PASS'
                ? `Scale multiplier ${scaleVal} verified against source evidence`
                : `Monetary scale multiplier ${scaleVal} improperly applied to ${fact.unit}`),
        evidenceIds: evIds,
        sourceLocation: loc,
        actual: String(scaleVal)
    }));
    if (scaleReason) reviewReasons.add(scaleReason);

    // Gate 11 (Reporting basis)
    const basisStr = fact.reportingBasis ? String(fact.reportingBasis).trim() : '';
    const basisValid = Boolean(basisStr && VALID_BASES.has(basisStr));
    detailedChecks.push(makeCheck('reportingBasis', {
        mandatory: true,
        applicable: true,
        outcome: basisValid ? 'PASS' : 'UNKNOWN',
        reasonCode: basisValid ? null : 'REPORTING_BASIS_AMBIGUOUS',
        explanation: basisValid
            ? `Reporting basis "${basisStr}" is resolved`
            : `Reporting basis is ambiguous or unresolved: "${basisStr}"`,
        evidenceIds: evIds,
        sourceLocation: loc,
        actual: basisStr || null
    }));
    if (!basisValid) reviewReasons.add('REPORTING_BASIS_AMBIGUOUS');

    // Gate 12 (Reporting scope & dimensions)
    const scopeStr = fact.reportingScope ? String(fact.reportingScope).trim() : '';
    const scopeApplicable = Boolean(scopeStr);
    detailedChecks.push(makeCheck('reportingScope', {
        mandatory: false,
        applicable: scopeApplicable,
        outcome: scopeApplicable ? 'PASS' : 'NOT_APPLICABLE',
        reasonCode: null,
        explanation: scopeApplicable
            ? `Reporting scope "${scopeStr}" is supported`
            : 'Optional reporting scope not specified by source',
        evidenceIds: evIds,
        sourceLocation: loc,
        actual: scopeStr || null
    }));

    // Gate 13 (Relationship integrity)
    const relValid = sourceValid && metricValid && tokenIntact;
    const relReason = relValid
        ? null
        : (fact.sourceType === 'Table' ? 'HEADER_RELATIONSHIP_INVALID' : 'NARRATIVE_RELATIONSHIP_INVALID');

    detailedChecks.push(makeCheck('sourceRelationship', {
        mandatory: true,
        applicable: true,
        outcome: relValid ? 'PASS' : 'FAIL',
        reasonCode: relReason,
        explanation: relValid
            ? `${fact.sourceType || 'Source'} structural relationship coherently links metric and value`
            : `Source relationship integrity failed for ${fact.sourceType || 'candidate'}`,
        evidenceIds: evIds,
        sourceLocation: loc,
        actual: loc
    }));
    if (!relValid) reviewReasons.add(relReason);

    // Include any pre-existing numeric precision warnings from upstream
    for (const r of (fact.reviewReasons || [])) {
        if (/precision/i.test(r)) {
            reviewReasons.add('SQL_PRECISION_MISMATCH');
        }
    }

    const checksMap = {};
    for (const c of detailedChecks) {
        checksMap[c.name] = c.outcome;
    }

    const validationInput = {
        candidateClassification,
        classificationEvidence: { verified: !isRelevant },
        checks: detailedChecks
    };

    const status = determineValidationStatus(validationInput);
    const confidence = computeEvidenceConfidence(detailedChecks, fact);
    const reasonsArray = [...reviewReasons];

    return {
        validation: {
            policyVersion: VALIDATION_POLICY_VERSION,
            status,
            checks: checksMap,
            detailedChecks,
            reviewReasons: reasonsArray
        },
        validationStatus: status,
        reviewReasons: reasonsArray,
        extractionConfidence: confidence
    };
}

function validateEvidence({ facts = [], layout = {} }) {
    const tableMap = new Map((layout.tables || []).map(t => [t.tableId, t]));
    const paraMap = new Map((layout.paragraphs || []).map(p => [p.blockId, p]));

    const validatedFacts = [];

    for (const fact of facts) {
        try {
            const evalRes = evaluateFactGates(fact, tableMap, paraMap);
            validatedFacts.push({
                ...fact,
                validation: evalRes.validation,
                validationStatus: evalRes.validationStatus,
                reviewReasons: evalRes.reviewReasons,
                extractionConfidence: evalRes.extractionConfidence
            });
        } catch (err) {
            const failReasons = ['VALIDATION_EXECUTION_FAILED'];
            validatedFacts.push({
                ...fact,
                validation: {
                    policyVersion: VALIDATION_POLICY_VERSION,
                    status: 'NeedsReview',
                    checks: {},
                    detailedChecks: [],
                    reviewReasons: failReasons,
                    error: err.message
                },
                validationStatus: 'NeedsReview',
                reviewReasons: failReasons,
                extractionConfidence: 0.0
            });
        }
    }

    return { facts: validatedFacts };
}

module.exports = {
    validateEvidence,
    determineValidationStatus,
    evaluateFactGates,
    VALIDATION_POLICY_VERSION,
    MANDATORY_GATE_NAMES
};
