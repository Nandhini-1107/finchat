'use strict';

const { reconstructTableHeaders } = require('../layout/header-reconstructor');
const { classifyColumnRoles } = require('./role-classifier');
const { detectTableOrientation } = require('./orientation-detector');
const { normalizeFinancialNumber } = require('../numeric-normalizer');
const { normalizePeriodLabel } = require('../context/context-graph');

/**
 * Dynamic Financial Table Unpivoting Engine (Section 19).
 * Supports Format A-G, nested row hierarchies (e.g. UAE Division -> Revenue),
 * multi-level headers, unknown metrics, unknown entities, and unknown dimensions.
 */

function extractTableFacts({ tables = [], contextGraph, candidateIndex }) {
    const facts = [];
    const missingCandidates = [];
    const processedTables = [];

    for (const table of tables) {
        const grid = table.grid || [];
        if (grid.length < 2) continue;

        const tblCtx = (contextGraph && contextGraph.tables.get(table.tableId)) || contextGraph?.document || {};
        const headerInfo = reconstructTableHeaders(table);
        const colRoles = classifyColumnRoles(grid, headerInfo.dataStartRow, headerInfo.columnHeaders);
        const plan = detectTableOrientation(colRoles, tblCtx);

        let activeGroupLabel = null; // For Format F nested row hierarchies (e.g. "UAE Division")

        for (let r = headerInfo.dataStartRow; r < grid.length; r++) {
            const row = grid[r] || [];
            if (row.every(c => String(c ?? '').trim() === '')) continue;

            // Check if this row is a section/division group header (only col 0 populated, rest empty)
            const nonEmptyCols = row.filter(c => String(c ?? '').trim() !== '').length;
            if (nonEmptyCols === 1 && plan.metricColumnIndex !== null && String(row[plan.metricColumnIndex] ?? '').trim() !== '') {
                activeGroupLabel = String(row[plan.metricColumnIndex]).trim();
                continue;
            }

            const rowMetric = plan.metricColumnIndex !== null ? String(row[plan.metricColumnIndex] ?? '').trim() : '';
            const rowEntity = plan.entityColumnIndex !== null ? String(row[plan.entityColumnIndex] ?? '').trim() : '';
            const rowPeriodRaw = plan.periodColumnIndex !== null ? String(row[plan.periodColumnIndex] ?? '').trim() : '';
            const rowPeriod = rowPeriodRaw ? normalizePeriodLabel(rowPeriodRaw) : null;
            const rowCurrency = plan.currencyColumnIndex !== null ? String(row[plan.currencyColumnIndex] ?? '').trim() : null;

            const rowDims = {};
            if (activeGroupLabel) rowDims.division = activeGroupLabel;
            for (const dc of plan.dimensionColumns) {
                const dv = String(row[dc.columnIndex] ?? '').trim();
                if (dv) rowDims[dc.rawHeader] = dv;
            }

            for (const valCol of plan.valueColumns) {
                const c = valCol.columnIndex;
                const rawCell = String(row[c] ?? '').trim();
                if (!rawCell) continue;

                const origRowIdx = (table.rowOffset || 0) + r;
                const origColIdx = (table.colOffset || 0) + c;
                const tLabel = String(table.tableId).startsWith('T') ? `T${table.tableId}` : `TT${table.tableId}`;
                const candidateId = `P${table.pageNumber || 1}-${tLabel}-R${origRowIdx}-C${origColIdx}`;

                let metric = null;
                let entity = null;
                const colDims = { ...rowDims, ...valCol.unknownDimensions };

                if (plan.orientation === 'MetricsAsColumns') {
                    metric = valCol.rawHeader;
                    entity = rowEntity || tblCtx.entity || null;
                } else if (plan.orientation === 'EntitiesAsColumns') {
                    metric = rowMetric;
                    entity = valCol.rawHeader;
                } else {
                    // MetricsAsRows or RecordBased
                    metric = rowMetric || valCol.rawHeader;
                    entity = rowEntity || tblCtx.entity || null;
                }

                if (!metric) continue;

                // Non-monetary check: percentages, ratios, employee counts do not inherit monetary scale
                const isNonMonetary = /%|ratio|multiple|employees|headcount|staff/i.test(metric) || /%|ratio|multiple|employees|headcount|staff/i.test(valCol.rawHeader);
                const effScale = isNonMonetary ? 1 : (valCol.scaleMultiplier > 1 ? valCol.scaleMultiplier : (tblCtx.scaleMultiplier || 1));
                const norm = normalizeFinancialNumber(rawCell, effScale);

                if (norm.isMissing) {
                    missingCandidates.push({ candidateId, rawValue: rawCell, reason: 'MissingValueMarker' });
                    continue;
                }
                if (norm.numericValue === null) continue;

                const isCountMetric = /\b(?:employees|headcount|staff|branches|stores|customers|users|units|vehicles)\b/i.test(metric);
                const isRatioMetric = /\b(?:ratio|multiple|factor)\b/i.test(metric);
                const periodLabel = valCol.periodLabel || rowPeriod || tblCtx.periodLabel || null;
                const currency = (norm.unit === 'Percentage' || norm.unit === 'Ratio' || isRatioMetric || isCountMetric)
                    ? null
                    : (norm.currency || rowCurrency || valCol.currency || tblCtx.currency || null);
                const reportingBasis = valCol.reportingBasis || tblCtx.reportingBasis || 'Actual';
                const reportingScope = valCol.reportingScope || tblCtx.reportingScope || null;

                // Collect context evidence IDs
                const contextEvidenceIds = [...(tblCtx.evidenceIds || [])];
                if (valCol.headerPath && valCol.headerPath.length > 0) {
                    contextEvidenceIds.push(`${table.tableId}-HEADER-C${c}`);
                }

                const unit = norm.unit === 'Percentage'
                    ? 'Percentage'
                    : (isRatioMetric || norm.unit === 'Ratio'
                        ? 'Ratio'
                        : (isCountMetric ? 'Count' : (currency ? 'Currency' : 'Amount')));
                const locText = table.sheetName
                    ? `Sheet "${table.sheetName}", Table ${table.tableId}, Row ${origRowIdx + 1}, Col ${origColIdx + 1}`
                    : `Page ${table.pageNumber || 1}, Table ${table.tableId}, Row ${origRowIdx + 1}, Col ${origColIdx + 1}`;

                facts.push({
                    candidateId,
                    metric,
                    originalMetricLabel: metric,
                    originalLabel: metric,
                    canonicalMetric: null,
                    mappingStatus: 'NewMetric',
                    entity,
                    entityType: 'Company',
                    entityMappingStatus: entity ? 'NewEntity' : 'Unmapped',
                    periodLabel,
                    asOfDate: valCol.asOfDate || tblCtx.asOfDate || null,
                    rawValue: rawCell,
                    numericValue: norm.numericValue,
                    normalizedValue: norm.numericValue,
                    exactDecimal: norm.exactDecimal,
                    currency,
                    unit,
                    normalizedUnit: unit,
                    scaleMultiplier: norm.scaleMultiplier,
                    reportingBasis,
                    reportingScope,
                    dimensions: colDims,
                    sourceType: 'Table',
                    sourcePage: table.pageNumber || 1,
                    sourceTableId: table.tableId,
                    sourceRow: origRowIdx,
                    sourceColumn: origColIdx,
                    sourceLocation: locText,
                    sourceLocationText: locText,
                    sourceLocationJson: {
                        sourceType: 'Table',
                        pageNumber: table.pageNumber || 1,
                        sheetName: table.sheetName || null,
                        tableId: table.tableId,
                        rowIndex: origRowIdx,
                        columnIndex: origColIdx,
                        headerPath: valCol.headerPath || [],
                        dimensions: colDims
                    },
                    sourceEvidence: `${metric} | ${rawCell}`,
                    contextEvidenceIds: [...new Set(contextEvidenceIds)],
                    extractionMethod: 'StructuredNLP',
                    validationStatus: 'Pending',
                    reviewReasons: norm.precisionLoss ? ['Numeric precision drift in JS Number'] : []
                });
            }
        }

        processedTables.push(table.tableId);
    }

    return { facts, missingCandidates, processedTables };
}

module.exports = { extractTableFacts };
