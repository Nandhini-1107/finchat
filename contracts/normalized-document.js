// contracts/normalized-document.js
// Purpose: Contract definitions, constants, and schema helpers for NormalizedDocumentV1.

const fs = require('fs');
const path = require('path');

const CONTRACT_VERSION = 'NormalizedDocumentV1';

const ELEMENT_TYPES = Object.freeze({
    TABLE: 'table',
    PARAGRAPH: 'paragraph',
    HEADING: 'heading',
    OTHER: 'other'
});

const ROW_TYPES = Object.freeze({
    HEADER: 'header',
    DATA: 'data',
    SUBTOTAL: 'subtotal',
    TOTAL: 'total',
    NOTE: 'note',
    BANNER: 'banner',
    EMPTY: 'empty'
});

const PARAGRAPH_ROLES = Object.freeze({
    NARRATIVE: 'narrative',
    TITLE: 'title',
    DATE: 'date',
    CURRENCY_DECLARATION: 'currency_declaration',
    APPROVAL: 'approval',
    FOOTNOTE: 'footnote',
    TABLE_ROW_DUPLICATE: 'table_row_duplicate',
    COMMENTARY: 'commentary',
    UNKNOWN: 'unknown'
});

/**
 * Loads the raw JSON schema for NormalizedDocumentV1
 */
function getNormalizedDocumentSchema() {
    const schemaPath = path.join(__dirname, 'normalized-document.v1.schema.json');
    return JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
}

/**
 * Creates a baseline NormalizedDocumentV1 skeleton object
 */
function createNormalizedDocument({
    documentId,
    fileName = null,
    fileType = null,
    metadata = {},
    sourceMetadata = {},
    elements = [],
    extractionMetadata = {}
}) {
    if (!documentId || typeof documentId !== 'string') {
        throw new Error('documentId is required to create a NormalizedDocumentV1.');
    }

    return {
        contractVersion: CONTRACT_VERSION,
        document: {
            documentId,
            fileName,
            fileType,
            metadata: metadata || {},
            sourceMetadata: sourceMetadata || {}
        },
        elements: Array.isArray(elements) ? elements : [],
        extractionMetadata: {
            extractedAt: new Date().toISOString(),
            ...extractionMetadata
        }
    };
}

module.exports = {
    CONTRACT_VERSION,
    ELEMENT_TYPES,
    ROW_TYPES,
    PARAGRAPH_ROLES,
    getNormalizedDocumentSchema,
    createNormalizedDocument
};

