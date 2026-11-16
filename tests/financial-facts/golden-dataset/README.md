# FinChat Synthetic Golden Dataset for Financial Fact Extraction

> **IMPORTANT NOTICE:**  
> This dataset consists of **strictly controlled synthetic test documents** engineered specifically to benchmark, evaluate, and regression-test the FinChat financial fact extraction and conflict resolution engines. The evaluation results reported herein reflect performance against these synthetic benchmark documents and fixtures; they do **not** constitute proof of performance or accuracy on real-world company regulatory filings.

---

## 1. Overview & Purpose

The **Synthetic Golden Dataset** provides an authoritative, independent reference benchmark for financial fact extraction in FinChat. Designed as part of **Phase 4.2.2**, it establishes a verifiable ground truth adhering strictly to the **`ExtractedFactsV1`** contract.

The primary purposes of this dataset are:
1. **Contract Adherence**: Establish 100 manually verified expected financial facts formatted according to `ExtractedFactsV1`.
2. **Independent Ground Truth**: Ground-truth facts were manually verified directly from the synthetic source documents—never generated from or modified to accommodate existing extraction logic.
3. **Pre-Implementation Baseline**: Measure the performance (Precision, Recall, F1, and field-level accuracy) of the legacy extraction implementation (`fact-extraction.js`) before implementing Phase 4.3 extraction engine changes.
4. **Targeted Failure Diagnostics**: Uncover concrete shortcomings (e.g. entity fallback to "Consolidated", missing scale multiplication, unsupported narrative text, formula error handling) to directly guide Phase 4.3 engineering.

---

## 2. Directory Structure

```
tests/financial-facts/golden-dataset/
├── documents/                                      # 11 NormalizedDocumentV1 benchmark documents
│   ├── doc-01-contoso-retail-q1-audited.json
│   ├── doc-02-contoso-retail-q2-management-pack.json
│   ├── doc-03-contoso-logistics-q1-audited.json
│   ├── doc-04-contoso-logistics-q2-draft-v1.json
│   ├── doc-05-contoso-logistics-q2-final-v2.json
│   ├── doc-06-contoso-properties-q1-management-pack.json
│   ├── doc-07-contoso-holdings-board-pack-q1.json
│   ├── doc-08-contoso-retail-budget-fy2026.json
│   ├── doc-09-contoso-logistics-budget-fy2026.json
│   ├── doc-10-contoso-properties-budget-fy2026.json
│   └── doc-11-contoso-holdings-group-actuals-tracker.json
├── fixtures/                                       # 5 Edge case NormalizedDocumentV1 fixtures
│   ├── fixture-01-multilevel-segments.json
│   ├── fixture-02-excel-formulas-and-errors.json
│   ├── fixture-03-ratios-and-bps.json
│   ├── fixture-04-missing-metadata-and-stray.json
│   └── fixture-05-narrative-commentary-bilingual.json
├── expected-facts/                                 # 16 ExtractedFactsV1 ground-truth JSON files (100 facts)
│   ├── doc-01-expected.json                        # 9 facts
│   ├── doc-02-expected.json                        # 10 facts (includes narrative growth ratio)
│   ├── doc-03-expected.json                        # 9 facts
│   ├── doc-04-expected.json                        # 4 facts
│   ├── doc-05-expected.json                        # 4 facts
│   ├── doc-06-expected.json                        # 8 facts (5 P&L + 3 Liquidity/Shortfall)
│   ├── doc-07-expected.json                        # 12 facts (4 entities x 3 metrics, scaled x1000)
│   ├── doc-08-expected.json                        # 10 facts (Revenue & GP across 5 periods)
│   ├── doc-09-expected.json                        # 5 facts (Revenue across 5 periods)
│   ├── doc-10-expected.json                        # 5 facts (Rental revenue across 5 periods, scaled x1000)
│   ├── doc-11-expected.json                        # 10 facts (Multi-entity tracker actuals)
│   ├── fixture-01-expected.json                    # 4 facts (Multi-level segment dimensions & margins)
│   ├── fixture-02-expected.json                    # 2 facts (Cached formula value & #DIV/0! error fact)
│   ├── fixture-03-expected.json                    # 4 facts (9%, 37.5%, 180 bps, 0.0450 normalized to ratio)
│   ├── fixture-04-expected.json                    # 2 facts (Missing entity tolerated, headcount without currency)
│   └── fixture-05-expected.json                    # 2 facts (Bilingual Arabic & English narrative facts)
├── evaluation/                                     # Automated evaluation engine & results
│   ├── evaluate-extraction.js                      # Evaluator script (Precision, Recall, F1, Field accuracy)
│   └── baseline-evaluation-report.json             # Persistent evaluation report
└── README.md                                       # Dataset specification & reference guide
```

