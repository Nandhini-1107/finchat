'use strict';

const { detectTableIslands } = require('./table-island-detector');

/**
 * Unified Document Representation Builder (Section 6).
 * Accepts either normalized output from content-normalizer.js OR
 * structured extraction payload { metadata, tables, paragraphs, rawText }.
 */

function toGridFromNormalizedTable(t) {
    if (Array.isArray(t.grid) && t.grid.length > 0) {
        return t.grid.map(r => (Array.isArray(r) ? r.map(c => String(c ?? '').trim()) : Object.values(r).map(c => String(c ?? '').trim())));
    }
    if (Array.isArray(t.cells) && t.cells.length > 0) {
        const rc = t.rowCount || (Math.max(...t.cells.map(c => c.rowIndex)) + 1);
        const cc = t.columnCount || (Math.max(...t.cells.map(c => c.columnIndex)) + 1);
        const grid = Array.from({ length: rc }, () => Array(cc).fill(''));
        for (const cell of t.cells) {
            if (cell.rowIndex < rc && cell.columnIndex < cc) {
                grid[cell.rowIndex][cell.columnIndex] = String(cell.content ?? '').trim();
            }
        }
        return grid;
    }
    if (Array.isArray(t.rows) && t.rows.length > 0) {
        const headers = Array.isArray(t.headers) ? t.headers.map(h => String(h ?? '').trim()) : [];
        const body = t.rows.map(r => (Array.isArray(r.rawValues) ? r.rawValues.map(v => String(v ?? '').trim()) : Object.values(r.cells || r).map(v => String(v ?? '').trim())));
        return headers.length > 0 ? [headers, ...body] : body;
    }
    return [];
}

