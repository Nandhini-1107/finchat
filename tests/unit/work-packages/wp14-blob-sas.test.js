// tests/wp14-blob-sas.test.js
// Test Suite for WP14: Blob Storage & Read-Only SAS Generation

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const {
    generateBlobSasUrl,
    uploadBufferToBlob,
    DEFAULT_CONTAINER
} = require('../../../src/services/blob-storage');

const {
    createDocument,
    setPool,
    resetPool
} = require('../../../src/services/sql');

test('WP14: Blob Storage & Read-Only SAS Generation', async (t) => {

    const testAccountName = 'finchatstoragetest';
    const testAccountKey = crypto.randomBytes(32).toString('base64');
    const testContainer = 'financial-records';
    const testBlobName = 'reports/2026/contoso_q1.xlsx';

    await t.test('1. generateBlobSasUrl: Generates compliant Azure Blob read-only SAS URL with 72h TTL', () => {
        const sasUrl = generateBlobSasUrl({
            accountName: testAccountName,
            accountKey: testAccountKey,
            containerName: testContainer,
            blobName: testBlobName,
            ttlHours: 72
        });

        assert.ok(sasUrl.startsWith(`https://${testAccountName}.blob.core.windows.net/${testContainer}/${testBlobName}?`));

        const parsedUrl = new URL(sasUrl);
        assert.equal(parsedUrl.searchParams.get('sp'), 'r', 'Permissions must be read-only (r)');
        assert.equal(parsedUrl.searchParams.get('sr'), 'b', 'Resource must be blob (b)');
        assert.equal(parsedUrl.searchParams.get('spr'), 'https', 'Protocol must be HTTPS only');
        assert.equal(parsedUrl.searchParams.get('sv'), '2020-10-02', 'Storage API version');

        const st = new Date(parsedUrl.searchParams.get('st'));
        const se = new Date(parsedUrl.searchParams.get('se'));
        assert.ok(!isNaN(st.getTime()), 'Start time must be valid ISO timestamp');
        assert.ok(!isNaN(se.getTime()), 'Expiry time must be valid ISO timestamp');

        const diffHours = (se.getTime() - st.getTime()) / (3600 * 1000);
        // Approximately 72 hours (+ 5 minutes clock skew)
        assert.ok(diffHours >= 72 && diffHours <= 72.2, `Expected ~72 hours difference, got ${diffHours}`);

        const sig = parsedUrl.searchParams.get('sig');
        assert.ok(sig, 'Signature (sig) must be present in query params');
        assert.ok(sig.length > 20, 'Signature must be a non-trivial base64 string');
    });

    await t.test('2. Custom TTL: Supports configurable expiration (e.g. 24 hours)', () => {
        const sasUrl24 = generateBlobSasUrl({
            accountName: testAccountName,
            accountKey: testAccountKey,
            containerName: testContainer,
            blobName: testBlobName,
            ttlHours: 24
        });

        const parsedUrl = new URL(sasUrl24);
        const st = new Date(parsedUrl.searchParams.get('st'));
        const se = new Date(parsedUrl.searchParams.get('se'));
        const diffHours = (se.getTime() - st.getTime()) / (3600 * 1000);
        assert.ok(diffHours >= 24 && diffHours <= 24.2, `Expected ~24 hours difference, got ${diffHours}`);
    });

    await t.test('3. uploadBufferToBlob: Validates inputs and returns valid BlobUri', async () => {
        const buffer = Buffer.from('PDF_SAMPLE_HEADER_%PDF-1.7_DATA');
        const res = await uploadBufferToBlob({
            containerName: 'finchat-documents',
            blobName: 'contoso_test.pdf',
            buffer,
            contentType: 'application/pdf'
        });

        assert.equal(res.success, true);
        assert.ok(res.blobUri.includes('/finchat-documents/contoso_test.pdf'));
        assert.equal(res.contentType, 'application/pdf');
        assert.equal(res.sizeBytes, buffer.length);
    });

    await t.test('4. Input validation: Requires blobName and valid Buffer', async () => {
        await assert.rejects(
            async () => uploadBufferToBlob({ buffer: Buffer.from('data') }),
            /blobName is required/
        );

        await assert.rejects(
            async () => uploadBufferToBlob({ blobName: 'file.pdf', buffer: 'not-a-buffer' }),
            /buffer must be a valid Buffer/
        );

        assert.throws(
            () => generateBlobSasUrl({ blobName: '' }),
            /blobName is required/
        );
    });

    await t.test('5. createDocument stores BlobUri in dbo.Documents', async () => {
        let insertedBlobUri = null;
        let insertedDocName = null;

        const mockPool = {
            connected: true,
            request: () => ({
                input: (name, type, val) => {
                    if (name === 'BlobUri') insertedBlobUri = val;
                    if (name === 'FileName') insertedDocName = val;
                    return mockPool.request();
                },
                query: async (q) => {
                    if (q.includes('IF NOT EXISTS (SELECT 1 FROM dbo.SourceAuthorityRanks')) {
                        return { rowsAffected: [0] };
                    }
                    if (q.includes('INSERT INTO dbo.Documents')) {
                        return { recordset: [{ DocumentId: 888 }] };
                    }
                    return { recordset: [] };
                }
            })
        };

        setPool(mockPool);
        const testBlobUri = 'https://finchatstorage.blob.core.windows.net/finchat-documents/uploads/doc888.pdf';
        const docId = await createDocument({
            fileName: 'doc888.pdf',
            sourceType: 'ManualUpload',
            authorityRank: 4,
            blobUri: testBlobUri
        });

        assert.equal(docId, 888);
        assert.equal(insertedBlobUri, testBlobUri);
        assert.equal(insertedDocName, 'doc888.pdf');
        resetPool();
    });
});

