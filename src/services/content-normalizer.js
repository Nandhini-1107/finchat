// content-normalizer.js
// Purpose: Convert extracted document content into the NormalizedDocumentV1 contract.
// Handles structural normalization and provenance. Zero hardcoded financial metrics or entities.

const { ValidationError } = require('../utils/errors');
const { validateNormalizedDocument } = require('./normalized-document-validator');
const { normalizeArabicText } = require('./arabic-normalizer');
const {
    CONTRACT_VERSION,
    ELEMENT_TYPES,
    ROW_TYPES,
    PARAGRAPH_ROLES
} = require('../../contracts/normalized-document');

const DEFAULT_HEADER_SCAN_ROWS = 10;

// ------------------------------------------------------------
// Helper: safe text conversion with Arabic normalization
// ------------------------------------------------------------
function toText(value) {
    if (value === undefined || value === null) return '';
    let str = String(value).replace(/\r?\n/g, ' ').trim();
    if (/[\u0600-\u06FF]/.test(str)) {
        str = normalizeArabicText(str);
    }
    return str;
}

// ------------------------------------------------------------
// Helper: infer column data type hint without business rules
// ------------------------------------------------------------
function inferDataType(grid, columnIndex, headerRowIndex) {
    let numericCount = 0;
    let totalChecked = 0;

    for (let r = 0; r < grid.length; r++) {
        if (r === headerRowIndex) continue;
        const val = toText(grid[r]?.[columnIndex]);
        if (!val) continue;
        totalChecked++;

        // Number, accounting parenthesis negative, percentage, or currency symbol
        if (/^[()+\-.,\d\s%$€£₹٠-٩]+$/.test(val) && /\d/.test(val)) {
            numericCount++;
        }
    }

    if (totalChecked > 0 && (numericCount / totalChecked) >= 0.7) {
        return 'numeric';
    }
    return 'text';
}

// ------------------------------------------------------------
// Helper: build multi-level header path if super-headers exist
// ------------------------------------------------------------
function buildHeaderPath(grid, columnIndex, startHeaderIndex, headerRowIndex, defaultHeader, mergedRanges = []) {
    if (headerRowIndex === null) {
        return [defaultHeader];
    }
    const start = (typeof startHeaderIndex === 'number' && startHeaderIndex >= 0) ? startHeaderIndex : headerRowIndex;
    const pathParts = [];

    for (let r = start; r <= headerRowIndex; r++) {
        let val = toText(grid[r]?.[columnIndex]);
        // If empty, check if covered by a horizontal merged range
        if (!val && Array.isArray(mergedRanges)) {
            const merge = mergedRanges.find(m =>
                m.start && m.end &&
                r >= m.start.rowIndex && r <= m.end.rowIndex &&
                columnIndex >= m.start.columnIndex && columnIndex <= m.end.columnIndex
            );
            if (merge) {
                val = toText(grid[merge.start.rowIndex]?.[merge.start.columnIndex]);
            }
        }
        if (r === headerRowIndex) {
            pathParts.push(defaultHeader);
        } else if (val) {
            pathParts.push(val);
        }
    }

    return pathParts.length > 0 ? pathParts : [defaultHeader];
}

// ------------------------------------------------------------
// Helper: create a 2D grid from extracted cells
// Supports both local extraction and Azure DI-style tables.
// ------------------------------------------------------------
function buildGrid(table) {
    if (Array.isArray(table.rawGrid) && table.rawGrid.length > 0) {
        return table.rawGrid.map(row =>
            row.map(value => toText(value))
        );
    }

    const cells = table.cells || [];
    const rowCount = Number(table.rowCount || 0);
    const columnCount = Number(table.columnCount || 0);

    const grid = Array.from(
        { length: rowCount },
        () => Array(columnCount).fill('')
    );

    cells.forEach(cell => {
        const rowIndex = Number(cell.rowIndex);
        const columnIndex = Number(cell.columnIndex);

        if (
            Number.isInteger(rowIndex) &&
            Number.isInteger(columnIndex) &&
            rowIndex >= 0 &&
            columnIndex >= 0 &&
            rowIndex < rowCount &&
            columnIndex < columnCount
        ) {
            grid[rowIndex][columnIndex] = toText(
                cell.content ?? cell.formattedValue ?? cell.rawValue
            );
        }
    });

    return grid;
}

