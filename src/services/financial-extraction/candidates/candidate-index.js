'use strict';

/**
 * Reusable Candidate Index (Section 18).
 * Eliminates repeated document-wide scans via O(1) Map lookups.
 */
function buildCandidateIndex(candidates) {
    const byId = new Map();
    const byPage = new Map();
    const byTable = new Map();
    const byRow = new Map();
    const byColumn = new Map();
    const byParagraph = new Map();
    const bySentence = new Map();

    const pushTo = (map, key, val) => {
        if (key === undefined || key === null) return;
        let arr = map.get(key);
        if (!arr) {
            arr = [];
            map.set(key, arr);
        }
        arr.push(val);
    };

    for (const c of candidates) {
        byId.set(c.candidateId, c);
        pushTo(byPage, c.pageNumber, c);
        if (c.sourceType === 'Table') {
            pushTo(byTable, c.tableId, c);
            pushTo(byRow, `${c.tableId}:${c.rowIndex}`, c);
            pushTo(byColumn, `${c.tableId}:${c.columnIndex}`, c);
        } else if (c.sourceType === 'Paragraph') {
            pushTo(byParagraph, c.blockId, c);
            pushTo(bySentence, `${c.blockId}:${c.sentenceIndex}`, c);
        }
    }

    return {
        byId,
        byPage,
        byTable,
        byRow,
        byColumn,
        byParagraph,
        bySentence
    };
}

module.exports = { buildCandidateIndex };
