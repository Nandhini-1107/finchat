// tests/wp18-observability.test.js
// Test Suite for WP18: Observability, Audit Logs & Metrics Dashboard

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    getSystemGovernanceMetrics,
    getAuditTrail
} = require('../../../src/services/observability');

const { setPool, resetPool } = require('../../../src/services/sql');

test('WP18: Observability, Audit Logs & Metrics Dashboard', async (t) => {

    await t.test('1. getSystemGovernanceMetrics: Aggregates system metrics accurately', async () => {
        const mockPool = {
            connected: true,
            request: () => ({
                query: async (q) => {
                    if (q.includes('FROM dbo.Documents')) {
                        return {
                            recordset: [{
                                TotalDocuments: 15,
                                SucceededDocuments: 12,
                                PendingApprovalDocuments: 1,
                                PartiallyApprovedDocuments: 1,
                                RejectedDocuments: 1,
                                SupersededDocuments: 0,
                                FailedDocuments: 0,
                                HeldDocuments: 2
                            }]
                        };
                    }
                    if (q.includes('FROM dbo.FinancialFacts')) {
                        return {
                            recordset: [{
                                TotalFacts: 120,
                                ApprovedFacts: 100,
                                NeedsReviewFacts: 5,
                                PendingFacts: 10,
                                RejectedFacts: 5,
                                SupersededFacts: 0
                            }]
                        };
                    }
                    if (q.includes('FROM dbo.FactConflicts')) {
                        return {
                            recordset: [{
                                TotalConflicts: 4,
                                ActiveConflicts: 2,
                                ResolvedConflicts: 2,
                                MootConflicts: 0
                            }]
                        };
                    }
                    return { recordset: [] };
                }
            })
        };

        setPool(mockPool);
        const metrics = await getSystemGovernanceMetrics();

        assert.equal(metrics.documents.TotalDocuments, 15);
        assert.equal(metrics.documents.SucceededDocuments, 12);
        assert.equal(metrics.documents.HeldDocuments, 2);
        assert.equal(metrics.facts.ApprovedFacts, 100);
        assert.equal(metrics.facts.NeedsReviewFacts, 5);
        assert.equal(metrics.conflicts.ActiveConflicts, 2);
        assert.equal(metrics.health.isHealthy, true);
        assert.equal(metrics.health.hasActiveHolds, true);

        resetPool();
    });

    await t.test('2. getAuditTrail: Filters by documentId and factId', async () => {
        let queriedDocumentId = null;

        const mockPool = {
            connected: true,
            request: () => ({
                input: (name, type, val) => {
                    if (name === 'DocumentId') queriedDocumentId = val;
                    return mockPool.request();
                },
                query: async (q) => {
                    return {
                        recordset: [
                            {
                                AuditId: 1001,
                                FactId: 50,
                                DocumentId: 200,
                                ActionType: 'ConflictResolvedPromoted',
                                NewValue: '3500000',
                                ActionReason: 'Approved by human reviewer',
                                ActionBy: 'cfo@contoso.com'
                            }
                        ]
                    };
                }
            })
        };

        setPool(mockPool);
        const logs = await getAuditTrail({ documentId: 200 });

        assert.equal(logs.length, 1);
        assert.equal(logs[0].DocumentId, 200);
        assert.equal(logs[0].ActionType, 'ConflictResolvedPromoted');
        assert.equal(queriedDocumentId, 200);

        resetPool();
    });
});

