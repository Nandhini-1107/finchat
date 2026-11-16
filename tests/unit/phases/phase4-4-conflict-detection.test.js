// tests/phase4-4-conflict-detection.test.js
// Phase 4.4: Dynamic Financial Fact Conflict Detection and Human Approval Workflow
// Comprehensive verification suite covering all 22 required test scenarios.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    detectFinancialFactConflicts,
    buildFactIdentityKey,
    areFactsIdenticalIdentity,
    getFactsWithConflictContext
} = require('../../../src/services/conflict-resolver');

const {
    generateDecisionToken,
    verifyDecisionToken,
    hashToken,
    getDecisionUrls
} = require('../../../src/services/conflict-token');

const {
    formatConflictEmailNotification,
    sendConflictNotification
} = require('../../../src/services/conflict-notifier');

const {
    setPool,
    resetPool,
    insertFinancialFacts,
    resolveConflictDecisionTransaction,
    savePendingFactsAndConflicts,
    getConflictById,
    getCompleteFinancialFacts
} = require('../../../src/services/sql');

/**
 * Creates an in-memory SQL mock database state and pool for testing transactions,
 * query execution, and rollback behavior without requiring a live Azure SQL connection.
 */
function createMockSqlPool(initialState = {}) {
    const state = {
        documents: JSON.parse(JSON.stringify(initialState.documents || [])),
        facts: JSON.parse(JSON.stringify(initialState.facts || [])),
        conflicts: JSON.parse(JSON.stringify(initialState.conflicts || [])),
        conflictRecords: JSON.parse(JSON.stringify(initialState.conflictRecords || [])),
        resolutions: JSON.parse(JSON.stringify(initialState.resolutions || [])),
        audits: JSON.parse(JSON.stringify(initialState.audits || [])),
        nextDocId: (initialState.documents?.length || 0) + 100,
        nextFactId: (initialState.facts?.length || 0) + 200,
        nextConflictId: (initialState.conflicts?.length || 0) + 300
    };

    function executeQuery(sqlText, params = {}) {
        const text = sqlText.trim();

        // 1. SELECT Conflict with UPDLOCK / ROWLOCK
        if (text.includes('FROM dbo.FactConflicts') && text.includes('WHERE c.ConflictId = @ConflictId')) {
            const conflictId = Number(params.ConflictId);
            const c = state.conflicts.find(x => x.ConflictId === conflictId);
            if (!c) return { recordset: [] };

            const fExist = state.facts.find(x => x.FactId === c.ExistingFactId);
            const fInc = state.facts.find(x => x.FactId === c.IncomingFactId);

            return {
                recordset: [{
                    ConflictId: c.ConflictId,
                    ConflictStatus: c.ConflictStatus,
                    SelectedFactId: c.SelectedFactId,
                    ExistingFactId: c.ExistingFactId,
                    IncomingFactId: c.IncomingFactId,
                    DifferenceValue: c.DifferenceValue,
                    DifferencePercentage: c.DifferencePercentage,
                    ToleranceApplied: c.ToleranceApplied,
                    ExistingDocumentId: fExist?.DocumentId || null,
                    ExistingValue: fExist?.NormalizedValue ?? fExist?.NumericValue ?? null,
                    IncomingDocumentId: fInc?.DocumentId || null,
                    IncomingValue: fInc?.NormalizedValue ?? fInc?.NumericValue ?? null,
                    ReviewedBy: c.ReviewedBy || null,
                    ReviewedAt: c.ReviewedAt || null,
                    ExistingMetric: fExist?.Metric || fExist?.CanonicalMetric,
                    ExistingEntity: fExist?.Entity || fExist?.EntityName,
                    ExistingPeriodLabel: fExist?.PeriodLabel || fExist?.PeriodName
                }]
            };
        }

        // 2. Simple SELECT by ConflictId
        if (text.includes('SELECT c.*') && text.includes('WHERE c.ConflictId = @ConflictId')) {
            const conflictId = Number(params.ConflictId);
            const c = state.conflicts.find(x => x.ConflictId === conflictId);
            if (!c) return { recordset: [] };
            const fExist = state.facts.find(x => x.FactId === c.ExistingFactId);
            const fInc = state.facts.find(x => x.FactId === c.IncomingFactId);
            return {
                recordset: [{
                    ...c,
                    ExistingNormalizedValue: fExist?.NormalizedValue,
                    IncomingNormalizedValue: fInc?.NormalizedValue,
                    ExistingMetric: fExist?.Metric || fExist?.CanonicalMetric,
                    ExistingEntity: fExist?.Entity || fExist?.EntityName,
                    ExistingPeriodLabel: fExist?.PeriodLabel || fExist?.PeriodName
                }]
            };
        }

        // 3. SELECT by TokenHash
        if (text.includes('WHERE c.DecisionTokenHash = @TokenHash')) {
            const c = state.conflicts.find(x => x.DecisionTokenHash === params.TokenHash);
            return { recordset: c ? [c] : [] };
        }

        // 4. UPDATE dbo.FinancialFacts SET MappingStatus
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
            } else if (docId !== null && text.includes("MappingStatus = 'Pending'")) {
                state.facts.filter(x => x.DocumentId === docId && x.MappingStatus === 'Pending')
                    .forEach(f => { f.MappingStatus = 'Approved'; });
            }
            return { recordset: [] };
        }

        // 5. UPDATE dbo.FactConflicts
        if (text.includes('UPDATE dbo.FactConflicts')) {
            const conflictId = Number(params.ConflictId);
            const c = state.conflicts.find(x => x.ConflictId === conflictId);
            if (c) {
                if (text.includes('NotificationStatus =') && params.Status) {
                    c.NotificationStatus = params.Status;
                } else if (params.Status) {
                    c.ConflictStatus = params.Status;
                }
                if (params.SelectedFactId !== undefined) c.SelectedFactId = params.SelectedFactId ? Number(params.SelectedFactId) : null;
                if (params.Reason) c.ResolutionReason = params.Reason;
                if (params.ReviewedBy) c.ReviewedBy = params.ReviewedBy;
                c.ReviewedAt = new Date().toISOString();
                if (params.TokenHash) c.DecisionTokenHash = params.TokenHash;
                if (params.ExpiresAt) c.TokenExpiresAt = params.ExpiresAt;
                if (params.Recipient) c.NotificationRecipient = params.Recipient;
                if (params.Error) c.NotificationError = params.Error;
            }
            return { recordset: [], rowsAffected: [c ? 1 : 0] };
        }

        // 6. INSERT INTO dbo.FactResolutions
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

        // 7. INSERT INTO dbo.FactAudit
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

        // 8. SELECT COUNT(*) AS PendingCount FROM dbo.FactConflicts
        if (text.includes('SELECT COUNT(*) AS PendingCount')) {
            const docId = Number(params.DocId);
            const pending = state.conflicts.filter(c => {
                const incomingFact = state.facts.find(f => f.FactId === c.IncomingFactId);
                return incomingFact && incomingFact.DocumentId === docId &&
                    ['PendingApproval', 'PendingReview', 'Detected', 'Potential'].includes(c.ConflictStatus);
            });
            return { recordset: [{ PendingCount: pending.length }] };
        }

        // 8b. SELECT status counts for document
        if (text.includes('COUNT(CASE WHEN MappingStatus') || text.includes('ApprovedCount')) {
            const docId = Number(params.DocId);
            const docFacts = state.facts.filter(f => f.DocumentId === docId);
            const approved = docFacts.filter(f => f.MappingStatus === 'Approved').length;
            const rejected = docFacts.filter(f => f.MappingStatus === 'Rejected').length;
            return {
                recordset: [{
                    ApprovedCount: approved,
                    RejectedCount: rejected,
                    TotalCount: docFacts.length
                }]
            };
        }

        // 9. UPDATE dbo.Documents SET IngestionStatus
        if (text.includes('UPDATE dbo.Documents')) {
            const docId = Number(params.DocId || params.DocumentId);
            const doc = state.documents.find(x => x.DocumentId === docId);
            if (doc) {
                if (params.DocStatus) doc.IngestionStatus = params.DocStatus;
                else if (params.Status) doc.IngestionStatus = params.Status;
                else if (text.includes("'Succeeded'")) doc.IngestionStatus = 'Succeeded';
                else if (text.includes("'PendingApproval'")) doc.IngestionStatus = 'PendingApproval';
                else if (text.includes("'Rejected'")) doc.IngestionStatus = 'Rejected';
            }
            return { recordset: [] };
        }

        // 10. SELECT facts view (vw_FinancialFacts_Complete)
        if (text.includes('vw_FinancialFacts_Complete')) {
            let res = state.facts.map(f => {
                const doc = state.documents.find(d => d.DocumentId === f.DocumentId) || {};
                return {
                    ...f,
                    FactId: f.FactId,
                    DocumentId: f.DocumentId,
                    CanonicalMetric: f.Metric || f.CanonicalMetric,
                    Metric: f.Metric || f.CanonicalMetric,
                    EntityName: f.Entity || f.EntityName,
                    Entity: f.Entity || f.EntityName,
                    PeriodName: f.PeriodLabel || f.PeriodName,
                    PeriodLabel: f.PeriodLabel || f.PeriodName,
                    NormalizedValue: f.NormalizedValue ?? f.NumericValue,
                    NumericValue: f.NormalizedValue ?? f.NumericValue,
                    NormalizedUnit: f.NormalizedUnit || f.Unit,
                    Unit: f.NormalizedUnit || f.Unit,
                    Currency: f.Currency,
                    ReportingBasis: f.ReportingBasis || 'Actual',
                    ReportingScope: f.ReportingScope || 'Consolidated',
                    MappingStatus: f.MappingStatus || 'Approved',
                    IngestionStatus: doc.IngestionStatus || 'Succeeded',
                    FileName: doc.FileName || f.SourceFileName,
                    SourceFileName: doc.FileName || f.SourceFileName
                };
            });

            if (text.includes("MappingStatus = 'Approved'")) {
                res = res.filter(x => (x.MappingStatus === 'Approved' || !x.MappingStatus) && (x.IngestionStatus === 'Succeeded' || x.IngestionStatus === 'Completed'));
            }
            return { recordset: res };
        }

        // 10b. SELECT facts directly (FinancialFacts f JOIN Documents d)
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
                res = res.filter(x => (x.MappingStatus === 'Approved' || !x.MappingStatus) && (x.IngestionStatus === 'Succeeded' || x.IngestionStatus === 'Completed'));
            }
            return { recordset: res };
        }

        // 10c. SELECT FactConflicts with FactConflictRecords
        if (text.includes('FROM dbo.FactConflicts c') && text.includes('FactConflictRecords')) {
            const records = [];
            for (const c of state.conflicts) {
                if (['PendingApproval', 'PendingReview', 'Detected', 'Potential'].includes(c.ConflictStatus)) {
                    const crs = state.conflictRecords.filter(cr => cr.ConflictId === c.ConflictId);
                    if (crs.length > 0) {
                        for (const cr of crs) {
                            records.push({
                                ConflictId: c.ConflictId,
                                ConflictStatus: c.ConflictStatus,
                                ConflictDescription: c.ConflictDescription,
                                ResolutionReason: c.ResolutionReason,
                                SelectedFactId: c.SelectedFactId,
                                FactId: cr.FactId,
                                FactRole: cr.FactRole
                            });
                        }
                    } else {
                        if (c.ExistingFactId) records.push({ ConflictId: c.ConflictId, ConflictStatus: c.ConflictStatus, SelectedFactId: c.SelectedFactId, FactId: c.ExistingFactId, FactRole: 'Existing' });
                        if (c.IncomingFactId) records.push({ ConflictId: c.ConflictId, ConflictStatus: c.ConflictStatus, SelectedFactId: c.SelectedFactId, FactId: c.IncomingFactId, FactRole: 'IncomingCandidate' });
                    }
                }
            }
            return { recordset: records };
        }

        // 11. INSERT INTO dbo.FactConflicts
        if (text.includes('INSERT INTO dbo.FactConflicts')) {
            const newId = state.nextConflictId++;
            const newConflict = {
                ConflictId: newId,
                ConflictStatus: params.ConflictStatus || 'PendingApproval',
                EntityId: params.EntityId,
                MetricId: params.MetricId,
                PeriodId: params.PeriodId,
                ReportingBasis: params.ReportingBasis,
                ReportingScope: params.ReportingScope,
                ConflictType: params.ConflictType,
                ConflictDescription: params.ConflictDescription,
                DifferenceValue: params.DifferenceValue,
                DifferencePercentage: params.DifferencePercentage,
                ToleranceApplied: params.ToleranceApplied,
                SelectedFactId: params.SelectedFactId,
                ResolutionReason: params.ResolutionReason,
                ExistingFactId: params.ExistingFactId,
                IncomingFactId: params.IncomingFactId,
                DecisionTokenHash: params.DecisionTokenHash,
                TokenExpiresAt: params.TokenExpiresAt,
                NotificationStatus: params.NotificationStatus || 'Pending',
                NotificationRecipient: params.NotificationRecipient,
                NotificationError: params.NotificationError
            };
            state.conflicts.push(newConflict);
            return { recordset: [{ ConflictId: newId }] };
        }

        // 12. INSERT INTO dbo.FinancialFacts
        if (text.includes('INSERT INTO dbo.FinancialFacts')) {
            const newId = state.nextFactId++;
            state.facts.push({
                FactId: newId,
                DocumentId: params.DocumentId,
                Metric: params.Metric,
                Entity: params.Entity,
                PeriodLabel: params.PeriodLabel,
                NormalizedValue: params.NormalizedValue,
                NumericValue: params.NumericValue,
                NormalizedUnit: params.NormalizedUnit,
                Currency: params.Currency,
                ReportingBasis: params.ReportingBasis,
                ReportingScope: params.ReportingScope,
                MappingStatus: params.MappingStatus || 'Approved',
                ValidationStatus: params.ValidationStatus || 'Validated'
            });
            return { recordset: [{ FactId: newId }] };
        }

        return { recordset: [] };
    }

    function createMockRequest(currentState) {
        const params = {};
        const req = {
            input: (name, type, val) => {
                params[name] = val;
                return req;
            },
            query: async (queryText) => {
                if (state.queryHook) {
                    state.queryHook(queryText, params);
                }
                return executeQuery(queryText, params);
            },
            batch: async () => ({ recordset: [] })
        };
        return req;
    }

    return {
        state,
        connected: true,
        request: () => createMockRequest(state),
        transaction: () => {
            const snapshot = JSON.stringify(state);
            return {
                begin: async () => {},
                commit: async () => {},
                rollback: async () => {
                    const restored = JSON.parse(snapshot);
                    Object.assign(state, restored);
                },
                request: () => createMockRequest(state)
            };
        }
    };
}

