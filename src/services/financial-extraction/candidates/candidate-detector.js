'use strict';

const { normalizeArabicDigits } = require('../../arabic-normalizer');
const { normalizeFinancialNumber } = require('../numeric-normalizer');
const { segmentSentences } = require('../narrative/sentence-segmenter');

/**
 * Independent Numerical Candidate Detection & Contextual Classification (Sections 17 & 26).
 * Single-pass bounded tokenization: prevents overlapping candidates and avoids catastrophic backtracking.
 */

// Combined bounded pattern matching dates, period tokens, or monetary/numeric spans in one pass
const DATE_RE = /\b\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4}\b/gi;
const PERIOD_TOKEN_RE = /\b(?:FY\s*(?:20|19)?\d{2,4}|Q[1-4]\s*(?:FY)?\s*(?:20\d{2})?|H[12]\s*(?:FY)?\s*(?:20\d{2})?)\b/gi;
const NUMERIC_SPAN_RE = /(?:(?:AED|SAR|USD|EUR|GBP|INR|QAR|KWD|BHD|OMR|EGP|CAD|AUD|JPY|[₹$€£¥]|د\.إ|ر\.س|ريال|درهم)\s*)?(?:\(\s*)?[-−+]?[0-9٠-٩۰-۹]+(?:[.,٫٬][0-9٠-٩۰-۹]+)*(?:\s*\))?(?:\s*(?:trillions?|billions?|crores?|millions?|lakhs?|lacs?|thousands?|bn|mn|cr|tn|percent|%|٪|k|مليارات|مليار|ملايين|مليون|ألف|الف|آلاف))?/gi;

