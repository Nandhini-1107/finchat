// local-extractor.js
// Purpose: Extract raw document content and structure from PDF and Excel.
// Important: This file does NOT identify financial metrics or financial facts.

const xlsx = require('xlsx');
const { AppError } = require('../utils/errors');

// ------------------------------------------------------------
// Common helper: create a consistent extraction result
// ------------------------------------------------------------
function createExtractionResult({
    content = '',
    pages = [],
    tables = [],
    paragraphs = [],
    parser = 'local'
} = {}) {
    const rawContent = content || '';
    const safeDelimitedContent = `<<<UNTRUSTED_DOCUMENT_CONTENT>>>\n${rawContent}\n<<<END_UNTRUSTED_DOCUMENT_CONTENT>>>`;

    return {
        parser,
        content: rawContent,
        safeDelimitedContent,
        pages,
        tables,
        paragraphs
    };
}

// ------------------------------------------------------------
// Helper: safely convert values to strings
// ------------------------------------------------------------
function toText(value) {
    if (value === undefined || value === null) return '';
    return String(value).trim();
}

// ------------------------------------------------------------
// Helper: split PDF text into possible columns
//
// This is heuristic detection, not guaranteed PDF table extraction.
// It only detects repeated lines with tabs or multiple spaces.
// ------------------------------------------------------------
function splitPossibleColumns(line) {
    const trimmed = String(line || '').trim();

    if (!trimmed) return [];

    let parts = trimmed.split(/\t+/);

    if (parts.length < 2) {
        parts = trimmed.split(/\s{2,}/);
    }

    return parts.map(value => value.trim());
}

// ------------------------------------------------------------
// Generic PDF table detection
//
// No fixed table names, column names, metrics or row labels.
// Only repeated lines with a consistent number of columns
// are treated as possible tables.
// ------------------------------------------------------------
function extractPossiblePdfTables(page) {
    const tables = [];
    const lines = String(page.text || '').split(/\r?\n/);

    let candidateRows = [];
    let candidateStartLine = null;
    let expectedColumnCount = null;

    function saveCandidate() {
        if (candidateRows.length < 3) {
            candidateRows = [];
            candidateStartLine = null;
            expectedColumnCount = null;
            return;
        }

        const cells = [];

        candidateRows.forEach((row, rowIndex) => {
            row.forEach((value, columnIndex) => {
                cells.push({
                    rowIndex,
                    columnIndex,
                    content: value,
                    rawContent: value
                });
            });
        });

        tables.push({
            rowCount: candidateRows.length,
            columnCount: expectedColumnCount,
            cells,
            sheetName: null,
            extractionMethod: 'pdf_whitespace_heuristic',
            detectionConfidence: 0.45,
            requiresReview: true,
            sourceLocation: {
                pageNumber: page.pageNumber,
                startLine: candidateStartLine
            },
            boundingRegions: [
                { pageNumber: page.pageNumber }
            ]
        });

        candidateRows = [];
        candidateStartLine = null;
        expectedColumnCount = null;
    }

    lines.forEach((line, lineIndex) => {
        const columns = splitPossibleColumns(line);

        // A possible table row must contain at least two columns.
        if (columns.length < 2) {
            saveCandidate();
            return;
        }

        if (expectedColumnCount === null) {
            expectedColumnCount = columns.length;
            candidateStartLine = lineIndex;
            candidateRows.push(columns);
            return;
        }

        if (columns.length === expectedColumnCount) {
            candidateRows.push(columns);
        } else {
            saveCandidate();

            expectedColumnCount = columns.length;
            candidateStartLine = lineIndex;
            candidateRows.push(columns);
        }
    });

    saveCandidate();

    return tables;
}

