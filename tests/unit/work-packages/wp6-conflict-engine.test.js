// tests/wp6-conflict-engine.test.js
// Test Suite for WP6: Conflict Detection Engine, AppLock & Pair Sequencing

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    buildFactIdentityKey,
    areFactsIdenticalIdentity,
    detectFinancialFactConflicts
} = require('../../../src/services/conflict-resolver');

const {
    recomputeDocumentHold,
    acquireFactAppLock,
    applyConflictDecision,
    setPool,
    resetPool
} = require('../../../src/services/sql');

test('WP6: Conflict Detection Engine, AppLock & Pair Sequencing', async (t) => {

    await t.test('1. 8-Field Fact Identity: Distinguishes on all 8 dimensions', () => {
        const baseFact = {
            metric: 'Revenue',
            entity: 'Contoso Retail LLC',
            period: 'Q1 2026',
            reportingBasis: 'Actual',
            reportingScope: 'Consolidated',
            unit: 'amount',
            currency: 'AED',
            dimensions: { department: 'Sales', region: 'MENA' }
        };

        const key1 = buildFactIdentityKey(baseFact);
        assert.ok(key1.keyHash, 'Key hash must be computed');
        assert.ok(key1.keyString.includes('metric=revenue'));
        assert.ok(key1.keyString.includes('entity=contoso retail llc'));
        assert.ok(key1.keyString.includes('period=q1 2026'));
        assert.ok(key1.keyString.includes('basis=actual'));
        assert.ok(key1.keyString.includes('scope=consolidated'));
        assert.ok(key1.keyString.includes('unit=amount'));
        assert.ok(key1.keyString.includes('curr=aed'));
        assert.ok(key1.keyString.includes('department=sales'));
        assert.ok(key1.keyString.includes('region=mena'));

        // Changing currency creates distinct identity
        const factDiffCurr = { ...baseFact, currency: 'USD' };
        assert.equal(areFactsIdenticalIdentity(baseFact, factDiffCurr), false);

        // Changing reportingScope creates distinct identity
        const factDiffScope = { ...baseFact, reportingScope: 'Standalone' };
        assert.equal(areFactsIdenticalIdentity(baseFact, factDiffScope), false);

        // Changing dimensions creates distinct identity
        const factDiffDim = { ...baseFact, dimensions: { department: 'Logistics', region: 'MENA' } };
        assert.equal(areFactsIdenticalIdentity(baseFact, factDiffDim), false);

        // Same facts have identical identity
        const factClone = { ...baseFact, dimensions: { region: 'MENA', department: 'Sales' } }; // order reversed
        assert.equal(areFactsIdenticalIdentity(baseFact, factClone), true);
    });

    await t.test('2. Tolerance Boundary D4: |diff| > 0.001 AND % > 0.01%', () => {
        const existingFact = {
            FactId: 101,
            DocumentId: 1,
            Metric: 'Revenue',
            Entity: 'Contoso Retail LLC',
            PeriodLabel: 'Q1 2026',
            ReportingBasis: 'Actual',
            ReportingScope: 'Consolidated',
            Unit: 'amount',
            Currency: 'AED',
            NormalizedValue: 1000000.00,
            MappingStatus: 'Approved',
            IngestionStatus: 'Succeeded'
        };

        // Within absolute tolerance (diff = 0.0005) -> NO conflict
        const incomingSubAbs = [{
            Metric: 'Revenue',
            Entity: 'Contoso Retail LLC',
            PeriodLabel: 'Q1 2026',
            ReportingBasis: 'Actual',
            ReportingScope: 'Consolidated',
            Unit: 'amount',
            Currency: 'AED',
            NormalizedValue: 1000000.0005
        }];
        const resSubAbs = detectFinancialFactConflicts(incomingSubAbs, [existingFact], { documentId: 2 });
        assert.equal(resSubAbs.length, 0, 'Sub-tolerance difference must not trigger conflict');

        // Outside absolute tolerance (> 0.001) but within percentage tolerance (<= 0.01% of 1M is 100 AED, diff = 50 AED) -> NO conflict
        const incomingSubPct = [{
            Metric: 'Revenue',
            Entity: 'Contoso Retail LLC',
            PeriodLabel: 'Q1 2026',
            ReportingBasis: 'Actual',
            ReportingScope: 'Consolidated',
            Unit: 'amount',
            Currency: 'AED',
            NormalizedValue: 1000050.00 // 0.005% diff
        }];
        const resSubPct = detectFinancialFactConflicts(incomingSubPct, [existingFact], { documentId: 2 });
        assert.equal(resSubPct.length, 0, 'Difference within percentage tolerance (0.005% <= 0.01%) must not trigger conflict');

        // Outside both tolerances: diff = 500 (> 0.001 and 0.05% > 0.01%) -> CONFLICT
        const incomingGenuine = [{
            Metric: 'Revenue',
            Entity: 'Contoso Retail LLC',
            PeriodLabel: 'Q1 2026',
            ReportingBasis: 'Actual',
            ReportingScope: 'Consolidated',
            Unit: 'amount',
            Currency: 'AED',
            NormalizedValue: 1000500.00
        }];
        const resGenuine = detectFinancialFactConflicts(incomingGenuine, [existingFact], { documentId: 2 });
        assert.equal(resGenuine.length, 1, 'Genuine mismatch outside both tolerances must trigger conflict');
        assert.equal(resGenuine[0].conflictStatus, 'PendingApproval');
    });

    await t.test('3. Scan against BOTH Approved and Pending facts', () => {
        const pendingFact = {
            FactId: 201,
            DocumentId: 3,
            Metric: 'EBITDA',
            Entity: 'Contoso Logistics LLC',
            PeriodLabel: 'Q2 2026',
            ReportingBasis: 'Actual',
            ReportingScope: 'Consolidated',
            Unit: 'amount',
            Currency: 'AED',
            NormalizedValue: 450000.00,
            MappingStatus: 'Pending',
            IngestionStatus: 'PendingApproval'
        };

        const incoming = [{
            Metric: 'EBITDA',
            Entity: 'Contoso Logistics LLC',
            PeriodLabel: 'Q2 2026',
            ReportingBasis: 'Actual',
            ReportingScope: 'Consolidated',
            Unit: 'amount',
            Currency: 'AED',
            NormalizedValue: 475000.00
        }];

        const conflicts = detectFinancialFactConflicts(incoming, [pendingFact], { documentId: 4 });
        assert.equal(conflicts.length, 1, 'Must detect conflict against existing Pending fact');
        assert.equal(conflicts[0].existingFactId, 201);
    });

    await t.test('4. Self-Version Conflicts: Same logical document requires human decision', () => {
        const existingDocFact = {
            FactId: 301,
            DocumentId: 10,
            Metric: 'NetIncome',
            Entity: 'Contoso Retail LLC',
            PeriodLabel: 'FY2025',
            ReportingBasis: 'Actual',
            ReportingScope: 'Consolidated',
            Unit: 'amount',
            Currency: 'AED',
            NormalizedValue: 1200000.00,
            MappingStatus: 'Approved',
            IngestionStatus: 'Succeeded'
        };

        // Incoming fact from a new document version (DocumentId: 11) for same logical document
        const incomingVersionFact = [{
            Metric: 'NetIncome',
            Entity: 'Contoso Retail LLC',
            PeriodLabel: 'FY2025',
            ReportingBasis: 'Actual',
            ReportingScope: 'Consolidated',
            Unit: 'amount',
            Currency: 'AED',
            NormalizedValue: 1250000.00
        }];

        const conflicts = detectFinancialFactConflicts(incomingVersionFact, [existingDocFact], {
            documentId: 11,
            fileName: 'Contoso_Retail_FY2025_v2.xlsx'
        });

        assert.equal(conflicts.length, 1);
        assert.equal(conflicts[0].conflictStatus, 'PendingApproval');
        assert.ok(conflicts[0].conflictDescription.includes('Value mismatch'));
    });

    await t.test('5. AppLock Serialization helper', async () => {
        let executedLock = false;
        const mockReq = {
            input: () => mockReq,
            query: async (q) => {
                if (q.includes('sp_getapplock')) {
                    executedLock = true;
                    return { recordset: [] };
                }
                return { recordset: [] };
            }
        };

        const locked = await acquireFactAppLock(mockReq, 'revenue_contoso_q1_2026', 5000);
        assert.equal(locked, true);
        assert.equal(executedLock, true);
    });

    await t.test('6. recomputeDocumentHold: Computes hold based on open conflicts', async () => {
        let updatedHold = null;
        let queriedDocId = null;

        const mockPool = {
            connected: true,
            request: () => ({
                input: (name, type, val) => {
                    if (name === 'DocumentId') queriedDocId = val;
                    if (name === 'ConflictHold') updatedHold = val;
                    return mockPool.request();
                },
                query: async (q) => {
                    if (q.includes('SELECT COUNT(*) AS ActiveConflictCount')) {
                        // Return 1 active conflict
                        return { recordset: [{ ActiveConflictCount: 1 }] };
                    }
                    if (q.includes('UPDATE dbo.Documents')) {
                        return { rowsAffected: [1] };
                    }
                    return { recordset: [] };
                }
            })
        };

        setPool(mockPool);
        const isHeld = await recomputeDocumentHold(99);
        assert.equal(isHeld, true);
        assert.equal(updatedHold, 1);
        assert.equal(queriedDocId, 99);
        resetPool();
    });

    await t.test('7. Moot Cascade & applyConflictDecision', async () => {
        let mootQueryExecuted = false;
        let decisionExecuted = false;

        const mockTransaction = {
            begin: async () => {},
            commit: async () => {},
            rollback: async () => {},
            request: () => ({
                input: () => mockTransaction.request(),
                query: async (q) => {
                    if (q.includes('SELECT c.ConflictId')) {
                        return {
                            recordset: [{
                                ConflictId: 55,
                                ConflictStatus: 'PendingApproval',
                                ExistingFactId: 101,
                                IncomingFactId: 102,
                                ExistingDocumentId: 1,
                                IncomingDocumentId: 2,
                                ExistingValue: 1000,
                                IncomingValue: 1200
                            }]
                        };
                    }
                    if (q.includes("SET ConflictStatus = 'Moot'")) {
                        mootQueryExecuted = true;
                        return { rowsAffected: [1] };
                    }
                    if (q.includes('UPDATE dbo.FactConflicts')) {
                        decisionExecuted = true;
                        return { rowsAffected: [1] };
                    }
                    if (q.includes('INSERT INTO dbo.FactResolutions')) {
                        return { rowsAffected: [1] };
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
        const res = await applyConflictDecision(55, 'keep_existing', { reviewerEmail: 'auditor@contoso.com' });
        assert.equal(res.success, true);
        assert.equal(res.newStatus, 'ApprovedExisting');
        assert.equal(mootQueryExecuted, true, 'Remaining conflicts for incoming doc must cascade to Moot');
        assert.equal(decisionExecuted, true);
        resetPool();
    });
});
