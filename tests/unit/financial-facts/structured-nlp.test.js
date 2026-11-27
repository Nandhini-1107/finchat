'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');

const {
    extractStructuredFinancialFacts,
    normalizeFinancialNumber,
    detectTableIslands
} = require('../../../src/services/financial-extraction');
const { extractFinancialFactsUnified } = require('../../../src/services/financial-extraction-client');

test('SAFEE (structured_nlp) Comprehensive Extraction & Acceptance Suite', async (t) => {

    await t.test('1. Mandatory 22-Fact Acceptance Fixture (Section 44)', async () => {
        const payload = {
            correlationId: 'ACCEPT-22-001',
            metadata: {
                documentId: 901,
                documentName: 'Multi_Entity_Acceptance_Fixture.pdf',
                documentType: 'pdf'
            },
            tables: [
                {
                    tableId: 'T1',
                    pageNumber: 1,
                    caption: 'Contoso Logistics Financial Performance. All amounts in AED millions.',
                    grid: [
                        ['Financial Metric', 'FY2024', 'FY2025'],
                        ['Revenue', '12.50', '15.75'],
                        ['Net Profit', '2.50', '3.80'],
                        ['Fleet Optimization Savings', '0.45', '0.72'],
                        ['Operating Expenses', '4.20', '5.10']
                    ]
                },
                {
                    tableId: 'T2',
                    pageNumber: 2,
                    caption: 'Northwind Holdings Quarterly Results. All amounts in USD.',
                    grid: [
                        ['Period', 'Revenue', 'Net Profit', 'Cloud Infrastructure Savings'],
                        ['Q1 2026', '850000', '125000', '45000'],
                        ['Q2 2026', '950000', '175000', '62000']
                    ]
                }
            ],
            paragraphs: [
                {
                    blockId: 'P1',
                    pageNumber: 3,
                    content: 'Meridian Technologies reported revenue of INR 15.5 crore and net profit of INR 2.5 crore for FY2025. Its operating expenses amounted to INR 85 lakh.'
                },
                {
                    blockId: 'P2',
                    pageNumber: 3,
                    content: 'BluePeak Industries recorded renewable energy recovery savings of EUR 450,000 and automated compliance efficiency gains of EUR 125,000 during FY2026.'
                },
                {
                    blockId: 'P3',
                    pageNumber: 4,
                    content: 'Northwind Holdings recorded an operating loss of USD (250,000) and a net profit margin of 18.5% for FY2025.'
                },
                {
                    blockId: 'P4',
                    pageNumber: 4,
                    content: 'Contoso Logistics was established in 1998. The report was approved on 15 November 2026 under reference number 45821. Contoso Logistics reported capital expenditure of AED 2025 for FY2026.'
                }
            ]
        };

        const res = await extractStructuredFinancialFacts(payload);

        assert.equal(res.status, 'ok');
        assert.equal(res.processing.externalInferenceCalls, 0);
        assert.equal(res.processing.llmTokensUsed, 0);
        assert.equal(res.facts.length, 22, `Expected 22 facts, got ${res.facts.length}`);

        // Verify Table 1 facts (8 facts)
        const fleet2025 = res.facts.find(f => f.metric === 'Fleet Optimization Savings' && f.periodLabel === 'FY 2025');
        assert.ok(fleet2025);
        assert.equal(fleet2025.entity, 'Contoso Logistics');
        assert.equal(fleet2025.numericValue, 720000);
        assert.equal(fleet2025.currency, 'AED');
        assert.equal(fleet2025.validationStatus, 'Validated');

        // Verify Table 2 facts (6 facts, MetricsAsColumns)
        const cloudQ2 = res.facts.find(f => f.metric === 'Cloud Infrastructure Savings' && f.periodLabel === 'Q2 2026');
        assert.ok(cloudQ2);
        assert.equal(cloudQ2.entity, 'Northwind Holdings');
        assert.equal(cloudQ2.numericValue, 62000);
        assert.equal(cloudQ2.currency, 'USD');

        // Verify Paragraph 1 (INR crore/lakh + pronoun "Its" inheritance)
        const merOpex = res.facts.find(f => f.sourceBlockId === 'P1' && /operating expenses/i.test(f.metric));
        assert.ok(merOpex);
        assert.equal(merOpex.entity, 'Meridian Technologies');
        assert.equal(merOpex.periodLabel, 'FY 2025');
        assert.equal(merOpex.numericValue, 8500000);
        assert.equal(merOpex.currency, 'INR');
        assert.ok(merOpex.contextEvidenceIds.length > 0);

        // Verify Paragraph 2 (unknown EUR metrics)
        const p2Facts = res.facts.filter(f => f.sourceBlockId === 'P2');
        assert.equal(p2Facts.length, 2);
        assert.equal(p2Facts[0].entity, 'BluePeak Industries');
        assert.equal(p2Facts[0].currency, 'EUR');

        // Verify Paragraph 3 (accounting negative & percentage)
        const opLoss = res.facts.find(f => f.sourceBlockId === 'P3' && /operating loss/i.test(f.metric));
        assert.ok(opLoss);
        assert.equal(opLoss.numericValue, -250000);
        assert.equal(opLoss.currency, 'USD');

        const margin = res.facts.find(f => f.sourceBlockId === 'P3' && /net profit margin/i.test(f.metric));
        assert.ok(margin);
        assert.equal(margin.numericValue, 18.5);
        assert.equal(margin.unit, 'Percentage');

        // Verify Paragraph 4 (only AED 2025 extracted; 1998, 15 November 2026, 45821 excluded)
        const p4Facts = res.facts.filter(f => f.sourceBlockId === 'P4');
        assert.equal(p4Facts.length, 1);
        assert.equal(p4Facts[0].numericValue, 2025);
        assert.equal(p4Facts[0].currency, 'AED');
        assert.equal(p4Facts[0].periodLabel, 'FY 2026');
    });

    await t.test('2. Multi-Level Headers, Table Islands, Nested Hierarchies, Unfamiliar Headers & Missing Markers', async () => {
        // Two tables on one sparse worksheet separated by blank rows
        const sheetGrid = [
            ['Alpha Corp Multi-Level Summary (AED)', '', '', ''],
            ['Metric', 'FY2025', '', 'FY2026'],
            ['', 'Actual', 'Budget', 'Actual'],
            ['Revenue', '100', '120', '150'],
            ['', '', '', ''],
            ['Beta Corp Division Breakdown', '', ''],
            ['Business Indicator', 'Comparison A', 'Comparison B'],
            ['UAE Division', '', ''],
            ['New Efficiency Gain', '450000', 'N/A']
        ];

        const islands = detectTableIslands(sheetGrid, { tableId: 'S1', sheetName: 'Summary', pageNumber: 1 });
        assert.equal(islands.length, 2);

        const res = await extractStructuredFinancialFacts({
            metadata: { documentId: 902, documentName: 'Sparse_Sheet.xlsx', documentType: 'excel' },
            tables: [{ tableId: 'S1', sheetName: 'Summary', pageNumber: 1, grid: sheetGrid }],
            paragraphs: []
        });

        // Table 1: 3 facts (FY2025 Actual, FY2025 Budget, FY2026 Actual)
        const budgetFact = res.facts.find(f => f.periodLabel === 'FY 2025' && f.reportingBasis === 'Budget');
        assert.ok(budgetFact);
        assert.equal(budgetFact.numericValue, 120);

        // Table 2: 1 fact ("New Efficiency Gain" with division='UAE Division', columnLabel='Comparison A'); N/A is NOT 0!
        const gainFact = res.facts.find(f => f.metric === 'New Efficiency Gain');
        assert.ok(gainFact);
        assert.equal(gainFact.numericValue, 450000);
        assert.equal(gainFact.dimensions.division, 'UAE Division');
        assert.equal(gainFact.dimensions.columnLabel, 'Comparison A');
        assert.equal(gainFact.periodLabel, null, 'Must not invent period for Comparison A');
        assert.equal(res.coverage.missingValueCandidates, 1);
    });

    await t.test('3. Complex Narrative Patterns: Coordinated, Passive, Negation, Multi-Entity, Arabic, Ratios & Counts', async () => {
        const res = await extractStructuredFinancialFacts({
            metadata: { documentId: 903, documentName: 'Narrative_Test.pdf', documentType: 'pdf' },
            tables: [],
            paragraphs: [
                {
                    blockId: 'N1',
                    content: 'Contoso Logistics reported revenue of AED 15 million for FY2025, while Meridian Technologies reported revenue of INR 20 crore for FY2026.'
                },
                {
                    blockId: 'N2',
                    content: 'Research and Development Expenses and Sales and Distribution Costs were AED 12 million and AED 4 million, respectively.'
                },
                {
                    blockId: 'N3',
                    content: 'AED 500,000 was allocated to capital expenditure. The current ratio stood at 1.75. Total employees reached 135.'
                },
                {
                    blockId: 'N4',
                    content: 'The company did not achieve revenue of AED 15 million. If revenue reaches AED 20 million next year, operations will expand.'
                },
                {
                    blockId: 'N5',
                    content: 'حققت شركة النور إيرادات بقيمة 15 مليون درهم في FY2025.'
                }
            ]
        });

        // N1: isolated entities & periods
        const contoso = res.facts.find(f => f.entity === 'Contoso Logistics');
        const meridian = res.facts.find(f => f.entity === 'Meridian Technologies');
        assert.equal(contoso?.numericValue, 15000000);
        assert.equal(contoso?.periodLabel, 'FY 2025');
        assert.equal(meridian?.numericValue, 200000000);
        assert.equal(meridian?.periodLabel, 'FY 2026');

        // N2: preserved compound metric conjunctions
        assert.ok(res.facts.some(f => f.metric === 'Research and Development Expenses' && f.numericValue === 12000000));
        assert.ok(res.facts.some(f => f.metric === 'Sales and Distribution Costs' && f.numericValue === 4000000));

        // N3: passive, ratio, operational count
        assert.ok(res.facts.some(f => /capital expenditure/i.test(f.metric) && f.numericValue === 500000));
        const ratio = res.facts.find(f => f.unit === 'Ratio');
        assert.equal(ratio?.numericValue, 1.75);
        const count = res.facts.find(f => f.unit === 'Count');
        assert.equal(count?.numericValue, 135);

        // N4: negated and hypothetical values excluded from facts
        assert.equal(res.facts.filter(f => f.sourceBlockId === 'N4').length, 0);

        // N5: Arabic extraction
        const arFact = res.facts.find(f => f.sourceBlockId === 'N5');
        assert.ok(arFact);
        assert.equal(arFact.numericValue, 15000000);
        assert.equal(arFact.currency, 'AED');
    });

    await t.test('4. Exact Numerical Normalization (Indian, European, Arabic-Indic, No Default USD)', () => {
        assert.equal(normalizeFinancialNumber('1,25,00,000').numericValue, 12500000);
        assert.equal(normalizeFinancialNumber('EUR 1.250.000,50').numericValue, 1250000.5);
        assert.equal(normalizeFinancialNumber('EUR 1.250.000,50').currency, 'EUR');
        assert.equal(normalizeFinancialNumber('٣٬٥٠٠٬٠٠٠').numericValue, 3500000);
        assert.equal(normalizeFinancialNumber('1500').currency, null, 'Missing currency must NOT default to USD');
        assert.equal(normalizeFinancialNumber('N/A').isMissing, true);
    });

    await t.test('5. Provider Integration & Performance Benchmark (1,000-cell matrix < 3000ms)', async () => {
        const origProvider = process.env.FINANCIAL_EXTRACTION_PROVIDER;
        process.env.FINANCIAL_EXTRACTION_PROVIDER = 'structured_nlp';

        const grid = [['Metric', 'FY2024', 'FY2025', 'FY2026', 'FY2027']];
        for (let i = 0; i < 250; i++) {
            grid.push([`Custom Metric ${i}`, `${100 + i}`, `${200 + i}`, `${300 + i}`, `${400 + i}`]);
        }

        const t0 = performance.now();
        const result = await extractFinancialFactsUnified(
            {
                document_id: 999,
                documentName: 'Large_Benchmark.xlsx',
                entityHint: 'Benchmark Corp',
                currencyHint: 'AED',
                tables: [{ tableId: 'B1', grid }],
                paragraphs: []
            },
            { returnFullResponse: true }
        );
        const elapsedMs = performance.now() - t0;

        process.env.FINANCIAL_EXTRACTION_PROVIDER = origProvider;

        assert.equal(result.facts.length, 1000);
        assert.equal(result.processing.externalInferenceCalls, 0);
        assert.ok(elapsedMs < 3000, `1,000 candidates took ${elapsedMs.toFixed(1)}ms (target < 3000ms)`);
    });
});