const ESTABLISHMENT_CUE_RE = /\b(?:established|founded|incorporated|formed|since)\s+(?:in\s+)?$/i;
const REFERENCE_CUE_RE = /\b(?:reference|ref|document|invoice|account|policy|order|ticket|page|note|revision\s+notes?|section|id|number|no\.?)\s*(?:number|no\.?|#|:)?\s*$/i;
const VERSION_CUE_RE = /\b(?:version|ver\.?|v)\s*[:#]?\s*$/i;
const TESTING_EXPECTED_CUE_RE = /\b(?:expected\s+(?:testing\s+results|observations?|facts?|count)|test\s+results?)\b/i;
const PERIOD_CUE_RE = /\b(?:FY|Q[1-4]|H[12]|in|for|during|year|ended|fiscal)\s*$/i;
const MONTH_CUE_RE = /\b(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s*$/i;
const RATIO_CUE_RE = /\b(?:ratio|multiple|factor|coverage|margin)\b/i;
const OPERATIONAL_CUE_RE = /\b(?:employees|headcount|staff|customers|users|branches|stores|vehicles|units|transactions|orders)\b/i;

function classifyParagraphSpan(raw, sentence, startIdx) {
    const prefix = sentence.slice(Math.max(0, startIdx - 45), startIdx);
    const suffix = sentence.slice(startIdx + raw.length, Math.min(sentence.length, startIdx + raw.length + 30));
    const normRaw = normalizeArabicDigits(raw).trim();

    if (VERSION_CUE_RE.test(prefix) || /^v\d+(\.\d+)*$/i.test(normRaw)) {
        return { candidateType: 'DocumentVersion', isFinancial: false, resolved: true };
    }
    if (TESTING_EXPECTED_CUE_RE.test(sentence) || TESTING_EXPECTED_CUE_RE.test(prefix)) {
        return { candidateType: 'NonFinancial', subType: 'TestingExpectedCount', isFinancial: false, resolved: true };
    }
    if (/^(?:FY|Q[1-4]|H[12])(?=\s|\d)/i.test(normRaw)) {
        return { candidateType: 'PeriodMetadata', isFinancial: false, resolved: true };
    }
    if (/^\d{1,2}\s+[A-Za-z]+\s+\d{4}$/i.test(normRaw)) {
        return { candidateType: 'DateMetadata', isFinancial: false, resolved: true };
    }

    const hasCurrency = /(?:AED|SAR|USD|EUR|GBP|INR|QAR|KWD|BHD|OMR|EGP|CAD|AUD|JPY|[₹$€£¥]|د\.إ|ر\.س|ريال|درهم)/i.test(normRaw);
    const hasScale = /(?:trillion|billion|crore|million|lakh|lac|thousand|bn|mn|cr|tn|مليار|مليون|ألف|الف)/i.test(normRaw);
    const isPct = /%|٪|\bpercent\b/i.test(normRaw);

    if (isPct) {
        return { candidateType: 'PercentageCandidate', isFinancial: true, resolved: false };
    }
    if (hasCurrency || hasScale) {
        return { candidateType: 'FinancialCandidate', isFinancial: true, resolved: false };
    }

    // Bare 4-digit year check: contextual, never blindly exclude 1900..2100!
    if (/^(?:19|20)\d{2}$/.test(normRaw)) {
        if (ESTABLISHMENT_CUE_RE.test(prefix)) {
            return { candidateType: 'NonFinancial', subType: 'EstablishmentYear', isFinancial: false, resolved: true };
        }
        if (MONTH_CUE_RE.test(prefix)) {
            return { candidateType: 'DateMetadata', isFinancial: false, resolved: true };
        }
        if (PERIOD_CUE_RE.test(prefix)) {
            return { candidateType: 'PeriodMetadata', isFinancial: false, resolved: true };
        }
    }

    if (REFERENCE_CUE_RE.test(prefix)) {
        return { candidateType: 'ReferenceNumber', isFinancial: false, resolved: true };
    }

    if (RATIO_CUE_RE.test(prefix) || RATIO_CUE_RE.test(suffix)) {
        return { candidateType: 'RatioCandidate', isFinancial: true, resolved: false };
    }

    if (OPERATIONAL_CUE_RE.test(prefix) || OPERATIONAL_CUE_RE.test(suffix)) {
        return { candidateType: 'OperationalCandidate', isFinancial: true, resolved: false };
    }

    return { candidateType: 'FinancialCandidate', isFinancial: true, resolved: false };
}

function detectNumericCandidates(layout) {
    const candidates = [];

    // 1. Table cell candidates
    for (const table of (layout.tables || [])) {
        const grid = table.grid || [];
        const headerRow = grid[0] || [];
        for (let r = 0; r < grid.length; r++) {
            const row = grid[r] || [];
            for (let c = 0; c < row.length; c++) {
                const raw = String(row[c] ?? '').trim();
                if (!raw) continue;

                const origRow = (table.rowOffset || 0) + r;
                const origCol = (table.colOffset || 0) + c;
                const tLabel = String(table.tableId).startsWith('T') ? `T${table.tableId}` : `TT${table.tableId}`;
                const candidateId = `P${table.pageNumber || 1}-${tLabel}-R${origRow}-C${origCol}`;

                if (/^(?:FY|Q[1-4]|H[12])\s*\d{2,4}/i.test(raw) || (r === 0 && /^(?:19|20)\d{2}$/.test(raw))) {
                    candidates.push({
                        candidateId,
                        rawValue: raw,
                        candidateType: 'PeriodMetadata',
                        sourceType: 'Table',
                        pageNumber: table.pageNumber || 1,
                        tableId: table.tableId,
                        rowIndex: origRow,
                        columnIndex: origCol,
                        isResolved: true
                    });
                    continue;
                }

                const norm = normalizeFinancialNumber(raw);
                if (norm.isMissing) {
                    if (/^(?:n\/a|na|nil|-|--|—)$/i.test(raw) && r > 0 && c > 0) {
                        candidates.push({
                            candidateId,
                            rawValue: raw,
                            candidateType: 'MissingValue',
                            sourceType: 'Table',
                            pageNumber: table.pageNumber || 1,
                            tableId: table.tableId,
                            rowIndex: origRow,
                            columnIndex: origCol,
                            isResolved: true
                        });
                    }
                    continue;
                }

                if (norm.numericValue !== null && r > 0) {
                    const colHeader = String(headerRow[c] || '').toLowerCase();
                    if (/^(?:id|code|sl|no|#)$/.test(colHeader)) {
                        candidates.push({
                            candidateId,
                            rawValue: raw,
                            candidateType: 'Identifier',
                            sourceType: 'Table',
                            pageNumber: table.pageNumber || 1,
                            tableId: table.tableId,
                            rowIndex: origRow,
                            columnIndex: origCol,
                            isResolved: true
                        });
                    } else {
                        candidates.push({
                            candidateId,
                            rawValue: raw,
                            candidateType: norm.unit === 'Percentage' ? 'PercentageCandidate' : 'FinancialCandidate',
                            sourceType: 'Table',
                            pageNumber: table.pageNumber || 1,
                            tableId: table.tableId,
                            rowIndex: origRow,
                            columnIndex: origCol,
                            isResolved: false
                        });
                    }
                }
            }
        }
    }

    // 2. Paragraph non-overlapping candidates
    for (const para of (layout.paragraphs || [])) {
        const sentences = segmentSentences(para.content);
        for (let sIdx = 0; sIdx < sentences.length; sIdx++) {
            const sentence = sentences[sIdx];
            const occupied = []; // Track [start, end] spans to avoid overlapping duplicates

            const overlaps = (start, end) => occupied.some(([a, b]) => start < b && end > a);
            const matches = [];

            // Priority 1: Full dates
            DATE_RE.lastIndex = 0;
            let m;
            while ((m = DATE_RE.exec(sentence)) !== null) {
                occupied.push([m.index, m.index + m[0].length]);
                matches.push({ start: m.index, end: m.index + m[0].length, raw: m[0].trim() });
            }

            // Priority 2: Explicit period tokens (FY2026, Q1 2026)
            PERIOD_TOKEN_RE.lastIndex = 0;
            while ((m = PERIOD_TOKEN_RE.exec(sentence)) !== null) {
                const start = m.index;
                const end = start + m[0].length;
                if (!overlaps(start, end)) {
                    occupied.push([start, end]);
                    matches.push({ start, end, raw: m[0].trim() });
                }
            }

            // Priority 3: Monetary & numeric spans
            NUMERIC_SPAN_RE.lastIndex = 0;
            while ((m = NUMERIC_SPAN_RE.exec(sentence)) !== null) {
                const raw = m[0].trim().replace(/[.,;:]+$/, '');
                if (!raw || !/[0-9٠-٩۰-۹]/.test(raw)) continue;
                const start = m.index + m[0].indexOf(raw);
                const end = start + raw.length;
                if (!overlaps(start, end)) {
                    occupied.push([start, end]);
                    matches.push({ start, end, raw });
                }
            }

            matches.sort((a, b) => a.start - b.start);

            for (let cIdx = 0; cIdx < matches.length; cIdx++) {
                const item = matches[cIdx];
                const cls = classifyParagraphSpan(item.raw, sentence, item.start);
                const bLabel = String(para.blockId).startsWith('B') ? para.blockId : `B${para.blockId}`;
                const candidateId = `P${para.pageNumber || 1}-${bLabel}-S${sIdx}-C${cIdx}`;

                candidates.push({
                    candidateId,
                    rawValue: item.raw,
                    candidateType: cls.candidateType,
                    subType: cls.subType || null,
                    sourceType: 'Paragraph',
                    pageNumber: para.pageNumber || 1,
                    blockId: para.blockId,
                    sentenceIndex: sIdx,
                    startOffset: item.start,
                    endOffset: item.end,
                    sentenceText: sentence,
                    isResolved: cls.resolved
                });
            }
        }
    }

    return candidates;
}

module.exports = { detectNumericCandidates, classifyParagraphSpan };
