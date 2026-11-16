// tests/extracted-facts-contract.test.js
// Purpose: Contract validation test suite for ExtractedFactsV1.
// Verifies complete runtime envelope compliance, logical identity generation,
// and rejection of malformed envelopes.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { CONTRACT_VERSION, IDENTITY_KEY_VERSION, generateLogicalIdentity, serializeExpectedFactsToContractEnvelope } = require('../../../contracts/extracted-facts');
const { validateExtractedFactsEnvelope } = require('../../../src/services/extracted-facts-validator');

test('ExtractedFactsV1 Contract & Validator Test Suite', async (t) => {

    const baseDir = path.resolve('tests/financial-facts/golden-dataset');
    const docsDir = path.join(baseDir, 'documents');
    const fixDir = path.join(baseDir, 'fixtures');
    const expDir = path.join(baseDir, 'expected-facts');

    await t.test('1. JSON Schema Definition: Schema file exists and is valid JSON', () => {
        const schemaPath = path.resolve('contracts/extracted-facts.v1.schema.json');
        assert.ok(fs.existsSync(schemaPath), 'Schema file must exist');
        const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
        assert.equal(schema.title, 'ExtractedFactsV1');
        assert.equal(schema.type, 'object');
        assert.ok(schema.required.includes('contractVersion'));
        assert.ok(schema.required.includes('facts'));
        assert.ok(schema.required.includes('validationSummary'));
    });

    await t.test('2. Logical Identity Generator: Computes canonical keyString and matching SHA-256 hash', () => {
        const fact = {
            metricLabel: "Revenue",
            entityLabel: "Contoso Retail LLC",
            periodLabel: "Q1 2026",
            temporalType: "duration",
            reportingBasis: "Actual",
            reportingScope: "Entity",
            normalizedUnit: "amount",
            currency: "AED",
            dimensions: { channel: "Online" }
        };

        const li = generateLogicalIdentity(fact);
        assert.equal(li.identityKeyVersion, 'v1.2');
        assert.ok(li.keyString.includes('metric=revenue'));
        assert.ok(li.keyString.includes('entity=contoso retail llc'));
        assert.ok(li.keyString.includes('curr=aed'));
        assert.ok(li.keyString.includes('channel=online'));
        assert.equal(li.completeness, 'complete');
        assert.equal(li.isComparableForConflict, true);
        assert.ok(li.keyHash.length === 64, 'SHA-256 hash must be 64 hex characters');
    });

    await t.test('3. Logical Identity: Non-monetary facts omit currency from keyString and comparability check', () => {
        const ratioFact = {
            metricLabel: "Gross Margin",
            entityLabel: "Contoso Retail LLC",
            periodLabel: "Q1 2026",
            temporalType: "duration",
            reportingBasis: "Actual",
            reportingScope: "Entity",
            normalizedUnit: "ratio",
            currency: null
        };

        const li = generateLogicalIdentity(ratioFact);
        assert.equal(li.completeness, 'complete');
        assert.equal(li.isComparableForConflict, true, 'Ratio without currency is fully comparable');
        assert.ok(!li.keyString.includes('curr='), 'Non-monetary facts must not include currency in keyString');
    });

    await t.test('4. All 16 Golden Documents serialize to valid ExtractedFactsV1 envelopes', () => {
        const docMappings = [
            { doc: 'doc-01-contoso-retail-q1-audited.json', exp: 'doc-01-expected.json', dir: docsDir },
            { doc: 'doc-02-contoso-retail-q2-management-pack.json', exp: 'doc-02-expected.json', dir: docsDir },
            { doc: 'doc-03-contoso-logistics-q1-audited.json', exp: 'doc-03-expected.json', dir: docsDir },
            { doc: 'doc-04-contoso-logistics-q2-draft-v1.json', exp: 'doc-04-expected.json', dir: docsDir },
            { doc: 'doc-05-contoso-logistics-q2-final-v2.json', exp: 'doc-05-expected.json', dir: docsDir },
            { doc: 'doc-06-contoso-properties-q1-management-pack.json', exp: 'doc-06-expected.json', dir: docsDir },
            { doc: 'doc-07-contoso-holdings-board-pack-q1.json', exp: 'doc-07-expected.json', dir: docsDir },
            { doc: 'doc-08-contoso-retail-budget-fy2026.json', exp: 'doc-08-expected.json', dir: docsDir },
            { doc: 'doc-09-contoso-logistics-budget-fy2026.json', exp: 'doc-09-expected.json', dir: docsDir },
            { doc: 'doc-10-contoso-properties-budget-fy2026.json', exp: 'doc-10-expected.json', dir: docsDir },
            { doc: 'doc-11-contoso-holdings-group-actuals-tracker.json', exp: 'doc-11-expected.json', dir: docsDir },
            { doc: 'fixture-01-multilevel-segments.json', exp: 'fixture-01-expected.json', dir: fixDir },
            { doc: 'fixture-02-excel-formulas-and-errors.json', exp: 'fixture-02-expected.json', dir: fixDir },
            { doc: 'fixture-03-ratios-and-bps.json', exp: 'fixture-03-expected.json', dir: fixDir },
            { doc: 'fixture-04-missing-metadata-and-stray.json', exp: 'fixture-04-expected.json', dir: fixDir },
            { doc: 'fixture-05-narrative-commentary-bilingual.json', exp: 'fixture-05-expected.json', dir: fixDir }
        ];

        docMappings.forEach(({ doc, exp, dir }) => {
            const docObj = JSON.parse(fs.readFileSync(path.join(dir, doc), 'utf8'));
            const expectedFacts = JSON.parse(fs.readFileSync(path.join(expDir, exp), 'utf8'));

            const envelope = serializeExpectedFactsToContractEnvelope(docObj, expectedFacts);
            const val = validateExtractedFactsEnvelope(envelope);

            assert.equal(
                val.valid,
                true,
                `Envelope validation failed for ${doc}: ${val.errors.join('; ')}`
            );
            assert.equal(envelope.contractVersion, CONTRACT_VERSION);
            assert.equal(envelope.facts.length, expectedFacts.length);
        });
    });

    await t.test('5. Rejection of Invalid Contract Envelopes', () => {
        // Missing contractVersion
        const bad1 = { documentId: "doc-1", facts: [], validationSummary: { totalFactsCount: 0 } };
        const v1 = validateExtractedFactsEnvelope(bad1);
        assert.equal(v1.valid, false);
        assert.ok(v1.errors.some(e => e.includes('contractVersion')));

        // Summary count mismatch
        const docObj = { document_id: "doc-1" };
        const envelope = serializeExpectedFactsToContractEnvelope(docObj, [{ factId: "f1", metricLabel: "Rev", rawValue: 100, normalizedValue: "100.00000000", normalizedUnit: "amount", currency: "AED" }]);
        envelope.validationSummary.validFactsCount = 5; // Deliberate mismatch
        const v2 = validateExtractedFactsEnvelope(envelope);
        assert.equal(v2.valid, false);
        assert.ok(v2.errors.some(e => e.includes('does not equal totalFactsCount')));

        // Hash mismatch
        envelope.validationSummary.validFactsCount = 1;
        envelope.facts[0].logicalIdentity.keyHash = "0000000000000000000000000000000000000000000000000000000000000000";
        const v3 = validateExtractedFactsEnvelope(envelope);
        assert.equal(v3.valid, false);
        assert.ok(v3.errors.some(e => e.includes('keyHash mismatch')));
    });
});