// ------------------------------------------------------------
// PDF extraction
// ------------------------------------------------------------
async function extractFromPdf(pdfBuffer, options = {}) {
    const logger = options.log || null;

    if (!Buffer.isBuffer(pdfBuffer) || pdfBuffer.length === 0) {
        throw new AppError('PDF input is empty or invalid.', 400);
    }

    if (logger) {
        logger('[PDF Extractor] Starting local PDF text extraction.');
    }

    try {
        const pdfModule = require('pdf-parse');

        let fullText = '';
        let rawPages = [];

        // Support older pdf-parse versions.
        if (typeof pdfModule === 'function') {
            const parsed = await pdfModule(pdfBuffer);

            fullText = parsed.text || '';

            const pageTexts = fullText.split(/\f/);

            rawPages = pageTexts.map((text, index) => ({
                num: index + 1,
                text
            }));
        }

        // Support newer pdf-parse versions.
        else if (pdfModule && pdfModule.PDFParse) {
            const parser = new pdfModule.PDFParse({
                data: pdfBuffer
            });

            try {
                await parser.load();

                const textResult = await parser.getText();

                fullText = textResult.text || '';

                rawPages = (textResult.pages || []).map((page, index) => ({
                    num: page.num || page.pageNumber || index + 1,
                    text: page.text || ''
                }));
            } finally {
                if (typeof parser.destroy === 'function') {
                    await parser.destroy();
                }
            }
        } else {
            throw new Error('Unsupported pdf-parse library version.');
        }

        // Fallback if the library returns text but no page collection.
        if (rawPages.length === 0 && fullText) {
            rawPages = [{
                num: 1,
                text: fullText
            }];
        }

        const pages = rawPages.map((page, index) => ({
            pageNumber: page.num || index + 1,
            text: page.text || ''
        }));

        if (!fullText) {
            fullText = pages.map(page => page.text).join('\n\n');
        }

        // WP2 Scanned PDF Detection:
        // Check text density; if < 100 characters without an embedded text layer, fail with ScannedPdfNotSupported.
        const cleanedText = (fullText || '').replace(/\s+/g, ' ').trim();
        if (cleanedText.length < 100) {
            const err = new AppError('Scanned PDF detected. PDFs must contain at least 100 characters of extractable text layer.', 400);
            err.code = 'ScannedPdfNotSupported';
            throw err;
        }

        const tables = [];
        const paragraphs = [];

        pages.forEach(page => {
            // Preserve possible table structures separately.
            const possibleTables = extractPossiblePdfTables(page);
            tables.push(...possibleTables);

            // Preserve paragraph text without assuming its meaning.
            const blocks = page.text
                .split(/\n\s*\n/)
                .map(block => block.trim())
                .filter(Boolean);

            blocks.forEach((block, index) => {
                paragraphs.push({
                    content: block,
                    rawContent: block,
                    paragraphIndex: index,
                    paragraphRole: 'unknown',
                    boundingRegions: [
                        { pageNumber: page.pageNumber }
                    ],
                    sourceLocation: {
                        pageNumber: page.pageNumber
                    }
                });
            });
        });

        if (logger) {
            logger(
                `[PDF Extractor] Completed: ${pages.length} page(s), ` +
                `${tables.length} possible table(s), ` +
                `${paragraphs.length} paragraph(s).`
            );
        }

        return createExtractionResult({
            content: fullText,
            pages,
            tables,
            paragraphs,
            parser: 'local-pdf'
        });

    } catch (error) {
        if (error instanceof AppError) throw error;

        throw new AppError(
            `Local PDF extraction failed: ${error.message}`,
            500
        );
    }
}

