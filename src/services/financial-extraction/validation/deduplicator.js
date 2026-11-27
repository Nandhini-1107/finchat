'use strict';

/**
 * Source-Aware Deduplication (Section 30).
 * Deduplicates by stable candidateId + source location while preserving legitimate
 * repeated financial evidence appearing in both a table and a narrative paragraph.
 */

function deduplicateSourceOccurrences(reconciliation) {
    const facts = reconciliation.facts || [];
    const seen = new Set();
    const deduped = [];

    for (const fact of facts) {
        const locKey = fact.sourceType === 'Table'
            ? `T:${fact.sourceTableId}:${fact.sourceRow}:${fact.sourceColumn}`
            : `P:${fact.sourceBlockId}:${fact.sourceSentenceIndex}:${fact.rawValue}:${fact.metric}`;
        const key = `${fact.candidateId}|${locKey}`;
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(fact);
    }

    return {
        ...reconciliation,
        facts: deduped
    };
}

module.exports = { deduplicateSourceOccurrences };
