# SAFEE — Structure-Aware Financial Extraction Engine (`structured_nlp`) Implementation Report

## 1. Executive Summary
Implemented **SAFEE (Structure-Aware Financial Extraction Engine)** entirely within the existing Node.js Azure Functions application (`finchat/`) under `FINANCIAL_EXTRACTION_PROVIDER=structured_nlp`.

**Key Guarantees Verified:**
- **External inference calls:** `0`
- **LLM token consumption:** `0`
- **Python / Ollama dependency:** None (runs cleanly with Ollama and Python stopped)
- **Existing `legacy` flow:** 100% preserved and remains the default until explicitly switched via `FINANCIAL_EXTRACTION_PROVIDER=structured_nlp`

---

## 2. Existing Extraction Architecture & Preserved Components
- `src/services/fact-extraction.js` — preserved untouched as `legacy` provider
- `src/services/ingestion-pipeline.js` — preserved 10-step orchestration, SQL persistence, conflict governance, Azure AI Search indexing, and Teams chatbot retrieval; Step 5 routes to `extractFinancialFactsUnified` **only** when `FINANCIAL_EXTRACTION_PROVIDER=structured_nlp`
- `src/utils/decimal.js` — reused for exact fixed-point `BigInt` decimal arithmetic
- `src/services/arabic-normalizer.js` — reused for Arabic-Indic digit and separator normalization
- `src/services/conflict-resolver.js` — preserved untouched (already isolates `Metric`, `Entity`, `Period`, `ReportingBasis`, `ReportingScope`, `Unit`, `Currency`, and sorted `Dimensions`)
- `src/services/sql.js` — preserved untouched (`insertFinancialFacts` dynamically calls `resolveEntityAlias`/`findOrCreateEntity`, `resolveMetricAlias`/`findOrCreateMetric`, `findOrCreatePeriod`, and enforces WP13 `NeedsReview` checks)

---

## 3. Files Created & Modified

### Created (`finchat/src/services/financial-extraction/`):
- `index.js` — public module exports
- `extraction-orchestrator.js` — `extractStructuredFinancialFacts(payload)` central pipeline
- `performance-tracker.js` — `node:perf_hooks` stage-level timing instrumentation (`externalInferenceCalls: 0`, `llmTokensUsed: 0`)
- `numeric-normalizer.js` — exact `Decimal` parsing for Western, Indian (`crore`/`lakh`, `1,25,00,000`), European (`1.250.000,50`), Arabic-Indic (`٣٬٥٠٠٬٠٠٠`), accounting bracket negatives, percentages, ratios, counts, and missing markers (`N/A`/`-`)
- `layout/table-island-detector.js` — `O(R × C)` multi-table island splitting per worksheet/grid with caption detection
- `layout/document-layout.js` — Unified Document Representation builder
- `layout/header-reconstructor.js` — multi-level header hierarchy & sparse merged parent header forward-fill
- `tables/role-classifier.js` — dynamic column role classification (`Metric`, `Entity`, `ReportingPeriod`, `NumericValue`, `ReportingDimension`, `NoteReference`, `Identifier`, etc.)
- `tables/orientation-detector.js` — Format A–G orientation detection (`MetricsAsRows`, `MetricsAsColumns`, `RecordBased`, `EntitiesAsColumns`)
- `tables/matrix-unpivoter.js` — linear table cell unpivoting with nested row hierarchy (`division`) and unknown dimension preservation
- `context/context-graph.js` — scoped JavaScript `Map` context graph (`Document -> Table/Paragraph -> Row/Column/Sentence`) with entity-transition period/currency isolation
- `candidates/candidate-detector.js` — single-pass non-overlapping numerical candidate detection & contextual classification (`PeriodMetadata`, `DateMetadata`, `ReferenceNumber`, `EstablishmentYear`, `FinancialCandidate`, `PercentageCandidate`, `RatioCandidate`, `OperationalCandidate`, `MissingValue`)
- `candidates/candidate-index.js` — `O(1)` lookup indexes (`byId`, `byPage`, `byTable`, `byRow`, `byColumn`, `byParagraph`, `bySentence`)
- `narrative/sentence-segmenter.js` — `Intl.Segmenter` Unicode-aware sentence & clause segmentation
- `narrative/paragraph-extractor.js` — generalized grammatical relationship extraction (English & Arabic), coordinated `respectively` pairing, passive/possessive forms, negation/hypothetical filtering, compound metric conjunction preservation, and pronoun inheritance
- `validation/evidence-validator.js` — independent source verification & policy-driven `extractionConfidence` (`0.0` to `0.98`, never blind `1.0`)
- `validation/candidate-reconciler.js` — 100% candidate accounting & resolution coverage
- `validation/deduplicator.js` — source-aware deduplication preserving distinct table + narrative evidence

