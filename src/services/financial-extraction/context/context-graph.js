'use strict';

const { extractCurrency, extractScale } = require('../numeric-normalizer');

/**
 * Scoped Document Context Graph (Section 16).
 * Indexed JavaScript Maps: Document -> Section -> Table/Paragraph -> Row/Column/Sentence.
 *
 * Rules:
 *  - Explicit candidate/local context overrides inherited defaults.
 *  - Entity transition resets prior entity's period and currency unless explicitly restated.
 *  - Never assumes a missing currency is USD.
 *  - Tracks contextEvidenceIds for every inherited field.
 */

const PERIOD_RE = /\b(FY\s*(?:20|19)?\d{2,4}|Q[1-4]\s*(?:FY)?\s*(?:20\d{2})?|H[12]\s*(?:FY)?\s*(?:20\d{2})?|20\d{2})\b/i;
const QUARTER_ENDED_RE = /\b(?:quarter|three\s+months)\s+ended\s+\d{1,2}\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2})\b/i;
const BASIS_RE = /\b(Actuals?|Budget(?:ed)?|Forecast(?:ed)?|Projected|Estimated|Target(?:ed)?|Requirement|Threshold|Variance)\b/i;
const SCOPE_RE = /\b(Consolidated|Standalone|Entity|Regional|Group|Segment|Subsidiary|Division)\b/i;
const AS_OF_RE = /\b(?:as\s+of|as\s+at|dated?)\s*[:\-]?\s*(\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4}|\d{4}[-\/]\d{1,2}[-\/]\d{1,2}|[A-Za-z]+\s+\d{1,2},?\s+\d{4}|\d{1,2}\s+[A-Za-z]+\s+\d{4})/i;
const ORG_RE = /\b([A-Z][A-Za-z0-9&.\-]*(?:\s+[A-Z][A-Za-z0-9&.\-]*){0,4}\s+(?:Logistics|Technologies|Holdings|Industries|Ventures|Group|Corp|Corporation|Inc|Ltd|Limited|LLC|LLP|PLC|GmbH|Bank|Capital|Partners|Solutions|Energy|Properties|Retail|Enterprises|Systems))\b/;
const COMPANY_FIELD_RE = /\b(?:Company|Organization|Entity|Org)\s*[:\-]\s*([A-Za-z0-9&'\-]+(?:\s+[A-Za-z0-9&'\-]+){0,4}?)(?=[.,;\n\r]|\s+(?:Currency|Reporting|Period|Fiscal|All|Date)|$)/i;
const CURRENCY_FIELD_RE = /\b(?:Reporting\s+Currency|Currency(?:\s+for\s+monetary\s+amounts)?)\s*[:\-]\s*([A-Za-z]{3})/i;

function normalizePeriodLabel(raw) {
    if (!raw) return null;
    const s = String(raw).trim();
    const fy = s.match(/^FY\s*(\d{2,4})$/i);
    if (fy) {
        const yr = fy[1].length === 2 ? `20${fy[1]}` : fy[1];
        return `FY ${yr}`;
    }
    const q = s.match(/^Q([1-4])\s*(?:FY)?\s*(\d{2,4})?$/i);
    if (q) {
        const yr = q[2] ? (q[2].length === 2 ? `20${q[2]}` : q[2]) : '';
        return yr ? `Q${q[1]} ${yr}` : `Q${q[1]}`;
    }
    return s;
}

function normalizeBasisLabel(raw) {
    if (!raw) return null;
    const l = String(raw).toLowerCase();
    if (l.startsWith('actual')) return 'Actual';
    if (l.startsWith('budget')) return 'Budget';
    if (l.startsWith('forecast') || l.startsWith('project') || l.startsWith('estimat')) return 'Forecast';
    if (l.startsWith('target')) return 'Target';
    if (l.startsWith('requirement')) return 'Requirement';
    if (l.startsWith('threshold')) return 'Threshold';
    if (l.startsWith('audit')) return 'Actual';
    return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
}

function extractContextSignals(text, evidencePrefix) {
    const signals = {
        entity: null,
        periodLabel: null,
        currency: null,
        scaleMultiplier: 1,
        reportingBasis: null,
        reportingScope: null,
        asOfDate: null,
        evidenceIds: []
    };
    if (!text) return signals;

    const curField = text.match(CURRENCY_FIELD_RE);
    if (curField) {
        signals.currency = curField[1].toUpperCase();
        signals.evidenceIds.push(`${evidencePrefix}-CURRENCY`);
    } else {
        const cur = extractCurrency(text);
        if (cur) {
            signals.currency = cur;
            signals.evidenceIds.push(`${evidencePrefix}-CURRENCY`);
        }
    }

    const { scaleMultiplier } = extractScale(text);
    if (scaleMultiplier > 1) {
        signals.scaleMultiplier = scaleMultiplier;
        signals.evidenceIds.push(`${evidencePrefix}-SCALE`);
    }

    const qeMatch = text.match(QUARTER_ENDED_RE);
    if (qeMatch) {
        const monthMap = {
            january: 1, february: 1, march: 1,
            april: 2, may: 2, june: 2,
            july: 3, august: 3, september: 3,
            october: 4, november: 4, december: 4
        };
        const qNum = monthMap[qeMatch[1].toLowerCase()];
        if (qNum) {
            signals.periodLabel = `Q${qNum} ${qeMatch[2]}`;
            signals.evidenceIds.push(`${evidencePrefix}-PERIOD`);
        }
    }
    if (!signals.periodLabel) {
        const pMatch = text.match(PERIOD_RE);
        if (pMatch) {
            signals.periodLabel = normalizePeriodLabel(pMatch[1]);
            signals.evidenceIds.push(`${evidencePrefix}-PERIOD`);
        }
    }

    const bMatch = text.match(BASIS_RE);
    if (bMatch) {
        signals.reportingBasis = normalizeBasisLabel(bMatch[1]);
        signals.evidenceIds.push(`${evidencePrefix}-BASIS`);
    }

    const sMatch = text.match(SCOPE_RE);
    if (sMatch) {
        signals.reportingScope = sMatch[1].charAt(0).toUpperCase() + sMatch[1].slice(1).toLowerCase();
        signals.evidenceIds.push(`${evidencePrefix}-SCOPE`);
    }

    const aMatch = text.match(AS_OF_RE);
    if (aMatch) {
        signals.asOfDate = aMatch[1].trim();
        signals.evidenceIds.push(`${evidencePrefix}-ASOF`);
    }

    const compMatch = text.match(COMPANY_FIELD_RE);
    if (compMatch) {
        signals.entity = compMatch[1].trim();
        signals.evidenceIds.push(`${evidencePrefix}-ENTITY`);
    } else {
        const eMatch = text.match(ORG_RE);
        if (eMatch) {
            signals.entity = eMatch[1].trim();
            signals.evidenceIds.push(`${evidencePrefix}-ENTITY`);
        }
    }

    return signals;
}

