'use strict';

const { normalizeFinancialNumber } = require('../numeric-normalizer');
const { PERIOD_RE, BASIS_RE, ORG_RE } = require('../context/context-graph');

/**
 * Dynamic Table Column Role Classifier (Section 10).
 * Classifies columns without hardcoded header requirements using cell distributions,
 * numeric density, period/entity/basis cues, and relative position.
 */

function classifyColumnRoles(grid, dataStartRow, columnHeaders) {
    const numRows = grid.length;
    const dataRows = grid.slice(dataStartRow);
    const roles = [];

    for (const colMeta of columnHeaders) {
        const c = colMeta.columnIndex;
        const headerLower = colMeta.rawHeader.toLowerCase();
        const pathLower = colMeta.headerPath.join(' ').toLowerCase();

        let nonEmpty = 0;
        let numericCount = 0;
        let periodCount = 0;
        let entityCueCount = 0;
        let textCount = 0;

        for (let r = 0; r < dataRows.length; r++) {
            const val = String((dataRows[r] && dataRows[r][c]) ?? '').trim();
            if (!val) continue;
            nonEmpty++;

            if (PERIOD_RE.test(val) && /^(?:FY|Q[1-4]|H[12]|\d{4})/i.test(val)) {
                periodCount++;
                continue;
            }
            const norm = normalizeFinancialNumber(val);
            if (!norm.isMissing && norm.numericValue !== null) {
                numericCount++;
            } else {
                textCount++;
                if (ORG_RE.test(val)) entityCueCount++;
            }
        }

        const numRatio = nonEmpty > 0 ? numericCount / nonEmpty : 0;
        const periodRatio = nonEmpty > 0 ? periodCount / nonEmpty : 0;
        const textRatio = nonEmpty > 0 ? textCount / nonEmpty : 0;

        let role = 'Unknown';
        const reasons = [];

        if (/\b(note|ref|footnote)\b/i.test(headerLower)) {
            role = 'NoteReference';
            reasons.push('Header indicates note reference');
        } else if (/\b(id|code|sl\.?\s*no|#)\b/i.test(headerLower) && numRatio > 0.5 && c === 0) {
            role = 'Identifier';
            reasons.push('Header indicates identifier column');
        } else if (periodRatio >= 0.6 || /\b(period|quarter|year|month|date)\b/i.test(headerLower)) {
            role = 'ReportingPeriod';
            reasons.push('Cells or header represent reporting periods');
        } else if (entityCueCount >= 2 || /\b(company|entity|subsidiary|division|organization|client|vendor)\b/i.test(headerLower)) {
            role = 'Entity';
            reasons.push('Cells or header indicate reporting entities');
        } else if (/\b(metric|particulars|description|item|indicator|measure|outcome|account|line\s*item)\b/i.test(headerLower)) {
            role = 'Metric';
            reasons.push('Header indicates metric label column');
        } else if (/\b(currency|curr|ccy)\b/i.test(headerLower) && textRatio > 0.6) {
            role = 'Currency';
            reasons.push('Currency column');
        } else if (/\b(unit|scale)\b/i.test(headerLower) && textRatio > 0.6) {
            role = 'Unit';
            reasons.push('Unit column');
        } else if (/\b(basis|actual|budget|forecast)\b/i.test(headerLower) && textRatio > 0.6 && !colMeta.periodLabel) {
            role = 'ReportingBasis';
            reasons.push('Reporting basis column');
        } else if (/\b(business\s*unit|department|segment|region|project|cost\s*cent(?:re|er)|channel|category)\b/i.test(headerLower) && textRatio > 0.5) {
            role = 'ReportingDimension';
            reasons.push('Reporting dimension column');
        } else if (numRatio >= 0.5 || (colMeta.periodLabel && numRatio > 0)) {
            role = 'NumericValue';
            reasons.push(`High numeric density (${Math.round(numRatio * 100)}%)`);
        } else if (textRatio >= 0.6 && c === 0) {
            role = 'Metric';
            reasons.push('Leading text-dominant label column');
        } else if (textRatio >= 0.6) {
            role = 'DescriptiveText';
            reasons.push('Text-dominant column');
        }

        // Preserve any extra non-period, non-basis header path segments as dimension labels (e.g. "Comparison A")
        const unknownDimensions = {};
        if (role === 'NumericValue' && !colMeta.periodLabel && !BASIS_RE.test(pathLower)) {
            const label = colMeta.rawHeader;
            if (label && !/^Column_\d+$/i.test(label) && !/^(value|amount|total)$/i.test(label)) {
                unknownDimensions.columnLabel = label;
            }
        }

        roles.push({
            ...colMeta,
            role,
            reasons,
            unknownDimensions
        });
    }

    return roles;
}

module.exports = { classifyColumnRoles };
