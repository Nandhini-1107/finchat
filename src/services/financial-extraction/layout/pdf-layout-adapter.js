'use strict';

/**
 * Coordinate-Aware PDF Layout Adapter (Sections 6-9).
 * Extracts text items with coordinates (x, y, width, height, fontSize) using pdf-parse's PDFParse / PDF.js layer.
 * Groups items into rows and columns using X-coordinate alignment, handles wrapped multiline cells
 * and split numeric tokens, detects table regions vs narrative paragraphs, and preserves exact source geometry.
 */

const { PDFParse } = require('pdf-parse');

function clusterItemsIntoLines(textItems, yTolerance = 4) {
    if (!textItems || textItems.length === 0) return [];

    // PDF coordinate system: sort by page then descending Y (top-to-bottom), then ascending X
    const sorted = [...textItems].sort((a, b) => {
        if (a.pageNumber !== b.pageNumber) return a.pageNumber - b.pageNumber;
        if (Math.abs(b.y - a.y) > yTolerance) return b.y - a.y;
        return a.x - b.x;
    });

    const lines = [];
    let currentLine = null;

    for (const item of sorted) {
        if (!currentLine || currentLine.pageNumber !== item.pageNumber || Math.abs(currentLine.y - item.y) > yTolerance) {
            currentLine = {
                pageNumber: item.pageNumber,
                y: item.y,
                items: [item]
            };
            lines.push(currentLine);
        } else {
            currentLine.items.push(item);
        }
    }

    for (const line of lines) {
        line.items.sort((a, b) => a.x - b.x);
        line.text = line.items.map(it => it.text).join(' ').trim();
    }

    return lines;
}

/**
 * Splits a merged cell token if it contains adjacent independent column values
 * (e.g. "FY 2024 FY 2025", "35,500 42,750", "Actual Budget", or trailing number after long label).
 */
function splitMergedCellTokens(cellText, xStart = 0) {
    const s = String(cellText || '').trim();
    if (!s) return [];

    // Multi-space delimiter inside a single text item
    if (/\s{2,}/.test(s)) {
        const parts = s.split(/\s{2,}/).map(p => p.trim()).filter(Boolean);
        if (parts.length >= 2) return parts.map(text => ({ text, x: xStart }));
    }

    // Two adjacent fiscal periods: "FY 2024 FY 2025" or "Q1 2026 Q2 2026"
    const periodTokens = s.match(/^(FY\s*(?:20|19)?\d{2,4}|Q[1-4]\s*(?:FY)?\s*20\d{2})\s+(FY\s*(?:20|19)?\d{2,4}|Q[1-4]\s*(?:FY)?\s*20\d{2})$/i);
    if (periodTokens) {
        return [{ text: periodTokens[1].trim(), x: xStart }, { text: periodTokens[2].trim(), x: xStart + 40 }];
    }

    // Two adjacent basis headers: "Actual Budget" / "Budget Forecast"
    const basisTokens = s.match(/^(Actual|Budget|Forecast|Target)\s+(Actual|Budget|Forecast|Target)$/i);
    if (basisTokens) {
        return [{ text: basisTokens[1].trim(), x: xStart }, { text: basisTokens[2].trim(), x: xStart + 40 }];
    }

    // Two adjacent independent numeric tokens: "35,500 42,750" or "(150,000) 200,000"
    const twoNums = s.match(/^(\(?[-−+]?\d[\d,.\s]*\d%?\)?|\d+%?)\s+(\(?[-−+]?\d[\d,.]*\d%?\)?|\d+%?)$/);
    if (twoNums && !/^\d{1,3}$/.test(twoNums[1])) {
        return [{ text: twoNums[1].trim(), x: xStart }, { text: twoNums[2].trim(), x: xStart + 40 }];
    }

    // Long metric label with a trailing standalone numeric cell value merged onto it
    const labelPlusNum = s.match(/^([A-Za-z][A-Za-z0-9\s&()/%.\-]{4,}?[A-Za-z\)%])\s+(\(?[-−+]?\d[\d,.]*(?:%)?\)?)$/);
    if (labelPlusNum && !/\b(?:FY|Q[1-4]|H[12]|in|as\s+of|at|version|note|page)\s*$/i.test(labelPlusNum[1])) {
        return [{ text: labelPlusNum[1].trim(), x: xStart }, { text: labelPlusNum[2].trim(), x: xStart + 120 }];
    }

    return [{ text: s, x: xStart }];
}