function normalizeDocumentStructure(input) {
    const docObj = input.document || {};
    const inputMeta = input.metadata || docObj.metadata || {};
    const metadata = {
        documentId: inputMeta.documentId || docObj.documentId || input.documentId || input.document_id || 0,
        documentName: inputMeta.documentName || docObj.fileName || input.documentName || input.fileName || 'document.pdf',
        documentTitle: inputMeta.documentTitle || docObj.documentTitle || null,
        documentType: inputMeta.documentType || docObj.fileType || input.documentType || 'pdf',
        documentVersion: inputMeta.documentVersion || input.documentVersion || '1.0',
        issuer: inputMeta.issuer || docObj.issuer || null,
        reportingPeriod: inputMeta.reportingPeriod || docObj.reportingPeriod || null,
        asOfDate: inputMeta.asOfDate || docObj.asOfDate || null,
        reportingBasisHint: inputMeta.reportingBasis || docObj.reportingBasis || input.reportingBasisHint || null,
        reportingScope: inputMeta.reportingScope || docObj.reportingScope || null,
        currencyHint: inputMeta.currency || docObj.currency || input.currencyHint || null,
        entityHint: inputMeta.issuer || inputMeta.entityHint || input.entityHint || null,
        periodHint: inputMeta.reportingPeriod || inputMeta.periodHint || input.periodHint || null,
        fullMarkdown: input.fullMarkdown || docObj.fullMarkdown || inputMeta.fullMarkdown || input.rawText || ''
    };

    const rawElements = Array.isArray(input.elements) ? input.elements : [];
    const rawTables = (input.tables && input.tables.length > 0)
        ? input.tables
        : rawElements.filter(e => e.elementType === 'table');
    const tables = [];
    rawTables.forEach((t, idx) => {
        if (t.isNonFinancial) return; // Skip non-financial tables
        const rawGrid = toGridFromNormalizedTable(t);
        const baseMeta = {
            tableId: t.tableId || t.elementId || (t.table_id ? `T${t.table_id}` : `T${idx + 1}`),
            pageNumber: t.pageNumber || t.page_number || t.source?.pageNumber || t.boundingRegions?.[0]?.pageNumber || 1,
            sheetName: t.sheetName || null,
            caption: t.caption || t.title || null,
            contextText: t.contextText || t.note || null
        };
        const islands = detectTableIslands(rawGrid, baseMeta);
        if (islands.length > 0) {
            tables.push(...islands);
        } else if (rawGrid.length > 0) {
            tables.push({
                ...baseMeta,
                rowOffset: 0,
                colOffset: 0,
                rowCount: rawGrid.length,
                columnCount: rawGrid[0] ? rawGrid[0].length : 0,
                grid: rawGrid,
                continuationId: null
            });
        }
    });

    const rawParas = input.paragraphs || input.textBlocks || [];
    let paragraphs = rawParas
        .map((p, idx) => {
            if (typeof p === 'string') {
                return { blockId: `P${idx + 1}`, pageNumber: 1, content: p.trim(), heading: null };
            }
            return {
                blockId: p.blockId || p.element_id || `P${idx + 1}`,
                pageNumber: p.pageNumber || p.page_number || p.boundingRegions?.[0]?.pageNumber || 1,
                content: String(p.content || p.text || '').trim(),
                heading: p.heading || null
            };
        })
        .filter(p => p.content.length > 0);

    // If tables were empty but paragraphs contain text, check if paragraphs contain tables
    if (tables.length === 0 && paragraphs.length > 0) {
        const { detectTablesAndParagraphsFromLines } = require('./pdf-layout-adapter');
        const remainingParas = [];
        paragraphs.forEach(para => {
            const lines = para.content.split('\n').map(l => l.trim()).filter(Boolean);
            const detected = detectTablesAndParagraphsFromLines(lines, para.pageNumber || 1);
            if (detected.tables.length > 0) {
                for (const dt of detected.tables) {
                    if (dt.isNonFinancial) continue;
                    tables.push({
                        tableId: dt.tableId,
                        pageNumber: dt.pageNumber || para.pageNumber || 1,
                        caption: dt.caption,
                        contextText: dt.contextText,
                        rowOffset: 0,
                        colOffset: 0,
                        rowCount: dt.grid.length,
                        columnCount: dt.columnCount || (dt.grid[0] ? dt.grid[0].length : 0),
                        grid: dt.grid,
                        continuationId: null
                    });
                }
                remainingParas.push(...detected.paragraphs);
            } else {
                remainingParas.push(para);
            }
        });
        if (tables.length > 0) {
            paragraphs = remainingParas;
        }
    }

    // Filter out paragraphs that are testing summaries or version metadata
    paragraphs = paragraphs.filter(p => {
        const text = p.content.trim();
        if (/^Document\s+Version:\s*\d+(\.\d+)*$/i.test(text)) return false;
        if (/^Expected\s+testing\s+results/i.test(text)) return false;
        return true;
    });

    // If only fullMarkdown / rawText is provided without paragraphs, split cleanly once
    if (paragraphs.length === 0 && (input.rawText || input.fullMarkdown)) {
        const text = String(input.rawText || input.fullMarkdown);
        const blocks = text.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
        blocks.forEach((b, idx) => {
            // Skip pure markdown pipe tables if tables were already extracted
            if (tables.length > 0 && /^\|.*\|$/.test(b.split('\n')[0])) return;
            paragraphs.push({ blockId: `P${idx + 1}`, pageNumber: 1, content: b, heading: null });
        });
    }

    const pages = input.pages || [];
    const unsupportedPages = pages
        .filter(p => !p.text || String(p.text).trim().length === 0)
        .map(p => p.pageNumber || p.num);

    const maxPage = Math.max(
        1,
        pages.length,
        ...tables.map(t => t.pageNumber || 1),
        ...paragraphs.map(p => p.pageNumber || 1)
    );

    return {
        documentId: metadata.documentId,
        documentName: metadata.documentName,
        documentType: metadata.documentType,
        documentVersion: metadata.documentVersion || '1.0',
        pageCount: maxPage,
        unsupportedPages,
        tables,
        paragraphs,
        metadata
    };
}

module.exports = { normalizeDocumentStructure, toGridFromNormalizedTable };
