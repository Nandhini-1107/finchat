'use strict';

const { normalizeFinancialNumber, extractCurrency, extractScale } = require('../numeric-normalizer');
const {
    PERIOD_RE,
    BASIS_RE,
    SCOPE_RE,
    AS_OF_RE,
    normalizePeriodLabel,
    normalizeBasisLabel
} = require('../context/context-graph');

/**
 * Hierarchical Header Reconstruction (Section 12).
 * Detects 1 or more header rows, forward-fills merged/sparse parent headers
 * across columns, and constructs complete headerPath + semantic attributes once per table.
 */

function isNumericDataRow(row) {
    if (!row || row.length === 0) return false;
    let numericCells = 0;
    for (let c = 0; c < row.length; c++) {
        const val = String(row[c] ?? '').trim();
        if (!val) continue;
        if (PERIOD_RE.test(val) && /^(?:FY|Q[1-4]|H[12]|\d{4})/i.test(val)) continue;
        const norm = normalizeFinancialNumber(val);
        if (!norm.isMissing && norm.numericValue !== null) numericCells++;
    }
    return numericCells > 0;
}

function reconstructTableHeaders(table) {
    const grid = table.grid || [];
    if (grid.length === 0) {
        return { headerRowCount: 0, dataStartRow: 0, columnHeaders: [] };
    }

    // Find first row containing numeric observation cells OR a single-cell row-hierarchy divider (e.g. "UAE Division")
    let dataStartRow = 1;
    for (let r = 1; r < Math.min(grid.length, 5); r++) {
        const row = grid[r] || [];
        const nonEmptyCols = row.filter(c => String(c ?? '').trim() !== '').length;
        if (isNumericDataRow(row) || (nonEmptyCols === 1 && String(row[0] ?? '').trim() !== '')) {
            dataStartRow = r;
            break;
        }
    }
    if (dataStartRow >= grid.length) dataStartRow = Math.min(1, grid.length - 1);

    const numCols = Math.max(...grid.map(r => r.length));
    const headerRows = grid.slice(0, dataStartRow);

    // Forward-fill sparse upper header rows (for merged group headers like "FY2025 | [empty] | FY2026 | [empty]")
    const filledHeaderRows = headerRows.map((row, rIdx) => {
        if (rIdx === headerRows.length - 1) return row;
        const out = [];
        let lastVal = '';
        for (let c = 0; c < numCols; c++) {
            const v = String(row[c] ?? '').trim();
            if (v !== '') {
                lastVal = v;
                out.push(v);
            } else {
                // Only carry forward into data columns (c >= 1) when previous header wasn't a col-0 metric label
                out.push(c > 0 && lastVal && !/^(metric|particulars|description|item|period)$/i.test(lastVal) ? lastVal : '');
            }
        }
        return out;
    });

    const columnHeaders = [];
    for (let c = 0; c < numCols; c++) {
        const headerPath = [];
        for (let r = 0; r < filledHeaderRows.length; r++) {
            const cell = String(filledHeaderRows[r][c] ?? '').trim();
            if (cell && !headerPath.includes(cell)) headerPath.push(cell);
        }

        const combined = headerPath.join(' ');
        const asOfMatch = combined.match(AS_OF_RE);
        const periodMatch = combined.match(PERIOD_RE);
        const isPureAsOfYear = asOfMatch && periodMatch && /^\d{4}$/.test(periodMatch[1].trim());
        const basisMatch = combined.match(BASIS_RE);
        const scopeMatch = combined.match(SCOPE_RE);
        const currency = extractCurrency(combined);
        const { scaleMultiplier } = extractScale(combined);

        columnHeaders.push({
            columnIndex: c,
            headerPath,
            rawHeader: headerPath[headerPath.length - 1] || `Column_${c + 1}`,
            periodLabel: (periodMatch && !isPureAsOfYear) ? normalizePeriodLabel(periodMatch[1]) : null,
            asOfDate: asOfMatch ? asOfMatch[1].trim() : null,
            reportingBasis: basisMatch ? normalizeBasisLabel(basisMatch[1]) : null,
            reportingScope: scopeMatch ? scopeMatch[1] : null,
            currency,
            scaleMultiplier
        });
    }

    return {
        headerRowCount: dataStartRow,
        dataStartRow,
        columnHeaders
    };
}

module.exports = { reconstructTableHeaders, isNumericDataRow };
