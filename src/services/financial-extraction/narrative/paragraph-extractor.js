'use strict';

const { segmentSentences, segmentClauses } = require('./sentence-segmenter');
const { normalizeFinancialNumber, extractCurrency } = require('../numeric-normalizer');
const {
    PERIOD_RE,
    BASIS_RE,
    ORG_RE,
    normalizePeriodLabel,
    normalizeBasisLabel
} = require('../context/context-graph');

/**
 * Candidate-Driven Narrative NLP Engine (Sections 20-23 & 27).
 * Generalized grammatical relationship matching (NOT hardcoded metric dictionaries).
 *
 * Supports:
 *  - English & Arabic narratives
 *  - Negation & hypothetical filtering ("did not achieve", "if ... reaches")
 *  - Reporting verb clauses ("<Entity> reported/recorded/achieved <Metric> of <Value>")
 *  - Coordinated lists ("Revenue and net profit were AED 15 million and AED 3 million, respectively")
 *  - Multi-entity & multi-period clause isolation + pronoun resolution ("Its")
 *  - Metric phrase boundary cleanup (preserves compound metric conjunctions like "Research and Development Expenses")
 *  - Percentages, ratios, operational counts, passive & possessive structures
 */

const REPORTING_VERBS_EN = '(?:reported|recorded|generated|posted|achieved|announced|earned|incurred|registered|recognized|recognised|allocated\\s+to|reached|stood\\s+at|amounted\\s+to|totaled|totalled|was|were|is|are)';
const SUBJECT_RE = /^\s*(?:(?:During|In|For)\s+[^,]+,\s*)?(?<entity>[A-Z][A-Za-z0-9&.\-\s]{1,60}?)\s+(?:reported|recorded|generated|posted|achieved|announced|earned|incurred|registered|recognized|recognised)\b/;
const PRONOUN_SUBJECT_RE = /^(?:.*\b)?(?:Its|Their|The\s+company(?:'s)?|The\s+group(?:'s)?|It|They)\b/i;
const NEGATION_HYPOTHETICAL_RE = /\b(?:did\s+not\s+(?:achieve|report|record|reach|meet)|failed\s+to\s+achieve|if\s+[^,.]+\s+(?:reaches?|exceeds?|achieves?)|would\s+(?:reach|exceed|expand)|hypothetical)\b/i;
const ARABIC_SUBJECT_RE = /(?:حققت|سجلت|أعلنت|بلغت)\s+(?:شركة\s+)?([^\s،.]+(?:\s+[^\s،.]+){0,3})/;

function cleanMetricLabel(raw) {
    if (!raw) return '';
    let s = String(raw).trim();
    // Strip leading punctuation, determiners, pronouns, and clause connectors
    s = s.replace(/^[\s,;:\-]+/, '');
    s = s.replace(/^(?:(?:and|or|while|whereas|however|also|its|their|the\s+company's|the\s+group's|the|a|an)\s+)+/i, '');
    s = s.replace(/^(?:reported|recorded|generated|posted|achieved|announced|earned|incurred|registered|recognized|recognised|paid|spent|disbursed|settled|remitted|an|a)\s+/i, '');
    // Strip trailing linking verbs/prepositions before the numeric candidate
    s = s.replace(/\s+(?:amounted\s+to|increased\s+(?:from|to)|decreased\s+(?:from|to)|reached|stood\s+at|totaled|totalled|totalling|totaling|allocated\s+to|was|were|is|are|of|at|to|in|بقيمة|نحو|إلى|من)\s*$/i, '');
    s = s.replace(/^[\s,;:]+|[\s,;:]+$/g, '');
    // If only a standalone verb remained, clear it
    if (/^(?:paid|spent|disbursed|settled|remitted|received|collected|reported|recorded|totalling|totaling)$/i.test(s)) return '';
    return s;
}

