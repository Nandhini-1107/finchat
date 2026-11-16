const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
    CONTRACT_VERSION,
    getNormalizedDocumentSchema,
    createNormalizedDocument
} = require('../../../contracts/normalized-document');
const { validateNormalizedDocument } = require('../../../src/services/normalized-document-validator');

test('NormalizedDocumentV1 Contract & Validator Test Suite', async (t) => {

    await t.test('1. Schema Definition: Loads valid JSON Schema Draft 2020-12', () => {
        const schema = getNormalizedDocumentSchema();
        assert.ok(schema);
        assert.equal(schema.title, 'NormalizedDocumentV1');
        assert.equal(schema.properties.contractVersion.const, 'NormalizedDocumentV1');
        assert.ok(schema.$defs.element);
        assert.ok(schema.$defs.tableContext);
    });

    await t.test('2. Contract Factory: Creates valid NormalizedDocumentV1 skeleton', () => {
        const doc = createNormalizedDocument({
            documentId: 'doc-factory-123',
            fileName: 'Sample.xlsx',
            fileType: 'xlsx'
        });
        assert.equal(doc.contractVersion, CONTRACT_VERSION);
        assert.equal(doc.document.documentId, 'doc-factory-123');
        assert.equal(doc.document.fileName, 'Sample.xlsx');
        assert.deepEqual(doc.elements, []);

        const result = validateNormalizedDocument(doc);
        assert.equal(result.valid, true);
        assert.equal(result.errors.length, 0);
    });

    await t.test('3. Sample Fixtures: All 8 contract examples pass validation', () => {
        const examplesDir = path.join(__dirname, '../../..', 'contracts', 'examples');
        const files = fs.readdirSync(examplesDir).filter(f => f.endsWith('.json'));
        assert.equal(files.length, 8, 'Should have exactly 8 contract example fixtures');

        for (const file of files) {
            const filePath = path.join(examplesDir, file);
            const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            const res = validateNormalizedDocument(content);
            assert.equal(res.valid, true, `Fixture "${file}" failed validation: ${res.errors.join(', ')}`);
        }
    });

    await t.test('4. Invalid Contract Version: Rejects mismatched or missing version', () => {
        const doc = createNormalizedDocument({ documentId: 'doc-1' });
        doc.contractVersion = 'NormalizedDocumentV2'; // unsupported
        const res = validateNormalizedDocument(doc);
        assert.equal(res.valid, false);
        assert.ok(res.errors.some(e => e.includes('Invalid or missing contractVersion')));
    });

    await t.test('5. Missing Required Document ID: Rejects when documentId is absent or blank', () => {
        const doc = {
            contractVersion: CONTRACT_VERSION,
            document: { documentId: '' },
            elements: []
        };
        const res = validateNormalizedDocument(doc);
        assert.equal(res.valid, false);
        assert.ok(res.errors.some(e => e.includes('documentId')));
    });

    await t.test('6. Mismatched Element Document ID: Rejects element referencing another document', () => {
        const doc = createNormalizedDocument({ documentId: 'doc-parent-100' });
        doc.elements.push({
            elementId: 'el_1',
            documentId: 'doc-foreign-999', // Mismatched!
            elementType: 'paragraph',
            content: 'Sample text'
        });
        const res = validateNormalizedDocument(doc);
        assert.equal(res.valid, false);
        assert.ok(res.errors.some(e => e.includes('mismatched documentId')));
    });

    await t.test('7. Duplicate Element IDs: Rejects when two elements have the same ID', () => {
        const doc = createNormalizedDocument({ documentId: 'doc-100' });
        doc.elements.push(
            { elementId: 'dup_id', documentId: 'doc-100', elementType: 'paragraph', content: 'Para 1' },
            { elementId: 'dup_id', documentId: 'doc-100', elementType: 'paragraph', content: 'Para 2' }
        );
        const res = validateNormalizedDocument(doc);
        assert.equal(res.valid, false);
        assert.ok(res.errors.some(e => e.includes('Duplicate elementId detected')));
    });

    await t.test('8. Invalid Element Type: Rejects unsupported elementType', () => {
        const doc = createNormalizedDocument({ documentId: 'doc-100' });
        doc.elements.push({
            elementId: 'el_invalid_type',
            documentId: 'doc-100',
            elementType: 'chart_graphic', // Invalid!
            content: 'chart'
        });
        const res = validateNormalizedDocument(doc);
        assert.equal(res.valid, false);
        assert.ok(res.errors.some(e => e.includes('invalid elementType')));
    });

    await t.test('9. Invalid Column Index: Rejects negative or duplicate column index', () => {
        const doc = createNormalizedDocument({ documentId: 'doc-100' });
        doc.elements.push({
            elementId: 'table_1',
            documentId: 'doc-100',
            elementType: 'table',
            columns: [
                { columnIndex: -1, header: 'Negative Col' }
            ],
            rows: []
        });
        const res = validateNormalizedDocument(doc);
        assert.equal(res.valid, false);
        assert.ok(res.errors.some(e => e.includes('columnIndex must be a non-negative integer')));
    });

    await t.test('10. Invalid Cell Index: Rejects cell columnIndex exceeding column count', () => {
        const doc = createNormalizedDocument({ documentId: 'doc-100' });
        doc.elements.push({
            elementId: 'table_1',
            documentId: 'doc-100',
            elementType: 'table',
            columns: [
                { columnIndex: 0, header: 'Metric' },
                { columnIndex: 1, header: 'Value' }
            ],
            rows: [
                {
                    rowIndex: 0,
                    cells: [
                        { columnIndex: 0, value: 'Revenue' },
                        { columnIndex: 5, value: 12000 } // Index 5 exceeds 2 columns!
                    ]
                }
            ]
        });
        const res = validateNormalizedDocument(doc);
        assert.equal(res.valid, false);
        assert.ok(res.errors.some(e => e.includes('exceeds column count')));
    });

    await t.test('11. Duplicate and Blank Headers: Allowed and valid', () => {
        const doc = createNormalizedDocument({ documentId: 'doc-100' });
        doc.elements.push({
            elementId: 'table_1',
            documentId: 'doc-100',
            elementType: 'table',
            columns: [
                { columnIndex: 0, header: 'Amount' },
                { columnIndex: 1, header: 'Amount' }, // duplicate header
                { columnIndex: 2, header: '' }         // blank header
            ],
            rows: [
                {
                    rowIndex: 0,
                    cells: [
                        { columnIndex: 0, value: 100 },
                        { columnIndex: 1, value: 200 },
                        { columnIndex: 2, value: 'Note' }
                    ]
                }
            ]
        });
        const res = validateNormalizedDocument(doc);
        assert.equal(res.valid, true);
        assert.equal(res.errors.length, 0);
    });

    await t.test('12. Missing Optional Source Metadata: Allowed and valid without error', () => {
        const doc = createNormalizedDocument({ documentId: 'doc-100' });
        doc.elements.push({
            elementId: 'table_no_source',
            documentId: 'doc-100',
            elementType: 'table',
            // source is omitted
            columns: [{ columnIndex: 0, header: 'Col1' }],
            rows: []
        });
        const res = validateNormalizedDocument(doc);
        assert.equal(res.valid, true);
    });

    await t.test('13. Multi-Level Headers: headerPath array is validated and accepted', () => {
        const doc = createNormalizedDocument({ documentId: 'doc-100' });
        doc.elements.push({
            elementId: 'table_multi_headers',
            documentId: 'doc-100',
            elementType: 'table',
            columns: [
                { columnIndex: 0, header: 'Q1', headerPath: ['Contoso Retail', 'Actuals', 'Q1'] }
            ],
            rows: []
        });
        const res = validateNormalizedDocument(doc);
        assert.equal(res.valid, true);
    });

    await t.test('14. Empty Rows and Cells: Handled safely without error', () => {
        const doc = createNormalizedDocument({ documentId: 'doc-100' });
        doc.elements.push({
            elementId: 'table_empty_cells',
            documentId: 'doc-100',
            elementType: 'table',
            columns: [{ columnIndex: 0, header: 'A' }, { columnIndex: 1, header: 'B' }],
            rows: [
                {
                    rowIndex: 0,
                    isHeader: false,
                    rowType: 'empty',
                    cells: [
                        { columnIndex: 0, value: null, rawValue: null },
                        { columnIndex: 1, value: '', rawValue: '' }
                    ]
                }
            ]
        });
        const res = validateNormalizedDocument(doc);
        assert.equal(res.valid, true);
    });

    await t.test('15. Warning for Review Flags: Populates warnings array without failing validity', () => {
        const doc = createNormalizedDocument({ documentId: 'doc-100' });
        doc.elements.push({
            elementId: 'table_review_req',
            documentId: 'doc-100',
            elementType: 'table',
            structure: {
                rowCount: 1,
                columnCount: 1,
                requiresReview: true
            },
            columns: [{ columnIndex: 0, header: 'Metric' }],
            rows: []
        });
        const res = validateNormalizedDocument(doc);
        assert.equal(res.valid, true);
        assert.equal(res.warnings.length, 1);
        assert.ok(res.warnings[0].includes('requiresReview=true'));
    });
});