### Created / Modified Integration & Tests:
- `src/services/financial-extraction-client.js` (created) — provider switch (`legacy` default | `structured_nlp`)
- `src/services/ingestion-pipeline.js` (minimal 8-line additive hook at Step 5)
- `.env.example` (added `FINANCIAL_EXTRACTION_PROVIDER=legacy` and `STRUCTURED_NLP_*` settings)
- `tests/unit/financial-facts/structured-nlp.test.js` (created) — comprehensive 22-fact fixture, table islands, narrative patterns, exact normalization, and 1,000-cell benchmark

---

## 4. Measured Test & Benchmark Results
Executed with Node.js (`--test`):

- **JS Syntax Verification (`node --check` across all `src/`):** 62/62 files passed.
- **WP12 Master Acceptance Suite (`tests/acceptance/wp12-acceptance.test.js`):** **9/9 passed** (`112.4 ms`).
- **SAFEE `structured_nlp` Suite (`tests/unit/financial-facts/structured-nlp.test.js`):** **5/5 passed** (`99.5 ms`):
  - **22-Fact Acceptance Fixture (Section 44):** `22/22` facts extracted accurately in **27.6 ms** (`externalInferenceCalls: 0`, `llmTokensUsed: 0`).
  - **Multi-Level Headers, Table Islands, Nested Row Hierarchies, Unfamiliar Headers & Missing Markers:** passed in **2.3 ms**.
  - **Complex Narratives (Coordinated `respectively`, Passive, Negation/Hypothetical exclusion, Multi-Entity isolation, Arabic `15 مليون درهم`, Ratios, Operational Counts):** passed in **11.9 ms**.
  - **Exact Numerical Normalization (Indian, European, Arabic-Indic, No Default USD):** passed in **0.8 ms**.
  - **1,000-Cell Matrix Benchmark (`250 × 4` custom metrics):** **1,000 facts extracted in 54.6 ms** (target `< 3,000 ms`).

---

## 5. Known Limitations & Unsupported Cases
1. Scanned/image-only PDF pages are flagged in `coverage.unsupportedPages` because OCR is intentionally excluded.
2. Borderless multi-column PDFs parsed purely via `pdf-parse` text streams without coordinate tables rely on paragraph narrative extraction unless structured `tables` are supplied.
3. Complex cross-sentence coreference beyond unambiguous subject/pronoun (`Its`/`Their`/`The company`) transitions is marked `NeedsReview` (`Entity unresolved`) rather than guessed.

---

## 6. Configuration, Local Testing & Rollback

### Enable `structured_nlp`:
```env
FINANCIAL_EXTRACTION_PROVIDER=structured_nlp
```

### Local Test Command:
```powershell
node --test tests/unit/financial-facts/structured-nlp.test.js tests/acceptance/wp12-acceptance.test.js
```

### Azure Functions Deployment Compatibility:
- Pure Node.js CommonJS modules using built-in `node:perf_hooks`, `node:crypto`, `Intl.Segmenter`, and existing `src/utils/decimal.js`.
- Zero new npm packages required, zero external inference endpoints, zero Python/Ollama runtime dependencies.

### Rollback:
Set `FINANCIAL_EXTRACTION_PROVIDER=legacy` (or unset the variable). The existing `fact-extraction.js` pipeline executes identically to before.
