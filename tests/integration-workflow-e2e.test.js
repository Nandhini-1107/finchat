// tests/integration-workflow-e2e.test.js
// End-to-end integration test for the complete document ingestion, SQL persistence,
// conflict detection, uploader email notification, and human resolution decision workflow.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    setPool,
    resetPool,
    createDocument,
    updateDocumentStatus,
    insertFinancialFacts,
    getDocumentById,
    getFinancialFacts,
    getCompleteFinancialFacts,
    savePendingFactsAndConflicts,
    resolveConflictDecisionTransaction,
    getConflictById,
    recomputeDocumentHold
} = require('../src/services/sql');

const {
    detectFinancialFactConflicts
} = require('../src/services/conflict-resolver');

const {
    formatConflictEmailNotification,
    sendConflictNotification
} = require('../src/services/conflict-notifier');

const {
    generateDecisionToken,
    verifyDecisionToken,
    hashToken,
    getDecisionUrls
} = require('../src/services/conflict-token');

const { confirmConflictHandler } = require('../src/functions/confirmConflict');

/**
 * Creates an in-memory SQL mock database state and pool for complete workflow testing.
 */
function createWorkflowMockDb() {
    let nextDocId = 100;
    let nextFactId = 1000;
    let nextConflictId = 500;

    const db = {
        documents: [],
        facts: [],
        conflicts: [],
        resolutions: [],
        audits: []
    };

    const mockPool = {
        isMock: true,
        connected: true,
        data: db,
        request: () => {
            const inputs = {};
            const req = {
                input: (name, type, val) => {
                    inputs[name] = val !== undefined ? val : type;
                    return req;
                },
                query: async (queryText) => {
                    const q = queryText.trim();

                    // DDL / Schema ignore
                    if (q.includes('sys.tables') || q.includes('sys.columns')) {
                        return { recordset: [{ exists: 1 }] };
                    }

                    // 1. INSERT dbo.Documents
                    if (q.includes('INSERT INTO dbo.Documents')) {
                        const docId = nextDocId++;
                        const doc = {
                            DocumentId: docId,
                            FileName: inputs.FileName,
                            SourceType: inputs.SourceType || 'ManualUpload',
                            AuthorityRank: inputs.AuthorityRank || 4,
                            AllowedUserGroups: inputs.AllowedUserGroups || null,
                            IngestionStatus: 'Processing',
                            UploaderEmail: inputs.UploaderEmail || null,
                            CreatedByEmail: inputs.CreatedByEmail || null,
                            ModifiedByEmail: inputs.ModifiedByEmail || null,
                            ConflictHold: inputs.ConflictHold || 0,
                            CreatedAt: new Date().toISOString()
                        };
                        db.documents.push(doc);
                        return { recordset: [{ DocumentId: docId }] };
                    }

                    // 2. UPDATE dbo.Documents
                    if (q.includes('UPDATE dbo.Documents')) {
                        const docId = Number(inputs.DocumentId);
                        const doc = db.documents.find(d => d.DocumentId === docId);
                        if (doc) {
                            if (inputs.Status) doc.IngestionStatus = inputs.Status;
                            if (inputs.ConflictHold !== undefined) doc.ConflictHold = inputs.ConflictHold ? 1 : 0;
                        }
                        return { rowsAffected: [1] };
                    }

                    // 3. SELECT dbo.Documents
                    if (q.includes('SELECT * FROM dbo.Documents WHERE DocumentId = @DocumentId')) {
                        const doc = db.documents.find(d => d.DocumentId === Number(inputs.DocumentId));
                        return { recordset: doc ? [doc] : [] };
                    }

                    // 4. INSERT dbo.FinancialFacts
                    if (q.includes('INSERT INTO dbo.FinancialFacts')) {
                        const factId = nextFactId++;
                        const fact = {
                            FactId: factId,
                            DocumentId: Number(inputs.DocumentId),
                            Metric: inputs.Metric,
                            Entity: inputs.Entity,
                            PeriodLabel: inputs.PeriodLabel,
                            FactDate: inputs.FactDate,
                            AsOfDate: inputs.AsOfDate,
                            NumericValue: inputs.NumericValue !== undefined ? Number(inputs.NumericValue) : null,
                            NormalizedValue: inputs.NormalizedValue !== undefined ? Number(inputs.NormalizedValue) : Number(inputs.NumericValue),
                            Unit: inputs.Unit,
                            Currency: inputs.Currency || 'AED',
                            SourceLocation: inputs.SourceLocation,
                            SourceFileName: inputs.SourceFileName,
                            AuthorityRank: Number(inputs.AuthorityRank || 4),
                            ValidationStatus: inputs.ValidationStatus || 'Validated',
                            MappingStatus: inputs.MappingStatus || 'Approved',
                            CreatedAt: new Date().toISOString()
                        };
                        db.facts.push(fact);
                        return { recordset: [{ FactId: factId }] };
                    }

                    // 5. SELECT dbo.FinancialFacts
                    if (q.includes('FROM dbo.FinancialFacts f') || q.includes('FROM dbo.vw_FinancialFacts_Complete')) {
                        const docId = inputs.DocumentId ? Number(inputs.DocumentId) : null;
                        let matched = db.facts;
                        if (docId) matched = matched.filter(f => f.DocumentId === docId);
                        const mapped = matched.map(f => {
                            const d = db.documents.find(doc => doc.DocumentId === f.DocumentId) || {};
                            return {
                                ...f,
                                FileName: d.FileName,
                                IngestionStatus: d.IngestionStatus
                            };
                        });
                        return { recordset: mapped };
                    }

                    // 6. INSERT dbo.FactConflicts
                    if (q.includes('INSERT INTO dbo.FactConflicts')) {
                        const cId = nextConflictId++;
                        const conflict = {
                            ConflictId: cId,
                            EntityId: inputs.EntityId || null,
                            MetricId: inputs.MetricId || null,
                            PeriodId: inputs.PeriodId || null,
                            ReportingBasis: inputs.ReportingBasis || 'Actual',
                            ReportingScope: inputs.ReportingScope || 'Consolidated',
                            ConflictType: inputs.ConflictType || 'ValueMismatch',
                            ConflictStatus: inputs.ConflictStatus || 'PendingApproval',
                            ConflictDescription: inputs.ConflictDescription || '',
                            DifferenceValue: inputs.DifferenceValue !== undefined ? Number(inputs.DifferenceValue) : null,
                            DifferencePercentage: inputs.DifferencePercentage !== undefined ? Number(inputs.DifferencePercentage) : null,
                            ToleranceApplied: inputs.ToleranceApplied || 0.001,
                            ExistingFactId: inputs.ExistingFactId || null,
                            IncomingFactId: inputs.IncomingFactId || null,
                            NotificationRecipient: inputs.NotificationRecipient || null,
                            NotificationStatus: inputs.NotificationStatus || 'Pending',
                            CreatedAt: new Date().toISOString()
                        };
                        db.conflicts.push(conflict);
                        return { recordset: [{ ConflictId: cId }] };
                    }

                    // 7. UPDATE dbo.FactConflicts
                    if (q.includes('UPDATE dbo.FactConflicts')) {
                        const cId = Number(inputs.ConflictId);
                        const c = db.conflicts.find(x => x.ConflictId === cId);
                        if (c) {
                            if (q.includes('ConflictStatus = @Status')) {
                                c.ConflictStatus = inputs.Status;
                                c.SelectedFactId = inputs.SelectedFactId;
                                c.ReviewedBy = inputs.ReviewedBy;
                            } else {
                                if (inputs.Status) c.NotificationStatus = inputs.Status;
                            }
                            if (inputs.Recipient) c.NotificationRecipient = inputs.Recipient;
                            if (inputs.TokenHash) c.DecisionTokenHash = inputs.TokenHash;
                            if (inputs.ExpiresAt) c.TokenExpiresAt = inputs.ExpiresAt;
                        }
                        return { rowsAffected: [1] };
                    }

                    // 8. SELECT FactConflicts by Id
                    if (q.includes('FROM dbo.FactConflicts c') && q.includes('c.ConflictId = @ConflictId')) {
                        const cId = Number(inputs.ConflictId);
                        const c = db.conflicts.find(x => x.ConflictId === cId);
                        if (!c) return { recordset: [] };

                        const fExisting = db.facts.find(f => f.FactId === c.ExistingFactId) || {};
                        const fIncoming = db.facts.find(f => f.FactId === c.IncomingFactId) || {};
                        const dExisting = db.documents.find(d => d.DocumentId === fExisting.DocumentId) || {};
                        const dIncoming = db.documents.find(d => d.DocumentId === fIncoming.DocumentId) || {};

                        return {
                            recordset: [{
                                ...c,
                                ExistingFactId: fExisting.FactId,
                                IncomingFactId: fIncoming.FactId,
                                ExistingDocumentId: dExisting.DocumentId,
                                IncomingDocumentId: dIncoming.DocumentId,
                                ExistingFileName: dExisting.FileName,
                                IncomingFileName: dIncoming.FileName,
                                ExistingMetric: fExisting.Metric,
                                IncomingMetric: fIncoming.Metric,
                                ExistingEntity: fExisting.Entity,
                                IncomingEntity: fIncoming.Entity,
                                ExistingPeriodLabel: fExisting.PeriodLabel,
                                IncomingPeriodLabel: fIncoming.PeriodLabel,
                                ExistingNormalizedValue: fExisting.NormalizedValue,
                                IncomingNormalizedValue: fIncoming.NormalizedValue,
                                ExistingValue: fExisting.NormalizedValue,
                                IncomingValue: fIncoming.NormalizedValue,
                                ExistingCurrency: fExisting.Currency,
                                IncomingCurrency: fIncoming.Currency,
                                ExistingUnit: fExisting.Unit,
                                IncomingUnit: fIncoming.Unit
                            }]
                        };
                    }

                    return { recordset: [], rowsAffected: [1] };
                },
                batch: async (batchSql) => {
                    return { recordset: [], rowsAffected: [1] };
                }
            };
            return req;
        },
        transaction: () => {
            const txReq = mockPool.request();
            return {
                begin: async () => {},
                commit: async () => {},
                rollback: async () => {},
                request: () => txReq
            };
        }
    };

    return { db, mockPool };
}

