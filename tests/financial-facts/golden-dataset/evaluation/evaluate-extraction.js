// tests/financial-facts/golden-dataset/evaluation/evaluate-extraction.js
// Purpose: Automated evaluation engine measuring financial fact extraction against
// the synthetic golden dataset. Supports both historical Phase 4.2.2 baseline preservation
// and Phase 4.2.4 strict 8-coordinate business identity evaluation with dual accuracy reporting.

const fs = require('fs');
const path = require('path');
const factExtraction = require('../../../../src/services/fact-extraction');

const baseDir = path.resolve('d:/finchat/tests/financial-facts/golden-dataset');
const docsDir = path.join(baseDir, 'documents');
const fixturesDir = path.join(baseDir, 'fixtures');
const expectedDir = path.join(baseDir, 'expected-facts');

const baselineReportPath = path.join(baseDir, 'evaluation', 'baseline-evaluation-report.json');
const revisedReportPath = path.join(baseDir, 'evaluation', 'revised-evaluation-report.v2.json');

/**
 * Normalizes a metric string for fuzzy matching
 */
function normalizeMetric(m) {
    if (!m) return '';
    return String(m)
        .toLowerCase()
        .replace(/[^a-z0-9\u0621-\u064A]/gi, '')
        .trim();
}

/**
 * Normalizes an entity string for matching
 */
function normalizeEntity(e) {
    if (!e) return null;
    const s = String(e).trim().toLowerCase();
    return s.length > 0 ? s : null;
}

/**
 * Checks if two numeric values match within precision tolerance
 */
function numbersMatch(valA, valB) {
    if (valA === null || valA === undefined || valB === null || valB === undefined) {
        return valA === valB;
    }
    const numA = Number(valA);
    const numB = Number(valB);
    if (isNaN(numA) || isNaN(numB)) {
        return String(valA).trim() === String(valB).trim();
    }
    return Math.abs(numA - numB) < 0.0001;
}

/**
 * Compares arbitrary dimension maps for equality
 */
function dimensionsMatch(dimA, dimB) {
    const objA = dimA && typeof dimA === 'object' ? dimA : {};
    const objB = dimB && typeof dimB === 'object' ? dimB : {};
    const keysA = Object.keys(objA).filter(k => objA[k] != null);
    const keysB = Object.keys(objB).filter(k => objB[k] != null);

    if (keysA.length === 0 && keysB.length === 0) return true;
    if (keysA.length !== keysB.length) return false;

    return keysA.every(k => {
        const valA = String(objA[k]).trim().toLowerCase();
        const valB = String(objB[k] || '').trim().toLowerCase();
        return valA === valB;
    });
}

/**
 * Evaluates a document under Mode 1: Historical Phase 4.2.2 Baseline (Relaxed Identity Match)
 */
