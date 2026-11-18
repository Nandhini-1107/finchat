// Polyfill browser globals (DOMMatrix, DOMPoint, DOMRect) required by pdfjs-dist in Node.js
if (typeof globalThis.DOMMatrix === 'undefined') {
    try {
        const { DOMMatrix, DOMPoint, DOMRect } = require('@napi-rs/canvas/geometry');
        if (DOMMatrix) globalThis.DOMMatrix = DOMMatrix;
        if (DOMPoint) globalThis.DOMPoint = DOMPoint;
        if (DOMRect) globalThis.DOMRect = DOMRect;
    } catch {
        globalThis.DOMMatrix = class DOMMatrix {
            constructor(init) {
                if (Array.isArray(init)) {
                    this.a = init[0] ?? 1; this.b = init[1] ?? 0;
                    this.c = init[2] ?? 0; this.d = init[3] ?? 1;
                    this.e = init[4] ?? 0; this.f = init[5] ?? 0;
                } else if (typeof init === 'object' && init !== null) {
                    this.a = init.a ?? 1; this.b = init.b ?? 0;
                    this.c = init.c ?? 0; this.d = init.d ?? 1;
                    this.e = init.e ?? 0; this.f = init.f ?? 0;
                } else {
                    this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.e = 0; this.f = 0;
                }
                this.m11 = this.a; this.m12 = this.b; this.m13 = 0; this.m14 = 0;
                this.m21 = this.c; this.m22 = this.d; this.m23 = 0; this.m24 = 0;
                this.m31 = 0;      this.m32 = 0;      this.m33 = 1; this.m34 = 0;
                this.m41 = this.e; this.m42 = this.f; this.m43 = 0; this.m44 = 1;
                this.is2D = true;
                this.isIdentity = (this.a === 1 && this.b === 0 && this.c === 0 && this.d === 1 && this.e === 0 && this.f === 0);
            }
            multiply() { return new globalThis.DOMMatrix(); }
            translate() { return this; }
            scale() { return this; }
            rotate() { return this; }
            transformPoint(p) { return p; }
            inverse() { return this; }
        };
    }
}

const xlsx = require('xlsx');
const { AppError } = require('../utils/errors');

function extractTablesFromPdfText(fullText, pages = []) {
    const tables = [];
    const lines = fullText.split('\n').map(l => l.trim()).filter(Boolean);

    // 1. Settlement Summary Table format
    const summaryHeaderIdx = lines.findIndex(l => /metric\s+count\s+amount/i.test(l));
    if (summaryHeaderIdx !== -1) {
        const headers = ['Metric', 'Count', 'Amount (USD)', 'Interpretation'];
        const grid = [headers];

        for (let i = summaryHeaderIdx + 1; i < lines.length && i < summaryHeaderIdx + 10; i++) {
            const line = lines[i];
            const match = line.match(/^(Total transactions|Approved|Declined|Pending)\s+(\d+)\s+([0-9,.]+)\s*(.*)$/i);
            if (match) {
                grid.push([match[1], match[2], match[3], match[4] || '']);
            } else if (grid.length > 1) {
                break;
            }
        }

        if (grid.length > 1) {
            const cells = [];
            grid.forEach((row, rIdx) => {
                row.forEach((content, cIdx) => {
                    cells.push({ rowIndex: rIdx, columnIndex: cIdx, content });
                });
            });

            tables.push({
                rowCount: grid.length,
                columnCount: 4,
                cells,
                boundingRegions: [{ pageNumber: 1 }]
            });
        }
    }

    // 2. Pipe-separated or CSV / Tab-separated / Multi-space Financial Tables
    // Look for lines that contain headers like Line item / Metric / Entity and period terms Q1 / FY / 2026
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        let headers = null;

        // Skip banner or disclaimer lines
        if (/approved|synthetic|disclaimer|prepared|status:/i.test(line)) {
            continue;
        }

        if (line.includes('|')) {
            const parts = line.split('|').map(s => s.trim()).filter(Boolean);
            if (parts.length >= 2 && /(line\s*item|\bmetric\b|\bentity\b|\bquarter\b|\bperiod\b|\brevenue\b|\bQ[1-4]\b|\bFY\s*\d{4}\b)/i.test(line)) {
                headers = parts;
            }
        } else if (line.includes(',') && /(line\s*item|\bmetric\b|\bentity\b|\bquarter\b|\bperiod\b|\brevenue\b|\bQ[1-4]\b|\bFY\s*\d{4}\b)/i.test(line)) {
            const parts = line.split(',').map(s => s.trim()).filter(Boolean);
            if (parts.length >= 2) {
                headers = parts;
            }
        } else if (/\t|\s{2,}/.test(line) && /(line\s*item|\bmetric\b|\bentity\b|\bquarter\b|\bperiod\b|\brevenue\b|\bQ[1-4]\b|\bFY\s*\d{4}\b)/i.test(line)) {
            const parts = line.split(/\t|\s{2,}/).map(s => s.trim()).filter(Boolean);
            if (parts.length >= 2) {
                headers = parts;
            }
        }

        if (headers && headers.length >= 2) {
            const grid = [headers];
            let rowIdx = i + 1;

            while (rowIdx < lines.length) {
                const nextLine = lines[rowIdx];
                if (/^[-|\s:=]+$/.test(nextLine)) {
                    rowIdx++;
                    continue;
                }

                let cols = null;
                if (nextLine.includes('|')) {
                    cols = nextLine.split('|').map(s => s.trim()).filter(Boolean);
                } else if (nextLine.includes(',')) {
                    cols = nextLine.split(',').map(s => s.trim());
                } else if (/\t|\s{2,}/.test(nextLine)) {
                    cols = nextLine.split(/\t|\s{2,}/).map(s => s.trim()).filter(Boolean);
                }

                // If line contains fewer columns or doesn't look like data row, stop
                if (cols && cols.length >= 2) {
                    grid.push(cols);
                    rowIdx++;
                } else {
                    break;
                }
            }

            if (grid.length >= 2) {
                const colCount = Math.max(...grid.map(g => g.length));
                const cells = [];
                grid.forEach((row, rIdx) => {
                    for (let cIdx = 0; cIdx < colCount; cIdx++) {
                        cells.push({ rowIndex: rIdx, columnIndex: cIdx, content: row[cIdx] || '' });
                    }
                });

                tables.push({
                    rowCount: grid.length,
                    columnCount: colCount,
                    cells,
                    boundingRegions: [{ pageNumber: 1 }]
                });

                i = rowIdx - 1; // advance scanner
            }
        }
    }

    return tables;
}

