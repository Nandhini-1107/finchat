'use strict';

const { performance } = require('node:perf_hooks');

/**
 * Stage-level performance instrumentation for SAFEE (Section 39).
 * Uses node:perf_hooks; never logs confidential document text.
 */
function createPerformanceTracker() {
    const startMs = performance.now();
    const stageTimings = {
        layoutMs: 0,
        contextMs: 0,
        candidateDetectionMs: 0,
        tableExtractionMs: 0,
        paragraphExtractionMs: 0,
        normalizationMs: 0,
        validationMs: 0,
        reconciliationMs: 0,
        deduplicationMs: 0,
        totalMs: 0
    };

    return {
        startStage() {
            return performance.now();
        },
        endStage(stageKey, stageStartMs) {
            if (Object.prototype.hasOwnProperty.call(stageTimings, stageKey)) {
                stageTimings[stageKey] = Number((performance.now() - stageStartMs).toFixed(3));
            }
        },
        finish(counts = {}) {
            stageTimings.totalMs = Number((performance.now() - startMs).toFixed(3));
            return {
                provider: 'structured_nlp',
                pagesProcessed: counts.pagesProcessed || 0,
                tablesProcessed: counts.tablesProcessed || 0,
                paragraphsProcessed: counts.paragraphsProcessed || 0,
                candidatesDetected: counts.candidatesDetected || 0,
                factsExtracted: counts.factsExtracted || 0,
                timings: { ...stageTimings },
                externalInferenceCalls: 0,
                llmTokensUsed: 0
            };
        }
    };
}

module.exports = { createPerformanceTracker };