function evaluateDocumentBaselineV1(docObj, expectedFacts, docName) {
    const extractedFacts = factExtraction.extractFinancialFacts(docObj);
    const docId = docObj.document?.documentId || docObj.document_id || docName;
    const isFixture = docName.startsWith('fixture-');

    const matchedPairs = [];
    const unmatchedExpected = [];
    const unmatchedExtracted = [];

    const usedExtracted = new Set();
    const usedExpected = new Set();

    for (let eIdx = 0; eIdx < expectedFacts.length; eIdx++) {
        const exp = expectedFacts[eIdx];
        const expMetricNorm = normalizeMetric(exp.metricLabel);
        const expPeriod = String(exp.periodLabel || '').toLowerCase();

        let bestMatchIdx = -1;
        let bestScore = -1;

        for (let xIdx = 0; xIdx < extractedFacts.length; xIdx++) {
            if (usedExtracted.has(xIdx)) continue;
            const ext = extractedFacts[xIdx];
            const extMetricNorm = normalizeMetric(ext.metric || ext.originalLabel);
            const extPeriod = String(ext.periodLabel || '').toLowerCase();

            const metricMatches = (expMetricNorm === extMetricNorm) ||
                                  (expMetricNorm.includes(extMetricNorm) && extMetricNorm.length > 3) ||
                                  (extMetricNorm.includes(expMetricNorm) && expMetricNorm.length > 3);

            if (!metricMatches) continue;

            let score = 1;
            if (expPeriod && extPeriod && (expPeriod === extPeriod || extPeriod.includes(expPeriod) || expPeriod.includes(extPeriod))) {
                score += 2;
            }
            if (numbersMatch(ext.normalizedValue, exp.normalizedValue) || numbersMatch(ext.originalValue, exp.rawValue)) {
                score += 4;
            }
            if (ext.entity && exp.entityLabel && ext.entity.toLowerCase() === exp.entityLabel.toLowerCase()) {
                score += 2;
            }

            if (score > bestScore) {
                bestScore = score;
                bestMatchIdx = xIdx;
            }
        }

        if (bestMatchIdx !== -1 && bestScore >= 1) {
            usedExtracted.add(bestMatchIdx);
            usedExpected.add(eIdx);

            const ext = extractedFacts[bestMatchIdx];
            const fieldMatches = {
                metric: (normalizeMetric(ext.metric) === normalizeMetric(exp.metricLabel)),
                entity: Boolean(exp.entityLabel && ext.entity && ext.entity.toLowerCase() === exp.entityLabel.toLowerCase()) || (exp.entityLabel === null && ext.entity === null),
                period: Boolean(exp.periodLabel && ext.periodLabel && (ext.periodLabel.toLowerCase() === exp.periodLabel.toLowerCase() || ext.periodLabel.includes(exp.periodLabel))),
                value: numbersMatch(ext.normalizedValue, exp.normalizedValue),
                unit: Boolean(exp.normalizedUnit && ext.normalizedUnit && ext.normalizedUnit.toLowerCase() === exp.normalizedUnit.toLowerCase()),
                currency: Boolean(exp.currency && ext.currency && ext.currency.toUpperCase() === exp.currency.toUpperCase()) || (exp.currency === null && (ext.currency === null || ext.currency === undefined)),
                sourceLocation: Boolean(ext.sourceLocation && exp.sourceLocation && (
                    ext.sourceLocation.toLowerCase().includes('table') === exp.sourceLocation.toLowerCase().includes('table')
                ))
            };

            matchedPairs.push({
                extracted: ext,
                expected: exp,
                fieldMatches,
                score: bestScore
            });
        } else {
            unmatchedExpected.push(exp);
        }
    }

    for (let xIdx = 0; xIdx < extractedFacts.length; xIdx++) {
        if (!usedExtracted.has(xIdx)) {
            unmatchedExtracted.push(extractedFacts[xIdx]);
        }
    }

    const truePositives = matchedPairs.filter(p => p.fieldMatches.metric && (p.fieldMatches.value || p.fieldMatches.period));
    const weakMatches = matchedPairs.filter(p => !(p.fieldMatches.metric && (p.fieldMatches.value || p.fieldMatches.period)));

    const tpCount = truePositives.length;
    const fpCount = unmatchedExtracted.length + weakMatches.length;
    const fnCount = unmatchedExpected.length + weakMatches.length;

    const precision = (tpCount + fpCount > 0) ? tpCount / (tpCount + fpCount) : 0;
    const recall = (tpCount + fnCount > 0) ? tpCount / (tpCount + fnCount) : 0;
    const f1 = (precision + recall > 0) ? (2 * precision * recall) / (precision + recall) : 0;

    const fieldCounts = {
        totalEvaluated: matchedPairs.length,
        metricMatches: matchedPairs.filter(p => p.fieldMatches.metric).length,
        entityMatches: matchedPairs.filter(p => p.fieldMatches.entity).length,
        periodMatches: matchedPairs.filter(p => p.fieldMatches.period).length,
        valueMatches: matchedPairs.filter(p => p.fieldMatches.value).length,
        unitMatches: matchedPairs.filter(p => p.fieldMatches.unit).length,
        currencyMatches: matchedPairs.filter(p => p.fieldMatches.currency).length,
        locationMatches: matchedPairs.filter(p => p.fieldMatches.sourceLocation).length
    };

    return {
        documentId: docId,
        fileName: docName,
        isFixture,
        expectedCount: expectedFacts.length,
        extractedCount: extractedFacts.length,
        tpCount,
        fpCount,
        fnCount,
        precision: Number(precision.toFixed(4)),
        recall: Number(recall.toFixed(4)),
        f1: Number(f1.toFixed(4)),
        fieldCounts,
        matchedPairs,
        unmatchedExpected,
        unmatchedExtracted
    };
}

/**
 * Evaluates a document under Mode 2: Phase 4.2.4 Strict 8-Coordinate Business Identity Evaluation
 */
