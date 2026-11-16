// tests/golden-dataset-evaluation.test.js
// Purpose: Automated regression & evaluation test suite for Phase 4.2.2 Golden Dataset.
// Tests the existing fact extraction engine against the 100 manually verified expected facts.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { runEvaluation, evaluateDocument } = require('../../financial-facts/golden-dataset/evaluation/evaluate-extraction');
const { validateNormalizedDocument } = require('../../../src/services/normalized-document-validator');

test('Phase 4.2.2: Synthetic Golden Dataset Evaluation Suite', async (t) => {

    const baseDir = path.resolve('tests/financial-facts/golden-dataset');
    const docsDir = path.join(baseDir, 'documents');
    const fixDir = path.join(baseDir, 'fixtures');
    const expectedDir = path.join(baseDir, 'expected-facts');

    await t.test('1. Dataset Structure: 11 Benchmark Documents and 5 Edge Case Fixtures Exist', () => {
        const benchmarkFiles = fs.readdirSync(docsDir).filter(f => f.endsWith('.json'));
        const fixtureFiles = fs.readdirSync(fixDir).filter(f => f.endsWith('.json'));
        const expectedFiles = fs.readdirSync(expectedDir).filter(f => f.endsWith('.json'));

        assert.equal(benchmarkFiles.length, 11, 'Must have exactly 11 benchmark documents');
        assert.equal(fixtureFiles.length, 5, 'Must have exactly 5 edge case fixtures');
        assert.equal(expectedFiles.length, 16, 'Must have exactly 16 expected facts files');
    });

    await t.test('2. NormalizedDocumentV1 Contract Compliance: All 16 documents validate cleanly', () => {
        const allDocFiles = [
            ...fs.readdirSync(docsDir).map(f => path.join(docsDir, f)),
            ...fs.readdirSync(fixDir).map(f => path.join(fixDir, f))
        ];

        allDocFiles.forEach(filePath => {
            const doc = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            const validation = validateNormalizedDocument(doc);
            assert.equal(
                validation.valid,
                true,
                `Document ${path.basename(filePath)} failed validation: ${validation.errors.join('; ')}`
            );
        });
    });

    await t.test('3. Golden Facts Count: Exactly 100 manually verified facts across benchmark & fixtures', () => {
        const expectedFiles = fs.readdirSync(expectedDir).filter(f => f.endsWith('.json'));
        let totalCount = 0;

        expectedFiles.forEach(f => {
            const facts = JSON.parse(fs.readFileSync(path.join(expectedDir, f), 'utf8'));
            assert.ok(Array.isArray(facts), `Expected facts in ${f} must be an array`);
            assert.ok(facts.length > 0, `Expected facts in ${f} must not be empty`);
            totalCount += facts.length;

            // Verify ExtractedFactsV1 required contract fields
            facts.forEach(fact => {
                assert.ok(fact.factId, `Fact missing factId in ${f}`);
                assert.ok(fact.metricLabel, `Fact missing metricLabel in ${f}`);
                assert.ok(fact.temporalType, `Fact missing temporalType in ${f}`);
                assert.ok('normalizedValue' in fact, `Fact missing normalizedValue in ${f}`);
                assert.ok(fact.normalizedUnit, `Fact missing normalizedUnit in ${f}`);
                assert.ok(fact.sourceLocation, `Fact missing sourceLocation in ${f}`);
            });
        });

        assert.equal(totalCount, 100, `Expected dataset must contain exactly 100 facts, found ${totalCount}`);
    });

    await t.test('4. Baseline Evaluation Execution: Computes Precision, Recall, F1 and Field Accuracy', () => {
        const report = runEvaluation();

        assert.ok(report, 'Evaluation report must be generated');
        assert.equal(report.datasetSummary.totalDocuments, 16);
        assert.equal(report.datasetSummary.totalExpectedFacts, 100);

        // Verify metrics are within valid statistical boundaries
        assert.ok(report.overallPerformance.precision >= 0 && report.overallPerformance.precision <= 1);
        assert.ok(report.overallPerformance.recall >= 0 && report.overallPerformance.recall <= 1);
        assert.ok(report.overallPerformance.f1Score >= 0 && report.overallPerformance.f1Score <= 1);

        // Verify evaluation mathematical identities: TP + FN == Expected, TP + FP == Extracted
        assert.equal(
            report.overallPerformance.truePositives + report.overallPerformance.falseNegatives,
            report.datasetSummary.totalExpectedFacts,
            'TP + FN must strictly equal total expected facts'
        );
        assert.equal(
            report.overallPerformance.truePositives + report.overallPerformance.falsePositives,
            report.datasetSummary.totalExtractedFacts,
            'TP + FP must strictly equal total extracted facts'
        );

        // Verify per-document mathematical identities
        report.documentResults.forEach(r => {
            assert.equal(r.tp + r.fn, r.expected, `Document ${r.documentId}: tp + fn must equal expected`);
            assert.equal(r.tp + r.fp, r.extracted, `Document ${r.documentId}: tp + fp must equal extracted`);
        });

        // Verify field accuracy metrics exist
        assert.ok('metricAccuracy' in report.fieldLevelAccuracy);
        assert.ok('entityAccuracy' in report.fieldLevelAccuracy);
        assert.ok('periodAccuracy' in report.fieldLevelAccuracy);
        assert.ok('valueAccuracy' in report.fieldLevelAccuracy);
        assert.ok('unitAccuracy' in report.fieldLevelAccuracy);
        assert.ok('currencyAccuracy' in report.fieldLevelAccuracy);

        // Verify report file was written to disk
        const reportDiskPath = path.join(baseDir, 'evaluation', 'baseline-evaluation-report.json');
        assert.ok(fs.existsSync(reportDiskPath), 'baseline-evaluation-report.json must exist on disk');
    });

    await t.test('5. Discrepancy Diagnostics: Uncovers known extraction engine failure modes', () => {
        const reportDiskPath = path.join(baseDir, 'evaluation', 'baseline-evaluation-report.json');
        const report = JSON.parse(fs.readFileSync(reportDiskPath, 'utf8'));

        const breakdown = report.discrepancyCatalog.breakdownByType;

        // Verify that known failure modes are detected
        assert.ok(breakdown.ENTITY_MISMATCH_OR_FALLBACK > 0, 'Should detect entity fallback to Consolidated');
        assert.ok(breakdown.VALUE_MISMATCH_OR_SCALING > 0, 'Should detect unit scaling mismatch in thousands');
        assert.ok(breakdown.FALSE_NEGATIVE_EXTRACTION_MISSED > 0, 'Should detect missed narrative/error facts');
    });

    await t.test('6. Revised Strict Evaluation Execution (v2): Strict Business Identity Matching and Accounting Invariants', () => {
        const report = runEvaluation({ mode: 'strict_v2' });

        assert.ok(report, 'Strict evaluation report must be generated');
        assert.equal(report.evaluationVersion, 'v2.0.0-strict-business-identity');
        assert.equal(report.datasetSummary.totalDocuments, 16);
        assert.equal(report.datasetSummary.totalExpectedFacts, 100);
        assert.equal(report.datasetSummary.totalExtractedFacts, 100);

        // Strict TP, FP, FN counts for Phase 4.3.3 (Narrative Fact Extraction)
        assert.equal(report.overallPerformance.truePositives, 100, 'Strict TPs must equal exactly 100');
        assert.equal(report.overallPerformance.falsePositives, 0, 'Strict FPs must equal exactly 0');
        assert.equal(report.overallPerformance.falseNegatives, 0, 'Strict FNs must equal exactly 0');
        assert.equal(report.overallPerformance.precision, 1.0);
        assert.equal(report.overallPerformance.recall, 1.0);
        assert.equal(report.overallPerformance.f1Score, 1.0);

        // Accounting invariants: TP + FN == Expected (100) and TP + FP == Extracted (100)
        assert.equal(
            report.overallPerformance.truePositives + report.overallPerformance.falseNegatives,
            report.datasetSummary.totalExpectedFacts,
            'Strict TP + FN must strictly equal 100'
        );
        assert.equal(
            report.overallPerformance.truePositives + report.overallPerformance.falsePositives,
            report.datasetSummary.totalExtractedFacts,
            'Strict TP + FP must strictly equal 100'
        );

        // Per-document invariant check
        report.documentResults.forEach(r => {
            assert.equal(r.tp + r.fn, r.expected, `Document ${r.documentId}: strict tp + fn must equal expected`);
            assert.equal(r.tp + r.fp, r.extracted, `Document ${r.documentId}: strict tp + fp must equal extracted`);
        });

        // Dual field accuracy reporting verification
        const dualAcc = report.fieldAccuracyReporting;
        assert.ok(dualAcc.conditionalAccuracyOnMatchedFacts, 'Must include conditional field accuracy on matched pairs');
        assert.ok(dualAcc.unconditionalGroundTruthAccuracy, 'Must include unconditional field accuracy on all expected facts');

        assert.equal(dualAcc.conditionalAccuracyOnMatchedFacts.denominator, 100, 'Matched pairs denominator must be 100');
        assert.equal(dualAcc.unconditionalGroundTruthAccuracy.denominator, 100, 'Unconditional ground truth denominator must be 100');

        assert.equal(dualAcc.conditionalAccuracyOnMatchedFacts.metricAccuracy, 1.0);
        assert.equal(dualAcc.conditionalAccuracyOnMatchedFacts.entityAccuracy, 1.0);
        assert.equal(dualAcc.conditionalAccuracyOnMatchedFacts.periodAccuracy, 1.0);
        assert.equal(dualAcc.conditionalAccuracyOnMatchedFacts.unitAccuracy, 1.0);
        assert.equal(dualAcc.conditionalAccuracyOnMatchedFacts.currencyAccuracy, 1.0);
        assert.equal(dualAcc.conditionalAccuracyOnMatchedFacts.valueAccuracy, 1.0);

        assert.equal(dualAcc.unconditionalGroundTruthAccuracy.metricAccuracy, 1.0);
        assert.equal(dualAcc.unconditionalGroundTruthAccuracy.entityAccuracy, 1.0);
        assert.equal(dualAcc.unconditionalGroundTruthAccuracy.valueAccuracy, 1.0);

        // Weak match failure breakdown: All weak matches completely resolved to 0
        assert.ok(report.weakMatchBreakdown);
        assert.equal(report.weakMatchBreakdown.INCORRECT_ENTITY, 0, 'Must record 0 entity fallback weak matches (resolved in Phase 4.3.1)');
        assert.equal(report.weakMatchBreakdown.INCORRECT_VALUE, 0, 'Must record 0 value/scaling weak matches (resolved in Phase 4.3.2)');
        assert.equal(report.weakMatchBreakdown.INCORRECT_UNIT, 0, 'Must record 0 unit weak matches (resolved in Phase 4.3.2)');
        assert.equal(report.weakMatchBreakdown.INCORRECT_CURRENCY, 0, 'Must record 0 currency weak matches (resolved in Phase 4.3.2)');

        // Verify report file on disk
        const v2Path = path.join(baseDir, 'evaluation', 'revised-evaluation-report.v2.json');
        assert.ok(fs.existsSync(v2Path), 'revised-evaluation-report.v2.json must exist on disk');
    });

    await t.test('7. Baseline Preservation: Historical Phase 4.2.2 Baseline Remains Unchanged', () => {
        const baselinePath = path.join(baseDir, 'evaluation', 'baseline-evaluation-report.json');
        assert.ok(fs.existsSync(baselinePath), 'baseline-evaluation-report.json must exist');
        const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));

        assert.equal(baseline.datasetSummary.totalExpectedFacts, 100);
        assert.equal(baseline.datasetSummary.totalExtractedFacts, 97);
        assert.equal(baseline.overallPerformance.truePositives, 80);
        assert.equal(baseline.overallPerformance.falsePositives, 17);
        assert.equal(baseline.overallPerformance.falseNegatives, 20);
        assert.equal(baseline.overallPerformance.precision, 0.8247);
        assert.equal(baseline.overallPerformance.recall, 0.8);
        assert.equal(baseline.overallPerformance.f1Score, 0.8122);
    });
});

