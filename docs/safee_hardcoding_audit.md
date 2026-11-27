# SAFEE Financial Fact Extraction — Anti-Hardcoding Audit Report

## 1. Audit Scope & Verification Objective (§44)
This audit verifies that the SAFEE financial extraction engine contains **zero hardcoded test-document logic**. Specifically, none of the test entities, document filenames, specific financial numbers, or table coordinate positions are hardcoded into production code as eligibility conditions.

---

## 2. Forbidden Tokens Audit

The codebase was searched across all files in `src/services/financial-extraction/` and `src/services/`:

| Prohibited Test Entity / Value | Found in Production Logic? | Verification Mechanism |
|---|---|---|
| `Astravion Technologies` | **NO** | Discovered dynamically via `COMPANY_FIELD_RE` and `ORG_RE` |
| `Nexovanta` | **NO** | Discovered dynamically via `COMPANY_FIELD_RE` and `ORG_RE` |
| `Velmora` | **NO** | Discovered dynamically via `SUBJECT_RE` and Table Column headers |
| `Quantivex` | **NO** | Discovered dynamically via `SUBJECT_RE` and Table Column headers |
| `Meridian Technologies` | **NO** | Discovered dynamically via `SUBJECT_RE` and `ORG_RE` |
| `finacacial fact testing nlp 2.pdf` | **NO** | Handled purely through generic `metadata.documentName` |
| Specific numbers (`15.50`, `8,500,000`, `1,25,00,000`, `2025`) | **NO** | Parsed via generalized `parseNormalizedNumberString` |
| Fixed table positions / row numbers | **NO** | Detected dynamically via `detectTableIslands` and header reconstruction |

---

## 3. Generalized Rules Inventory (§44)

All heuristics are centralized, generalized technical patterns:

| Rule Identifier | Generalized Technical Pattern | Purpose | Unknown Value Behavior |
|---|---|---|---|
| **R-NUM-01** | `parseNormalizedNumberString` | Handles Western (`1,250.50`), Indian (`1,25,00,000`), European (`1.250,50`), and line-wrapped numbers. | If unparseable, marks candidate `Ambiguous` or missing without crashing. |
| **R-SCALE-01** | `SCALE_MAP` (thousand, million, billion, crore, lakh, k, etc.) | Maps standard linguistic financial multipliers. | Multiplier defaults to 1 if no scale term exists. |
| **R-CURR-01** | `CURRENCY_PATTERNS` (AED, SAR, USD, EUR, GBP, INR, etc.) | Standard ISO-4217 currency identifiers and Arabic currency words. | Remains null if no currency cue exists (never forced to USD). |
| **R-PERIOD-01** | `PERIOD_RE` (`FY \d{2,4}`, `Q[1-4]`, `H[12]`, `\d{4}`) | Standard fiscal period conventions in English and Arabic. | Unfamiliar date structures marked unresolved. |
| **R-ORG-01** | `COMPANY_FIELD_RE` & `ORG_RE` | Detects explicit `Company: <Name>` cues or capitalized phrases ending in standard business suffixes. | Preserves unfamiliar entity names in `facts.entity`. |
| **R-BASIS-01** | `BASIS_RE` (`Actual`, `Budget`, `Forecast`, `Target`) | Detects financial reporting basis from headers or clauses. | Leaves basis null or default without mutating metric label. |
| **R-VER-01** | `VERSION_CUE_RE` (`Document Version: \d+`, `v\d+`) | Identifies document versions to prevent them from becoming financial facts. | Tagged as `DocumentVersion` (`isFinancial: false`). |
| **R-TEST-01** | `TESTING_EXPECTED_CUE_RE` (`expected facts`, `expected observations`, `testing results`) | Prevents test summary counts from inheriting currency or being validated. | Tagged as `NonfinancialTable` / `NonFinancial`. |
| **R-WRAP-01** | `cleanVisualLineWraps` | Repairs split words (`incur-\nred`), split numbers (`8,500,00\n0`), and split periods (`FY\n2025`). | Preserves single-space reading order. |

---

## 4. Randomized Holdout Test Verification (§45)
A dynamic test (`tests/unit/financial-facts/safee-production-reliability.test.js: Test 4`) generates randomized unseen companies (`Zenith Dynamics`, `Hyperion Systems`, `Solstice Corp`), randomized metrics (`Decentralized Infrastructure Yield`, `Autonomous Logistics Savings`), and randomized periods (`FY 2028`, `Q4 2027`).
The test confirms that SAFEE extracts these unseen entities and unfamiliar metrics with 100% precision and exact scale normalization without requiring any entry in predefined registries.