/**
 * Detect whether a line represents a table row based on item X-gaps, tabs, or multi-space delimiters.
 * Returns array of { text, x } objects or null if single-column line.
 */
function parseLineIntoCellsWithCoords(line) {
    if (line.items && line.items.length >= 2) {
        const rawCells = [];
        let curCell = [line.items[0].text];
        let cellX = line.items[0].x;
        let lastRight = line.items[0].x + line.items[0].width;

        for (let i = 1; i < line.items.length; i++) {
            const it = line.items[i];
            const gap = it.x - lastRight;
            const fontSize = it.fontSize || 10;
            const colGapThreshold = Math.max(5.5, fontSize * 0.55);
            if (gap >= colGapThreshold) {
                rawCells.push({ text: curCell.join(' ').trim(), x: cellX });
                curCell = [it.text];
                cellX = it.x;
            } else {
                curCell.push(it.text);
            }
            lastRight = it.x + it.width;
        }
        if (curCell.length > 0) rawCells.push({ text: curCell.join(' ').trim(), x: cellX });

        // Expand any merged cells
        const expanded = [];
        for (const c of rawCells) {
            expanded.push(...splitMergedCellTokens(c.text, c.x));
        }
        if (expanded.length >= 2) return expanded;
    }

    // Fallback: split on tabs, pipes, or 2+ spaces
    const raw = line.text || (typeof line === 'string' ? line : '');
    const baseX = (line.items && line.items[0]) ? line.items[0].x : 0;

    if (raw.includes('\t')) {
        const parts = raw.split('\t').map(s => s.trim()).filter(Boolean);
        if (parts.length >= 2) return parts.map((text, idx) => ({ text, x: baseX + idx * 80 }));
    }
    if (raw.includes('|')) {
        const parts = raw.split('|').map(s => s.trim()).filter(Boolean);
        if (parts.length >= 2 && !/^[-:\s|]+$/.test(raw)) return parts.map((text, idx) => ({ text, x: baseX + idx * 80 }));
    }

    const multiColMatch = raw.match(/^([A-Za-z\s&.\-()%]+?)\s{2,}(.+)$/);
    if (multiColMatch) {
        const rest = multiColMatch[2].split(/\s{2,}|\t/).map(s => s.trim()).filter(Boolean);
        if (rest.length >= 1) {
            return [multiColMatch[1].trim(), ...rest].map((text, idx) => ({ text, x: baseX + idx * 80 }));
        }
    }

    // Check if single textItem line has merged table tokens
    const splitSingle = splitMergedCellTokens(raw, baseX);
    if (splitSingle.length >= 2) {
        return splitSingle;
    }

    return null;
}

function parseLineIntoCells(line) {
    const res = parseLineIntoCellsWithCoords(line);
    return res ? res.map(c => c.text) : null;
}

function isTableBreakingSentence(text) {
    const s = text.trim();
    if (!s) return true;
    const wordCount = s.split(/\s+/).length;
    // Full narrative sentence ending in period with >= 6 words
    if (/[.!?؟]$/.test(s) && wordCount >= 6) return true;
    // Explicit section heading
    if (/^\d+\.\s+[A-Z]/.test(s)) return true;
    return false;
}

/**
 * Detect table regions across lines, handling wrapped multiline cells and vertically centered values.
 */
