const test = require('node:test');
const assert = require('node:assert/strict');
const xlsx = require('xlsx');

const { normalizeContent, normalizeTable } = require('../../../src/services/content-normalizer');
const { extractFromExcel } = require('../../../src/services/local-extractor');
const { validateNormalizedDocument } = require('../../../src/services/normalized-document-validator');

test('Phase 3.1 Verification and Regression Test Suite', async (t) => {

    await t.test('1. JSON Serialization & Deserialization: cellValues survives JSON round trip intact', () => {
        const sheetData = [
            ['Entity', 'Revenue', 'Net profit'],
            ['Contoso Retail LLC', '12480000', '1307124']
        ];
        const wb = xlsx.utils.book_new();
        const ws = xlsx.utils.aoa_to_sheet(sheetData);
        xlsx.utils.book_append_sheet(wb, ws, 'Actuals');
        const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

        const extracted = extractFromExcel(buffer, 'roundtrip.xlsx');
        const normalized = normalizeContent(extracted, 'doc-roundtrip-1');

        // Verify in-memory state
        const table = normalized.tables[0];
        assert.equal(table.rows[0].cellValues['Revenue'], '12480000');
        assert.equal(table.rows[0].cellsByHeader['Revenue'], '12480000');
        assert.equal(table.rows[0].cells[1].value, '12480000');

        // JSON round trip
        const serialized = JSON.stringify(normalized);
        const deserialized = JSON.parse(serialized);
        const desTable = deserialized.tables[0];

        // Positional array survives
        assert.equal(Array.isArray(desTable.rows[0].cells), true);
        assert.equal(desTable.rows[0].cells[1].value, '12480000');
        assert.equal(desTable.rows[0].cells[1].columnIndex, 1);

        // Serializable keyed representation survives perfectly!
        assert.equal(typeof desTable.rows[0].cellValues, 'object');
        assert.equal(desTable.rows[0].cellValues['Revenue'], '12480000');
        assert.equal(desTable.rows[0].cellValues['Net profit'], '1307124');
        assert.equal(desTable.rows[0].cellsByHeader['Revenue'], '12480000');

        // Deserialized object passes contract validation
        const valRes = validateNormalizedDocument(deserialized);
        assert.equal(valRes.valid, true);
    });

    await t.test('2. Three-Level Headers: Correctly detected and builds 3-part headerPath', () => {
        const sheetData = [
            ['Europe Region', 'Europe Region', 'Middle East', 'Middle East'],
            ['Retail Group', 'Retail Group', 'Logistics Group', 'Logistics Group'],
            ['Revenue', 'Net profit', 'Revenue', 'Net profit'],
            ['1000', '200', '800', '150']
        ];
        const wb = xlsx.utils.book_new();
        const ws = xlsx.utils.aoa_to_sheet(sheetData);
        xlsx.utils.book_append_sheet(wb, ws, 'ThreeLevel');
        const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

        const extracted = extractFromExcel(buffer, 'three_level.xlsx');
        const normalized = normalizeContent(extracted, 'doc-three-level');
        const table = normalized.tables[0];

        assert.equal(table.structure.hasMultiLevelHeaders, true);
        assert.equal(table.structure.headerRowIndex, 2);

        // Header path should contain 3 levels: Region -> Group -> Metric
        assert.deepEqual(table.columns[0].headerPath, ['Europe Region', 'Retail Group', 'Revenue']);
        assert.deepEqual(table.columns[1].headerPath, ['Europe Region', 'Retail Group', 'Net profit']);
        assert.deepEqual(table.columns[2].headerPath, ['Middle East', 'Logistics Group', 'Revenue__2']);
        assert.deepEqual(table.columns[3].headerPath, ['Middle East', 'Logistics Group', 'Net profit__2']);

        // Data rows should only contain row 3 (rows 0, 1, 2 are in the header block)
        assert.equal(table.rows.length, 1);
        assert.equal(table.rows[0].cells[0].value, '1000');
        assert.equal(table.rows[0].cells[2].value, '800');
    });

    await t.test('3. Title & Disclaimer Rows Preceding Headers: Does NOT pollute headerPath or trigger false multi-level', () => {
        const sheetData = [
            ['CONTOSO HOLDINGS FINANCIAL ACTUALS REPORT 2026', '', '', ''],
            ['Confidential - For Internal Management Use Only', '', '', ''],
            ['Currency: AED | As of Date: 30 June 2026', '', '', ''],
            ['Metric', 'Q1 2026', 'Q2 2026', 'FY 2026'],
            ['Revenue', '1000', '1200', '2200'],
            ['Cost of sales', '600', '700', '1300']
        ];
        const wb = xlsx.utils.book_new();
        const ws = xlsx.utils.aoa_to_sheet(sheetData);
        xlsx.utils.book_append_sheet(wb, ws, 'Report');
        const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

        const extracted = extractFromExcel(buffer, 'title_table.xlsx');
        const normalized = normalizeContent(extracted, 'doc-title-clean');
        const table = normalized.tables[0];

        assert.equal(table.structure.headerRowIndex, 3);
        assert.equal(table.structure.hasMultiLevelHeaders, false);

        // Header path must NOT contain title banner or currency notice
        assert.deepEqual(table.columns[0].headerPath, ['Metric']);
        assert.deepEqual(table.columns[1].headerPath, ['Q1 2026']);
        assert.deepEqual(table.columns[2].headerPath, ['Q2 2026']);
        assert.deepEqual(table.columns[3].headerPath, ['FY 2026']);

        // Data rows have rowType: data, while pre-header rows have rowType: banner
        const dataRows = table.rows.filter(r => r.rowType === 'data');
        assert.equal(dataRows.length, 2);
        assert.equal(dataRows[0].cells[0].value, 'Revenue');

        const bannerRows = table.rows.filter(r => r.rowType === 'banner');
        assert.equal(bannerRows.length, 3);
    });

    await t.test('4. Merged Excel Headers: Horizontal span correctly propagates across columns', () => {
        const wb = xlsx.utils.book_new();
        const ws = xlsx.utils.aoa_to_sheet([
            ['Contoso Retail', '', 'Contoso Logistics', ''],
            ['Q1 2026', 'Q2 2026', 'Q1 2026', 'Q2 2026'],
            ['1000', '1200', '800', '900']
        ]);
        ws['!merges'] = [
            { s: { r: 0, c: 0 }, e: { r: 0, c: 1 } },
            { s: { r: 0, c: 2 }, e: { r: 0, c: 3 } }
        ];
        xlsx.utils.book_append_sheet(wb, ws, 'Merged');
        const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

        const extracted = extractFromExcel(buffer, 'merged_hdr.xlsx');
        const normalized = normalizeContent(extracted, 'doc-merged-hdr');
        const table = normalized.tables[0];

        assert.equal(table.structure.hasMultiLevelHeaders, true);
        assert.deepEqual(table.columns[0].headerPath, ['Contoso Retail', 'Q1 2026']);
        assert.deepEqual(table.columns[1].headerPath, ['Contoso Retail', 'Q2 2026']);
        assert.deepEqual(table.columns[2].headerPath, ['Contoso Logistics', 'Q1 2026__2']);
        assert.deepEqual(table.columns[3].headerPath, ['Contoso Logistics', 'Q2 2026__2']);
    });

    await t.test('5. Duplicate Metric Headers under Different Periods: Preserved cleanly', () => {
        const sheetData = [
            ['', 'Q1 2026', 'Q1 2026', 'Q2 2026', 'Q2 2026'],
            ['Entity', 'Revenue', 'Net profit', 'Revenue', 'Net profit'],
            ['Apex Retail Corp', '1000', '200', '1200', '250']
        ];
        const wb = xlsx.utils.book_new();
        const ws = xlsx.utils.aoa_to_sheet(sheetData);
        ws['!merges'] = [
            { s: { r: 0, c: 1 }, e: { r: 0, c: 2 } },
            { s: { r: 0, c: 3 }, e: { r: 0, c: 4 } }
        ];
        xlsx.utils.book_append_sheet(wb, ws, 'Sheet1');
        const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

        const extracted = extractFromExcel(buffer, 'dup_metrics.xlsx');
        const normalized = normalizeContent(extracted, 'doc-dup-metrics');
        const table = normalized.tables[0];

        assert.equal(table.structure.hasMultiLevelHeaders, true);
        assert.deepEqual(table.columns[1].headerPath, ['Q1 2026', 'Revenue']);
        assert.deepEqual(table.columns[3].headerPath, ['Q2 2026', 'Revenue__2']);
        assert.equal(table.rows[0].cellValues['Revenue'], '1000');
        assert.equal(table.rows[0].cellValues['Revenue__2'], '1200');
    });

    await t.test('6. Genuine Excel Narrative Paragraphs: Standalone text is NOT marked as table duplicate', () => {
        const sheetData = [
            ['Code', 'Description'],
            ['A10', 'Asset 1'],
            ['', ''],
            ['Note 1: These financial statements have been reviewed by the independent auditor.', ''],
            ['Commentary: Revenue grew 5.0% on the first quarter, helped by the Eid trading period.', '']
        ];
        const wb = xlsx.utils.book_new();
        const ws = xlsx.utils.aoa_to_sheet(sheetData);
        xlsx.utils.book_append_sheet(wb, ws, 'Sheet1');
        const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

        const extracted = extractFromExcel(buffer, 'narrative_excel.xlsx');
        const normalized = normalizeContent(extracted, 'doc-excel-narrative');

        const notePara = normalized.paragraphs.find(p => p.content.includes('Note 1:'));
        assert.ok(notePara, 'Note 1 paragraph should exist');
        assert.equal(notePara.paragraphRole, 'footnote', 'Note should be classified as footnote, not table duplicate');

        const commPara = normalized.paragraphs.find(p => p.content.includes('Revenue grew 5.0%'));
        assert.ok(commPara, 'Commentary paragraph should exist');
        assert.equal(commPara.paragraphRole, 'commentary', 'Commentary should be classified as commentary, not table duplicate');
    });

    await t.test('7. Table-derived Paragraphs: Rows matching table data values ARE marked as duplicate', () => {
        const sheetData = [
            ['Entity', 'Quarter', 'Revenue'],
            ['Contoso Retail LLC', 'Q1 2026', '12480000']
        ];
        const wb = xlsx.utils.book_new();
        const ws = xlsx.utils.aoa_to_sheet(sheetData);
        xlsx.utils.book_append_sheet(wb, ws, 'Sheet1');
        const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

        const extracted = extractFromExcel(buffer, 'table_dup.xlsx');
        const normalized = normalizeContent(extracted, 'doc-table-dup');

        const dupPara = normalized.paragraphs.find(p => p.content.includes('Contoso Retail LLC | Q1 2026 | 12480000'));
        assert.ok(dupPara, 'Table row duplicate paragraph should exist');
        assert.equal(dupPara.paragraphRole, 'table_row_duplicate');
    });

    await t.test('8. PDF Narrative Paragraphs: Unmatched prose is NOT marked as duplicate', () => {
        const rawResult = {
            parser: 'local-pdf',
            content: 'Executive financial report overview for Contoso Retail LLC.\n\nAll operations complied with statutory regulations.\n\nRevenue reached AED 12.5 million for the quarter.',
            pages: [{ pageNumber: 1, text: '...' }],
            tables: [],
            paragraphs: [
                { content: 'Executive financial report overview for Contoso Retail LLC.', rawContent: '...' },
                { content: 'All operations complied with statutory regulations.', rawContent: '...' },
                { content: 'Revenue reached AED 12.5 million for the quarter.', rawContent: '...' }
            ]
        };

        const normalized = normalizeContent(rawResult, 'doc-pdf-narrative');
        assert.equal(normalized.paragraphs.length, 3);
        normalized.paragraphs.forEach(p => {
            assert.notEqual(p.paragraphRole, 'table_row_duplicate', 'PDF narrative must not be marked as table duplicate');
        });
    });
});
