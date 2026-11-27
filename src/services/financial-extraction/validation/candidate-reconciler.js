'use strict';

/**
 * Candidate Reconciliation & Coverage Accounting (Section 29).
 * Accounts for 100% of detected candidates without inflating coverage or silently dropping candidates.
 */

function reconcileCandidates({ candidates = [], validationResult, tableResult, paragraphResult }) {
    const facts = validationResult.facts || [];
    const factByCandId = new Map();
    for (const f of facts) {
        factByCandId.set(f.candidateId, f);
    }

    const excludedIds = new Set([
        ...(tableResult.missingCandidates || []).map(m => m.candidateId),
        ...(paragraphResult.excludedNonFacts || []).map(e => e.candidateId)
    ]);

    let validatedFinancialCandidates = 0;
    let reviewPendingCandidates = 0;
    let nonFinancialCandidates = 0;
    let missingValueCandidates = 0;
    const unresolvedCandidates = [];

    for (const cand of candidates) {
        const fact = factByCandId.get(cand.candidateId);
        if (fact) {
            if (fact.validationStatus === 'Validated') validatedFinancialCandidates++;
            else reviewPendingCandidates++;
        } else if (cand.candidateType === 'MissingValue') {
            missingValueCandidates++;
        } else if (cand.isResolved || excludedIds.has(cand.candidateId)) {
            nonFinancialCandidates++;
        } else {
            unresolvedCandidates.push({
                candidateId: cand.candidateId,
                rawValue: cand.rawValue,
                candidateType: cand.candidateType,
                sourceType: cand.sourceType,
                pageNumber: cand.pageNumber,
                tableId: cand.tableId || null,
                blockId: cand.blockId || null,
                rowIndex: cand.rowIndex ?? null,
                columnIndex: cand.columnIndex ?? null,
                sentenceIndex: cand.sentenceIndex ?? null,
                reviewReason: 'No grammatical or structural relationship resolved'
            });
        }
    }

    const total = candidates.length;
    const resolvedTotal = validatedFinancialCandidates + reviewPendingCandidates + nonFinancialCandidates + missingValueCandidates;

    return {
        facts,
        unresolvedCandidates,
        coverage: {
            totalCandidates: total,
            validatedFinancialCandidates,
            reviewPendingCandidates,
            nonFinancialCandidates,
            missingValueCandidates,
            unresolvedCandidates: unresolvedCandidates.length,
            candidateAccountingRatio: total > 0 ? Number(((resolvedTotal + unresolvedCandidates.length) / total).toFixed(4)) : 1.0,
            candidateResolutionCoverage: total > 0 ? Number((resolvedTotal / total).toFixed(4)) : 1.0
        }
    };
}

module.exports = { reconcileCandidates };