// ------------------------------------------------------------
// Header candidate scoring
// ------------------------------------------------------------
function scoreHeaderRow(row) {
    const values = row.map(toText);
    const nonEmpty = values.filter(Boolean);

    if (nonEmpty.length < 2) {
        return 0;
    }

    const textLikeCount = nonEmpty.filter(value => {
        return !/^[\s()+\-.,\d%$€£₹٠-٩۰-۹]+$/.test(value);
    }).length;

    const uniqueCount = new Set(
        nonEmpty.map(value => value.toLowerCase())
    ).size;

    const textRatio = textLikeCount / nonEmpty.length;
    const uniquenessRatio = uniqueCount / nonEmpty.length;
    const fillRatio = nonEmpty.length / Math.max(row.length, 1);

    return (
        textRatio * 0.50 +
        uniquenessRatio * 0.30 +
        fillRatio * 0.20
    );
}

// ------------------------------------------------------------
// Find a possible header row (supports multi-level headers)
// ------------------------------------------------------------
function isTextHeaderRow(row) {
    const values = row.map(toText);
    const nonEmpty = values.filter(Boolean);
    if (nonEmpty.length < 2) return false;

    const textLikeCount = nonEmpty.filter(value => {
        return !/^[\s()+\-.,\d%$€£₹٠-٩]+$/.test(value);
    }).length;

    // A true header row must be predominantly text (> 80% non-numeric)
    return (textLikeCount / nonEmpty.length) >= 0.80;
}

function detectHeader(grid, options = {}) {
    const scanLimit = Math.min(
        grid.length,
        options.headerScanRows || DEFAULT_HEADER_SCAN_ROWS
    );

    let bestIndex = -1;
    let bestScore = 0;

    for (let index = 0; index < scanLimit; index++) {
        const score = scoreHeaderRow(grid[index]);

        if (score > bestScore) {
            bestScore = score;
            bestIndex = index;
        }
    }

    const minimumConfidence = options.minimumHeaderConfidence ?? 0.65;

    if (bestIndex === -1 || bestScore < minimumConfidence) {
        return {
            headerRowIndex: null,
            confidence: Number(bestScore.toFixed(3)),
            detected: false,
            requiresReview: true,
            hasMultiLevelHeaders: false
        };
    }

    let finalHeaderIndex = bestIndex;
    let startHeaderIndex = bestIndex;

    // Scan downward while subsequent contiguous rows are also pure text header rows
    while (finalHeaderIndex + 1 < scanLimit && isTextHeaderRow(grid[finalHeaderIndex + 1])) {
        const nextScore = scoreHeaderRow(grid[finalHeaderIndex + 1]);
        if (nextScore >= minimumConfidence) {
            finalHeaderIndex++;
        } else {
            break;
        }
    }

    // Scan upward while preceding contiguous rows are also pure text header rows
    while (startHeaderIndex > 0 && isTextHeaderRow(grid[startHeaderIndex - 1])) {
        const prevScore = scoreHeaderRow(grid[startHeaderIndex - 1]);
        if (prevScore >= minimumConfidence) {
            startHeaderIndex--;
        } else {
            break;
        }
    }

    const hasMultiLevelHeaders = startHeaderIndex < finalHeaderIndex;

    return {
        headerRowIndex: finalHeaderIndex,
        startHeaderIndex,
        confidence: Number(bestScore.toFixed(3)),
        detected: true,
        requiresReview: bestScore < 0.80,
        hasMultiLevelHeaders
    };
}

