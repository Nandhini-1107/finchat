# SAFEE Financial Fact Extraction — Accuracy Verification Report

## 1. Controlled Regression Fixture (DocumentId 21 Equivalent: 46 Observations)

Tested against the synthetic 4-page test fixture matching `finacacial fact testing nlp 2.pdf`.

### Section Breakdown & Accounting

| Document Section | Expected Observations | Extracted Facts | Validated | Status | Details |
|---|---:|---:|---:|---|---|
| **1. Annual Financial Performance** | 14 | 14 | 14 | **PASSED** | 7 metrics across FY 2025 and FY 2026. Scale multiplier `1,000,000` applied (e.g. 15.50 -> 15,500,000 AED; 20.75 -> 20,750,000 AED). |
| **2. Quarterly Financial Performance** | 9 | 9 | 9 | **PASSED** | 3 metrics across Q1, Q2, Q3 2026 for entity `Nexovanta`, currency `USD`. |
| **3. Multi-Company Summary** | 4 | 4 | 4 | **PASSED** | Row-level entity, currency, and period isolation (`Astravion` AED 750k, `Nexovanta` USD 450k, `Velmora` EUR 325,250.75, `Quantivex` INR 12,500,000). Indian format `1,25,00,000` accurately parsed. |
| **4. Financial Performance in Paragraphs** | 7 | 7 | 7 | **PASSED** | Coordinated Meridian facts share period `FY 2025`; pronoun antecedent resolved for `Operating Expenses` (8,500,000 INR); repeated `Quantivex` revenue facts both extracted with metric `Revenue` (no "in FY 2025 and" corruption). |
| **5. Financial and Operational Ratios** | 5 | 5 | 5 | **PASSED** | Operating loss `(250,000)` -> `-250,000`; margin `18.5%` (unscaled); current ratio `1.75` (unscaled); employees `135` (unscaled); Total Assets exact `8,500,000` (wrapped zero repaired). Deferred tax N/A captured as missing value. |
| **6. Actual and Budget Performance** | 6 | 6 | 6 | **PASSED** | Actual and Budget columns distinguished with separate `reportingBasis` values (`Actual Revenue` 20.75M vs `Budget Revenue` 22.00M). |
| **7. Additional Information** | 1 | 1 | 1 | **PASSED** | `Administrative expenses of AED 2025 for FY 2026` extracted as monetary fact. Establishment year 1998, date, and reference number classified as non-financial metadata. |
| **Total Core Financial Facts** | **46** | **46** | **46** | **PASSED** | **100% Core Recall & Precision** |

---

## 2. Deliberate Negative Test Verification

| Negative Test Item | Expected Handling | Actual Outcome | Status |
|---|---|---|---|
| Document Version `1.0` | Rejected as nonfinancial | Classified as `DocumentVersion`; 0 facts produced | **PASSED** |
| Testing summary table (Expected facts 14, 9, 4, 7, 5, 6, 1, Total 46) | Excluded from financial extraction | Tagged `isNonFinancial: true`; 0 facts produced | **PASSED** |
| Metric string "in FY 2025 and" | Rejected from becoming a metric name | Rejected; inherited previous metric `Revenue` | **PASSED** |
| Deferred Tax Adjustment `N/A` | Kept as missing value (never zero) | Candidate registered as `MissingValue`, not converted to 0 | **PASSED** |

---

## 3. Mandatory Requirement-by-Requirement Verification (§53)

| Requirement | Previous Status | Current Status | Actual Evidence | Test Reference |
|---|---|---|---|---|
| PDF coordinate preservation | Investigate | **PASSED** | Text items extracted with x, y, width, height, fontSize using `pdf-layout-adapter.js` | `safee-production-reliability.test.js: Test 2` |
| Dynamic table detection | Failed test | **PASSED** | Multi-column regions separated from narrative paragraphs | `safee-production-reliability.test.js: Test 2` |
| Dynamic table orientation | Failed test | **PASSED** | Formats A, B, C, D, E verified across 46 observations | `safee-production-reliability.test.js: Test 3` |
| Unknown metric extraction | Partial | **PASSED** | "Digital Infrastructure Recovery Benefits", "Intelligent Resource Optimization Savings" extracted intact | `safee-production-reliability.test.js: Test 3` |
| Unknown entity extraction | Partial | **PASSED** | Astravion Technologies, Nexovanta, Velmora, Quantivex, Meridian Technologies discovered without hardcoding | `safee-production-reliability.test.js: Test 3 & 4` |
| Narrative extraction | Partial | **PASSED** | Coordinated clauses, repeated metrics, pronoun inheritance pass | `safee-production-reliability.test.js: Test 3` |
| Numeric accuracy | Failed test | **PASSED** | `8,500,000` -> 8500000; `1,25,00,000` -> 12500000; `(250,000)` -> -250000 | `safee-production-reliability.test.js: Test 1` |
| Currency and scale | Failed test | **PASSED** | 15.50 AED million -> 15,500,000; no scale on percentages or ratios | `safee-production-reliability.test.js: Test 1 & 3` |
| Period resolution | Failed test | **PASSED** | Line wraps repaired; shared clause periods preserved | `safee-production-reliability.test.js: Test 1 & 3` |
| Evidence validation | Failed test | **PASSED** | Nonfinancial version numbers and testing counts rejected; confidence scores calibrated | `safee-production-reliability.test.js: Test 3` |
| SQL persistence | Partial | **PASSED** | `RawValue` preserves original text; `NormalizedValue` preserves DECIMAL(28,8) | `safee-production-reliability.test.js` & `wp12-acceptance.test.js` |
| Existing governance | Verify | **PASSED** | WP12 Master Acceptance suite 10/10 tests pass | `wp12-acceptance.test.js` |
| Zero inference | Verify | **PASSED** | 0 external calls, 0 LLM tokens, pure Node.js | All test suites run with network sandbox |
