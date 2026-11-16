// tests/wp16-decision-cascade.test.js
// Test Suite for WP16: Decision Cascade Engine & Document State Propagation

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    applyConflictDecision,
    setPool,
    resetPool
} = require('../../../src/services/sql');

test('WP16: Decision Cascade Engine & Document State Propagation', async (t) => {

    await t.test('1. accept_incoming: Promotes incoming fact, supersedes existing fact, supersedes document when all facts superseded', async () => {
        let incomingFactStatus = null;
        let existingFactStatus = null;
        let existingDocStatus = null;
        let auditRecorded = false;
        let resolutionRecorded = false;

        const mockConflict = {
            ConflictId: 161,
            ConflictStatus: 'PendingApproval',
            ExistingFactId: 10,
            IncomingFactId: 11,
            ExistingDocumentId: 100,
            IncomingDocumentId: 101,
            ExistingValue: 2500000,
            IncomingValue: 2600000
        };

        const mockTransaction = {
            begin: async () => {},
            commit: async () => {},
            rollback: async () => {},
            request: () => ({
                input: (name, type, val) => {
                    return mockTransaction.request();
                },
                query: async (q) => {
                    if (q.includes('SELECT c.ConflictId')) {
                        return { recordset: [mockConflict] };
                    }
                    if (q.includes("SET MappingStatus = 'Approved'") && q.includes('FactId = @FactId')) {
                        incomingFactStatus = 'Approved';
                        return { rowsAffected: [1] };
                    }
                    if (q.includes("SET MappingStatus = 'Superseded'") && q.includes('FactId = @FactId')) {
                        existingFactStatus = 'Superseded';
                        return { rowsAffected: [1] };
                    }
                    if (q.includes('FROM dbo.FinancialFacts') && q.includes('WHERE DocumentId = @ExistingDocId')) {
                        // All facts in existing doc are now superseded
                        return { recordset: [{ ApprovedCount: 0, SupersededCount: 3, TotalCount: 3 }] };
                    }
                    if (q.includes('UPDATE dbo.Documents') && q.includes("SET IngestionStatus = 'Superseded'")) {
                        existingDocStatus = 'Superseded';
                        return { rowsAffected: [1] };
                    }
                    if (q.includes('INSERT INTO dbo.FactResolutions')) {
                        resolutionRecorded = true;
                        return { rowsAffected: [1] };
                    }
                    if (q.includes('INSERT INTO dbo.FactAudit')) {
                        auditRecorded = true;
                        return { rowsAffected: [1] };
                    }
                    if (q.includes('FROM dbo.FactConflicts') && q.includes('WHERE f.DocumentId = @DocId')) {
                        // 0 pending conflicts remain
                        return { recordset: [{ PendingCount: 0 }] };
                    }
                    if (q.includes('FROM dbo.FinancialFacts') && q.includes('WHERE DocumentId = @DocId')) {
                        // 1 approved, 0 rejected
                        return { recordset: [{ ApprovedCount: 1, RejectedCount: 0, TotalCount: 1 }] };
                    }
                    return { recordset: [], rowsAffected: [1] };
                }
            })
        };

        const mockPool = {
            connected: true,
            transaction: () => mockTransaction,
            request: () => ({
                input: () => mockPool.request(),
                query: async (q) => {
                    if (q.includes('SELECT COUNT(*) AS ActiveConflictCount')) {
                        return { recordset: [{ ActiveConflictCount: 0 }] };
                    }
                    return { recordset: [], rowsAffected: [1] };
                }
            })
        };

        setPool(mockPool);
        const res = await applyConflictDecision(161, 'accept_incoming', {
            reviewerEmail: 'cfo@contoso.com',
            notes: 'Restatement audit adjustment approved'
        });

        assert.equal(res.success, true);
        assert.equal(res.newStatus, 'ApprovedIncoming');
        assert.equal(incomingFactStatus, 'Approved');
        assert.equal(existingFactStatus, 'Superseded');
        assert.equal(existingDocStatus, 'Superseded');
        assert.equal(resolutionRecorded, true);
        assert.equal(auditRecorded, true);
        resetPool();
    });

    await t.test('2. keep_existing: Retains existing fact as Approved, marks incoming as Rejected, sets document to Rejected if all rejected', async () => {
        let incomingFactStatus = null;
        let existingFactStatus = null;
        let incomingDocStatus = null;

        const mockConflict = {
            ConflictId: 162,
            ConflictStatus: 'PendingApproval',
            ExistingFactId: 20,
            IncomingFactId: 21,
            ExistingDocumentId: 200,
            IncomingDocumentId: 201,
            ExistingValue: 1500000,
            IncomingValue: 1400000
        };

        const mockTransaction = {
            begin: async () => {},
            commit: async () => {},
            rollback: async () => {},
            request: () => ({
                input: (name, type, val) => {
                    if (name === 'DocStatus') incomingDocStatus = val;
                    return mockTransaction.request();
                },
                query: async (q) => {
                    if (q.includes('SELECT c.ConflictId')) {
                        return { recordset: [mockConflict] };
                    }
                    if (q.includes("SET MappingStatus = 'Approved'")) {
                        existingFactStatus = 'Approved';
                        return { rowsAffected: [1] };
                    }
                    if (q.includes("SET MappingStatus = 'Rejected'")) {
                        incomingFactStatus = 'Rejected';
                        return { rowsAffected: [1] };
                    }
                    if (q.includes('FROM dbo.FactConflicts') && q.includes('WHERE f.DocumentId = @DocId')) {
                        return { recordset: [{ PendingCount: 0 }] };
                    }
                    if (q.includes('FROM dbo.FinancialFacts') && q.includes('WHERE DocumentId = @DocId')) {
                        // 0 approved, 1 rejected
                        return { recordset: [{ ApprovedCount: 0, RejectedCount: 1, TotalCount: 1 }] };
                    }
                    return { recordset: [], rowsAffected: [1] };
                }
            })
        };

        const mockPool = {
            connected: true,
            transaction: () => mockTransaction,
            request: () => ({
                input: () => mockPool.request(),
                query: async () => ({ recordset: [{ ActiveConflictCount: 0 }], rowsAffected: [1] })
            })
        };

        setPool(mockPool);
        const res = await applyConflictDecision(162, 'keep_existing', {
            reviewerEmail: 'auditor@contoso.com'
        });

        assert.equal(res.success, true);
        assert.equal(res.newStatus, 'ApprovedExisting');
        assert.equal(existingFactStatus, 'Approved');
        assert.equal(incomingFactStatus, 'Rejected');
        assert.equal(incomingDocStatus, 'Rejected');
        resetPool();
    });

    await t.test('3. PartiallyApproved: Document with mixed approved and rejected facts receives PartiallyApproved status', async () => {
        let incomingDocStatus = null;

        const mockConflict = {
            ConflictId: 163,
            ConflictStatus: 'PendingApproval',
            ExistingFactId: 30,
            IncomingFactId: 31,
            ExistingDocumentId: 300,
            IncomingDocumentId: 301,
            ExistingValue: 800000,
            IncomingValue: 850000
        };

        const mockTransaction = {
            begin: async () => {},
            commit: async () => {},
            rollback: async () => {},
            request: () => ({
                input: (name, type, val) => {
                    if (name === 'DocStatus') incomingDocStatus = val;
                    return mockTransaction.request();
                },
                query: async (q) => {
                    if (q.includes('SELECT c.ConflictId')) {
                        return { recordset: [mockConflict] };
                    }
                    if (q.includes('FROM dbo.FactConflicts') && q.includes('WHERE f.DocumentId = @DocId')) {
                        return { recordset: [{ PendingCount: 0 }] };
                    }
                    if (q.includes('FROM dbo.FinancialFacts') && q.includes('WHERE DocumentId = @DocId')) {
                        // 1 approved, 1 rejected -> PartiallyApproved
                        return { recordset: [{ ApprovedCount: 1, RejectedCount: 1, TotalCount: 2 }] };
                    }
                    return { recordset: [], rowsAffected: [1] };
                }
            })
        };

        const mockPool = {
            connected: true,
            transaction: () => mockTransaction,
            request: () => ({
                input: () => mockPool.request(),
                query: async () => ({ recordset: [{ ActiveConflictCount: 0 }], rowsAffected: [1] })
            })
        };

        setPool(mockPool);
        const res = await applyConflictDecision(163, 'keep_existing', {
            reviewerEmail: 'controller@contoso.com'
        });

        assert.equal(res.success, true);
        assert.equal(incomingDocStatus, 'PartiallyApproved');
        resetPool();
    });
});