// ------------------------------------------------------------
// Excel extraction
//
// Preserves the complete used cell range, including blank cells.
// Does not assume that the first row contains headers.
// ------------------------------------------------------------
function extractFromExcel(excelBuffer, fileName = 'workbook.xlsx', options = {}) {
    const logger = options.log || null;

    if (!Buffer.isBuffer(excelBuffer) || excelBuffer.length === 0) {
        throw new AppError('Excel input is empty or invalid.', 400);
    }

    try {
        const workbook = xlsx.read(excelBuffer, {
            type: 'buffer',
            cellDates: false,
            cellFormula: true,
            cellNF: true,
            cellText: true,
            cellStyles: true
        });

        const pages = [];
        const tables = [];
        const paragraphs = [];
        const contentSections = [];

        workbook.SheetNames.forEach((sheetName, sheetIndex) => {
            const worksheet = workbook.Sheets[sheetName];

            if (!worksheet || !worksheet['!ref']) {
                if (logger) {
                    logger(`[Excel Extractor] Empty sheet skipped: ${sheetName}`);
                }
                return;
            }

            const range = xlsx.utils.decode_range(worksheet['!ref']);
            const sheetMeta = workbook.Workbook?.Sheets?.[sheetIndex] || {};
            const isHiddenSheet = Boolean(sheetMeta.Hidden && sheetMeta.Hidden > 0);
            let sheetHasHiddenRowsOrCols = false;

            const rowCount = range.e.r - range.s.r + 1;
            const columnCount = range.e.c - range.s.c + 1;

            const cells = [];
            const rawGrid = [];

            // Read every position in the used range.
            for (let rowIndex = range.s.r; rowIndex <= range.e.r; rowIndex++) {
                const isHiddenRow = Boolean(worksheet['!rows']?.[rowIndex]?.hidden || worksheet['!rows']?.[rowIndex]?.hpt === 0);
                if (isHiddenRow) sheetHasHiddenRowsOrCols = true;
                const rowValues = [];

                for (
                    let columnIndex = range.s.c;
                    columnIndex <= range.e.c;
                    columnIndex++
                ) {
                    const isHiddenCol = Boolean(worksheet['!cols']?.[columnIndex]?.hidden || worksheet['!cols']?.[columnIndex]?.width === 0);
                    if (isHiddenCol) sheetHasHiddenRowsOrCols = true;
                    const isCellHidden = isHiddenSheet || isHiddenRow || isHiddenCol;

                    const address = xlsx.utils.encode_cell({
                        r: rowIndex,
                        c: columnIndex
                    });

                    const sourceCell = worksheet[address];

                    const rawValue = sourceCell
                        ? sourceCell.v
                        : null;

                    const formattedValue = sourceCell
                        ? (sourceCell.w ?? toText(rawValue))
                        : '';

                    const cell = {
                        rowIndex: rowIndex - range.s.r,
                        columnIndex: columnIndex - range.s.c,
                        absoluteRowIndex: rowIndex,
                        absoluteColumnIndex: columnIndex,
                        address,
                        content: toText(formattedValue),
                        rawContent: toText(rawValue),
                        rawValue: rawValue ?? null,
                        formattedValue: toText(formattedValue),
                        formula: sourceCell?.f || null,
                        cellType: sourceCell?.t || 'blank',
                        isFromHiddenContent: isCellHidden,
                        hiddenReason: isHiddenSheet ? 'HiddenSheet' : (isHiddenRow ? 'HiddenRow' : (isHiddenCol ? 'HiddenCol' : null))
                    };

                    cells.push(cell);
                    rowValues.push(cell.content);
                }

                rawGrid.push(rowValues);
            }

            // Preserve Excel merged-cell ranges.
            const mergedRanges = (worksheet['!merges'] || []).map(merge => ({
                start: {
                    rowIndex: merge.s.r - range.s.r,
                    columnIndex: merge.s.c - range.s.c
                },
                end: {
                    rowIndex: merge.e.r - range.s.r,
                    columnIndex: merge.e.c - range.s.c
                },
                range: xlsx.utils.encode_range(merge)
            }));

            const table = {
                rowCount,
                columnCount,
                cells,
                rawGrid,
                sheetName,
                extractionMethod: 'excel_cell_grid',
                detectionConfidence: 1,
                requiresReview: isHiddenSheet || sheetHasHiddenRowsOrCols || false,
                isFromHiddenContent: isHiddenSheet || sheetHasHiddenRowsOrCols || false,
                sourceRange: worksheet['!ref'],
                mergedRanges,
                boundingRegions: [
                    { pageNumber: sheetIndex + 1 }
                ],
                sourceLocation: {
                    sheetName,
                    pageNumber: sheetIndex + 1,
                    range: worksheet['!ref']
                }
            };

            tables.push(table);

            const sheetText = rawGrid
                .map(row => row.join(' | '))
                .join('\n');

            pages.push({
                pageNumber: sheetIndex + 1,
                sheetName,
                text: sheetText
            });

            // Preserve non-empty rows as raw text blocks.
            rawGrid.forEach((row, rowIndex) => {
                const rowText = row.join(' | ').trim();

                if (!rowText.replace(/\|/g, '').trim()) return;

                paragraphs.push({
                    content: rowText,
                    rawContent: rowText,
                    paragraphIndex: rowIndex,
                    paragraphRole: 'unknown',
                    boundingRegions: [
                        { pageNumber: sheetIndex + 1 }
                    ],
                    sourceLocation: {
                        sheetName,
                        pageNumber: sheetIndex + 1,
                        rowIndex: rowIndex + 1
                    }
                });
            });

            contentSections.push(
                `Sheet: ${sheetName}\n${sheetText}`
            );

            if (logger) {
                logger(
                    `[Excel Extractor] Sheet "${sheetName}": ` +
                    `${rowCount} row(s), ${columnCount} column(s), ` +
                    `${mergedRanges.length} merged range(s).`
                );
            }
        });

        return createExtractionResult({
            content: contentSections.join('\n\n'),
            pages,
            tables,
            paragraphs,
            parser: 'local-excel'
        });

    } catch (error) {
        if (error instanceof AppError) throw error;

        throw new AppError(
            `Local Excel extraction failed: ${error.message}`,
            500
        );
    }
}

