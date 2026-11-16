// src/services/normalized-document-validator.js
// Purpose: Runtime validation for NormalizedDocumentV1 contract.
// Guarantees structural consistency, ID alignment, and element integrity
// without modifying the input object.

const { CONTRACT_VERSION, ELEMENT_TYPES } = require('../../contracts/normalized-document');

const SUPPORTED_TYPES = new Set(Object.values(ELEMENT_TYPES));

/**
 * Validates a normalized document object against the NormalizedDocumentV1 specification.
 * 
 * @param {object} doc - The document object to validate.
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
function validateNormalizedDocument(doc) {
    const errors = [];
    const warnings = [];

    // 1. Root-level checks
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
        return {
            valid: false,
            errors: ['Input document must be a non-null object.'],
            warnings: []
        };
    }

    // 2. Contract Version
    if (doc.contractVersion !== CONTRACT_VERSION) {
        errors.push(`Invalid or missing contractVersion: expected "${CONTRACT_VERSION}", got "${doc.contractVersion}".`);
    }

    // 3. Document Object & ID
    if (!doc.document || typeof doc.document !== 'object') {
        errors.push('Root "document" property is required and must be an object.');
    } else {
        const docId = doc.document.documentId;
        if (!docId || typeof docId !== 'string' || docId.trim().length === 0) {
            errors.push('Document must have a valid, non-empty "document.documentId" string.');
        }
    }

    // 4. Elements Array
    if (!Array.isArray(doc.elements)) {
        errors.push('Root "elements" property is required and must be an array.');
        return {
            valid: errors.length === 0,
            errors,
            warnings
        };
    }

    const canonicalDocId = doc.document?.documentId;
    const seenElementIds = new Set();

    // 5. Inspect Elements
    doc.elements.forEach((el, index) => {
        const elPath = `elements[${index}]`;

        if (!el || typeof el !== 'object' || Array.isArray(el)) {
            errors.push(`${elPath} must be a valid non-null object.`);
            return;
        }

        // Element ID
        const elId = el.elementId;
        if (!elId || typeof elId !== 'string' || elId.trim().length === 0) {
            errors.push(`${elPath} is missing a valid "elementId".`);
        } else {
            if (seenElementIds.has(elId)) {
                errors.push(`Duplicate elementId detected: "${elId}" at ${elPath}.`);
            } else {
                seenElementIds.add(elId);
            }
        }

        // Document ID consistency check
        if (canonicalDocId && el.documentId !== canonicalDocId) {
            errors.push(
                `${elPath} (elementId="${elId || 'N/A'}") has mismatched documentId "${el.documentId}"; expected canonical documentId "${canonicalDocId}".`
            );
        }

        // Element Type
        if (!el.elementType || !SUPPORTED_TYPES.has(el.elementType)) {
            errors.push(
                `${elPath} has invalid elementType "${el.elementType}". Supported types: ${Array.from(SUPPORTED_TYPES).join(', ')}.`
            );
        }

        // Element Type specific validation
        if (el.elementType === 'table') {
            validateTableElement(el, elPath, errors, warnings);
        } else if (el.elementType === 'paragraph') {
            validateParagraphElement(el, elPath, errors, warnings);
        } else if (el.elementType === 'heading') {
            validateHeadingElement(el, elPath, errors, warnings);
        }

        // Source validation
        if (el.source !== undefined && el.source !== null) {
            validateSourceLocation(el.source, `${elPath}.source`, errors, warnings);
        }
    });

    return {
        valid: errors.length === 0,
        errors,
        warnings
    };
}

/**
 * Validates a table element structure, columns, and rows
 */