test('End-to-End Workflow: Ingestion, Database Storage, Conflict Email & Human Decision', async (t) => {
    const { db, mockPool } = createWorkflowMockDb();
    setPool(mockPool);

    let doc1Id;
    let doc2Id;
    let capturedNotification = null;

    // Mock mail transport
    const mockMailClient = {
        sendMail: async (mailOpts) => {
            capturedNotification = mailOpts;
            return { messageId: 'msg-mock-e2e-1' };
        }
    };

    await t.test('Step 1: Upload approved baseline document and verify SQL insertion', async () => {
        // Uploader 1 uploads audited annual report
        const uploader1Email = 'auditor@contoso.com';
        doc1Id = await createDocument({
            fileName: 'Annual_Report_2025_Audited.xlsx',
            sourceType: 'Audited Financials',
            authorityRank: 1,
            allowedUserGroups: 'Finance,Executives',
            uploaderEmail: uploader1Email
        });

        assert.ok(doc1Id > 0, 'Document 1 must receive a positive DocumentId');

        // Insert extracted baseline facts
        const baselineFacts = [
            {
                metric: 'Revenue',
                entity: 'Contoso Retail LLC',
                periodLabel: 'FY 2025',
                reportingBasis: 'Actual',
                numericValue: 10000000.00,
                unit: 'AED',
                currency: 'AED',
                sourceLocation: 'Income Statement!B5'
            },
            {
                metric: 'Operating Expenses',
                entity: 'Contoso Retail LLC',
                periodLabel: 'FY 2025',
                reportingBasis: 'Actual',
                numericValue: 4000000.00,
                unit: 'AED',
                currency: 'AED',
                sourceLocation: 'Income Statement!B12'
            }
        ];

        const insertedIds = await insertFinancialFacts(doc1Id, baselineFacts, 1, 'Annual_Report_2025_Audited.xlsx', { mappingStatus: 'Approved' });
        assert.equal(insertedIds.length, 2, '2 baseline facts must be inserted');

        await updateDocumentStatus(doc1Id, 'Succeeded');

        // Verify stored in DB
        const storedDoc = await getDocumentById(doc1Id);
        assert.equal(storedDoc.UploaderEmail, uploader1Email, 'UploaderEmail must be stored in dbo.Documents');
        assert.equal(storedDoc.IngestionStatus, 'Succeeded');

        const storedFacts = await getFinancialFacts(doc1Id);
        assert.equal(storedFacts.length, 2);
        assert.equal(storedFacts[0].Metric, 'Revenue');
        assert.equal(storedFacts[0].NumericValue, 10000000.00);
    });

    await t.test('Step 2: Upload overlapping conflicting document with different value', async () => {
        // Uploader 2 uploads an updated revision with Revenue = 10,500,000 (Conflict!)
        const uploader2Email = 'senior.analyst@contoso.com';
        doc2Id = await createDocument({
            fileName: 'Revised_Financial_Tracker_2025.xlsx',
            sourceType: 'Board Packs / Final',
            authorityRank: 2,
            allowedUserGroups: 'Finance',
            uploaderEmail: uploader2Email
        });

        assert.ok(doc2Id > 0);

        const incomingFacts = [
            {
                metric: 'Revenue',
                entity: 'Contoso Retail LLC',
                periodLabel: 'FY 2025',
                reportingBasis: 'Actual',
                numericValue: 10500000.00,
                normalizedValue: 10500000.00,
                unit: 'AED',
                currency: 'AED',
                sourceLocation: 'Summary!C4'
            }
        ];

        // 1. Fetch existing approved facts
        const existingApprovedFacts = await getCompleteFinancialFacts();
        assert.ok(existingApprovedFacts.length >= 2, 'Existing facts must be available for comparison');

        // 2. Run conflict detection
        const conflicts = detectFinancialFactConflicts(incomingFacts, existingApprovedFacts, {
            authorityRank: 2,
            fileName: 'Revised_Financial_Tracker_2025.xlsx',
            documentId: doc2Id,
            modifiedUserEmail: uploader2Email
        });

        assert.equal(conflicts.length, 1, 'Exactly 1 conflict must be detected on Revenue');
        assert.equal(conflicts[0].metric, 'Revenue');
        assert.equal(conflicts[0].existingValue, 10000000.00);
        assert.equal(conflicts[0].incomingValue, 10500000.00);

        // 3. Stage facts as Pending and hold document
        const staged = await savePendingFactsAndConflicts({
            documentId: doc2Id,
            incomingFacts,
            conflicts,
            authorityRank: 2,
            fileName: 'Revised_Financial_Tracker_2025.xlsx',
            modifiedUserEmail: uploader2Email
        });

        assert.equal(staged.insertedFactIds.length, 1);
        assert.equal(staged.conflicts.length, 1);
        const registeredConflict = staged.conflicts[0];
        assert.ok(registeredConflict.token, 'A cryptographic decision token must be generated');

        // Verify Document 2 is placed on hold
        const doc2 = await getDocumentById(doc2Id);
        assert.equal(doc2.IngestionStatus, 'PendingApproval');
        assert.equal(doc2.ConflictHold, 1, 'ConflictHold must be 1');

        // 4. Dispatch Email Notification directly to uploaded email
        const notifResult = await sendConflictNotification({
            conflict: registeredConflict,
            token: registeredConflict.token,
            recipientEmail: uploader2Email,
            mailClient: mockMailClient
        });

        assert.equal(notifResult.success, true);
        assert.equal(notifResult.recipient, uploader2Email, 'Notification must be addressed to the uploaded email');
    });

    await t.test('Step 3: Verify email notification structure & dual decision links', () => {
        assert.ok(capturedNotification, 'Email notification must have been dispatched');
        assert.equal(capturedNotification.to, 'senior.analyst@contoso.com', 'Recipient must match uploader email');
        assert.ok(capturedNotification.subject.includes('Action Required: Financial Fact Conflict'));

        // HTML & Plaintext body verification
        const html = capturedNotification.html;
        assert.ok(html.includes('Option A: Retain Existing Fact'), 'Must contain Option A retain link');
        assert.ok(html.includes('Option B: Accept Incoming Fact'), 'Must contain Option B accept link');
        assert.ok(html.includes('action=keep_existing'), 'Option A must link to keep_existing');
        assert.ok(html.includes('action=accept_incoming'), 'Option B must link to accept_incoming');
        assert.ok(html.includes('Figures Lost Disclosure') || html.includes('FIGURES LOST'), 'Must include figures lost disclosure');
    });

    await t.test('Step 4: Human decision execution via secure HTTP POST', async () => {
        const conflict = db.conflicts[0];
        assert.ok(conflict);

        // Generate valid decision token for this conflict
        const token = generateDecisionToken({ conflictId: conflict.ConflictId, recipientEmail: 'senior.analyst@contoso.com' });
        conflict.DecisionTokenHash = hashToken(token);

        // Reviewer clicks Option A: keep_existing via HTTP POST
        const req = {
            method: 'POST',
            url: 'http://localhost:7071/api/confirmConflict',
            query: new Map(),
            headers: {
                get: (k) => (k.toLowerCase() === 'content-type' ? 'application/json' : k.toLowerCase() === 'accept' ? 'application/json' : null)
            },
            json: async () => ({
                token,
                action: 'keep_existing',
                reviewer: 'senior.analyst@contoso.com'
            })
        };

        const mockContext = { log: () => {}, warn: () => {}, error: () => {} };
        const res = await confirmConflictHandler(req, mockContext);

        assert.equal(res.status, 200, 'Decision execution must return HTTP 200');
        const resBody = JSON.parse(res.body);
        assert.equal(resBody.status, 'SUCCESS');
        assert.equal(resBody.action, 'keep_existing');
        assert.equal(resBody.newStatus, 'ApprovedExisting');

        // Verify conflict status updated
        assert.equal(conflict.ConflictStatus, 'ApprovedExisting');
    });

    resetPool();
});
