// phase4-4-1-security-integration-audit.test.js
// Comprehensive test suite for Phase 4.4.1 & Phase 4.4.2 Conflict Workflow Security & Integration Audit.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { generateDecisionToken, hashToken, DEFAULT_TTL_HOURS } = require('../../../src/services/conflict-token');
const { setPool, resetPool, ensureDatabaseSchema } = require('../../../src/services/sql');
const { confirmConflictHandler, sanitizeUrlForLogging, SECURITY_HEADERS, LEGITIMATE_PENDING_STATUSES } = require('../../../src/functions/confirmConflict');
const { chatHandler } = require('../../../src/functions/chat');

// In-memory mock database pool generator for audit testing
function createAuditMockSqlPool(initialState = {}) {
    const state = {
        conflicts: JSON.parse(JSON.stringify(initialState.conflicts || [])),
        facts: JSON.parse(JSON.stringify(initialState.facts || [])),
        documents: JSON.parse(JSON.stringify(initialState.documents || [])),
        resolutions: [],
        audits: [],
        batches: []
    };

    function executeQuery(text, params) {
        // 1. SELECT by ConflictId (getConflictById)
        if (text.includes('WHERE c.ConflictId = @ConflictId')) {
            const conflictId = Number(params.ConflictId);
            const c = state.conflicts.find(x => x.ConflictId === conflictId);
            if (!c) return { recordset: [] };
            const fExist = state.facts.find(x => x.FactId === c.ExistingFactId);
            const fInc = state.facts.find(x => x.FactId === c.IncomingFactId);
            const dExist = state.documents.find(x => x.DocumentId === (fExist ? fExist.DocumentId : null));
            const dInc = state.documents.find(x => x.DocumentId === (fInc ? fInc.DocumentId : null));

            return {
                recordset: [{
                    ...c,
                    ExistingFactId: c.ExistingFactId,
                    IncomingFactId: c.IncomingFactId,
                    ExistingDocumentId: dExist ? dExist.DocumentId : null,
                    IncomingDocumentId: dInc ? dInc.DocumentId : null,
                    ExistingFileName: dExist ? dExist.FileName : 'Master_Doc.pdf',
                    IncomingFileName: dInc ? dInc.FileName : 'Candidate_Doc.xlsx',
                    ExistingNormalizedValue: fExist?.NormalizedValue,
                    IncomingNormalizedValue: fInc?.NormalizedValue,
                    ExistingValue: fExist?.NormalizedValue,
                    IncomingValue: fInc?.NormalizedValue,
                    ExistingMetric: fExist?.Metric || fExist?.CanonicalMetric || 'Revenue',
                    IncomingMetric: fInc?.Metric || fInc?.CanonicalMetric || 'Revenue',
                    ExistingEntity: fExist?.Entity || fExist?.EntityName || 'Holding Corp',
                    IncomingEntity: fInc?.Entity || fInc?.EntityName || 'Holding Corp',
                    ExistingPeriodLabel: fExist?.PeriodLabel || 'FY 2025',
                    IncomingPeriodLabel: fInc?.PeriodLabel || 'FY 2025',
                    DifferenceValue: c.DifferenceValue || 500000,
                    DifferencePercentage: c.DifferencePercentage || 5.0,
                    DecisionTokenHash: c.DecisionTokenHash
                }]
            };
        }

        // 2. UPDATE dbo.FinancialFacts SET MappingStatus
        if (text.includes('UPDATE dbo.FinancialFacts') && text.includes('MappingStatus =')) {
            const factId = params.FactId !== undefined ? Number(params.FactId) : null;
            const docId = params.DocId !== undefined ? Number(params.DocId) : null;

            if (factId !== null) {
                const fact = state.facts.find(x => x.FactId === factId);
                if (fact) {
                    if (text.includes("'Approved'")) fact.MappingStatus = 'Approved';
                    else if (text.includes("'Rejected'")) fact.MappingStatus = 'Rejected';
                    else if (text.includes("'Superseded'")) fact.MappingStatus = 'Superseded';
                    else if (text.includes("'Pending'")) fact.MappingStatus = 'Pending';
                }
            } else if (docId !== null && text.includes("MappingStatus = 'Approved'")) {
                state.facts.filter(x => x.DocumentId === docId && x.MappingStatus === 'Pending')
                    .forEach(f => { f.MappingStatus = 'Approved'; });
            }
            return { recordset: [] };
        }

        // 3. UPDATE dbo.FactConflicts
        if (text.includes('UPDATE dbo.FactConflicts')) {
            const conflictId = Number(params.ConflictId);
            const c = state.conflicts.find(x => x.ConflictId === conflictId);
            let rows = 0;
            if (c) {
                const isPending = ['PendingApproval', 'PendingReview', 'Detected', 'Potential'].includes(c.ConflictStatus);
                if (!text.includes('ConflictStatus IN') || isPending) {
                    rows = 1;
                    if (params.Status) c.ConflictStatus = params.Status;
                    if (params.SelectedFactId !== undefined) c.SelectedFactId = params.SelectedFactId ? Number(params.SelectedFactId) : null;
                    if (params.Reason) c.ResolutionReason = params.Reason;
                    if (params.ReviewedBy) c.ReviewedBy = params.ReviewedBy;
                    c.ReviewedAt = new Date().toISOString();
                }
            }
            return { recordset: [], rowsAffected: [rows] };
        }

        // 4. INSERT INTO dbo.FactResolutions
        if (text.includes('INSERT INTO dbo.FactResolutions')) {
            state.resolutions.push({
                ResolutionId: state.resolutions.length + 1,
                ConflictId: params.ConflictId,
                SelectedFactId: params.SelectedFactId,
                ResolutionType: params.ResolutionType,
                ResolutionReason: params.ResolutionReason,
                ResolvedBy: params.ResolvedBy,
                NewStatus: params.NewStatus,
                ResolvedAt: new Date().toISOString()
            });
            return { recordset: [] };
        }

        // 5. INSERT INTO dbo.FactAudit
        if (text.includes('INSERT INTO dbo.FactAudit')) {
            state.audits.push({
                AuditId: state.audits.length + 1,
                FactId: params.FactId,
                DocumentId: params.DocId,
                ActionType: params.ActionType,
                OldValue: params.OldVal,
                NewValue: params.NewVal,
                ActionReason: params.Reason,
                ActionBy: params.By,
                ActionAt: new Date().toISOString()
            });
            return { recordset: [] };
        }

        // 6. SELECT COUNT(*) AS PendingCount FROM dbo.FactConflicts
        if (text.includes('SELECT COUNT(*) AS PendingCount')) {
            const docId = Number(params.DocId);
            const pending = state.conflicts.filter(c => {
                const incomingFact = state.facts.find(f => f.FactId === c.IncomingFactId);
                return incomingFact && incomingFact.DocumentId === docId &&
                    ['PendingApproval', 'PendingReview', 'Detected', 'Potential'].includes(c.ConflictStatus);
            });
            return { recordset: [{ PendingCount: pending.length }] };
        }

        // 7. SELECT COUNT(CASE WHEN MappingStatus...
        if (text.includes('COUNT(CASE WHEN MappingStatus') || text.includes('ApprovedCount')) {
            const docId = Number(params.DocId || params.ExistingDocId || params.DocumentId);
            const docFacts = state.facts.filter(f => f.DocumentId === docId);
            const approved = docFacts.filter(f => f.MappingStatus === 'Approved').length;
            const rejected = docFacts.filter(f => f.MappingStatus === 'Rejected').length;
            const superseded = docFacts.filter(f => f.MappingStatus === 'Superseded').length;
            return {
                recordset: [{
                    ApprovedCount: approved,
                    RejectedCount: rejected,
                    SupersededCount: superseded,
                    TotalCount: docFacts.length
                }]
            };
        }

        // 8. UPDATE dbo.Documents SET IngestionStatus
        if (text.includes('UPDATE dbo.Documents')) {
            const docId = Number(params.DocId || params.DocumentId || params.ExistingDocId);
            const doc = state.documents.find(x => x.DocumentId === docId);
            if (doc) {
                if (params.DocStatus) doc.IngestionStatus = params.DocStatus;
                else if (params.Status) doc.IngestionStatus = params.Status;
                else if (text.includes("'Succeeded'")) doc.IngestionStatus = 'Succeeded';
                else if (text.includes("'PendingApproval'")) doc.IngestionStatus = 'PendingApproval';
                else if (text.includes("'Rejected'")) doc.IngestionStatus = 'Rejected';
                else if (text.includes("'PartiallyApproved'")) doc.IngestionStatus = 'PartiallyApproved';
                else if (text.includes("'Superseded'")) doc.IngestionStatus = 'Superseded';
            }
            return { recordset: [] };
        }

        // 9. SELECT from Documents (getDocumentById in chat.js)
        if (text.includes('FROM dbo.Documents') && text.includes('WHERE DocumentId =')) {
            const docId = Number(params.DocumentId || params.DocId);
            const doc = state.documents.find(x => x.DocumentId === docId);
            return { recordset: doc ? [doc] : [] };
        }

        // 10. SELECT unapproved/rejected/pending facts for PartiallyApproved document
        if ((text.includes("MappingStatus = 'Rejected'") || text.includes("MappingStatus IN ('Rejected', 'Pending')")) && text.includes('FROM dbo.FinancialFacts')) {
            const docId = Number(params.DocId);
            const unapproved = state.facts.filter(f => f.DocumentId === docId && (f.MappingStatus === 'Rejected' || f.MappingStatus === 'Pending'));
            return {
                recordset: unapproved.map(f => ({
                    Metric: f.Metric || f.CanonicalMetric || 'Revenue',
                    NormalizedValue: f.NormalizedValue,
                    Currency: f.Currency || 'AED',
                    MappingStatus: f.MappingStatus
                }))
            };
        }

        // 11. SELECT disallowed documents for search filter
        if (text.includes('WHERE IngestionStatus IN')) {
            const excluded = state.documents.filter(d =>
                ['PendingApproval', 'PendingReview', 'Pending', 'Rejected', 'Failed', 'Superseded', 'PartiallyApproved'].includes(d.IngestionStatus)
            );
            return {
                recordset: excluded.map(d => ({ FileName: d.FileName }))
            };
        }

        // 12. SELECT facts for getFactsWithConflictContext
        if (text.includes('FROM dbo.FinancialFacts f') && text.includes('JOIN dbo.Documents d')) {
            let res = state.facts.map(f => {
                const doc = state.documents.find(d => d.DocumentId === f.DocumentId) || {};
                return {
                    ...f,
                    FactId: f.FactId,
                    DocumentId: f.DocumentId,
                    Metric: f.Metric || f.CanonicalMetric,
                    Entity: f.Entity || f.EntityName,
                    PeriodLabel: f.PeriodLabel || f.PeriodName,
                    NormalizedValue: f.NormalizedValue ?? f.NumericValue,
                    NumericValue: f.NormalizedValue ?? f.NumericValue,
                    NormalizedUnit: f.NormalizedUnit || f.Unit,
                    Unit: f.NormalizedUnit || f.Unit,
                    Currency: f.Currency,
                    MappingStatus: f.MappingStatus || 'Approved',
                    IngestionStatus: doc.IngestionStatus || 'Succeeded',
                    SourceFileName: doc.FileName || f.SourceFileName,
                    AuthorityRank: f.AuthorityRank || 4,
                    AuthorityType: 'Audited Financials',
                    ValidationStatus: f.ValidationStatus || 'Validated',
                    CreatedAt: f.CreatedAt || new Date().toISOString()
                };
            });

            if (text.includes("MappingStatus = 'Approved'")) {
                res = res.filter(x => (x.MappingStatus === 'Approved' || !x.MappingStatus) &&
                    (x.IngestionStatus === 'Succeeded' || x.IngestionStatus === 'Completed' || x.IngestionStatus === 'PartiallyApproved'));
            }
            if (params.DocumentId) {
                res = res.filter(x => x.DocumentId === Number(params.DocumentId));
            }
            return { recordset: res };
        }

        // 13. SELECT active conflicts for getFactsWithConflictContext
        if (text.includes('FROM dbo.FactConflicts c') && text.includes('LEFT JOIN dbo.FactConflictRecords')) {
            return { recordset: [] };
        }

        return { recordset: [], rowsAffected: [1] };
    }

    function createMockRequest() {
        const req = {
            params: {},
            input(name, typeOrVal, val) {
                req.params[name] = val !== undefined ? val : typeOrVal;
                return req;
            },
            async query(text) {
                return executeQuery(text, req.params);
            },
            async batch(text) {
                state.batches.push(text);
                return { recordset: [] };
            }
        };
        return req;
    }

    const mockPool = {
        state,
        connected: true,
        request: createMockRequest,
        transaction() {
            const snapshot = JSON.stringify(state);
            return {
                request: createMockRequest,
                async begin() { },
                async commit() { },
                async rollback() {
                    const restored = JSON.parse(snapshot);
                    Object.assign(state, restored);
                }
            };
        }
    };

    return mockPool;
}