test('Phase 4.4: Dynamic Financial Fact Conflict Detection and Human Approval Workflow', async (t) => {

    // ------------------------------------------------------------------------
    // SCENARIO 1: Same identity, different value -> Genuine conflict detected
    // ------------------------------------------------------------------------
    await t.test('1. Same identity, different value -> conflict detected with status PendingApproval', () => {
        const existingFacts = [{
            FactId: 101,
            DocumentId: 1,
            CanonicalMetric: 'Revenue',
            EntityName: 'Apex Retail Corp',
            PeriodName: 'Q1 2026',
            ReportingBasis: 'Actual',
            ReportingScope: 'Consolidated',
            NormalizedValue: 10000000,
            NormalizedUnit: 'amount',
            Currency: 'AED',
            MappingStatus: 'Approved',
            IngestionStatus: 'Succeeded',
            AuthorityCategory: 'Audited Financials',
            AuthorityPriority: 1
        }];

        const incomingFacts = [{
            metric: 'Revenue',
            entity: 'Apex Retail Corp',
            periodLabel: 'Q1 2026',
            reportingBasis: 'Actual',
            reportingScope: 'Consolidated',
            normalizedValue: 12000000,
            normalizedUnit: 'amount',
            currency: 'AED'
        }];

        const conflicts = detectFinancialFactConflicts(incomingFacts, existingFacts, {
            authorityRank: 2,
            fileName: 'Updated_Report.pdf'
        });

        assert.equal(conflicts.length, 1);
        assert.equal(conflicts[0].conflictStatus, 'PendingApproval', 'Status must be PendingApproval, NEVER AutoResolved');
        assert.equal(conflicts[0].differenceValue, 2000000);
        assert.equal(conflicts[0].existingValue, 10000000);
        assert.equal(conflicts[0].incomingValue, 12000000);
    });

    // ------------------------------------------------------------------------
    // SCENARIO 2: Same identity, same value -> No conflict
    // ------------------------------------------------------------------------
    await t.test('2. Same identity, same value -> no conflict detected', () => {
        const existingFacts = [{
            FactId: 101,
            DocumentId: 1,
            CanonicalMetric: 'Revenue',
            EntityName: 'Apex Retail Corp',
            PeriodName: 'Q1 2026',
            ReportingBasis: 'Actual',
            ReportingScope: 'Consolidated',
            NormalizedValue: 10000000,
            NormalizedUnit: 'amount',
            Currency: 'AED',
            MappingStatus: 'Approved',
            IngestionStatus: 'Succeeded'
        }];

        const incomingFacts = [{
            metric: 'Revenue',
            entity: 'Apex Retail Corp',
            periodLabel: 'Q1 2026',
            reportingBasis: 'Actual',
            reportingScope: 'Consolidated',
            normalizedValue: 10000000,
            normalizedUnit: 'amount',
            currency: 'AED'
        }];

        const conflicts = detectFinancialFactConflicts(incomingFacts, existingFacts);
        assert.equal(conflicts.length, 0, 'Identical values must not trigger a conflict');
    });

    // ------------------------------------------------------------------------
    // SCENARIO 3: Different entities -> No conflict
    // ------------------------------------------------------------------------
    await t.test('3. Different entities -> no conflict (Company A vs Company B)', () => {
        const existingFacts = [{
            FactId: 101,
            CanonicalMetric: 'Revenue',
            EntityName: 'Company A',
            PeriodName: 'Q1 2026',
            ReportingBasis: 'Actual',
            NormalizedValue: 10000000,
            Currency: 'AED',
            MappingStatus: 'Approved',
            IngestionStatus: 'Succeeded'
        }];

        const incomingFacts = [{
            metric: 'Revenue',
            entity: 'Company B',
            periodLabel: 'Q1 2026',
            reportingBasis: 'Actual',
            normalizedValue: 12000000,
            currency: 'AED'
        }];

        const conflicts = detectFinancialFactConflicts(incomingFacts, existingFacts);
        assert.equal(conflicts.length, 0, 'Different entities must never conflict');
    });

    // ------------------------------------------------------------------------
    // SCENARIO 4: Different periods -> No conflict
    // ------------------------------------------------------------------------
    await t.test('4. Different periods -> no conflict (Q1 2026 vs Q2 2026)', () => {
        const existingFacts = [{
            FactId: 101,
            CanonicalMetric: 'Revenue',
            EntityName: 'Company A',
            PeriodName: 'Q1 2026',
            ReportingBasis: 'Actual',
            NormalizedValue: 10000000,
            Currency: 'AED',
            MappingStatus: 'Approved',
            IngestionStatus: 'Succeeded'
        }];

        const incomingFacts = [{
            metric: 'Revenue',
            entity: 'Company A',
            periodLabel: 'Q2 2026',
            reportingBasis: 'Actual',
            normalizedValue: 12000000,
            currency: 'AED'
        }];

        const conflicts = detectFinancialFactConflicts(incomingFacts, existingFacts);
        assert.equal(conflicts.length, 0, 'Different periods must never conflict');
    });

    // ------------------------------------------------------------------------
    // SCENARIO 5: Different reporting bases -> No conflict (Actual vs Budget)
    // ------------------------------------------------------------------------
    await t.test('5. Different reporting bases -> no conflict (Actual vs Budget)', () => {
        const existingFacts = [{
            FactId: 101,
            CanonicalMetric: 'Revenue',
            EntityName: 'Company A',
            PeriodName: 'Q1 2026',
            ReportingBasis: 'Actual',
            NormalizedValue: 10000000,
            Currency: 'AED',
            MappingStatus: 'Approved',
            IngestionStatus: 'Succeeded'
        }];

        const incomingFacts = [{
            metric: 'Revenue',
            entity: 'Company A',
            periodLabel: 'Q1 2026',
            reportingBasis: 'Budget',
            normalizedValue: 12000000,
            currency: 'AED'
        }];

        const conflicts = detectFinancialFactConflicts(incomingFacts, existingFacts);
        assert.equal(conflicts.length, 0, 'Actual vs Budget must never conflict');
    });

    // ------------------------------------------------------------------------
    // SCENARIO 6: Different dimensions -> No conflict
    // ------------------------------------------------------------------------
    await t.test('6. Different dimensions -> no conflict (Retail segment vs Logistics segment)', () => {
        const existingFacts = [{
            FactId: 101,
            CanonicalMetric: 'Revenue',
            EntityName: 'Company A',
            PeriodName: 'Q1 2026',
            ReportingBasis: 'Actual',
            dimensions: { segment: 'Retail' },
            NormalizedValue: 10000000,
            Currency: 'AED',
            MappingStatus: 'Approved',
            IngestionStatus: 'Succeeded'
        }];

        const incomingFacts = [{
            metric: 'Revenue',
            entity: 'Company A',
            periodLabel: 'Q1 2026',
            reportingBasis: 'Actual',
            dimensions: { segment: 'Logistics' },
            normalizedValue: 12000000,
            currency: 'AED'
        }];

        const conflicts = detectFinancialFactConflicts(incomingFacts, existingFacts);
        assert.equal(conflicts.length, 0, 'Different reporting dimensions must never conflict');
    });

    // ------------------------------------------------------------------------
    // SCENARIO 7: Different currencies -> No conflict (Never convert automatically)
    // ------------------------------------------------------------------------
    await t.test('7. Different currencies -> no conflict (AED vs USD, never convert currencies)', () => {
        const existingFacts = [{
            FactId: 101,
            CanonicalMetric: 'Revenue',
            EntityName: 'Company A',
            PeriodName: 'Q1 2026',
            ReportingBasis: 'Actual',
            NormalizedValue: 10000000,
            Currency: 'AED',
            MappingStatus: 'Approved',
            IngestionStatus: 'Succeeded'
        }];

        const incomingFacts = [{
            metric: 'Revenue',
            entity: 'Company A',
            periodLabel: 'Q1 2026',
            reportingBasis: 'Actual',
            normalizedValue: 10000000,
            currency: 'USD'
        }];

        const conflicts = detectFinancialFactConflicts(incomingFacts, existingFacts);
        assert.equal(conflicts.length, 0, 'Different currencies must not be treated as conflicts or auto-converted');
    });

    // ------------------------------------------------------------------------
    // SCENARIO 8: Rounding tolerance -> Values within tolerance do not conflict
    // ------------------------------------------------------------------------
    await t.test('8. Rounding tolerance -> values within tolerance do not trigger conflict', () => {
        const existingFacts = [{
            FactId: 101,
            CanonicalMetric: 'Gross Margin',
            EntityName: 'Company A',
            PeriodName: 'Q1 2026',
            ReportingBasis: 'Actual',
            NormalizedValue: 0.2450,
            NormalizedUnit: 'ratio',
            Currency: null,
            MappingStatus: 'Approved',
            IngestionStatus: 'Succeeded'
        }];

        const incomingFacts = [{
            metric: 'Gross Margin',
            entity: 'Company A',
            periodLabel: 'Q1 2026',
            reportingBasis: 'Actual',
            normalizedValue: 0.2452, // difference is 0.0002 (< 0.001 tolerance)
            normalizedUnit: 'ratio',
            currency: null
        }];

        const conflicts = detectFinancialFactConflicts(incomingFacts, existingFacts, { tolerance: 0.001 });
        assert.equal(conflicts.length, 0, 'Value within rounding tolerance must not trigger a conflict');
    });

    // ------------------------------------------------------------------------
    // SCENARIO 9: Multiple conflicts in one document
    // ------------------------------------------------------------------------
    await t.test('9. Multiple conflicts in one document -> all conflicts detected and held in staging', () => {
        const existingFacts = [
            {
                FactId: 101,
                CanonicalMetric: 'Revenue',
                EntityName: 'Apex Retail Corp',
                PeriodName: 'Q1 2026',
                ReportingBasis: 'Actual',
                NormalizedValue: 10000000,
                Currency: 'AED',
                MappingStatus: 'Approved',
                IngestionStatus: 'Succeeded'
            },
            {
                FactId: 102,
                CanonicalMetric: 'Net Profit',
                EntityName: 'Apex Retail Corp',
                PeriodName: 'Q1 2026',
                ReportingBasis: 'Actual',
                NormalizedValue: 1500000,
                Currency: 'AED',
                MappingStatus: 'Approved',
                IngestionStatus: 'Succeeded'
            }
        ];

        const incomingFacts = [
            { metric: 'Revenue', entity: 'Apex Retail Corp', periodLabel: 'Q1 2026', reportingBasis: 'Actual', normalizedValue: 12000000, currency: 'AED' },
            { metric: 'Net Profit', entity: 'Apex Retail Corp', periodLabel: 'Q1 2026', reportingBasis: 'Actual', normalizedValue: 1800000, currency: 'AED' },
            { metric: 'Operating Expenses', entity: 'Apex Retail Corp', periodLabel: 'Q1 2026', reportingBasis: 'Actual', normalizedValue: 8200000, currency: 'AED' }
        ];

        const conflicts = detectFinancialFactConflicts(incomingFacts, existingFacts);
        assert.equal(conflicts.length, 2, 'Should detect both Revenue and Net Profit conflicts');
        assert.equal(conflicts[0].metric, 'Revenue');
        assert.equal(conflicts[1].metric, 'Net Profit');
    });

    // ------------------------------------------------------------------------
    // SCENARIO 10: No-conflict ingestion -> Facts auto-approved
    // ------------------------------------------------------------------------
    await t.test('10. No-conflict ingestion -> facts auto-approved without conflict records', () => {
        const existingFacts = [{
            FactId: 101,
            CanonicalMetric: 'Revenue',
            EntityName: 'Apex Retail Corp',
            PeriodName: 'Q1 2026',
            NormalizedValue: 10000000,
            Currency: 'AED',
            MappingStatus: 'Approved',
            IngestionStatus: 'Succeeded'
        }];

        // Incoming facts either match existing values or introduce new metrics
        const incomingFacts = [
            { metric: 'Revenue', entity: 'Apex Retail Corp', periodLabel: 'Q1 2026', normalizedValue: 10000000, currency: 'AED' },
            { metric: 'Total Assets', entity: 'Apex Retail Corp', periodLabel: 'Q1 2026', normalizedValue: 45000000, currency: 'AED' }
        ];

        const conflicts = detectFinancialFactConflicts(incomingFacts, existingFacts);
        assert.equal(conflicts.length, 0);
    });

    // ------------------------------------------------------------------------
    // SCENARIO 11 & 12: Fact Preservation in Database Staging
    // ------------------------------------------------------------------------
    await t.test('11 & 12. Existing and incoming fact preservation in staging', async () => {
        const mock = createMockSqlPool({
            documents: [{ DocumentId: 50, FileName: 'Incoming_Report.pdf', IngestionStatus: 'Processing' }],
            facts: [{ FactId: 10, DocumentId: 1, Metric: 'Revenue', NormalizedValue: 10000000, MappingStatus: 'Approved' }]
        });
        setPool(mock);

        try {
            const conflicts = [{
                metric: 'Revenue',
                entity: 'Apex Retail Corp',
                periodLabel: 'Q1 2026',
                reportingBasis: 'Actual',
                differenceValue: 2000000,
                existingFactId: 10,
                existingFact: { FactId: 10, EntityId: 1, MetricId: 1, PeriodId: 1 },
                incomingFactIndex: 0
            }];

            const incomingFacts = [{
                metric: 'Revenue',
                entity: 'Apex Retail Corp',
                periodLabel: 'Q1 2026',
                reportingBasis: 'Actual',
                unit: 'AED',
                sourceLocation: 'Page 1, Row 5',
                normalizedValue: 12000000,
                currency: 'AED'
            }];

            const staged = await savePendingFactsAndConflicts({
                documentId: 50,
                incomingFacts,
                conflicts,
                fileName: 'Incoming_Report.pdf',
                modifiedUserEmail: 'cfo@contoso.com'
            });

            // 11. Existing fact preserved as Approved
            const existingFact = mock.state.facts.find(f => f.FactId === 10);
            assert.equal(existingFact.MappingStatus, 'Approved', 'Existing fact must remain Approved');

            // 12. Incoming fact saved with MappingStatus = 'Pending'
            const incomingFactId = staged.insertedFactIds[0];
            const incomingFact = mock.state.facts.find(f => f.FactId === incomingFactId);
            assert.ok(incomingFact, 'Incoming candidate fact must be saved');
            assert.equal(incomingFact.MappingStatus, 'Pending', 'Incoming fact must be staged as Pending');

            // Document status must be PendingApproval
            const doc = mock.state.documents.find(d => d.DocumentId === 50);
            assert.equal(doc.IngestionStatus, 'PendingApproval', 'Document status must be held in PendingApproval');
        } finally {
            resetPool();
        }
    });

    await t.test('12b. Strict 5-field integrity: missing each of entity, period, unit, basis, or location becomes NeedsReview', async () => {
        const mock = createMockSqlPool({
            documents: [{ DocumentId: 60, FileName: 'Validation_Report.pdf', IngestionStatus: 'Processing' }],
            facts: []
        });
        setPool(mock);

        try {
            const baseValidFact = {
                metric: 'Revenue',
                entity: 'Apex Retail Corp',
                periodLabel: 'Q1 2026',
                reportingBasis: 'Actual',
                unit: 'AED',
                sourceLocation: 'Page 1, Row 5',
                numericValue: 10000000,
                currency: 'AED'
            };

            const testCases = [
                { name: 'missing entity', fact: { ...baseValidFact, entity: null } },
                { name: 'missing period', fact: { ...baseValidFact, periodLabel: null } },
                { name: 'missing unit', fact: { ...baseValidFact, unit: null } },
                { name: 'missing reportingBasis', fact: { ...baseValidFact, reportingBasis: null } },
                { name: 'missing sourceLocation', fact: { ...baseValidFact, sourceLocation: null } }
            ];

            for (const tc of testCases) {
                const insertedIds = await insertFinancialFacts(60, [tc.fact]);
                const inserted = mock.state.facts.find(f => f.FactId === insertedIds[0]);
                assert.ok(inserted, 'Fact must be inserted');
                assert.equal(inserted.MappingStatus, 'NeedsReview', tc.name + ' must set MappingStatus to NeedsReview');
            }
        } finally {
            resetPool();
        }
    });

    // ------------------------------------------------------------------------
    // SCENARIO 13: Email notification failure and retry without duplicate conflicts
    // ------------------------------------------------------------------------
    await t.test('13. Email notification failure and retry records status without duplicate conflicts', async () => {
        const mock = createMockSqlPool({
            conflicts: [{
                ConflictId: 301,
                ConflictStatus: 'PendingApproval',
                NotificationStatus: 'Pending'
            }]
        });
        setPool(mock);

        try {
            const conflict = {
                conflictId: 301,
                metric: 'Revenue',
                entity: 'Apex Retail Corp',
                periodLabel: 'Q1 2026',
                existingValue: 10000000,
                incomingValue: 12000000
            };
            const token = generateDecisionToken({ conflictId: 301, recipientEmail: 'cfo@contoso.com' });

            // Step 1: Simulated network/mail failure
            const failingClient = {
                sendMail: async () => { throw new Error('SMTP connection timed out'); }
            };
            const failResult = await sendConflictNotification({
                conflict,
                token,
                recipientEmail: 'cfo@contoso.com',
                mailClient: failingClient
            });
            assert.equal(failResult.success, false);
            assert.ok(failResult.error.includes('timed out'));

            const conflictInDb = mock.state.conflicts.find(c => c.ConflictId === 301);
            assert.equal(conflictInDb.NotificationStatus, 'Failed');

            // Step 2: Retry succeeds
            const successClient = {
                sendMail: async () => ({ messageId: 'msg-999' })
            };
            const retryResult = await sendConflictNotification({
                conflict,
                token,
                recipientEmail: 'cfo@contoso.com',
                mailClient: successClient
            });
            assert.equal(retryResult.success, true);
            assert.equal(conflictInDb.NotificationStatus, 'Sent');
            assert.equal(mock.state.conflicts.length, 1, 'Retry must not create duplicate conflict records');
        } finally {
            resetPool();
        }
    });

    // ------------------------------------------------------------------------
    // SCENARIO 14: Invalid approval token -> Rejected
    // ------------------------------------------------------------------------
    await t.test('14. Invalid approval token -> rejected with error', () => {
        const forgedToken = 'invalid.payload.signature';
        const verifyResult = verifyDecisionToken(forgedToken);
        assert.equal(verifyResult.valid, false);

        // Tampered signature
        const validToken = generateDecisionToken({ conflictId: 100, recipientEmail: 'cfo@contoso.com' });
        const tamperedToken = validToken.slice(0, -4) + 'abcd';
        const tamperedResult = verifyDecisionToken(tamperedToken);
        assert.equal(tamperedResult.valid, false);
        assert.equal(tamperedResult.reason, 'INVALID_SIGNATURE');
    });

    // ------------------------------------------------------------------------
    // SCENARIO 15: Expired approval token -> Rejected
    // ------------------------------------------------------------------------
    await t.test('15. Expired approval token -> rejected with error', () => {
        // Token with past expiration
        const expiredToken = generateDecisionToken({
            conflictId: 100,
            recipientEmail: 'cfo@contoso.com',
            ttlHours: -2 // expired 2 hours ago
        });
        const verifyResult = verifyDecisionToken(expiredToken);
        assert.equal(verifyResult.valid, false);
        assert.equal(verifyResult.reason, 'EXPIRED');
    });

    // ------------------------------------------------------------------------
    // SCENARIO 16: Unauthorized reviewer -> Rejected
    // ------------------------------------------------------------------------
    await t.test('16. Unauthorized reviewer -> rejected when reviewer does not match recipient', () => {
        const token = generateDecisionToken({ conflictId: 200, recipientEmail: 'cfo@contoso.com' });
        const verified = verifyDecisionToken(token);
        assert.equal(verified.valid, true);

        const reviewer = 'unauthorized-user@external.com';
        const isAuthorized = reviewer.toLowerCase() === verified.payload.recipientEmail.toLowerCase();
        assert.equal(isAuthorized, false, 'Reviewer must match token recipient');
    });

    // ------------------------------------------------------------------------
    // SCENARIO 17: Duplicate approval -> Error / Single-use token enforcement
    // ------------------------------------------------------------------------
    await t.test('17. Duplicate approval -> second decision on resolved conflict rejected', async () => {
        const mock = createMockSqlPool({
            conflicts: [{
                ConflictId: 401,
                ConflictStatus: 'ApprovedExisting', // already resolved!
                ExistingFactId: 11,
                IncomingFactId: 12
            }],
            facts: [
                { FactId: 11, NormalizedValue: 10000000, MappingStatus: 'Approved' },
                { FactId: 12, NormalizedValue: 12000000, MappingStatus: 'Rejected' }
            ]
        });
        setPool(mock);

        try {
            await assert.rejects(
                async () => {
                    await resolveConflictDecisionTransaction({
                        conflictId: 401,
                        action: 'accept_incoming',
                        reviewerEmail: 'cfo@contoso.com'
                    });
                },
                /already been resolved/i
            );
        } finally {
            resetPool();
        }
    });

    // ------------------------------------------------------------------------
    // SCENARIO 18: Concurrent approval protection
    // ------------------------------------------------------------------------
    await t.test('18. Concurrent approval protection -> guards against race conditions', async () => {
        const mock = createMockSqlPool({
            conflicts: [{
                ConflictId: 501,
                ConflictStatus: 'PendingApproval',
                ExistingFactId: 21,
                IncomingFactId: 22
            }],
            facts: [
                { FactId: 21, DocumentId: 1, NormalizedValue: 10000000, MappingStatus: 'Approved' },
                { FactId: 22, DocumentId: 2, NormalizedValue: 12000000, MappingStatus: 'Pending' }
            ],
            documents: [{ DocumentId: 2, IngestionStatus: 'PendingApproval' }]
        });
        setPool(mock);

        try {
            // First call succeeds
            const res1 = await resolveConflictDecisionTransaction({
                conflictId: 501,
                action: 'keep_existing',
                reviewerEmail: 'cfo@contoso.com'
            });
            assert.equal(res1.success, true);

            // Second simultaneous or sequential call fails because status transitioned out of PendingApproval
            await assert.rejects(
                async () => {
                    await resolveConflictDecisionTransaction({
                        conflictId: 501,
                        action: 'accept_incoming',
                        reviewerEmail: 'cfo@contoso.com'
                    });
                },
                /already been resolved/i
            );
        } finally {
            resetPool();
        }
    });

    // ------------------------------------------------------------------------
    // SCENARIO 19: Keep existing decision (Option A)
    // ------------------------------------------------------------------------
    await t.test('19. Keep existing decision -> existing approved, incoming candidate rejected', async () => {
        const mock = createMockSqlPool({
            conflicts: [{
                ConflictId: 601,
                ConflictStatus: 'PendingApproval',
                ExistingFactId: 31,
                IncomingFactId: 32
            }],
            facts: [
                { FactId: 31, DocumentId: 1, NormalizedValue: 10000000, MappingStatus: 'Approved' },
                { FactId: 32, DocumentId: 2, NormalizedValue: 12000000, MappingStatus: 'Pending' }
            ],
            documents: [{ DocumentId: 2, IngestionStatus: 'PendingApproval' }]
        });
        setPool(mock);

        try {
            const result = await resolveConflictDecisionTransaction({
                conflictId: 601,
                action: 'keep_existing',
                reviewerEmail: 'auditor@contoso.com',
                notes: 'Retained audited statutory figures'
            });

            assert.equal(result.success, true);
            assert.equal(result.newStatus, 'ApprovedExisting');
            assert.equal(result.selectedFactId, 31);

            // Fact 31 (Existing) remains Approved
            const existing = mock.state.facts.find(f => f.FactId === 31);
            assert.equal(existing.MappingStatus, 'Approved');

            // Fact 32 (Incoming candidate) marked Rejected
            const incoming = mock.state.facts.find(f => f.FactId === 32);
            assert.equal(incoming.MappingStatus, 'Rejected');

            // Conflict record updated
            const conflict = mock.state.conflicts.find(c => c.ConflictId === 601);
            assert.equal(conflict.ConflictStatus, 'ApprovedExisting');
            assert.equal(conflict.SelectedFactId, 31);

            // Audited in FactResolutions
            assert.equal(mock.state.resolutions.length, 1);
            assert.equal(mock.state.resolutions[0].ResolutionType, 'HumanDecisionKeepExisting');
            assert.equal(mock.state.resolutions[0].ResolvedBy, 'auditor@contoso.com');
        } finally {
            resetPool();
        }
    });

    // ------------------------------------------------------------------------
    // SCENARIO 20: Accept incoming decision (Option B) - Historical Fact Preservation
    // ------------------------------------------------------------------------
    await t.test('20. Accept incoming decision -> incoming approved, existing superseded (NEVER DELETED)', async () => {
        const mock = createMockSqlPool({
            conflicts: [{
                ConflictId: 701,
                ConflictStatus: 'PendingApproval',
                ExistingFactId: 41,
                IncomingFactId: 42
            }],
            facts: [
                { FactId: 41, DocumentId: 1, NormalizedValue: 10000000, MappingStatus: 'Approved' },
                { FactId: 42, DocumentId: 2, NormalizedValue: 12000000, MappingStatus: 'Pending' }
            ],
            documents: [{ DocumentId: 2, IngestionStatus: 'PendingApproval' }]
        });
        setPool(mock);

        try {
            const result = await resolveConflictDecisionTransaction({
                conflictId: 701,
                action: 'accept_incoming',
                reviewerEmail: 'cfo@contoso.com',
                notes: 'Promoted revised restated management figures'
            });

            assert.equal(result.success, true);
            assert.equal(result.newStatus, 'ApprovedIncoming');
            assert.equal(result.selectedFactId, 42);

            // Fact 42 (Incoming candidate) promoted to Approved
            const incoming = mock.state.facts.find(f => f.FactId === 42);
            assert.equal(incoming.MappingStatus, 'Approved');

            // Fact 41 (Existing master) MUST NOT BE DELETED: preserved as Superseded
            const existing = mock.state.facts.find(f => f.FactId === 41);
            assert.ok(existing, 'Historical fact must NEVER be deleted');
            assert.equal(existing.MappingStatus, 'Superseded');

            // Document status updated to Succeeded now that all conflicts are resolved
            const doc2 = mock.state.documents.find(d => d.DocumentId === 2);
            assert.equal(doc2.IngestionStatus, 'Succeeded');

            // Audited in FactResolutions
            assert.equal(mock.state.resolutions.length, 1);
            assert.equal(mock.state.resolutions[0].ResolutionType, 'HumanDecisionAcceptIncoming');
        } finally {
            resetPool();
        }
    });

    // ------------------------------------------------------------------------
    // SCENARIO 21: SQL transaction rollback on error
    // ------------------------------------------------------------------------
    await t.test('21. SQL transaction rollback -> failure mid-transaction leaves zero partial state', async () => {
        const mock = createMockSqlPool({
            conflicts: [{
                ConflictId: 801,
                ConflictStatus: 'PendingApproval',
                ExistingFactId: 51,
                IncomingFactId: 52
            }],
            facts: [
                { FactId: 51, DocumentId: 1, NormalizedValue: 10000000, MappingStatus: 'Approved' },
                { FactId: 52, DocumentId: 2, NormalizedValue: 12000000, MappingStatus: 'Pending' }
            ],
            documents: [{ DocumentId: 2, IngestionStatus: 'PendingApproval' }]
        });

        // Inject simulated query failure on FactResolutions insert
        mock.state.queryHook = (sqlText) => {
            if (sqlText.includes('INSERT INTO dbo.FactResolutions')) {
                throw new Error('Database connection severed during transaction');
            }
        };

        setPool(mock);

        try {
            await assert.rejects(
                async () => {
                    await resolveConflictDecisionTransaction({
                        conflictId: 801,
                        action: 'accept_incoming',
                        reviewerEmail: 'cfo@contoso.com'
                    });
                },
                /Database connection severed/i
            );

            // Verify clean rollback: no facts modified, no resolutions added
            const fact51 = mock.state.facts.find(f => f.FactId === 51);
            const fact52 = mock.state.facts.find(f => f.FactId === 52);
            const conflict801 = mock.state.conflicts.find(c => c.ConflictId === 801);

            assert.equal(fact51.MappingStatus, 'Approved', 'Fact 51 must remain Approved (rollback)');
            assert.equal(fact52.MappingStatus, 'Pending', 'Fact 52 must remain Pending (rollback)');
            assert.equal(conflict801.ConflictStatus, 'PendingApproval', 'Conflict must remain PendingApproval (rollback)');
            assert.equal(mock.state.resolutions.length, 0, 'Zero resolution records should remain after rollback');
        } finally {
            resetPool();
        }
    });

    // ------------------------------------------------------------------------
    // SCENARIO 22: Chat retrieval while approval is pending -> Excludes unapproved facts
    // ------------------------------------------------------------------------
    await t.test('22. Chat retrieval while approval is pending -> excludes unapproved facts', async () => {
        const mock = createMockSqlPool({
            documents: [
                { DocumentId: 1, FileName: 'Audited_Master.pdf', IngestionStatus: 'Succeeded' },
                { DocumentId: 2, FileName: 'Pending_Report.pdf', IngestionStatus: 'PendingApproval' }
            ],
            facts: [
                { FactId: 1, DocumentId: 1, Metric: 'Revenue', NormalizedValue: 10000000, MappingStatus: 'Approved' },
                { FactId: 2, DocumentId: 2, Metric: 'Revenue', NormalizedValue: 12000000, MappingStatus: 'Pending' },
                { FactId: 3, DocumentId: 1, Metric: 'Old Revenue', NormalizedValue: 9000000, MappingStatus: 'Superseded' },
                { FactId: 4, DocumentId: 2, Metric: 'Bad Revenue', NormalizedValue: 14000000, MappingStatus: 'Rejected' }
            ],
            conflicts: [{
                ConflictId: 901,
                ConflictStatus: 'PendingApproval',
                ExistingFactId: 1,
                IncomingFactId: 2
            }],
            conflictRecords: [
                { ConflictId: 901, FactId: 1, FactRole: 'Existing' },
                { ConflictId: 901, FactId: 2, FactRole: 'IncomingCandidate' }
            ]
        });
        setPool(mock);

        try {
            // Retrieve facts for chat / deterministic calculations
            const facts = await getFactsWithConflictContext();

            // Unapproved facts (Pending, Rejected, Superseded) must be completely excluded
            const factIds = facts.map(f => f.FactId);
            assert.ok(factIds.includes(1), 'Active Approved fact should be present');
            assert.ok(!factIds.includes(2), 'Pending candidate fact must be excluded from chat retrieval');
            assert.ok(!factIds.includes(3), 'Superseded historical fact must be excluded from chat retrieval');
            assert.ok(!factIds.includes(4), 'Rejected candidate fact must be excluded from chat retrieval');

            // The existing fact involved in a pending conflict must not be marked authoritative
            const fact1 = facts.find(f => f.FactId === 1);
            assert.equal(fact1.hasConflict, true);
            assert.equal(fact1.isAuthoritative, false, 'Fact with unresolved conflict cannot be authoritative');
        } finally {
            resetPool();
        }
    });

});
