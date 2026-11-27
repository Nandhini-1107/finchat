'use strict';

const { ORG_RE } = require('../context/context-graph');

/**
 * Dynamic Table Orientation Detection (Section 11).
 * Supports:
 *  - Format A: Metrics as rows (Metric | FY2024 | FY2025)
 *  - Format B: Metrics as columns (Period | Revenue | Net Profit)
 *  - Format C: Record-based (Company | Metric | Period | Value)
 *  - Format D: Entities as columns (Metric | Contoso | Meridian)
 *  - Format E/F/G: Multi-dimension, nested row hierarchies, unfamiliar headers
 */

function detectTableOrientation(columnRoles, tableContext) {
    const metricCols = columnRoles.filter(c => c.role === 'Metric');
    const entityCols = columnRoles.filter(c => c.role === 'Entity');
    const periodCols = columnRoles.filter(c => c.role === 'ReportingPeriod');
    const valueCols = columnRoles.filter(c => c.role === 'NumericValue');
    const dimCols = columnRoles.filter(c => c.role === 'ReportingDimension');
    const currencyCols = columnRoles.filter(c => c.role === 'Currency');
    const unitCols = columnRoles.filter(c => c.role === 'Unit');

    const commonCols = {
        currencyColumnIndex: currencyCols[0] ? currencyCols[0].columnIndex : null,
        unitColumnIndex: unitCols[0] ? unitCols[0].columnIndex : null
    };

    // Format C: Record-based table (has explicit Metric column + Value column + optional Entity/Period columns)
    if (metricCols.length >= 1 && valueCols.length === 1 && (entityCols.length >= 1 || periodCols.length >= 1)) {
        return {
            orientation: 'RecordBased',
            metricColumnIndex: metricCols[0].columnIndex,
            entityColumnIndex: entityCols[0] ? entityCols[0].columnIndex : null,
            periodColumnIndex: periodCols[0] ? periodCols[0].columnIndex : null,
            valueColumns: valueCols,
            dimensionColumns: dimCols,
            ...commonCols
        };
    }

    // Format B: Metrics as columns (Period or Entity column on left, numeric value columns carry metric names in headers)
    if (metricCols.length === 0 && (periodCols.length >= 1 || entityCols.length >= 1) && valueCols.length >= 1) {
        return {
            orientation: 'MetricsAsColumns',
            metricColumnIndex: null,
            entityColumnIndex: entityCols[0] ? entityCols[0].columnIndex : null,
            periodColumnIndex: periodCols[0] ? periodCols[0].columnIndex : null,
            valueColumns: valueCols,
            dimensionColumns: dimCols,
            ...commonCols
        };
    }

    // Format D: Multiple entities as columns (Metric col on left, column headers are organization names)
    const entityHeaderCols = valueCols.filter(vc => ORG_RE.test(vc.rawHeader) || (!vc.periodLabel && !vc.reportingBasis && /^[A-Z][A-Za-z0-9&.\s]+$/.test(vc.rawHeader) && !/^(Comparison|Value|Amount|Total)/i.test(vc.rawHeader)));
    if (metricCols.length >= 1 && entityHeaderCols.length >= 2 && valueCols.every(vc => !vc.periodLabel)) {
        return {
            orientation: 'EntitiesAsColumns',
            metricColumnIndex: metricCols[0].columnIndex,
            entityColumnIndex: null,
            periodColumnIndex: null,
            valueColumns: valueCols,
            dimensionColumns: dimCols,
            ...commonCols
        };
    }

    // Format A / E / F / G: Metrics as rows (default matrix layout)
    const fallbackMetricIdx = metricCols[0]
        ? metricCols[0].columnIndex
        : (columnRoles[0] && columnRoles[0].role !== 'NumericValue' ? 0 : null);

    return {
        orientation: 'MetricsAsRows',
        metricColumnIndex: fallbackMetricIdx,
        entityColumnIndex: entityCols[0] ? entityCols[0].columnIndex : null,
        periodColumnIndex: periodCols[0] ? periodCols[0].columnIndex : null,
        valueColumns: valueCols,
        dimensionColumns: dimCols,
        ...commonCols
    };
}

module.exports = { detectTableOrientation };