function detectTablesAndParagraphsFromLines(lines, pageNumber = 1) {
    const tables = [];
    const paragraphs = [];

    let currentTable = null;
    let pendingCaption = null;
    let pendingNote = null;
    let pendingWrappedLabel = null;
    let currentParagraphLines = [];

    function flushParagraph() {
        if (pendingWrappedLabel) {
            currentParagraphLines.push({ text: pendingWrappedLabel });
            pendingWrappedLabel = null;
        }
        if (currentParagraphLines.length > 0) {
            const content = currentParagraphLines.map(l => l.text || l).join('\n').trim();
            if (content.length > 0) {
                paragraphs.push({
                    blockId: `P${pageNumber}-B${paragraphs.length + 1}`,
                    pageNumber,
                    content,
                    heading: null
                });
            }
            currentParagraphLines = [];
        }
    }

    function flushTable() {
        if (currentTable && currentTable.rows.length >= 1) {
            const grid = currentTable.rows;
            const maxCols = Math.max(...grid.map(r => r.length));
            const paddedGrid = grid.map(r => {
                while (r.length < maxCols) r.push('');
                return r;
            });

            const headerStr = paddedGrid[0].join(' ').toLowerCase();
            const isNonFinancial = /expected\s+(?:testing|facts|observations)|testing\s+results/i.test(headerStr) ||
                                  /expected\s+(?:testing|facts|observations)/i.test(currentTable.caption || '');

            tables.push({
                tableId: `P${pageNumber}-T${tables.length + 1}`,
                pageNumber,
                caption: currentTable.caption || null,
                contextText: currentTable.note || null,
                grid: paddedGrid,
                rowCount: paddedGrid.length,
                columnCount: maxCols,
                isNonFinancial
            });
        }
        currentTable = null;
        pendingCaption = null;
        pendingNote = null;
        pendingWrappedLabel = null;
    }

    function findClosestColIndex(colXs, x) {
        if (!colXs || colXs.length === 0) return 0;
        let bestIdx = 0;
        let bestDist = Math.abs(colXs[0] - x);
        for (let c = 1; c < colXs.length; c++) {
            const d = Math.abs(colXs[c] - x);
            if (d < bestDist) {
                bestDist = d;
                bestIdx = c;
            }
        }
        return bestIdx;
    }

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineText = (line.text || (typeof line === 'string' ? line : '')).trim();
        if (!lineText) continue;

        // Table caption / heading cues
        if (/^(?:\d+\.\s*)?[A-Z][A-Za-z0-9\s&.\-]+(?:Performance|Summary|Ratios|Statement|Balance Sheet|Particulars|Income|Operations|Cash|Liquidity|Position|Results|Breakdown|Overview|Schedule)\b/i.test(lineText) &&
            !lineText.includes('\t') && lineText.length < 90 && !/[.!?]$/.test(lineText)) {
            flushParagraph();
            flushTable();
            pendingCaption = lineText;
            continue;
        }

        // Table-level scale/currency/entity note
        if (/^(?:all\s+monetary\s+amounts|figures\s+in|amounts?\s+in|currency\s*[:\-]|entity\s*[:\-]|company\s*[:\-])/i.test(lineText)) {
            if (currentTable) {
                flushTable();
            }
            pendingNote = pendingNote ? `${pendingNote} ${lineText}` : lineText;
            continue;
        }

        const cellObjs = parseLineIntoCellsWithCoords(line);

        if (cellObjs && cellObjs.length >= 2) {
            flushParagraph();
            const cellTexts = cellObjs.map(c => c.text);

            // Prepend any pending wrapped label fragment (e.g. "Direct Operating" before "(7,250,000)")
            if (pendingWrappedLabel) {
                if (/^\(?[-−+]?\d/.test(cellTexts[0])) {
                    cellTexts.unshift(pendingWrappedLabel);
                } else {
                    cellTexts[0] = `${pendingWrappedLabel} ${cellTexts[0]}`.trim();
                }
                pendingWrappedLabel = null;
            }

            if (!currentTable) {
                currentTable = {
                    caption: pendingCaption,
                    note: pendingNote,
                    colXs: cellObjs.map(c => c.x),
                    rows: [cellTexts]
                };
                pendingCaption = null;
                pendingNote = null;
            } else {
                currentTable.rows.push(cellTexts);
                for (let c = 0; c < cellObjs.length; c++) {
                    if (c >= currentTable.colXs.length) {
                        currentTable.colXs.push(cellObjs[c].x);
                    }
                }
            }
        } else {
            // Single-cell or non-tabular line
            if (currentTable && !isTableBreakingSentence(lineText)) {
                const itemX = (line.items && line.items[0]) ? line.items[0].x : 0;
                const colIdx = findClosestColIndex(currentTable.colXs, itemX);
                const lastRow = currentTable.rows[currentTable.rows.length - 1];

                // Check if this is a continuation of the previous row (e.g. split decimal "5" after "1.250.450,7", or wrapped label "Costs" after "Direct Operating", or "2026" after "Q3")
                const isPartialNumber = /^\d{1,3}$/.test(lineText) && lastRow[colIdx] && /[.,]$/.test(lastRow[colIdx].trim());
                const isWrappedDateOrPeriod = /^(?:20\d{2}|Forecast|Target|Budget|Actual)$/i.test(lineText) && lastRow[colIdx];
                const isWrappedValue = /^\(?[-−+]?\d[\d,.]*(?:\s*(?:crore|lakh|million|billion|k|m|bn|%))?\)?$/i.test(lineText);

                if (isPartialNumber) {
                    lastRow[colIdx] = `${lastRow[colIdx].trim()}${lineText}`;
                    continue;
                }
                if (isWrappedDateOrPeriod) {
                    lastRow[colIdx] = `${lastRow[colIdx].trim()} ${lineText}`.trim();
                    continue;
                }

                // Look ahead: if next line is a wrapped continuation or table row, merge instead of flushing table!
                const nextLine = lines[i + 1];
                const nextText = nextLine ? (nextLine.text || (typeof nextLine === 'string' ? nextLine : '')).trim() : '';
                const nextCells = nextLine ? parseLineIntoCellsWithCoords(nextLine) : null;

                if (colIdx === 0 && !isWrappedValue) {
                    // Check if next line is a value for this label (e.g. "Direct Operating" -> "(7,250,000)" -> "Costs")
                    if (nextLine && /^\(?[-−+]?\d[\d,.]*\)?$/.test(nextText)) {
                        pendingWrappedLabel = pendingWrappedLabel ? `${pendingWrappedLabel} ${lineText}` : lineText;
                        continue;
                    }
                    // Otherwise it's the bottom half of a wrapped label from the previous row (e.g. "Costs" after "(7,250,000)" or "Expenses" after "Maintenance")
                    if (lastRow && lastRow[0]) {
                        lastRow[0] = `${lastRow[0]} ${lineText}`.trim();
                        continue;
                    }
                }

                if (colIdx > 0 && isWrappedValue && pendingWrappedLabel) {
                    // Pair pendingWrappedLabel + this value as a row in the table!
                    const newRow = new Array(Math.max(currentTable.colXs.length, colIdx + 1)).fill('');
                    newRow[0] = pendingWrappedLabel;
                    newRow[colIdx] = lineText;
                    currentTable.rows.push(newRow);
                    pendingWrappedLabel = null;
                    continue;
                }

                if (nextCells && nextCells.length >= 2 && lineText.split(/\s+/).length <= 4) {
                    // Single header line above a multi-column header (e.g. "Q4 2026" above "Financial Indicator Q4 2026 Target")
                    pendingWrappedLabel = lineText;
                    continue;
                }
            }

            if (currentTable) {
                flushTable();
            }
            if (pendingCaption) {
                currentParagraphLines.push({ text: pendingCaption });
                pendingCaption = null;
            }
            if (pendingNote) {
                currentParagraphLines.push({ text: pendingNote });
                pendingNote = null;
            }
            currentParagraphLines.push(line);
        }
    }

    flushTable();
    flushParagraph();

    return { tables, paragraphs };
}