function evaluateDocumentStrictV2(docObj, expectedFacts, docName) {
    const extractedFacts = factExtraction.extractFinancialFacts(docObj);
    const docId = docObj.document?.documentId || docObj.document_id || docName;
    const isFixture = docName.startsWith('fixture-');

    // 1. Build candidate pairs using full business coordinate scoring
    const candidatePairs = [];

    expectedFacts.forEach((exp, eIdx) => {
        const expMetricNorm = normalizeMetric(exp.metricLabel);
        const expEntityNorm = normalizeEntity(exp.entityLabel);
        const expPeriod = String(exp.periodLabel || '').trim().toLowerCase();
        const expBasis = String(exp.reportingBasis || 'Actual').trim().toLowerCase();

        extractedFacts.forEach((ext, xIdx) => {
            const extMetricNorm = normalizeMetric(ext.metric || ext.originalLabel);
            const extEntityNorm = normalizeEntity(ext.entity);
            const extPeriod = String(ext.periodLabel || '').trim().toLowerCase();
            const extBasis = String(ext.reportingBasis || 'Actual').trim().toLowerCase();

            // Metric compatibility is an absolute gate
            const metricMatches = (expMetricNorm === extMetricNorm) ||
                                  (expMetricNorm.includes(extMetricNorm) && extMetricNorm.length > 3) ||
                                  (extMetricNorm.includes(expMetricNorm) && expMetricNorm.length > 3);

            if (!metricMatches) return;

            let score = 10; // Base score for metric alignment

            // Entity compatibility (weighted heavily so entities are never considered equivalent)
            const entityExact = (expEntityNorm === extEntityNorm);
            const entityBothNull = (expEntityNorm === null && extEntityNorm === null);
            if (entityExact || entityBothNull) {
                score += 20;
            }

            // Period compatibility
            if (expPeriod && extPeriod && (expPeriod === extPeriod || extPeriod.includes(expPeriod) || expPeriod.includes(extPeriod))) {
                score += 15;
            }

            // Reporting Basis compatibility (Actual vs Budget strictly non-equivalent)
            if (expBasis && extBasis && expBasis === extBasis) {
                score += 10;
            }

            // Dimensions compatibility
            if (dimensionsMatch(exp.dimensions, ext.dimensions)) {
                score += 5;
            }

            // Normalized Unit compatibility
            if (exp.normalizedUnit && ext.normalizedUnit && exp.normalizedUnit.toLowerCase() === ext.normalizedUnit.toLowerCase()) {
                score += 5;
            }

            // Currency compatibility
            const expCurr = exp.currency ? exp.currency.toUpperCase() : null;
            const extCurr = ext.currency ? ext.currency.toUpperCase() : null;
            if (expCurr === extCurr) {
                score += 5;
            }

            // Value bonus is small so numbers NEVER override business identity
            if (numbersMatch(ext.normalizedValue, exp.normalizedValue)) {
                score += 2;
            }

            candidatePairs.push({
                eIdx,
                xIdx,
                exp,
                ext,
                score,
                tieBreaker: `${exp.factId}::${xIdx}`
            });
        });
    });

    // 2. Deterministic Global Bipartite Pairing (Independent of array order)
    candidatePairs.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.tieBreaker.localeCompare(b.tieBreaker);
    });

    const usedExpected = new Set();
    const usedExtracted = new Set();
    const matchedPairs = [];

    candidatePairs.forEach(pair => {
        if (!usedExpected.has(pair.eIdx) && !usedExtracted.has(pair.xIdx)) {
            usedExpected.add(pair.eIdx);
            usedExtracted.add(pair.xIdx);

            const exp = pair.exp;
            const ext = pair.ext;

            const expEntityNorm = normalizeEntity(exp.entityLabel);
            const extEntityNorm = normalizeEntity(ext.entity);
            const expBasis = String(exp.reportingBasis || 'Actual').trim().toLowerCase();
            const extBasis = String(ext.reportingBasis || 'Actual').trim().toLowerCase();
            const expCurr = exp.currency ? exp.currency.toUpperCase() : null;
            const extCurr = ext.currency ? ext.currency.toUpperCase() : null;

            const fieldMatches = {
                metric: (normalizeMetric(ext.metric) === normalizeMetric(exp.metricLabel)),
                entity: (expEntityNorm === extEntityNorm) || (expEntityNorm === null && extEntityNorm === null),
                period: Boolean(exp.periodLabel && ext.periodLabel && (ext.periodLabel.toLowerCase() === exp.periodLabel.toLowerCase() || ext.periodLabel.includes(exp.periodLabel))),
                reportingBasis: expBasis === extBasis,
                temporalType: Boolean(exp.temporalType && ext.temporalType && exp.temporalType === ext.temporalType),
                dimensions: dimensionsMatch(exp.dimensions, ext.dimensions),
                unit: Boolean(exp.normalizedUnit && ext.normalizedUnit && exp.normalizedUnit.toLowerCase() === ext.normalizedUnit.toLowerCase()),
                currency: expCurr === extCurr,
                value: numbersMatch(ext.normalizedValue, exp.normalizedValue),
                sourceLocation: Boolean(ext.sourceLocation && exp.sourceLocation && (
                    ext.sourceLocation.toLowerCase().includes('table') === exp.sourceLocation.toLowerCase().includes('table')
                ))
            };

            // Strict Business Identity satisfies metric, entity, period, basis, unit, currency AND normalized value
            const isStrictTruePositive = fieldMatches.metric &&
                                         fieldMatches.entity &&
                                         fieldMatches.period &&
                                         fieldMatches.reportingBasis &&
                                         fieldMatches.unit &&
                                         fieldMatches.currency &&
                                         fieldMatches.value;

            // Weak match classification (matches metric/period, but has entity, value, or currency error)
            const failureCategories = [];
            if (!fieldMatches.entity) failureCategories.push('INCORRECT_ENTITY');
            if (!fieldMatches.value) failureCategories.push('INCORRECT_VALUE');
            if (!fieldMatches.period) failureCategories.push('INCORRECT_PERIOD');
            if (!fieldMatches.reportingBasis) failureCategories.push('INCORRECT_REPORTING_BASIS');
            if (!fieldMatches.dimensions) failureCategories.push('INCORRECT_DIMENSIONS');
            if (!fieldMatches.unit) failureCategories.push('INCORRECT_UNIT');
            if (!fieldMatches.currency) failureCategories.push('INCORRECT_CURRENCY');

            matchedPairs.push({
                extracted: ext,
                expected: exp,
                fieldMatches,
                score: pair.score,
                isStrictTruePositive,
                isWeakMatch: !isStrictTruePositive,
                failureCategories
            });
        }
    });

    // 3. Unmatched Facts
    const unmatchedExpected = [];
    expectedFacts.forEach((exp, idx) => {
        if (!usedExpected.has(idx)) unmatchedExpected.push(exp);
    });

    const unmatchedExtracted = [];
    extractedFacts.forEach((ext, idx) => {
        if (!usedExtracted.has(idx)) unmatchedExtracted.push(ext);
    });

    // 4. Strict Accounting
    // Strict True Positives
    const strictTP = matchedPairs.filter(p => p.isStrictTruePositive);
    const weakMatches = matchedPairs.filter(p => p.isWeakMatch);

    const tpCount = strictTP.length;
    // Every weak match failed extraction criteria: the extracted fact is a False Positive, and expected fact is a False Negative
    const fpCount = unmatchedExtracted.length + weakMatches.length;
    const fnCount = unmatchedExpected.length + weakMatches.length;

    // Verify mathematical identities: TP + FN == Expected, TP + FP == Extracted
    const expectedCount = expectedFacts.length;
    const extractedCount = extractedFacts.length;

    if (tpCount + fnCount !== expectedCount) {
        throw new Error(`Accounting violation in ${docId}: TP (${tpCount}) + FN (${fnCount}) !== Expected (${expectedCount})`);
    }
    if (tpCount + fpCount !== extractedCount) {
        throw new Error(`Accounting violation in ${docId}: TP (${tpCount}) + FP (${fpCount}) !== Extracted (${extractedCount})`);
    }

    const precision = (tpCount + fpCount > 0) ? tpCount / (tpCount + fpCount) : 0;
    const recall = (tpCount + fnCount > 0) ? tpCount / (tpCount + fnCount) : 0;
    const f1 = (precision + recall > 0) ? (2 * precision * recall) / (precision + recall) : 0;

    // Field match counts among matched pairs
    const fieldCounts = {
        totalEvaluated: matchedPairs.length,
        metricMatches: matchedPairs.filter(p => p.fieldMatches.metric).length,
        entityMatches: matchedPairs.filter(p => p.fieldMatches.entity).length,
        periodMatches: matchedPairs.filter(p => p.fieldMatches.period).length,
        basisMatches: matchedPairs.filter(p => p.fieldMatches.reportingBasis).length,
        dimensionsMatches: matchedPairs.filter(p => p.fieldMatches.dimensions).length,
        unitMatches: matchedPairs.filter(p => p.fieldMatches.unit).length,
        currencyMatches: matchedPairs.filter(p => p.fieldMatches.currency).length,
        valueMatches: matchedPairs.filter(p => p.fieldMatches.value).length,
        locationMatches: matchedPairs.filter(p => p.fieldMatches.sourceLocation).length
    };

    return {
        documentId: docId,
        fileName: docName,
        isFixture,
        expectedCount,
        extractedCount,
        tpCount,
        fpCount,
        fnCount,
        weakMatchesCount: weakMatches.length,
        unmatchedExpectedCount: unmatchedExpected.length,
        unmatchedExtractedCount: unmatchedExtracted.length,
        precision: Number(precision.toFixed(4)),
        recall: Number(recall.toFixed(4)),
        f1: Number(f1.toFixed(4)),
        fieldCounts,
        matchedPairs,
        strictTP,
        weakMatches,
        unmatchedExpected,
        unmatchedExtracted
    };
}

