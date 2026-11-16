// tests/wp9-reconciler.test.js
// Test Suite for WP9: Reconciler & Strict Soft-Delete Enforcement

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    runReconciliationScan,
    softDeleteFact,
    softDeleteDocument
} = require('../../../src/services/reconciler');

const { setPool, resetPool } = require('../../../src/services/sql');

test('WP9: Reconciler & Strict Soft-Delete Enforcement', async (t) => {

    await t.test('1. runReconciliationScan: Releases orphaned hold when active conflicts are 0', async () => {
        let clearedDocId = null;
        let setHoldVal = null;

        const mockPool = {
            connected: true,
            request: () => ({
                input: (name, type, val) => {
                    if (name === 'DocumentId') clearedDocId = val;
                    if (name === 'ConflictHold') setHoldVal = val;
                    return mockPool.request();
                },
                query: async (q) => {
                    if (q.includes('FROM dbo.Documents') && q.includes('WHERE ConflictHold = 1')) {
                        return {
                            recordset: [
                                { DocumentId: 901, FileName: 'Orphaned_Hold_Doc.xlsx', ConflictHold: 1 }
                            ]
                        };
                    }
                    if (q.includes('SELECT COUNT(*) AS ActiveConflictCount')) {
                        // 0 active conflicts remain
                        return { recordset: [{ ActiveConflictCount: 0 }] };
                    }
                    if (q.includes('UPDATE dbo.Documents') && q.includes('SET ConflictHold = @ConflictHold')) {
                        return { rowsAffected: [1] };
                    }
                    if (q.includes('FROM dbo.Documents d') && q.includes('JOIN dbo.FinancialFacts f')) {
                        return { recordset: [] };
                    }
                    return { recordset: [], rowsAffected: [1] };
                }
            })
        };

        setPool(mockPool);
        const result = await runReconciliationScan();
        assert.equal(result.scannedDocs, 1);
        assert.equal(result.releasedHolds, 1);
        assert.equal(clearedDocId, 901);
        assert.equal(setHoldVal, 0, 'Hold must be cleared to 0');
        resetPool();
    });

    await t.test('2. runReconciliationScan: Supersedes documents with 0 approved facts and >0 superseded facts', async () => {
        let supersededDocId = null;

        const mockPool = {
            connected: true,
            request: () => ({
                input: (name, type, val) => {
                    if (name === 'DocId') supersededDocId = val;
                    return mockPool.request();
                },
                query: async (q) => {
                    if (q.includes('FROM dbo.Documents') && q.includes('WHERE ConflictHold = 1')) {
                        return { recordset: [] };
                    }
                    if (q.includes('FROM dbo.Documents d') && q.includes('JOIN dbo.FinancialFacts f')) {
                        return {
                            recordset: [
                                { DocumentId: 902, FileName: 'Older_Version.xlsx', IngestionStatus: 'Succeeded', ApprovedCount: 0, SupersededCount: 4 }
                            ]
                        };
                    }
                    if (q.includes("SET IngestionStatus = 'Superseded'")) {
                        return { rowsAffected: [1] };
                    }
                    return { recordset: [], rowsAffected: [1] };
                }
            })
        };

        setPool(mockPool);
        const result = await runReconciliationScan();
        assert.equal(result.supersededDocs, 1);
        assert.equal(supersededDocId, 902);
        resetPool();
    });

    await t.test('3. softDeleteFact: Strictly sets MappingStatus = Superseded, NEVER deletes row', async () => {
        const queriesIssued = [];
        let targetFactId = null;

        const mockPool = {
            connected: true,
            request: () => ({
                input: (name, type, val) => {
                    if (name === 'FactId') targetFactId = val;
                    return mockPool.request();
                },
                query: async (q) => {
                    queriesIssued.push(q);
                    return { rowsAffected: [1] };
                }
            })
        };

        setPool(mockPool);
        const success = await softDeleteFact(955, 'Superseded by restatement');
        assert.equal(success, true);
        assert.equal(targetFactId, 955);
        const updateQuery = queriesIssued.find(q => q.includes("UPDATE dbo.FinancialFacts"));
        assert.ok(updateQuery, 'Must issue an UPDATE on dbo.FinancialFacts');
        assert.ok(updateQuery.includes("SET MappingStatus = 'Superseded'"), 'Must set status to Superseded');
        assert.ok(queriesIssued.every(q => !q.toLowerCase().includes("delete from")), 'Must NEVER execute DELETE FROM');
        resetPool();
    });

    await t.test('4. softDeleteDocument: Strictly updates status to Archived/Superseded, NEVER deletes row', async () => {
        const queriesIssued = [];
        let targetDocId = null;

        const mockPool = {
            connected: true,
            request: () => ({
                input: (name, type, val) => {
                    if (name === 'DocumentId') targetDocId = val;
                    return mockPool.request();
                },
                query: async (q) => {
                    queriesIssued.push(q);
                    return { rowsAffected: [1] };
                }
            })
        };

        setPool(mockPool);
        const success = await softDeleteDocument(977, 'Replaced by Q2 final report');
        assert.equal(success, true);
        assert.equal(targetDocId, 977);
        const updateQuery = queriesIssued.find(q => q.includes("UPDATE dbo.Documents"));
        assert.ok(updateQuery, 'Must issue an UPDATE on dbo.Documents');
        assert.ok(updateQuery.includes("SET IngestionStatus = 'Superseded'"), 'Must update IngestionStatus');
        assert.ok(updateQuery.includes("DocumentStatus = 'Archived'"), 'Must update DocumentStatus');
        assert.ok(queriesIssued.every(q => !q.toLowerCase().includes("delete from")), 'Must NEVER execute DELETE FROM');
        resetPool();
    });

    await t.test('5. Bidirectional Reconciler Repair (Direction 1): Purges search chunks for superseded/pending-delete docs', async () => {
        let purgedDocsCount = 0;
        const mockPool = {
            connected: true,
            request: () => ({
                input: () => mockPool.request(),
                query: async (q) => {
                    if (q.includes('FROM dbo.Documents') && q.includes('WHERE ConflictHold = 1')) {
                        return { recordset: [] };
                    }
                    if (q.includes('FROM dbo.Documents d') && q.includes('JOIN dbo.FinancialFacts f')) {
                        return { recordset: [] };
                    }
                    if (q.includes("IndexingStatus = 'PendingDelete'") || q.includes("IngestionStatus IN ('Superseded', 'Rejected')")) {
                        return {
                            recordset: [
                                { DocumentId: 801, FileName: 'rejected_filing.pdf' },
                                { DocumentId: 802, FileName: 'superseded_draft.xlsx' }
                            ]
                        };
                    }
                    if (q.includes("SET IndexingStatus = 'NotIndexed'")) {
                        purgedDocsCount++;
                        return { rowsAffected: [1] };
                    }
                    return { recordset: [], rowsAffected: [1] };
                }
            })
        };

        setPool(mockPool);
        const result = await runReconciliationScan();
        assert.equal(result.purgedSearchDocs, 2, 'Must purge 2 search documents');
        assert.equal(purgedDocsCount, 2, 'Must update IndexingStatus to NotIndexed for 2 documents');
        resetPool();
    });

    await t.test('6. Bidirectional Reconciler Repair (Direction 2): Repairs and enqueues re-index for approved unindexed documents', async () => {
        const { durableQueue } = require('../../../src/services/durable-queue');
        durableQueue.clear();

        let indexedDocsCount = 0;
        let queriedIndexingStatusNotIndexed = false;

        const mockPool = {
            connected: true,
            request: () => ({
                input: () => mockPool.request(),
                query: async (q) => {
                    if (q.includes('FROM dbo.Documents') && q.includes('WHERE ConflictHold = 1')) {
                        return { recordset: [] };
                    }
                    if (q.includes('FROM dbo.Documents d') && q.includes('JOIN dbo.FinancialFacts f')) {
                        return { recordset: [] };
                    }
                    if (q.includes("IndexingStatus = 'PendingDelete'")) {
                        return { recordset: [] };
                    }
                    if (q.includes("IngestionStatus = 'Succeeded'") && (q.includes("IndexingStatus != 'Indexed'") || q.includes("IndexingStatus <> 'Indexed'"))) {
                        queriedIndexingStatusNotIndexed = true;
                        return {
                            recordset: [
                                { DocumentId: 701, FileName: 'new_approved_report.pdf', SourceType: 'ManualUpload', AuthorityRank: 2 }
                            ]
                        };
                    }
                    if (q.includes("SET IndexingStatus = 'Indexed'")) {
                        indexedDocsCount++;
                        return { rowsAffected: [1] };
                    }
                    return { recordset: [], rowsAffected: [1] };
                }
            })
        };

        setPool(mockPool);
        const result = await runReconciliationScan();
        assert.equal(queriedIndexingStatusNotIndexed, true, "Must query IndexingStatus != 'Indexed'");
        assert.equal(result.repairedSearchDocs, 1, 'Must repair 1 unindexed approved document');
        assert.equal(indexedDocsCount, 1, 'Must transition IndexingStatus to Indexed');

        // Verify that durable queue enqueued re-indexing job
        assert.equal(durableQueue.getQueueLength(), 1, 'Must enqueue re-indexing job to durable queue');
        const queuedJob = await durableQueue.dequeueIngestionJob();
        assert.equal(queuedJob.documentId, 701);
        assert.equal(queuedJob.fileName, 'new_approved_report.pdf');

        durableQueue.clear();
        resetPool();
    });
});