function validateTableElement(table, path, errors, warnings) {
    const colCount = Array.isArray(table.columns) ? table.columns.length : null;

    // Structure validation
    if (table.structure) {
        if (typeof table.structure.rowCount === 'number' && table.structure.rowCount < 0) {
            errors.push(`${path}.structure.rowCount cannot be negative.`);
        }
        if (typeof table.structure.columnCount === 'number' && table.structure.columnCount < 0) {
            errors.push(`${path}.structure.columnCount cannot be negative.`);
        }
        if (table.structure.requiresReview) {
            warnings.push(`${path} has structure.requiresReview=true.`);
        }
    }

    // Columns validation
    if (table.columns !== undefined) {
        if (!Array.isArray(table.columns)) {
            errors.push(`${path}.columns must be an array when specified.`);
        } else {
            const seenColIndices = new Set();
            table.columns.forEach((col, cIdx) => {
                const colPath = `${path}.columns[${cIdx}]`;
                if (!col || typeof col !== 'object') {
                    errors.push(`${colPath} must be a valid object.`);
                    return;
                }
                if (typeof col.columnIndex !== 'number' || !Number.isInteger(col.columnIndex) || col.columnIndex < 0) {
                    errors.push(`${colPath}.columnIndex must be a non-negative integer.`);
                } else if (seenColIndices.has(col.columnIndex)) {
                    errors.push(`${colPath}.columnIndex ${col.columnIndex} is duplicated.`);
                } else {
                    seenColIndices.add(col.columnIndex);
                }

                // Header path validation
                if (col.headerPath !== undefined && col.headerPath !== null) {
                    if (!Array.isArray(col.headerPath)) {
                        errors.push(`${colPath}.headerPath must be an array.`);
                    }
                }
            });
        }
    }

    // Rows validation
    if (table.rows !== undefined) {
        if (!Array.isArray(table.rows)) {
            errors.push(`${path}.rows must be an array when specified.`);
        } else {
            table.rows.forEach((row, rIdx) => {
                const rowPath = `${path}.rows[${rIdx}]`;
                if (!row || typeof row !== 'object') {
                    errors.push(`${rowPath} must be a valid object.`);
                    return;
                }
                if (typeof row.rowIndex !== 'number' || !Number.isInteger(row.rowIndex) || row.rowIndex < 0) {
                    errors.push(`${rowPath}.rowIndex must be a non-negative integer.`);
                }

                if (row.cells !== undefined) {
                    if (!Array.isArray(row.cells)) {
                        errors.push(`${rowPath}.cells must be an array.`);
                    } else {
                        row.cells.forEach((cell, cellIdx) => {
                            const cellPath = `${rowPath}.cells[${cellIdx}]`;
                            if (!cell || typeof cell !== 'object') {
                                errors.push(`${cellPath} must be a valid object.`);
                                return;
                            }
                            if (typeof cell.columnIndex !== 'number' || !Number.isInteger(cell.columnIndex) || cell.columnIndex < 0) {
                                errors.push(`${cellPath}.columnIndex must be a non-negative integer.`);
                            } else if (colCount !== null && colCount > 0 && cell.columnIndex >= colCount) {
                                errors.push(`${cellPath}.columnIndex (${cell.columnIndex}) exceeds column count (${colCount}).`);
                            }
                        });
                    }
                }
            });
        }
    }
}

/**
 * Validates a paragraph element
 */
function validateParagraphElement(paragraph, path, errors, warnings) {
    if (paragraph.content === undefined && paragraph.rawContent === undefined) {
        errors.push(`${path} must provide "content" or "rawContent".`);
    }
    if (typeof paragraph.paragraphIndex === 'number' && paragraph.paragraphIndex < 0) {
        errors.push(`${path}.paragraphIndex cannot be negative.`);
    }
}

/**
 * Validates a heading element
 */
function validateHeadingElement(heading, path, errors, warnings) {
    if (heading.level !== undefined && heading.level !== null) {
        if (!Number.isInteger(heading.level) || heading.level < 1 || heading.level > 6) {
            errors.push(`${path}.level must be an integer between 1 and 6.`);
        }
    }
}

/**
 * Validates source location attributes
 */
function validateSourceLocation(source, path, errors, warnings) {
    if (typeof source !== 'object' || Array.isArray(source)) {
        errors.push(`${path} must be an object.`);
        return;
    }
    if (source.pageNumber !== undefined && source.pageNumber !== null) {
        if (!Number.isInteger(source.pageNumber) || source.pageNumber < 1) {
            errors.push(`${path}.pageNumber must be a positive integer.`);
        }
    }
    if (source.boundingRegions !== undefined && !Array.isArray(source.boundingRegions)) {
        errors.push(`${path}.boundingRegions must be an array.`);
    }
    if (source.boundingBox !== undefined && source.boundingBox !== null && !Array.isArray(source.boundingBox)) {
        errors.push(`${path}.boundingBox must be an array of coordinates.`);
    }
}

module.exports = {
    validateNormalizedDocument
};

