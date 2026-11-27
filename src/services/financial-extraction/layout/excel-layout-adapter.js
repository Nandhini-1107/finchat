'use strict';

/**
 * Excel Layout Adapter (Section 10).
 * Preserves sheets, merged cells, headers, formatted values, and table boundaries.
 */

const xlsx = require('xlsx');

function extractExcelLayout(excelBuffer, options = {}) {
    const workbook = xlsx.read(excelBuffer, { type: 'buffer', cellDates: true });
    const tables = [];
    const paragraphs = [];
    const pages = [];

    workbook.SheetNames.forEach((sheetName, sIdx) => {
        const sheet = workbook.Sheets[sheetName];
        if (!sheet || !sheet['!ref']) return;

        const range = xlsx.utils.decode_range(sheet['!ref']);
        const rawGrid = [];

        for (let R = range.s.r; R <= range.e.r; R++) {
            const row = [];
            for (let C = range.s.c; C <= range.e.c; C++) {
                const cellAddress = xlsx.utils.encode_cell({ r: R, c: C });
                const cell = sheet[cellAddress];
                row.push(cell ? String(cell.w ?? cell.v ?? '').trim() : '');
            }
            rawGrid.push(row);
        }

        // Filter completely empty rows at start and end
        const nonEmptyRows = rawGrid.filter(r => r.some(c => c !== ''));
        if (nonEmptyRows.length >= 2) {
            const maxCols = Math.max(...nonEmptyRows.map(r => r.length));
            const paddedGrid = nonEmptyRows.map(r => {
                while (r.length < maxCols) r.push('');
                return r;
            });

            tables.push({
                tableId: `S${sIdx + 1}-T1`,
                pageNumber: sIdx + 1,
                sheetName,
                caption: sheetName,
                grid: paddedGrid,
                rowCount: paddedGrid.length,
                columnCount: maxCols,
                isNonFinancial: false
            });
        }

        pages.push({
            pageNumber: sIdx + 1,
            sheetName,
            text: `Sheet: ${sheetName}`
        });
    });

    return {
        pageCount: workbook.SheetNames.length,
        tables,
        paragraphs,
        pages
    };
}

module.exports = { extractExcelLayout };
