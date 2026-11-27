# Final Financial Validation Test Report

## 1. Test Execution Summary
Executed with Node.js `v22.23.4` (`node --test`):

| Test Suite | Tests | Passed | Failed | Status |
|---|---|---|---|---|
| `tests/unit/financial-facts/nlp-improvements-validation.test.js` | 3 | 3 | 0 | **Passed** |
| `tests/unit/financial-facts/safee-production-reliability.test.js` | 4 | 4 | 0 | **Passed** |
| `tests/unit/financial-facts/structured-nlp.test.js` | 5 | 5 | 0 | **Passed** |
| `tests/acceptance/wp12-acceptance.test.js` | 9 | 9 | 0 | **Passed** |
| `tests/unit/contracts/fact-integrity-schema.test.js` | 8 | 8 | 0 | **Passed** |
| `tests/unit/work-packages/wp3-effective-facts-math.test.js` | 17 | 17 | 0 | **Passed** |

*(Note: `tests/unit/contracts/golden-dataset-evaluation.test.js` references a legacy removed module `normalized-document-validator` and `tests/unit/work-packages/wp17-chat-governance.test.js` requires live `@azure/functions` runtime handler registration; both are outside the financial extraction engine changes.)*

## 2. Mandatory Validation Coverage (§24)
- **Centralized `determineValidationStatus()`**: Verified `Validated` (all mandatory applicable gates `PASS`), `Rejected` (`NON_FINANCIAL` with verified evidence), `NeedsReview` (missing entity/currency/period, empty checks, omitted mandatory check, malformed input) — **Passed**.
- **Valid Cases**: Unfamiliar metric (`Intelligent Resource Recovery Benefits`) with complete context, percentage (`18.5%`) with `null` currency (`currencyAssociation: NOT_APPLICABLE`), Actual payment (`Paid AED 260,000 of planned maintenance`), Requirement (`Minimum operating cash requirement of AED 1,500,000`), April transaction inside Q1 report (`April 2026`) — **Passed**.
- **NeedsReview Cases**: Missing entity (`ENTITY_MISSING`), missing monetary currency (`CURRENCY_MISSING`), normalization mismatch (`NUMERIC_NORMALIZATION_MISMATCH`), omitted check, execution exception fallback — **Passed**.
- **Rejected Cases**: `DocumentVersion` (`1.0`) classified as `Rejected` with `financialRelevance: FAIL` — **Passed**.
- **Governance Independence Cases**: Approved canonical metric (`Revenue`) with missing entity/currency remains `NeedsReview`; Provisional metric (`NewMetric`) with complete source evidence achieves `Validated` — **Passed**.

## 3. Known-Document Regression Results (§23)
- **Contoso Properties Management Pack (`doc-06-contoso-properties-q1-management-pack.json`)**:
  - Table observations extracted: 8/8 (`Rental revenue`, `Direct property costs`, `Net rental income`, `Operating expenses`, `Net profit`, `Closing cash`, `Minimum operating cash`, `Cash shortfall`).
  - Entity resolved: `Contoso Properties LLC` (8/8).
  - Currency resolved: `AED` (8/8).
  - Period resolved: `Q1 2026` (8/8), with `asOfDate: "31 March 2026"` on Table 2.
  - Validation status: `Validated` (8/8) — **Passed**.
- **46-Observation Controlled Regression (`safee-production-reliability.test.js`)**: 46/46 facts extracted and validated with 0 LLM tokens — **Passed**.
- **22-Fact Acceptance Fixture (`structured-nlp.test.js`)**: 22/22 facts extracted and validated — **Passed**.
