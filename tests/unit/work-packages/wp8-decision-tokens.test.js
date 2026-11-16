// tests/wp8-decision-tokens.test.js
// Test Suite for WP8: Cryptographic Decision Tokens & Safe HTTP Endpoints

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    generateDecisionToken,
    verifyDecisionToken,
    hashToken
} = require('../../../src/services/conflict-token');

const { confirmConflictHandler } = require('../../../src/functions/confirmConflict');
const { setPool, resetPool } = require('../../../src/services/sql');

function createMockRequest({ method = 'GET', url = 'http://localhost/api/confirmConflict', headers = {}, body = null, query = {} }) {
    const qMap = new Map(Object.entries(query));
    const hMap = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
    return {
        method,
        url,
        query: qMap,
        headers: {
            get: (key) => hMap.get(key.toLowerCase()) || null
        },
        json: async () => (body && typeof body === 'object' ? body : JSON.parse(body || '{}')),
        text: async () => (typeof body === 'string' ? body : JSON.stringify(body || {}))
    };
}

const mockContext = {
    log: () => {},
    warn: () => {},
    error: () => {}
};

test('WP8: Cryptographic Decision Tokens & Safe HTTP Endpoints', async (t) => {
    const validToken = generateDecisionToken({ conflictId: 501, recipientEmail: 'cfo@contoso.com' });
    const validHash = hashToken(validToken);

    const mockConflictRow = {
        ConflictId: 501,
        ConflictStatus: 'PendingApproval',
        DecisionTokenHash: validHash,
        NotificationRecipient: 'cfo@contoso.com',
        ExistingMetric: 'OperatingProfit',
        ExistingEntity: 'Contoso Retail LLC',
        ExistingPeriodLabel: 'Q1 2026',
        ReportingBasis: 'Actual',
        ExistingNormalizedValue: 500000.00,
        ExistingFileName: 'Contoso_Q1_Final.xlsx',
        IncomingNormalizedValue: 480000.00,
        IncomingFileName: 'Contoso_Q1_Draft.xlsx',
        DifferenceValue: -20000.00,
        DifferencePercentage: 4.00
    };

    const mockPool = {
        connected: true,
        request: () => ({
            input: () => mockPool.request(),
            query: async (q) => {
                if (q.includes('FROM dbo.FactConflicts') && q.includes('ConflictId = @ConflictId')) {
                    return { recordset: [mockConflictRow] };
                }
                if (q.includes('UPDATE dbo.FactConflicts') || q.includes('INSERT INTO dbo.FactResolutions')) {
                    return { rowsAffected: [1] };
                }
                return { recordset: [], rowsAffected: [1] };
            }
        }),
        transaction: () => ({
            begin: async () => {},
            commit: async () => {},
            rollback: async () => {},
            request: () => ({
                input: () => mockPool.transaction().request(),
                query: async (q) => {
                    if (q.includes('SELECT c.ConflictId')) {
                        return {
                            recordset: [{
                                ConflictId: 501,
                                ConflictStatus: 'PendingApproval',
                                ExistingFactId: 10,
                                IncomingFactId: 11,
                                ExistingDocumentId: 1,
                                IncomingDocumentId: 2,
                                ExistingValue: 500000.00,
                                IncomingValue: 480000.00
                            }]
                        };
                    }
                    return { recordset: [], rowsAffected: [1] };
                }
            })
        })
    };

    setPool(mockPool);

    await t.test('1. GET /api/confirmConflict: Read-only preview with figuresLost disclosure', async () => {
        const req = createMockRequest({
            method: 'GET',
            query: { token: validToken },
            headers: { accept: 'application/json' }
        });

        const res = await confirmConflictHandler(req, mockContext);
        assert.equal(res.status, 200);

        const body = JSON.parse(res.body);
        assert.equal(body.status, 'PENDING_DECISION');
        assert.equal(body.conflictId, 501);
        assert.equal(body.existingValue, 500000.00);
        assert.equal(body.incomingValue, 480000.00);
        assert.ok(body.figuresLost, 'figuresLost section must be present in preview');
        assert.ok(body.figuresLost.ifKeepExisting.includes('rejected'));
        assert.ok(body.figuresLost.ifAcceptIncoming.includes('superseded'));
    });

    await t.test('2. POST /api/confirmConflict: Accepts decision: "KEEP_EXISTING"', async () => {
        const req = createMockRequest({
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: { token: validToken, decision: 'KEEP_EXISTING', reviewer: 'cfo@contoso.com' }
        });

        const res = await confirmConflictHandler(req, mockContext);
        assert.equal(res.status, 200);

        const body = JSON.parse(res.body);
        assert.equal(body.status, 'SUCCESS');
        assert.equal(body.action, 'keep_existing');
        assert.equal(body.newStatus, 'ApprovedExisting');
    });

    await t.test('3. Single-Use Replay Protection: Returns 409 ConflictAlreadyResolved on already resolved conflict', async () => {
        // Change conflict status to ApprovedExisting in mock
        const prevStatus = mockConflictRow.ConflictStatus;
        mockConflictRow.ConflictStatus = 'ApprovedExisting';
        mockConflictRow.ReviewedBy = 'cfo@contoso.com';

        const req = createMockRequest({
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: { token: validToken, action: 'keep_existing', reviewer: 'cfo@contoso.com' }
        });

        const res = await confirmConflictHandler(req, mockContext);
        assert.equal(res.status, 409, 'Replay must return 409 ALREADY_RESOLVED');

        const body = JSON.parse(res.body);
        assert.equal(body.status, 'ALREADY_RESOLVED');

        mockConflictRow.ConflictStatus = prevStatus;
    });

    await t.test('4. Token Expiry: Returns 410 Gone on expired token', async () => {
        // Generate an already expired token (ttlHours: -1)
        const expiredToken = generateDecisionToken({ conflictId: 501, recipientEmail: 'cfo@contoso.com', ttlHours: -1 });

        const req = createMockRequest({
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: { token: expiredToken, action: 'keep_existing' }
        });

        const res = await confirmConflictHandler(req, mockContext);
        assert.equal(res.status, 410, 'Expired token must return HTTP 410');

        const body = JSON.parse(res.body);
        assert.equal(body.status, 'TOKEN_EXPIRED');
    });

    await t.test('5. Forged Token: Returns 401 Unauthorized on invalid signature', async () => {
        const forgedToken = validToken.substring(0, validToken.length - 6) + 'xxxxxx';

        const req = createMockRequest({
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: { token: forgedToken, action: 'keep_existing' }
        });

        const res = await confirmConflictHandler(req, mockContext);
        assert.equal(res.status, 401, 'Tampered signature must return HTTP 401');

        const body = JSON.parse(res.body);
        assert.equal(body.status, 'INVALID_TOKEN');
    });

    resetPool();
});
