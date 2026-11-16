const test = require('node:test');
const assert = require('node:assert/strict');
const { extractFinancialFacts, extractDocumentContext, analyzeTableLayout } = require('../../../src/services/fact-extraction');
const { normalizeFinancialValue } = require('../../../src/services/unit-normalizer');

test('Benchmark 11 Financial Documents Verification Suite', async (t) => {

    await t.test('Doc 1: Contoso Retail LLC - Q1 2026 Audited Financial Statement', () => {
        const text = `Contoso Retail LLC
Statement of Profit or Loss for the quarter ended 31 March 2026
Status: Audited    Prepared: 28 April 2026    Currency: AED`;
        
        const mockDoc = {
            document_id: 'doc-1',
            fullMarkdown: text,
            tables: [
                {
                    table_id: 'table_1',
                    header_row_index: 0,
                    headers: ['Line item', 'Q1 2026'],
                    rows: [
                        { rowIndex: 1, rawValues: ['Revenue', '12,480,000'] },
                        { rowIndex: 2, rawValues: ['Cost of sales', '(7,862,400)'] },
                        { rowIndex: 3, rawValues: ['Gross profit', '4,617,600'] },
                        { rowIndex: 4, rawValues: ['Operating expenses', '(2,995,200)'] },
                        { rowIndex: 5, rawValues: ['Operating profit', '1,622,400'] },
                        { rowIndex: 6, rawValues: ['Finance costs', '(186,000)'] },
                        { rowIndex: 7, rawValues: ['Profit before tax', '1,436,400'] },
                        { rowIndex: 8, rawValues: ['Corporate tax (9%)', '(129,276)'] },
                        { rowIndex: 9, rawValues: ['Net profit for the period', '1,307,124'] }
                    ]
                }
            ]
        };

        const facts = extractFinancialFacts(mockDoc);
        assert.equal(facts.length, 9);
        
        const rev = facts.find(f => f.metric === 'Revenue');
        assert.ok(rev);
        assert.equal(rev.normalizedValue, 12480000);
        assert.equal(rev.currency, 'AED');
        assert.equal(rev.reportingBasis, 'Actual');

        const cos = facts.find(f => f.metric === 'Cost of sales');
        assert.ok(cos);
        assert.equal(cos.normalizedValue, -7862400);

        const np = facts.find(f => f.metric === 'Net profit for the period');
        assert.ok(np);
        assert.equal(np.normalizedValue, 1307124);
    });

    await t.test('Doc 2: Contoso Retail LLC - Q2 2026 Management Pack', () => {
        const text = `Contoso Retail LLC
Management Pack – Statement of Profit or Loss for the quarter ended 30 June 2026
Status: Final management pack (unaudited)    Prepared: 15 July 2026    Currency: AED`;

        const mockDoc = {
            document_id: 'doc-2',
            fullMarkdown: text,
            tables: [
                {
                    table_id: 'table_1',
                    header_row_index: 0,
                    headers: ['Line item', 'Q2 2026'],
                    rows: [
                        { rowIndex: 1, rawValues: ['Revenue', '13,105,000'] },
                        { rowIndex: 2, rawValues: ['Cost of sales', '(8,190,600)'] },
                        { rowIndex: 3, rawValues: ['Gross profit', '4,914,400'] },
                        { rowIndex: 4, rawValues: ['Net profit for the period', '1,467,739'] }
                    ]
                }
            ]
        };

        const facts = extractFinancialFacts(mockDoc);
        const rev = facts.find(f => f.metric === 'Revenue');
        assert.ok(rev);
        assert.equal(rev.normalizedValue, 13105000);
        assert.equal(rev.periodLabel, 'Q2 2026');
    });

    await t.test('Doc 5: Contoso Logistics LLC - Q2 2026 Management Pack (Version 2 - Final)', () => {
        const text = `Contoso Logistics LLC
Management Pack – Statement of Profit or Loss for the quarter ended 30 June 2026 (version 2)
Status: Final management pack (unaudited) – supersedes v1    Prepared: 16 July 2026    Currency: AED`;

        const mockDoc = {
            document_id: 'doc-5',
            fullMarkdown: text,
            tables: [
                {
                    table_id: 'table_1',
                    header_row_index: 0,
                    headers: ['Line item', 'Q2 2026'],
                    rows: [
                        { rowIndex: 1, rawValues: ['Revenue', '9,350,000'] },
                        { rowIndex: 2, rawValues: ['Direct operating costs', '(6,591,800)'] },
                        { rowIndex: 3, rawValues: ['Net profit for the period', '1,046,955'] }
                    ]
                }
            ]
        };

        const facts = extractFinancialFacts(mockDoc);
        const rev = facts.find(f => f.metric === 'Revenue');
        assert.ok(rev);
        assert.equal(rev.normalizedValue, 9350000);
        assert.equal(rev.periodLabel, 'Q2 2026');
    });

    await t.test('Doc 7: Contoso Holdings - Board Pack Q1 2026 (AED thousands scaling)', () => {
        const text = `Contoso Holdings
Board Pack – Group Financial Summary, quarter ended 31 March 2026
Status: Approved board pack (unaudited)    Prepared: 05 May 2026    Currency: AED
All figures in AED thousands, rounded.`;

        const mockDoc = {
            document_id: 'doc-7',
            fullMarkdown: text,
            tables: [
                {
                    table_id: 'table_summary',
                    header_row_index: 0,
                    headers: ['Entity', 'Revenue', 'Operating expenses', 'Net profit'],
                    rows: [
                        { rowIndex: 1, rawValues: ['Contoso Retail LLC', '12,840', '2,995', '1,307'] },
                        { rowIndex: 2, rawValues: ['Contoso Logistics LLC', '8,720', '1,402', '896'] },
                        { rowIndex: 3, rawValues: ['Contoso Properties LLC', '5,240', '3,215', '604'] },
                        { rowIndex: 4, rawValues: ['Group total', '26,800', '7,613', '2,807'] }
                    ]
                }
            ]
        };

        const facts = extractFinancialFacts(mockDoc);
        assert.equal(facts.length, 12);

        // Contoso Retail LLC Revenue = 12,840 (scaled: 12,840,000 AED)
        const retailRev = facts.find(f => f.entity === 'Contoso Retail LLC' && f.metric === 'Revenue');
        assert.ok(retailRev);
        assert.equal(retailRev.normalizedValue, 12840000);
        assert.equal(retailRev.originalValue, 12840);
        assert.equal(retailRev.entity, 'Contoso Retail LLC');

        // Group total Revenue = 26,800 (scaled: 26,800,000 AED)
        const groupRev = facts.find(f => f.entity === 'Group total' && f.metric === 'Revenue');
        assert.ok(groupRev);
        assert.equal(groupRev.normalizedValue, 26800000);
        assert.equal(groupRev.originalValue, 26800);
    });

    await t.test('Doc 8: Contoso Retail LLC - Budget FY2026 (Budget Reporting Basis & Matrix)', () => {
        const text = `Contoso Retail LLC – Budget FY2026
Approved budget  |  Approved 15 December 2025  |  Currency: AED`;

        const mockDoc = {
            document_id: 'doc-8',
            fullMarkdown: text,
            tables: [
                {
                    table_id: 'table_budget',
                    header_row_index: 0,
                    headers: ['Line item', 'Q1 2026', 'Q2 2026', 'Q3 2026', 'Q4 2026', 'FY 2026'],
                    rows: [
                        { rowIndex: 1, rawValues: ['Revenue', '12000000', '13500000', '13800000', '14700000', '54000000'] },
                        { rowIndex: 2, rawValues: ['Gross profit', '4440000', '4995000', '5106000', '5439000', '19980000'] }
                    ]
                }
            ]
        };

        const facts = extractFinancialFacts(mockDoc);
        const q1Rev = facts.find(f => f.metric === 'Revenue' && f.periodLabel === 'Q1 2026');
        assert.ok(q1Rev);
        assert.equal(q1Rev.normalizedValue, 12000000);
        assert.equal(q1Rev.reportingBasis, 'Budget');

        const fyRev = facts.find(f => f.metric === 'Revenue' && f.periodLabel === 'FY 2026');
        assert.ok(fyRev);
        assert.equal(fyRev.normalizedValue, 54000000);
        assert.equal(fyRev.reportingBasis, 'Budget');
    });

    await t.test('Doc 10: Contoso Properties LLC - Budget FY2026 (AED thousands scaling)', () => {
        const normVal = normalizeFinancialValue('5,100 thousand', { currency: 'AED' });
        assert.equal(normVal.normalizedValue, 5100000);
        assert.equal(normVal.currency, 'AED');
    });

    await t.test('Doc 11: Contoso Holdings - Group Actuals Tracker 2026 (Multi-Entity Records Table)', () => {
        const text = `Contoso Holdings – Group Actuals Tracker 2026
Working file maintained by Group Finance – NOT an approved source  |  Last updated 10 July 2026  |  Currency: AED`;

        const mockDoc = {
            document_id: 'doc-11',
            fullMarkdown: text,
            tables: [
                {
                    table_id: 'table_tracker',
                    header_row_index: 3,
                    headers: ['Entity', 'Quarter', 'Revenue', 'Net profit', 'Source used', 'Comment'],
                    rows: [
                        { rowIndex: 0, rawValues: ['Contoso Holdings – Group Actuals Tracker 2026', '', '', '', '', ''] },
                        { rowIndex: 1, rawValues: ['Working file maintained by Group Finance', '', '', '', '', ''] },
                        { rowIndex: 2, rawValues: ['', '', '', '', '', ''] },
                        { rowIndex: 4, rawValues: ['Contoso Retail LLC', 'Q1 2026', '12,480,000', '1,307,124', 'Audited statement', ''] },
                        { rowIndex: 5, rawValues: ['Contoso Retail LLC', 'Q2 2026', '13,105,000', '1,467,739', 'Management pack', ''] },
                        { rowIndex: 6, rawValues: ['Contoso Logistics LLC', 'Q1 2026', '8,720,000', '895,895', 'Audited statement', ''] },
                        { rowIndex: 7, rawValues: ['Contoso Logistics LLC', 'Q2 2026', '9,105,000', '951,041', 'Management pack v1', 'To update when final pack is issued'] },
                        { rowIndex: 8, rawValues: ['Contoso Properties LLC', 'Q1 2026', '5,240,000', '640,276', 'Management pack', ''] }
                    ]
                }
            ]
        };

        const facts = extractFinancialFacts(mockDoc);
        assert.equal(facts.length, 10);

        // Check Logistics Q2 Revenue = 9,105,000
        const logQ2 = facts.find(f => f.entity === 'Contoso Logistics LLC' && f.periodLabel === 'Q2 2026' && f.metric === 'Revenue');
        assert.ok(logQ2);
        assert.equal(logQ2.normalizedValue, 9105000);

        // Check Properties Q1 Net Profit = 640,276
        const propQ1Net = facts.find(f => f.entity === 'Contoso Properties LLC' && f.periodLabel === 'Q1 2026' && f.metric === 'Net profit');
        assert.ok(propQ1Net);
        assert.equal(propQ1Net.normalizedValue, 640276);
    });
});