// ------------------------------------------------------------
// Create unique column names (preserves duplicates with suffix)
// ------------------------------------------------------------
function createUniqueHeaders(rawHeaders, columnCount) {
    const headers = [];
    const used = new Map();

    for (let index = 0; index < columnCount; index++) {
        const original = toText(rawHeaders[index]);
        const baseName = original || `Column_${index + 1}`;

        const normalizedKey = baseName.toLowerCase();
        const occurrence = (used.get(normalizedKey) || 0) + 1;

        used.set(normalizedKey, occurrence);

        headers.push(
            occurrence === 1
                ? baseName
                : `${baseName}__${occurrence}`
        );
    }

    return headers;
}

// ------------------------------------------------------------
// Build Markdown representation
// ------------------------------------------------------------
function escapeMarkdownCell(value) {
    return toText(value)
        .replace(/\|/g, '\\|')
        .replace(/\n/g, ' ');
}

function buildMarkdown(headers, grid, headerRowIndex) {
    if (!grid.length || !headers.length) return '';

    const headerLine = `| ${headers.map(escapeMarkdownCell).join(' | ')} |`;
    const separatorLine = `| ${headers.map(() => '---').join(' | ')} |`;
    const dataLines = [];

    grid.forEach((row, rowIndex) => {
        if (rowIndex === headerRowIndex) return;

        const values = headers.map((_, columnIndex) =>
            escapeMarkdownCell(row[columnIndex] ?? '')
        );

        dataLines.push(`| ${values.join(' | ')} |`);
    });

    return [headerLine, separatorLine, ...dataLines].join('\n');
}

