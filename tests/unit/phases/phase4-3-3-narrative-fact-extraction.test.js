// tests/phase4-3-3-narrative-fact-extraction.test.js
// Purpose: Dedicated test suite verifying all 10 required scenarios for Phase 4.3.3:
// Dynamic Narrative Financial Fact Extraction (Deterministic + Hybrid LLM).

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    extractFinancialFacts,
    extractFinancialFactsHybrid,
    extractNarrativeFinancialFacts,
    extractDocumentContext
} = require('../../../src/services/fact-extraction');
const { validateExtractedFactsEnvelope } = require('../../../src/services/extracted-facts-validator');
const { serializeExpectedFactsToContractEnvelope } = require('../../../contracts/extracted-facts');

test('Phase 4.3.3: Dynamic Narrative Financial Fact Extraction Suite', async (t) => {

    await t.test('1. English Financial Paragraph Extraction: Extracts growth & monetary facts from prose', () => {
        const doc = {
            document: {
                documentId: 'doc-eng-narrative',
                fileName: 'doc_eng.pdf',
                metadata: {
                    issuer: 'Contoso Retail LLC',
                    reportingPeriod: 'Q2 2026',
                    periodStart: '2026-04-01',
                    periodEnd: '2026-06-30',
                    asOfDate: '2026-07-15',
                    reportingBasis: 'Actual',
                    reportingScope: 'Entity',
                    currency: 'AED'
                }
            },
            elements: [
                {
                    elementId: 'para_1',
                    elementType: 'paragraph',
                    content: 'Revenue grew 5.0% on Q1, driven by opening 2 new outlets in Dubai and strong e-commerce sales.'
                },
                {
                    elementId: 'para_2',
                    elementType: 'paragraph',
                    content: 'Total cash stood at $15.2 million as of June 30, 2026.'
                }
            ],
            tables: []
        };

        const facts = extractFinancialFacts(doc);
        assert.equal(facts.length, 2);

        // Fact 1: Percentage growth
        const fact1 = facts.find(f => f.metric === 'Revenue growth');
        assert.ok(fact1, 'Must extract Revenue growth');
        assert.equal(fact1.entity, 'Contoso Retail LLC');
        assert.equal(fact1.periodLabel, 'Q2 2026');
        assert.equal(fact1.temporalType, 'duration');
        assert.equal(fact1.rawValue, 0.05);
        assert.equal(fact1.originalTextValue, '5.0%');
        assert.equal(fact1.normalizedValue, 0.05);
        assert.equal(fact1.normalizedUnit, 'ratio');
        assert.equal(fact1.currency, null);
        assert.equal(fact1.sourceLocation, 'Paragraph para_1');
        assert.equal(fact1.extractionMethod, 'NarrativeParser');

        // Fact 2: Monetary amount with currency and scale
        const fact2 = facts.find(f => f.metric === 'Total cash');
        assert.ok(fact2, 'Must extract Total cash');
        assert.equal(fact2.entity, 'Contoso Retail LLC');
        assert.equal(fact2.normalizedValue, 15200000);
        assert.equal(fact2.normalizedUnit, 'amount');
        assert.equal(fact2.currency, 'USD');
        assert.equal(fact2.sourceLocation, 'Paragraph para_2');
    });

    await t.test('2. Arabic Financial Paragraph Extraction: Extracts Arabic announcements and changes', () => {
        const doc = {
            document: {
                documentId: 'doc-arabic-narrative',
                metadata: {
                    issuer: 'Contoso Holdings',
                    reportingPeriod: 'Q1 2026',
                    periodStart: '2026-01-01',
                    periodEnd: '2026-03-31',
                    asOfDate: '2026-05-05',
                    reportingBasis: 'Actual',
                    reportingScope: 'Consolidated',
                    currency: 'AED'
                }
            },
            elements: [
                {
                    elementId: 'para_ar_1',
                    elementType: 'paragraph',
                    content: 'حققت الشركة إيرادات مجمعة قدرها 34.5 مليون درهم خلال الربع الأول من عام 2026 مقارنة بالربع السابق.'
                },
                {
                    elementId: 'para_ar_2',
                    elementType: 'paragraph',
                    content: 'ارتفعت المصاريف التشغيلية بمقدار 450 ألف درهم خلال الربع الأول.'
                }
            ],
            tables: []
        };

        const facts = extractFinancialFacts(doc);
        assert.equal(facts.length, 2);

        // Arabic Fact 1: Announcement
        const fact1 = facts.find(f => f.metric === 'إيرادات مجمعة');
        assert.ok(fact1, 'Must extract إيرادات مجمعة');
        assert.equal(fact1.entity, 'Contoso Holdings');
        assert.equal(fact1.reportingScope, 'Consolidated');
        assert.equal(fact1.periodLabel, 'Q1 2026');
        assert.equal(fact1.temporalType, 'duration');
        assert.equal(fact1.rawValue, 34500000);
        assert.equal(fact1.originalTextValue, '34.5 مليون درهم');
        assert.equal(fact1.normalizedValue, 34500000);
        assert.equal(fact1.normalizedUnit, 'amount');
        assert.equal(fact1.currency, 'AED');
        assert.equal(fact1.sourceLocation, 'Paragraph para_ar_1');

        // Arabic Fact 2: Change
        const fact2 = facts.find(f => f.metric === 'المصاريف التشغيلية');
        assert.ok(fact2, 'Must extract المصاريف التشغيلية');
        assert.equal(fact2.entity, 'Contoso Holdings');
        assert.equal(fact2.normalizedValue, 450000);
        assert.equal(fact2.normalizedUnit, 'amount');
        assert.equal(fact2.currency, 'AED');
        assert.equal(fact2.sourceLocation, 'Paragraph para_ar_2');
    });

    await t.test('3. Bilingual Commentary Extraction: Handles mixed Arabic and English in single document', () => {
        const doc = {
            document: {
                documentId: 'doc-bilingual',
                metadata: {
                    issuer: 'Contoso Holdings',
                    reportingPeriod: 'Q1 2026',
                    currency: 'AED'
                }
            },
            elements: [
                {
                    elementId: 'bilingual_1',
                    elementType: 'paragraph',
                    content: 'حققت الشركة إيرادات مجمعة قدرها 34.5 مليون درهم خلال الربع الأول من عام 2026 مقارنة بالربع السابق.'
                },
                {
                    elementId: 'bilingual_2',
                    elementType: 'paragraph',
                    content: 'Operating expenses increased by AED 450,000 due to marketing campaigns in Q1 2026.'
                }
            ],
            tables: []
        };

        const facts = extractFinancialFacts(doc);
        assert.equal(facts.length, 2);

        const arFact = facts.find(f => f.metric === 'إيرادات مجمعة');
        const enFact = facts.find(f => f.metric === 'Operating expenses');

        assert.ok(arFact, 'Arabic fact extracted cleanly');
        assert.ok(enFact, 'English fact extracted cleanly');
        assert.equal(arFact.normalizedValue, 34500000);
        assert.equal(enFact.normalizedValue, 450000);
        assert.equal(arFact.currency, 'AED');
        assert.equal(enFact.currency, 'AED');
    });

    await t.test('4. Multi-Fact Paragraphs: Extracts multiple distinct financial facts from linked clauses', () => {
        const doc = {
            document: {
                documentId: 'doc-multifact',
                metadata: {
                    issuer: 'Contoso Retail LLC',
                    reportingPeriod: 'FY 2025',
                    currency: 'USD'
                }
            },
            elements: [
                {
                    elementId: 'multi_para_1',
                    elementType: 'paragraph',
                    content: 'Total revenue was $100 million and Net profit reached $15 million in FY 2025.'
                }
            ],
            tables: []
        };

        const facts = extractFinancialFacts(doc);
        assert.equal(facts.length, 2);

        const revFact = facts.find(f => f.metric === 'Total revenue');
        const profitFact = facts.find(f => f.metric === 'Net profit');

        assert.ok(revFact, 'Extracted Total revenue');
        assert.ok(profitFact, 'Extracted Net profit');
        assert.equal(revFact.normalizedValue, 100000000);
        assert.equal(profitFact.normalizedValue, 15000000);
        assert.equal(revFact.currency, 'USD');
        assert.equal(profitFact.currency, 'USD');
    });

    await t.test('5. Date/Year and Unrelated Count Rejection: Never extracts standalone years, page numbers, or store counts', () => {
        const doc = {
            document: {
                documentId: 'doc-rejections',
                metadata: {
                    issuer: 'Contoso Retail LLC',
                    reportingPeriod: 'Q2 2026',
                    currency: 'AED'
                }
            },
            elements: [
                {
                    elementId: 'rej_1',
                    elementType: 'paragraph',
                    content: 'During 2026, the company opened 5 new stores across 2 regions and expanded to 12 outlets.'
                },
                {
                    elementId: 'rej_2',
                    elementType: 'paragraph',
                    content: 'Refer to page 14 and section 3 of note 8 for additional governance disclosures.'
                }
            ],
            tables: []
        };

        const facts = extractFinancialFacts(doc);
        assert.equal(facts.length, 0, 'Must extract ZERO facts from non-financial numbers, dates, and store counts');
    });

    await t.test('6. Table-Paragraph Deduplication: Suppresses narrative duplicate when audited table already contains the fact', () => {
        const doc = {
            document: {
                documentId: 'doc-dedup',
                metadata: {
                    issuer: 'Contoso Retail LLC',
                    reportingPeriod: 'Q2 2026',
                    currency: 'AED'
                }
            },
            tables: [
                {
                    table_id: 't_audit',
                    title: 'Audited Financial Results',
                    header_row_index: 0,
                    headers: ['Line Item', 'Q2 2026'],
                    rows: [
                        { rowIndex: 1, rawValues: ['Revenue', '1,467,739'] }
                    ]
                }
            ],
            elements: [
                {
                    elementId: 'commentary_para',
                    elementType: 'paragraph',
                    content: 'Revenue was 1,467,739 AED for Q2 2026, meeting internal expectations.'
                },
                {
                    elementId: 'growth_para',
                    elementType: 'paragraph',
                    content: 'Revenue grew 5.0% on Q1, driven by opening 2 new outlets in Dubai.'
                }
            ]
        };

        const facts = extractFinancialFacts(doc);
        // Table gives Revenue (1,467,739)
        // Commentary repeats Revenue (1,467,739) -> DEDUPLICATED
        // Commentary adds Revenue growth (5.0%) -> RETAINED
        assert.equal(facts.length, 2, 'Should have exactly 2 facts: 1 from table, 1 unique growth fact from narrative');

        const tableFact = facts.find(f => f.sourceLocation.startsWith('Table'));
        const growthFact = facts.find(f => f.sourceLocation.startsWith('Paragraph'));

        assert.ok(tableFact, 'Table fact retained');
        assert.equal(tableFact.metric, 'Revenue');
        assert.equal(tableFact.normalizedValue, 1467739);

        assert.ok(growthFact, 'Growth fact retained');
        assert.equal(growthFact.metric, 'Revenue growth');
        assert.equal(growthFact.normalizedValue, 0.05);
    });

    await t.test('7. Unsupported Claims Rejection: Non-financial commentary extracts zero facts', () => {
        const doc = {
            document: {
                documentId: 'doc-claims',
                metadata: {
                    issuer: 'Contoso Holdings',
                    reportingPeriod: 'Q1 2026',
                    currency: 'AED'
                }
            },
            elements: [
                {
                    elementId: 'unsupported_1',
                    elementType: 'paragraph',
                    content: 'Management expects market conditions to improve significantly over the coming periods with unprecedented customer satisfaction.'
                },
                {
                    elementId: 'unsupported_2',
                    elementType: 'paragraph',
                    content: 'Our team continues to lead the industry in brand engagement and environmental sustainability.'
                }
            ],
            tables: []
        };

        const facts = extractFinancialFacts(doc);
        assert.equal(facts.length, 0, 'Qualitative statements without financial metrics/values extract zero facts');
    });

    await t.test('8. Contextual Period and Entity Resolution: Attributes named entity and quarter correctly', () => {
        const doc = {
            document: {
                documentId: 'doc-entity-period',
                metadata: {
                    issuer: 'Contoso Holdings',
                    reportingPeriod: 'Q1 2026',
                    currency: 'AED'
                }
            },
            elements: [
                {
                    elementId: 'entity_para',
                    elementType: 'paragraph',
                    content: 'Contoso Logistics LLC recorded Net profit of AED 5,000,000 during Q3 2026.'
                }
            ],
            tables: []
        };

        const facts = extractFinancialFacts(doc);
        assert.equal(facts.length, 1);

        const fact = facts[0];
        assert.equal(fact.entity, 'Contoso Logistics LLC', 'Dynamically resolved specific entity named in narrative');
        assert.equal(fact.periodLabel, 'Q3 2026', 'Dynamically resolved period specified in narrative');
        assert.equal(fact.normalizedValue, 5000000);
        assert.equal(fact.currency, 'AED');
    });

    await t.test('9. Ambiguous Narrative Handling: Rejects ranges and speculative estimates lacking exact financial values', () => {
        const doc = {
            document: {
                documentId: 'doc-ambiguous',
                metadata: {
                    issuer: 'Contoso Holdings',
                    reportingPeriod: 'Q1 2026',
                    currency: 'AED'
                }
            },
            elements: [
                {
                    elementId: 'amb_1',
                    elementType: 'paragraph',
                    content: 'Revenue might fluctuate between several thousand and many millions depending on external trends.'
                }
            ],
            tables: []
        };

        const facts = extractFinancialFacts(doc);
        assert.equal(facts.length, 0, 'Vague expressions without exact numbers yield 0 facts');
    });

    await t.test('10. Hybrid LLM Routing and Fallback: Validates routing, anti-hallucination, ExtractedFactsV1 schema, and graceful fallback', async () => {
        const doc = {
            document: {
                documentId: 'doc-hybrid-test',
                metadata: {
                    issuer: 'Contoso Holdings',
                    reportingPeriod: 'Q1 2026',
                    currency: 'AED'
                }
            },
            elements: [
                {
                    elementId: 'p_easy',
                    elementType: 'paragraph',
                    content: 'Revenue was AED 10,000,000 in Q1 2026.' // Deterministic should handle this
                },
                {
                    elementId: 'p_complex',
                    elementType: 'paragraph',
                    content: 'Following strategic re-alignment across enterprise accounts, the run-rate for SaaS subscriptions of AED 2,500,000 represents our primary expansion vector.' // Complex narrative routed to LLM
                }
            ],
            tables: []
        };

        // Test 10a: Deterministic-only mode (useLLM: false)
        const detFacts = await extractFinancialFactsHybrid(doc, { useLLM: false });
        assert.equal(detFacts.stats.extractionMethod, 'DeterministicOnly');
        assert.equal(detFacts.length, 1, 'Deterministic only extracts high-confidence fact');
        assert.equal(detFacts[0].metric, 'Revenue');

        // Test 10b: Hybrid mode with Mock LLM
        let llmCalled = false;
        const mockChatCompletion = async ({ messages, jobId }) => {
            llmCalled = true;
            return {
                text: JSON.stringify({
                    facts: [
                        {
                            paragraphId: 'Paragraph p_complex',
                            metric: 'SaaS ARR',
                            entity: 'Contoso Holdings',
                            periodLabel: 'Q1 2026',
                            temporalType: 'instant',
                            reportingBasis: 'Actual',
                            reportingScope: 'Consolidated',
                            rawValue: 2500000,
                            originalTextValue: 'AED 2,500,000',
                            originalUnit: 'amount',
                            normalizedUnit: 'amount',
                            currency: 'AED'
                        },
                        {
                            // Hallucination attempt: $999,999 is NOT in the source text!
                            paragraphId: 'Paragraph p_complex',
                            metric: 'Hallucinated Margin',
                            rawValue: 999999,
                            originalTextValue: '$999,999',
                            currency: 'USD'
                        }
                    ]
                }),
                usage: { inputTokens: 120, outputTokens: 60, totalTokens: 180 }
            };
        };

        const hybridFacts = await extractFinancialFactsHybrid(doc, {
            useLLM: true,
            chatCompletion: mockChatCompletion
        });

        assert.ok(llmCalled, 'LLM was routed candidate complex paragraph');
        assert.equal(hybridFacts.length, 2, 'Should have deterministic fact + valid LLM fact (hallucination rejected)');
        assert.equal(hybridFacts.stats.hallucinationsRejected, 1, 'Anti-hallucination gate rejected fabricated figure');
        assert.ok(hybridFacts.stats.latencyMs >= 0);
        assert.equal(hybridFacts.stats.tokens.total, 180);
        assert.ok(hybridFacts.stats.estimatedCostUSD > 0);

        const llmFact = hybridFacts.find(f => f.metric === 'SaaS ARR');
        assert.ok(llmFact, 'Valid LLM fact included');
        assert.equal(llmFact.extractionMethod, 'LLM-Assisted');
        assert.equal(llmFact.normalizedValue, 2500000);
        assert.equal(llmFact.currency, 'AED');

        // Test 10c: Graceful fallback when LLM throws error
        const failingChatCompletion = async () => {
            throw new Error('Connection refused (offline test environment)');
        };

        const fallbackFacts = await extractFinancialFactsHybrid(doc, {
            useLLM: true,
            chatCompletion: failingChatCompletion
        });

        assert.equal(fallbackFacts.length, 1, 'Falls back to deterministic fact without throwing');
        assert.equal(fallbackFacts[0].metric, 'Revenue');
    });
});
