'use strict';

const crypto = require('node:crypto');
const { createPerformanceTracker } = require('./performance-tracker');
const { normalizeDocumentStructure } = require('./layout/document-layout');
const { buildContextGraph } = require('./context/context-graph');
const { detectNumericCandidates } = require('./candidates/candidate-detector');
const { buildCandidateIndex } = require('./candidates/candidate-index');
const { extractTableFacts } = require('./tables/matrix-unpivoter');
const { extractParagraphFacts } = require('./narrative/paragraph-extractor');
const { validateEvidence } = require('./validation/evidence-validator');
const { reconcileCandidates } = require('./validation/candidate-reconciler');
const { deduplicateSourceOccurrences } = require('./validation/deduplicator');

/**
 * SAFEE — Structure-Aware Financial Extraction Engine (Section 42).
 * 100% non-LLM, pure Node.js extraction orchestrator.
 */

function validateExtractionRequest(payload) {
    if (!payload || typeof payload !== 'object') {
        throw new Error('Extraction payload must be a non-null object');
    }
    return payload;
}

async function extractStructuredFinancialFacts(payload) {
    const tracker = createPerformanceTracker();
    const document = validateExtractionRequest(payload);
    const runId = `RUN-${crypto.randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()}`;

    const tLayout = tracker.startStage();
    const layout = normalizeDocumentStructure(document);
    tracker.endStage('layoutMs', tLayout);

    const tCtx = tracker.startStage();
    const contextGraph = buildContextGraph(layout);
    tracker.endStage('contextMs', tCtx);

    const tCand = tracker.startStage();
    const candidates = detectNumericCandidates(layout);
    const candidateIndex = buildCandidateIndex(candidates);
    tracker.endStage('candidateDetectionMs', tCand);

    const tTable = tracker.startStage();
    const tableResult = extractTableFacts({
        tables: layout.tables,
        contextGraph,
        candidateIndex
    });
    tracker.endStage('tableExtractionMs', tTable);

    const tPara = tracker.startStage();
    const paragraphResult = extractParagraphFacts({
        paragraphs: layout.paragraphs,
        contextGraph,
        candidateIndex
    });
    tracker.endStage('paragraphExtractionMs', tPara);

    const tVal = tracker.startStage();
    const combinedFacts = [...tableResult.facts, ...paragraphResult.facts];
    const validationResult = validateEvidence({
        facts: combinedFacts,
        layout
    });
    tracker.endStage('validationMs', tVal);

    const tRec = tracker.startStage();
    const reconciliation = reconcileCandidates({
        candidates,
        validationResult,
        tableResult,
        paragraphResult
    });
    tracker.endStage('reconciliationMs', tRec);

    const tDedup = tracker.startStage();
    const deduplicatedResult = deduplicateSourceOccurrences(reconciliation);
    tracker.endStage('deduplicationMs', tDedup);

    const finalFacts = deduplicatedResult.facts;
    const provisionalMetrics = [...new Set(finalFacts.filter(f => f.mappingStatus === 'NewMetric').map(f => f.metric))];
    const provisionalEntities = [...new Set(finalFacts.filter(f => f.entity && f.entityMappingStatus === 'NewEntity').map(f => f.entity))];

    const perf = tracker.finish({
        pagesProcessed: layout.pageCount,
        tablesProcessed: tableResult.processedTables.length,
        paragraphsProcessed: paragraphResult.processedParagraphs.length,
        candidatesDetected: candidates.length,
        factsExtracted: finalFacts.length
    });

    return {
        status: 'ok',
        documentId: layout.documentId,
        extractionRunId: runId,
        facts: finalFacts,
        candidateFacts: finalFacts,
        coverage: {
            totalPages: layout.pageCount,
            processedPages: layout.pageCount - layout.unsupportedPages.length,
            unsupportedPages: layout.unsupportedPages,
            ...deduplicatedResult.coverage
        },
        unresolvedCandidates: deduplicatedResult.unresolvedCandidates,
        provisionalMetrics,
        provisionalEntities,
        processing: {
            correlationId: document.correlationId || null,
            batchIndex: document.batchIndex ?? 0,
            totalBatches: document.totalBatches ?? 1,
            documentId: layout.documentId,
            factsExtracted: finalFacts.length,
            tablesProcessed: tableResult.processedTables.length,
            paragraphsProcessed: paragraphResult.processedParagraphs.length,
            errors: [],
            warnings: [],
            processingTimeMs: Math.round(perf.timings.totalMs),
            fallbackUsed: false,
            extractionModel: 'safee-structured-nlp-v1',
            ...perf
        }
    };
}

module.exports = { extractStructuredFinancialFacts };
