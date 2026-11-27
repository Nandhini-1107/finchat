'use strict';

/**
 * Dynamic Table-Island Detection (Section 9).
 * Splits a sheet or grid containing multiple independent tables separated by
 * blank rows/columns into independent table objects, preserving original
 * row/column offsets and preceding caption rows.
 * Complexity: O(R * C) single pass.
 */

function isRowBlank(row) {
    if (!row || row.length === 0) return true;
    for (let c = 0; c < row.length; c++) {
        if (String(row[c] ?? '').trim() !== '') return false;
    }
    return true;
}

function detectTableIslands(grid, baseMeta = {}) {
    if (!Array.isArray(grid) || grid.length === 0) return [];

    const islands = [];
    const numRows = grid.length;
    let r = 0;
    let islandIdx = 0;

    while (r < numRows) {
        while (r < numRows && isRowBlank(grid[r])) r++;
        if (r >= numRows) break;

        const blockStart = r;
        while (r < numRows && !isRowBlank(grid[r])) r++;
        const blockEnd = r; // exclusive

        // Determine active column span [minCol, maxCol]
        let minCol = Infinity;
        let maxCol = -1;
        for (let rr = blockStart; rr < blockEnd; rr++) {
            const row = grid[rr] || [];
            for (let cc = 0; cc < row.length; cc++) {
                if (String(row[cc] ?? '').trim() !== '') {
                    if (cc < minCol) minCol = cc;
                    if (cc > maxCol) maxCol = cc;
                }
            }
        }
        if (maxCol < minCol) continue;

        // Check if first row(s) of block are single-cell caption lines (1 populated cell, rest empty)
        let dataStart = blockStart;
        const captionParts = [];
        if (baseMeta.caption) captionParts.push(baseMeta.caption);

        while (dataStart < blockEnd - 1) {
            const row = grid[dataStart] || [];
            let nonEmpty = 0;
            let firstVal = '';
            for (let cc = minCol; cc <= maxCol; cc++) {
                const v = String(row[cc] ?? '').trim();
                if (v !== '') {
                    nonEmpty++;
                    if (!firstVal) firstVal = v;
                }
            }
            if (nonEmpty === 1 && (maxCol - minCol + 1) >= 2) {
                captionParts.push(firstVal);
                dataStart++;
            } else {
                break;
            }
        }

        const subGrid = [];
        for (let rr = dataStart; rr < blockEnd; rr++) {
            const row = grid[rr] || [];
            const sliced = [];
            for (let cc = minCol; cc <= maxCol; cc++) {
                sliced.push(String(row[cc] ?? '').trim());
            }
            subGrid.push(sliced);
        }

        if (subGrid.length >= 2 && (maxCol - minCol + 1) >= 2) {
            islandIdx++;
            const baseId = baseMeta.tableId || `T${islandIdx}`;
            const tableId = islands.length === 0 && islandIdx === 1 && !baseMeta.splitSuffix
                ? baseId
                : (islandIdx === 1 ? baseId : `${baseId}_${islandIdx}`);

            islands.push({
                tableId,
                pageNumber: baseMeta.pageNumber || 1,
                sheetName: baseMeta.sheetName || null,
                rowOffset: dataStart,
                colOffset: minCol,
                rowCount: subGrid.length,
                columnCount: maxCol - minCol + 1,
                grid: subGrid,
                caption: captionParts.join(' ').trim() || null,
                contextText: baseMeta.contextText || null,
                note: baseMeta.note || null,
                continuationId: null
            });
        }
    }

    return islands;
}

module.exports = { detectTableIslands, isRowBlank };