async function extractFromPdf(pdfBuffer) {
    try {
        const pdfModule = require('pdf-parse');
        let fullText = '';
        let rawPages = [];

        if (typeof pdfModule === 'function') {
            const parsed = await pdfModule(pdfBuffer);
            fullText = parsed.text || '';
            const pageTexts = fullText.split(/\f|\n(?=Page \d+)/);
            rawPages = pageTexts.map((text, i) => ({ num: i + 1, text }));
        } else if (pdfModule && pdfModule.PDFParse) {
            const parser = new pdfModule.PDFParse({ data: pdfBuffer });
            await parser.load();
            const textResult = await parser.getText();
            rawPages = textResult.pages || [];
            fullText = textResult.text || '';
        } else {
            throw new Error('Unsupported pdf-parse library format.');
        }

        const pages = rawPages.map((p, i) => ({
            pageNumber: p.num || (i + 1),
            text: p.text || ''
        }));

        if (!fullText) {
            fullText = pages.map(p => p.text).join('\n\n');
        }

        const tables = extractTablesFromPdfText(fullText, pages);
        const paragraphs = [];
        pages.forEach(p => {
            const rawParagraphs = p.text.split(/\n\s*\n/).map(s => s.trim()).filter(s => s.length > 20);
            rawParagraphs.forEach(para => {
                paragraphs.push({
                    content: para,
                    boundingRegions: [{ pageNumber: p.pageNumber }]
                });
            });
        });

        const markdownLines = [];
        pages.forEach(p => {
            markdownLines.push(`\n<!-- Page ${p.pageNumber} -->\n`);
            markdownLines.push(p.text.replace(/(\n|^)(\d+\.\s+[^\n]+)/g, '$1## $2'));
        });

        return {
            content: markdownLines.join('\n').trim(),
            pages,
            tables,
            paragraphs
        };
    } catch (err) {
        throw new AppError(`Local PDF extraction failed: ${err.message}`, 500);
    }
}

