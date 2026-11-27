'use strict';

const { extractFinancialFacts: extractLegacyFacts } = require('./fact-extraction');
const { extractStructuredFinancialFacts } = require('./financial-extraction');

/**
 * Financial Extraction Provider Boundary (Section 34).
 *
 * Supported providers:
 *  - 'legacy' (default): existing deterministic fact-extraction.js pipeline
 *  - 'structured_nlp': SAFEE — pure Node.js non-LLM Structure-Aware Financial Extraction Engine
 *
 * Guarantees:
 *  - When 'structured_nlp' is selected, zero LLM / Ollama / Python / external inference calls occur.
 *  - Existing 'legacy' default flow remains 100% unchanged.
 */

function getConfiguredProvider() {
    return (process.env.FINANCIAL_EXTRACTION_PROVIDER || 'legacy').trim().toLowerCase();
}

async function extractFinancialFactsUnified(normalized, options = {}) {
    const provider = options.provider || getConfiguredProvider();

    if (provider === 'structured_nlp') {
        const result = await extractStructuredFinancialFacts({
            correlationId: options.correlationId || `CORR-${Date.now()}`,
            batchIndex: options.batchIndex ?? 0,
            totalBatches: options.totalBatches ?? 1,
            metadata: {
                documentId: options.documentId || normalized.document_id || 0,
                documentName: options.fileName || normalized.documentName || 'document.pdf',
                documentType: options.documentType || 'pdf',
                currencyHint: normalized.currencyHint || null,
                entityHint: normalized.entityHint || null,
                periodHint: normalized.periodHint || null,
                reportingBasisHint: normalized.reportingBasisHint || null
            },
            tables: normalized.tables || [],
            paragraphs: normalized.paragraphs || [],
            rawText: normalized.fullMarkdown || normalized.content || null,
            pages: normalized.pages || []
        });

        if (options.returnFullResponse) {
            return result;
        }
        return result.facts;
    }

    // Default: existing synchronous legacy extraction untouched
    return extractLegacyFacts(normalized);
}

module.exports = {
    extractFinancialFactsUnified,
    getConfiguredProvider
};
