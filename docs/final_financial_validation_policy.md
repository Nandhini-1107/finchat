# Final Financial Validation Policy (`financial-validation-v1`)

## 1. Policy Overview
The financial extraction engine separates **Candidate Extraction** from **Evidence Validation**. `ValidationStatus` is determined exclusively by source evidence and 13 deterministic validation checks (covering 12 mandatory gates + source relationship integrity), never by confidence scores, metric/entity registry approval, or document authority rank.

## 2. Validation Status Definitions
- **`Validated`**: Assigned ONLY when the candidate is a genuine financial/operational observation (`FINANCIAL` or `OPERATIONAL`), all applicable mandatory checks return `PASS`, and zero blocking ambiguity or errors exist.
- **`NeedsReview`**: Assigned when the candidate is financially relevant but one or more applicable mandatory checks return `UNKNOWN` or `FAIL`, or when any required validation gate is omitted or fails execution. Every `NeedsReview` fact carries explicit `reviewReasons` codes.
- **`Rejected`**: Assigned when the candidate is confirmed to be `NON_FINANCIAL` or `INVALID` with verified classification evidence (e.g., `DocumentVersion`, `Section`, `Page`, `ReferenceNumber`, `EstablishmentYear`, `ApprovalDate`, testing summary counts).

## 3. Explicit Check Outcomes
Every check in `validation.detailedChecks` returns:
- `PASS`: Verified against source evidence.
- `FAIL`: Confirmed violation or mismatch against source evidence.
- `UNKNOWN`: Required context or relationship cannot be established from the source.
- `NOT_APPLICABLE`: Justified strictly by the observation type (e.g. `currencyAssociation` for `Percentage`/`Ratio`/`Count`; `scaleAssociation` when `scaleMultiplier === 1`; optional `reportingScope` when unspecified).

## 4. Mandatory Validation Gates (`MANDATORY_GATE_NAMES`)
| Gate | Check Name | Mandatory | Purpose |
|---|---|---|---|
| 1 | `financialRelevance` | Yes | Distinguishes monetary amounts, percentages, ratios, and counts from metadata/version/section/reference numbers. |
| 2 | `sourceEvidence` | Yes | Verifies traceable coordinates (`sourceTableId`/row/col or `sourceBlockId`/sentence) and matching raw text in source. |
| 3 | `numericIntegrity` | Yes | Ensures the raw numeric token is independent and structurally intact (no merged/concatenated cells or corrupted digits). |
| 4 | `numericNormalization` | Yes | Independently recalculates normalized decimal value from `rawValue` and `scaleMultiplier` and compares using exact decimal arithmetic (`exactDecimalsMatch`). |
| 5 | `metricAssociation` | Yes | Confirms a valid financial/operational phrase, rejecting bare stop words, verbs, or period fragments (`in FY 2025`, `we also paid`). |
| 6 | `entityAssociation` | Yes | Confirms reporting entity is present, non-placeholder, and non-duplicated. |
| 7 | `periodAssociation` | Yes | Confirms reporting period (`periodLabel`) or transaction/as-of date (`asOfDate`) is resolved. |
| 8 | `currencyAssociation` | Yes (Monetary) | Confirms explicit or reliably inherited currency for monetary amounts; `NOT_APPLICABLE` for Percentage/Ratio/Count. |
| 9 | `unitAssociation` | Yes | Verifies valid unit classification (`Amount`, `Currency`, `Percentage`, `Ratio`, `Count`). |
| 10 | `scaleAssociation` | Yes (Scaled) | Verifies scale multiplier matches evidence and is never applied to non-monetary percentages/ratios/counts. |
| 11 | `reportingBasis` | Yes | Verifies resolved basis (`Actual`, `Budget`, `Forecast`, `Target`, `Requirement`, `Threshold`, `Estimate`, `Restated`). |
| 12 | `reportingScope` | Optional | Validates scope (`Consolidated`, `Standalone`, `Entity`, etc.) when present; `NOT_APPLICABLE` when unspecified. |
| 13 | `sourceRelationship` | Yes | Confirms coherent table row/column/header or narrative clause relationship binding metric and value. |

## 5. Centralized Decision Function
`determineValidationStatus(validationResult)` in `finchat/src/services/financial-extraction/validation/evidence-validator.js`:
1. If `candidateClassification` is `NON_FINANCIAL` or `INVALID` with `classificationEvidence.verified === true` $\rightarrow$ `Rejected`.
2. If `candidateClassification` is not `FINANCIAL`/`OPERATIONAL`, or `checks` is empty, or any gate in `MANDATORY_GATE_NAMES` is missing $\rightarrow$ `NeedsReview`.
3. If any check where `mandatory === true && applicable === true` has `outcome !== 'PASS'` $\rightarrow$ `NeedsReview`.
4. Otherwise $\rightarrow$ `Validated`.

## 6. Standardized Review Reason Codes
- `ENTITY_MISSING`, `ENTITY_TEXT_CORRUPTED`
- `CURRENCY_MISSING`
- `PERIOD_MISSING`
- `METRIC_MISSING`, `METRIC_PHRASE_INCOMPLETE`
- `NUMERIC_TOKEN_CORRUPTED`, `NUMERIC_TOKEN_MERGED`, `NUMERIC_NORMALIZATION_MISMATCH`, `SQL_PRECISION_MISMATCH`
- `UNIT_MISMATCH`, `SCALE_MISMATCH`
- `REPORTING_BASIS_AMBIGUOUS`
- `SOURCE_EVIDENCE_MISSING`, `SOURCE_EVIDENCE_INCOMPLETE`, `HEADER_RELATIONSHIP_INVALID`, `NARRATIVE_RELATIONSHIP_INVALID`
- `NON_FINANCIAL_CANDIDATE`, `VALIDATION_EXECUTION_FAILED`