function extractFromExcel(excelBuffer, fileName = 'workbook.xlsx') {
    try {
        const workbook = xlsx.read(excelBuffer, { type: 'buffer' });
        const pages = [];
        const tables = [];
        const paragraphs = [];
        const markdownLines = [];

        workbook.SheetNames.forEach((sheetName, sIdx) => {
            const pageNumber = sIdx + 1;
            const worksheet = workbook.Sheets[sheetName];
            const jsonData = xlsx.utils.sheet_to_json(worksheet, { header: 1, defval: '' });

            if (jsonData.length === 0) return;

            const colCount = Math.max(...jsonData.map(row => row.length), 1);
            const cells = [];
            jsonData.forEach((row, rIdx) => {
                for (let cIdx = 0; cIdx < colCount; cIdx++) {
                    const val = row[cIdx] !== undefined ? String(row[cIdx]).trim() : '';
                    cells.push({ rowIndex: rIdx, columnIndex: cIdx, content: val });
                }
            });

            tables.push({
                rowCount: jsonData.length,
                columnCount: colCount,
                cells,
                sheetName,
                boundingRegions: [{ pageNumber }]
            });

            // Find the best header row index:
            // Often row 0 is a title/banner row with only 1 non-empty cell.
            // Search for the first row with at least 2 non-empty cells to use as column headers.
            let headerRowIdx = 0;
            for (let r = 0; r < Math.min(jsonData.length, 10); r++) {
                const nonEmptyCount = (jsonData[r] || []).filter(c => String(c ?? '').trim().length > 0).length;
                if (nonEmptyCount >= 2) {
                    headerRowIdx = r;
                    break;
                }
            }

            // Extract banner rows before headerRowIdx (e.g. Title, Entity, As-Of Date, Currency, Scale)
            const bannerLines = [];
            for (let r = 0; r < headerRowIdx; r++) {
                const lineText = (jsonData[r] || []).map(c => String(c ?? '').trim()).filter(Boolean).join('  |  ');
                if (lineText) {
                    bannerLines.push(lineText);
                    paragraphs.push({
                        content: lineText,
                        boundingRegions: [{ pageNumber }]
                    });
                }
            }

            const headers = (jsonData[headerRowIdx] || []).map(h => String(h || '').trim());
            const rawDataRows = jsonData.slice(headerRowIdx + 1);
            const dataRows = [];
            const footnoteLines = [];

            for (const r of rawDataRows) {
                const nonEmpty = (r || []).filter(c => String(c ?? '').trim().length > 0);
                if (nonEmpty.length === 0) continue;
                if (nonEmpty.length === 1 && String(nonEmpty[0]).length > 15) {
                    const noteText = String(nonEmpty[0]).trim();
                    footnoteLines.push(noteText);
                    paragraphs.push({
                        content: noteText,
                        boundingRegions: [{ pageNumber }]
                    });
                } else {
                    dataRows.push(r);
                }
            }

            const headerLine = `| ${headers.join(' | ')} |`;
            const sepLine = `| ${headers.map(() => '---').join(' | ')} |`;
            const rowLines = dataRows.map(r => `| ${headers.map((_, i) => String(r[i] ?? '')).join(' | ')} |`);
            const tableMarkdown = [headerLine, sepLine, ...rowLines].join('\n');

            const sectionBlocks = [];
            if (bannerLines.length > 0) sectionBlocks.push(bannerLines.join('\n\n'));
            sectionBlocks.push(tableMarkdown);
            if (footnoteLines.length > 0) sectionBlocks.push(footnoteLines.join('\n\n'));
            const fullSheetText = sectionBlocks.join('\n\n');

            markdownLines.push(`\n## Sheet: ${sheetName}\n\n${fullSheetText}\n`);
            pages.push({ pageNumber, text: fullSheetText });
            paragraphs.push({
                content: `Sheet ${sheetName} data table with ${dataRows.length} records.`,
                boundingRegions: [{ pageNumber }]
            });
        });

        return {
            content: markdownLines.join('\n').trim(),
            pages,
            tables,
            paragraphs
        };
    } catch (err) {
        throw new AppError(`Local Excel extraction failed: ${err.message}`, 500);
    }
}

function extractFromTextOrCsv(textBuffer, fileName = 'document.txt') {
    const rawText = textBuffer.toString('utf8');
    const isCsv = fileName.toLowerCase().endsWith('.csv') || rawText.includes(',');
    const pages = [{ pageNumber: 1, text: rawText }];
    const tables = [];
    const paragraphs = [];

    if (isCsv) {
        try {
            const workbook = xlsx.read(rawText, { type: 'string' });
            return extractFromExcel(xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' }), fileName);
        } catch (_) {}
    }

    const rawParagraphs = rawText.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
    rawParagraphs.forEach(para => {
        paragraphs.push({ content: para, boundingRegions: [{ pageNumber: 1 }] });
    });

    return {
        content: rawText,
        pages,
        tables,
        paragraphs
    };
}

async function extractDocumentLocally(fileBuffer, fileName = '') {
    const fn = (fileName || '').toLowerCase();
    const isPdf = fileBuffer.length >= 4 && fileBuffer.toString('utf8', 0, 4) === '%PDF';
    const isZip = fileBuffer.length >= 4 && fileBuffer[0] === 0x50 && fileBuffer[1] === 0x4B;

    if (fn.endsWith('.pdf') || isPdf) {
        return await extractFromPdf(fileBuffer);
    } else if (fn.endsWith('.xlsx') || fn.endsWith('.xls') || isZip) {
        return extractFromExcel(fileBuffer, fileName);
    } else {
        return extractFromTextOrCsv(fileBuffer, fileName);
    }
}

module.exports = {
    extractDocumentLocally,
    extractFromPdf,
    extractFromExcel,
    extractFromTextOrCsv,
    extractTablesFromPdfText
};