/**
 * Extract layout directly from a PDF buffer using pdf-parse's PDFParse.
 */
async function extractPdfLayout(pdfBuffer, options = {}) {
    const parser = new PDFParse({ data: pdfBuffer, verbosity: 0 });
    const doc = await parser.load();
    const numPages = doc.numPages;

    const allTables = [];
    const allParagraphs = [];
    const pages = [];

    for (let pNum = 1; pNum <= numPages; pNum++) {
        const page = await doc.getPage(pNum);
        let textContent = null;
        try {
            textContent = await page.getTextContent();
        } catch {
            textContent = { items: [] };
        }

        const textItems = (textContent.items || []).map((it, idx) => ({
            id: `P${pNum}-I${idx + 1}`,
            text: it.str || '',
            x: Math.round((it.transform ? it.transform[4] : 0) * 100) / 100,
            y: Math.round((it.transform ? it.transform[5] : 0) * 100) / 100,
            width: Math.round((it.width || 0) * 100) / 100,
            height: Math.round((it.height || 0) * 100) / 100,
            fontSize: Math.round(((it.transform && it.transform[0]) || 12) * 100) / 100,
            pageNumber: pNum
        })).filter(it => it.text.trim().length > 0);

        const lines = clusterItemsIntoLines(textItems);
        const { tables, paragraphs } = detectTablesAndParagraphsFromLines(lines, pNum);

        allTables.push(...tables);
        allParagraphs.push(...paragraphs);

        const fullPageText = lines.map(l => l.text).join('\n');
        pages.push({
            pageNumber: pNum,
            text: fullPageText
        });

        page.cleanup();
    }

    await parser.destroy();

    return {
        pageCount: numPages,
        tables: allTables,
        paragraphs: allParagraphs,
        pages
    };
}

module.exports = {
    extractPdfLayout,
    clusterItemsIntoLines,
    parseLineIntoCells,
    parseLineIntoCellsWithCoords,
    detectTablesAndParagraphsFromLines
};