// ------------------------------------------------------------
// Normalize one table
// ------------------------------------------------------------
function normalizeTable(table, tableIndex, documentId, options = {}) {
    const docIdStr = String(documentId);
    const grid = buildGrid(table);

    const rowCount = grid.length;
    const columnCount = Math.max(
        Number(table.columnCount || 0),
        ...grid.map(row => row.length),
        0
    );

    // Ensure every row has the same number of columns.
    const completeGrid = grid.map(row => {
        const completed = [...row];
        while (completed.length < columnCount) {
            completed.push('');
        }
        return completed;
    });

    const headerDetection = detectHeader(completeGrid, options);
    const headerRowIndex = headerDetection.headerRowIndex;
    const startHeaderIndex = headerDetection.startHeaderIndex ?? headerRowIndex;

    const rawHeaders = headerRowIndex !== null
        ? completeGrid[headerRowIndex]
        : [];

    const headers = createUniqueHeaders(
        rawHeaders,
        columnCount
    );

    // Build positional columns
    let hasMultiLevel = headerDetection.hasMultiLevelHeaders || false;
    const columns = headers.map((header, columnIndex) => {
        const rawH = rawHeaders[columnIndex] ?? '';
        const hPath = buildHeaderPath(completeGrid, columnIndex, startHeaderIndex, headerRowIndex, header, table.mergedRanges || []);
        if (hPath.length > 1) {
            hasMultiLevel = true;
        }

        const sourceAddress = table.cells?.find(
            c => c.rowIndex === headerRowIndex && c.columnIndex === columnIndex
        )?.address || null;

        return {
            columnIndex,
            header,
            rawHeader: rawH,
            headerPath: hPath,
            sourceAddress,
            dataTypeHint: inferDataType(completeGrid, columnIndex, headerRowIndex)
        };
    });

    // Build rows (data rows only, skipping the entire contiguous header block [startHeaderIndex, headerRowIndex])
    const rows = [];
    const elementId = `${docIdStr}_table_${tableIndex + 1}`;
    const pageNumber =
        table.boundingRegions?.[0]?.pageNumber ??
        table.sourceLocation?.pageNumber ??
        null;

    completeGrid.forEach((gridRow, rowIndex) => {
        if (startHeaderIndex !== null && headerRowIndex !== null) {
            if (rowIndex >= startHeaderIndex && rowIndex <= headerRowIndex) return;
        } else if (rowIndex === headerRowIndex) {
            return;
        }

        const rowObject = {};
        const cellsArray = [];

        headers.forEach((header, columnIndex) => {
            const val = gridRow[columnIndex] ?? '';
            rowObject[header] = val;

            const rawCell = table.cells?.find(
                c => c.rowIndex === rowIndex && c.columnIndex === columnIndex
            );

            const cellObj = {
                columnIndex,
                value: val,
                rawValue: rawCell ? rawCell.rawValue : val,
                formattedValue: rawCell ? rawCell.formattedValue : toText(val),
                formula: rawCell?.formula || null,
                cellType: rawCell?.cellType || (val === '' ? 'blank' : (typeof val === 'number' ? 'number' : 'string')),
                sourceAddress: rawCell?.address || null,
                sourceLocation: rawCell ? {
                    sheetName: table.sheetName || null,
                    cellAddress: rawCell.address || null,
                    pageNumber
                } : null
            };

            cellsArray.push(cellObj);
            // Dual-accessor: allow legacy table.rows[i].cells['Header'] lookup
            cellsArray[header] = val;
        });

        // Determine row type
        let rowType = ROW_TYPES.DATA;
        if (startHeaderIndex !== null && rowIndex < startHeaderIndex) {
            rowType = ROW_TYPES.BANNER;
        } else {
            const nonBlank = gridRow.filter(v => toText(v) !== '');
            if (nonBlank.length === 0) {
                rowType = ROW_TYPES.EMPTY;
            } else if (/^(total|subtotal|المجموع|الإجمالي)/i.test(toText(gridRow[0]))) {
                rowType = ROW_TYPES.TOTAL;
            } else if (nonBlank.length === 1 && (/^(notes?:|note\s+\d+:|commentary|cfo\s+commentary)/i.test(toText(nonBlank[0])) || toText(nonBlank[0]).length > 40)) {
                rowType = ROW_TYPES.NOTE;
            }
        }

        rows.push({
            rowIndex,
            sourceRowIndex: rowIndex,
            isHeader: false,
            rowType,
            cells: cellsArray,
            cellValues: rowObject,
            cellsByHeader: rowObject,
            rawValues: [...gridRow]
        });
    });

    const markdown = buildMarkdown(
        headers,
        completeGrid,
        headerRowIndex
    );

    const structure = {
        rowCount,
        columnCount,
        headerRowIndex,
        headerDetectionConfidence: headerDetection.confidence,
        headerDetectionStatus: headerDetection.detected ? 'detected' : 'fallback',
        hasMultiLevelHeaders: Boolean(table.hasMultiLevelHeaders || hasMultiLevel),
        requiresReview: Boolean(table.requiresReview) || headerDetection.requiresReview
    };

    const source = {
        pageNumber,
        sheetName: table.sheetName || null,
        range: table.sourceRange || null,
        boundingRegions: table.boundingRegions || [],
        boundingBox: table.boundingBox || null
    };

    return {
        // Contract NormalizedDocumentV1 element fields
        elementId,
        documentId: docIdStr,
        elementType: ELEMENT_TYPES.TABLE,
        source,
        structure,
        columns,
        rows,
        tableContext: table.tableContext || null,
        rawGrid: completeGrid,
        rawCells: table.cells || [],
        mergedRanges: table.mergedRanges || [],
        content: markdown,

        // Legacy compatibility fields
        element_id: elementId,
        document_id: docIdStr,
        element_type: 'table',
        table_id: elementId,
        row_count: rowCount,
        column_count: columnCount,
        headers,
        raw_headers: rawHeaders,
        header_row_index: headerRowIndex,
        header_detection: headerDetection,
        raw_grid: completeGrid,
        raw_cells: table.cells || [],
        sheet_name: table.sheetName || null,
        source_range: table.sourceRange || null,
        merged_ranges: table.mergedRanges || [],
        extraction_method: table.extractionMethod || 'unknown',
        detection_confidence: table.detectionConfidence ?? null,
        page_number: pageNumber,
        source_location: table.sourceLocation || null,
        bounding_regions: table.boundingRegions || [],
        requires_review: structure.requiresReview
    };
}

