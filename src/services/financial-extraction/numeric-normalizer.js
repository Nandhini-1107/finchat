'use strict';

const { Decimal } = require('../../utils/decimal');
const { normalizeArabicDigits } = require('../arabic-normalizer');

/**
 * Exact Financial Numerical Normalization using Decimal (Section 25).
 * Supports Western, Indian (lakhs/crores & 1,25,00,000), European (1.250.000,50),
 * Arabic-Indic digits (٠-٩, ٫, ٬), accounting bracket negatives, percentages,
 * ratios, counts, and missing markers.
 *
 * Rules enforced:
 *  - Never defaults missing currency to USD.
 *  - Never applies monetary scale multipliers to percentages, ratios, or counts.
 *  - Missing-value markers ('N/A', '-', '--', '—', 'nil') stay null (never 0).
 */

const SCALE_MAP = new Map([
    ['trillion', '1000000000000'],
    ['trillions', '1000000000000'],
    ['tn', '1000000000000'],
    ['billion', '1000000000'],
    ['billions', '1000000000'],
    ['bn', '1000000000'],
    ['مليار', '1000000000'],
    ['مليارات', '1000000000'],
    ['crore', '10000000'],
    ['crores', '10000000'],
    ['cr', '10000000'],
    ['million', '1000000'],
    ['millions', '1000000'],
    ['mn', '1000000'],
    ['مليون', '1000000'],
    ['ملايين', '1000000'],
    ['lakh', '100000'],
    ['lakhs', '100000'],
    ['lac', '100000'],
    ['lacs', '100000'],
    ['thousand', '1000'],
    ['thousands', '1000'],
    ['k', '1000'],
    ['ألف', '1000'],
    ['الف', '1000'],
    ['آلاف', '1000']
]);

const MISSING_MARKERS = new Set(['', '-', '--', '—', '–', 'n/a', 'na', 'nil', 'none', 'null', '.', '..']);

const CURRENCY_PATTERNS = [
    { re: /\bAED\b|د\.إ|درهم(?:\s+إماراتي)?/i, code: 'AED' },
    { re: /\bSAR\b|ر\.س|ريال(?:\s+سعودي)?/i, code: 'SAR' },
    { re: /\bUSD\b|دولار(?:\s+أمريكي)?/i, code: 'USD' },
    { re: /\bEUR\b|€|يورو/i, code: 'EUR' },
    { re: /\bGBP\b|£|جنيه\s+إسترليني/i, code: 'GBP' },
    { re: /\bINR\b|₹|روبية/i, code: 'INR' },
    { re: /\bQAR\b/i, code: 'QAR' },
    { re: /\bKWD\b|دينار/i, code: 'KWD' },
    { re: /\bBHD\b/i, code: 'BHD' },
    { re: /\bOMR\b/i, code: 'OMR' },
    { re: /\bEGP\b|جنيه/i, code: 'EGP' },
    { re: /\bCAD\b/i, code: 'CAD' },
    { re: /\bAUD\b/i, code: 'AUD' },
    { re: /\bJPY\b|¥/i, code: 'JPY' }
];

function extractCurrency(text) {
    if (!text) return null;
    for (const { re, code } of CURRENCY_PATTERNS) {
        if (re.test(text)) return code;
    }
    if (/\$/.test(text)) return 'USD';
    return null;
}

function extractScale(text) {
    if (!text) return { scaleMultiplier: 1, scaleLabel: null };
    const lower = String(text).toLowerCase();
    // Match multi-char words first with boundaries
    const wordMatch = lower.match(/(?:^|[\s\d(])(trillions?|billions?|crores?|millions?|lakhs?|lacs?|thousands?|bn|mn|cr|tn|k|مليارات|مليار|ملايين|مليون|ألف|الف|آلاف)(?=$|[\s).,;:])/i);
    if (wordMatch) {
        const key = wordMatch[1].toLowerCase();
        const mult = SCALE_MAP.get(key);
        if (mult) return { scaleMultiplier: Number(mult), scaleLabel: key };
    }
    return { scaleMultiplier: 1, scaleLabel: null };
}

/**
 * Parse a numeric string handling Western, Indian, and European grouping,
 * as well as wrapped newline numbers (e.g. "8,500,00\n0" -> "8500000").
 */
function parseNormalizedNumberString(numStr) {
    if (!numStr) return null;
    let s = String(numStr).replace(/\r?\n/g, '').replace(/\s+/g, '');

    // European format: e.g. 1.250.000,50 or 1.250,50 (dots for thousands, comma for decimal)
    if (/^\d{1,3}(\.\d{3})+,\d+$/.test(s) || /^\d+,\d{1,2}$/.test(s)) {
        s = s.replace(/\./g, '').replace(',', '.');
    } else if (/^\d{1,2}(,\d{2})+,\d{3}(\.\d+)?$/.test(s)) {
        // Indian grouping: 1,25,00,000 or 12,50,000.50
        s = s.replace(/,/g, '');
    } else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) {
        // Standard Western commas: 8,500,000 or 1,250,000.50
        s = s.replace(/,/g, '');
    } else {
        // Remove commas if followed by digits
        s = s.replace(/,/g, '');
    }

    if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
    return s;
}

