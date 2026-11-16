const test = require('node:test');
const assert = require('node:assert/strict');
const {
    extractFinancialFacts,
    extractFinancialFactsHybrid,
    extractNarrativeFinancialFacts,
    cleanMetricLabel,
    splitIntoClauses,
    isMetricAssociatedWithValue,
    resolveRowReportingBasis
} = require('../../../src/services/fact-extraction');
const { normalizeFinancialValue } = require('../../../src/services/unit-normalizer');

test('Phase 4.3.5: Financial Fact Extraction Defect Corrections Suite', async (t) => {

    // =========================================================================
    // Defect 1: Critical – LLM Metric-Value Association
    // =========================================================================
    await t.test('Defect 1.1: splitIntoClauses segments complex multi-clause sentences cleanly', () => {
        const textEn = 'Following fiscal review, the top-line revenue expansion of 12%, accompanied by an operating cost reduction of 5%, reflected our strategic pivot.';
        const clausesEn = splitIntoClauses(textEn);
        assert.ok(clausesEn.length >= 3, `Expected at least 3 clauses, got ${clausesEn.length}`);
        assert.ok(clausesEn.some(c => c.includes('12%') && c.toLowerCase().includes('revenue')));
        assert.ok(clausesEn.some(c => c.includes('5%') && c.toLowerCase().includes('operating cost')));

        const textAr = 'سجلت الشركة نمواً في الإيرادات بنسبة 15%، بينما تراجعت التكاليف بنسبة 4%.';
        const clausesAr = splitIntoClauses(textAr);
        assert.equal(clausesAr.length, 2, 'Arabic sentence should split into two clauses at comma/بينما');
        assert.ok(clausesAr[0].includes('15%') && clausesAr[0].includes('الإيرادات'));
        assert.ok(clausesAr[1].includes('4%') && clausesAr[1].includes('التكاليف'));
    });

    await t.test('Defect 1.2: isMetricAssociatedWithValue rejects cross-metric value misattributions', () => {
        const sourceText = 'Following fiscal review, the top-line revenue expansion of 12%, accompanied by an operating cost reduction of 5%, reflected our strategic pivot.';

        // Faulty LLM output: Revenue = 5%
        const faultyFact = {
            metric: 'Revenue',
            rawValue: 0.05,
            originalTextValue: '5%',
            normalizedUnit: 'ratio'
        };
        const rejected = isMetricAssociatedWithValue('Revenue', faultyFact, sourceText);
        assert.equal(rejected, false, 'Must reject 5% value assigned to Revenue');

        // Correct LLM outputs
        const correctRevFact = {
            metric: 'Revenue',
            rawValue: 0.12,
            originalTextValue: '12%',
            normalizedUnit: 'ratio'
        };
        const acceptedRev = isMetricAssociatedWithValue('Revenue', correctRevFact, sourceText);
        assert.equal(acceptedRev, true, 'Must accept 12% value assigned to Revenue');

        const correctCostFact = {
            metric: 'Operating cost',
            rawValue: 0.05,
            originalTextValue: '5%',
            normalizedUnit: 'ratio'
        };
        const acceptedCost = isMetricAssociatedWithValue('Operating cost', correctCostFact, sourceText);
        assert.equal(acceptedCost, true, 'Must accept 5% value assigned to Operating cost');
    });

    await t.test('Defect 1.3: extractFinancialFactsHybrid rejects hallucinated cross-metric associations and accepts valid facts', async () => {
        const doc = {
            document: {
                documentId: 'doc-hybrid-d1',
                fileName: 'Defect1_Report.pdf',
                metadata: { issuer: 'Contoso Holdings', reportingPeriod: 'Q1 2026', currency: 'USD' }
            },
            elements: [
                {
                    elementId: 'para_multi_d1',
                    elementType: 'paragraph',
                    content: 'Following fiscal review, the top-line revenue expansion of 12%, accompanied by an operating cost reduction of 5%, reflected our strategic pivot.'
                }
            ],
            tables: []
        };

        // Simulated LLM returning 1 hallucinated swapped fact and 2 correct facts
        const mockLLM = async () => ({
            text: JSON.stringify({
                facts: [
                    {
                        paragraphId: 'Paragraph para_multi_d1',
                        metric: 'Revenue',
                        rawValue: 0.05,
                        originalTextValue: '5%',
                        normalizedUnit: 'ratio'
                    },
                    {
                        paragraphId: 'Paragraph para_multi_d1',
                        metric: 'Top-line revenue',
                        rawValue: 0.12,
                        originalTextValue: '12%',
                        normalizedUnit: 'ratio'
                    },
                    {
                        paragraphId: 'Paragraph para_multi_d1',
                        metric: 'Operating cost',
                        rawValue: 0.05,
                        originalTextValue: '5%',
                        normalizedUnit: 'ratio'
                    }
                ]
            }),
            usage: { inputTokens: 80, outputTokens: 40, totalTokens: 120 }
        });

        const facts = await extractFinancialFactsHybrid(doc, {
            useLLM: true,
            chatCompletion: mockLLM
        });

        // The faulty fact (Revenue = 5%) MUST NOT be present
        const faulty = facts.find(f => f.metric === 'Revenue' && Math.abs(f.normalizedValue - 0.05) < 0.001);
        assert.equal(faulty, undefined, 'Hallucinated fact Revenue = 5% must be rejected');

        // Stats should track hallucination rejection
        assert.ok(facts.stats.hallucinationsRejected >= 1, 'Stats must increment hallucinationsRejected');

        // Correct facts must be present
        const rev = facts.find(f => f.metric.toLowerCase().includes('revenue') && Math.abs(f.normalizedValue - 0.12) < 0.001);
        assert.ok(rev, 'Valid fact Top-line revenue = 12% must be accepted');

        const cost = facts.find(f => f.metric.toLowerCase().includes('operating cost') && Math.abs(f.normalizedValue - 0.05) < 0.001);
        assert.ok(cost, 'Valid fact Operating cost = 5% must be accepted');
    });

    // =========================================================================
    // Defect 2: High – Narrative Deduplication Across Distinct Entities
    // =========================================================================
    await t.test('Defect 2: Narrative deduplication preserves distinct subsidiaries with identical metric & value', () => {
        const doc = {
            document: {
                documentId: 'doc-d2-entities',
                fileName: 'Subsidiaries_Q1.pdf',
                metadata: { issuer: 'Contoso Holdings', reportingPeriod: 'Q1 2026', currency: 'AED' }
            },
            elements: [
                {
                    elementId: 'para_subs',
                    elementType: 'paragraph',
                    content: 'Contoso Logistics LLC recorded Net profit of AED 5,000,000, while Contoso Retail LLC recorded Net profit of AED 5,000,000 in Q1 2026.'
                }
            ],
            tables: []
        };

        const facts = extractFinancialFacts(doc);
        assert.equal(facts.length, 2, 'Both distinct subsidiaries must be preserved even with identical values');

        const logistics = facts.find(f => f.entity === 'Contoso Logistics LLC');
        const retail = facts.find(f => f.entity === 'Contoso Retail LLC');

        assert.ok(logistics, 'Must extract fact for Contoso Logistics LLC');
        assert.ok(retail, 'Must extract fact for Contoso Retail LLC');

        assert.equal(logistics.normalizedValue, 5000000);
        assert.equal(retail.normalizedValue, 5000000);
        assert.equal(logistics.currency, 'AED');
        assert.equal(retail.currency, 'AED');
        assert.notEqual(logistics.entity, retail.entity);
    });

    await t.test('Defect 2.2: Genuine narrative duplicate from the same entity is properly deduplicated', () => {
        const doc = {
            document: {
                documentId: 'doc-d2-dup',
                fileName: 'Dup_Report.pdf',
                metadata: { issuer: 'Contoso Logistics LLC', reportingPeriod: 'Q1 2026', currency: 'AED' }
            },
            elements: [
                {
                    elementId: 'p1',
                    elementType: 'paragraph',
                    content: 'Contoso Logistics LLC recorded Net profit of AED 5,000,000 in Q1 2026.'
                },
                {
                    elementId: 'p2',
                    elementType: 'paragraph',
                    content: 'Net profit reached AED 5,000,000 in Q1 2026 for the logistics unit.'
                }
            ],
            tables: []
        };

        const facts = extractFinancialFacts(doc);
        assert.equal(facts.length, 1, 'Genuine duplicate for same entity, metric, period, and value must be deduplicated');
        assert.equal(facts[0].normalizedValue, 5000000);
    });

    // =========================================================================
    // Defect 3: High – Negative Delta Polarity
    // =========================================================================
    await t.test('Defect 3.1: English decrease verbs produce negative ratios while growth verbs produce positive ratios', () => {
        const doc = {
            document: {
                documentId: 'doc-d3-polarity',
                fileName: 'Polarity_Report.pdf',
                metadata: { issuer: 'Contoso Corp', reportingPeriod: 'Q1 2026', currency: 'USD' }
            },
            elements: [
                {
                    elementId: 'p_delta',
                    elementType: 'paragraph',
                    content: 'Revenue increased by 12%, while operating expenses decreased by 5%.'
                }
            ],
            tables: []
        };

        const facts = extractFinancialFacts(doc);
        assert.equal(facts.length, 2, 'Must extract both delta facts');

        const revFact = facts.find(f => f.metric.toLowerCase().includes('revenue'));
        const opexFact = facts.find(f => f.metric.toLowerCase().includes('operating expenses'));

        assert.ok(revFact, 'Must extract Revenue fact');
        assert.ok(opexFact, 'Must extract Operating expenses fact');

        // Polarity checks
        assert.equal(revFact.normalizedValue, 0.12, 'Revenue growth must be positive ratio 0.12');
        assert.equal(revFact.metric, 'Revenue growth');

        assert.equal(opexFact.normalizedValue, -0.05, 'Operating expenses decrease must be negative ratio -0.05');
        assert.equal(opexFact.metric, 'operating expenses decrease', 'Metric label must reflect decrease, not growth');
    });

    await t.test('Defect 3.2: Absolute financial balances remain positive regardless of copula verb', () => {
        const doc = {
            document: {
                documentId: 'doc-d3-abs',
                fileName: 'Cash_Report.pdf',
                metadata: { issuer: 'Contoso Corp', reportingPeriod: 'Q1 2026', currency: 'USD' }
            },
            elements: [
                {
                    elementId: 'p_cash',
                    elementType: 'paragraph',
                    content: 'Total cash stood at $15.2 million at quarter end.'
                }
            ],
            tables: []
        };

        const facts = extractFinancialFacts(doc);
        assert.equal(facts.length, 1);
        assert.equal(facts[0].normalizedValue, 15200000, 'Absolute monetary balance must remain positive');
        assert.equal(facts[0].currency, 'USD');
    });

    // =========================================================================
    // Defect 4: Medium – Arabic Currency Recognition (دولار and يورو)
    // =========================================================================
    await t.test('Defect 4.1: unit-normalizer detects دولار as USD and يورو as EUR', () => {
        const usdVal = normalizeFinancialValue('2 مليار دولار');
        assert.equal(usdVal.currency, 'USD', 'دولار must be recognized as USD');
        assert.equal(usdVal.normalizedValue, 2000000000);
        assert.equal(usdVal.normalizedUnit, 'amount');

        const eurVal = normalizeFinancialValue('5 مليون يورو');
        assert.equal(eurVal.currency, 'EUR', 'يورو must be recognized as EUR');
        assert.equal(eurVal.normalizedValue, 5000000);
        assert.equal(eurVal.normalizedUnit, 'amount');
    });

    await t.test('Defect 4.2: Fact extraction resolves Arabic currencies from narrative text', () => {
        const doc = {
            document: {
                documentId: 'doc-d4-curr',
                fileName: 'Arabic_Currencies.pdf',
                metadata: { issuer: 'شركة الاستثمار العالمية', reportingPeriod: '2026' }
            },
            elements: [
                {
                    elementId: 'p_usd',
                    elementType: 'paragraph',
                    content: 'بلغت الإيرادات 50 مليون دولار خلال العام.'
                },
                {
                    elementId: 'p_eur',
                    elementType: 'paragraph',
                    content: 'حققت الشركة أرباحاً قدرها 10 مليون يورو خلال العام.'
                }
            ],
            tables: []
        };

        const facts = extractFinancialFacts(doc);
        assert.equal(facts.length, 2);

        const usdFact = facts.find(f => f.currency === 'USD');
        const eurFact = facts.find(f => f.currency === 'EUR');

        assert.ok(usdFact, 'Must extract fact with USD currency');
        assert.equal(usdFact.normalizedValue, 50000000);

        assert.ok(eurFact, 'Must extract fact with EUR currency');
        assert.equal(eurFact.normalizedValue, 10000000);
    });

    // =========================================================================
    // Defect 5: Medium – Key-Value Reporting Basis Resolution
    // =========================================================================
    await t.test('Defect 5.1: Key-Value tables dynamically resolve reporting basis from row labels', () => {
        const doc = {
            document: {
                documentId: 'doc-d5-kv',
                fileName: 'Variance_Report.pdf',
                metadata: { issuer: 'Contoso Holdings', reportingPeriod: 'Q1 2026', currency: 'USD', reportingBasis: 'Actual' }
            },
            tables: [
                {
                    table_id: 'table_kv_var',
                    columns: [{ header: 'Metric' }, { header: 'Value' }],
                    rows: [
                        { rawValues: ['Actual Revenue', '15,000,000'] },
                        { rawValues: ['Budgeted Revenue', '14,000,000'] },
                        { rawValues: ['Forecasted Net Profit', '2,500,000'] }
                    ]
                }
            ]
        };

        const facts = extractFinancialFacts(doc);
        assert.equal(facts.length, 3);

        const actualFact = facts.find(f => f.metric === 'Actual Revenue');
        const budgetFact = facts.find(f => f.metric === 'Budgeted Revenue');
        const forecastFact = facts.find(f => f.metric === 'Forecasted Net Profit');

        assert.equal(actualFact.reportingBasis, 'Actual', 'Actual Revenue must have Actual reporting basis');
        assert.equal(budgetFact.reportingBasis, 'Budget', 'Budgeted Revenue must have Budget reporting basis');
        assert.equal(forecastFact.reportingBasis, 'Forecast', 'Forecasted Net Profit must have Forecast reporting basis');
    });

    await t.test('Defect 5.2: resolveRowReportingBasis unit tests for English and Arabic labels', () => {
        assert.equal(resolveRowReportingBasis('Budgeted OpEx'), 'Budget');
        assert.equal(resolveRowReportingBasis('Planned Expenditure'), 'Budget');
        assert.equal(resolveRowReportingBasis('الميزانية المعتمدة'), 'Budget');
        assert.equal(resolveRowReportingBasis('الخطة السنوية'), 'Budget');

        assert.equal(resolveRowReportingBasis('Forecast Q3'), 'Forecast');
        assert.equal(resolveRowReportingBasis('Projected Turnover'), 'Forecast');
        assert.equal(resolveRowReportingBasis('التوقعات المالية'), 'Forecast');

        assert.equal(resolveRowReportingBasis('Audited Revenue'), 'Actual');
        assert.equal(resolveRowReportingBasis('الفعلي'), 'Actual');
        assert.equal(resolveRowReportingBasis('مدقق'), 'Actual');

        assert.equal(resolveRowReportingBasis('General Revenue', 'Actual'), 'Actual');
    });

    // =========================================================================
    // Defect 6: Medium – Temporal Phrase Separation from Metric Labels
    // =========================================================================
    await t.test('Defect 6.1: cleanMetricLabel cleanly strips temporal prepositional phrases', () => {
        assert.deepEqual(cleanMetricLabel('Revenue in Q2 2026'), { metric: 'Revenue', period: 'Q2 2026' });
        assert.deepEqual(cleanMetricLabel('Net profit for FY 2025'), { metric: 'Net profit', period: 'FY 2025' });
        assert.deepEqual(cleanMetricLabel('Gross margin during 2025'), { metric: 'Gross margin', period: '2025' });
        assert.deepEqual(cleanMetricLabel('الإيرادات في عام 2025'), { metric: 'الإيرادات', period: '2025' });
        assert.deepEqual(cleanMetricLabel('المصاريف التشغيلية خلال الربع الأول 2026'), { metric: 'المصاريف التشغيلية', period: 'الربع الأول 2026' });

        // Non-temporal phrases remain intact
        assert.deepEqual(cleanMetricLabel('Operating expenses'), { metric: 'Operating expenses', period: null });
        assert.deepEqual(cleanMetricLabel('Research and development'), { metric: 'Research and development', period: null });
        assert.deepEqual(cleanMetricLabel('Cash and cash equivalents'), { metric: 'Cash and cash equivalents', period: null });
    });

    await t.test('Defect 6.2: Narrative extraction separates temporal qualifier and assigns periodLabel', () => {
        const doc = {
            document: {
                documentId: 'doc-d6-temp',
                fileName: 'Temporal_Report.pdf',
                metadata: { issuer: 'Contoso Retail LLC', reportingPeriod: 'Q2 2026', currency: 'AED' }
            },
            elements: [
                {
                    elementId: 'p_temp',
                    elementType: 'paragraph',
                    content: 'Revenue in Q2 2026 reached AED 12,000,000 across core stores.'
                }
            ],
            tables: []
        };

        const facts = extractFinancialFacts(doc);
        assert.equal(facts.length, 1);
        assert.equal(facts[0].metric, 'Revenue', 'Metric label must NOT contain "in Q2 2026"');
        assert.equal(facts[0].periodLabel, 'Q2 2026', 'Extracted period must be Q2 2026');
        assert.equal(facts[0].normalizedValue, 12000000);
    });

    // =========================================================================
    // Defect 7: Low – Arabic Metric Label Contamination
    // =========================================================================
    await t.test('Defect 7: Arabic metrics do NOT have English " growth" appended', () => {
        const doc = {
            document: {
                documentId: 'doc-d7-ar-contam',
                fileName: 'Arabic_Commentary.pdf',
                metadata: { issuer: 'Contoso Holdings', reportingPeriod: 'Q1 2026', currency: 'AED' }
            },
            elements: [
                {
                    elementId: 'p_ar_clean',
                    elementType: 'paragraph',
                    content: 'سجلت الشركة نمواً في الإيرادات بنسبة 15%، بينما تراجعت التكاليف بنسبة 4%.'
                }
            ],
            tables: []
        };

        const facts = extractFinancialFacts(doc);
        assert.equal(facts.length, 2, 'Should extract both Revenue and Costs deltas');

        const revFact = facts.find(f => f.metric.includes('الإيرادات'));
        const costFact = facts.find(f => f.metric.includes('التكاليف'));

        assert.ok(revFact, 'Must extract Arabic revenue fact');
        assert.ok(costFact, 'Must extract Arabic costs fact');

        // Metric label checks (NO English contamination)
        assert.equal(revFact.metric, 'نمو الإيرادات');
        assert.equal(/growth/i.test(revFact.metric), false, 'Must not append English "growth" to Arabic revenue metric');
        assert.equal(revFact.normalizedValue, 0.15);

        assert.equal(costFact.metric, 'تراجع التكاليف');
        assert.equal(/growth/i.test(costFact.metric), false, 'Must not append English "growth" to Arabic costs metric');
        assert.equal(costFact.normalizedValue, -0.04);
    });

    // =========================================================================
    // Defect 8: Low – Source Filename Provenance Completeness
    // =========================================================================
    await t.test('Defect 8: sourceFileName is attached to every emitted fact across all extraction paths', () => {
        const doc = {
            document: {
                documentId: 'doc-d8-prov',
                fileName: 'Contoso_Annual_2026.pdf',
                metadata: { issuer: 'Contoso Holdings', reportingPeriod: 'FY 2026', currency: 'AED' }
            },
            elements: [
                {
                    elementId: 'p_prov',
                    elementType: 'paragraph',
                    content: 'Revenue reached AED 85,000,000 in FY 2026.'
                }
            ],
            tables: [
                {
                    table_id: 'table_prov',
                    columns: [{ header: 'Metric' }, { header: 'FY 2026' }],
                    rows: [
                        { rawValues: ['Operating expenses', '50,000,000'] }
                    ]
                }
            ]
        };

        const facts = extractFinancialFacts(doc);
        assert.equal(facts.length, 2);

        for (const fact of facts) {
            assert.ok(fact.sourceFileName, 'Every fact must have sourceFileName');
            assert.equal(fact.sourceFileName, 'Contoso_Annual_2026.pdf');
        }
    });

});

