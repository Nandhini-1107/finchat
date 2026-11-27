'use strict';

/**
 * Unicode-aware Sentence & Clause Segmentation (Section 20 & 27).
 * Uses Intl.Segmenter when supported by Node runtime; falls back cleanly.
 */

let _enSegmenter = null;
try {
    if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
        _enSegmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
    }
} catch {
    _enSegmenter = null;
}

function cleanVisualLineWraps(text) {
    if (!text || typeof text !== 'string') return '';
    return text
        // Join hyphenated line breaks: "incur-\nred" -> "incurred"
        .replace(/(\b[A-Za-z]+)-\r?\n([A-Za-z]+\b)/g, '$1$2')
        // Join numbers wrapped across newlines ONLY when first part ends in comma/dot or incomplete 1-2 digit group,
        // and next line does NOT start with a section heading (e.g. "9. Liquidity")
        .replace(/(\d[,\.\d]*[,\.]\d{0,2})\r?\n(?!\d+\.\s+[A-Z])(\d{1,3}\b)/g, '$1$2')
        // Join fiscal periods wrapped across newlines: "FY\n2025" -> "FY 2025"
        .replace(/\b(FY|Q[1-4]|H[12])\r?\n(\d{2,4})\b/gi, '$1 $2')
        // Join words wrapped across newlines where not a double-newline paragraph break
        .replace(/(?<=[^\n])\r?\n(?=[^\n])/g, ' ');
}

function segmentSentences(text) {
    if (!text || typeof text !== 'string') return [];
    const cleaned = cleanVisualLineWraps(text);
    const trimmed = cleaned.trim();
    if (!trimmed) return [];

    if (_enSegmenter) {
        const out = [];
        for (const seg of _enSegmenter.segment(trimmed)) {
            const s = seg.segment.trim();
            if (s) out.push(s);
        }
        return out;
    }

    return trimmed
        .split(/(?<=[.!?؟])\s+(?=[^\s])/)
        .map(s => s.trim())
        .filter(Boolean);
}

function segmentClauses(sentence) {
    if (!sentence) return [];
    // Split on clause delimiters (", while ", ", whereas ", "; ", ", but ") without splitting inside numbers
    return sentence
        .split(/\s*(?:;\s*|,\s+(?:while|whereas|but|however|and\s+(?=[A-Z\u0600-\u06FF][^,]*\b(?:reported|recorded|posted|achieved|generated|announced|earned|incurred|حققت|سجلت|بلغت)\b)))\s*/i)
        .map(c => c.trim())
        .filter(Boolean);
}

module.exports = { segmentSentences, segmentClauses, cleanVisualLineWraps };
