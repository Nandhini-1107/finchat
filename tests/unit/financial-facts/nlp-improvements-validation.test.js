'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { extractStructuredFinancialFacts } = require('../../../src/services/financial-extraction');
const {
    validateEvidence,
    determineValidationStatus,
    VALIDATION_POLICY_VERSION,
    MANDATORY_GATE_NAMES
} = require('../../../src/services/financial-extraction/validation/evidence-validator');

describe('Final Financial Extraction Validation Policy & Contoso Regression (nlp_imrprovements.md)', () => {

    test('1. Centralized determineValidationStatus() decision rules (Section 9 & 24)', () => {
        const allPassChecks = MANDATORY_GATE_NAMES.map(name => ({
            name,
            mandatory: true,
            applicable: name !== 'reportingScope',
            outcome: name === 'reportingScope' ? 'NOT_APPLICABLE' : 'PASS'
        }));

        // Validated when all mandatory applicable checks PASS
        assert.equal(determineValidationStatus({
            candidateClassification: 'FINANCIAL',
            classificationEvidence: { verified: false },
            checks: allPassChecks
        }), 'Validated');

        // Rejected when confirmed NON_FINANCIAL
        assert.equal(determineValidationStatus({
            candidateClassification: 'NON_FINANCIAL',
            classificationEvidence: { verified: true },
            checks: allPassChecks
        }), 'Rejected');

        // NeedsReview when any mandatory check is not PASS
        const missingEntityChecks = allPassChecks.map(c =>
            c.name === 'entityAssociation' ? { ...c, outcome: 'UNKNOWN', reasonCode: 'ENTITY_MISSING' } : c
        );
        assert.equal(determineValidationStatus({
            candidateClassification: 'FINANCIAL',
            classificationEvidence: { verified: false },
            checks: missingEntityChecks
        }), 'NeedsReview');

        // NeedsReview when checks array is empty or missing a mandatory gate
        assert.equal(determineValidationStatus({
            candidateClassification: 'FINANCIAL',
            checks: []
        }), 'NeedsReview');

        assert.equal(determineValidationStatus({
            candidateClassification: 'FINANCIAL',
            checks: allPassChecks.slice(0, 5) // Omitted mandatory checks
        }), 'NeedsReview');

        // Malformed input must never return Validated
        assert.equal(determineValidationStatus(null), 'NeedsReview');
    });

    test('2. 12-Gate Validation Engine: Valid, NeedsReview, Rejected & Governance Independence (Section 8, 10, 12, 24)', () => {
        const layout = {
            tables: [],
            paragraphs: [
                {
                    blockId: 'P1',
                    pageNumber: 1,
                    content: 'Contoso Properties LLC recorded Intelligent Resource Recovery Benefits of AED 5,240,000 in Q1 2026.'
                },
                {
                    blockId: 'P2',
                    pageNumber: 1,
                    content: 'Revenue was 5,240,000 in Q1 2026.'
                },
                {
                    blockId: 'P3',
                    pageNumber: 1,
                    content: 'Document Version: 1.0'
                },
                {
                    blockId: 'P4',
                    pageNumber: 1,
                    content: 'Net profit margin was 18.5% in Q1 2026 with headcount of 145 employees.'
                }
            ]
        };

        const facts = [
            // 1. Valid unfamiliar metric with complete context
            {
                candidateId: 'C1',
                metric: 'Intelligent Resource Recovery Benefits',
                canonicalMetric: null,
                mappingStatus: 'NewMetric', // Provisional
                entity: 'Contoso Properties LLC',
                periodLabel: 'Q1 2026',
                rawValue: '5,240,000',
                numericValue: 5240000,
                exactDecimal: '5240000',
                currency: 'AED',
                unit: 'Currency',
                scaleMultiplier: 1,
                reportingBasis: 'Actual',
                reportingScope: null,
                sourceType: 'Paragraph',
                sourceBlockId: 'P1',
                sourceLocation: 'Page 1, Paragraph P1, Sentence 1'
            },
            // 2. Incomplete observation (missing entity & currency) -> NeedsReview even if metric approved
            {
                candidateId: 'C2',
                metric: 'Revenue',
                canonicalMetric: 'Revenue',
                mappingStatus: 'Approved', // Approved metric MUST NOT override NeedsReview
                entity: null,
                periodLabel: 'Q1 2026',
                rawValue: '5,240,000',
                numericValue: 5240000,
                exactDecimal: '5240000',
                currency: null,
                unit: 'Amount',
                scaleMultiplier: 1,
                reportingBasis: 'Actual',
                reportingScope: null,
                sourceType: 'Paragraph',
                sourceBlockId: 'P2',
                sourceLocation: 'Page 1, Paragraph P2, Sentence 1'
            },
            // 3. Confirmed NonFinancial -> Rejected
            {
                candidateId: 'C3',
                candidateType: 'DocumentVersion',
                metric: 'Document Version',
                entity: 'Contoso Properties LLC',
                periodLabel: 'Q1 2026',
                rawValue: '1.0',
                numericValue: 1,
                unit: 'Count',
                reportingBasis: 'Actual',
                sourceType: 'Paragraph',
                sourceBlockId: 'P3',
                sourceLocation: 'Page 1, Paragraph P3, Sentence 1'
            },
            // 4. Valid percentage with NULL currency
            {
                candidateId: 'C4',
                metric: 'Net profit margin',
                entity: 'Contoso Properties LLC',
                periodLabel: 'Q1 2026',
                rawValue: '18.5%',
                numericValue: 18.5,
                exactDecimal: '18.5',
                currency: null,
                unit: 'Percentage',
                scaleMultiplier: 1,
                reportingBasis: 'Actual',
                sourceType: 'Paragraph',
                sourceBlockId: 'P4',
                sourceLocation: 'Page 1, Paragraph P4, Sentence 1'
            },
            // 5. Numeric normalization mismatch -> NeedsReview
            {
                candidateId: 'C5',
                metric: 'Revenue',
                entity: 'Contoso Properties LLC',
                periodLabel: 'Q1 2026',
                rawValue: '5,240,000',
                numericValue: 524000, // Wrong by 10x
                exactDecimal: '524000',
                currency: 'AED',
                unit: 'Currency',
                scaleMultiplier: 1,
                reportingBasis: 'Actual',
                sourceType: 'Paragraph',
                sourceBlockId: 'P2',
                sourceLocation: 'Page 1, Paragraph P2, Sentence 1'
            }
        ];

        const { facts: res } = validateEvidence({ facts, layout });

        // Fact 1: Provisional metric + complete source evidence -> Validated
        assert.equal(res[0].validation.policyVersion, VALIDATION_POLICY_VERSION);
        assert.equal(res[0].validationStatus, 'Validated');
        assert.equal(res[0].validation.checks.reportingScope, 'NOT_APPLICABLE');
        assert.deepEqual(res[0].reviewReasons, []);

        // Fact 2: Approved metric + missing entity & currency -> NeedsReview with explicit codes
        assert.equal(res[1].validationStatus, 'NeedsReview');
        assert.equal(res[1].validation.checks.entityAssociation, 'UNKNOWN');
        assert.equal(res[1].validation.checks.currencyAssociation, 'UNKNOWN');
        assert.ok(res[1].reviewReasons.includes('ENTITY_MISSING'));
        assert.ok(res[1].reviewReasons.includes('CURRENCY_MISSING'));

        // Fact 3: DocumentVersion -> Rejected
        assert.equal(res[2].validationStatus, 'Rejected');
        assert.equal(res[2].validation.checks.financialRelevance, 'FAIL');

        // Fact 4: Percentage with NULL currency -> Validated, currencyAssociation NOT_APPLICABLE
        assert.equal(res[3].validationStatus, 'Validated');
        assert.equal(res[3].validation.checks.currencyAssociation, 'NOT_APPLICABLE');

        // Fact 5: Normalization mismatch -> NeedsReview
        assert.equal(res[4].validationStatus, 'NeedsReview');
        assert.equal(res[4].validation.checks.numericNormalization, 'FAIL');
        assert.ok(res[4].reviewReasons.includes('NUMERIC_NORMALIZATION_MISMATCH'));
    });

    test('3. Contoso Properties Management Pack Golden Document & Narrative Rules (Section 15 & 16)', async () => {
        const docPath = path.resolve(__dirname, '../../financial-facts/golden-dataset/documents/doc-06-contoso-properties-q1-management-pack.json');
        const docPayload = JSON.parse(fs.readFileSync(docPath, 'utf8'));

        const result = await extractStructuredFinancialFacts(docPayload);
        assert.equal(result.status, 'ok');
        assert.equal(result.facts.length, 8, 'Should extract all 8 table facts from Contoso management pack');

        for (const f of result.facts) {
            assert.equal(f.entity, 'Contoso Properties LLC', `Missing entity on ${f.metric}`);
            assert.equal(f.currency, 'AED', `Missing AED currency on ${f.metric}`);
            assert.equal(f.periodLabel, 'Q1 2026', `Incorrect period on ${f.metric}`);
            assert.equal(f.validationStatus, 'Validated', `Expected Validated for ${f.metric}, got ${f.validationStatus} (${f.reviewReasons.join(', ')})`);
        }

        const closingCash = result.facts.find(f => f.metric === 'Closing cash');
        assert.ok(closingCash);
        assert.equal(closingCash.numericValue, 180000);
        assert.equal(closingCash.asOfDate, '31 March 2026');

        // Narrative scenarios from Section 16
        const narrativePayload = {
            metadata: {
                documentId: 999,
                documentName: 'Contoso_Properties_LLC_Q1_2026_Management_Pack.pdf',
                issuer: 'Contoso Properties LLC',
                reportingPeriod: 'Q1 2026',
                currency: 'AED'
            },
            paragraphs: [
                {
                    blockId: 'NP1',
                    pageNumber: 2,
                    content: 'Paid AED 260,000 of planned maintenance. Rent collections totalling AED 410,000 were received in April. Minimum operating cash requirement of AED 1,500,000. Closing cash at 31 March 2026 was AED 1,180,000.'
                }
            ]
        };

        const nRes = await extractStructuredFinancialFacts(narrativePayload);
        assert.equal(nRes.facts.length, 4, `Expected 4 narrative facts, got ${nRes.facts.length}`);

        const maint = nRes.facts.find(f => /maintenance/i.test(f.metric));
        assert.ok(maint, 'Maintenance payment should be extracted');
        assert.equal(maint.reportingBasis, 'Actual', 'Paid planned maintenance must be Actual, not Budget');
        assert.equal(maint.numericValue, 260000);
        assert.equal(maint.reportingScope, null, 'Unsupported Consolidated scope must not be defaulted');

        const rent = nRes.facts.find(f => /rent collections/i.test(f.metric));
        assert.ok(rent, 'Rent collections should be extracted');
        assert.equal(rent.numericValue, 410000);
        assert.equal(rent.periodLabel, 'April 2026', 'April transaction must not be coerced to Q1 2026');

        const reqCash = nRes.facts.find(f => /minimum operating cash requirement/i.test(f.metric));
        assert.ok(reqCash, 'Minimum operating cash requirement should be extracted');
        assert.equal(reqCash.reportingBasis, 'Requirement');
        assert.equal(reqCash.numericValue, 1500000);

        const cashClosing = nRes.facts.find(f => /closing cash/i.test(f.metric));
        assert.ok(cashClosing, 'Closing cash should be extracted');
        assert.equal(cashClosing.numericValue, 1180000);
        assert.equal(cashClosing.asOfDate, '31 March 2026');
    });

    test('4. Corrections NLP Regression: Clause-level Basis, Unaudited Exclusion, Date vs Monetary Year & Ratios (corrections_nlp.md)', async () => {
        const payload = {
            metadata: {
                documentId: 1001,
                documentName: 'VERIDION TECHNOLOGIES LLC.pdf',
                fullMarkdown: 'VERIDION TECHNOLOGIES LLC\nReporting Period: Quarter ended 30 September 2026\nDocument Status: Final management pack (unaudited)\nReporting Currency: AED'
            },
            tables: [
                {
                    tableId: 'T1',
                    pageNumber: 1,
                    caption: 'Key Ratios & Operational Metrics',
                    grid: [
                        ['Indicator', 'Value'],
                        ['Current Ratio', '2.45'],
                        ['Total Employees', '320']
                    ]
                }
            ],
            paragraphs: [
                {
                    blockId: 'P1',
                    pageNumber: 2,
                    content: 'Veridion Technologies LLC reported closing cash of AED 2,750,000 against a minimum operating cash requirement of AED 3,200,000, resulting in a cash shortfall of AED 450,000.'
                },
                {
                    blockId: 'P2',
                    pageNumber: 3,
                    content: 'Norvexa Industries incurred infrastructure modernization expenditure of EUR 850.250,50 during FY 2025. The company also reported equipment recovery benefits of EUR 125.000,75 during the same financial year.'
                },
                {
                    blockId: 'P3',
                    pageNumber: 3,
                    content: 'Veridion Technologies LLC reported administrative expenses of AED 2026 in Q3 2026. A new regional office is expected to open in February 2027.'
                }
            ]
        };

        const res = await extractStructuredFinancialFacts(payload);
        assert.equal(res.status, 'ok');

        // 1. Unaudited must never be assigned as ReportingBasis
        for (const f of res.facts) {
            assert.notEqual(f.reportingBasis, 'Unaudited');
            assert.notEqual(f.reportingBasis, 'Audited');
        }

        // 2. Ratios & counts must have null currency and Validated status
        const ratio = res.facts.find(f => f.metric === 'Current Ratio');
        assert.ok(ratio);
        assert.equal(ratio.unit, 'Ratio');
        assert.equal(ratio.currency, null);
        assert.equal(ratio.validationStatus, 'Validated');

        const emp = res.facts.find(f => f.metric === 'Total Employees');
        assert.ok(emp);
        assert.equal(emp.unit, 'Count');
        assert.equal(emp.currency, null);
        assert.equal(emp.validationStatus, 'Validated');

        // 3. Clause-level ReportingBasis: Closing Cash (Actual), Minimum Requirement (Requirement), Cash Shortfall (Actual)
        const closing = res.facts.find(f => /closing cash/i.test(f.metric));
        const req = res.facts.find(f => /requirement/i.test(f.metric));
        const shortfall = res.facts.find(f => /shortfall/i.test(f.metric));
        assert.ok(closing && req && shortfall);
        assert.equal(closing.numericValue, 2750000);
        assert.equal(closing.reportingBasis, 'Actual');
        assert.equal(req.numericValue, 3200000);
        assert.equal(req.reportingBasis, 'Requirement');
        assert.equal(shortfall.numericValue, 450000);
        assert.equal(shortfall.reportingBasis, 'Actual');

        // 4. Pronoun + relative period inheritance ("The company also reported ... during the same financial year")
        const equip = res.facts.find(f => /equipment recovery benefits/i.test(f.metric));
        assert.ok(equip);
        assert.equal(equip.entity, 'Norvexa Industries');
        assert.equal(equip.periodLabel, 'FY 2025');
        assert.equal(equip.numericValue, 125000.75);
        assert.equal(equip.currency, 'EUR');

        // 5. Monetary year "AED 2026" is extracted, whereas date "February 2027" is NOT extracted as a financial fact
        const admin = res.facts.find(f => /administrative expenses/i.test(f.metric));
        assert.ok(admin);
        assert.equal(admin.numericValue, 2026);
        assert.equal(admin.currency, 'AED');
        assert.equal(res.facts.some(f => f.numericValue === 2027), false, 'February 2027 must not be extracted as a financial fact');
    });
});