// ------------------------------------------------------------
// Plain text extraction
// ------------------------------------------------------------
function extractFromTextOrCsv(textBuffer, fileName = 'document.txt', options = {}) {
    const logger = options.log || null;

    const rawText = textBuffer.toString('utf8');
    const extension = fileName.toLowerCase().split('.').pop();

    // CSV is explicitly routed to the spreadsheet parser.
    // Do not detect CSV merely because text contains commas.
    if (extension === 'csv') {
        try {
            const workbook = xlsx.read(rawText, {
                type: 'string',
                raw: true
            });

            const excelBuffer = xlsx.write(workbook, {
                type: 'buffer',
                bookType: 'xlsx'
            });

            const result = extractFromExcel(
                excelBuffer,
                fileName,
                options
            );

            result.parser = 'local-csv';
            return result;

        } catch (error) {
            throw new AppError(
                `CSV extraction failed: ${error.message}`,
                500
            );
        }
    }

    const paragraphs = rawText
        .split(/\n\s*\n/)
        .map(block => block.trim())
        .filter(Boolean)
        .map((block, index) => ({
            content: block,
            rawContent: block,
            paragraphIndex: index,
            paragraphRole: 'unknown',
            boundingRegions: [{ pageNumber: 1 }],
            sourceLocation: { pageNumber: 1 }
        }));

    if (logger) {
        logger(
            `[Text Extractor] Extracted ${paragraphs.length} paragraph(s).`
        );
    }

    return createExtractionResult({
        content: rawText,
        pages: [{ pageNumber: 1, text: rawText }],
        tables: [],
        paragraphs,
        parser: 'local-text'
    });
}

// ------------------------------------------------------------
// Main extraction entry point
// ------------------------------------------------------------
async function extractDocumentLocally(fileBuffer, fileName = '', options = {}) {
    if (!Buffer.isBuffer(fileBuffer) || fileBuffer.length === 0) {
        throw new AppError('Document buffer is empty or invalid.', 400);
    }

    const extension = fileName.toLowerCase().split('.').pop();
    const isPdf = fileBuffer.subarray(0, 4).toString('utf8') === '%PDF';

    if (isPdf || extension === 'pdf') {
        return extractFromPdf(fileBuffer, options);
    }

    if (['xlsx', 'xls'].includes(extension)) {
        return extractFromExcel(fileBuffer, fileName, options);
    }

    if (extension === 'csv' || extension === 'txt') {
        return extractFromTextOrCsv(fileBuffer, fileName, options);
    }

    throw new AppError(
        `Unsupported local extraction format: .${extension}`,
        415
    );
}

module.exports = {
    extractDocumentLocally,
    extractFromPdf,
    extractFromExcel,
    extractFromTextOrCsv,
    extractPossiblePdfTables
};