// ------------------------------------------------------------
// Normalize paragraphs & provenance
// ------------------------------------------------------------
function identifyParagraphRole(paragraph, content, tables = []) {
    if (paragraph.paragraphRole && paragraph.paragraphRole !== 'unknown') {
        return paragraph.paragraphRole;
    }
    const rawTrimmed = toText(content);
    if (!rawTrimmed) return PARAGRAPH_ROLES.UNKNOWN;

    // Clean leading and trailing pipes / whitespace from Excel row joins
    const cleanText = rawTrimmed.replace(/^[\s|]+|[\s|]+$/g, '').trim();
    if (!cleanText) return PARAGRAPH_ROLES.UNKNOWN;

    // 1. Detect genuine document metadata & narrative semantics first
    if (/^(notes?:|note\s+\d+:|disclaimer:|warning:|confidential\b)/i.test(cleanText)) {
        return PARAGRAPH_ROLES.FOOTNOTE;
    }
    if (/^(title|document\s+title|report\s+title|statement\s+of\s+profit|balance\s+sheet)/i.test(cleanText)) {
        return PARAGRAPH_ROLES.TITLE;
    }
    if (/\b(currency|aed|usd|sar|eur|inr|gbp)\b/i.test(cleanText) && cleanText.length < 150) {
        return PARAGRAPH_ROLES.CURRENCY_DECLARATION;
    }
    if (/\b(approved\s+by|independent\s+auditor|audited\s+by|signed\s+by)\b/i.test(cleanText) && cleanText.length < 200) {
        return PARAGRAPH_ROLES.APPROVAL;
    }
    if (/^(cfo\s+commentary|commentary\b|management\s+commentary|discussion\s+and\s+analysis)/i.test(cleanText) ||
        (/\b(revenue\s+(?:grew|increased|decreased|was|reached)|we\s+expect|cfo\s+commentary|commentary\b)/i.test(cleanText) && !cleanText.includes(' | '))) {
        return PARAGRAPH_ROLES.COMMENTARY;
    }

    // 2. Table-derived row duplicate check:
    // Only mark as table_row_duplicate if the paragraph content actually matches a structured table data row
    // with multiple columns or contains multi-column pipe separators matching an extracted table in that sheet/page
    if (Array.isArray(tables) && tables.length > 0) {
        const sheetName = paragraph.sourceLocation?.sheetName || paragraph.sheetName;
        const pageNumber = paragraph.sourceLocation?.pageNumber || paragraph.pageNumber;
        const matchingTable = tables.find(t => {
            if (sheetName && t.sheet_name) return t.sheet_name === sheetName;
            if (pageNumber && t.page_number) return t.page_number === pageNumber;
            return false;
        });

        if (matchingTable && Array.isArray(matchingTable.rows)) {
            const normalizedText = cleanText.replace(/\s*\|\s*/g, ' | ').toLowerCase();
            const matchesRow = matchingTable.rows.some(r => {
                if (!Array.isArray(r.rawValues)) return false;
                const nonBlankValues = r.rawValues.map(toText).filter(Boolean);
                // Only consider as table row duplicate if the row has at least 2 non-blank columns
                if (nonBlankValues.length < 2) return false;
                const rowStr = nonBlankValues.join(' | ').toLowerCase();
                return rowStr.length > 0 && (rowStr === normalizedText || normalizedText.includes(rowStr));
            });

            if (matchesRow) {
                return PARAGRAPH_ROLES.TABLE_ROW_DUPLICATE;
            }
        }
    }

    // If paragraph came from Excel with sheet/row coords and has multiple column pipes:
    if (cleanText.includes(' | ') && (paragraph.sourceLocation?.sheetName || paragraph.sourceLocation?.rowIndex)) {
        const parts = cleanText.split(' | ').map(toText).filter(Boolean);
        if (parts.length >= 2) {
            return PARAGRAPH_ROLES.TABLE_ROW_DUPLICATE;
        }
    }

    // Otherwise, standalone text blocks in Excel or PDF are genuine narrative
    return PARAGRAPH_ROLES.NARRATIVE;
}