function normalizeFinancialNumber(rawInput, inheritedScale = 1) {
    if (rawInput === null || rawInput === undefined) {
        return { isMissing: true, numericValue: null, exactDecimal: null, currency: null, unit: 'Missing', scaleMultiplier: 1 };
    }

    if (typeof rawInput === 'number') {
        if (!Number.isFinite(rawInput)) {
            return { isMissing: true, numericValue: null, exactDecimal: null, currency: null, unit: 'Missing', scaleMultiplier: 1 };
        }
        const d = new Decimal(String(rawInput));
        const scaled = inheritedScale > 1 ? d.times(String(inheritedScale)) : d;
        return {
            isMissing: false,
            numericValue: Number(scaled.toFixed(8)),
            exactDecimal: scaled.toFixed(8).replace(/\.?0+$/, ''),
            currency: null,
            unit: 'Amount',
            scaleMultiplier: inheritedScale > 1 ? inheritedScale : 1
        };
    }

    let str = normalizeArabicDigits(String(rawInput)).trim();
    if (MISSING_MARKERS.has(str.toLowerCase())) {
        return { isMissing: true, numericValue: null, exactDecimal: null, currency: null, unit: 'Missing', scaleMultiplier: 1 };
    }

    const isPercentage = /%|٪|\bpercent\b|بالمائة|في المائة/i.test(str);
    const currency = isPercentage ? null : extractCurrency(str);
    const { scaleMultiplier: localScale } = isPercentage ? { scaleMultiplier: 1 } : extractScale(str);
    const effScale = isPercentage ? 1 : (localScale > 1 ? localScale : (inheritedScale > 1 ? inheritedScale : 1));

    let isNegative = false;
    // Detect accounting parentheses anywhere around the numeric expression: USD (250,000) or $(1,250.50)
    if (/\([^)]*\d[^)]*\)/.test(str)) {
        isNegative = true;
        str = str.replace(/[()]/g, ' ');
    }

    // Strip currency symbols/codes, percentage words, and scale words
    let numCandidate = str
        .replace(/[$€£₹¥]/g, ' ')
        .replace(/\b(AED|SAR|USD|EUR|GBP|INR|QAR|KWD|BHD|OMR|EGP|CAD|AUD|JPY)\b/gi, ' ')
        .replace(/د\.إ|ر\.س|ريال|درهم|جنيه|يورو|دولار|روبية|دينار|بالمائة|في المائة/gi, ' ')
        .replace(/\b(trillions?|billions?|crores?|millions?|lakhs?|lacs?|thousands?|bn|mn|cr|tn|percent|k)\b/gi, ' ')
        .replace(/مليارات|مليار|ملايين|مليون|ألف|الف|آلاف/gi, ' ')
        .replace(/[%٪]/g, ' ')
        .trim();

    if (numCandidate.startsWith('-') || numCandidate.startsWith('−')) {
        isNegative = true;
        numCandidate = numCandidate.slice(1).trim();
    } else if (numCandidate.startsWith('+')) {
        numCandidate = numCandidate.slice(1).trim();
    }

    const numMatch = numCandidate.match(/\d[\d.,\s]*\d|\d/);
    if (!numMatch) {
        return { isMissing: true, numericValue: null, exactDecimal: null, currency, unit: 'Missing', scaleMultiplier: 1 };
    }

    const parsedStr = parseNormalizedNumberString(numMatch[0]);
    if (!parsedStr) {
        return { isMissing: false, numericValue: null, exactDecimal: null, currency, unit: 'Ambiguous', scaleMultiplier: 1 };
    }

    try {
        let dec = new Decimal(parsedStr);
        if (isNegative) dec = new Decimal('0').minus(dec);
        if (effScale > 1 && !isPercentage) {
            dec = dec.times(String(effScale));
        }

        const exactStr = dec.toFixed(8).replace(/\.?0+$/, '') || '0';
        const numVal = Number(exactStr);
        const precisionLoss = String(numVal) !== exactStr && Math.abs(numVal - Number(exactStr)) > 1e-12;

        return {
            isMissing: false,
            numericValue: numVal,
            exactDecimal: exactStr,
            currency,
            unit: isPercentage ? 'Percentage' : (currency ? 'Currency' : 'Amount'),
            scaleMultiplier: effScale,
            precisionLoss
        };
    } catch {
        return { isMissing: false, numericValue: null, exactDecimal: null, currency, unit: 'Ambiguous', scaleMultiplier: 1 };
    }
}

module.exports = {
    normalizeFinancialNumber,
    extractCurrency,
    extractScale,
    parseNormalizedNumberString
};
