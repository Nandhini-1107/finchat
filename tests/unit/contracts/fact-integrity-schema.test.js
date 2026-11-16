const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
    setPool,
    resetPool,
    resolveEntityAlias,
    resolveMetricAlias,
    getEntityFiscalYearStartMonth,
    updateDocumentHold,
    createDocument,
    insertFinancialFacts
} = require('../../../src/services/sql');

/**
 * Creates an in-memory mock SQL pool representing WP13 master schema and seeds
 */
function createWp13MockPool() {
    const state = {
        entities: [
            { EntityId: 1, EntityName: 'Contoso Retail LLC', EntityType: 'Company', FiscalYearStartMonth: 1, IsActive: 1 },
            { EntityId: 2, EntityName: 'Contoso Logistics LLC', EntityType: 'Company', FiscalYearStartMonth: 1, IsActive: 1 },
            { EntityId: 3, EntityName: 'Contoso Properties LLC', EntityType: 'Company', FiscalYearStartMonth: 4, IsActive: 1 } // April start
        ],
        entityAliases: [
            { AliasId: 1, EntityId: 1, AliasText: 'Contoso Retail', LanguageCode: 'en', IsApproved: 1 },
            { AliasId: 2, EntityId: 1, AliasText: 'Contoso Retail LLC', LanguageCode: 'en', IsApproved: 1 },
            { AliasId: 3, EntityId: 1, AliasText: 'شركة كونتوسو للتجزئة ذ.م.م', LanguageCode: 'ar', IsApproved: 1 },
            { AliasId: 4, EntityId: 1, AliasText: 'كونتوسو للتجزئة', LanguageCode: 'ar', IsApproved: 1 },
            { AliasId: 5, EntityId: 2, AliasText: 'Contoso Logistics', LanguageCode: 'en', IsApproved: 1 },
            { AliasId: 6, EntityId: 2, AliasText: 'كونتوسو للوجستيات', LanguageCode: 'ar', IsApproved: 1 }
        ],
        metrics: [
            { MetricId: 1, CanonicalMetric: 'Revenue', MetricCategory: 'Income Statement' },
            { MetricId: 2, CanonicalMetric: 'Cost of Goods Sold', MetricCategory: 'Income Statement' },
            { MetricId: 3, CanonicalMetric: 'Net Profit', MetricCategory: 'Income Statement' },
            { MetricId: 4, CanonicalMetric: 'Headcount', MetricCategory: 'Human Resources' }
        ],
        metricAliases: [
            { AliasId: 1, MetricId: 1, AliasText: 'Turnover', LanguageCode: 'en', IsApproved: 1 },
            { AliasId: 2, MetricId: 1, AliasText: 'Total Revenue', LanguageCode: 'en', IsApproved: 1 },
            { AliasId: 3, MetricId: 1, AliasText: 'الإيرادات', LanguageCode: 'ar', IsApproved: 1 },
            { AliasId: 4, MetricId: 1, AliasText: 'المبيعات', LanguageCode: 'ar', IsApproved: 1 },
            { AliasId: 5, MetricId: 2, AliasText: 'COGS', LanguageCode: 'en', IsApproved: 1 },
            { AliasId: 6, MetricId: 2, AliasText: 'تكلفة المبيعات', LanguageCode: 'ar', IsApproved: 1 },
            { AliasId: 7, MetricId: 3, AliasText: 'Net Income', LanguageCode: 'en', IsApproved: 1 },
            { AliasId: 8, MetricId: 3, AliasText: 'صافي الربح', LanguageCode: 'ar', IsApproved: 1 },
            { AliasId: 9, MetricId: 4, AliasText: 'Total Headcount', LanguageCode: 'en', IsApproved: 1 },
            { AliasId: 10, MetricId: 4, AliasText: 'عدد الموظفين', LanguageCode: 'ar', IsApproved: 1 }
        ],
        documents: [],
        facts: []
    };

    function executeQuery(text, params) {
        // 1. SELECT from EntityAliases
        if (text.includes('FROM dbo.EntityAliases a') && text.includes('LOWER(a.AliasText) = LOWER(@AliasText)')) {
            const alias = String(params.AliasText || '').trim().toLowerCase();
            const lang = params.LanguageCode ? String(params.LanguageCode).trim().toLowerCase() : null;
            const match = state.entityAliases.find(a => 
                a.AliasText.toLowerCase() === alias && (!lang || a.LanguageCode.toLowerCase() === lang)
            );
            if (match) {
                const ent = state.entities.find(e => e.EntityId === match.EntityId);
                return {
                    recordset: [{
                        EntityId: match.EntityId,
                        EntityName: ent ? ent.EntityName : 'Unknown',
                        FiscalYearStartMonth: ent ? ent.FiscalYearStartMonth : 1
                    }]
                };
            }
            return { recordset: [] };
        }

        // 2. Direct SELECT from Entities
        if (text.includes('FROM dbo.Entities') && text.includes('LOWER(EntityName) = LOWER(@EntityName)')) {
            const name = String(params.EntityName || '').trim().toLowerCase();
            const ent = state.entities.find(e => e.EntityName.toLowerCase() === name);
            if (ent) {
                return {
                    recordset: [{
                        EntityId: ent.EntityId,
                        EntityName: ent.EntityName,
                        FiscalYearStartMonth: ent.FiscalYearStartMonth
                    }]
                };
            }
            return { recordset: [] };
        }

        // 3. SELECT FiscalYearStartMonth
        if (text.includes('SELECT FiscalYearStartMonth FROM dbo.Entities WHERE EntityId = @EntityId')) {
            const ent = state.entities.find(e => e.EntityId === Number(params.EntityId));
            return { recordset: ent ? [{ FiscalYearStartMonth: ent.FiscalYearStartMonth }] : [] };
        }

        // 4. SELECT from MetricAliases
        if (text.includes('FROM dbo.MetricAliases a') && text.includes('LOWER(a.AliasText) = LOWER(@AliasText)')) {
            const alias = String(params.AliasText || '').trim().toLowerCase();
            const lang = params.LanguageCode ? String(params.LanguageCode).trim().toLowerCase() : null;
            const match = state.metricAliases.find(m => 
                m.AliasText.toLowerCase() === alias && (!lang || m.LanguageCode.toLowerCase() === lang)
            );
            if (match) {
                const met = state.metrics.find(m => m.MetricId === match.MetricId);
                return {
                    recordset: [{
                        MetricId: match.MetricId,
                        CanonicalMetric: met ? met.CanonicalMetric : 'Unknown'
                    }]
                };
            }
            return { recordset: [] };
        }

        // 5. Direct SELECT from Metrics
        if (text.includes('FROM dbo.Metrics') && text.includes('LOWER(CanonicalMetric) = LOWER(@CanonicalMetric)')) {
            const name = String(params.CanonicalMetric || '').trim().toLowerCase();
            const met = state.metrics.find(m => m.CanonicalMetric.toLowerCase() === name);
            if (met) {
                return { recordset: [{ MetricId: met.MetricId, CanonicalMetric: met.CanonicalMetric }] };
            }
            return { recordset: [] };
        }

        // 6. INSERT INTO dbo.Documents
        if (text.includes('INSERT INTO dbo.Documents')) {
            const docId = state.documents.length + 1001;
            const doc = {
                DocumentId: docId,
                FileName: params.FileName,
                SourceType: params.SourceType,
                ContentHash: params.ContentHash || null,
                IndexingStatus: params.IndexingStatus || 'NotIndexed',
                UploaderEmail: params.UploaderEmail || null,
                BlobUri: params.BlobUri || null,
                ConflictHold: params.ConflictHold ? 1 : 0,
                OpenConflictId: params.OpenConflictId || null
            };
            state.documents.push(doc);
            return { recordset: [{ DocumentId: docId }] };
        }

        // 7. UPDATE dbo.Documents (updateDocumentHold)
        if (text.includes('SET ConflictHold = @ConflictHold')) {
            const doc = state.documents.find(d => d.DocumentId === Number(params.DocumentId));
            if (doc) {
                doc.ConflictHold = params.ConflictHold ? 1 : 0;
                doc.OpenConflictId = params.OpenConflictId || null;
            }
            return { rowsAffected: [1] };
        }

        // 8. INSERT INTO dbo.FinancialFacts (with duplicate check on UX_FinancialFacts_Doc_Identity_Location)
        if (text.includes('INSERT INTO dbo.FinancialFacts')) {
            const docId = Number(params.DocumentId);
            const identityHash = params.FactIdentityHash;
            const locHash = params.SourceLocationHash;

            // Check unique index constraint
            const isDuplicate = state.facts.some(f => 
                f.DocumentId === docId && f.FactIdentityHash === identityHash && f.SourceLocationHash === locHash
            );

            if (isDuplicate) {
                // IF NOT EXISTS condition in SQL returns 0 rows inserted
                return { recordset: [] };
            }

            const factId = state.facts.length + 5001;
            const newFact = {
                FactId: factId,
                DocumentId: docId,
                EntityId: params.EntityId || null,
                MetricId: params.MetricId || null,
                PeriodId: params.PeriodId || null,
                MappingStatus: params.MappingStatus,
                FactIdentityHash: identityHash,
                SourceLocationHash: locHash,
                NormalizedValue: params.NormalizedValue,
                OriginalLabel: params.OriginalLabel
            };
            state.facts.push(newFact);
            return { recordset: [{ FactId: factId }] };
        }

        // 9. SourceAuthorityRanks check
        if (text.includes('dbo.SourceAuthorityRanks')) {
            return { recordset: [{ AuthorityRank: params.AuthorityRank || 4 }] };
        }

        return { recordset: [] };
    }

    return {
        state,
        connected: true,
        request: () => {
            const params = {};
            const req = {
                input: (name, typeOrVal, val) => {
                    params[name] = val !== undefined ? val : typeOrVal;
                    return req;
                },
                query: async (q) => executeQuery(q, params),
                batch: async () => ({ rowsAffected: [1] })
            };
            return req;
        }
    };
}

