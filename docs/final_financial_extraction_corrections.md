# Final Financial Extraction Corrections

## 1. Existing Validation Logic Before Correction & Root Causes
1. **Context Blindness in `context-graph.js` & `document-layout.js`**:
   - *Root Cause*: `buildContextGraph()` only parsed `meta.documentName`, ignoring `meta.issuer`, `meta.documentTitle`, `meta.currency`, `meta.reportingPeriod`, `meta.fullMarkdown`, and `NormalizedDocumentV1` (`input.document.metadata`). Underscored filenames like `Contoso_Properties_LLC_Q1_2026_Management_Pack.pdf` failed `ORG_RE` matching.
   - *Impact*: Caused 0% entity association and missing table currencies in the Contoso Properties management pack.
2. **Point-in-Time Header Coercion in `header-reconstructor.js`**:
   - *Root Cause*: `"As of 31 March 2026"` matched `PERIOD_RE` (`2026`) and overwrote the document's `Q1 2026` period with `"2026"` while dropping `asOfDate`.
3. **Narrative Relationship & Reporting Basis Defects in `paragraph-extractor.js`**:
   - *Root Cause*: Payment verbs (`"Paid AED 260,000 of planned maintenance"`) triggered `Budget`/`Projected` classification or left `"Paid"` as the metric label; `"totalling"` remained attached to `"Rent collections"`; `"received in April"` inherited `"Q1 2026"`; `"requirement"` defaulted to `"Actual"`; `reportingScope` blindly defaulted to `'Consolidated'`.
4. **Simplified Validation & SQL Default Override in `evidence-validator.js` & `sql.js`**:
   - *Root Cause*: `evidence-validator.js` lacked structured 12-gate check outcomes and explicit reason codes, and `sql.js` defaulted missing `ValidationStatus` to `'Validated'` and `ReportingScope` to `'Consolidated'`.

## 2. Changed Files and Functions
| File | Key Changes |
|---|---|
| `src/services/financial-extraction/validation/evidence-validator.js` | Implemented `financial-validation-v1` 12-gate policy engine (`evaluateFactGates`, `determineValidationStatus`, `computeEvidenceConfidence`, `validateEvidence`), exact decimal verification, structured `checks` map, standardized reason codes, and `Rejected`/`NeedsReview`/`Validated` separation. |
| `src/services/financial-extraction/layout/document-layout.js` | Updated `normalizeDocumentStructure()` to parse `NormalizedDocumentV1` (`input.document`, `input.document.metadata`, `input.elements`) and preserve `issuer`, `documentTitle`, `reportingPeriod`, `asOfDate`, `currency`, `reportingScope`, and `fullMarkdown`. |
| `src/services/financial-extraction/context/context-graph.js` | Updated `buildContextGraph()` to extract document signals from `documentTitle`, `issuer`, space-normalized `documentName`, and `fullMarkdown` header; added `Requirement` and `Threshold` to `BASIS_RE` / `normalizeBasisLabel`; exported `AS_OF_RE`. |
| `src/services/financial-extraction/layout/header-reconstructor.js` | Updated `reconstructTableHeaders()` to extract `asOfDate` via `AS_OF_RE` and avoid overriding `Q1 2026` with bare `2026` on `"As of 31 March 2026"` headers. |
| `src/services/financial-extraction/tables/matrix-unpivoter.js` | Propagated `valCol.asOfDate || tblCtx.asOfDate || null` into extracted table facts; ensured `reportingScope` defaults to `null`. |
| `src/services/financial-extraction/narrative/paragraph-extractor.js` | Added payment-verb `Actual` classification (`Paid ... of planned maintenance`), `Requirement` basis detection, `MONTH_NAME_RE` transaction timing (`April 2026` preserved instead of `Q1 2026`), `POINT_IN_TIME_RE` (`at 31 March 2026`), and `reportingScope: paraCtx.reportingScope || null`. |
| `src/services/sql.js` | Added backward-compatible `ValidationPolicyVersion`, `ValidationChecksJson`, `ReviewReasonsJson`, `ValidatedAt` columns; changed `ValidationStatus` fallback from `'Validated'` to `'NeedsReview'`; removed `'Consolidated'` default on `ReportingScope`; enforced required-field validation guard. |

## 3. Rollback Instructions
All modifications are localized to the deterministic SAFEE pipeline (`src/services/financial-extraction/`), `src/services/sql.js` additive columns, and unit tests. To roll back:
1. Revert the 7 modified files via `git checkout -- <file>`.
2. Additive nullable columns on `dbo.FinancialFacts` (`ValidationPolicyVersion`, `ValidationChecksJson`, `ReviewReasonsJson`, `ValidatedAt`) are backward-compatible and do not require destructive DDL rollback.