/**
 * Evaluates a document dispatcher
 */
function evaluateDocument(docObj, expectedFacts, docName, options = {}) {
    const mode = options.mode || 'strict_v2';
    if (mode === 'baseline_v1') {
        return evaluateDocumentBaselineV1(docObj, expectedFacts, docName);
    }
    return evaluateDocumentStrictV2(docObj, expectedFacts, docName);
}

/**
 * Main evaluation orchestrator supporting Mode 1 (baseline) and Mode 2 (strict v2)
 */
function runEvaluation(options = {}) {
    const mode = options.mode || 'strict_v2';

    const docFiles = [
        { dir: docsDir, name: 'doc-01-contoso-retail-q1-audited.json', exp: 'doc-01-expected.json' },
        { dir: docsDir, name: 'doc-02-contoso-retail-q2-management-pack.json', exp: 'doc-02-expected.json' },
        { dir: docsDir, name: 'doc-03-contoso-logistics-q1-audited.json', exp: 'doc-03-expected.json' },
        { dir: docsDir, name: 'doc-04-contoso-logistics-q2-draft-v1.json', exp: 'doc-04-expected.json' },
        { dir: docsDir, name: 'doc-05-contoso-logistics-q2-final-v2.json', exp: 'doc-05-expected.json' },
        { dir: docsDir, name: 'doc-06-contoso-properties-q1-management-pack.json', exp: 'doc-06-expected.json' },
        { dir: docsDir, name: 'doc-07-contoso-holdings-board-pack-q1.json', exp: 'doc-07-expected.json' },
        { dir: docsDir, name: 'doc-08-contoso-retail-budget-fy2026.json', exp: 'doc-08-expected.json' },
        { dir: docsDir, name: 'doc-09-contoso-logistics-budget-fy2026.json', exp: 'doc-09-expected.json' },
        { dir: docsDir, name: 'doc-10-contoso-properties-budget-fy2026.json', exp: 'doc-10-expected.json' },
        { dir: docsDir, name: 'doc-11-contoso-holdings-group-actuals-tracker.json', exp: 'doc-11-expected.json' },
        { dir: fixturesDir, name: 'fixture-01-multilevel-segments.json', exp: 'fixture-01-expected.json' },
        { dir: fixturesDir, name: 'fixture-02-excel-formulas-and-errors.json', exp: 'fixture-02-expected.json' },
        { dir: fixturesDir, name: 'fixture-03-ratios-and-bps.json', exp: 'fixture-03-expected.json' },
        { dir: fixturesDir, name: 'fixture-04-missing-metadata-and-stray.json', exp: 'fixture-04-expected.json' },
        { dir: fixturesDir, name: 'fixture-05-narrative-commentary-bilingual.json', exp: 'fixture-05-expected.json' }
    ];

    const results = [];
    let globalExpected = 0;
    let globalExtracted = 0;
    let globalTP = 0;
    let globalFP = 0;
    let globalFN = 0;

    let totalPairsEvaluated = 0;
    let totalMetricMatches = 0;
    let totalEntityMatches = 0;
    let totalPeriodMatches = 0;
    let totalBasisMatches = 0;
    let totalDimensionsMatches = 0;
    let totalValueMatches = 0;
    let totalUnitMatches = 0;
    let totalCurrencyMatches = 0;
    let totalLocationMatches = 0;

    const failureCatalog = [];
    const weakMatchCategoryBreakdown = {
        INCORRECT_ENTITY: 0,
        INCORRECT_VALUE: 0,
        INCORRECT_PERIOD: 0,
        INCORRECT_REPORTING_BASIS: 0,
        INCORRECT_DIMENSIONS: 0,
        INCORRECT_UNIT: 0,
        INCORRECT_CURRENCY: 0
    };

    docFiles.forEach(({ dir, name, exp }) => {
        const docObj = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
        const expFacts = JSON.parse(fs.readFileSync(path.join(expectedDir, exp), 'utf8'));

        const evalRes = evaluateDocument(docObj, expFacts, name, { mode });
        results.push(evalRes);

        globalExpected += evalRes.expectedCount;
        globalExtracted += evalRes.extractedCount;
        globalTP += evalRes.tpCount;
        globalFP += evalRes.fpCount;
        globalFN += evalRes.fnCount;

        totalPairsEvaluated += evalRes.fieldCounts.totalEvaluated;
        totalMetricMatches += evalRes.fieldCounts.metricMatches;
        totalEntityMatches += evalRes.fieldCounts.entityMatches;
        totalPeriodMatches += evalRes.fieldCounts.periodMatches;
        totalBasisMatches += (evalRes.fieldCounts.basisMatches ?? evalRes.fieldCounts.totalEvaluated);
        totalDimensionsMatches += (evalRes.fieldCounts.dimensionsMatches ?? evalRes.fieldCounts.totalEvaluated);
        totalValueMatches += evalRes.fieldCounts.valueMatches;
        totalUnitMatches += evalRes.fieldCounts.unitMatches;
        totalCurrencyMatches += evalRes.fieldCounts.currencyMatches;
        totalLocationMatches += evalRes.fieldCounts.locationMatches;

        if (mode === 'strict_v2') {
            evalRes.weakMatches.forEach(weak => {
                weak.failureCategories.forEach(cat => {
                    if (cat in weakMatchCategoryBreakdown) {
                        weakMatchCategoryBreakdown[cat]++;
                    }
                });

                failureCatalog.push({
                    document: name,
                    factId: weak.expected.factId,
                    metric: weak.expected.metricLabel,
                    type: 'WEAK_MATCH',
                    categories: weak.failureCategories,
                    expectedEntity: weak.expected.entityLabel,
                    extractedEntity: weak.extracted.entity,
                    expectedValue: weak.expected.normalizedValue,
                    extractedValue: weak.extracted.normalizedValue,
                    detail: `Weak match: failed on ${weak.failureCategories.join(', ')}.`
                });
            });
        }

        evalRes.unmatchedExpected.forEach(unExp => {
            failureCatalog.push({
                document: name,
                factId: unExp.factId,
                metric: unExp.metricLabel,
                type: 'COMPLETELY_MISSED_FACT',
                expected: unExp.originalTextValue,
                extracted: null,
                detail: `Fact completely missed (False Negative). Narrative text, skipped error cell, or parser omission.`
            });
        });

        evalRes.unmatchedExtracted.forEach(unExt => {
            failureCatalog.push({
                document: name,
                factId: null,
                metric: unExt.metric,
                type: 'COMPLETELY_SPURIOUS_EXTRACTION',
                expected: null,
                extracted: unExt.originalTextValue,
                detail: `Spurious fact extracted (False Positive). Footnote or unanchored note row.`
            });
        });
    });

    const overallPrecision = (globalTP + globalFP > 0) ? globalTP / (globalTP + globalFP) : 0;
    const overallRecall = (globalTP + globalFN > 0) ? globalTP / (globalTP + globalFN) : 0;
    const overallF1 = (overallPrecision + overallRecall > 0) ? (2 * overallPrecision * overallRecall) / (overallPrecision + overallRecall) : 0;

    const report = {
        evaluationVersion: mode === 'baseline_v1' ? 'v1.0.0-baseline-frozen' : 'v2.0.0-strict-business-identity',
        evaluationMode: mode,
        evaluationTimestamp: new Date().toISOString(),
        datasetSummary: {
            totalDocuments: docFiles.length,
            benchmarkDocuments: 11,
            edgeCaseFixtures: 5,
            totalExpectedFacts: globalExpected,
            totalExtractedFacts: globalExtracted
        },
        overallPerformance: {
            truePositives: globalTP,
            falsePositives: globalFP,
            falseNegatives: globalFN,
            precision: Number(overallPrecision.toFixed(4)),
            recall: Number(overallRecall.toFixed(4)),
            f1Score: Number(overallF1.toFixed(4)),
            accountingInvariants: {
                tpPlusFnEqualsExpected: globalTP + globalFN === globalExpected,
                tpPlusFpEqualsExtracted: globalTP + globalFP === globalExtracted
            }
        },
        fieldLevelAccuracy: {
            totalEvaluatedPairs: totalPairsEvaluated,
            metricAccuracy: Number((totalMetricMatches / (totalPairsEvaluated || 1)).toFixed(4)),
            entityAccuracy: Number((totalEntityMatches / (totalPairsEvaluated || 1)).toFixed(4)),
            periodAccuracy: Number((totalPeriodMatches / (totalPairsEvaluated || 1)).toFixed(4)),
            reportingBasisAccuracy: Number((totalBasisMatches / (totalPairsEvaluated || 1)).toFixed(4)),
            dimensionsAccuracy: Number((totalDimensionsMatches / (totalPairsEvaluated || 1)).toFixed(4)),
            valueAccuracy: Number((totalValueMatches / (totalPairsEvaluated || 1)).toFixed(4)),
            unitAccuracy: Number((totalUnitMatches / (totalPairsEvaluated || 1)).toFixed(4)),
            currencyAccuracy: Number((totalCurrencyMatches / (totalPairsEvaluated || 1)).toFixed(4)),
            locationAccuracy: Number((totalLocationMatches / (totalPairsEvaluated || 1)).toFixed(4))
        },
        fieldAccuracyReporting: {
            // 1. Conditional field accuracy on matched facts (denominator = matched pairs: 92)
            conditionalAccuracyOnMatchedFacts: {
                denominator: totalPairsEvaluated,
                metricAccuracy: Number((totalMetricMatches / (totalPairsEvaluated || 1)).toFixed(4)),
                entityAccuracy: Number((totalEntityMatches / (totalPairsEvaluated || 1)).toFixed(4)),
                periodAccuracy: Number((totalPeriodMatches / (totalPairsEvaluated || 1)).toFixed(4)),
                reportingBasisAccuracy: Number((totalBasisMatches / (totalPairsEvaluated || 1)).toFixed(4)),
                dimensionsAccuracy: Number((totalDimensionsMatches / (totalPairsEvaluated || 1)).toFixed(4)),
                valueAccuracy: Number((totalValueMatches / (totalPairsEvaluated || 1)).toFixed(4)),
                unitAccuracy: Number((totalUnitMatches / (totalPairsEvaluated || 1)).toFixed(4)),
                currencyAccuracy: Number((totalCurrencyMatches / (totalPairsEvaluated || 1)).toFixed(4)),
                locationAccuracy: Number((totalLocationMatches / (totalPairsEvaluated || 1)).toFixed(4))
            },
            // 2. Unconditional ground-truth accuracy across ALL expected facts (denominator = 100)
            unconditionalGroundTruthAccuracy: {
                denominator: globalExpected,
                metricAccuracy: Number((totalMetricMatches / (globalExpected || 1)).toFixed(4)),
                entityAccuracy: Number((totalEntityMatches / (globalExpected || 1)).toFixed(4)),
                periodAccuracy: Number((totalPeriodMatches / (globalExpected || 1)).toFixed(4)),
                reportingBasisAccuracy: Number((totalBasisMatches / (globalExpected || 1)).toFixed(4)),
                dimensionsAccuracy: Number((totalDimensionsMatches / (globalExpected || 1)).toFixed(4)),
                valueAccuracy: Number((totalValueMatches / (globalExpected || 1)).toFixed(4)),
                unitAccuracy: Number((totalUnitMatches / (globalExpected || 1)).toFixed(4)),
                currencyAccuracy: Number((totalCurrencyMatches / (globalExpected || 1)).toFixed(4)),
                locationAccuracy: Number((totalLocationMatches / (globalExpected || 1)).toFixed(4))
            }
        },
        weakMatchBreakdown: weakMatchCategoryBreakdown,
        documentResults: results.map(r => ({
            documentId: r.documentId,
            fileName: r.fileName,
            isFixture: r.isFixture,
            expected: r.expectedCount,
            extracted: r.extractedCount,
            tp: r.tpCount,
            fp: r.fpCount,
            fn: r.fnCount,
            precision: r.precision,
            recall: r.recall,
            f1: r.f1,
            conditionalAccuracy: {
                denominator: r.fieldCounts.totalEvaluated,
                metric: Number((r.fieldCounts.metricMatches / (r.fieldCounts.totalEvaluated || 1)).toFixed(2)),
                entity: Number((r.fieldCounts.entityMatches / (r.fieldCounts.totalEvaluated || 1)).toFixed(2)),
                period: Number((r.fieldCounts.periodMatches / (r.fieldCounts.totalEvaluated || 1)).toFixed(2)),
                value: Number((r.fieldCounts.valueMatches / (r.fieldCounts.totalEvaluated || 1)).toFixed(2))
            }
        })),
        discrepancyCatalog: {
            totalDiscrepancies: failureCatalog.length,
            weakMatchesByReason: weakMatchCategoryBreakdown,
            failures: failureCatalog
        }
    };

    // Save report to disk depending on mode
    if (mode === 'baseline_v1') {
        fs.writeFileSync(baselineReportPath, JSON.stringify(report, null, 2), 'utf8');
    } else {
        fs.writeFileSync(revisedReportPath, JSON.stringify(report, null, 2), 'utf8');
    }

    return report;
}

