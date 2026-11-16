function findRelevantStructuredFacts(question, facts = []) {
    if (!facts || facts.length === 0) return [];

    const q = question.toLowerCase();
    const relevant = [];

    const getEntity = f => String(f.Entity || f.entity || f.EntityName || '').toLowerCase();
    const getMetric = f => String(f.Metric || f.metric || f.CanonicalMetric || f.OriginalLabel || '').toLowerCase();
    const getPeriod = f => String(f.PeriodLabel || f.periodLabel || f.PeriodName || '').toLowerCase();

    // 1. Transaction ID search (e.g. TXN-10004)
    const txnMatch = q.match(/txn-\d+/i);
    if (txnMatch) {
        const targetTxn = txnMatch[0].toUpperCase();
        relevant.push(...facts.filter(f => getEntity(f).toUpperCase().includes(targetTxn)));
    }

    // 2. Conflict queries
    const isConflictQuery = /mismatch|exception|discrepancy|difference|conflict|variance|dispute/i.test(q);
    if (isConflictQuery) {
        relevant.push(...facts.filter(f => f.hasConflict === true));
    }

    // 2B. Dimension-based matching (metric, entity, period resolution)
    try {
        const { resolveQuestionToDimensions } = require('./calculation-engine');
        const resolved = resolveQuestionToDimensions(question);
        if (resolved) {
            for (const f of facts) {
                const m = getMetric(f);
                const e = getEntity(f);
                const p = getPeriod(f);
                if (resolved.metric && m.toLowerCase().includes(resolved.metric.toLowerCase())) {
                    relevant.push(f);
                } else if (resolved.entity && e.toLowerCase().includes(resolved.entity.toLowerCase())) {
                    relevant.push(f);
                } else if (resolved.period && p.toLowerCase().includes(resolved.period.toLowerCase())) {
                    relevant.push(f);
                }
            }
        }
    } catch {
        // ignore
    }

    // 3. Dynamic Keyword Matching against Metric, Entity, and Period
    const stopWords = new Set([
        'what', 'was', 'is', 'the', 'of', 'for', 'in', 'and', 'to', 'a', 'an', 'show', 'tell',
        'me', 'give', 'how', 'much', 'many', 'does', 'did', 'by', 'at', 'with', 'from'
    ]);
    const words = q.split(/[\s,?;:()"]+/).filter(w => w.length > 1 && !stopWords.has(w));

    const scoredFacts = facts.map(f => {
        const metricStr = getMetric(f);
        const entityStr = getEntity(f);
        const periodStr = getPeriod(f);

        let score = 0;
        for (const w of words) {
            if (metricStr.includes(w)) score += 3;
            if (entityStr.includes(w)) score += 3;
            if (periodStr.includes(w)) score += 2;
        }

        return { fact: f, score };
    });

    const matchingFacts = scoredFacts
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .map(item => item.fact);

    if (matchingFacts.length > 0) {
        relevant.push(...matchingFacts);
    }

    // If still empty, return top 15 facts
    if (relevant.length === 0) {
        return facts.slice(0, 15);
    }

    // Deduplicate facts by FactId or key
    const seen = new Set();
    return relevant.filter(f => {
        const key = f.FactId ? String(f.FactId) : `${f.DocumentId || ''}_${getMetric(f)}_${getEntity(f)}_${getPeriod(f)}_${f.NumericValue}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function formatSourceReferences(retrievedChunks) {
    if (!retrievedChunks || retrievedChunks.length === 0) return [];

    return retrievedChunks.map(chunk => {
        let pageNumber = Number(chunk.pageNumber);
        if (isNaN(pageNumber) || pageNumber < 1) pageNumber = null;

        const heading = chunk.heading || chunk.title || null;
        let sourceLocation = chunk.source || chunk.fileName || 'Financial Document';
        if (heading) {
            sourceLocation += `, Section: ${heading}`;
        }
        if (pageNumber) {
            sourceLocation += `, Page ${pageNumber}`;
        }

        return {
            chunkId: chunk.id,
            documentId: chunk.documentId || null,
            fileName: chunk.fileName || chunk.source || null,
            sourceLocation,
            department: chunk.department || null,
            jobTitle: chunk.jobTitle || null,
            authorityRank: chunk.authorityRank || 4,
            authoritySource: chunk.authoritySource || null,
            pageNumber,
            heading,
            score: chunk['@search.score'] || null
        };
    });
}

module.exports = {
    findRelevantStructuredFacts,
    formatSourceReferences
};