function buildContextGraph(layout) {
    const meta = layout.metadata || {};
    const combinedDocText = [
        meta.documentTitle,
        meta.issuer,
        meta.documentName ? String(meta.documentName).replace(/_/g, ' ') : '',
        meta.fullMarkdown ? String(meta.fullMarkdown).slice(0, 600) : ''
    ].filter(Boolean).join('\n');
    const docSignals = extractContextSignals(combinedDocText, 'DOC');

    const docContext = {
        entity: meta.entityHint || meta.issuer || docSignals.entity || null,
        periodLabel: meta.periodHint ? normalizePeriodLabel(meta.periodHint) : (meta.reportingPeriod ? normalizePeriodLabel(meta.reportingPeriod) : docSignals.periodLabel),
        currency: meta.currencyHint || docSignals.currency || null,
        scaleMultiplier: docSignals.scaleMultiplier || 1,
        reportingBasis: meta.reportingBasisHint ? normalizeBasisLabel(meta.reportingBasisHint) : (docSignals.reportingBasis || 'Actual'),
        reportingScope: meta.reportingScope || docSignals.reportingScope || null,
        asOfDate: meta.asOfDate || docSignals.asOfDate || null,
        dimensions: {},
        evidenceIds: [...docSignals.evidenceIds]
    };

    const tableContexts = new Map();
    for (const table of (layout.tables || [])) {
        const captionText = `${table.caption || ''} ${table.contextText || ''} ${table.note || ''} ${table.sheetName || ''}`.trim();
        const sig = extractContextSignals(captionText, `${table.tableId}-CAPTION`);

        // Entity switch guard: if table caption introduces a new entity without explicit period, do NOT inherit another entity's period or currency
        const entitySwitched = Boolean(
            sig.entity && docContext.entity && sig.entity.toLowerCase() !== docContext.entity.toLowerCase()
        );
        const effEntity = sig.entity || docContext.entity;
        const effPeriod = sig.periodLabel || (entitySwitched ? null : docContext.periodLabel);
        const effCurrency = sig.currency || (entitySwitched ? null : docContext.currency);
        const effScale = sig.scaleMultiplier > 1 ? sig.scaleMultiplier : (entitySwitched ? 1 : docContext.scaleMultiplier);

        tableContexts.set(table.tableId, {
            entity: effEntity,
            periodLabel: effPeriod,
            currency: effCurrency,
            scaleMultiplier: effScale,
            reportingBasis: sig.reportingBasis || docContext.reportingBasis,
            reportingScope: sig.reportingScope || docContext.reportingScope,
            asOfDate: sig.asOfDate || docContext.asOfDate,
            dimensions: { ...docContext.dimensions },
            evidenceIds: [...new Set([...docContext.evidenceIds, ...sig.evidenceIds])]
        });
    }

    const paragraphContexts = new Map();
    for (const para of (layout.paragraphs || [])) {
        const headingText = para.heading || '';
        const sig = extractContextSignals(headingText, `${para.blockId}-HEADING`);
        const entitySwitched = Boolean(
            sig.entity && docContext.entity && sig.entity.toLowerCase() !== docContext.entity.toLowerCase()
        );
        paragraphContexts.set(para.blockId, {
            entity: sig.entity || docContext.entity,
            periodLabel: sig.periodLabel || (entitySwitched ? null : docContext.periodLabel),
            currency: sig.currency || (entitySwitched ? null : docContext.currency),
            scaleMultiplier: sig.scaleMultiplier > 1 ? sig.scaleMultiplier : docContext.scaleMultiplier,
            reportingBasis: sig.reportingBasis || docContext.reportingBasis,
            reportingScope: sig.reportingScope || docContext.reportingScope,
            asOfDate: sig.asOfDate || docContext.asOfDate,
            dimensions: { ...docContext.dimensions },
            evidenceIds: [...new Set([...docContext.evidenceIds, ...sig.evidenceIds])]
        });
    }

    return {
        document: docContext,
        tables: tableContexts,
        paragraphs: paragraphContexts
    };
}

module.exports = {
    buildContextGraph,
    extractContextSignals,
    normalizePeriodLabel,
    normalizeBasisLabel,
    PERIOD_RE,
    BASIS_RE,
    SCOPE_RE,
    AS_OF_RE,
    ORG_RE
};
