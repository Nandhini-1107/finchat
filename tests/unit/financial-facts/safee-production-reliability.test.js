'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { extractStructuredFinancialFacts } = require('../../../src/services/financial-extraction');
const { parseNormalizedNumberString, normalizeFinancialNumber } = require('../../../src/services/financial-extraction/numeric-normalizer');
const { cleanVisualLineWraps } = require('../../../src/services/financial-extraction/narrative/sentence-segmenter');
const { detectTablesAndParagraphsFromLines } = require('../../../src/services/financial-extraction/layout/pdf-layout-adapter');

describe('SAFEE Production Reliability & 46-Observation Suite (Spec Requirements)', () => {

    test('1. Numerical Normalizer & Line Wrap Fixes', () => {
        // Line-wrapped numbers from PDF text layer
        assert.equal(parseNormalizedNumberString('8,500,00\n0'), '8500000');
        assert.equal(parseNormalizedNumberString('1,25,00,00\n0'), '12500000');
        assert.equal(parseNormalizedNumberString('1,150,00\n0'), '1150000');

        // Indian numerical format
        const inr = normalizeFinancialNumber('1,25,00,000');
        assert.equal(inr.numericValue, 12500000);
        assert.equal(inr.exactDecimal, '12500000');

        // Standard Western format
        const west = normalizeFinancialNumber('8,500,000');
        assert.equal(west.numericValue, 8500000);

        // European format
        const euro = normalizeFinancialNumber('1.250.000,50');
        assert.equal(euro.numericValue, 1250000.50);

        // Negatives with accounting brackets
        const neg = normalizeFinancialNumber('(250,000)');
        assert.equal(neg.numericValue, -250000);

        // Percentages, ratios, counts do not inherit monetary scale
        const pct = normalizeFinancialNumber('18.5%', 1000000);
        assert.equal(pct.numericValue, 18.5);
        assert.equal(pct.unit, 'Percentage');
        assert.equal(pct.scaleMultiplier, 1);

        // Clean visual line wraps
        const wrapped = 'Meridian Technologies reported revenue of INR 15.5 crore and net profit of INR 2.5 crore for FY\n2025. Its operating expenses amounted to INR 85 lakh.';
        const unwrapped = cleanVisualLineWraps(wrapped);
        assert.ok(unwrapped.includes('for FY 2025.'));
        assert.ok(!unwrapped.includes('FY\n2025'));
    });

    test('2. Table vs Narrative Separation from Extracted Text', () => {
        const sampleText = [
            'Financial Performance Report – FY 2025',
            'Company: Astravion Technologies',
            'Reporting Currency: AED',
            'Document Version: 1.0',
            '1. Annual Financial Performance',
            'All monetary amounts are expressed in AED millions.',
            'Financial Particulars\tFY 2025\tFY 2026',
            'Revenue\t15.50\t20.75',
            'Cost of Revenue\t5.20\t7.10',
            'Gross Profit\t10.30\t13.65',
            'Operating Expenses\t4.50\t5.25',
            'Net Profit\t5.80\t8.40',
            'Digital Infrastructure Recovery Benefits\t0.45\t0.85',
            'Intelligent Resource Optimization Savings\t0.25\t0.60',
            '4. Financial Performance in Paragraphs',
            'Meridian Technologies reported revenue of INR 15.5 crore and net profit of INR 2.5 crore for FY 2025. Its operating expenses amounted to INR 85 lakh.'
        ];

        const { tables, paragraphs } = detectTablesAndParagraphsFromLines(sampleText, 1);
        assert.equal(tables.length, 1);
        assert.equal(tables[0].grid.length, 8); // Header + 7 rows
        assert.equal(tables[0].grid[0][0], 'Financial Particulars');
        assert.equal(tables[0].grid[1][0], 'Revenue');
        assert.equal(tables[0].grid[1][1], '15.50');
        assert.equal(tables[0].grid[1][2], '20.75');

        // Paragraphs must contain the narrative text, NOT the table rows
        assert.ok(paragraphs.some(p => p.content.includes('Meridian Technologies reported revenue')));
        assert.ok(!paragraphs.some(p => p.content.includes('Cost of Revenue\t5.20')));
    });

    test('3. Complete 46-Observation Controlled Regression Document (Section 43)', async () => {
        // Construct the exact 4-page payload matching DocumentId 21
        const payload = {
            metadata: {
                documentId: 21,
                documentName: 'finacacial fact testing nlp 2.pdf',
                documentType: 'pdf',
                documentVersion: '1.0'
            },
            tables: [
                // Table 1: Annual Financial Performance (14 observations)
                {
                    tableId: 'P1-T1',
                    pageNumber: 1,
                    caption: '1. Annual Financial Performance',
                    contextText: 'Company: Astravion Technologies. All monetary amounts are expressed in AED millions.',
                    grid: [
                        ['Financial Particulars', 'FY 2025', 'FY 2026'],
                        ['Revenue', '15.50', '20.75'],
                        ['Cost of Revenue', '5.20', '7.10'],
                        ['Gross Profit', '10.30', '13.65'],
                        ['Operating Expenses', '4.50', '5.25'],
                        ['Net Profit', '5.80', '8.40'],
                        ['Digital Infrastructure Recovery Benefits', '0.45', '0.85'],
                        ['Intelligent Resource Optimization Savings', '0.25', '0.60']
                    ]
                },
                // Table 2: Quarterly Financial Performance (9 observations)
                {
                    tableId: 'P2-T1',
                    pageNumber: 2,
                    caption: '2. Quarterly Financial Performance',
                    contextText: 'Company: Nexovanta. Currency: USD',
                    grid: [
                        ['Reporting Period', 'Revenue', 'Net Profit', 'Cloud Optimization Savings'],
                        ['Q1 2026', '850,000', '125,000', '45,000'],
                        ['Q2 2026', '950,000', '175,000', '62,000'],
                        ['Q3 2026', '1,150,000', '210,000', '85,000']
                    ]
                },
                // Table 3: Multi-Company Financial Summary (4 observations)
                {
                    tableId: 'P2-T2',
                    pageNumber: 2,
                    caption: '3. Multi-Company Financial Summary',
                    grid: [
                        ['Organization', 'Financial Metric', 'Period', 'Currency', 'Amount'],
                        ['Astravion Technologies', 'Capital Expenditure', 'FY 2026', 'AED', '750,000'],
                        ['Nexovanta', 'Operating Profit', 'FY 2025', 'USD', '450,000'],
                        ['Velmora', 'Energy Recovery Benefits', 'FY 2026', 'EUR', '325,250.75'],
                        ['Quantivex', 'Net Profit', 'FY 2025', 'INR', '1,25,00,000']
                    ]
                },
                // Table 5: Financial and Operational Ratios (5 observations + 1 missing marker)
                {
                    tableId: 'P3-T1',
                    pageNumber: 3,
                    caption: '5. Financial and Operational Ratios',
                    contextText: 'Company: Nexovanta. Reporting Period: FY 2026. Currency for monetary amounts: USD',
                    grid: [
                        ['Indicator', 'Value'],
                        ['Operating Loss', '(250,000)'],
                        ['Net Profit Margin', '18.5%'],
                        ['Current Ratio', '1.75'],
                        ['Total Employees', '135'],
                        ['Total Assets', '8,500,000'],
                        ['Deferred Tax Adjustment', 'N/A']
                    ]
                },
                // Table 6: Actual and Budget Performance (6 observations)
                {
                    tableId: 'P4-T1',
                    pageNumber: 4,
                    caption: '6. Actual and Budget Performance',
                    contextText: 'Company: Astravion Technologies. All monetary amounts are expressed in AED millions.',
                    grid: [
                        ['Financial Metric', 'FY 2026 Actual', 'FY 2026 Budget'],
                        ['Revenue', '20.75', '22.00'],
                        ['Net Profit', '8.40', '9.00'],
                        ['Operating Expenses', '5.25', '5.50']
                    ]
                },
                // Deliberate negative test table: Testing summary counts (MUST NOT become financial facts)
                {
                    tableId: 'P4-T2',
                    pageNumber: 4,
                    caption: 'Expected testing results',
                    isNonFinancial: true,
                    grid: [
                        ['Section', 'Expected facts'],
                        ['Annual financial performance', '14'],
                        ['Quarterly financial performance', '9'],
                        ['Multi-company summary', '4'],
                        ['Financial paragraphs', '7'],
                        ['Financial and operational ratios', '5'],
                        ['Actual and budget performance', '6'],
                        ['Additional financial information', '1'],
                        ['Total', '46']
                    ]
                }
            ],
            paragraphs: [
                // Section 4: Financial Performance in Paragraphs (7 observations)
                {
                    blockId: 'P2-B1',
                    pageNumber: 2,
                    content: 'Meridian Technologies reported revenue of INR 15.5 crore and net profit of INR 2.5 crore for FY 2025. Its operating expenses amounted to INR 85 lakh.'
                },
                {
                    blockId: 'P2-B2',
                    pageNumber: 2,
                    content: 'Velmora recorded automated infrastructure efficiency gains of EUR 450,000 and sustainable energy recovery savings of EUR 125,000 during FY 2026.'
                },
                {
                    blockId: 'P2-B3',
                    pageNumber: 2,
                    content: 'Quantivex reported revenue of AED 12 million in FY 2025 and AED 18 million in FY 2026.'
                },
                // Section 7: Additional Information (1 observation + metadata)
                {
                    blockId: 'P4-B1',
                    pageNumber: 4,
                    content: 'Astravion Technologies was established in 1998. The report was approved on 25 November 2026 under reference number 45821. Astravion Technologies reported administrative expenses of AED 2025 for FY 2026.'
                }
            ]
        };

        const result = await extractStructuredFinancialFacts(payload);
        assert.equal(result.status, 'ok');

        const facts = result.facts;
        assert.ok(facts.length >= 46, `Expected at least 46 observations, got ${facts.length}`);

        // --- SECTION 1 AUDIT (14 observations) ---
        const s1Rev25 = facts.find(f => f.sourceTableId === 'P1-T1' && f.metric === 'Revenue' && f.periodLabel === 'FY 2025');
        assert.ok(s1Rev25, 'Section 1: FY 2025 Revenue must exist');
        assert.equal(s1Rev25.numericValue, 15500000, '15.50 AED million -> 15500000');
        assert.equal(s1Rev25.currency, 'AED');
        assert.equal(s1Rev25.sourceType, 'Table');
        assert.equal(s1Rev25.validationStatus, 'Validated');

        const s1Rev26 = facts.find(f => f.sourceTableId === 'P1-T1' && f.metric === 'Revenue' && f.periodLabel === 'FY 2026');
        assert.ok(s1Rev26, 'Section 1: FY 2026 Revenue must exist');
        assert.equal(s1Rev26.numericValue, 20750000, '20.75 AED million -> 20750000');
        assert.equal(s1Rev26.currency, 'AED');

        // Unfamiliar metrics in Section 1
        const s1Digital = facts.find(f => f.sourceTableId === 'P1-T1' && f.metric.includes('Digital Infrastructure Recovery Benefits') && f.periodLabel === 'FY 2026');
        assert.ok(s1Digital, 'Section 1: Digital Infrastructure Recovery Benefits must exist');
        assert.equal(s1Digital.numericValue, 850000);

        // --- SECTION 2 AUDIT (9 observations: 3 periods x 3 metrics) ---
        const s2Facts = facts.filter(f => f.sourceTableId === 'P2-T1');
        assert.equal(s2Facts.length, 9, `Section 2 Quarterly table must produce exactly 9 facts, got ${s2Facts.length}`);
        assert.ok(s2Facts.every(f => f.entity === 'Nexovanta'), 'Section 2 facts must have entity Nexovanta');
        assert.ok(s2Facts.every(f => f.currency === 'USD'), 'Section 2 facts must have currency USD');
        const q3Rev = s2Facts.find(f => f.periodLabel === 'Q3 2026' && f.metric === 'Revenue');
        assert.ok(q3Rev);
        assert.equal(q3Rev.numericValue, 1150000);

        // --- SECTION 3 AUDIT (4 observations: multi-company) ---
        const s3Facts = facts.filter(f => f.sourceTableId === 'P2-T2');
        assert.equal(s3Facts.length, 4, `Section 3 Multi-company summary must have 4 facts, got ${s3Facts.length}`);
        const s3Astra = s3Facts.find(f => f.entity === 'Astravion Technologies');
        assert.ok(s3Astra);
        assert.equal(s3Astra.currency, 'AED');
        assert.equal(s3Astra.numericValue, 750000);

        const s3Nexo = s3Facts.find(f => f.entity === 'Nexovanta');
        assert.ok(s3Nexo);
        assert.equal(s3Nexo.currency, 'USD');
        assert.equal(s3Nexo.numericValue, 450000);

        const s3Velm = s3Facts.find(f => f.entity === 'Velmora');
        assert.ok(s3Velm);
        assert.equal(s3Velm.currency, 'EUR');
        assert.equal(s3Velm.numericValue, 325250.75);

        const s3Quant = s3Facts.find(f => f.entity === 'Quantivex');
        assert.ok(s3Quant);
        assert.equal(s3Quant.currency, 'INR');
        assert.equal(s3Quant.numericValue, 12500000, 'Indian 1,25,00,000 must be 12500000');

        // --- SECTION 4 AUDIT (7 narrative observations) ---
        const s4MeridianRev = facts.find(f => f.entity === 'Meridian Technologies' && f.metric.toLowerCase() === 'revenue');
        assert.ok(s4MeridianRev, 'Meridian Revenue must exist');
        assert.equal(s4MeridianRev.periodLabel, 'FY 2025', 'Meridian Revenue must have FY 2025');
        assert.equal(s4MeridianRev.numericValue, 155000000, '15.5 crore INR -> 155000000');

        const s4MeridianProfit = facts.find(f => f.entity === 'Meridian Technologies' && f.metric.toLowerCase() === 'net profit');
        assert.ok(s4MeridianProfit, 'Meridian Net Profit must exist');
        assert.equal(s4MeridianProfit.periodLabel, 'FY 2025');
        assert.equal(s4MeridianProfit.numericValue, 25000000);

        const s4MeridianOpex = facts.find(f => f.entity === 'Meridian Technologies' && f.metric.toLowerCase() === 'operating expenses');
        assert.ok(s4MeridianOpex, 'Meridian Opex (pronoun antecedent) must exist');
        assert.equal(s4MeridianOpex.numericValue, 8500000, '85 lakh INR -> 8500000');

        const s4Velmora1 = facts.find(f => f.entity === 'Velmora' && f.metric.includes('automated infrastructure efficiency gains'));
        assert.ok(s4Velmora1);
        assert.equal(s4Velmora1.numericValue, 450000);
        assert.equal(s4Velmora1.currency, 'EUR');

        const s4Quant25 = facts.find(f => f.entity === 'Quantivex' && f.periodLabel === 'FY 2025' && f.metric.toLowerCase() === 'revenue');
        assert.ok(s4Quant25, 'Quantivex FY 2025 Revenue must exist');
        assert.equal(s4Quant25.numericValue, 12000000);

        const s4Quant26 = facts.find(f => f.entity === 'Quantivex' && f.periodLabel === 'FY 2026' && f.metric.toLowerCase() === 'revenue');
        assert.ok(s4Quant26, 'Quantivex FY 2026 Revenue must exist with metric "revenue" (NOT "in FY 2025 and")');
        assert.equal(s4Quant26.numericValue, 18000000);

        // Verification: metric "in FY 2025 and" must NEVER exist
        const badMetric = facts.find(f => /in\s+FY\s*2025\s+and/i.test(f.metric));
        assert.equal(badMetric, undefined, 'Metric "in FY 2025 and" must NEVER be extracted');

        // --- SECTION 5 AUDIT (5 observations: ratios, counts, total assets) ---
        const s5Facts = facts.filter(f => f.sourceTableId === 'P3-T1');
        assert.equal(s5Facts.length, 5, `Section 5 must have 5 facts (excluding N/A), got ${s5Facts.length}`);

        const lossFact = s5Facts.find(f => f.metric === 'Operating Loss');
        assert.ok(lossFact);
        assert.equal(lossFact.numericValue, -250000, '(250,000) must be negative -250000');

        const marginFact = s5Facts.find(f => f.metric === 'Net Profit Margin');
        assert.ok(marginFact);
        assert.equal(marginFact.numericValue, 18.5, 'Margin 18.5% must not be scaled');
        assert.equal(marginFact.unit, 'Percentage');

        const ratioFact = s5Facts.find(f => f.metric === 'Current Ratio');
        assert.ok(ratioFact);
        assert.equal(ratioFact.numericValue, 1.75);

        const empFact = s5Facts.find(f => f.metric === 'Total Employees');
        assert.ok(empFact);
        assert.equal(empFact.numericValue, 135);

        const assetFact = s5Facts.find(f => f.metric === 'Total Assets');
        assert.ok(assetFact);
        assert.equal(assetFact.numericValue, 8500000, 'Total assets must be exact 8500000, not 850000');

        // --- SECTION 6 AUDIT (6 observations: Actual vs Budget) ---
        const s6Facts = facts.filter(f => f.sourceTableId === 'P4-T1');
        assert.equal(s6Facts.length, 6, `Section 6 must have 6 facts, got ${s6Facts.length}`);
        const actRev = s6Facts.find(f => f.metric === 'Revenue' && f.reportingBasis === 'Actual');
        assert.ok(actRev);
        assert.equal(actRev.numericValue, 20750000);

        const budRev = s6Facts.find(f => f.metric === 'Revenue' && f.reportingBasis === 'Budget');
        assert.ok(budRev);
        assert.equal(budRev.numericValue, 22000000);

        // --- SECTION 7 AUDIT (1 observation) ---
        const s7Admin = facts.find(f => f.metric.toLowerCase().includes('administrative expenses'));
        assert.ok(s7Admin, 'Administrative expenses AED 2025 must exist');
        assert.equal(s7Admin.numericValue, 2025, 'AED 2025 must be numeric amount, not year');
        assert.equal(s7Admin.currency, 'AED');

        // --- NEGATIVE TESTS AUDIT ---
        // Version number must NOT be a validated financial fact
        const versionFact = facts.find(f => /version/i.test(f.metric) || f.rawValue === '1.0');
        assert.equal(versionFact, undefined, 'Document version 1.0 must NOT be extracted as a financial fact');

        // Testing summary numbers (14, 9, 4, 7, 5, 6, 1, 46) must NOT be extracted
        const testSummaryFact = facts.find(f => f.metric === 'Total' && f.numericValue === 46);
        assert.equal(testSummaryFact, undefined, 'Total 46 from testing summary must NOT be a financial fact');
    });

    test('4. Randomized Holdout & Anti-Hardcoding Suite (Section 45)', async () => {
        // Generates dynamic random entities, metrics, periods, currencies
        const randomCompanies = ['Zenith Dynamics', 'Hyperion Systems', 'Apex Renewable Energy', 'Solstice Corp'];
        const randomMetrics = ['Decentralized Infrastructure Yield', 'Autonomous Logistics Savings', 'Carbon Neutrality Credits'];
        const randomPeriods = ['FY 2028', 'FY 2029', 'Q4 2027'];

        const comp = randomCompanies[Math.floor(Math.random() * randomCompanies.length)];
        const met = randomMetrics[Math.floor(Math.random() * randomMetrics.length)];
        const per = randomPeriods[Math.floor(Math.random() * randomPeriods.length)];

        const payload = {
            metadata: {
                documentId: 999,
                documentName: 'random_holdout_test.pdf'
            },
            tables: [
                {
                    tableId: 'R-T1',
                    pageNumber: 1,
                    caption: `Performance Review - ${comp}`,
                    contextText: `Company: ${comp}. All monetary amounts are expressed in EUR millions.`,
                    grid: [
                        ['Metric', per],
                        [met, '34.50']
                    ]
                }
            ],
            paragraphs: [
                {
                    blockId: 'R-B1',
                    pageNumber: 1,
                    content: `${comp} reported ${met} of EUR 34.50 million in ${per}.`
                }
            ]
        };

        const result = await extractStructuredFinancialFacts(payload);
        assert.equal(result.status, 'ok');
        assert.ok(result.facts.length >= 1);

        const fact = result.facts[0];
        assert.equal(fact.entity, comp, 'Dynamic company name must match');
        assert.equal(fact.metric.toLowerCase(), met.toLowerCase(), 'Dynamic metric name must match');
        assert.equal(fact.periodLabel, per, 'Dynamic period must match');
        assert.equal(fact.currency, 'EUR', 'Currency must be EUR');
        assert.equal(fact.numericValue, 34500000, 'Exact scale 34.50 million -> 34500000');
    });
});
