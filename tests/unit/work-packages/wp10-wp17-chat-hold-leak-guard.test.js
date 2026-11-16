// tests/wp10-wp17-chat-hold-leak-guard.test.js
// Test Suite for WP10 (Data Leak Guard) and WP17 (Chat Hold Enforcement & HTTP 409)

const test = require('node:test');
const assert = require('node:assert/strict');

const { chatHandler } = require('../../../src/functions/chat');
const { getFactsWithConflictContext } = require('../../../src/services/conflict-resolver');
const { setPool, resetPool } = require('../../../src/services/sql');

function createMockHttpRequest({ method = 'POST', body = {}, headers = {} }) {
    const hMap = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
    return {
        method,
        url: 'http://localhost/api/chat',
        headers: {
            get: (key) => hMap.get(key.toLowerCase()) || null
        },
        json: async () => body
    };
}

const mockContext = {
    log: () => {},
    warn: () => {},
    error: () => {}
};

test('WP10 & WP17: Data Leak Guard & Chat Hold Enforcement', async (t) => {

    await t.test('1. WP17 & Rule A.8: Document with ConflictHold = 1 returns HTTP 409 and CONFLICT_PENDING', async () => {
        const mockHeldDoc = {
            DocumentId: 1001,
            FileName: 'Contoso_Q1_2026_Disputed.xlsx',
            IngestionStatus: 'PendingApproval',
            ConflictHold: 1,
            OpenConflictId: 777
        };

        const mockPool = {
            connected: true,
            request: () => ({
                input: () => mockPool.request(),
                query: async (q) => {
                    if (q.includes('FROM dbo.Documents') && q.includes('DocumentId = @DocumentId')) {
                        return { recordset: [mockHeldDoc] };
                    }
                    return { recordset: [] };
                }
            })
        };

        setPool(mockPool);

        const req = createMockHttpRequest({
            body: {
                question: 'What is the Operating Profit for Q1 2026 in Contoso_Q1_2026_Disputed.xlsx?',
                documentId: 1001
            }
        });

        const res = await chatHandler(req, mockContext);
        assert.equal(res.status, 409, 'Conflict-held document must return HTTP 409');

        const body = JSON.parse(res.body);
        assert.equal(body.status, 'CONFLICT_PENDING');
        assert.equal(body.documentId, 1001);
        assert.equal(body.openConflictId, 777);
        assert.equal(body.insufficientEvidence, true);
        assert.deepEqual(body.sources, []);
        assert.ok(body.answer.includes('conflict governance review'));

        resetPool();
    });

    await t.test('2. WP10: getFactsWithConflictContext excludes facts from held documents (ConflictHold = 1)', async () => {
        const queries = [];

        const mockPool = {
            connected: true,
            request: () => ({
                input: () => mockPool.request(),
                query: async (q) => {
                    queries.push(q);
                    return { recordset: [] };
                }
            })
        };

        setPool(mockPool);
        await getFactsWithConflictContext(null, null);

        const factsQuery = queries.find(q => q.includes('FROM dbo.FinancialFacts f'));
        assert.ok(factsQuery, 'Must issue query on FinancialFacts');
        assert.ok(factsQuery.includes("ISNULL(d.ConflictHold, 0) = 0"), 'Query must filter ISNULL(d.ConflictHold, 0) = 0');
        assert.ok(factsQuery.includes("f.MappingStatus = 'Approved'"), 'Query must require MappingStatus = Approved');
        resetPool();
    });

    await t.test('3. WP10: Chat retrieval excludes facts with unapproved MappingStatus (Pending, NeedsReview, Rejected, Superseded)', async () => {
        const approvedDoc = {
            DocumentId: 1002,
            FileName: 'Contoso_Audited_Annual.pdf',
            IngestionStatus: 'Succeeded',
            ConflictHold: 0
        };

        const factsInDb = [
            {
                FactId: 1,
                DocumentId: 1002,
                Metric: 'Revenue',
                Entity: 'Contoso Retail LLC',
                PeriodLabel: 'FY2025',
                NumericValue: 5000000,
                NormalizedValue: 5000000,
                Currency: 'AED',
                MappingStatus: 'Approved',
                AllowedUserGroups: '*'
            },
            {
                FactId: 2,
                DocumentId: 1002,
                Metric: 'PreliminaryEBITDA',
                Entity: 'Contoso Retail LLC',
                PeriodLabel: 'FY2025',
                NumericValue: 1200000,
                NormalizedValue: 1200000,
                Currency: 'AED',
                MappingStatus: 'NeedsReview', // Unapproved
                AllowedUserGroups: '*'
            }
        ];

        const mockPool = {
            connected: true,
            request: () => ({
                input: () => mockPool.request(),
                query: async (q) => {
                    if (q.includes('FROM dbo.Documents') && q.includes('DocumentId = @DocumentId')) {
                        return { recordset: [approvedDoc] };
                    }
                    if (q.includes('FROM dbo.FinancialFacts f') && q.includes("f.MappingStatus = 'Approved'")) {
                        // The SQL engine returns only the Approved fact
                        return { recordset: [factsInDb[0]] };
                    }
                    if (q.includes('FROM dbo.FactConflicts c')) {
                        return { recordset: [] };
                    }
                    return { recordset: [] };
                }
            })
        };

        setPool(mockPool);

        const facts = await getFactsWithConflictContext(1002, ['finance-team']);
        assert.equal(facts.length, 1, 'Only Approved facts must be returned');
        assert.equal(facts[0].Metric, 'Revenue');
        assert.equal(facts[0].MappingStatus, 'Approved');

        resetPool();
    });

    await t.test('4. WP10 & WP17: Existing master document also receives HTTP 409 when held by open conflict', async () => {
        // Both documents in conflict have ConflictHold = 1
        const existingMasterDoc = {
            DocumentId: 100,
            FileName: 'Contoso_Approved_Master.xlsx',
            IngestionStatus: 'Succeeded',
            ConflictHold: 1, // On hold because an incoming document conflicted with it
            OpenConflictId: 888
        };

        const mockPool = {
            connected: true,
            request: () => ({
                input: () => mockPool.request(),
                query: async (q) => {
                    if (q.includes('FROM dbo.Documents') && q.includes('DocumentId = @DocumentId')) {
                        return { recordset: [existingMasterDoc] };
                    }
                    return { recordset: [] };
                }
            })
        };

        setPool(mockPool);

        const req = createMockHttpRequest({
            body: {
                question: 'What was the Net Income in Contoso_Approved_Master.xlsx?',
                documentId: 100
            }
        });

        const res = await chatHandler(req, mockContext);
        assert.equal(res.status, 409, 'Existing document under conflict hold must return HTTP 409');

        const body = JSON.parse(res.body);
        assert.equal(body.status, 'CONFLICT_PENDING');
        assert.equal(body.documentId, 100);
        assert.deepEqual(body.sources, []);
        assert.equal(body.insufficientEvidence, true);

        resetPool();
    });
});
