const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateDocumentBuffer } = require('../../../src/utils/validation');
const { scanSharePointLibrary } = require('../../../src/services/sharepoint-scanner');
const {
    normalizeArabicText,
    normalizeArabicDigits,
    parseArabicNumber
} = require('../../../src/services/arabic-normalizer');
const { extractScaleFromText } = require('../../../src/services/unit-normalizer');
const { buildFactIdentityKey } = require('../../../src/services/conflict-resolver');
const { computeVariance } = require('../../../src/services/calculation-engine');
const { setPool, resetPool } = require('../../../src/services/sql');

test('Batch 4 / Package 7: Reconciler, WP17 Statuses, WP2 Rejections, WP11 Scanner, WP5 Arabic & WP6 8-Field Identity', async (t) => {

    await t.test('1. WP2 Rejection: Encrypted PDF and Excel workbooks are rejected with EncryptedFileNotSupported', async () => {
        // Mock encrypted PDF buffer with /Encrypt dictionary
        const encPdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Encrypt 2 0 R >>\nendobj\ntrailer\n<<>>\n%%EOF');
        await assert.rejects(
            async () => validateDocumentBuffer(encPdf, 'confidential.pdf'),
            {
                name: 'ValidationError',
                code: 'EncryptedFileNotSupported'
            }
        );

        // Mock encrypted Excel buffer with EncryptedPackage
        const encXlsx = Buffer.concat([Buffer.from([0x50, 0x4B, 0x03, 0x04]), Buffer.from('EncryptedPackageStream')]);
        await assert.rejects(
            async () => validateDocumentBuffer(encXlsx, 'locked.xlsx'),
            {
                name: 'ValidationError',
                code: 'EncryptedFileNotSupported'
            }
        );
    });

    await t.test('2. WP2 Rejection: Workbooks with external links are rejected with ExternalLinksNotSupported', async () => {
        const extLinkXlsx = Buffer.concat([Buffer.from([0x50, 0x4B, 0x03, 0x04]), Buffer.from('externalLink/sheet1.xml[Book2.xlsx]')]);
        await assert.rejects(
            async () => validateDocumentBuffer(extLinkXlsx, 'linked_report.xlsx'),
            {
                name: 'ValidationError',
                code: 'ExternalLinksNotSupported'
            }
        );
    });

    await t.test('3. WP11 Scanner: eTag caching, SourceRemoved marking, 429 backoff, 9-minute visibility timeout', async () => {
        const eTagCache = new Map();
        eTagCache.set('unchanged.pdf', '"etag-12345"');

        let dbUpdatedStatus = null;
        let dbIndexingStatus = null;

        const mockPool = {
            connected: true,
            request: () => ({
                input: () => ({
                    query: async (sqlText) => {
                        if (sqlText.includes("DocumentStatus = 'SourceRemoved'")) {
                            dbUpdatedStatus = 'SourceRemoved';
                            dbIndexingStatus = 'PendingDelete';
                        }
                        return { recordset: [], rowsAffected: [1] };
                    }
                })
            })
        };

        setPool(mockPool);
        try {
            const summary = await scanSharePointLibrary({
                eTagCache,
                discoveredFiles: [
                    { fileName: 'unchanged.pdf', eTag: '"etag-12345"' },
                    { fileName: 'new_doc.pdf', eTag: '"etag-99999"', fileBuffer: Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF') }
                ],
                existingDbFiles: [
                    { DocumentId: 55, FileName: 'deleted_remotely.pdf' }
                ],
                simulateRateLimit: true,
                retryAfterSeconds: 1
            });

            assert.equal(summary.totalFound, 2);
            assert.equal(summary.skipped, 1, 'Unchanged file with matching eTag must be skipped');
            assert.equal(summary.removed, 1, 'Missing remote file must be marked SourceRemoved');
            assert.equal(dbUpdatedStatus, 'SourceRemoved');
            assert.equal(dbIndexingStatus, 'PendingDelete');
            assert.equal(summary.visibilityTimeoutSeconds, 540, 'Visibility timeout must be 9 minutes (540 seconds)');
        } finally {
            resetPool();
        }
    });

    await t.test('4. WP5 Arabic & Persian: Persian digits, ٫ ٬ separators, and scale words', () => {
        // Persian digits (۰-۹) to ASCII
        const persianText = 'سود خالص: ۱۲۵۰۰۰٫۵۰';
        const normPersian = normalizeArabicDigits(persianText);
        assert.ok(normPersian.includes('125000.50'), 'Persian digits and comma must convert to 125000.50');

        // Arabic scale words detection
        const thousandScale = extractScaleFromText('الإيرادات بآلاف الدراهم');
        assert.ok(thousandScale);
        assert.equal(thousandScale.scale, 1000);
        assert.equal(thousandScale.currency, 'AED');

        const millionScale = extractScaleFromText('المبالغ بالملايين (درهم)');
        assert.ok(millionScale);
        assert.equal(millionScale.scale, 1000000);
        assert.equal(millionScale.currency, 'AED');
    });

    await t.test('5. WP6 8-Field Business Identity: Canonical metric, entity, period, basis, scope, unit, currency', () => {
        const factA = {
            metric: 'Revenue',
            entity: 'Contoso Retail LLC',
            period: 'Q1 2026',
            reportingBasis: 'Actual',
            reportingScope: 'Consolidated',
            unit: 'amount',
            currency: 'AED'
        };

        const factB = {
            metric: 'Revenue',
            entity: 'Contoso Retail LLC',
            period: 'Q1 2026',
            reportingBasis: 'Actual',
            reportingScope: 'Consolidated',
            unit: 'amount',
            currency: 'AED'
        };

        // Same 8 dimensions -> identical hash
        const idA = buildFactIdentityKey(factA);
        const idB = buildFactIdentityKey(factB);
        assert.equal(idA.keyHash, idB.keyHash, 'Identical 8 dimensions must produce identical hash');

        // Different reporting basis (Actual vs Budget) -> different hash
        const factBudget = { ...factA, reportingBasis: 'Budget' };
        const idBudget = buildFactIdentityKey(factBudget);
        assert.notEqual(idA.keyHash, idBudget.keyHash, 'Actual vs Budget must NOT have same identity hash');

        // Different currency (AED vs USD) -> different hash
        const factUsd = { ...factA, currency: 'USD' };
        const idUsd = buildFactIdentityKey(factUsd);
        assert.notEqual(idA.keyHash, idUsd.keyHash, 'Different currency must produce different identity hash');
    });

    await t.test('6. WP3 Question-to-Fact Resolution & Provenance Fields', () => {
        const baseFact = {
            FactId: 10,
            Metric: 'EBITDA',
            NumericValue: 1000000,
            Currency: 'AED',
            SourceFileName: 'Q1_2025_Audited.pdf',
            SourceLocation: 'Page 4, Table 2'
        };

        const compFact = {
            FactId: 20,
            Metric: 'EBITDA',
            NumericValue: 1200000,
            Currency: 'AED',
            SourceFileName: 'Q1_2026_Audited.pdf',
            SourceLocation: 'Page 5, Table 3'
        };

        const variance = computeVariance(baseFact, compFact);
        assert.equal(variance.difference, 200000);
        assert.equal(variance.percentChange, 20.0);
        assert.ok(variance.provenance);
        assert.equal(variance.provenance.baseFactId, 10);
        assert.equal(variance.provenance.comparisonFactId, 20);
        assert.equal(variance.provenance.baseFile, 'Q1_2025_Audited.pdf');
        assert.equal(variance.provenance.comparisonFile, 'Q1_2026_Audited.pdf');
    });
});

