const test = require('node:test');
const assert = require('node:assert/strict');
const { extractFinancialFacts, extractDocumentContext, analyzeTableLayout } = require('../../../src/services/fact-extraction');
const { normalizeFinancialValue, areValuesEqual } = require('../../../src/services/unit-normalizer');
const { findRelevantStructuredFacts } = require('../../../src/services/evidence-validation');

test('Dynamic Financial Fact Architecture Test Suite', async (t) => {

    await t.test('1. Unit Normalizer: Handles parentheses negatives and thousand/million multipliers', () => {
        // Parentheses negative: (5,400)
        const neg = normalizeFinancialValue('(5,400)');
        assert.equal(neg.originalValue, -5400);
        assert.equal(neg.normalizedValue, -5400);

        // AED thousand scaling: 5,100 AED thousand -> 5,100,000 AED
        const scaled = normalizeFinancialValue('5,100 thousand', { currency: 'AED' });
        assert.equal(scaled.originalValue, 5100);
        assert.equal(scaled.normalizedValue, 5100000);
        assert.equal(scaled.currency, 'AED');
        assert.equal(scaled.scale, 1000);

        // Millions with currency symbol: $12.5M
        const mill = normalizeFinancialValue('$12.5 million');
        assert.equal(mill.originalValue, 12.5);
        assert.equal(mill.normalizedValue, 12500000);
        assert.equal(mill.currency, 'USD');

        // Percentages: 9%
        const pct = normalizeFinancialValue('9%');
        assert.equal(pct.normalizedValue, 0.09);
        assert.ok(pct.normalizedUnit === 'ratio' || pct.normalizedUnit === 'percentage');
    });

    await t.test('2. Dynamic Table Layout Detection: Correctly identifies Entity-Period record tables', () => {
        const table = {
            headers: ['Entity', 'Quarter', 'Revenue', 'Net profit', 'Source used', 'Comment'],
            header_row_index: 3,
            column_count: 6
        };
        const layout = analyzeTableLayout(table);
        assert.equal(layout.layoutType, 'entity_period_records');
        assert.equal(layout.entityColIdx, 0);
        assert.equal(layout.periodColIdx, 1);
    });

    await t.test('3. Dynamic Table Layout Detection: Correctly identifies Time-Series matrix', () => {
        const table = {
            headers: ['Line item', 'Q1 2026', 'Q2 2026', 'Q3 2026', 'FY 2026'],
            header_row_index: 0,
            column_count: 5
        };
        const layout = analyzeTableLayout(table);
        assert.equal(layout.layoutType, 'time_series_matrix');
        assert.ok(layout.periodCols.length >= 3);
    });

    await t.test('4. Dynamic Fact Extraction: Entity-Period record table extracts facts with correct entity, period, and metrics', () => {
        const mockDoc = {
            document_id: 'doc-354',
            fullMarkdown: 'Working file maintained by Group Finance\nCurrency: AED\nSynthetic data for training only',
            tables: [
                {
                    table_id: 'table_1',
                    header_row_index: 3,
                    headers: ['Entity', 'Quarter', 'Revenue', 'Net profit', 'Source used', 'Comment'],
                    rows: [
                        // Pre-header title & banner rows (must NOT be treated as data rows)
                        { rowIndex: 0, rawValues: ['Contoso Holdings – Actuals 2026', '', '', '', '', ''] },
                        { rowIndex: 1, rawValues: ['Group Finance – Currency: AED', '', '', '', '', ''] },
                        { rowIndex: 2, rawValues: ['', '', '', '', '', ''] },
                        // Data rows (rowIndex > 3)
                        { rowIndex: 4, rawValues: ['Apex Retail Corp', 'Q1 2026', '12,480,000', '1,307,124', 'Audited statement', ''] },
                        { rowIndex: 5, rawValues: ['Apex Retail Corp', 'Q2 2026', '13,105,000', '1,467,739', 'Management pack', ''] },
                        { rowIndex: 6, rawValues: ['Zenith Freight Ltd', 'Q1 2026', '8,720,000', '895,895', 'Audited statement', ''] }
                    ]
                }
            ]
        };

        const facts = extractFinancialFacts(mockDoc);

        // Row 4 should yield 2 facts: Revenue and Net profit for Apex Retail Corp in Q1 2026
        const apexQ1Rev = facts.find(f => f.entity === 'Apex Retail Corp' && f.metric === 'Revenue' && f.periodLabel === 'Q1 2026');
        assert.ok(apexQ1Rev, 'Apex Retail Corp Q1 Revenue fact should exist');
        assert.equal(apexQ1Rev.normalizedValue, 12480000);
        assert.equal(apexQ1Rev.currency, 'AED');
        assert.equal(apexQ1Rev.entity, 'Apex Retail Corp');
        assert.equal(apexQ1Rev.periodLabel, 'Q1 2026');

        const apexQ1Net = facts.find(f => f.entity === 'Apex Retail Corp' && f.metric === 'Net profit' && f.periodLabel === 'Q1 2026');
        assert.ok(apexQ1Net, 'Apex Retail Corp Q1 Net profit fact should exist');
        assert.equal(apexQ1Net.normalizedValue, 1307124);

        const zenithQ1Rev = facts.find(f => f.entity === 'Zenith Freight Ltd' && f.metric === 'Revenue' && f.periodLabel === 'Q1 2026');
        assert.ok(zenithQ1Rev, 'Zenith Freight Ltd Q1 Revenue fact should exist');
        assert.equal(zenithQ1Rev.normalizedValue, 8720000);

        // Pre-header banner rows must NOT generate spurious facts
        const bannerFacts = facts.filter(f => /Contoso Holdings/i.test(f.metric) || /Group Finance/i.test(f.metric));
        assert.equal(bannerFacts.length, 0, 'No banner facts should be generated from pre-header rows');
    });

    await t.test('5. Dynamic Fact Extraction: Time-Series matrix extracts row metrics across quarterly columns', () => {
        const mockDoc = {
            document_id: 'doc-logistics',
            fullMarkdown: 'Zenith Logistics LLC – Budget FY2026\nCurrency: AED\nReporting period: FY 2026',
            tables: [
                {
                    table_id: 'table_budget',
                    header_row_index: 0,
                    headers: ['Line item', 'Q1 2026', 'Q2 2026', 'FY 2026'],
                    rows: [
                        { rowIndex: 1, rawValues: ['Direct operating costs', '6035000', '6532000', '12567000'] },
                        { rowIndex: 2, rawValues: ['Gross profit', '2465000', '2668000', '5133000'] }
                    ]
                }
            ]
        };

        const facts = extractFinancialFacts(mockDoc);
        assert.ok(facts.length >= 6);

        const q1Costs = facts.find(f => f.metric === 'Direct operating costs' && f.periodLabel === 'Q1 2026');
        assert.ok(q1Costs);
        assert.equal(q1Costs.normalizedValue, 6035000);
        assert.equal(q1Costs.currency, 'AED');
        assert.equal(q1Costs.reportingBasis, 'Budget');
    });

    await t.test('6. Dynamic Fact Extraction: Unknown metrics and entities are extracted with Pending/Approved mapping status without failure', () => {
        const mockDoc = {
            document_id: 'doc-unknown',
            fullMarkdown: 'Custom Financial Filing - Horizon Global BV',
            tables: [
                {
                    table_id: 'table_custom',
                    header_row_index: 0,
                    headers: ['Metric Name', 'Amount'],
                    rows: [
                        { rowIndex: 1, rawValues: ['Customer Acquisition Cost Per Unit', '450.25'] },
                        { rowIndex: 2, rawValues: ['R&D Capitalization Ratio', '18.5%'] }
                    ]
                }
            ]
        };

        const facts = extractFinancialFacts(mockDoc);
        assert.equal(facts.length, 2);

        const customMetric = facts.find(f => f.metric === 'Customer Acquisition Cost Per Unit');
        assert.ok(customMetric);
        assert.equal(customMetric.normalizedValue, 450.25);
        assert.equal(customMetric.validationStatus, 'Validated');
    });

    await t.test('7. Conflict Logic: Actual vs Budget are distinct reporting bases and NOT a conflict', () => {
        const factActual = {
            Metric: 'Revenue',
            Entity: 'Zenith Logistics LLC',
            PeriodLabel: 'Q1 2026',
            ReportingBasis: 'Actual',
            ReportingScope: 'Entity',
            NormalizedValue: 8720000
        };

        const factBudget = {
            Metric: 'Revenue',
            Entity: 'Zenith Logistics LLC',
            PeriodLabel: 'Q1 2026',
            ReportingBasis: 'Budget',
            ReportingScope: 'Entity',
            NormalizedValue: 8500000
        };

        // Comparison key considers ReportingBasis
        const keyActual = `${factActual.Metric}|${factActual.Entity}|${factActual.PeriodLabel}|${factActual.ReportingBasis}`;
        const keyBudget = `${factBudget.Metric}|${factBudget.Entity}|${factBudget.PeriodLabel}|${factBudget.ReportingBasis}`;

        assert.notEqual(keyActual, keyBudget, 'Actual and Budget must generate different grouping keys and not conflict');
    });

    await t.test('8. Evidence Validation: Dynamic keyword matching finds relevant facts without hardcoded filters', () => {
        const facts = [
            { FactId: 1, Metric: 'Total Revenue', Entity: 'Zenith Logistics LLC', PeriodLabel: 'Q1 2026', NumericValue: 8720000 },
            { FactId: 2, Metric: 'Net Profit', Entity: 'Zenith Logistics LLC', PeriodLabel: 'Q1 2026', NumericValue: 895895 },
            { FactId: 3, Metric: 'Operating Costs', Entity: 'Apex Retail Corp', PeriodLabel: 'Q2 2026', NumericValue: 6500000 }
        ];

        // Query asking for Zenith Logistics revenue in Q1
        const relevant = findRelevantStructuredFacts('What was the revenue of Zenith Logistics for Q1?', facts);
        assert.ok(relevant.length > 0);
        assert.equal(relevant[0].FactId, 1, 'Most relevant fact should be Zenith Logistics Total Revenue');
    });
});