test('WP13: Fact Integrity & Master Schema Migration', async (t) => {

    await t.test('1. Migration 003 & Schema Integrity: SQL migration declares all required schema items', () => {
        const rootDir = path.resolve(__dirname, '../../..');
        const migPath = path.join(rootDir, 'database', 'migrations', '003_fact_integrity_and_master_schema.sql');
        const schemaPath = path.join(rootDir, 'database', 'schema.sql');

        assert.ok(fs.existsSync(migPath), 'Migration 003 file must exist');
        assert.ok(fs.existsSync(schemaPath), 'schema.sql file must exist');

        const migContent = fs.readFileSync(migPath, 'utf8');
        const schemaContent = fs.readFileSync(schemaPath, 'utf8');

        // Check required columns on dbo.Documents
        const requiredDocCols = ['ContentHash', 'IndexingStatus', 'UploaderEmail', 'BlobUri', 'ConflictHold', 'OpenConflictId'];
        for (const col of requiredDocCols) {
            assert.ok(migContent.includes(col), `Migration 003 must declare Documents.${col}`);
            assert.ok(schemaContent.includes(col), `schema.sql must declare Documents.${col}`);
        }

        // Check required columns and unique index on dbo.FinancialFacts
        assert.ok(migContent.includes('FactIdentityHash'), 'Must declare FactIdentityHash');
        assert.ok(migContent.includes('SourceLocationHash'), 'Must declare SourceLocationHash');
        assert.ok(migContent.includes('UX_FinancialFacts_Doc_Identity_Location'), 'Must declare unique index on identity and location hash');
        assert.ok(schemaContent.includes('UX_FinancialFacts_Doc_Identity_Location'), 'schema.sql must declare unique index UX_FinancialFacts_Doc_Identity_Location');

        // Check EntityAliases table and FiscalYearStartMonth
        assert.ok(migContent.includes('dbo.EntityAliases'), 'Migration must create dbo.EntityAliases');
        assert.ok(migContent.includes('FiscalYearStartMonth'), 'Migration must declare FiscalYearStartMonth');
        assert.ok(schemaContent.includes('dbo.EntityAliases'), 'schema.sql must declare dbo.EntityAliases');

        // Check backfill updates
        assert.ok(migContent.includes("MappingStatus = 'NeedsReview'"), 'Migration must backfill NULL mapping status to NeedsReview');
        assert.ok(migContent.includes("IndexingStatus = 'NotIndexed'"), 'Migration must backfill IndexingStatus');
        assert.ok(migContent.includes("ConflictHold = 0"), 'Migration must backfill ConflictHold');
    });

    await t.test('2. Entity Alias Resolution: Resolves English and Arabic variants without duplicating entities', async () => {
        const mock = createWp13MockPool();
        setPool(mock);
        try {
            // English legal name
            const resEn = await resolveEntityAlias('Contoso Retail LLC', 'en');
            assert.ok(resEn, 'Should resolve English legal name');
            assert.equal(resEn.entityId, 1);
            assert.equal(resEn.entityName, 'Contoso Retail LLC');

            // English trade alias
            const resEnTrade = await resolveEntityAlias('Contoso Retail');
            assert.ok(resEnTrade, 'Should resolve English trade name');
            assert.equal(resEnTrade.entityId, 1);

            // Arabic full translation
            const resArFull = await resolveEntityAlias('شركة كونتوسو للتجزئة ذ.م.م', 'ar');
            assert.ok(resArFull, 'Should resolve Arabic full translation');
            assert.equal(resArFull.entityId, 1);

            // Arabic short translation
            const resArShort = await resolveEntityAlias('كونتوسو للتجزئة');
            assert.ok(resArShort, 'Should resolve Arabic short translation');
            assert.equal(resArShort.entityId, 1);

            // Logistics entity in Arabic
            const resLogistics = await resolveEntityAlias('كونتوسو للوجستيات');
            assert.ok(resLogistics, 'Should resolve Arabic logistics alias');
            assert.equal(resLogistics.entityId, 2);

            // Unknown entity returns null without silent insertion
            const resUnknown = await resolveEntityAlias('NonExistentCorp 999');
            assert.equal(resUnknown, null, 'Unrecognized entity must return null');
        } finally {
            resetPool();
        }
    });

    await t.test('3. Metric Alias Resolution: Resolves IFRS and HR terms in English and Arabic', async () => {
        const mock = createWp13MockPool();
        setPool(mock);
        try {
            // Revenue English alias
            const revEn = await resolveMetricAlias('Turnover');
            assert.ok(revEn, 'Should resolve Turnover to Revenue');
            assert.equal(revEn.canonicalMetric, 'Revenue');

            // Revenue Arabic alias
            const revAr = await resolveMetricAlias('الإيرادات', 'ar');
            assert.ok(revAr, 'Should resolve Arabic revenue');
            assert.equal(revAr.canonicalMetric, 'Revenue');

            // COGS English alias
            const cogsEn = await resolveMetricAlias('COGS');
            assert.ok(cogsEn, 'Should resolve COGS');
            assert.equal(cogsEn.canonicalMetric, 'Cost of Goods Sold');

            // Net profit Arabic alias
            const npAr = await resolveMetricAlias('صافي الربح', 'ar');
            assert.ok(npAr, 'Should resolve Arabic Net Profit');
            assert.equal(npAr.canonicalMetric, 'Net Profit');

            // HR Headcount Arabic alias
            const hcAr = await resolveMetricAlias('عدد الموظفين');
            assert.ok(hcAr, 'Should resolve Arabic Headcount');
            assert.equal(hcAr.canonicalMetric, 'Headcount');
        } finally {
            resetPool();
        }
    });

    await t.test('4. Per-Entity Fiscal Year: Retrieves configured FiscalYearStartMonth', async () => {
        const mock = createWp13MockPool();
        setPool(mock);
        try {
            // Entity 1 defaults to January (1)
            const fy1 = await getEntityFiscalYearStartMonth(1);
            assert.equal(fy1, 1, 'Contoso Retail should default to month 1');

            // Entity 3 configured for April (4)
            const fy3 = await getEntityFiscalYearStartMonth(3);
            assert.equal(fy3, 4, 'Contoso Properties should have month 4');

            // Non-existent entity defaults safely to 1
            const fyUnknown = await getEntityFiscalYearStartMonth(999);
            assert.equal(fyUnknown, 1, 'Unknown entity should default to month 1');
        } finally {
            resetPool();
        }
    });

    await t.test('5. Period Resolution & NeedsReview: Unresolved/Hijri date assigns NeedsReview, never guesses', async () => {
        const mock = createWp13MockPool();
        setPool(mock);
        try {
            const docId = 200;

            // Fact with unresolvable Hijri date
            const facts = [
                {
                    entity: 'Contoso Retail LLC',
                    metric: 'Revenue',
                    periodLabel: '1447 هـ (Hijri Unresolved)',
                    periodStart: null,
                    periodEnd: null,
                    numericValue: 5000000,
                    unit: 'AED'
                },
                {
                    entity: 'Contoso Retail LLC',
                    metric: 'Revenue',
                    periodLabel: 'Q1 2026',
                    reportingBasis: 'Actual',
                    sourceLocation: 'Page 1, Row 5',
                    periodStart: '2026-01-01',
                    periodEnd: '2026-03-31',
                    numericValue: 7500000,
                    unit: 'AED'
                }
            ];

            const insertedIds = await insertFinancialFacts(docId, facts);
            assert.equal(insertedIds.length, 2, 'Both facts should be inserted');

            const insertedFacts = mock.state.facts.filter(f => f.DocumentId === docId);
            assert.equal(insertedFacts.length, 2);

            // Fact 1 had unresolvable Hijri date -> must route to NeedsReview
            assert.equal(insertedFacts[0].MappingStatus, 'NeedsReview', 'Unresolved Hijri fact must be marked NeedsReview');
            assert.ok(insertedFacts[0].FactIdentityHash, 'Must compute FactIdentityHash');
            assert.ok(insertedFacts[0].SourceLocationHash, 'Must compute SourceLocationHash');

            // Fact 2 had valid dates -> Approved
            assert.equal(insertedFacts[1].MappingStatus, 'Approved', 'Resolved fact should be Approved');
        } finally {
            resetPool();
        }
    });

    await t.test('6. Unique Constraint Enforcement: Prevents duplicate fact insertion for same document & location', async () => {
        const mock = createWp13MockPool();
        setPool(mock);
        try {
            const docId = 300;
            const duplicateFact = {
                entity: 'Contoso Retail LLC',
                metric: 'Revenue',
                periodLabel: 'Q1 2026',
                periodStart: '2026-01-01',
                periodEnd: '2026-03-31',
                numericValue: 12000000,
                unit: 'AED',
                sourceLocationText: 'Sheet1!C15'
            };

            // First insertion succeeds
            const firstInsert = await insertFinancialFacts(docId, [duplicateFact]);
            assert.equal(firstInsert.length, 1);

            // Second insertion with identical document, identity hash, and location hash is rejected
            const secondInsert = await insertFinancialFacts(docId, [duplicateFact]);
            assert.equal(secondInsert.length, 0, 'Duplicate fact must be rejected/prevented by unique constraint');

            const matchingFacts = mock.state.facts.filter(f => f.DocumentId === docId);
            assert.equal(matchingFacts.length, 1, 'Only one instance of the fact should exist in storage');
        } finally {
            resetPool();
        }
    });

    await t.test('7. Document Evolution & ConflictHold: createDocument and updateDocumentHold operate correctly', async () => {
        const mock = createWp13MockPool();
        setPool(mock);
        try {
            const docId = await createDocument({
                fileName: 'Annual_Report_2026.pdf',
                sourceType: 'ManualUpload',
                contentHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
                indexingStatus: 'NotIndexed',
                uploaderEmail: 'cfo@contoso.com',
                blobUri: 'https://storage.blob.core.windows.net/uploads/Annual_Report_2026.pdf',
                conflictHold: 0
            });

            assert.ok(docId, 'Document ID should be created');
            const doc = mock.state.documents.find(d => d.DocumentId === docId);
            assert.ok(doc);
            assert.equal(doc.ContentHash, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
            assert.equal(doc.IndexingStatus, 'NotIndexed');
            assert.equal(doc.UploaderEmail, 'cfo@contoso.com');
            assert.equal(doc.ConflictHold, 0);

            // Place on conflict hold
            await updateDocumentHold(docId, true, 42);
            assert.equal(doc.ConflictHold, 1, 'Document should be marked on ConflictHold');
            assert.equal(doc.OpenConflictId, 42, 'OpenConflictId should be recorded');

            // Release conflict hold
            await updateDocumentHold(docId, false, null);
            assert.equal(doc.ConflictHold, 0, 'Document hold should be released');
            assert.equal(doc.OpenConflictId, null);
        } finally {
            resetPool();
        }
    });

    await t.test('8. Acceptance Dataset: tests/acceptance/acceptance-dataset.json includes WP13 test records', () => {
        const datasetPath = path.resolve(__dirname, '../../acceptance', 'acceptance-dataset.json');
        assert.ok(fs.existsSync(datasetPath), 'acceptance-dataset.json must exist');
        const dataset = JSON.parse(fs.readFileSync(datasetPath, 'utf8'));

        const wp13Cases = dataset.filter(d => d.package === 'WP13');
        assert.ok(wp13Cases.length >= 4, 'Must have at least 4 WP13 acceptance cases');

        assert.ok(wp13Cases.some(c => c.id === 'wp13-missing-period-needs-review'));
        assert.ok(wp13Cases.some(c => c.id === 'wp13-duplicate-fact-identity-location-rejection'));
        assert.ok(wp13Cases.some(c => c.id === 'wp13-entity-alias-resolution-arabic-english'));
        assert.ok(wp13Cases.some(c => c.id === 'wp13-fiscal-year-start-month-config'));
    });
});
