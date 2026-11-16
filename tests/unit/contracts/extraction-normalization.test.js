const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const xlsx = require('xlsx');
const {
    extractDocumentLocally,
    extractFromExcel,
    extractFromTextOrCsv,
    extractPossiblePdfTables
} = require('../../../src/services/local-extractor');
const {
    normalizeContent,
    normalizeTable,
    detectHeader,
    buildGrid
} = require('../../../src/services/content-normalizer');

describe('Document Extraction & Content Normalization Suite', () => {

    // -------------------------------------------------------------------------
    // TEST 1: PDF with normal paragraphs
    // -------------------------------------------------------------------------
    it('Case 1: PDF with normal paragraphs extracts paragraphs without assuming table structure', async () => {
        const dummyText = 'This is an introductory executive overview of Contoso Holdings for FY2026.\n\nAll operations across Europe and the Middle East met statutory compliance targets.\n\nApproved by the Board of Directors.';
        const mockPage = { pageNumber: 1, text: dummyText };

        const tables = extractPossiblePdfTables(mockPage);
        assert.strictEqual(tables.length, 0, 'No false tables detected in paragraph text');

        const rawResult = {
            parser: 'local-pdf',
            content: dummyText,
            pages: [mockPage],
            tables: [],
            paragraphs: [
                { content: 'This is an introductory executive overview...', rawContent: 'This is an introductory executive overview...', boundingRegions: [{ pageNumber: 1 }] }
            ]
        };

        const normalized = normalizeContent(rawResult, 101);
        assert.strictEqual(normalized.tables.length, 0);
        assert.strictEqual(normalized.paragraphs.length, 1);
        assert.strictEqual(normalized.fullContent, dummyText);
    });

    // -------------------------------------------------------------------------
    // TEST 2: PDF with a table containing multiple columns
    // -------------------------------------------------------------------------
    it('Case 2: PDF with a table containing repeated multi-column lines detects possible table', () => {
        const tableLines = [
            'Executive Commentary on Financial Operations:',
            'Metric\tQ1 2026\tQ2 2026',
            'Revenue\t8900000\t9350000',
            'Operating Costs\t6100000\t6591800',
            'Net Income\t2800000\t2758200',
            'End of page notes.'
        ].join('\n');

        const mockPage = { pageNumber: 1, text: tableLines };
        const tables = extractPossiblePdfTables(mockPage);

        assert.strictEqual(tables.length, 1, 'Detected 1 candidate PDF table');
        assert.strictEqual(tables[0].columnCount, 3, 'Detected 3 columns');
        assert.strictEqual(tables[0].rowCount, 4, 'Detected 4 candidate rows (Header + 3 Data rows)');
        assert.strictEqual(tables[0].requiresReview, true, 'Marked as requiresReview for safety');

        const normalized = normalizeTable(tables[0], 0, 102);
        assert.strictEqual(normalized.headers[0], 'Metric');
        assert.strictEqual(normalized.headers[1], 'Q1 2026');
        assert.strictEqual(normalized.headers[2], 'Q2 2026');
        assert.strictEqual(normalized.rows.length, 3, 'Data rows count (excluding header)');
        assert.ok(Array.isArray(normalized.raw_cells), 'raw_cells metadata is preserved');
    });

    // -------------------------------------------------------------------------
    // TEST 3: Excel with headers in the first row
    // -------------------------------------------------------------------------
    it('Case 3: Excel with headers in the first row detects headers accurately', () => {
        const sheetData = [
            ['Product Line', 'Region', 'Units Sold', 'Total Revenue'],
            ['Cloud Hosting', 'EMEA', '1500', '450000'],
            ['SaaS Licenses', 'APAC', '3200', '960000']
        ];

        const wb = xlsx.utils.book_new();
        const ws = xlsx.utils.aoa_to_sheet(sheetData);
        xlsx.utils.book_append_sheet(wb, ws, 'Sales');
        const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

        const extracted = extractFromExcel(buffer, 'sales.xlsx');
        assert.strictEqual(extracted.tables.length, 1);
        assert.strictEqual(extracted.tables[0].rowCount, 3);
        assert.strictEqual(extracted.tables[0].columnCount, 4);

        const normalized = normalizeContent(extracted, 103);
        const table = normalized.tables[0];
        assert.strictEqual(table.headers[0], 'Product Line');
        assert.strictEqual(table.headers[3], 'Total Revenue');
        assert.strictEqual(table.header_row_index, 0);
        assert.strictEqual(table.rows.length, 2);
        assert.strictEqual(table.rows[0].cells['Product Line'], 'Cloud Hosting');
        assert.ok(table.raw_cells.length > 0, 'raw_cells preserved');
    });

    // -------------------------------------------------------------------------
    // TEST 4: Excel with a title and date before the headers
    // -------------------------------------------------------------------------
    it('Case 4: Excel with title and metadata rows before headers detects the true header row', () => {
        const sheetData = [
            ['CONTOSO LOGISTICS ENTERPRISE MANAGEMENT REPORT', '', ''],
            ['As of Date: June 30, 2026', '', ''],
            ['Confidential - For Internal Use Only', '', ''],
            ['Line Item', 'Budget AED', 'Actual AED', 'Variance AED'],
            ['Logistics Fleet Maintenance', '500000', '542000', '42000'],
            ['Driver Salaries & Overtime', '1200000', '1180000', '-20000']
        ];

        const wb = xlsx.utils.book_new();
        const ws = xlsx.utils.aoa_to_sheet(sheetData);
        xlsx.utils.book_append_sheet(wb, ws, 'Budget');
        const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

        const extracted = extractFromExcel(buffer, 'budget.xlsx');
        const normalized = normalizeContent(extracted, 104);

        const table = normalized.tables[0];
        assert.strictEqual(table.header_row_index, 3, 'Identified row index 3 as the header row');
        assert.strictEqual(table.headers[0], 'Line Item');
        assert.strictEqual(table.headers[1], 'Budget AED');
        assert.strictEqual(table.headers[2], 'Actual AED');
        assert.strictEqual(table.headers[3], 'Variance AED');
    });

    // -------------------------------------------------------------------------
    // TEST 5: Excel with duplicate column names
    // -------------------------------------------------------------------------
    it('Case 5: Excel with duplicate column names generates unique suffixed headers without data loss', () => {
        const sheetData = [
            ['Period', 'Amount', 'Amount', 'Amount'],
            ['Q1 2026', '100', '200', '300'],
            ['Q2 2026', '400', '500', '600']
        ];

        const wb = xlsx.utils.book_new();
        const ws = xlsx.utils.aoa_to_sheet(sheetData);
        xlsx.utils.book_append_sheet(wb, ws, 'Sheet1');
        const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

        const extracted = extractFromExcel(buffer, 'duplicates.xlsx');
        const normalized = normalizeContent(extracted, 105);
        const table = normalized.tables[0];

        assert.deepStrictEqual(table.headers, ['Period', 'Amount', 'Amount__2', 'Amount__3']);
        assert.strictEqual(table.rows[0].cells['Amount'], '100');
        assert.strictEqual(table.rows[0].cells['Amount__2'], '200');
        assert.strictEqual(table.rows[0].cells['Amount__3'], '300');
    });

    // -------------------------------------------------------------------------
    // TEST 6: Excel with merged cells and multiple sheets
    // -------------------------------------------------------------------------
    it('Case 6: Excel with merged cells and multiple sheets preserves all sheets and merge ranges', () => {
        const wb = xlsx.utils.book_new();

        // Sheet 1 with merged cells
        const ws1 = xlsx.utils.aoa_to_sheet([
            ['Quarterly Breakdown', ''],
            ['Q1', 'Q2']
        ]);
        ws1['!merges'] = [
            { s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }
        ];
        xlsx.utils.book_append_sheet(wb, ws1, 'Summary');

        // Sheet 2
        const ws2 = xlsx.utils.aoa_to_sheet([
            ['Account', 'Balance'],
            ['Cash', '50000']
        ]);
        xlsx.utils.book_append_sheet(wb, ws2, 'Balances');

        const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
        const extracted = extractFromExcel(buffer, 'multi_sheet.xlsx');

        assert.strictEqual(extracted.tables.length, 2, '2 sheets extracted into 2 tables');
        assert.strictEqual(extracted.tables[0].sheetName, 'Summary');
        assert.strictEqual(extracted.tables[0].mergedRanges.length, 1, 'Merge range preserved on Sheet 1');
        assert.strictEqual(extracted.tables[1].sheetName, 'Balances');

        const normalized = normalizeContent(extracted, 106);
        assert.strictEqual(normalized.tables.length, 2);
        assert.strictEqual(normalized.tables[0].merged_ranges.length, 1);
        assert.strictEqual(normalized.tables[1].sheet_name, 'Balances');
    });

    // -------------------------------------------------------------------------
    // TEST 7: Excel with blank rows and columns
    // -------------------------------------------------------------------------
    it('Case 7: Excel with blank rows and columns maintains full grid dimensions', () => {
        const sheetData = [
            ['Code', '', 'Description', ''],
            ['', '', '', ''],
            ['101', '', 'Inventory Assets', '']
        ];

        const wb = xlsx.utils.book_new();
        const ws = xlsx.utils.aoa_to_sheet(sheetData);
        xlsx.utils.book_append_sheet(wb, ws, 'SparseGrid');
        const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

        const extracted = extractFromExcel(buffer, 'sparse.xlsx');
        assert.strictEqual(extracted.tables[0].rowCount, 3);
        assert.strictEqual(extracted.tables[0].columnCount, 4);

        const normalized = normalizeContent(extracted, 107);
        const table = normalized.tables[0];
        assert.strictEqual(table.row_count, 3);
        assert.strictEqual(table.column_count, 4);
        assert.strictEqual(table.raw_grid.length, 3);
        assert.strictEqual(table.raw_grid[0].length, 4);
        assert.strictEqual(table.raw_cells.length, 12, 'All 12 cell positions in the used range are preserved');
    });
});

