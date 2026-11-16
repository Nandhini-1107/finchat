// src/services/arabic-normalizer.js
// Purpose: WP5 Arabic Text Normalization, Diacritic Stripping, and Eastern Arabic Numeral Conversion.

const ARABIC_INDIC_DIGITS = {
    '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
    '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
    '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
    '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9'
};

const ARABIC_SEPARATORS = {
    '٫': '.', // Arabic decimal separator
    '٬': ','  // Arabic thousands separator
};

/**
 * Checks if a string contains Arabic Unicode characters.
 *
 * @param {string} text
 * @returns {boolean}
 */
function isArabicText(text) {
    if (!text || typeof text !== 'string') return false;
    return /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(text);
}

/**
 * Normalizes Arabic text according to standard Arabic NLP and information retrieval rules:
 * 1. Converts Eastern Arabic (Arabic-Indic) numerals to standard ASCII 0-9.
 * 2. Normalizes Arabic decimal and thousands separators.
 * 3. Strips Tashkeel (diacritics / harakat: fatha, damma, kasra, sukun, shadda, tanween).
 * 4. Strips Tatweel / Kashida (ـ).
 * 5. Normalizes Alef variants (أ, إ, آ, ٱ) -> ا.
 * 6. Normalizes Teh Marbuta (ة) -> ه.
 * 7. Normalizes Alef Maqsura (ى) -> ي.
 * 8. Trims and collapses multiple spaces.
 *
 * @param {string} text
 * @returns {string} Normalized string
 */
function normalizeArabicText(text) {
    if (!text || typeof text !== 'string') return '';

    let res = text;

    // 1. Convert Eastern Arabic numerals (٠-٩)
    res = res.replace(/[٠-٩۰-۹]/g, ch => ARABIC_INDIC_DIGITS[ch] || ch);

    // 2. Convert Arabic decimal and thousands separators
    res = res.replace(/[٫٬]/g, ch => ARABIC_SEPARATORS[ch] || ch);

    // 3. Strip Tashkeel (harakat / diacritics)
    // Range \u064B through \u065F covers fathatan, dammatan, kasratan, fatha, damma, kasra, shadda, sukun, etc.
    res = res.replace(/[\u064B-\u065F\u0670]/g, '');

    // 4. Strip Tatweel / Kashida (ـ)
    res = res.replace(/\u0640/g, '');

    // 5. Normalize Alef variants
    res = res.replace(/[\u0622\u0623\u0625\u0671]/g, '\u0627'); // آ, أ, إ, ٱ -> ا

    // 6. Normalize Teh Marbuta to Heh
    res = res.replace(/\u0629/g, '\u0647'); // ة -> ه

    // 7. Normalize Alef Maqsura to Yeh
    res = res.replace(/\u0649/g, '\u064A'); // ى -> ي

    // 8. Collapse whitespace
    res = res.replace(/\s+/g, ' ').trim();

    return res;
}

/**
 * Extracts and converts Eastern Arabic numerals to a standard JS numeric value.
 *
 * @param {string} val
 * @returns {number|null}
 */
function parseArabicNumber(val) {
    if (val === null || val === undefined) return null;
    const normalized = normalizeArabicText(String(val)).replace(/,/g, '');
    const num = parseFloat(normalized);
    return isNaN(num) ? null : num;
}

function normalizeArabicDigits(text) {
    if (!text || typeof text !== 'string') return '';
    let res = text.replace(/[٠-٩۰-۹]/g, ch => ARABIC_INDIC_DIGITS[ch] || ch);
    res = res.replace(/[٫٬]/g, ch => ARABIC_SEPARATORS[ch] || ch);
    return res;
}

module.exports = {
    normalizeArabicText,
    normalizeArabicDigits,
    isArabicText,
    parseArabicNumber
};