if (require.main === module) {
    const strictReport = runEvaluation({ mode: 'strict_v2' });
    console.log('=== FinChat Extraction Revised Strict Evaluation Report (v2) ===');
    console.log(`Evaluation Version: ${strictReport.evaluationVersion}`);
    console.log(`Total Expected Facts: ${strictReport.datasetSummary.totalExpectedFacts}`);
    console.log(`Total Extracted Facts: ${strictReport.datasetSummary.totalExtractedFacts}`);
    console.log(`Strict True Positives: ${strictReport.overallPerformance.truePositives}`);
    console.log(`False Positives:       ${strictReport.overallPerformance.falsePositives}`);
    console.log(`False Negatives:       ${strictReport.overallPerformance.falseNegatives}`);
    console.log(`Strict Precision:      ${(strictReport.overallPerformance.precision * 100).toFixed(2)}%`);
    console.log(`Strict Recall:         ${(strictReport.overallPerformance.recall * 100).toFixed(2)}%`);
    console.log(`Strict F1-Score:       ${(strictReport.overallPerformance.f1Score * 100).toFixed(2)}%`);
    console.log(`\nAccounting Invariant TP + FN == Expected: ${strictReport.overallPerformance.accountingInvariants.tpPlusFnEqualsExpected}`);
    console.log(`Accounting Invariant TP + FP == Extracted: ${strictReport.overallPerformance.accountingInvariants.tpPlusFpEqualsExtracted}`);

    console.log('\n--- Field Accuracy Comparison (Conditional vs Unconditional) ---');
    const cond = strictReport.fieldAccuracyReporting.conditionalAccuracyOnMatchedFacts;
    const uncond = strictReport.fieldAccuracyReporting.unconditionalGroundTruthAccuracy;
    console.log(`Metric Accuracy:   ${(cond.metricAccuracy * 100).toFixed(2)}% (cond, N=${cond.denominator})  |  ${(uncond.metricAccuracy * 100).toFixed(2)}% (uncond, N=${uncond.denominator})`);
    console.log(`Entity Accuracy:   ${(cond.entityAccuracy * 100).toFixed(2)}% (cond, N=${cond.denominator})  |  ${(uncond.entityAccuracy * 100).toFixed(2)}% (uncond, N=${uncond.denominator})`);
    console.log(`Period Accuracy:   ${(cond.periodAccuracy * 100).toFixed(2)}% (cond, N=${cond.denominator})  |  ${(uncond.periodAccuracy * 100).toFixed(2)}% (uncond, N=${uncond.denominator})`);
    console.log(`Value Accuracy:    ${(cond.valueAccuracy * 100).toFixed(2)}% (cond, N=${cond.denominator})  |  ${(uncond.valueAccuracy * 100).toFixed(2)}% (uncond, N=${uncond.denominator})`);
    console.log(`Unit Accuracy:     ${(cond.unitAccuracy * 100).toFixed(2)}% (cond, N=${cond.denominator})  |  ${(uncond.unitAccuracy * 100).toFixed(2)}% (uncond, N=${uncond.denominator})`);
    console.log(`Currency Accuracy: ${(cond.currencyAccuracy * 100).toFixed(2)}% (cond, N=${cond.denominator})  |  ${(uncond.currencyAccuracy * 100).toFixed(2)}% (uncond, N=${uncond.denominator})`);

    console.log('\n--- Weak Match Breakdown by Failure Reason ---');
    console.log(JSON.stringify(strictReport.discrepancyCatalog.weakMatchesByReason, null, 2));
    console.log(`\nRevised report written to: ${revisedReportPath}`);
}

module.exports = {
    runEvaluation,
    evaluateDocument,
    evaluateDocumentBaselineV1,
    evaluateDocumentStrictV2
};
