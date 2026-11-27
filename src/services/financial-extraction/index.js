'use strict';

const { extractStructuredFinancialFacts } = require('./extraction-orchestrator');
const { normalizeFinancialNumber } = require('./numeric-normalizer');
const { detectTableIslands } = require('./layout/table-island-detector');
const { normalizeDocumentStructure } = require('./layout/document-layout');
const { buildContextGraph } = require('./context/context-graph');
const { detectNumericCandidates } = require('./candidates/candidate-detector');
const { extractTableFacts } = require('./tables/matrix-unpivoter');
const { extractParagraphFacts } = require('./narrative/paragraph-extractor');
const { validateEvidence } = require('./validation/evidence-validator');
const { reconcileCandidates } = require('./validation/candidate-reconciler');
const { deduplicateSourceOccurrences } = require('./validation/deduplicator');

const { extractPdfLayout } = require('./layout/pdf-layout-adapter');
const { extractExcelLayout } = require('./layout/excel-layout-adapter');

module.exports = {
    extractStructuredFinancialFacts,
    normalizeFinancialNumber,
    detectTableIslands,
    normalizeDocumentStructure,
    extractPdfLayout,
    extractExcelLayout,
    buildContextGraph,
    detectNumericCandidates,
    extractTableFacts,
    extractParagraphFacts,
    validateEvidence,
    reconcileCandidates,
    deduplicateSourceOccurrences
};