// Create a simulated HTTP request for testing Azure Function HTTP triggers
function createMockHttpRequest({
    method = 'GET',
    url = 'http://localhost/api/confirmConflict',
    query = {},
    body = null,
    headers = {}
} = {}) {
    const queryMap = new Map(Object.entries(query));
    const headerMap = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));

    return {
        method: method.toUpperCase(),
        url,
        query: queryMap,
        headers: {
            get(name) {
                return headerMap.get(name.toLowerCase()) || null;
            }
        },
        async json() {
            if (body === null || body === undefined) throw new Error('No body');
            if (typeof body === 'string') return JSON.parse(body);
            return body;
        },
        async text() {
            if (typeof body === 'string') return body;
            if (body && typeof body === 'object') {
                return new URLSearchParams(body).toString();
            }
            return '';
        }
    };
}

function createMockFunctionContext() {
    const logs = [];
    const errors = [];
    return {
        log: (msg) => logs.push(String(msg)),
        error: (msg) => errors.push(String(msg)),
        warn: (msg) => logs.push(`[WARN] ${msg}`),
        logs,
        errors
    };
}

test('Phase 4.4.1 & Phase 4.4.2: Conflict Workflow Security and Integration Audit', async (t) => {

    // ------------------------------------------------------------------------
    // AUDIT 1 & RFC 7231 TEST: GET Requests MUST NOT Mutate Financial State
    // ------------------------------------------------------------------------
    await t.test('1. Security: GET requests are strictly read-only and never mutate database state even if action is in query', async () => {
        const token = generateDecisionToken({ conflictId: 101, recipientEmail: 'cfo@contoso.com' });
        const tokenHash = hashToken(token);

        const mock = createAuditMockSqlPool({
            conflicts: [{
                ConflictId: 101,
                ConflictStatus: 'PendingApproval',
                ExistingFactId: 1,
                IncomingFactId: 2,
                DecisionTokenHash: tokenHash
            }],
            facts: [
                { FactId: 1, DocumentId: 1, NormalizedValue: 1000, MappingStatus: 'Approved' },
                { FactId: 2, DocumentId: 2, NormalizedValue: 1200, MappingStatus: 'Pending' }
            ],
            documents: [
                { DocumentId: 1, FileName: 'Annual_Report_2025.pdf', IngestionStatus: 'Succeeded' },
                { DocumentId: 2, FileName: 'Interim_Update_2025.xlsx', IngestionStatus: 'PendingApproval' }
            ]
        });
        setPool(mock);

        try {
            const req = createMockHttpRequest({
                method: 'GET',
                url: `https://finchat.contoso.com/api/confirmConflict?token=${encodeURIComponent(token)}&action=accept_incoming`,
                query: { token, action: 'accept_incoming' },
                headers: { 'accept': 'text/html' }
            });
            const ctx = createMockFunctionContext();

            const res = await confirmConflictHandler(req, ctx);

            assert.equal(res.status, 200);
            assert.ok(res.headers['Content-Type'].includes('text/html'));
            assert.ok(res.body.includes('Conflict Review & Authorization'));
            assert.ok(res.body.includes('form method="POST" action="/api/confirmConflict"'));

            const conflict = mock.state.conflicts.find(c => c.ConflictId === 101);
            assert.equal(conflict.ConflictStatus, 'PendingApproval', 'Conflict status must remain PendingApproval on GET');

            const fact1 = mock.state.facts.find(f => f.FactId === 1);
            const fact2 = mock.state.facts.find(f => f.FactId === 2);
            assert.equal(fact1.MappingStatus, 'Approved', 'Existing fact must remain Approved');
            assert.equal(fact2.MappingStatus, 'Pending', 'Incoming fact must remain Pending');

            const doc2 = mock.state.documents.find(d => d.DocumentId === 2);
            assert.equal(doc2.IngestionStatus, 'PendingApproval', 'Document status must remain PendingApproval');

            assert.equal(mock.state.resolutions.length, 0, 'No resolution record may be created on GET');
            assert.equal(mock.state.audits.length, 0, 'No audit record may be created on GET');
        } finally {
            resetPool();
        }
    });

    await t.test('2. RFC 7231 Safe Methods: GET with Accept: application/json returns PENDING_DECISION without mutation', async () => {
        const token = generateDecisionToken({ conflictId: 102, recipientEmail: 'cfo@contoso.com' });
        const tokenHash = hashToken(token);

        const mock = createAuditMockSqlPool({
            conflicts: [{
                ConflictId: 102,
                ConflictStatus: 'PendingApproval',
                ExistingFactId: 3,
                IncomingFactId: 4,
                DecisionTokenHash: tokenHash
            }],
            facts: [
                { FactId: 3, DocumentId: 1, NormalizedValue: 5000, MappingStatus: 'Approved' },
                { FactId: 4, DocumentId: 2, NormalizedValue: 5500, MappingStatus: 'Pending' }
            ],
            documents: [
                { DocumentId: 1, FileName: 'Doc1.pdf', IngestionStatus: 'Succeeded' },
                { DocumentId: 2, FileName: 'Doc2.xlsx', IngestionStatus: 'PendingApproval' }
            ]
        });
        setPool(mock);

        try {
            const req = createMockHttpRequest({
                method: 'GET',
                url: `https://finchat.contoso.com/api/confirmConflict?token=${encodeURIComponent(token)}`,
                query: { token },
                headers: { 'accept': 'application/json' }
            });
            const ctx = createMockFunctionContext();

            const res = await confirmConflictHandler(req, ctx);
            assert.equal(res.status, 200);

            const json = JSON.parse(res.body);
            assert.equal(json.status, 'PENDING_DECISION');
            assert.equal(json.conflictId, 102);
            assert.ok(json.instructions.includes('POST'));

            assert.equal(mock.state.conflicts[0].ConflictStatus, 'PendingApproval');
        } finally {
            resetPool();
        }
    });

    // ------------------------------------------------------------------------
    // AUDIT 2: Token Security, Expiry, and Revocation Verification
    // ------------------------------------------------------------------------
    await t.test('3. Token Validation: Missing token returns 400 Bad Request', async () => {
        const mock = createAuditMockSqlPool();
        setPool(mock);

        try {
            const req = createMockHttpRequest({ method: 'GET', query: {}, headers: { 'accept': 'application/json' } });
            const ctx = createMockFunctionContext();
            const res = await confirmConflictHandler(req, ctx);
            assert.equal(res.status, 400);
            const json = JSON.parse(res.body);
            assert.equal(json.status, 'BAD_REQUEST');
        } finally {
            resetPool();
        }
    });

    await t.test('4. Token Validation: Forged or altered token signature returns 401 Unauthorized', async () => {
        const validToken = generateDecisionToken({ conflictId: 103, recipientEmail: 'cfo@contoso.com' });
        const forgedToken = validToken.substring(0, validToken.length - 5) + 'AAAAA';

        const mock = createAuditMockSqlPool();
        setPool(mock);

        try {
            const req = createMockHttpRequest({ method: 'POST', query: { token: forgedToken, action: 'keep_existing' }, headers: { 'accept': 'application/json' } });
            const ctx = createMockFunctionContext();
            const res = await confirmConflictHandler(req, ctx);
            assert.equal(res.status, 401);
            const json = JSON.parse(res.body);
            assert.equal(json.status, 'INVALID_TOKEN');
        } finally {
            resetPool();
        }
    });

    await t.test('5. Token Validation: Expired token returns 410 Gone', async () => {
        const expiredToken = generateDecisionToken({ conflictId: 104, recipientEmail: 'cfo@contoso.com', ttlHours: -1 });

        const mock = createAuditMockSqlPool();
        setPool(mock);

        try {
            const req = createMockHttpRequest({ method: 'POST', query: { token: expiredToken, action: 'keep_existing' }, headers: { 'accept': 'application/json' } });
            const ctx = createMockFunctionContext();
            const res = await confirmConflictHandler(req, ctx);
            assert.equal(res.status, 410);
            const json = JSON.parse(res.body);
            assert.equal(json.status, 'TOKEN_EXPIRED');
        } finally {
            resetPool();
        }
    });

    await t.test('6. Token Hash Verification: Mismatch with stored token hash returns 401', async () => {
        const token1 = generateDecisionToken({ conflictId: 105, recipientEmail: 'cfo@contoso.com' });
        const token2 = generateDecisionToken({ conflictId: 105, recipientEmail: 'cfo@contoso.com' });
        const storedHash = hashToken(token1);

        const mock = createAuditMockSqlPool({
            conflicts: [{
                ConflictId: 105,
                ConflictStatus: 'PendingApproval',
                ExistingFactId: 5,
                IncomingFactId: 6,
                DecisionTokenHash: storedHash
            }]
        });
        setPool(mock);

        try {
            const req = createMockHttpRequest({
                method: 'POST',
                query: { token: token2, action: 'keep_existing' },
                headers: { 'accept': 'application/json' }
            });
            const ctx = createMockFunctionContext();
            const res = await confirmConflictHandler(req, ctx);
            assert.equal(res.status, 401);
            const json = JSON.parse(res.body);
            assert.equal(json.status, 'INVALID_TOKEN_HASH');
        } finally {
            resetPool();
        }
    });

    // ------------------------------------------------------------------------
    // PHASE 4.4.2 PRIORITY ITEM 1: NULL OR MISSING DecisionTokenHash REJECTION
    // ------------------------------------------------------------------------
    await t.test('7. Phase 4.4.2 Priority Item 1: Missing or NULL DecisionTokenHash in conflict record is rejected (MUST NEVER BYPASS)', async () => {
        const token = generateDecisionToken({ conflictId: 106, recipientEmail: 'cfo@contoso.com' });

        // Database record has DecisionTokenHash as NULL
        const mock = createAuditMockSqlPool({
            conflicts: [{
                ConflictId: 106,
                ConflictStatus: 'PendingApproval',
                ExistingFactId: 7,
                IncomingFactId: 8,
                DecisionTokenHash: null // NULL in database!
            }]
        });
        setPool(mock);

        try {
            const req = createMockHttpRequest({
                method: 'POST',
                body: { token, action: 'keep_existing' },
                headers: { 'content-type': 'application/json', 'accept': 'application/json' }
            });
            const ctx = createMockFunctionContext();
            const res = await confirmConflictHandler(req, ctx);

            // MUST REJECT with 401 - never bypass token validation when stored hash is null!
            assert.equal(res.status, 401);
            const json = JSON.parse(res.body);
            assert.equal(json.status, 'INVALID_TOKEN_HASH');
            assert.ok(json.error.includes('Decision token does not match the active authorization record'));
        } finally {
            resetPool();
        }
    });

    // ------------------------------------------------------------------------
    // PHASE 4.4.2 PRIORITY ITEM 5: DECISION-PAGE SECURITY HEADERS
    // ------------------------------------------------------------------------
    await t.test('8. Phase 4.4.2 Priority Item 5: All HTTP responses contain security headers preventing token caching and leakage', async () => {
        const token = generateDecisionToken({ conflictId: 107, recipientEmail: 'cfo@contoso.com' });
        const tokenHash = hashToken(token);

        const mock = createAuditMockSqlPool({
            conflicts: [{
                ConflictId: 107,
                ConflictStatus: 'PendingApproval',
                ExistingFactId: 9,
                IncomingFactId: 10,
                DecisionTokenHash: tokenHash
            }]
        });
        setPool(mock);

        try {
            const req = createMockHttpRequest({
                method: 'GET',
                query: { token },
                headers: { 'accept': 'text/html' }
            });
            const ctx = createMockFunctionContext();
            const res = await confirmConflictHandler(req, ctx);

            assert.equal(res.status, 200);
            assert.ok(res.headers['Cache-Control'].includes('no-store'), 'Must disable caching (no-store)');
            assert.ok(res.headers['Cache-Control'].includes('no-cache'), 'Must disable caching (no-cache)');
            assert.equal(res.headers['X-Frame-Options'], 'DENY', 'Must prevent clickjacking (DENY)');
            assert.equal(res.headers['Referrer-Policy'], 'no-referrer', 'Must prevent token leakage in referer');
            assert.equal(res.headers['X-Content-Type-Options'], 'nosniff', 'Must prevent MIME sniffing');
            assert.ok(res.headers['Content-Security-Policy'].includes("default-src 'self'"), 'Must enforce CSP');
        } finally {
            resetPool();
        }
    });

    // ------------------------------------------------------------------------
    // PHASE 4.4.2 PRIORITY ITEM 4: PRODUCTION SECRET VALIDATION
    // ------------------------------------------------------------------------
    await t.test('9. Phase 4.4.2 Priority Item 4: Production secret validation detects Azure deployment environment', () => {
        const originalEnv = process.env.NODE_ENV;
        const originalAzureEnv = process.env.AZURE_FUNCTIONS_ENVIRONMENT;
        const originalSite = process.env.WEBSITE_SITE_NAME;
        const originalSecret = process.env.FINCHAT_CONFLICT_SECRET;
        const originalJwt = process.env.JWT_SECRET;

        try {
            delete process.env.FINCHAT_CONFLICT_SECRET;
            delete process.env.JWT_SECRET;

            // Scenario A: NODE_ENV = 'production'
            process.env.NODE_ENV = 'production';
            assert.throws(() => {
                generateDecisionToken({ conflictId: 999, recipientEmail: 'test@contoso.com' });
            }, /Security Error: FINCHAT_CONFLICT_SECRET or JWT_SECRET must be configured in production/);

            // Scenario B: Azure Functions runtime deployment in Azure (AZURE_FUNCTIONS_ENVIRONMENT = 'Production')
            process.env.NODE_ENV = '';
            process.env.AZURE_FUNCTIONS_ENVIRONMENT = 'Production';
            assert.throws(() => {
                generateDecisionToken({ conflictId: 999, recipientEmail: 'test@contoso.com' });
            }, /Security Error: FINCHAT_CONFLICT_SECRET or JWT_SECRET must be configured in production/);

            // Scenario C: Azure App Service deployment (WEBSITE_SITE_NAME is set)
            process.env.AZURE_FUNCTIONS_ENVIRONMENT = '';
            process.env.WEBSITE_SITE_NAME = 'finchat-prod-app';
            assert.throws(() => {
                generateDecisionToken({ conflictId: 999, recipientEmail: 'test@contoso.com' });
            }, /Security Error: FINCHAT_CONFLICT_SECRET or JWT_SECRET must be configured in production/);
        } finally {
            if (originalEnv !== undefined) process.env.NODE_ENV = originalEnv; else delete process.env.NODE_ENV;
            if (originalAzureEnv !== undefined) process.env.AZURE_FUNCTIONS_ENVIRONMENT = originalAzureEnv; else delete process.env.AZURE_FUNCTIONS_ENVIRONMENT;
            if (originalSite !== undefined) process.env.WEBSITE_SITE_NAME = originalSite; else delete process.env.WEBSITE_SITE_NAME;
            if (originalSecret !== undefined) process.env.FINCHAT_CONFLICT_SECRET = originalSecret; else delete process.env.FINCHAT_CONFLICT_SECRET;
            if (originalJwt !== undefined) process.env.JWT_SECRET = originalJwt; else delete process.env.JWT_SECRET;
        }
    });

    // ------------------------------------------------------------------------
    // AUDIT 3: State Machine & Document Ingestion Status Resolution
    // ------------------------------------------------------------------------
    await t.test('10. State Machine: POST with keep_existing sets incoming fact Rejected and document IngestionStatus to Rejected', async () => {
        const token = generateDecisionToken({ conflictId: 201, recipientEmail: 'cfo@contoso.com' });
        const tokenHash = hashToken(token);

        const mock = createAuditMockSqlPool({
            conflicts: [{
                ConflictId: 201,
                ConflictStatus: 'PendingApproval',
                ExistingFactId: 11,
                IncomingFactId: 12,
                DecisionTokenHash: tokenHash
            }],
            facts: [
                { FactId: 11, DocumentId: 10, NormalizedValue: 10000000, MappingStatus: 'Approved' },
                { FactId: 12, DocumentId: 20, NormalizedValue: 12000000, MappingStatus: 'Pending' }
            ],
            documents: [
                { DocumentId: 10, FileName: 'Audited_Master.pdf', IngestionStatus: 'Succeeded' },
                { DocumentId: 20, FileName: 'Erroneous_Draft.xlsx', IngestionStatus: 'PendingApproval' }
            ]
        });
        setPool(mock);

        try {
            const req = createMockHttpRequest({
                method: 'POST',
                body: { token, action: 'keep_existing', notes: 'Audited statutory numbers confirmed' },
                headers: { 'content-type': 'application/json', 'accept': 'application/json' }
            });
            const ctx = createMockFunctionContext();
            const res = await confirmConflictHandler(req, ctx);

            assert.equal(res.status, 200);
            const json = JSON.parse(res.body);
            assert.equal(json.status, 'SUCCESS');
            assert.equal(json.newStatus, 'ApprovedExisting');

            const doc20 = mock.state.documents.find(d => d.DocumentId === 20);
            assert.equal(doc20.IngestionStatus, 'Rejected', 'Document whose facts were all rejected must have IngestionStatus = Rejected');

            const fact11 = mock.state.facts.find(f => f.FactId === 11);
            assert.equal(fact11.MappingStatus, 'Approved');

            const fact12 = mock.state.facts.find(f => f.FactId === 12);
            assert.equal(fact12.MappingStatus, 'Rejected');
        } finally {
            resetPool();
        }
    });

    await t.test('11. State Machine: POST with accept_incoming marks incoming Approved, supersedes existing (NEVER DELETES), and document Succeeded', async () => {
        const token = generateDecisionToken({ conflictId: 202, recipientEmail: 'cfo@contoso.com' });
        const tokenHash = hashToken(token);

        const mock = createAuditMockSqlPool({
            conflicts: [{
                ConflictId: 202,
                ConflictStatus: 'PendingApproval',
                ExistingFactId: 21,
                IncomingFactId: 22,
                DecisionTokenHash: tokenHash
            }],
            facts: [
                { FactId: 21, DocumentId: 30, NormalizedValue: 10000000, MappingStatus: 'Approved' },
                { FactId: 22, DocumentId: 40, NormalizedValue: 12000000, MappingStatus: 'Pending' }
            ],
            documents: [
                { DocumentId: 30, FileName: 'Prior_Filing.pdf', IngestionStatus: 'Succeeded' },
                { DocumentId: 40, FileName: 'Restated_Filing.pdf', IngestionStatus: 'PendingApproval' }
            ]
        });
        setPool(mock);

        try {
            const req = createMockHttpRequest({
                method: 'POST',
                body: { token, action: 'accept_incoming', notes: 'Restatement approved by board' },
                headers: { 'content-type': 'application/json', 'accept': 'application/json' }
            });
            const ctx = createMockFunctionContext();
            const res = await confirmConflictHandler(req, ctx);

            assert.equal(res.status, 200);
            const json = JSON.parse(res.body);
            assert.equal(json.status, 'SUCCESS');
            assert.equal(json.newStatus, 'ApprovedIncoming');

            const fact22 = mock.state.facts.find(f => f.FactId === 22);
            assert.equal(fact22.MappingStatus, 'Approved');

            const fact21 = mock.state.facts.find(f => f.FactId === 21);
            assert.ok(fact21, 'Existing historical fact must NEVER be deleted');
            assert.equal(fact21.MappingStatus, 'Superseded');

            const doc40 = mock.state.documents.find(d => d.DocumentId === 40);
            assert.equal(doc40.IngestionStatus, 'Succeeded');
        } finally {
            resetPool();
        }
    });

    await t.test('12. Single-Use Enforcement: Repeat decision on already resolved conflict via POST is rejected with 409', async () => {
        const token = generateDecisionToken({ conflictId: 203, recipientEmail: 'cfo@contoso.com' });
        const tokenHash = hashToken(token);

        const mock = createAuditMockSqlPool({
            conflicts: [{
                ConflictId: 203,
                ConflictStatus: 'ApprovedExisting',
                ReviewedBy: 'prior-cfo@contoso.com',
                ReviewedAt: new Date().toISOString(),
                ExistingFactId: 31,
                IncomingFactId: 32,
                DecisionTokenHash: tokenHash
            }]
        });
        setPool(mock);

        try {
            const req = createMockHttpRequest({
                method: 'POST',
                body: { token, action: 'accept_incoming' },
                headers: { 'content-type': 'application/json', 'accept': 'application/json' }
            });
            const ctx = createMockFunctionContext();
            const res = await confirmConflictHandler(req, ctx);

            assert.equal(res.status, 409);
            const json = JSON.parse(res.body);
            assert.equal(json.status, 'ALREADY_RESOLVED');
        } finally {
            resetPool();
        }
    });

    await t.test('13. Single-Use Enforcement: GET on already resolved conflict displays already resolved notification', async () => {
        const token = generateDecisionToken({ conflictId: 204, recipientEmail: 'cfo@contoso.com' });
        const tokenHash = hashToken(token);

        const mock = createAuditMockSqlPool({
            conflicts: [{
                ConflictId: 204,
                ConflictStatus: 'ApprovedIncoming',
                ReviewedBy: 'cfo@contoso.com',
                ReviewedAt: new Date().toISOString(),
                ExistingFactId: 41,
                IncomingFactId: 42,
                DecisionTokenHash: tokenHash
            }]
        });
        setPool(mock);

        try {
            const req = createMockHttpRequest({
                method: 'GET',
                query: { token },
                headers: { 'accept': 'text/html' }
            });
            const ctx = createMockFunctionContext();
            const res = await confirmConflictHandler(req, ctx);

            assert.equal(res.status, 200);
            assert.ok(res.body.includes('Conflict #204 Already Resolved'));
            assert.ok(res.body.includes('ApprovedIncoming'));
        } finally {
            resetPool();
        }
    });

    // ------------------------------------------------------------------------
    // PHASE 4.4.2 PRIORITY ITEM 6: ONLY LEGITIMATE PENDING STATES CAN BE RESOLVED
    // ------------------------------------------------------------------------
    await t.test('14. Phase 4.4.2 Priority Item 6: Only legitimate pending states (PendingApproval, PendingReview, Detected, Potential) are resolvable', async () => {
        const nonPendingStates = ['ApprovedExisting', 'ApprovedIncoming', 'Resolved', 'Dismissed', 'AutoResolved', 'Rejected'];

        for (const status of nonPendingStates) {
            const token = generateDecisionToken({ conflictId: 250, recipientEmail: 'cfo@contoso.com' });
            const tokenHash = hashToken(token);

            const mock = createAuditMockSqlPool({
                conflicts: [{
                    ConflictId: 250,
                    ConflictStatus: status,
                    DecisionTokenHash: tokenHash
                }]
            });
            setPool(mock);

            try {
                const req = createMockHttpRequest({
                    method: 'POST',
                    body: { token, action: 'keep_existing' },
                    headers: { 'content-type': 'application/json', 'accept': 'application/json' }
                });
                const ctx = createMockFunctionContext();
                const res = await confirmConflictHandler(req, ctx);

                assert.equal(res.status, 409, `Conflict status "${status}" must be rejected with 409`);
                const json = JSON.parse(res.body);
                assert.equal(json.status, 'ALREADY_RESOLVED');
            } finally {
                resetPool();
            }
        }
    });

    // ------------------------------------------------------------------------
    // AUDIT 4: Security Logging & CWE-532 Token Redaction
    // ------------------------------------------------------------------------
    await t.test('15. CWE-532 Prevention: Decision token is redacted in server request logs', async () => {
        const secretToken = 'eyJhbGciOiJIUzI1NiJ9.testsecrettoken12345';
        const rawUrl = `https://finchat.azurewebsites.net/api/confirmConflict?token=${secretToken}&action=keep_existing`;

        const sanitized = sanitizeUrlForLogging(rawUrl);
        assert.ok(!sanitized.includes(secretToken), 'Raw secret token must not appear in sanitized URL');
        assert.ok(sanitized.includes('token=[REDACTED]'), 'Token must be replaced with [REDACTED]');

        const token = generateDecisionToken({ conflictId: 301, recipientEmail: 'cfo@contoso.com' });
        const tokenHash = hashToken(token);

        const mock = createAuditMockSqlPool({
            conflicts: [{ ConflictId: 301, ConflictStatus: 'PendingApproval', DecisionTokenHash: tokenHash }]
        });
        setPool(mock);

        try {
            const ctx = createMockFunctionContext();
            const req = createMockHttpRequest({
                method: 'GET',
                url: `https://finchat.contoso.com/api/confirmConflict?token=${token}`,
                query: { token }
            });
            await confirmConflictHandler(req, ctx);

            const urlLog = ctx.logs.find(l => l.includes('Conflict resolution request:'));
            assert.ok(urlLog, 'Request must be logged');
            assert.ok(!urlLog.includes(token), 'Raw token must be redacted from server logs');
            assert.ok(urlLog.includes('[REDACTED]'));
        } finally {
            resetPool();
        }
    });

    await t.test('16. Reviewer Authorization: Unauthorized reviewer rejected with 403 Forbidden', async () => {
        const token = generateDecisionToken({ conflictId: 302, recipientEmail: 'cfo@contoso.com' });
        const tokenHash = hashToken(token);

        const mock = createAuditMockSqlPool({
            conflicts: [{ ConflictId: 302, ConflictStatus: 'PendingApproval', DecisionTokenHash: tokenHash }]
        });
        setPool(mock);

        try {
            const req = createMockHttpRequest({
                method: 'POST',
                body: { token, action: 'keep_existing', reviewer: 'unauthorized-user@othercorp.com' },
                headers: { 'content-type': 'application/json', 'accept': 'application/json' }
            });
            const ctx = createMockFunctionContext();
            const res = await confirmConflictHandler(req, ctx);

            assert.equal(res.status, 403);
            const json = JSON.parse(res.body);
            assert.equal(json.status, 'FORBIDDEN');
        } finally {
            resetPool();
        }
    });

    // ------------------------------------------------------------------------
    // AUDIT 5 & PHASE 4.4.2 PRIORITY ITEMS 2 & 3: CHAT & SEARCH ISOLATION
    // ------------------------------------------------------------------------
    await t.test('17. Chat Isolation: Document with PendingApproval returns PENDING_APPROVAL and blocks retrieval', async () => {
        const mock = createAuditMockSqlPool({
            documents: [
                { DocumentId: 501, FileName: 'Unapproved_Financials.pdf', IngestionStatus: 'PendingApproval' }
            ]
        });
        setPool(mock);

        try {
            const req = createMockHttpRequest({
                method: 'POST',
                body: { question: 'What was the Net Income in Unapproved_Financials.pdf?', documentId: 501 },
                headers: { 'content-type': 'application/json' }
            });
            const ctx = createMockFunctionContext();
            const res = await chatHandler(req, ctx);

            assert.equal(res.status, 200);
            const json = JSON.parse(res.body);
            assert.equal(json.status, 'PENDING_APPROVAL');
            assert.ok(json.answer.includes('conflicts awaiting human approval'));
            assert.equal(json.insufficientEvidence, true);
        } finally {
            resetPool();
        }
    });

    await t.test('18. Chat Isolation: Document with Rejected returns REJECTED status and blocks retrieval', async () => {
        const mock = createAuditMockSqlPool({
            documents: [
                { DocumentId: 502, FileName: 'Rejected_Draft.xlsx', IngestionStatus: 'Rejected' }
            ]
        });
        setPool(mock);

        try {
            const req = createMockHttpRequest({
                method: 'POST',
                body: { question: 'What was the Revenue in Rejected_Draft.xlsx?', documentId: 502 },
                headers: { 'content-type': 'application/json' }
            });
            const ctx = createMockFunctionContext();
            const res = await chatHandler(req, ctx);

            assert.equal(res.status, 200);
            const json = JSON.parse(res.body);
            assert.equal(json.status, 'REJECTED');
            assert.ok(json.answer.includes('rejected during conflict governance review'));
            assert.equal(json.insufficientEvidence, true);
        } finally {
            resetPool();
        }
    });

    // ------------------------------------------------------------------------
    // PHASE 4.4.2 PRIORITY ITEM 3: PartiallyApproved DOCUMENTS NARRATIVE RAG PROTECTION
    // ------------------------------------------------------------------------
    await t.test('19. Phase 4.4.2 Priority Item 3: PartiallyApproved documents reject questions asking for rejected metrics', async () => {
        const mock = createAuditMockSqlPool({
            documents: [
                { DocumentId: 503, FileName: 'Partially_Approved_Statement.xlsx', IngestionStatus: 'PartiallyApproved' }
            ],
            facts: [
                { FactId: 101, DocumentId: 503, Metric: 'Operating Expenses', NormalizedValue: 3500000, MappingStatus: 'Approved' },
                { FactId: 102, DocumentId: 503, Metric: 'Net Profit', NormalizedValue: 12000000, MappingStatus: 'Rejected' }
            ]
        });
        setPool(mock);

        try {
            // Ask about the REJECTED fact in this PartiallyApproved document
            const req = createMockHttpRequest({
                method: 'POST',
                body: { question: 'What was the Net Profit in Partially_Approved_Statement.xlsx?', documentId: 503 },
                headers: { 'content-type': 'application/json' }
            });
            const ctx = createMockFunctionContext();
            const res = await chatHandler(req, ctx);

            assert.equal(res.status, 200);
            const json = JSON.parse(res.body);
            assert.equal(json.status, 'REJECTED_FACT');
            assert.ok(json.answer.includes('explicitly rejected during financial conflict resolution'));
            assert.equal(json.insufficientEvidence, true);
        } finally {
            resetPool();
        }
    });

    await t.test('20. Phase 4.4.2 Priority Item 3: PartiallyApproved document with unapproved figure suppresses narrative RAG fallback', async () => {
        const mock = createAuditMockSqlPool({
            documents: [
                { DocumentId: 504, FileName: 'Partial_Report.xlsx', IngestionStatus: 'PartiallyApproved' }
            ],
            facts: [
                // Only Cash and Bank is approved
                { FactId: 201, DocumentId: 504, Metric: 'Cash and Bank', NormalizedValue: 500000, MappingStatus: 'Approved' }
            ]
        });
        setPool(mock);

        try {
            // Ask about a metric not approved in SQL (e.g. EBITDA)
            const req = createMockHttpRequest({
                method: 'POST',
                body: { question: 'What was EBITDA according to Partial_Report.xlsx?', documentId: 504 },
                headers: { 'content-type': 'application/json' }
            });
            const ctx = createMockFunctionContext();
            const res = await chatHandler(req, ctx);

            assert.equal(res.status, 200);
            const json = JSON.parse(res.body);
            // Narrative RAG must be suppressed
            assert.ok(json.answer.includes('partial approval') || json.answer.includes('Unapproved narrative'));
            assert.equal(json.insufficientEvidence, true);
        } finally {
            resetPool();
        }
    });

    // ------------------------------------------------------------------------
    // AUDIT 6: Schema Index Performance Idempotency
    // ------------------------------------------------------------------------
    await t.test('21. Database Schema: ensureDatabaseSchema idempotently creates performance indexes on FactConflicts', async () => {
        const mock = createAuditMockSqlPool();

        await ensureDatabaseSchema(mock);

        const allBatches = mock.state.batches.join('\n');
        assert.ok(allBatches.includes('IX_FactConflicts_TokenHash'), 'Schema must define index on DecisionTokenHash');
        assert.ok(allBatches.includes('IX_FactConflicts_NotificationStatus'), 'Schema must define index on NotificationStatus');
        assert.ok(allBatches.includes('IX_FactConflicts_Status'), 'Schema must define index on ConflictStatus');
    });

    // ------------------------------------------------------------------------
    // PHASE 4.4.2 PRIORITY ITEM 2 & 3: SUPERSEDED & PENDING IN PartiallyApproved
    // ------------------------------------------------------------------------
    await t.test('22. Phase 4.4.2 Priority Item 2: Document with Superseded status returns SUPERSEDED and blocks retrieval', async () => {
        const mock = createAuditMockSqlPool({
            documents: [
                { DocumentId: 505, FileName: 'Prior_Superseded_Filing.pdf', IngestionStatus: 'Superseded' }
            ]
        });
        setPool(mock);

        try {
            const req = createMockHttpRequest({
                method: 'POST',
                body: { question: 'What was the Revenue in Prior_Superseded_Filing.pdf?', documentId: 505 },
                headers: { 'content-type': 'application/json' }
            });
            const ctx = createMockFunctionContext();
            const res = await chatHandler(req, ctx);

            assert.equal(res.status, 200);
            const json = JSON.parse(res.body);
            assert.equal(json.status, 'SUPERSEDED');
            assert.ok(json.answer.includes('superseded by a more authoritative or restated financial filing'));
            assert.equal(json.insufficientEvidence, true);
        } finally {
            resetPool();
        }
    });

    await t.test('23. Phase 4.4.2 Priority Item 3: PartiallyApproved document with a Pending fact returns PENDING_FACT', async () => {
        const mock = createAuditMockSqlPool({
            documents: [
                { DocumentId: 506, FileName: 'Multi_Conflict_Doc.xlsx', IngestionStatus: 'PartiallyApproved' }
            ],
            facts: [
                { FactId: 301, DocumentId: 506, Metric: 'Total Revenue', NormalizedValue: 50000000, MappingStatus: 'Approved' },
                { FactId: 302, DocumentId: 506, Metric: 'Net Profit', NormalizedValue: 12000000, MappingStatus: 'Pending' }
            ]
        });
        setPool(mock);

        try {
            const req = createMockHttpRequest({
                method: 'POST',
                body: { question: 'What was the Net Profit in Multi_Conflict_Doc.xlsx?', documentId: 506 },
                headers: { 'content-type': 'application/json' }
            });
            const ctx = createMockFunctionContext();
            const res = await chatHandler(req, ctx);

            assert.equal(res.status, 200);
            const json = JSON.parse(res.body);
            assert.equal(json.status, 'PENDING_FACT');
            assert.ok(json.answer.includes('currently pending human conflict review'));
            assert.equal(json.insufficientEvidence, true);
        } finally {
            resetPool();
        }
    });

    await t.test('24. Phase 4.4.2 Priority Item 2 & 6: accept_incoming supersedes older document when all its facts are superseded', async () => {
        const token = generateDecisionToken({ conflictId: 401, recipientEmail: 'cfo@contoso.com' });
        const tokenHash = hashToken(token);

        const mock = createAuditMockSqlPool({
            conflicts: [{
                ConflictId: 401,
                ConflictStatus: 'PendingApproval',
                ExistingFactId: 51,
                IncomingFactId: 52,
                DecisionTokenHash: tokenHash
            }],
            facts: [
                { FactId: 51, DocumentId: 601, NormalizedValue: 10000000, MappingStatus: 'Approved' },
                { FactId: 52, DocumentId: 602, NormalizedValue: 11000000, MappingStatus: 'Pending' }
            ],
            documents: [
                { DocumentId: 601, FileName: 'Old_Report.pdf', IngestionStatus: 'Succeeded' },
                { DocumentId: 602, FileName: 'New_Restatement.pdf', IngestionStatus: 'PendingApproval' }
            ]
        });
        setPool(mock);

        try {
            const req = createMockHttpRequest({
                method: 'POST',
                body: { token, action: 'accept_incoming', notes: 'Restatement approved' },
                headers: { 'content-type': 'application/json', 'accept': 'application/json' }
            });
            const ctx = createMockFunctionContext();
            const res = await confirmConflictHandler(req, ctx);

            assert.equal(res.status, 200);
            const json = JSON.parse(res.body);
            assert.equal(json.status, 'SUCCESS');

            const oldDoc = mock.state.documents.find(d => d.DocumentId === 601);
            assert.equal(oldDoc.IngestionStatus, 'Superseded', 'Old document whose facts were all superseded must have IngestionStatus = Superseded');

            const newDoc = mock.state.documents.find(d => d.DocumentId === 602);
            assert.equal(newDoc.IngestionStatus, 'Succeeded');
        } finally {
            resetPool();
        }
    });
});