function detectClauseEntity(clause, activeEntity, docContext) {
    if (PRONOUN_SUBJECT_RE.test(clause) && activeEntity) {
        return { entity: activeEntity, explicit: false, inherited: true };
    }

    const subjMatch = clause.match(SUBJECT_RE);
    if (subjMatch && subjMatch.groups?.entity) {
        const candEntity = subjMatch.groups.entity.trim().replace(/^the\s+/i, '');
        if (!PRONOUN_SUBJECT_RE.test(candEntity) && !/^(?:company|group|firm|entity|revenue|profit|expenses?|assets?|margin|ratio|total)(?:\s+also)?$/i.test(candEntity)) {
            return { entity: candEntity, explicit: true, inherited: false };
        }
    }

    const orgMatch = clause.match(ORG_RE);
    if (orgMatch) {
        return { entity: orgMatch[1].trim(), explicit: true, inherited: false };
    }

    const arMatch = clause.match(ARABIC_SUBJECT_RE);
    if (arMatch) {
        return { entity: arMatch[1].trim(), explicit: true, inherited: false };
    }

    if (PRONOUN_SUBJECT_RE.test(clause) && activeEntity) {
        return { entity: activeEntity, explicit: false, inherited: true };
    }

    if (activeEntity) {
        return { entity: activeEntity, explicit: false, inherited: true };
    }

    if (docContext && docContext.entity) {
        return { entity: docContext.entity, explicit: false, inherited: true };
    }

    return { entity: null, explicit: false, inherited: false };
}

const MONTH_NAME_RE = /\b(?:in|during|for)\s+(January|February|March|April|May|June|July|August|September|October|November|December)(?:\s+(20\d{2}))?\b/i;
const POINT_IN_TIME_RE = /\b(?:at|as\s+at|as\s+of)\s+(\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+20\d{2})\b/i;

const RELATIVE_PERIOD_RE = /\b(?:the\s+same\s+(?:quarter|financial\s+year|fiscal\s+year|year|period)|that\s+(?:quarter|year|period))\b/i;

function findLocalPeriodForCandidate(clause, candidate, activePeriod) {
    // Check explicit month transaction timing right after candidate (e.g. "received in April")
    const afterText = clause.slice(candidate.localEnd, Math.min(clause.length, candidate.localEnd + 45));
    if (RELATIVE_PERIOD_RE.test(afterText) && activePeriod) {
        return { periodLabel: activePeriod, inherited: true };
    }
    const afterMonth = afterText.match(MONTH_NAME_RE);
    if (afterMonth) {
        const yearMatch = afterMonth[2] || (activePeriod && (activePeriod.match(/20\d{2}/) || [])[0]);
        return {
            periodLabel: yearMatch ? `${afterMonth[1]} ${yearMatch}` : afterMonth[1],
            inherited: false
        };
    }

    // Check window right after candidate first ("... in FY2025"), then before ("During FY2026, ...")
    const afterMatch = afterText.match(PERIOD_RE);
    if (afterMatch) {
        return { periodLabel: normalizePeriodLabel(afterMatch[1]), inherited: false };
    }

    const beforeText = clause.slice(Math.max(0, candidate.localStart - 45), candidate.localStart);
    const beforeMatch = beforeText.match(PERIOD_RE);
    if (beforeMatch) {
        return { periodLabel: normalizePeriodLabel(beforeMatch[1]), inherited: false };
    }

    const clauseMonth = clause.match(MONTH_NAME_RE);
    if (clauseMonth) {
        const yearMatch = clauseMonth[2] || (activePeriod && (activePeriod.match(/20\d{2}/) || [])[0]);
        return {
            periodLabel: yearMatch ? `${clauseMonth[1]} ${yearMatch}` : clauseMonth[1],
            inherited: false
        };
    }

    const anyPeriod = clause.match(PERIOD_RE);
    if (anyPeriod) {
        return { periodLabel: normalizePeriodLabel(anyPeriod[1]), inherited: false };
    }

    if (activePeriod) {
        return { periodLabel: activePeriod, inherited: true };
    }

    return { periodLabel: null, inherited: false };
}

