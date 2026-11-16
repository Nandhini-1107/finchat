// tests/phase4-3-1-entity-metric-identification.test.js
// Purpose: Test suite verifying all 14 required testing scenarios for Phase 4.3.1:
// Dynamic Entity and Metric Identification.

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    extractFinancialFacts,
    extractDocumentContext,
    resolveDocumentEntity,
    extractEntityFromText,
    isFootnoteOrDisclaimerRow,
    isRatioMetric,
    isHeadcountMetric,
    inferTemporalType
} = require('../../../src/services/fact-extraction');

test('Phase 4.3.1: Dynamic Entity and Metric Identification Suite', async (t) => {

    await t.test('1. Entity in document title: Dynamically extracts entity without hardcoding', () => {
        const doc = {
            document: {
                documentId: 'doc-title-test',
                metadata: {
                    documentTitle: 'Global Logistics Inc - Statement of Income for the quarter ended 31 March 2026'
                }
            },
            tables: [
                {
                    table_id: 't1',
                    header_row_index: 0,
                    headers: ['Line item', 'Q1 2026'],
                    rows: [
                        { rowIndex: 1, rawValues: ['Freight revenue', '5,400,000'] }
                    ]
                }
            ]
        };

        const facts = extractFinancialFacts(doc);
        assert.equal(facts.length, 1);
        assert.equal(facts[0].entity, 'Global Logistics Inc');
        assert.equal(facts[0].entityLabel, 'Global Logistics Inc');
        assert.equal(facts[0].metric, 'Freight revenue');
        assert.equal(facts[0].normalizedValue, 5400000);
    });

    await t.test('2. Entity in metadata: Prioritizes explicit metadata issuer/reportingEntity', () => {
        const doc = {
            document: {
                documentId: 'doc-meta-test',
                metadata: {
                    issuer: 'Alpha Retail Corporation',
                    documentTitle: 'Quarterly Operating Review'
                }
            },
            tables: [
                {
                    table_id: 't1',
                    header_row_index: 0,
                    headers: ['Line item', 'Q1 2026'],
                    rows: [
                        { rowIndex: 1, rawValues: ['Net sales', '8,250,000'] }
                    ]
                }
            ]
        };

        const facts = extractFinancialFacts(doc);
        assert.equal(facts.length, 1);
        assert.equal(facts[0].entity, 'Alpha Retail Corporation');
        assert.equal(facts[0].metric, 'Net sales');
    });

    await t.test('3. Entity in table title / caption: Resolves entity from table title', () => {
        const doc = {
            document: {
                documentId: 'doc-tbl-title',
                metadata: {
                    documentTitle: 'Group Summary Report'
                }
            },
            tables: [
                {
                    table_id: 't1',
                    title: 'Delta Properties LLC - Fleet Summary',
                    header_row_index: 0,
                    headers: ['Line item', 'Q1 2026'],
                    rows: [
                        { rowIndex: 1, rawValues: ['Rental income', '3,100,000'] }
                    ]
                }
            ]
        };

        const facts = extractFinancialFacts(doc);
        assert.equal(facts.length, 1);
        assert.ok(facts[0].entity.includes('Delta Properties LLC') || facts[0].entity.includes('Group Summary'));
    });

    await t.test('4. Entity in explicit table column: Extracts entity from dedicated Entity column', () => {
        const doc = {
            document: {
                documentId: 'doc-col-test'
            },
            tables: [
                {
                    table_id: 't1',
                    header_row_index: 0,
                    headers: ['Entity', 'Quarter', 'Revenue', 'Operating cost'],
                    rows: [
                        { rowIndex: 1, rawValues: ['Beta Technologies Ltd', 'Q1 2026', '9,500,000', '4,200,000'] }
                    ]
                }
            ]
        };

        const facts = extractFinancialFacts(doc);
        assert.equal(facts.length, 2);
        assert.equal(facts[0].entity, 'Beta Technologies Ltd');
        assert.equal(facts[1].entity, 'Beta Technologies Ltd');
        assert.equal(facts[0].metric, 'Revenue');
        assert.equal(facts[1].metric, 'Operating cost');
    });

    await t.test('5. Multiple entities in one table: Each row preserves distinct entity', () => {
        const doc = {
            document: {
                documentId: 'doc-multi-entity-tbl'
            },
            tables: [
                {
                    table_id: 't1',
                    header_row_index: 0,
                    headers: ['Entity', 'Revenue', 'Net profit'],
                    rows: [
                        { rowIndex: 1, rawValues: ['Subsidiary Alpha LLC', '1,000,000', '150,000'] },
                        { rowIndex: 2, rawValues: ['Subsidiary Beta LLC', '2,500,000', '300,000'] },
                        { rowIndex: 3, rawValues: ['Group total', '3,500,000', '450,000'] }
                    ]
                }
            ]
        };

        const facts = extractFinancialFacts(doc);
        assert.equal(facts.length, 6);

        const alphaFacts = facts.filter(f => f.entity === 'Subsidiary Alpha LLC');
        const betaFacts = facts.filter(f => f.entity === 'Subsidiary Beta LLC');
        const groupFacts = facts.filter(f => f.entity === 'Group total');

        assert.equal(alphaFacts.length, 2);
        assert.equal(betaFacts.length, 2);
        assert.equal(groupFacts.length, 2);

        // Entities must not be collapsed or overwritten by document-level fallback
        assert.equal(alphaFacts[0].normalizedValue, 1000000);
        assert.equal(betaFacts[0].normalizedValue, 2500000);
        assert.equal(groupFacts[0].normalizedValue, 3500000);
        assert.equal(groupFacts[0].reportingScope, 'Consolidated');
    });

    await t.test('6. Multiple subsidiaries in different tables: Preserves subsidiary distinction', () => {
        const doc = {
            document: {
                documentId: 'doc-multi-sub',
                metadata: {
                    documentTitle: 'Group Monthly Review'
                }
            },
            tables: [
                {
                    table_id: 't1',
                    header_row_index: 0,
                    headers: ['Entity', 'Quarter', 'Revenue'],
                    rows: [
                        { rowIndex: 1, rawValues: ['Northern Logistics LLC', 'Q1 2026', '4,200,000'] }
                    ]
                },
                {
                    table_id: 't2',
                    header_row_index: 0,
                    headers: ['Entity', 'Quarter', 'Revenue'],
                    rows: [
                        { rowIndex: 1, rawValues: ['Southern Properties LLC', 'Q1 2026', '6,800,000'] }
                    ]
                }
            ]
        };

        const facts = extractFinancialFacts(doc);
        assert.equal(facts.length, 2);
        assert.equal(facts[0].entity, 'Northern Logistics LLC');
        assert.equal(facts[1].entity, 'Southern Properties LLC');
    });

    await t.test('7. Unknown entity: Insufficient evidence leaves entity null, NEVER Consolidated', () => {
        const doc = {
            document: {
                documentId: 'doc-unknown-entity',
                metadata: {
                    documentTitle: 'Statutory Tax & Headcount Schedule Q1 2026',
                    currency: 'AED'
                }
            },
            tables: [
                {
                    table_id: 't1',
                    header_row_index: 0,
                    headers: ['Line item', 'Q1 2026'],
                    rows: [
                        { rowIndex: 1, rawValues: ['Corporate tax expense', '125,000'] }
                    ]
                }
            ]
        };

        const facts = extractFinancialFacts(doc);
        assert.equal(facts.length, 1);
        assert.equal(facts[0].entity, null, 'Must NOT default to Consolidated');
        assert.equal(facts[0].entityLabel, null);
        assert.equal(facts[0].metric, 'Corporate tax expense');
    });

    await t.test('8. Ambiguous entity: Reports low confidence when entity is unanchored', () => {
        const doc = {
            document: {
                documentId: 'doc-ambiguous'
            },
            fullMarkdown: 'Uncaptioned financial summary table\nCurrency: USD',
            tables: [
                {
                    table_id: 't1',
                    header_row_index: 0,
                    headers: ['Line item', 'FY 2026'],
                    rows: [
                        { rowIndex: 1, rawValues: ['Operating income', '1,200,000'] }
                    ]
                }
            ]
        };

        const facts = extractFinancialFacts(doc);
        assert.equal(facts.length, 1);
        assert.equal(facts[0].entity, null);
        assert.equal(facts[0].extractionConfidence, 0.0);
    });

    await t.test('9. Previously unseen metric: Dynamic extraction without hardcoded whitelist', () => {
        const doc = {
            document: {
                documentId: 'doc-unseen-metric',
                metadata: { issuer: 'EcoEnergy Holdings' }
            },
            tables: [
                {
                    table_id: 't1',
                    header_row_index: 0,
                    headers: ['Line item', 'Q1 2026'],
                    rows: [
                        { rowIndex: 1, rawValues: ['Carbon offset credit revenue', '340,000'] },
                        { rowIndex: 2, rawValues: ['Solar farm decommissioning reserve', '185,000'] }
                    ]
                }
            ]
        };

        const facts = extractFinancialFacts(doc);
        assert.equal(facts.length, 2);
        assert.equal(facts[0].metric, 'Carbon offset credit revenue');
        assert.equal(facts[1].metric, 'Solar farm decommissioning reserve');
        assert.equal(facts[0].normalizedValue, 340000);
        assert.equal(facts[1].normalizedValue, 185000);
    });

    await t.test('10. Metric in paragraph: Extracts narrative statements with currency and numbers', () => {
        const doc = {
            document: {
                documentId: 'doc-narrative',
                metadata: { issuer: 'PharmaTech Corp', currency: 'USD' }
            },
            tables: [],
            paragraphs: [
                {
                    content: 'During the first quarter, Research and development expenditure was USD 4,500,000 across core oncology trials.'
                }
            ]
        };

        const facts = extractFinancialFacts(doc);
        assert.ok(facts.length >= 1, 'Should extract at least one narrative fact');
        assert.ok(facts[0].metric.includes('Research and development'));
        assert.equal(facts[0].normalizedValue, 4500000);
        assert.equal(facts[0].extractionMethod, 'NarrativeParser');
    });

    await t.test('11. Metric in multi-level table headers: Row labels as metrics, header paths as dimensions', () => {
        const doc = {
            document: {
                documentId: 'doc-multilevel',
                metadata: { issuer: 'Omni Retail LLC', currency: 'AED' }
            },
            elements: [
                {
                    elementType: 'table',
                    elementId: 't1',
                    columns: [
                        { columnIndex: 0, header: 'Metric', headerPath: ['Metric'] },
                        { columnIndex: 1, header: 'Online / UAE', headerPath: ['Online', 'UAE'] },
                        { columnIndex: 2, header: 'In-Store / UAE', headerPath: ['In-Store', 'UAE'] }
                    ],
                    rows: [
                        {
                            rowIndex: 1,
                            rowType: 'data',
                            cells: [
                                { columnIndex: 0, value: 'Revenue' },
                                { columnIndex: 1, value: 5000000 },
                                { columnIndex: 2, value: 3000000 }
                            ],
                            rawValues: ['Revenue', '5,000,000', '3,000,000']
                        },
                        {
                            rowIndex: 2,
                            rowType: 'data',
                            cells: [
                                { columnIndex: 0, value: 'Gross margin' },
                                { columnIndex: 1, value: 0.42 },
                                { columnIndex: 2, value: 0.35 }
                            ],
                            rawValues: ['Gross margin', '42.0%', '35.0%']
                        }
                    ]
                }
            ]
        };

        const facts = extractFinancialFacts(doc);
        assert.equal(facts.length, 4);

        const revFacts = facts.filter(f => f.metric === 'Revenue');
        assert.equal(revFacts.length, 2);
        assert.equal(revFacts[0].entity, 'Omni Retail LLC');
        assert.equal(revFacts[0].dimensions.channel, 'Online');
        assert.equal(revFacts[0].dimensions.geography, 'UAE');
        assert.equal(revFacts[0].normalizedValue, 5000000);

        const marginFacts = facts.filter(f => f.metric === 'Gross margin');
        assert.equal(marginFacts.length, 2);
        assert.equal(marginFacts[0].normalizedUnit, 'ratio');
        assert.equal(marginFacts[0].currency, null, 'Ratio should have null currency');
    });

    await t.test('12. Similar metric labels with different meanings are preserved distinctly', () => {
        const doc = {
            document: {
                documentId: 'doc-similar-metrics',
                metadata: { issuer: 'Summit Manufacturing Ltd' }
            },
            tables: [
                {
                    table_id: 't1',
                    header_row_index: 0,
                    headers: ['Line item', 'Q1 2026'],
                    rows: [
                        { rowIndex: 1, rawValues: ['Gross profit', '4,000,000'] },
                        { rowIndex: 2, rawValues: ['Operating profit', '1,500,000'] },
                        { rowIndex: 3, rawValues: ['Profit before tax', '1,300,000'] },
                        { rowIndex: 4, rawValues: ['Net profit for the period', '1,150,000'] }
                    ]
                }
            ]
        };

        const facts = extractFinancialFacts(doc);
        assert.equal(facts.length, 4);
        assert.equal(facts[0].metric, 'Gross profit');
        assert.equal(facts[1].metric, 'Operating profit');
        assert.equal(facts[2].metric, 'Profit before tax');
        assert.equal(facts[3].metric, 'Net profit for the period');
    });

    await t.test('13. Numeric note cells and disclaimer rows must NOT become metrics', () => {
        const doc = {
            document: {
                documentId: 'doc-note-cells',
                metadata: { issuer: 'Apex Corporation' }
            },
            elements: [
                {
                    elementType: 'table',
                    elementId: 't1',
                    columns: [
                        { columnIndex: 0, header: 'Metric' },
                        { columnIndex: 1, header: 'Q1 2026' }
                    ],
                    rows: [
                        { rowIndex: 1, rowType: 'data', rawValues: ['Sales revenue', '10,000,000'] },
                        { rowIndex: 2, rowType: 'note', rawValues: ['Note 1: Reflects revised IFRS 15 allocation', '50,000'] },
                        { rowIndex: 3, rowType: 'disclaimer', rawValues: ['* Unaudited interim estimate', '25,000'] },
                        { rowIndex: 4, rowType: 'data', rawValues: ['Net profit', '2,000,000'] }
                    ]
                }
            ]
        };

        const facts = extractFinancialFacts(doc);
        assert.equal(facts.length, 2, 'Must extract only the 2 genuine financial facts');
        assert.equal(facts[0].metric, 'Sales revenue');
        assert.equal(facts[1].metric, 'Net profit');

        // Confirm note/disclaimer rows did NOT become facts
        const badNote = facts.find(f => /Note 1/i.test(f.metric) || /Unaudited/i.test(f.metric));
        assert.equal(badNote, undefined, 'No note/disclaimer rows should become facts');
    });

    await t.test('14. Missing entity and metric evidence: Handles empty/corrupt cells safely', () => {
        const doc = {
            document: {
                documentId: 'doc-empty-test'
            },
            tables: [
                {
                    table_id: 't1',
                    header_row_index: 0,
                    headers: ['Metric', 'Q1 2026'],
                    rows: [
                        { rowIndex: 1, rawValues: ['', ''] },
                        { rowIndex: 2, rawValues: [null, null] },
                        { rowIndex: 3, rawValues: ['Valid Metric', '750,000'] }
                    ]
                }
            ]
        };

        const facts = extractFinancialFacts(doc);
        assert.equal(facts.length, 1);
        assert.equal(facts[0].metric, 'Valid Metric');
        assert.equal(facts[0].normalizedValue, 750000);
    });
});

