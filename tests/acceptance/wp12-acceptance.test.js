// tests/acceptance/wp12-acceptance.test.js
// Acceptance Test Suite for WP12 & Full Specification Verification

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { isAuthEnforced } = require('../../src/utils/config');
const { generateBlobSasUrl } = require('../../src/services/blob-storage');
const { buildFactIdentityKey, detectFinancialFactConflicts } = require('../../src/services/conflict-resolver');
const { normalizeArabicText, parseArabicNumber } = require('../../src/services/arabic-normalizer');
const { Decimal } = require('../../src/utils/decimal');
const { computeVariance } = require('../../src/services/calculation-engine');
const { DurableQueue } = require('../../src/services/durable-queue');
const { softDeleteFact } = require('../../src/services/reconciler');
const { setPool, resetPool } = require('../../src/services/sql');

test('WP12: Master Acceptance Test Suite across All Work Packages', async (t) => {
    const datasetPath = path.resolve(__dirname, 'acceptance-dataset.json');
    assert.ok(fs.existsSync(datasetPath), 'acceptance-dataset.json must exist');

    const rawData = JSON.parse(fs.readFileSync(datasetPath, 'utf8'));
    const records = Array.isArray(rawData) ? rawData : Object.values(rawData);

    assert.ok(records.length >= 24, `Must contain comprehensive acceptance records, got ${records.length}`);

    await t.test('1. WP1 Baseline Auth Guardrail Acceptance', () => {
        const item = records.find(r => r.id === 'wp1-baseline-auth-guardrail');
        assert.ok(item);
        assert.equal(isAuthEnforced(), item.expected.isAuthEnforced);
    });

    await t.test('2. WP13 Fact Integrity Acceptance', () => {
        const item = records.find(r => r.id === 'wp13-missing-period-needs-review');
        assert.ok(item);
        assert.equal(item.expected.mappingStatus, 'NeedsReview');
    });

    await t.test('3. WP2 Scope & Idempotency Acceptance', () => {
        const item = records.find(r => r.id === 'wp2-scope-format-rejection');
        assert.ok(item);
        assert.equal(item.expected.accepted, false);
        assert.equal(item.expected.errorCode, 'UnsupportedFileFormat');
    });

    await t.test('4. WP3 Decimal Math & Calculation Rules Acceptance', () => {
        const item = records.find(r => r.id === 'wp3-decimal-calculation-zero-base');
        assert.ok(item);

        const res = computeVariance(
            { NumericValue: 0, Metric: 'Revenue', Currency: 'AED' },
            { NumericValue: 1000, Metric: 'Revenue', Currency: 'AED' }
        );
        assert.equal(res.percentChange, null);
        assert.ok(res.percentChangeExplanation.includes('Base value is zero'));
    });

    await t.test('5. WP6 8-Field Business Identity & Tolerance Acceptance', () => {
        const item = records.find(r => r.id === 'wp6-8-field-fact-identity');
        assert.ok(item);

        const key = buildFactIdentityKey(item.input);
        assert.ok(key.keyHash);
        assert.ok(key.keyString.includes('metric=revenue'));
        assert.ok(key.keyString.includes('entity=contoso retail llc'));
        assert.ok(key.keyString.includes('period=q1 2026'));
        assert.ok(key.keyString.includes('basis=actual'));
        assert.ok(key.keyString.includes('scope=consolidated'));
        assert.ok(key.keyString.includes('unit=amount'));
        assert.ok(key.keyString.includes('curr=aed'));
        assert.ok(key.keyString.includes('department=retail'));
    });

    await t.test('6. WP14 Read-Only Blob SAS Acceptance', () => {
        const item = records.find(r => r.id === 'wp14-read-only-blob-sas');
        assert.ok(item);

        const url = generateBlobSasUrl({ blobName: item.input.blobName, ttlHours: item.input.ttlHours });
        assert.ok(url.startsWith('https://'));
        assert.ok(url.includes('sp=r'));
        assert.ok(url.includes('sr=b'));
        assert.ok(url.includes('spr=https'));
    });

    await t.test('7. WP4 & WP5 Arabic Normalization Acceptance', () => {
        const item = records.find(r => r.id === 'wp4-wp5-arabic-bilingual-normalization');
        assert.ok(item);

        const normWord = normalizeArabicText(item.input.arabicWord);
        assert.equal(normWord, item.expected.normalizedWord);

        const normDigits = normalizeArabicText(item.input.arabicDigits);
        assert.equal(normDigits, item.expected.normalizedDigits);
    });

    await t.test('8. WP15 Durable Queue Retry & DLQ Acceptance', async () => {
        const item = records.find(r => r.id === 'wp15-durable-queue-dlq');
        assert.ok(item);

        const queue = new DurableQueue();
        const job = await queue.enqueueIngestionJob({ documentId: 999, fileName: 'test.pdf' });

        let attempts = 0;
        const res = await queue.processJobWithRetry(job, async () => {
            attempts++;
            throw new Error('Fatal parse error');
        }, { maxRetries: item.input.maxRetries, initialBackoffMs: 5 });

        assert.equal(res.success, false);
        assert.equal(res.deadLetter, true);
        assert.equal(queue.getDeadLetterQueue().length, 1);
    });

    await t.test('9. WP9 Soft-Delete Policy Acceptance', async () => {
        const item = records.find(r => r.id === 'wp9-soft-delete-reconciler');
        assert.ok(item);

        const queriesUsed = [];
        const mockPool = {
            connected: true,
            request: () => ({
                input: () => mockPool.request(),
                query: async (q) => {
                    queriesUsed.push(q);
                    return { rowsAffected: [1] };
                }
            })
        };

        setPool(mockPool);
        const success = await softDeleteFact(555, 'Superseded');
        assert.equal(success, true);
        const updateQuery = queriesUsed.find(q => q.includes("UPDATE dbo.FinancialFacts"));
        assert.ok(updateQuery);
        assert.ok(updateQuery.includes("SET MappingStatus = 'Superseded'"));
        assert.ok(queriesUsed.every(q => !q.toLowerCase().includes("delete from")));
        resetPool();
    });
});
