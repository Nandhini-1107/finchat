// tests/wp4-wp5-router-arabic.test.js
// Test Suite for WP4 (Router & Ingestion Engine) and WP5 (Arabic Normalization & Bilingual Handling)

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    normalizeArabicText,
    isArabicText,
    parseArabicNumber
} = require('../../../src/services/arabic-normalizer');

const {
    resolveEntityAlias,
    resolveMetricAlias,
    setPool,
    resetPool
} = require('../../../src/services/sql');

const { normalizeContent } = require('../../../src/services/content-normalizer');
const { extractFinancialFacts } = require('../../../src/services/fact-extraction');

test('WP4 & WP5: Router, Ingestion Engine & Arabic Bilingual Normalization', async (t) => {

    await t.test('1. WP5: normalizeArabicText - Alef variants, Teh Marbuta, Alef Maqsura', () => {
        // Alef variants
        assert.equal(normalizeArabicText('إيرادات'), 'ايرادات');
        assert.equal(normalizeArabicText('أرباح'), 'ارباح');
        assert.equal(normalizeArabicText('آلات'), 'الات');

        // Teh Marbuta
        assert.equal(normalizeArabicText('شركة'), 'شركه');

        // Alef Maqsura
        assert.equal(normalizeArabicText('مستشفى'), 'مستشفي');
    });

    await t.test('2. WP5: Strips Tashkeel (harakat) and Tatweel (kashida)', () => {
        // Diacritics: Fatha, Damma, Kasra, Tanween, Shadda
        assert.equal(normalizeArabicText('إِيْرَادَاتٌ مُجْمَلَةٌ'), 'ايرادات مجمله');

        // Tatweel / Kashida
        assert.equal(normalizeArabicText('شــــركــــة كــــونتوســــو'), 'شركه كونتوسو');
    });

    await t.test('3. WP5: Converts Eastern Arabic / Arabic-Indic numerals (٠-٩) and parseArabicNumber', () => {
        assert.equal(normalizeArabicText('١٢٥٠٠٠٠'), '1250000');
        assert.equal(normalizeArabicText('السنة المالية ٢٠٢٦'), 'السنه الماليه 2026');

        const num1 = parseArabicNumber('١٢٥٠٠٠٠');
        assert.equal(num1, 1250000);

        const num2 = parseArabicNumber('١٢٬٥٠٠٫٥٠'); // with Arabic comma and decimal
        assert.equal(num2, 12500.50);
    });

    await t.test('4. WP5: Bilingual Entity and Metric Alias Resolution in SQL', async () => {
        const mockPool = {
            connected: true,
            request: () => ({
                input: (name, type, val) => mockPool.request(),
                query: async (q) => {
                    if (q.includes('FROM dbo.MetricAliases') || q.includes('FROM dbo.Metrics')) {
                        return {
                            recordset: [
                                { MetricId: 1, CanonicalMetric: 'Revenue', MetricCategory: 'IncomeStatement' }
                            ]
                        };
                    }
                    if (q.includes('FROM dbo.EntityAliases') || q.includes('FROM dbo.Entities')) {
                        return {
                            recordset: [
                                { EntityId: 10, EntityName: 'Contoso Retail LLC', FiscalYearStartMonth: 1 }
                            ]
                        };
                    }
                    return { recordset: [] };
                }
            })
        };

        setPool(mockPool);

        // Arabic metric "إيرادات" maps to canonical "Revenue"
        const metric = await resolveMetricAlias('إيرادات');
        assert.ok(metric);
        assert.equal(metric.canonicalMetric, 'Revenue');

        // Arabic entity "شركة كونتوسو للتجزئة" maps to "Contoso Retail LLC"
        const entity = await resolveEntityAlias('شركة كونتوسو للتجزئة');
        assert.ok(entity);
        assert.equal(entity.entityName, 'Contoso Retail LLC');

        resetPool();
    });

    await t.test('5. WP4: Router & Ingestion Engine - Content Normalization & Multi-Table Classification', () => {
        const sampleRawDoc = {
            content: 'Contoso Retail LLC Q1 2026 Financial Results\nRevenue was 1,200,000 AED.\n\nTable 1:\nMetric\tQ1 2026\tQ2 2026\nRevenue\t1200000\t1300000\nNet Income\t200000\t250000',
            tables: [
                {
                    rowCount: 3,
                    columnCount: 3,
                    cells: [
                        { rowIndex: 0, columnIndex: 0, content: 'Metric' },
                        { rowIndex: 0, columnIndex: 1, content: 'Q1 2026' },
                        { rowIndex: 0, columnIndex: 2, content: 'Q2 2026' },
                        { rowIndex: 1, columnIndex: 0, content: 'Revenue' },
                        { rowIndex: 1, columnIndex: 1, content: '1200000' },
                        { rowIndex: 1, columnIndex: 2, content: '1300000' },
                        { rowIndex: 2, columnIndex: 0, content: 'Net Income' },
                        { rowIndex: 2, columnIndex: 1, content: '200000' },
                        { rowIndex: 2, columnIndex: 2, content: '250000' }
                    ]
                }
            ],
            paragraphs: [
                { content: 'Contoso Retail LLC Q1 2026 Financial Results' },
                { content: 'Revenue was 1,200,000 AED.' }
            ]
        };

        const normalized = normalizeContent(sampleRawDoc, { fileName: 'Contoso_Q1_2026.pdf' });
        assert.ok(normalized);
        assert.equal(normalized.tables.length, 1);
        assert.ok(normalized.paragraphs.length >= 2);

        // Extract facts from normalized content
        const facts = extractFinancialFacts(normalized, { fileName: 'Contoso_Q1_2026.pdf' });
        assert.ok(Array.isArray(facts));
        assert.ok(facts.length >= 2, 'Should extract multiple facts from table');

        const revFact = facts.find(f => (f.canonicalMetric || f.metric) === 'Revenue');
        assert.ok(revFact, 'Revenue fact must be extracted');
    });

    await t.test('6. WP5: Persian digits, ٫ ٬ separators, and scale words in unit-normalizer', () => {
        const { normalizeFinancialValue, extractScaleFromText } = require('../../../src/services/unit-normalizer');

        // Persian digits and separators in financial value
        const res1 = normalizeFinancialValue('۱۲۵۰۰۰٫۵۰');
        assert.equal(res1.normalizedValue, 125000.50);

        const res2 = normalizeFinancialValue('۳٬۵۰۰٫۷۵');
        assert.equal(res2.normalizedValue, 3500.75);

        // Persian digits with inline scale word
        const res3 = normalizeFinancialValue('۱۲٫۵ مليون');
        assert.equal(res3.normalizedValue, 12500000);

        // Scale words with currency
        const scaleThousand = extractScaleFromText('بآلاف الدراهم');
        assert.equal(scaleThousand.scale, 1000);
        assert.equal(scaleThousand.currency, 'AED');

        const scaleMillion = extractScaleFromText('المبالغ بالملايين (درهم)');
        assert.equal(scaleMillion.scale, 1000000);
        assert.equal(scaleMillion.currency, 'AED');

        const scaleBillion = extractScaleFromText('بالمليارات ريال');
        assert.equal(scaleBillion.scale, 1000000000);
        assert.equal(scaleBillion.currency, 'SAR');
    });
});

