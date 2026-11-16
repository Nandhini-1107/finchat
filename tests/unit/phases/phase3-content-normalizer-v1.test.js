const test = require('node:test');
const assert = require('node:assert/strict');
const xlsx = require('xlsx');

const { normalizeContent, normalizeTable, normalizeParagraph } = require('../../../src/services/content-normalizer');
const { extractFromExcel, extractPossiblePdfTables } = require('../../../src/services/local-extractor');
const { validateNormalizedDocument } = require('../../../src/services/normalized-document-validator');

test('Phase 3: Content Normalizer V1 Contract Integration Test Suite', async (t) => {

    await t.test('1. Excel metrics in columns: Produces valid NormalizedDocumentV1', () => {
        const sheetData = [
            ['Entity', 'Quarter', 'Revenue', 'Net profit'],
            ['Contoso Retail LLC', 'Q1 2026', '12480000', '1307124'],
            ['Contoso Logistics LLC', 'Q1 2026', '8720000', '895895']
        ];
        const wb = xlsx.utils.book_new();
        const ws = xlsx.utils.aoa_to_sheet(sheetData);
        xlsx.utils.book_append_sheet(wb, ws, 'Actuals');
        const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

        const extracted = extractFromExcel(buffer, 'actuals.xlsx');
        const normalized = normalizeContent(extracted, 'doc-cols-101');

        assert.equal(normalized.contractVersion, 'NormalizedDocumentV1');
        assert.equal(normalized.document.documentId, 'doc-cols-101');
        assert.equal(normalized.elements.length > 0, true);

        const tableEl = normalized.elements.find(e => e.elementType === 'table');
        assert.ok(tableEl, 'Table element should exist');
        assert.equal(tableEl.columns.length, 4);
        assert.equal(tableEl.columns[0].header, 'Entity');
        assert.equal(tableEl.columns[2].header, 'Revenue');
        assert.equal(tableEl.columns[2].dataTypeHint, 'numeric');

        // Check positional row and cells
        assert.equal(tableEl.rows.length, 2);
        assert.equal(tableEl.rows[0].cells[0].value, 'Contoso Retail LLC');
        assert.equal(tableEl.rows[0].cells[2].value, '12480000');
        assert.equal(tableEl.rows[0].rawValues[2], '12480000');

        // Dual legacy key access
        assert.equal(tableEl.rows[0].cells['Revenue'], '12480000');

        assert.equal(normalized.validation.valid, true);
    });

    await t.test('2. Excel metrics in rows: Produces valid time-series structure', () => {
        const sheetData = [
            ['Line Item', 'Q1 2026', 'Q2 2026'],
            ['Revenue', '12480000', '13105000'],
            ['Cost of Sales', '-7862400', '-8190600'],
            ['Gross Profit', '4617600', '4914400']
        ];
        const wb = xlsx.utils.book_new();
        const ws = xlsx.utils.aoa_to_sheet(sheetData);
        xlsx.utils.book_append_sheet(wb, ws, 'P&L');
        const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

        const extracted = extractFromExcel(buffer, 'pnl.xlsx');
        const normalized = normalizeContent(extracted, 'doc-rows-102');

        const table = normalized.tables[0];
        assert.equal(table.columns.length, 3);
        assert.equal(table.columns[0].header, 'Line Item');
        assert.equal(table.columns[1].header, 'Q1 2026');
        assert.equal(table.rows.length, 3);

        assert.equal(table.rows[0].cells[0].value, 'Revenue');
        assert.equal(table.rows[0].cells[1].value, '12480000');
        assert.equal(table.rows[0].cells['Q1 2026'], '12480000');

        assert.equal(normalized.validation.valid, true);
    });

    await t.test('3. Duplicate and blank headers: Preserves data without loss', () => {
        const sheetData = [
            ['Metric', 'Amount', 'Amount', ''],
            ['Sales', '100', '200', 'Note A']
        ];
        const wb = xlsx.utils.book_new();
        const ws = xlsx.utils.aoa_to_sheet(sheetData);
        xlsx.utils.book_append_sheet(wb, ws, 'Sheet1');
        const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

        const extracted = extractFromExcel(buffer, 'dup_headers.xlsx');
        const normalized = normalizeContent(extracted, 'doc-dup-103');

        const table = normalized.tables[0];
        assert.equal(table.columns.length, 4);
        assert.equal(table.columns[1].header, 'Amount');
        assert.equal(table.columns[2].header, 'Amount__2');
        assert.equal(table.columns[3].rawHeader, '');

        assert.equal(table.rows[0].cells[1].value, '100');
        assert.equal(table.rows[0].cells[2].value, '200');
        assert.equal(table.rows[0].cells[3].value, 'Note A');
        assert.equal(table.rows[0].cells['Amount__2'], '200');

        assert.equal(normalized.validation.valid, true);
    });

    await t.test('4. Multi-level headers: Traces hierarchical header paths', () => {
        const sheetData = [
            ['Contoso Retail', 'Contoso Retail', 'Contoso Logistics', 'Contoso Logistics'],
            ['Revenue', 'Net profit', 'Revenue', 'Net profit'],
            ['12480000', '1307124', '8720000', '895895']
        ];
        const wb = xlsx.utils.book_new();
        const ws = xlsx.utils.aoa_to_sheet(sheetData);
        xlsx.utils.book_append_sheet(wb, ws, 'MultiHeader');
        const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

        const extracted = extractFromExcel(buffer, 'multi_hdr.xlsx');
        // header detection identifies row 1 as header
        const normalized = normalizeContent(extracted, 'doc-multihdr-104');

        const table = normalized.tables[0];
        assert.ok(table.structure.hasMultiLevelHeaders);
        assert.equal(table.columns[0].headerPath[0], 'Contoso Retail');
        assert.equal(table.columns[0].headerPath[1], 'Revenue');
        assert.equal(table.columns[2].headerPath[0], 'Contoso Logistics');
        assert.equal(table.columns[2].headerPath[1], 'Revenue__2');

        assert.equal(normalized.validation.valid, true);
    });

    await t.test('5. Excel formulas and source addresses: Preserved in cell objects', () => {
        const wb = xlsx.utils.book_new();
        const ws = {
            '!ref': 'A1:B2',
            A1: { t: 's', v: 'Rate', w: 'Rate' },
            B1: { t: 's', v: 'Cost', w: 'Cost' },
            A2: { t: 'n', v: 25, w: '25' },
            B2: { t: 'n', v: 100, f: 'A2*4', w: '100' }
        };
        xlsx.utils.book_append_sheet(wb, ws, 'Formulas');
        const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

        const extracted = extractFromExcel(buffer, 'calc.xlsx');
        const normalized = normalizeContent(extracted, 'doc-calc-105');

        const table = normalized.tables[0];
        const costCell = table.rows[0].cells[1];
        assert.equal(costCell.formula, 'A2*4');
        assert.equal(costCell.sourceAddress, 'B2');
        assert.equal(costCell.formattedValue, '100');
        assert.equal(costCell.value, '100');

        assert.equal(normalized.validation.valid, true);
    });

    await t.test('6. PDF tables with page and bounding regions: Preserves source coordinates', () => {
        const mockTable = {
            rowCount: 3,
            columnCount: 2,
            cells: [
                { rowIndex: 0, columnIndex: 0, content: 'Account' },
                { rowIndex: 0, columnIndex: 1, content: 'Balance' },
                { rowIndex: 1, columnIndex: 0, content: 'Cash' },
                { rowIndex: 1, columnIndex: 1, content: '50000' }
            ],
            extractionMethod: 'pdf_whitespace_heuristic',
            boundingRegions: [{ pageNumber: 4, polygon: [1, 2, 3, 4] }],
            sourceLocation: { pageNumber: 4 }
        };

        const rawResult = {
            parser: 'local-pdf',
            content: 'PDF content',
            pages: [{ pageNumber: 4, text: 'PDF content' }],
            tables: [mockTable],
            paragraphs: []
        };

        const normalized = normalizeContent(rawResult, 'doc-pdf-106');
        const table = normalized.tables[0];
        assert.equal(table.source.pageNumber, 4);
        assert.equal(table.source.boundingRegions.length, 1);
        assert.equal(table.source.boundingRegions[0].pageNumber, 4);
        assert.equal(normalized.validation.valid, true);
    });

    await t.test('7. Narrative paragraphs: Identifies paragraphRole appropriately', () => {
        const rawResult = {
            parser: 'local-pdf',
            content: 'Approved by the Board of Directors on 15 July 2026.\n\nCurrency of reporting is AED.',
            pages: [{ pageNumber: 1, text: 'Approved...' }],
            tables: [],
            paragraphs: [
                { content: 'Approved by the Board of Directors on 15 July 2026.', rawContent: 'Approved...', boundingRegions: [{ pageNumber: 1 }] },
                { content: 'Currency of reporting is AED.', rawContent: 'Currency of reporting is AED.', boundingRegions: [{ pageNumber: 1 }] }
            ]
        };

        const normalized = normalizeContent(rawResult, 'doc-para-107');
        assert.equal(normalized.paragraphs.length, 2);
        assert.equal(normalized.paragraphs[0].paragraphRole, 'approval');
        assert.equal(normalized.paragraphs[1].paragraphRole, 'currency_declaration');
        assert.equal(normalized.validation.valid, true);
    });

    await t.test('8. Table-derived paragraphs: Flags Excel row duplicates without deleting them', () => {
        const sheetData = [
            ['Code', 'Name'],
            ['A10', 'Asset 1']
        ];
        const wb = xlsx.utils.book_new();
        const ws = xlsx.utils.aoa_to_sheet(sheetData);
        xlsx.utils.book_append_sheet(wb, ws, 'Sheet1');
        const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

        const extracted = extractFromExcel(buffer, 'dup_row.xlsx');
        const normalized = normalizeContent(extracted, 'doc-table-para-108');

        // Excel rows copied to paragraphs should have table_row_duplicate role
        assert.ok(normalized.paragraphs.length > 0);
        assert.equal(normalized.paragraphs[0].paragraphRole, 'table_row_duplicate');
        assert.equal(normalized.validation.valid, true);
    });

    await t.test('9. Missing optional metadata: Succeeds without validation error', () => {
        const rawResult = {
            parser: 'local-text',
            content: 'Simple text document',
            pages: [{ pageNumber: 1, text: 'Simple text document' }],
            tables: [],
            paragraphs: [{ content: 'Simple text document' }]
        };

        const normalized = normalizeContent(rawResult, 'doc-missing-meta-109');
        assert.equal(normalized.contractVersion, 'NormalizedDocumentV1');
        assert.equal(normalized.document.documentId, 'doc-missing-meta-109');
        assert.deepEqual(normalized.document.metadata, {});
        assert.equal(normalized.document.sourceMetadata, null);
        assert.equal(normalized.validation.valid, true);
    });

    await t.test('10. Consistent document IDs: Enforces same documentId across all child elements', () => {
        const sheetData = [
            ['Header A', 'Header B'],
            ['Val 1', 'Val 2']
        ];
        const wb = xlsx.utils.book_new();
        const ws = xlsx.utils.aoa_to_sheet(sheetData);
        xlsx.utils.book_append_sheet(wb, ws, 'Sheet1');
        const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

        const extracted = extractFromExcel(buffer, 'id_check.xlsx');
        const normalized = normalizeContent(extracted, 'doc-canonical-999');

        assert.equal(normalized.document.documentId, 'doc-canonical-999');
        assert.equal(normalized.document_id, 'doc-canonical-999');

        normalized.elements.forEach(el => {
            assert.equal(el.documentId, 'doc-canonical-999', `Element ${el.elementId} must have matching documentId`);
            assert.equal(el.document_id, 'doc-canonical-999', `Legacy document_id on ${el.elementId} must match`);
        });

        assert.equal(normalized.validation.valid, true);
    });

    await t.test('11. Equivalence of new and legacy structures', () => {
        const sheetData = [
            ['Metric', 'Q1 2026'],
            ['Operating Revenue', '5000000']
        ];
        const wb = xlsx.utils.book_new();
        const ws = xlsx.utils.aoa_to_sheet(sheetData);
        xlsx.utils.book_append_sheet(wb, ws, 'Equivalence');
        const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

        const extracted = extractFromExcel(buffer, 'equiv.xlsx');
        const normalized = normalizeContent(extracted, 'doc-equiv-111');

        const table = normalized.tables[0];
        assert.equal(table.columns.length, table.headers.length);

        // Value in positional cell
        const cellPositionalVal = table.rows[0].cells[1].value;
        // Value in legacy keyed lookup
        const cellKeyedVal = table.rows[0].cells['Q1 2026'];
        // Value in rawValues
        const rawVal = table.rows[0].rawValues[1];

        assert.equal(cellPositionalVal, '5000000');
        assert.equal(cellKeyedVal, '5000000');
        assert.equal(rawVal, '5000000');
        assert.equal(cellPositionalVal, cellKeyedVal);
    });

    await t.test('12. Contract validation after normalization: Returns valid result without errors', () => {
        const sheetData = [
            ['Col 1', 'Col 2'],
            ['10', '20']
        ];
        const wb = xlsx.utils.book_new();
        const ws = xlsx.utils.aoa_to_sheet(sheetData);
        xlsx.utils.book_append_sheet(wb, ws, 'Sheet1');
        const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

        const extracted = extractFromExcel(buffer, 'validate.xlsx');
        const normalized = normalizeContent(extracted, 'doc-valid-112');

        assert.ok(normalized.validation);
        assert.equal(normalized.validation.valid, true);
        assert.equal(normalized.validation.errors.length, 0);

        // Also test independent validation directly
        const directVal = validateNormalizedDocument(normalized);
        assert.equal(directVal.valid, true);
        assert.equal(directVal.errors.length, 0);
    });
});

