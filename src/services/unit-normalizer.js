/**
 * Dynamic Unit and Financial Value Normalizer
 * Preserves OriginalValue, OriginalUnit, NormalizedValue, and NormalizedUnit without hardcoding.
 * Phase 4.3.2: Dynamic unit and scale normalization with basis points, scale detection,
 * double-scaling prevention, and formula error handling.
 */

const {
    normalizeArabicText,
    parseArabicNumber,
    normalizeArabicDigits
} = require('./arabic-normalizer');

/**
 * Dynamically extracts scale declarations and currency from header, title, caption, or metadata text.
 * Supports:
 * - "AED in thousands", "USD millions", "Scale: 1000", "AED '000", "Revenue ('000)"
 * - Arabic scale: "بآلاف", "بالآلاف", "بالملايين", "بالمليارات", "ألف", "مليون", "مليار"
 * - Does NOT infer scale when ambiguous (e.g. conflicting mentions).
 */
function extractScaleFromText(text) {
    if (!text || typeof text !== 'string') return null;
    const clean = text.trim();
    if (clean.length === 0) return null;

    // Detect currency if embedded in scale string
    let currency = null;
    const currMatch = clean.match(/\b(AED|USD|SAR|EUR|GBP|INR|QAR|KWD|BHD|OMR|EGP|CAD|AUD|JPY|CHF|CNY|KZT|BRL|MXN|ZAR|SGD|HKD|NZD|SEK|NOK)\b|[$€£₹¥]|الريالات|ريالات|ريال|الدراهم|دراهم|درهم|الجنيهات|جنيهات|جنيه|دولار|يورو|ر\.س|د\.إ/i);
    if (currMatch) {
        const symbol = currMatch[0];
        if (symbol === '$') currency = 'USD';
        else if (symbol === '€') currency = 'EUR';
        else if (symbol === '£') currency = 'GBP';
        else if (symbol === '₹') currency = 'INR';
        else if (symbol === '¥') currency = 'JPY';
        else if (/دولار/i.test(symbol)) currency = 'USD';
        else if (/يورو/i.test(symbol)) currency = 'EUR';
        else if (/ريال|ريالات|ر\.س|SAR/i.test(symbol)) currency = 'SAR';
        else if (/درهم|دراهم|د\.إ|AED/i.test(symbol)) currency = 'AED';
        else if (/جنيه|جنيهات|EGP/i.test(symbol)) currency = 'EGP';
        else currency = symbol.toUpperCase();
    }

    // 1. Explicit numeric scale declarations: "Scale: 1000", "Scale: 1,000,000", "scale: 1000"
    const explicitMatch = clean.match(/\bscale:\s*([0-9,]+)\b/i);
    if (explicitMatch) {
        const num = parseInt(explicitMatch[1].replace(/,/g, ''), 10);
        if (!isNaN(num) && num > 0) {
            return {
                scale: num,
                scaleName: num >= 1e9 ? 'billion' : num >= 1e6 ? 'million' : num >= 1e3 ? 'thousand' : 'unit',
                currency
            };
        }
    }

    // Guard against ambiguous scale mentions (e.g. "comparing thousands and millions")
    const hasThousand = /thousand|'000|000s/i.test(clean);
    const hasMillion = /million|\bmn\b/i.test(clean);
    const hasBillion = /billion|\bbn\b/i.test(clean);
    if ((hasThousand && hasMillion) || (hasThousand && hasBillion) || (hasMillion && hasBillion)) {
        return null; // Ambiguous: do not guess
    }

    // 2. Billions
    if (/(?:\bin\s+billions?\b|\bbillions?\b|\b(?:\$|AED|USD|SAR|EUR|GBP|INR|EGP)?\s*(?:bn|b)\b|بالمليارات|مليار)/i.test(clean)) {
        return { scale: 1000000000, scaleName: 'billion', currency };
    }

    // 3. Millions
    if (/(?:\bin\s+millions?\b|\bmillions?\b|\(\s*(?:in\s+)?millions?\s*\)|\b(?:\$|AED|USD|SAR|EUR|GBP|INR|EGP)?\s*(?:mn|m)\b|بالملايين|ملايين|مليون)/i.test(clean)) {
        const isMUnit = /\b(?:USD|AED|SAR|EUR|GBP|\$|€|£)\s*(?:m|mn)\b/i.test(clean) ||
                        /\(\s*(?:[A-Za-z]{3}\s*|\$|€|£|₹)?(?:m|mn)\s*\)/i.test(clean) ||
                        /\bin\s+millions?\b/i.test(clean) ||
                        /\bmillions?\b/i.test(clean) ||
                        /بالملايين|مليون/i.test(clean);
        if (isMUnit) {
            return { scale: 1000000, scaleName: 'million', currency };
        }
    }

    // 4. Thousands
    if (/(?:\bin\s+thousands?\b|\bthousands?\b|['’]000\b|\(000s?\b|\('000s?\b|\b000['’]?s\b|بآلاف|بالآلاف|ألف)/i.test(clean)) {
        return { scale: 1000, scaleName: 'thousand', currency };
    }

    return null;
}

function normalizeFinancialValue(rawInput, context = {}) {
    if (rawInput === undefined || rawInput === null || rawInput === '') {
        return {
            originalValue: null,
            originalTextValue: String(rawInput ?? ''),
            originalUnit: null,
            normalizedValue: null,
            normalizedUnit: null,
            numericValue: null, // Backward-compatibility
            currency: context.currency || null,
            scale: 1
        };
    }

    // Detect numeric input (e.g. from Excel raw number cell)
    if (typeof rawInput === 'number') {
        const isNonMonetary = context.isRatio || context.isHeadcount || context.unit === 'ratio' || context.unit === 'percentage' || context.unit === 'headcount';
        const docScale = isNonMonetary ? 1 : (Number(context.scale) || 1);
        let norm;
        let unit = context.normalizedUnit || context.unit || 'amount';
        let originalUnit = context.originalUnit || 'amount';

        if (unit === 'percentage') {
            norm = Number((rawInput / 100).toFixed(8));
            unit = 'ratio';
            originalUnit = 'percentage';
        } else if (unit === 'bps') {
            norm = Number((rawInput / 10000).toFixed(8));
            unit = 'ratio';
            originalUnit = 'bps';
        } else if (unit === 'ratio') {
            norm = Number(rawInput.toFixed(8));
            originalUnit = 'ratio';
        } else if (isNonMonetary) {
            norm = rawInput;
            unit = 'headcount';
            originalUnit = 'headcount';
        } else {
            norm = Number((rawInput * docScale).toFixed(4));
            unit = 'amount';
            if (docScale === 1000 && originalUnit === 'amount') originalUnit = 'thousand';
            else if (docScale === 1000000 && originalUnit === 'amount') originalUnit = 'million';
            else if (docScale === 1000000000 && originalUnit === 'amount') originalUnit = 'billion';
        }

        const origVal = Math.abs(rawInput) < 1 ? Number(rawInput.toFixed(8)) : Number(rawInput.toFixed(4));

        return {
            originalValue: origVal,
            originalTextValue: context.originalTextValue || String(rawInput),
            originalUnit,
            normalizedValue: norm,
            normalizedUnit: unit,
            numericValue: norm,
            currency: isNonMonetary ? null : (context.currency || null),
            scale: docScale
        };
    }

    let str = String(rawInput).trim();
    const originalTextValue = str;

    // 1. Detect formula errors (e.g. #DIV/0!, #N/A, #VALUE!, #REF!, #NAME?, #NUM!, #NULL!)
    if (/^#(DIV\/0!|N\/A|VALUE!|REF!|NAME\?|NUM!|NULL!)/i.test(str)) {
        return {
            originalValue: str,
            originalTextValue,
            originalUnit: 'unknown',
            normalizedValue: null,
            normalizedUnit: 'unknown',
            numericValue: null,
            currency: context.currency || null,
            scale: 1,
            isError: true
        };
    }

    // 2. Convert Arabic-Indic and Eastern Arabic digits and separators to standard ASCII digits (0-9)
    str = normalizeArabicDigits(str);

    // 3. Detect Parentheses for negative numbers or leading minus
    let isNegative = false;
    if (/\(\s*[^()]*[\d,.]+[^()]*\)/.test(str) || (str.startsWith('(') && str.endsWith(')')) || /^[-–—]/.test(str)) {
        isNegative = true;
        str = str.replace(/[()]/g, '').trim();
        if (/^[-–—]/.test(str)) {
            str = str.replace(/^[-–—]\s*/, '').trim();
        }
    }

    // 4. Detect Basis Points (bps)
    const isBps = /\bbps\b|basis\s*points?|نقطة\s*أساس/i.test(str) || context.unit === 'bps';

    // 5. Detect Currency (Safe ISO currency matching; exclude 'BPS', 'DIV', 'VAL', 'REF', 'NUM')
    let currency = context.currency || null;
    if (!isBps) {
        const currMatch = str.match(/\b(AED|USD|SAR|EUR|GBP|INR|QAR|KWD|BHD|OMR|EGP|CAD|AUD|JPY|CHF|CNY|KZT|BRL|MXN|ZAR|SGD|HKD|NZD|SEK|NOK)\b|[$€£₹¥]|ريال|درهم|جنيه|دولار|يورو|ر\.س|د\.إ/i);
        if (currMatch) {
            const symbol = currMatch[0];
            if (symbol === '$') currency = 'USD';
            else if (symbol === '€') currency = 'EUR';
            else if (symbol === '£') currency = 'GBP';
            else if (symbol === '₹') currency = 'INR';
            else if (symbol === '¥') currency = 'JPY';
            else if (/دولار/i.test(symbol)) currency = 'USD';
            else if (/يورو/i.test(symbol)) currency = 'EUR';
            else if (/ريال|ر\.س|SAR/i.test(symbol)) currency = 'SAR';
            else if (/درهم|د\.إ|AED/i.test(symbol)) currency = 'AED';
            else if (/جنيه|EGP/i.test(symbol)) currency = 'EGP';
            else currency = symbol.toUpperCase();
        }
    }

    // 6. Detect Multipliers & Scale
    let scale = 1;
    let unit = 'amount';
    let originalUnit = 'amount';
    let hasCellMultiplier = false;

    if (isBps) {
        hasCellMultiplier = true;
        scale = 0.0001; // 1 bps = 0.0001 ratio
        unit = 'ratio'; // ExtractedFactsV1 canonical unit for percentages/bps is ratio
        originalUnit = 'bps';
        currency = null;
    } else if (/%|percent|بالمائة|في المائة/i.test(str)) {
        hasCellMultiplier = true;
        scale = 0.01;
        unit = 'ratio'; // Canonical ratio
        originalUnit = 'percentage';
        currency = null;
    } else if (/(?:\b(?:billion|bn)\b|(?<=[0-9\s])(?:billion|bn|b)(?=[^a-z]|$)|مليار|بالمليارات|مليارات)/i.test(str)) {
        hasCellMultiplier = true;
        scale = 1000000000;
        unit = 'amount';
        originalUnit = 'billion';
    } else if (/(?:\b(?:million|mn)\b|(?<=[0-9\s])(?:million|mn|m)(?=[^a-z]|$)|مليون|بالملايين|ملايين)/i.test(str)) {
        hasCellMultiplier = true;
        scale = 1000000;
        unit = 'amount';
        originalUnit = 'million';
    } else if (/(?:\b(?:thousand)\b|(?<=[0-9\s])(?:thousand|k)(?=[^a-z]|$)|ألف|الف|بآلاف|بالآلاف|آلاف)/i.test(str)) {
        hasCellMultiplier = true;
        scale = 1000;
        unit = 'amount';
        originalUnit = 'thousand';
    }

    // Prevention of double-scaling:
    // If the cell already had an explicit multiplier (e.g. $12.5M, 180 bps, 9%),
    // do NOT apply context.scale (e.g. table header 'in thousands').
    if (!hasCellMultiplier) {
        const isNonMonetary = context.isRatio || context.isHeadcount || context.unit === 'ratio' || context.unit === 'percentage' || context.unit === 'headcount';
        if (!isNonMonetary) {
            scale = Number(context.scale) || 1;
            unit = 'amount';
            if (scale === 1000) originalUnit = context.originalUnit || 'thousand';
            else if (scale === 1000000) originalUnit = context.originalUnit || 'million';
            else if (scale === 1000000000) originalUnit = context.originalUnit || 'billion';
            else originalUnit = context.originalUnit || 'amount';
        } else {
            scale = 1;
            if (context.isHeadcount || context.unit === 'headcount') {
                unit = 'headcount';
                originalUnit = 'headcount';
                currency = null;
            } else {
                unit = 'ratio';
                originalUnit = 'ratio';
                currency = null;
            }
        }
    }

    const cleanNumberStr = str
        .replace(/[$€£₹¥,]/g, '')
        .replace(/\b(AED|USD|SAR|EUR|GBP|INR|QAR|KWD|BHD|OMR|EGP|CAD|AUD|JPY|CHF|CNY|KZT|BRL|MXN|ZAR|SGD|HKD|NZD|SEK|NOK)\b/gi, '')
        .replace(/ريال|درهم|جنيه|دولار|يورو|ر\.س|د\.إ/gi, '')
        .replace(/(?<=[0-9\s])(?:billion|bn|million|mn|thousand|b|m|k|bps|%)(?=[^a-z]|$)/gi, '')
        .replace(/\b(billion|bn|million|mn|thousand|bps|basis\s*points?|مليار|مليون|ألف|الف|نقطة\s*أساس)\b/gi, '')
        .trim();

    const parsed = parseFloat(cleanNumberStr);
    if (isNaN(parsed)) {
        return {
            originalValue: null,
            originalTextValue,
            originalUnit,
            normalizedValue: null,
            normalizedUnit: unit,
            numericValue: null,
            currency,
            scale
        };
    }

    const unscaled = isNegative ? -parsed : parsed;
    let normalized = unscaled * scale;

    if (unit === 'ratio') {
        normalized = Number(normalized.toFixed(8));
    } else {
        normalized = Number(normalized.toFixed(4));
    }

    const origVal = Math.abs(unscaled) < 1 ? Number(unscaled.toFixed(8)) : Number(unscaled.toFixed(4));

    return {
        originalValue: origVal,
        originalTextValue,
        originalUnit,
        normalizedValue: normalized,
        normalizedUnit: unit,
        numericValue: normalized, // Backward-compatibility
        currency,
        scale
    };
}

function areValuesEqual(val1, val2, tolerance = 0.001) {
    if (val1 === null || val2 === null || val1 === undefined || val2 === undefined) return false;
    return Math.abs(Number(val1) - Number(val2)) <= tolerance;
}

module.exports = {
    normalizeFinancialValue,
    areValuesEqual,
    extractScaleFromText
};