function normalizeParagraph(paragraph, index, documentId, options = {}, tables = []) {
    const docIdStr = String(documentId);
    const content = toText(
        paragraph.content ?? paragraph.rawContent
    );
    const rawContent = paragraph.rawContent ?? content;
    const elementId = `${docIdStr}_paragraph_${index + 1}`;
    const pageNumber =
        paragraph.boundingRegions?.[0]?.pageNumber ??
        paragraph.sourceLocation?.pageNumber ??
        null;

    const paragraphRole = identifyParagraphRole(paragraph, content, tables);

    const source = {
        pageNumber,
        sheetName: paragraph.sourceLocation?.sheetName || null,
        rowIndex: paragraph.sourceLocation?.rowIndex || null,
        paragraphIndex: index,
        boundingRegions: paragraph.boundingRegions || [],
        boundingBox: paragraph.boundingBox || null
    };

    return {
        // Contract NormalizedDocumentV1 element fields
        elementId,
        documentId: docIdStr,
        elementType: ELEMENT_TYPES.PARAGRAPH,
        paragraphIndex: index,
        content,
        rawContent,
        paragraphRole,
        source,

        // Legacy compatibility fields
        element_id: elementId,
        document_id: docIdStr,
        element_type: 'paragraph',
        paragraph_index: index,
        raw_content: rawContent,
        paragraph_role: paragraphRole,
        page_number: pageNumber,
        source_location: paragraph.sourceLocation || null,
        bounding_regions: paragraph.boundingRegions || []
    };
}

// ------------------------------------------------------------
// Main normalization entry point
// ------------------------------------------------------------
function normalizeContent(analyzeResult, documentId, options = {}) {
    if (!analyzeResult || typeof analyzeResult !== 'object') {
        throw new Error('Invalid extraction result supplied to normalizer.');
    }

    const docIdStr = String(documentId);

    const tables = (analyzeResult.tables || []).map(
        (table, index) =>
            normalizeTable(table, index, docIdStr, options)
    );

    const paragraphs = (analyzeResult.paragraphs || []).map(
        (paragraph, index) =>
            normalizeParagraph(paragraph, index, docIdStr, options, tables)
    );

    const elements = [
        ...tables,
        ...paragraphs
    ];

    // Sort by page when page information is available.
    elements.sort((a, b) => {
        const pageA = a.source?.pageNumber ?? a.page_number;
        const pageB = b.source?.pageNumber ?? b.page_number;
        if (pageA == null || pageB == null) return 0;
        return pageA - pageB;
    });

    const rootDoc = {
        // NormalizedDocumentV1 Contract properties
        contractVersion: CONTRACT_VERSION,
        document: {
            documentId: docIdStr,
            fileName: options.fileName || analyzeResult.fileName || null,
            fileType: options.fileType || analyzeResult.fileType || null,
            metadata: options.metadata || analyzeResult.metadata || {},
            sourceMetadata: options.sourceMetadata || analyzeResult.sourceMetadata || null
        },
        elements,
        extractionMetadata: {
            parser: analyzeResult.parser || 'unknown',
            pageCount: (analyzeResult.pages || []).length,
            tableCount: tables.length,
            paragraphCount: paragraphs.length,
            extractedAt: new Date().toISOString()
        },

        // Legacy compatibility fields
        document_id: docIdStr,
        parser: analyzeResult.parser || 'unknown',
        tables,
        paragraphs,
        fullContent: analyzeResult.content || '',
        fullMarkdown: analyzeResult.content || '',
        content: analyzeResult.content || '',
        pages: analyzeResult.pages || [],
        normalization: {
            version: '1.0',
            tableCount: tables.length,
            paragraphCount: paragraphs.length,
            tablesRequiringReview: tables.filter(
                table => table.requires_review || table.structure?.requiresReview
            ).length
        }
    };

    // Runtime Validation against NormalizedDocumentV1 specification
    const validation = validateNormalizedDocument(rootDoc);
    rootDoc.validation = validation;

    if (!validation.valid) {
        throw new ValidationError(
            `Normalized document validation failed: ${validation.errors.join('; ')}`,
            validation.errors
        );
    }

    return rootDoc;
}

module.exports = {
    normalizeTable,
    normalizeParagraph,
    normalizeContent,
    buildGrid,
    detectHeader
};