function extractCoordinatedRespectively(clause, financialCands) {
    // Handles: "<M1> and <M2> were <V1> and <V2>, respectively"
    // Preserves compound metric names containing "and" (e.g. "Research and Development Expenses")
    if (!/\brespectively\b/i.test(clause) || financialCands.length < 2) return null;
    const verbSplit = clause.split(new RegExp(`\\s+${REPORTING_VERBS_EN}\\s+`, 'i'));
    if (verbSplit.length < 2) return null;

    const lhs = verbSplit[0];
    let metrics = lhs
        .split(/(?<=\b(?:Expenses|Costs|Revenue|Profit|Income|Assets|Liabilities|Savings|Gains|Benefits|Margin|Ratio|Capital|Expenditure|Fees|Tax|Cash))\s+and\s+/i)
        .map(cleanMetricLabel)
        .filter(Boolean);
    if (metrics.length !== financialCands.length) {
        metrics = lhs.split(/\s+and\s+/i).map(cleanMetricLabel).filter(Boolean);
    }
    if (metrics.length !== financialCands.length) return null;

    const map = new Map();
    for (let i = 0; i < financialCands.length; i++) {
        map.set(financialCands[i].candidateId, metrics[i]);
    }
    return map;
}

function extractParagraphFacts({ paragraphs = [], contextGraph, candidateIndex }) {
    const facts = [];
    const excludedNonFacts = [];
    const processedParagraphs = [];

    for (const para of paragraphs) {
        const paraCtx = (contextGraph && contextGraph.paragraphs.get(para.blockId)) || contextGraph?.document || {};
        const sentences = segmentSentences(para.content);

        let activeEntity = paraCtx.entity || null;
        let activePeriod = paraCtx.periodLabel || null;
        let activeCurrency = paraCtx.currency || null;

        for (let sIdx = 0; sIdx < sentences.length; sIdx++) {
            const sentence = sentences[sIdx];
            const sentCands = (candidateIndex && candidateIndex.bySentence.get(`${para.blockId}:${sIdx}`)) || [];
            const financialCands = sentCands.filter(c => !c.isResolved);

            if (financialCands.length === 0) continue;

            // Negation / hypothetical check (Section 21)
            if (NEGATION_HYPOTHETICAL_RE.test(sentence)) {
                for (const fc of financialCands) {
                    excludedNonFacts.push({ candidateId: fc.candidateId, reason: 'Negated or hypothetical statement' });
                }
                continue;
            }

            const clauses = segmentClauses(sentence);
            let clauseSearchOffset = 0;

            for (const clause of clauses) {
                const clauseStart = sentence.indexOf(clause, clauseSearchOffset);
                const clauseEnd = clauseStart + clause.length;
                clauseSearchOffset = clauseEnd;

                const clauseCands = financialCands
                    .filter(c => c.startOffset >= clauseStart && c.endOffset <= clauseEnd)
                    .map(c => ({
                        ...c,
                        localStart: c.startOffset - clauseStart,
                        localEnd: c.endOffset - clauseStart
                    }));

                if (clauseCands.length === 0) continue;

                // Resolve entity & isolate on entity transition (Section 23)
                const entInfo = detectClauseEntity(clause, activeEntity, paraCtx);
                if (entInfo.explicit && entInfo.entity) {
                    if (activeEntity && entInfo.entity.toLowerCase() !== activeEntity.toLowerCase()) {
                        // Reset prior entity's period & currency when switching companies!
                        activePeriod = null;
                        activeCurrency = null;
                    }
                    activeEntity = entInfo.entity;
                }

                // Check for coordinated "respectively" mapping
                const respectivelyMap = extractCoordinatedRespectively(clause, clauseCands);

                // Check for point-in-time date in clause ("at 31 March 2026")
                const pointInTimeMatch = clause.match(POINT_IN_TIME_RE);
                const clauseAsOfDate = pointInTimeMatch ? pointInTimeMatch[1].trim() : null;

                // Check if clause has a single unambiguous period shared across coordinated metrics
                const allPeriodsInClause = clause.match(new RegExp(PERIOD_RE.source, 'gi')) || [];
                const singleClausePeriod = allPeriodsInClause.length === 1 ? normalizePeriodLabel(allPeriodsInClause[0]) : null;

                let prevEnd = 0;
                for (let i = 0; i < clauseCands.length; i++) {
                    const cand = clauseCands[i];
                    const localBasisSpan = clause.slice(prevEnd, cand.localStart);

                    // Per-candidate local reporting basis (prevents "requirement" in one clause segment leaking to other amounts)
                    const isPaymentVerb = /\b(?:paid|spent|disbursed|settled|remitted|collected|received)\b/i.test(localBasisSpan);
                    const isRequirementPhrase = /\b(?:minimum\s+(?:operating\s+)?cash\s+requirement|cash\s+requirement|capital\s+requirement|requirement|threshold)\b/i.test(localBasisSpan);
                    const localBasisMatch = localBasisSpan.match(BASIS_RE);
                    let reportingBasis = paraCtx.reportingBasis || 'Actual';
                    if (isPaymentVerb) {
                        reportingBasis = 'Actual';
                    } else if (isRequirementPhrase) {
                        reportingBasis = 'Requirement';
                    } else if (localBasisMatch) {
                        reportingBasis = normalizeBasisLabel(localBasisMatch[1]);
                    }

                    let metricLabel = respectivelyMap ? respectivelyMap.get(cand.candidateId) : null;

                    if (!metricLabel) {
                        // Standard: look between previous candidate (or clause start) and current candidate
                        let leftSpan = localBasisSpan;
                        if (prevEnd === 0) {
                            const sm = leftSpan.match(SUBJECT_RE);
                            if (sm) leftSpan = leftSpan.slice(sm[0].length);
                            else {
                                // Strip leading "During <Period>, <Entity> <verb>" even if preceded by a heading
                                const midSubj = leftSpan.match(/(?:During|In|For)\s+[^,]+,\s*[A-Z][A-Za-z0-9&.\-\s]{1,60}?\s+(?:reported|recorded|generated|posted|achieved|announced|earned|incurred|registered|recognized|recognised)\b/);
                                if (midSubj) leftSpan = leftSpan.slice(midSubj.index + midSubj[0].length);
                            }
                        }
                        leftSpan = leftSpan.replace(/^\s*(?:against\s+a|resulting\s+in\s+a|compared\s+to\s+a|versus\s+a)\s+/i, '');
                        metricLabel = cleanMetricLabel(leftSpan);

                        // Strip leading entity name if present in metric
                        if (entInfo.entity && metricLabel.toLowerCase().startsWith(entInfo.entity.toLowerCase())) {
                            metricLabel = metricLabel.slice(entInfo.entity.length).replace(/^[\s,;:\-]+/, '').trim();
                        }

                        // Strip trailing or isolated period/date references from metric label (e.g. "in FY 2025 and", "at 31 March 2026")
                        metricLabel = metricLabel.replace(/\s+(?:at|as\s+at|as\s+of)\s+\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+20\d{2}\b.*$/i, '').trim();
                        metricLabel = metricLabel.replace(/\s+(?:in|for|during)?\s*(?:FY\s*(?:20)?\d{2}|Q[1-4]|20\d{2})\b.*$/i, '').trim();

                        // Repeated metric across periods check (e.g. "revenue of AED 12M in FY 2025 and AED 18M in FY 2026")
                        const isStopOrPeriod = !metricLabel ||
                            /^(?:in|for|and|to|from|while|whereas|as|of|with|at|by)$/i.test(metricLabel) ||
                            /^(?:in\s+)?(?:FY\s*(?:20)?\d{2}|Q[1-4]|20\d{2})\s*(?:and|to|from|while)?$/i.test(metricLabel) ||
                            !/[A-Za-z\u0600-\u06FF]{2,}/.test(metricLabel);

                        if (isStopOrPeriod && i > 0 && clauseCands[i - 1].extractedMetric) {
                            metricLabel = clauseCands[i - 1].extractedMetric;
                        }

                        // Passive / value-first fallback: e.g. "AED 500,000 was allocated to capital expenditure" or "AED 15 million in revenue"
                        if (!metricLabel || !/[A-Za-z\u0600-\u06FF]{2,}/.test(metricLabel)) {
                            const rightSpan = clause.slice(cand.localEnd);
                            const passiveMatch = rightSpan.match(/^\s*(?:was|were|is|are)?\s*(?:allocated\s+to|invested\s+in|spent\s+on|in|for|of)\s+([A-Za-z\u0600-\u06FF\s]{3,50}?)(?=[.,;]|$|\b(?:in|during|for)\s+(?:FY|Q[1-4]|20\d{2}))/i);
                            if (passiveMatch) {
                                metricLabel = cleanMetricLabel(passiveMatch[1]);
                            }
                        }
                    }

                    prevEnd = cand.localEnd;

                    if (!metricLabel || !/[A-Za-z\u0600-\u06FF]{2,}/.test(metricLabel) || /^(?:in|for|and|to|from)$/i.test(metricLabel)) {
                        continue;
                    }

                    cand.extractedMetric = metricLabel;

                    const norm = normalizeFinancialNumber(cand.rawValue, 1);
                    if (norm.isMissing || norm.numericValue === null) continue;

                    let periodInfo = findLocalPeriodForCandidate(clause, cand, activePeriod);
                    if (!periodInfo.periodLabel && singleClausePeriod) {
                        periodInfo = { periodLabel: singleClausePeriod, inherited: false };
                    }
                    if (periodInfo.periodLabel && !periodInfo.inherited) {
                        activePeriod = periodInfo.periodLabel;
                    }

                    let unit = norm.unit;
                    if (cand.candidateType === 'RatioCandidate') unit = 'Ratio';
                    else if (cand.candidateType === 'OperationalCandidate') unit = 'Count';
                    else if (cand.candidateType === 'PercentageCandidate') unit = 'Percentage';

                    const postCurr = extractCurrency(clause.slice(cand.localEnd, Math.min(clause.length, cand.localEnd + 16)));
                    const currency = (unit === 'Percentage' || unit === 'Ratio' || unit === 'Count')
                        ? null
                        : (norm.currency || postCurr || activeCurrency || null);
                    if (currency) activeCurrency = currency;

                    const contextEvidenceIds = [];
                    if (entInfo.inherited && entInfo.entity) contextEvidenceIds.push(`${para.blockId}-ENTITY-INHERITED`);
                    if (periodInfo.inherited && periodInfo.periodLabel) contextEvidenceIds.push(`${para.blockId}-PERIOD-INHERITED`);

                    const reviewReasons = [];
                    if (!entInfo.entity) reviewReasons.push('Entity unresolved');
                    if (!periodInfo.periodLabel) reviewReasons.push('Reporting period unresolved');
                    if (unit === 'Amount' && !currency) reviewReasons.push('Currency or measurement unit unresolved');
                    if (norm.precisionLoss) reviewReasons.push('Numeric precision drift in JS Number');

                    const locText = `Page ${para.pageNumber || 1}, Paragraph ${para.blockId}, Sentence ${sIdx + 1}`;

                    facts.push({
                        candidateId: cand.candidateId,
                        metric: metricLabel,
                        originalMetricLabel: metricLabel,
                        originalLabel: metricLabel,
                        canonicalMetric: null,
                        mappingStatus: 'NewMetric',
                        entity: entInfo.entity,
                        entityType: 'Company',
                        entityMappingStatus: entInfo.entity ? 'NewEntity' : 'Unmapped',
                        periodLabel: periodInfo.periodLabel,
                        asOfDate: clauseAsOfDate || paraCtx.asOfDate || null,
                        rawValue: cand.rawValue,
                        numericValue: norm.numericValue,
                        normalizedValue: norm.numericValue,
                        exactDecimal: norm.exactDecimal,
                        currency,
                        unit,
                        normalizedUnit: unit,
                        scaleMultiplier: norm.scaleMultiplier,
                        reportingBasis,
                        reportingScope: paraCtx.reportingScope || null,
                        dimensions: { ...(paraCtx.dimensions || {}) },
                        sourceType: 'Paragraph',
                        sourcePage: para.pageNumber || 1,
                        sourceBlockId: para.blockId,
                        sourceSentenceIndex: sIdx,
                        sourceLocation: locText,
                        sourceLocationText: locText,
                        sourceLocationJson: {
                            sourceType: 'Paragraph',
                            pageNumber: para.pageNumber || 1,
                            blockId: para.blockId,
                            sentenceIndex: sIdx
                        },
                        sourceEvidence: sentence,
                        contextEvidenceIds,
                        extractionMethod: 'StructuredNLP',
                        validationStatus: 'Pending',
                        reviewReasons
                    });
                }
            }
        }

        processedParagraphs.push(para.blockId);
    }

    return { facts, excludedNonFacts, processedParagraphs };
}

module.exports = { extractParagraphFacts, cleanMetricLabel };
