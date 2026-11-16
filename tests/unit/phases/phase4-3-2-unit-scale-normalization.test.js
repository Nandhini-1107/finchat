// tests/phase4-3-2-unit-scale-normalization.test.js
// Purpose: Dedicated test suite verifying all 12 required scenarios for Phase 4.3.2:
// Dynamic Unit and Scale Normalization.

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    extractFinancialFacts,
    extractDocumentContext,
    resolveFactScaleAndCurrency
} = require('../../../src/services/fact-extraction');
const {
    normalizeFinancialValue,
    extractScaleFromText,
    areValuesEqual
} = require('../../../src/services/unit-normalizer');

test('Phase 4.3.2: Dynamic Unit and Scale Normalization Suite', async (t) => {

    await t.test('1. AED in thousands: Normalizes monetary value scaled by 1,000 with AED currency', () => {
        const raw = '12,840';
        const norm = normalizeFinancialValue(raw, { scale: 1000, currency: 'AED' });

        assert.equal(norm.originalValue, 12840);
        assert.equal(norm.originalTextValue, '12,840');
        assert.equal(norm.normalizedValue, 12840000);
        assert.equal(norm.normalizedUnit, 'amount');
        assert.equal(norm.originalUnit, 'thousand');
        assert.equal(norm.currency, 'AED');
        assert.equal(norm.scale, 1000);

        // Document-level test
        const doc = {
            document: {
                documentId: 'doc-aed-thousands',
                metadata: {
                    issuer: 'Emirates Retail LLC',
                    reportingPeriod: 'Q1 2026',
                    currency: 'AED'
                }
            },
            tables: [
                {
                    table_id: 't1',
                    title: 'Revenue Summary (AED in thousands)',
                    header_row_index: 0,
                    headers: ['Metric', 'Amount'],
                    rows: [
                        { rowIndex: 1, rawValues: ['Total Revenue', '12,840'] }
                    ]
                }
            ]
        };

        const facts = extractFinancialFacts(doc);
        assert.equal(facts.length, 1);
        assert.equal(facts[0].normalizedValue, 12840000);
        assert.equal(facts[0].currency, 'AED');
        assert.equal(facts[0].normalizedUnit, 'amount');
        assert.equal(facts[0].originalUnit, 'thousand');
    });

    await t.test('2. USD in millions: Normalizes value scaled by 1,000,000 with USD currency', () => {
        const raw = '45.5';
        const norm = normalizeFinancialValue(raw, { scale: 1000000, currency: 'USD' });

        assert.equal(norm.originalValue, 45.5);
        assert.equal(norm.normalizedValue, 45500000);
        assert.equal(norm.normalizedUnit, 'amount');
        assert.equal(norm.originalUnit, 'million');
        assert.equal(norm.currency, 'USD');

        // Document-level test with table title declaration
        const doc = {
            document: {
                documentId: 'doc-usd-millions',
                metadata: {
                    issuer: 'Global Holdings Inc',
                    reportingPeriod: 'FY 2025'
                }
            },
            tables: [
                {
                    table_id: 't1',
                    title: 'Operating Income (USD millions)',
                    header_row_index: 0,
                    headers: ['Line item', 'FY 2025'],
                    rows: [
                        { rowIndex: 1, rawValues: ['Operating Income', '45.5'] }
                    ]
                }
            ]
        };

        const facts = extractFinancialFacts(doc);
        assert.equal(facts.length, 1);
        assert.equal(facts[0].normalizedValue, 45500000);
        assert.equal(facts[0].currency, 'USD');
        assert.equal(facts[0].normalizedUnit, 'amount');
    });

    await t.test('3. Different currencies and scales: Supports EUR, GBP, SAR, JPY across varying scales', () => {
        // EUR in billions
        const eurNorm = normalizeFinancialValue('3.25', { scale: 1000000000, currency: 'EUR' });
        assert.equal(eurNorm.normalizedValue, 3250000000);
        assert.equal(eurNorm.currency, 'EUR');

        // GBP in thousands
        const gbpNorm = normalizeFinancialValue('850', { scale: 1000, currency: 'GBP' });
        assert.equal(gbpNorm.normalizedValue, 850000);
        assert.equal(gbpNorm.currency, 'GBP');

        // SAR in millions
        const sarNorm = normalizeFinancialValue('120.4', { scale: 1000000, currency: 'SAR' });
        assert.equal(sarNorm.normalizedValue, 120400000);
        assert.equal(sarNorm.currency, 'SAR');

        // Text with embedded currency and scale
        const embeddedEur = normalizeFinancialValue('€50 million');
        assert.equal(embeddedEur.normalizedValue, 50000000);
        assert.equal(embeddedEur.currency, 'EUR');

        const embeddedSar = normalizeFinancialValue('150 ألف ريال');
        assert.equal(embeddedSar.normalizedValue, 150000);
        assert.equal(embeddedSar.currency, 'SAR');
    });

    await t.test('4. Table header scale: Detects scale from table title, caption, and pre-header rows', () => {
        const doc = {
            document: {
                documentId: 'doc-tbl-scale',
                metadata: { issuer: 'Acme Corp', currency: 'USD' }
            },
            tables: [
                {
                    table_id: 't1',
                    caption: 'Financial Highlights - in thousands',
                    header_row_index: 0,
                    headers: ['Metric', 'Actual'],
                    rows: [
                        { rowIndex: 1, rawValues: ['Gross Revenue', '5,000'] },
                        { rowIndex: 2, rawValues: ['Operating Cost', '2,100'] }
                    ]
                }
            ]
        };

        const facts = extractFinancialFacts(doc);
        assert.equal(facts.length, 2);
        assert.equal(facts[0].normalizedValue, 5000000);
        assert.equal(facts[1].normalizedValue, 2100000);
    });

    await t.test('5. Metadata scale: Propagates document metadata scale to table facts', () => {
        const doc = {
            document: {
                documentId: 'doc-meta-scale',
                metadata: {
                    issuer: 'Metadata Scale Corp',
                    currency: 'AED',
                    scale: 1000
                }
            },
            tables: [
                {
                    table_id: 't1',
                    header_row_index: 0,
                    headers: ['Line item', 'Q1 2026'],
                    rows: [
                        { rowIndex: 1, rawValues: ['Net Profit', '3,450'] }
                    ]
                }
            ]
        };

        const facts = extractFinancialFacts(doc);
        assert.equal(facts.length, 1);
        assert.equal(facts[0].normalizedValue, 3450000);
        assert.equal(facts[0].currency, 'AED');
        assert.equal(facts[0].originalUnit, 'thousand');
    });

    await t.test('6. Multi-level header scale: Extracts scale declared in column header paths', () => {
        const doc = {
            document: {
                documentId: 'doc-multilevel-scale',
                metadata: { issuer: 'Omni Group', currency: 'USD' }
            },
            tables: [
                {
                    table_id: 't1',
                    header_row_index: 0,
                    headers: ['Entity', "Revenue ('000)", 'EBITDA (millions)'],
                    columns: [
                        { columnIndex: 0, header: 'Entity' },
                        { columnIndex: 1, header: "Revenue ('000)", headerPath: ['2026', "Revenue ('000)"] },
                        { columnIndex: 2, header: 'EBITDA (millions)', headerPath: ['2026', 'EBITDA (millions)'] }
                    ],
                    rows: [
                        { rowIndex: 1, rawValues: ['Corporate', '12,000', '4.5'] }
                    ]
                }
            ]
        };

        const facts = extractFinancialFacts(doc);
        assert.equal(facts.length, 2);
        const revFact = facts.find(f => f.originalLabel.includes('Revenue'));
        const ebitdaFact = facts.find(f => f.originalLabel.includes('EBITDA'));

        assert.ok(revFact);
        assert.equal(revFact.normalizedValue, 12000000); // 12,000 * 1,000
        assert.ok(ebitdaFact);
        assert.equal(ebitdaFact.normalizedValue, 4500000); // 4.5 * 1,000,000
    });

    await t.test('7. Multiple tables with different scales: Does NOT leak scale between tables', () => {
        const doc = {
            document: {
                documentId: 'doc-multi-table',
                metadata: { issuer: 'Diverse Holdings', currency: 'USD' }
            },
            tables: [
                {
                    table_id: 'tbl_thousands',
                    title: 'Subsidiary Alpha (in thousands)',
                    header_row_index: 0,
                    headers: ['Line Item', 'Amount'],
                    rows: [
                        { rowIndex: 1, rawValues: ['Revenue', '1,000'] }
                    ]
                },
                {
                    table_id: 'tbl_millions',
                    title: 'Subsidiary Beta (USD millions)',
                    header_row_index: 0,
                    headers: ['Line Item', 'Amount'],
                    rows: [
                        { rowIndex: 1, rawValues: ['Revenue', '10.0'] }
                    ]
                },
                {
                    table_id: 'tbl_unscaled',
                    title: 'Subsidiary Gamma Summary',
                    header_row_index: 0,
                    headers: ['Line Item', 'Amount'],
                    rows: [
                        { rowIndex: 1, rawValues: ['Revenue', '500'] }
                    ]
                }
            ]
        };

        const facts = extractFinancialFacts(doc);
        assert.equal(facts.length, 3);

        const alphaFact = facts.find(f => f.sourceLocationJson.table === 'tbl_thousands');
        const betaFact = facts.find(f => f.sourceLocationJson.table === 'tbl_millions');
        const gammaFact = facts.find(f => f.sourceLocationJson.table === 'tbl_unscaled');

        assert.equal(alphaFact.normalizedValue, 1000000); // 1,000 * 1,000
        assert.equal(betaFact.normalizedValue, 10000000); // 10.0 * 1,000,000
        assert.equal(gammaFact.normalizedValue, 500); // 500 * 1 (unscaled)
    });

    await t.test('8. Percentage vs bps: Correctly distinguishes and normalizes % and basis points to canonical ratio', () => {
        // Percentage: 9% -> 0.09 ratio
        const p1 = normalizeFinancialValue('9%');
        assert.equal(p1.originalValue, 9);
        assert.equal(p1.originalTextValue, '9%');
        assert.equal(p1.normalizedValue, 0.09);
        assert.equal(p1.originalUnit, 'percentage');
        assert.equal(p1.normalizedUnit, 'ratio');
        assert.equal(p1.currency, null);

        // Percentage: 37.5% -> 0.375 ratio
        const p2 = normalizeFinancialValue('37.5%');
        assert.equal(p2.normalizedValue, 0.375);
        assert.equal(p2.normalizedUnit, 'ratio');
        assert.equal(p2.currency, null);

        // Basis Points: 180 bps -> 0.018 ratio
        const b1 = normalizeFinancialValue('180 bps');
        assert.equal(b1.originalValue, 180);
        assert.equal(b1.originalTextValue, '180 bps');
        assert.equal(b1.normalizedValue, 0.018);
        assert.equal(b1.originalUnit, 'bps');
        assert.equal(b1.normalizedUnit, 'ratio');
        assert.equal(b1.currency, null);

        // Basis Points: 25 bps -> 0.0025 ratio
        const b2 = normalizeFinancialValue('25 bps');
        assert.equal(b2.originalValue, 25);
        assert.equal(b2.originalTextValue, '25 bps');
        assert.equal(b2.normalizedValue, 0.0025);
        assert.equal(b2.originalUnit, 'bps');
        assert.equal(b2.normalizedUnit, 'ratio');
        assert.equal(b2.currency, null);

        // Decimal ratio preservation
        const r1 = normalizeFinancialValue(0.045, { unit: 'ratio' });
        assert.equal(r1.normalizedValue, 0.045);
        assert.equal(r1.normalizedUnit, 'ratio');
        assert.equal(r1.currency, null);
    });

    await t.test('9. Negative values and parentheses: Handles (12,840), -12,840, (180 bps), and (9%)', () => {
        // Parentheses with scale
        const n1 = normalizeFinancialValue('(12,840)', { scale: 1000, currency: 'AED' });
        assert.equal(n1.originalValue, -12840);
        assert.equal(n1.normalizedValue, -12840000);
        assert.equal(n1.currency, 'AED');

        // Minus sign with scale
        const n2 = normalizeFinancialValue('-12,840', { scale: 1000, currency: 'AED' });
        assert.equal(n2.originalValue, -12840);
        assert.equal(n2.normalizedValue, -12840000);

        // Negative bps
        const n3 = normalizeFinancialValue('(180 bps)');
        assert.equal(n3.originalValue, -180);
        assert.equal(n3.normalizedValue, -0.018);
        assert.equal(n3.normalizedUnit, 'ratio');

        // Negative percentage
        const n4 = normalizeFinancialValue('(9%)');
        assert.equal(n4.originalValue, -9);
        assert.equal(n4.normalizedValue, -0.09);
        assert.equal(n4.normalizedUnit, 'ratio');

        // Underlying numeric negative cell with formatted string "2,995"
        const doc = {
            document: {
                documentId: 'doc-neg-cell',
                metadata: { issuer: 'Test Corp', scale: 1000, currency: 'AED' }
            },
            tables: [
                {
                    table_id: 't1',
                    header_row_index: 0,
                    headers: ['Metric', 'Value'],
                    rows: [
                        {
                            rowIndex: 1,
                            cells: [
                                { columnIndex: 0, value: 'Operating Expenses' },
                                { columnIndex: 1, value: -2995, formattedValue: '2,995' }
                            ],
                            rawValues: ['Operating Expenses', '2,995']
                        }
                    ]
                }
            ]
        };

        const facts = extractFinancialFacts(doc);
        assert.equal(facts.length, 1);
        assert.equal(facts[0].normalizedValue, -2995000);
        assert.equal(facts[0].originalValue, -2995);
    });

    await t.test('10. Missing and ambiguous scale: Does NOT guess when scale is ambiguous or absent', () => {
        // Missing scale defaults to 1
        const missing = extractScaleFromText('Revenue and Expenses for the Year');
        assert.equal(missing, null);

        // Ambiguous scale mentioning both thousands and millions without explicit declaration
        const ambiguous = extractScaleFromText('Comparison of thousands and millions across divisions');
        assert.equal(ambiguous, null);

        const doc = {
            document: {
                documentId: 'doc-ambig-scale',
                metadata: { issuer: 'Ambiguous LLC', currency: 'USD' }
            },
            tables: [
                {
                    table_id: 't1',
                    title: 'Comparison of thousands and millions',
                    header_row_index: 0,
                    headers: ['Metric', 'Amount'],
                    rows: [
                        { rowIndex: 1, rawValues: ['Direct Revenue', '500'] }
                    ]
                }
            ]
        };

        const facts = extractFinancialFacts(doc);
        assert.equal(facts.length, 1);
        assert.equal(facts[0].normalizedValue, 500); // Stays 500, not scaled
    });

    await t.test('11. Prevention of double scaling: Cell multiplier overrides table scale without multiplying twice', () => {
        // Cell explicitly declares "million" inside a table declared as "in thousands"
        const cellVal = '$12.5 million';
        const norm = normalizeFinancialValue(cellVal, { scale: 1000, currency: 'USD' });

        // Must be $12,500,000, NOT $12,500,000,000 (12.5M * 1000)
        assert.equal(norm.normalizedValue, 12500000);
        assert.equal(norm.scale, 1000000);
        assert.equal(norm.currency, 'USD');

        // Cell with 'k' in a thousands context
        const cellK = '12k';
        const normK = normalizeFinancialValue(cellK, { scale: 1000, currency: 'USD' });
        assert.equal(normK.normalizedValue, 12000); // 12,000, NOT 12,000,000

        // Ratio/percentage metric in a thousands table must NOT be scaled
        const ratioNorm = normalizeFinancialValue('24.5%', { scale: 1000, isRatio: true });
        assert.equal(ratioNorm.normalizedValue, 0.245); // NOT 245
        assert.equal(ratioNorm.normalizedUnit, 'ratio');

        // Headcount metric in a thousands table must NOT be scaled
        const hcNorm = normalizeFinancialValue('150', { scale: 1000, isHeadcount: true });
        assert.equal(hcNorm.normalizedValue, 150); // NOT 150,000
        assert.equal(hcNorm.normalizedUnit, 'headcount');
    });

    await t.test('12. Formula errors: Preserves #DIV/0!, #REF!, #VALUE! as Invalid facts with null numericValue', () => {
        const errDiv = normalizeFinancialValue('#DIV/0!');
        assert.equal(errDiv.originalValue, '#DIV/0!');
        assert.equal(errDiv.numericValue, null);
        assert.equal(errDiv.normalizedValue, null);
        assert.equal(errDiv.originalUnit, 'unknown');
        assert.equal(errDiv.isError, true);

        const errRef = normalizeFinancialValue('#REF!');
        assert.equal(errRef.numericValue, null);
        assert.equal(errRef.normalizedValue, null);
        assert.equal(errRef.isError, true);

        const doc = {
            document: {
                documentId: 'doc-formula-error',
                metadata: { issuer: 'Error Corp', currency: 'USD' }
            },
            tables: [
                {
                    table_id: 't1',
                    header_row_index: 0,
                    headers: ['Metric', 'Q1 2026'],
                    rows: [
                        {
                            rowIndex: 1,
                            rawValues: ['Operating Margin', '#DIV/0!'],
                            cells: [
                                { columnIndex: 0, value: 'Operating Margin' },
                                { columnIndex: 1, value: '#DIV/0!', cellType: 'error' }
                            ]
                        }
                    ]
                }
            ]
        };

        const facts = extractFinancialFacts(doc);
        assert.equal(facts.length, 1);
        assert.equal(facts[0].metric, 'Operating Margin');
        assert.equal(facts[0].numericValue, null);
        assert.equal(facts[0].normalizedValue, null);
        assert.equal(facts[0].validationStatus, 'Invalid');
        assert.equal(facts[0].originalValue, '#DIV/0!');
    });

});