---

## 3. Benchmark Documents Matrix (86 Facts)

| Doc ID | Entity | Document Title / Type | Period | Currency & Scale | Authority & Basis | Facts | Key Characteristics & Conflict Scenarios |
| :--- | :--- | :--- | :---: | :---: | :---: | :---: | :--- |
| **Doc 1** | Contoso Retail LLC | Statement of Profit or Loss | Q1 2026 | AED (Units) | Audited (Rank 1), Actual | 9 | Authoritative audited financials; Revenue = 12,480,000 AED. |
| **Doc 2** | Contoso Retail LLC | Management Pack P&L | Q2 2026 | AED (Units) | Board/Final (Rank 2), Actual | 10 | 9 table facts + 1 narrative paragraph fact (5.0% revenue growth). |
| **Doc 3** | Contoso Logistics LLC | Statement of Profit or Loss | Q1 2026 | AED (Units) | Audited (Rank 1), Actual | 9 | Authoritative audited financials; Direct operating costs and PBT. |
| **Doc 4** | Contoso Logistics LLC | Management Pack P&L (v1 Draft) | Q2 2026 | AED (Units) | Draft (Rank 3), Actual | 4 | Preliminary draft; Revenue = 9,105,000 AED. Pre-conflict state. |
| **Doc 5** | Contoso Logistics LLC | Management Pack P&L (v2 Final) | Q2 2026 | AED (Units) | Board/Final (Rank 2), Actual | 4 | Supersedes Doc 4; Revenue = 9,350,000 AED (+245,000 final billing). |
| **Doc 6** | Contoso Properties LLC | Management Pack P&L + Liquidity | Q1 2026 | AED (Units) | Board/Final (Rank 2), Actual | 8 | Two tables: 5 P&L duration facts + 3 Balance Sheet instant facts (Cash Shortfall = 320,000 AED). |
| **Doc 7** | Contoso Holdings | Board Pack – Group Summary | Q1 2026 | AED ('000) | Board/Final (Rank 2), Actual | 12 | Scaled in thousands (12,840 = 12,840,000 AED). Stated Retail revenue (12.84M) conflicts with Audited (12.48M). |
| **Doc 8** | Contoso Retail LLC | Budget FY2026 | Q1-Q4 & FY2026 | AED (Units) | Approved (Rank 2), Budget | 10 | 5-quarter matrix for Revenue & Gross Profit. Non-conflict with Actuals (`reportingBasis: 'Budget'`). |
| **Doc 9** | Contoso Logistics LLC | Budget FY2026 | Q1-Q4 & FY2026 | AED (Units) | Approved (Rank 2), Budget | 5 | 5-quarter matrix for Logistics Revenue across Q1-Q4 and full year. |
| **Doc 10** | Contoso Properties LLC | Budget FY2026 | Q1-Q4 & FY2026 | AED ('000) | Approved (Rank 2), Budget | 5 | Scaled in thousands (5,100 = 5,100,000 AED). Rental revenue matrix. |
| **Doc 11** | Contoso Holdings | Group Actuals Tracker 2026 | Q1 & Q2 2026 | AED (Units) | Working File (Rank 3), Actual | 10 | Multi-entity records table. Holds stale Logistics Q2 draft data (9,105,000 AED). |

---

## 4. Edge Case Fixtures Matrix (14 Facts)

| Fixture ID | Fixture Name | Category Tested | Facts | Target Behaviors Evaluated |
| :--- | :--- | :--- | :---: | :--- |
| **Fixture 1** | `fixture-01-multilevel-segments` | Multi-level headers & segments | 4 | 2-level headers (`Retail Outlets / UAE`, `E-Commerce / UAE`). Captures segment dimensions (`dimensions: { channel, geography }`) and percentage margins. |
| **Fixture 2** | `fixture-02-excel-formulas-and-errors` | Formulas & cell error types | 2 | Evaluates formula cell (`=C2*0.15` using cached value `15000`) and captures formula division error (`=D3/E3` resulting in `#DIV/0!`, `expectedValidationStatus: 'error'`). |
| **Fixture 3** | `fixture-03-ratios-and-bps` | Ratios, percentages, basis points | 4 | Verifies ratio canonicalization: `9%` → `0.09000000`, `37.5%` → `0.37500000`, `180 bps` → `0.01800000`, and `0.0450` → `0.04500000` with `normalizedUnit: 'ratio'` and `currency: null`. |
| **Fixture 4** | `fixture-04-missing-metadata-and-stray` | Missing metadata & stray noise | 2 | Missing entity tolerated (`entityLabel: null`); headcount metric without currency (`normalizedUnit: 'headcount'`, `currency: null`); unanchored stray number `50,000` correctly excluded as non-fact. |
| **Fixture 5** | `fixture-05-narrative-commentary-bilingual` | Bilingual narrative commentary | 2 | Arabic narrative statement ("بلغت الإيرادات المجمعة 34.5 مليون درهم") → 34,500,000 AED; English narrative statement ("Operating expenses increased by AED 450,000") → 450,000 AED. |

---

## 5. ExtractedFactsV1 Schema Adherence

Every expected fact is explicitly structured in accordance with `ExtractedFactsV1`:

```json
{
  "factId": "doc-01_fact_1",
  "metricLabel": "Revenue",
  "entityLabel": "Contoso Retail LLC",
  "periodLabel": "Q1 2026",
  "temporalType": "duration",
  "periodStart": "2026-01-01",
  "periodEnd": "2026-03-31",
  "asOfDate": "2026-04-28",
  "reportingBasis": "Actual",
  "reportingScope": "Entity",
  "dimensions": {},
  "rawValue": 12480000,
  "originalTextValue": "12,480,000",
  "normalizedValue": "12480000.00000000",
  "originalUnit": "amount",
  "normalizedUnit": "amount",
  "currency": "AED",
  "sourceFileName": "Contoso_Retail_LLC_Q1_2026_Audited.pdf",
  "sourceLocation": "Table doc-01_table_1, Row 1, Col 1",
  "expectedValidationStatus": "valid"
}
```

Key contract invariants enforced:
- **`normalizedValue`**: High-precision string formatted to 8 decimal places (e.g. `"12480000.00000000"` or `"-7862400.00000000"`). Null for uncomputable formula errors.
- **`normalizedUnit`**: Canonical units: `"amount"`, `"ratio"`, `"headcount"`.
- **Conditional Currency**: Required for monetary facts (`"AED"`); strictly `null` for ratios, percentages, basis points, and headcounts.
- **Temporal Semantics**: Distinguishes duration facts (`periodStart` + `periodEnd`) from instant balance sheet facts (`temporalType: "instant"`, `asOfDate`).

---

## 6. Baseline Evaluation Results (Existing Extractor)

The evaluation script (`tests/financial-facts/golden-dataset/evaluation/evaluate-extraction.js`) was executed against the existing `fact-extraction.js` implementation:

```
=============================================================
FinChat Extraction Baseline Evaluation Report (Phase 4.2.2)
=============================================================
Total Expected Facts: 100
Total Extracted Facts: 97
True Positives:        80
False Positives:       17
False Negatives:       20
Precision:             82.47%
Recall:                80.00%
F1-Score:              81.22%

--- Field-Level Accuracy Across Matched Facts ---
Metric Accuracy:       100.00%
Entity Accuracy:        23.91%
Period Accuracy:        83.70%
Value Accuracy:         80.43%
Unit Accuracy:          94.57%
Currency Accuracy:      94.57%
```

### Discrepancy Breakdown by Failure Mode

1. **Entity Mismatch / Fallback (`70` occurrences)**:
   - *Root Cause*: The existing extractor defaults the entity to `"Consolidated"` unless the top-left cell of the first table raw grid matches a regex. It ignores document-level metadata (`document.metadata.issuer`) and table row headers.
2. **Value Mismatch / Scaling (`18` occurrences)**:
   - *Root Cause*: Documents with table or banner scaling (Doc 7 Board Pack and Doc 10 Properties Budget are in "AED thousands") have raw values extracted literally (`12840` instead of `12,840,000`, `5100` instead of `5,100,000`).
3. **Missed Extractions / False Negatives (`8` occurrences)**:
   - *Root Cause*: Narrative commentary (Doc 2 revenue growth paragraph, Fixture 5 Arabic and English paragraphs) is completely ignored because `fact-extraction.js` only consumes `tables`. Formula error cells (`#DIV/0!`) are discarded.
4. **Spurious Extractions / False Positives (`5` occurrences)**:
   - *Root Cause*: Footnote rows or note numbers (e.g. Fixture 4 stray `50,000`) are improperly parsed as financial line items.
5. **Unit Normalization Gap (`5` occurrences)**:
   - *Root Cause*: Percentages and basis points are not normalized to canonical decimal ratios (e.g. `180 bps` not converted to `0.01800000`).

---

## 7. Running the Evaluation and Tests

To run the automated evaluation script directly:
```bash
node tests/financial-facts/golden-dataset/evaluation/evaluate-extraction.js
```

To execute the Node.js native test suite:
```bash
node --test tests/golden-dataset-evaluation.test.js
```

To run all FinChat project test suites:
```bash
node --test tests/*.test.js
```

