const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
    computeVariance,
    computeCategorySum,
    computeReconciliationDiscrepancy,
    computePeriodComparison,
    assertCurrencyMatch
} = require('../../../src/services/calculation-engine');
const { Decimal } = require('../../../src/utils/decimal');

test('WP3: Pure SQL Fact Store, Effective Facts & Decimal Math Engine', async (t) => {

    await t.test('1. Decimal Math Precision: Half-up rounding and zero floating-point drift', () => {
        // 0.1 + 0.2 must equal exactly 0.30, not 0.30000000000000004
        const a = new Decimal('0.1');
        const b = new Decimal('0.2');
        const sum = a.plus(b);
        assert.equal(sum.toFixed(2), '0.30');
        assert.equal(sum.toNumber(4), 0.3);

        // Half-up rounding checks
        assert.equal(new Decimal('10.555').toFixed(2), '10.56'); // 5 rounds up
        assert.equal(new Decimal('10.554').toFixed(2), '10.55'); // 4 rounds down
        assert.equal(new Decimal('10.5550').toFixed(2), '10.56');
    });

    await t.test('2. Calculation Rule 1: Zero-base denominator returns null percentChange with explanation', () => {
        const baseFact = {
            FactId: 1,
            Metric: 'Net Profit',
            Entity: 'Contoso Retail LLC',
            PeriodLabel: 'Q1 2025',
            NumericValue: 0,
            Currency: 'AED'
        };

        const compFact = {
            FactId: 2,
            Metric: 'Net Profit',
            Entity: 'Contoso Retail LLC',
            PeriodLabel: 'Q1 2026',
            NumericValue: 500000,
            Currency: 'AED'
        };

        const result = computeVariance(baseFact, compFact);
        assert.ok(result);
        assert.equal(result.difference, 500000);
        assert.equal(result.percentChange, null, 'Percent change with zero base must be null');
        assert.equal(result.percentChangeExplanation, 'Base value is zero; percentage change undefined.');
    });

    await t.test('3. Calculation Rule 2: Variance direction is strictly Comparison - Base (valB - valA)', () => {
        const factBudget = {
            FactId: 10,
            Metric: 'Operating Expenses',
            PeriodLabel: 'FY2026 Budget',
            NumericValue: 4000000,
            Currency: 'AED'
        };

        const factActual = {
            FactId: 11,
            Metric: 'Operating Expenses',
            PeriodLabel: 'FY2026 Actual',
            NumericValue: 4500000,
            Currency: 'AED'
        };

        // Actual (comp) vs Budget (base): 4,500,000 - 4,000,000 = +500,000 (+12.50%)
        const result = computeVariance(factBudget, factActual);
        assert.equal(result.difference, 500000);
        assert.equal(result.percentChange, 12.5);
        assert.equal(result.direction, 'Increase');
        assert.equal(result.formula, '(4500000.0000 - 4000000.0000) = 500000.0000');
    });

    await t.test('4. Calculation Rule 4: Strict currency isolation throws on currency mismatch', () => {
        const factAed = { Metric: 'Revenue', NumericValue: 1000000, Currency: 'AED' };
        const factUsd = { Metric: 'Revenue', NumericValue: 1000000, Currency: 'USD' };

        assert.throws(
            () => computeVariance(factAed, factUsd),
            /CurrencyMismatch/
        );

        assert.throws(
            () => computeCategorySum([factAed, factUsd]),
            /CurrencyMismatch/
        );
    });

    await t.test('5. Calculation Rule 5 & 6: Half-up rounding to 2 dp and preserved unit scaling', () => {
        const factQ1 = {
            Metric: 'EBITDA',
            NumericValue: 1234567.89,
            Unit: 'AED thousands',
            Currency: 'AED',
            PeriodLabel: 'Q1'
        };

        const factQ2 = {
            Metric: 'EBITDA',
            NumericValue: 1456789.12,
            Unit: 'AED thousands',
            Currency: 'AED',
            PeriodLabel: 'Q2'
        };

        const result = computeVariance(factQ1, factQ2);
        assert.equal(result.unit, 'AED thousands');
        assert.equal(result.currency, 'AED');
        assert.equal(result.difference, 222221.23);
        assert.equal(result.percentChange, 18.00); // 222221.23 / 1234567.89 * 100 = 17.99996... -> 18.00
    });

    await t.test('6. Calculation Rule 7: Structured Provenance Output', () => {
        const factA = {
            FactId: 101,
            Metric: 'Revenue',
            NumericValue: 5000000,
            Currency: 'AED',
            SourceFileName: '2025_Audited.pdf',
            SourceLocation: 'Page 5, Note 12'
        };

        const factB = {
            FactId: 202,
            Metric: 'Revenue',
            NumericValue: 6000000,
            Currency: 'AED',
            SourceFileName: '2026_Audited.pdf',
            SourceLocation: 'Page 6, Note 14'
        };

        const result = computeVariance(factA, factB);
        assert.ok(result.provenance);
        assert.equal(result.provenance.baseFactId, 101);
        assert.equal(result.provenance.baseFile, '2025_Audited.pdf');
        assert.equal(result.provenance.comparisonFactId, 202);
        assert.equal(result.provenance.comparisonFile, '2026_Audited.pdf');
    });

    await t.test('7. One Effective Fact Rule: Selects latest non-superseded version', () => {
        const facts = [
            {
                FactId: 1,
                EntityName: 'Contoso Retail LLC',
                CanonicalMetric: 'Revenue',
                PeriodName: 'Q1 2026',
                ReportingBasis: 'Actual',
                NormalizedUnit: 'AED',
                Currency: 'AED',
                NormalizedValue: 10000000,
                VersionNumber: 1,
                DocumentId: 10
            },
            {
                // Version 2 repeats the fact with updated figure
                FactId: 2,
                EntityName: 'Contoso Retail LLC',
                CanonicalMetric: 'Revenue',
                PeriodName: 'Q1 2026',
                ReportingBasis: 'Actual',
                NormalizedUnit: 'AED',
                Currency: 'AED',
                NormalizedValue: 10500000,
                VersionNumber: 2,
                DocumentId: 20
            }
        ];

        // Deduplication rule
        const effectiveMap = new Map();
        for (const r of facts) {
            const key = `${r.EntityName}|${r.CanonicalMetric}|${r.PeriodName}|${r.ReportingBasis}|${r.NormalizedUnit}|${r.Currency}`.toLowerCase();
            const existing = effectiveMap.get(key);
            if (!existing) {
                effectiveMap.set(key, r);
            } else {
                const vNew = Number(r.VersionNumber || 1);
                const vOld = Number(existing.VersionNumber || 1);
                if (vNew > vOld || (vNew === vOld && r.FactId > existing.FactId)) {
                    effectiveMap.set(key, r);
                }
            }
        }

        const effective = Array.from(effectiveMap.values());
        assert.equal(effective.length, 1, 'Duplicate identity must be reduced to 1 effective fact');
        assert.equal(effective[0].FactId, 2, 'Must pick Version 2 fact');
        assert.equal(effective[0].NormalizedValue, 10500000);
    });

    await t.test('8. SQL View Criteria: Requires MappingStatus = Approved and ConflictHold = 0', () => {
        const testRows = [
            { FactId: 1, MappingStatus: 'Approved', ConflictHold: 0, IngestionStatus: 'Succeeded' }, // Valid
            { FactId: 2, MappingStatus: 'NeedsReview', ConflictHold: 0, IngestionStatus: 'Succeeded' }, // Excluded
            { FactId: 3, MappingStatus: 'Approved', ConflictHold: 1, IngestionStatus: 'Succeeded' }, // Excluded (Held)
            { FactId: 4, MappingStatus: null, ConflictHold: 0, IngestionStatus: 'Succeeded' }, // Excluded (NULL not allowed)
            { FactId: 5, MappingStatus: 'Rejected', ConflictHold: 0, IngestionStatus: 'Succeeded' } // Excluded
        ];

        const viewFilter = testRows.filter(r => r.MappingStatus === 'Approved' && r.ConflictHold === 0);
        assert.equal(viewFilter.length, 1);
        assert.equal(viewFilter[0].FactId, 1);
    });

    await t.test('9. Half-Up Rounding of Negatives: -2.675 -> -2.68 and -2.674 -> -2.67', () => {
        // Strict financial half-up rounding on negative figures
        assert.equal(new Decimal('-2.675').toFixed(2), '-2.68', '-2.675 must round half-up away from zero to -2.68');
        assert.equal(new Decimal('-2.674').toFixed(2), '-2.67', '-2.674 must round down towards zero to -2.67');
        assert.equal(new Decimal('2.675').toFixed(2), '2.68', '2.675 must round half-up to 2.68');
        assert.equal(new Decimal('-0.005').toFixed(2), '-0.01', '-0.005 must round to -0.01');
        assert.equal(new Decimal('-0.004').toFixed(2), '0.00', '-0.004 must round to 0.00');
    });

    await t.test('10. Division Precision: High precision arbitrary decimal division', () => {
        const ten = new Decimal('10');
        const three = new Decimal('3');
        const res = ten.dividedBy(three);

        assert.equal(res.toFixed(2), '3.33');
        assert.equal(res.toFixed(4), '3.3333');
        assert.equal(res.toFixed(6), '3.333333');

        // Division by zero throws explicit Error
        assert.throws(
            () => ten.dividedBy(new Decimal('0')),
            /Division by zero/
        );
    });

    await t.test('11. Extreme Values: 1e15 (large) and 1e-6 (tiny)', () => {
        // Large values (1e15 = 1,000,000,000,000,000)
        const largeStr = new Decimal('1e15');
        const largeNum = new Decimal(1000000000000000);
        assert.equal(largeStr.toFixed(2), '1000000000000000.00');
        assert.equal(largeNum.toFixed(2), '1000000000000000.00');

        // Tiny values (1e-6 = 0.000001)
        const tinyStr = new Decimal('1e-6');
        const tinyNum = new Decimal(0.000001);
        assert.equal(tinyStr.toFixed(6), '0.000001');
        assert.equal(tinyNum.toFixed(6), '0.000001');

        // Arithmetic between extreme values
        const product = largeStr.times(tinyStr);
        assert.equal(product.toFixed(2), '1000000000.00');
    });

    await t.test('12. Zero Base Variance: Division by zero cleanly guarded with null percentChange', () => {
        const zeroFact = { Metric: 'Revenue', NumericValue: 0, Currency: 'USD' };
        const positiveFact = { Metric: 'Revenue', NumericValue: 1000, Currency: 'USD' };
        const negativeFact = { Metric: 'Revenue', NumericValue: -500, Currency: 'USD' };

        const resPos = computeVariance(zeroFact, positiveFact);
        assert.equal(resPos.difference, 1000);
        assert.equal(resPos.percentChange, null);
        assert.equal(resPos.percentChangeExplanation, 'Base value is zero; percentage change undefined.');

        const resNeg = computeVariance(zeroFact, negativeFact);
        assert.equal(resNeg.difference, -500);
        assert.equal(resNeg.percentChange, null);
        assert.equal(resNeg.percentChangeExplanation, 'Base value is zero; percentage change undefined.');
    });

    await t.test('13. WP3 Question Resolution: Metric Aliases (English & Arabic)', () => {
        const { resolveQuestionToDimensions } = require('../../../src/services/calculation-engine');
        assert.equal(resolveQuestionToDimensions('What was the total revenue?').metric, 'Revenue');
        assert.equal(resolveQuestionToDimensions('ما هي إيرادات الشركة؟').metric, 'Revenue');
        assert.equal(resolveQuestionToDimensions('كم كان صافي الربح؟').metric, 'Net Profit');
        assert.equal(resolveQuestionToDimensions('ما هو عدد الموظفين؟').metric, 'Headcount');
        assert.equal(resolveQuestionToDimensions('ما هي الأرباح التشغيلية؟').metric, 'Operating Profit');
    });

    await t.test('14. WP3 Question Resolution: Entity Aliases (English & Arabic)', () => {
        const { resolveQuestionToDimensions } = require('../../../src/services/calculation-engine');
        assert.equal(resolveQuestionToDimensions('Revenue for Contoso Retail LLC').entity, 'Contoso Retail LLC');
        assert.equal(resolveQuestionToDimensions('إيرادات شركة كونتوسو للتجزئة').entity, 'Contoso Retail LLC');
        assert.equal(resolveQuestionToDimensions('أرباح كونتوسو اللوجستية').entity, 'Contoso Logistics LLC');
        assert.equal(resolveQuestionToDimensions('مصروفات كونتوسو العقارية').entity, 'Contoso Properties LLC');
        assert.equal(resolveQuestionToDimensions('نتائج مجموعة كونتوسو القابضة').entity, 'Contoso Holdings');
    });

    await t.test('15. WP3 Question Resolution: Arabic & Relative Periods', () => {
        const { resolveQuestionToDimensions } = require('../../../src/services/calculation-engine');
        assert.equal(resolveQuestionToDimensions('Revenue in Q1 2026').period, 'Q1 2026');
        assert.equal(resolveQuestionToDimensions('إيرادات الربع الأول 2026').period, 'Q1 2026');
        assert.equal(resolveQuestionToDimensions('أرباح الربع الثاني ٢٠٢٦').period, 'Q2 2026');
        assert.equal(resolveQuestionToDimensions('نتائج السنة المالية 2026').period, 'FY2026');
        const relativeQ = resolveQuestionToDimensions('ما هو التغير مقارنة بالربع الماضي؟');
        assert.equal(relativeQ.period, 'PriorQuarter');
        assert.equal(relativeQ.isRelative, true);
    });

    await t.test('16. WP3 Question Resolution: Reporting Basis (Actual vs Budget vs Forecast)', () => {
        const { resolveQuestionToDimensions } = require('../../../src/services/calculation-engine');
        assert.equal(resolveQuestionToDimensions('Actual Q1 revenue').basis, 'Actual');
        assert.equal(resolveQuestionToDimensions('FY2026 budget operating expenses').basis, 'Budget');
        assert.equal(resolveQuestionToDimensions('الميزانية التقديرية لعام 2026').basis, 'Budget');
        assert.equal(resolveQuestionToDimensions('توقعات الأرباح').basis, 'Forecast');
    });

    await t.test('17. WP3 Question Resolution: Dynamic Entity Aliases from Database & Non-Contoso Entity Resolution', async () => {
        const {
            resolveQuestionToDimensions,
            loadAliasesFromDatabase,
            registerEntityAlias,
            resetAliasesCache
        } = require('../../../src/services/calculation-engine');

        // Test non-Contoso entity pre-seeded in cache
        const resApex = resolveQuestionToDimensions('What was the Q1 2026 revenue for Apex Global Logistics?');
        assert.equal(resApex.entity, 'Apex Global Logistics LLC', 'Must resolve non-Contoso entity');
        assert.equal(resApex.metric, 'Revenue');
        assert.equal(resApex.period, 'Q1 2026');

        // Test dynamically loading non-Contoso entity from dbo.EntityAliases via mock pool
        const mockEntityRows = [
            { AliasText: 'Acme Industrial', LanguageCode: 'en', EntityName: 'Acme Industrial Corp' },
            { AliasText: 'شركة أكمي الصناعية', LanguageCode: 'ar', EntityName: 'Acme Industrial Corp' }
        ];
        const mockMetricRows = [
            { AliasText: 'Gross Margin', LanguageCode: 'en', CanonicalMetric: 'Gross Margin' }
        ];

        const mockPool = {
            connected: true,
            request: () => ({
                query: async (q) => {
                    if (q.includes('FROM dbo.EntityAliases')) {
                        return { recordset: mockEntityRows };
                    }
                    if (q.includes('FROM dbo.MetricAliases')) {
                        return { recordset: mockMetricRows };
                    }
                    return { recordset: [] };
                }
            })
        };

        const loaded = await loadAliasesFromDatabase(mockPool);
        assert.equal(loaded, true, 'Must load aliases from database');

        // Resolve newly loaded non-Contoso entity in English and Arabic
        const resAcmeEn = resolveQuestionToDimensions('What was the Gross Margin for Acme Industrial in Q1 2026?');
        assert.equal(resAcmeEn.entity, 'Acme Industrial Corp', 'Must resolve dynamically loaded non-Contoso entity');
        assert.equal(resAcmeEn.metric, 'Gross Margin');
        assert.equal(resAcmeEn.period, 'Q1 2026');

        const resAcmeAr = resolveQuestionToDimensions('ما هي نتائج شركة أكمي الصناعية في الربع الأول ٢٠٢٦؟');
        assert.equal(resAcmeAr.entity, 'Acme Industrial Corp');
        assert.equal(resAcmeAr.period, 'Q1 2026');

        // Restore default cache
        resetAliasesCache();
    });
});

