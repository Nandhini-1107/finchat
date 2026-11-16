// src/services/fact-extraction.js
// Purpose: Dynamically extract financial facts from normalized document tables and text.
// Phase 4.3.1: Dynamic entity and metric identification supporting multiple companies,
// subsidiaries, business units, reporting entities, and financial metrics WITHOUT
// hardcoded company names or predefined metric lists.

const { normalizeFinancialValue, extractScaleFromText } = require('./unit-normalizer');

// ----------------------------------------------------------------------------
// 1. Dynamic Entity Identification
// ----------------------------------------------------------------------------

/**
 * Dynamically extracts an entity candidate string from a title, heading, or filename.
 * Does NOT hardcode company names; relies on legal form designators and structural delimiters.
 */
function extractEntityFromText(text) {
    if (!text || typeof text !== 'string') return null;
    const clean = text.replace(/^[#\s*]+/, '').trim();

    // Pattern 1: Title with delimiter: "<Entity> - <Statement / Report Name>"
    const delimMatch = clean.match(/^([^\n\r–—\-:|]+?)\s*[\-–—:|]\s*(.+)$/);
    if (delimMatch) {
        const candidate = delimMatch[1].trim();
        // Guard against non-entity prefixes (e.g. "Table 1", "Note 2", "Schedule A")
        if (candidate.length >= 3 && !/^(table|figure|note|schedule|page|appendix|exhibit|part|section)\b/i.test(candidate)) {
            if (/(?:LLC|L\.L\.C\.|Inc|Corp|Ltd|PLC|Holdings|Group|Company|Co\.|Properties|Retail|Logistics|Technologies|Services|Capital|شركة|مؤسسة)\b/i.test(candidate) ||
                /^[A-Z][A-Za-z0-9\s&]{2,}$/.test(candidate)) {
                return candidate;
            }
        }
    }

    // Pattern 2: Arabic corporate entity: "شركة ..." or "مؤسسة ..." or "مجموعة ..."
    const arabicMatch = clean.match(/(?:^|[^\u0621-\u064A])((?:شركة|مؤسسة|مجموعة)\s+[\u0621-\u064A\s]{2,40}?)(?=[,.;:\n\r–—\-:|]|\s+(?:حققت|سجلت|أعلنت|أظهرت|بلغت|وصلت|خلال|في|عن|بنسبة|قدرها|بواقع|صافي|إجمالي|\d)|$)/);
    if (arabicMatch) {
        const cand = arabicMatch[1].trim();
        if (!/^(الشركة|شركة|مؤسسة|مجموعة)$/.test(cand) && !/(?:إيرادات|أرباح|مصاريف|تكاليف)/.test(cand)) {
            return cand;
        }
    }

    // Pattern 3: Corporate legal form suffixes (greedy matching up to LLC/Ltd/Inc/Holdings/etc.)
    const corpMatch = clean.match(/([A-Z\u0621-\u064A][A-Za-z0-9\u0621-\u064A\s&]+?\b(?:LLC|L\.L\.C\.|Inc\.?|Corp\.?|Corporation|Ltd\.?|Limited|PLC|P\.L\.C\.|Holdings|Group|Company|Co\.))\b/);
    if (corpMatch) {
        return corpMatch[1].trim();
    }

    return null;
}

/**
 * Extracts entity candidate from file name (e.g. Contoso_Retail_LLC_Q1_2026_Audited.pdf)
 */
function extractEntityFromFileName(fileName) {
    if (!fileName || typeof fileName !== 'string') return null;
    const base = fileName.replace(/\.[^/.]+$/, '').replace(/[_.-]+/g, ' ').trim();
    return extractEntityFromText(base);
}

/**
 * Resolves document-level entity from metadata, title, filename, or headings.
 * Returns { entity, confidence, source, resolutionStatus }.
 * When evidence is insufficient, returns entity: null. NEVER defaults to 'Consolidated'.
 */
function resolveDocumentEntity(normalizedDoc) {
    const docObj = normalizedDoc.document || {};
    const meta = docObj.metadata || normalizedDoc.metadata || {};

    // 1. Explicit document metadata (highest confidence)
    const rawIssuer = meta.issuer || meta.reportingEntity || meta.entity;
    if (rawIssuer && typeof rawIssuer === 'string' && rawIssuer.trim().length > 0) {
        return {
            entity: rawIssuer.trim(),
            confidence: 0.98,
            source: 'metadata.issuer',
            resolutionStatus: 'Resolved'
        };
    }

    // 2. Document Title
    const docTitle = meta.documentTitle || docObj.title || normalizedDoc.documentTitle || '';
    if (docTitle) {
        const titleEntity = extractEntityFromText(docTitle);
        if (titleEntity) {
            return {
                entity: titleEntity,
                confidence: 0.92,
                source: 'documentTitle',
                resolutionStatus: 'Resolved'
            };
        }
    }

    // 3. Document File Name
    const fileName = docObj.fileName || normalizedDoc.fileName || '';
    if (fileName) {
        const fileEntity = extractEntityFromFileName(fileName);
        if (fileEntity) {
            return {
                entity: fileEntity,
                confidence: 0.85,
                source: 'fileName',
                resolutionStatus: 'Resolved'
            };
        }
    }

    // 4. Document Heading / Markdown
    const fullText = normalizedDoc.fullMarkdown || normalizedDoc.content || '';
    if (fullText) {
        const firstLines = fullText.split('\n').slice(0, 5).join('\n');
        const textEntity = extractEntityFromText(firstLines);
        if (textEntity) {
            return {
                entity: textEntity,
                confidence: 0.80,
                source: 'documentHeading',
                resolutionStatus: 'Resolved'
            };
        }
    }

    // 5. Insufficient evidence -> Return null (Never assume 'Consolidated')
    return {
        entity: null,
        confidence: 0.0,
        source: 'unresolved',
        resolutionStatus: 'Unresolved'
    };
}

// ----------------------------------------------------------------------------
// 2. Dynamic Metric Identification & Typing Helpers
// ----------------------------------------------------------------------------

/**
 * Checks whether a row is an explanatory note, footnote, disclaimer, or separator.
 * Such rows must never be treated as financial metric data.
 */
function isFootnoteOrDisclaimerRow(label, rowType) {
    if (rowType === 'note' || rowType === 'footnote' || rowType === 'disclaimer' || rowType === 'separator') {
        return true;
    }
    const s = String(label || '').trim();
    if (!s) return true;
    if (/^(note\s*\d*|footnote\s*\d*|disclaimer|source|unanchored\s+footnote|see\s+accompanying|the\s+notes\s+form|ملاحظة|المصدر)[\s:]/i.test(s)) {
        return true;
    }
    if (/^(footnote|disclaimer|unanchored\s+note)$/i.test(s)) {
        return true;
    }
    if (/^\*\s*[A-Za-z]/.test(s)) {
        return true;
    }
    return false;
}

/**
 * Checks if a metric name indicates a ratio, percentage, rate, margin, or spread.
 */
function isRatioMetric(metricLabel) {
    const m = String(metricLabel || '').toLowerCase();
    return /(\b(?:margin|rate|yield|spread|ratio|percentage|growth|share)\b|نسبة|هامش|عائد)/i.test(m);
}

/**
 * Checks if a metric name indicates headcount or staff count (non-monetary).
 */
function isHeadcountMetric(metricLabel) {
    const m = String(metricLabel || '').toLowerCase();
    return /(\b(?:headcount|staff|fte|employees|personnel|head\s*count)\b|عدد\s*(?:الموظفين|العاملين))/i.test(m);
}

/**
 * Infers temporal type: 'instant' for point-in-time balance items; 'duration' for flows/periods.
 */
function inferTemporalType(metricLabel, periodLabel = '') {
    const m = String(metricLabel || '').toLowerCase();
    const p = String(periodLabel || '').toLowerCase();
    if (/(?:as\s+of|as\s+at|closing|opening|ending|beginning|balance|headcount|staff|fte|position|رصيد|كما\s+في)/i.test(m) ||
        /(?:as\s+of|as\s+at|كما\s+في)/i.test(p)) {
        return 'instant';
    }
    return 'duration';
}

/**
 * Extracts dimensions from multi-level header paths or compound headers.
 */
function extractDimensionsFromHeader(header, headerPath) {
    const dims = {};
    if (Array.isArray(headerPath) && headerPath.length >= 2) {
        const hasDate0 = /(\b20\d{2}\b|\bQ[1-4]\b|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(headerPath[0]);
        const hasDate1 = /(\b20\d{2}\b|\bQ[1-4]\b|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(headerPath[1]);
        if (!hasDate0 && !hasDate1) {
            dims.channel = headerPath[0].trim();
            dims.geography = headerPath[1].trim();
        }
    } else if (typeof header === 'string' && header.includes(' / ')) {
        const parts = header.split(' / ').map(p => p.trim());
        if (parts.length === 2) {
            dims.channel = parts[0];
            dims.geography = parts[1];
        }
    }
    return dims;
}

// ----------------------------------------------------------------------------
// 3. Document Context Resolution
// ----------------------------------------------------------------------------

function extractDocumentContext(fullTextOrDoc = '', tables = []) {
    let normalizedDoc = {};
    let text = '';

    if (typeof fullTextOrDoc === 'object' && fullTextOrDoc !== null) {
        normalizedDoc = fullTextOrDoc;
        text = String(normalizedDoc.fullMarkdown || normalizedDoc.content || '');
    } else {
        text = String(fullTextOrDoc || '');
        normalizedDoc = { fullMarkdown: text, tables: tables || [] };
    }

    const docObj = normalizedDoc.document || {};
    const meta = docObj.metadata || normalizedDoc.metadata || {};

    // 1. Detect Document Currency
    let currency = meta.currency || null;
    if (!currency) {
        const currMatch = text.match(/\b(AED|USD|SAR|EUR|GBP|INR|QAR|KWD|BHD|OMR|EGP|CAD|AUD)\b|\$|€|£|₹|درهم|د\.إ|ريال|ر\.س|جنيه|دولار|يورو/i);
        if (currMatch) {
            const symbol = currMatch[0];
            if (symbol === '$') currency = 'USD';
            else if (symbol === '€') currency = 'EUR';
            else if (symbol === '£') currency = 'GBP';
            else if (symbol === '₹') currency = 'INR';
            else if (/دولار/i.test(symbol)) currency = 'USD';
            else if (/يورو/i.test(symbol)) currency = 'EUR';
            else if (/درهم|د\.إ|AED/i.test(symbol)) currency = 'AED';
            else if (/ريال|ر\.س|SAR/i.test(symbol)) currency = 'SAR';
            else if (/جنيه|EGP/i.test(symbol)) currency = 'EGP';
            else currency = symbol.toUpperCase();
        }
    }

    // 2. Detect Reporting Basis
    let reportingBasis = meta.reportingBasis || 'Actual';
    if (!meta.reportingBasis) {
        if (/\b(?:budget(?:ed)?|plan(?:ned)?|الميزانية|الخطة)\b/i.test(text)) reportingBasis = 'Budget';
        else if (/\b(?:forecast(?:ed)?|projection|التوقعات)\b/i.test(text)) reportingBasis = 'Forecast';
        else if (/\b(?:audited|stipulated|مدقق)\b/i.test(text)) reportingBasis = 'Actual';
    }

    // 3. Detect Reporting Scope
    let reportingScope = meta.reportingScope || 'Entity';
    if (!meta.reportingScope) {
        if (/\b(?:consolidated|group|الموحدة|المجموعة)\b/i.test(text)) reportingScope = 'Consolidated';
        else if (/\b(?:segment(?:al)?|division(?:al)?|subsidiary|القطاع|الفرع)\b/i.test(text)) reportingScope = 'Entity';
    }

    // 4. Detect As-Of Date
    let asOfDate = meta.asOfDate || null;
    if (!asOfDate) {
        const dateMatch = text.match(/(?:as\s+of|as\s+at|dated?|approved\s+(?:on)?|تاريخ|كما\s+في|بتاريخ):\s*(\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4}|\d{4}[-\/]\d{1,2}[-\/]\d{1,2}|[A-Za-z\u0621-\u064A]+\s+\d{1,2},?\s+\d{4}|\d{1,2}\s+[A-Za-z\u0621-\u064A]+\s+\d{4})/i);
        if (dateMatch) {
            const parsed = new Date(dateMatch[1]);
            if (!isNaN(parsed.getTime())) asOfDate = parsed.toISOString().split('T')[0];
        }
    }

    // 5. Detect Document Reporting Period
    let defaultPeriod = meta.reportingPeriod || 'Not specified';
    if (defaultPeriod === 'Not specified') {
        const periodMatch = text.match(/(?:reporting\s+period|for\s+the\s+period\s+ended|for\s+the\s+year\s+ended|period|الفترة|فترة\s+التقرير):\s*([^\n\r,;|]+)/i);
        if (periodMatch) defaultPeriod = periodMatch[1].trim();
        else {
            const quarterMatch = text.match(/\b(Q[1-4]\s*20\d\d|FY\s*20\d\d|20\d\d\s*Q[1-4]|الربع\s+[الأول|الثاني|الثالث|الرابع]\s+٢٠\d{2})\b/i);
            if (quarterMatch) defaultPeriod = quarterMatch[0].trim();
        }
    }

    const periodStart = meta.periodStart || null;
    const periodEnd = meta.periodEnd || null;
    const fileName = meta.fileName || meta.sourceFileName || docObj.fileName || docObj.sourceFileName || normalizedDoc.fileName || normalizedDoc.sourceFileName || null;

    // 6. Dynamically resolve Entity (never default to Consolidated)
    const entityResolution = resolveDocumentEntity(normalizedDoc);

    // 7. Detect Document Scale (Phase 4.3.2)
    let scale = meta.scale || meta.scaleMultiplier || null;
    if (!scale) {
        const docTitle = meta.documentTitle || docObj.title || normalizedDoc.documentTitle || '';
        const titleScale = extractScaleFromText(docTitle);
        if (titleScale) {
            scale = titleScale.scale;
            if (titleScale.currency && !currency) currency = titleScale.currency;
        } else {
            const firstLines = text.split('\n').slice(0, 10);
            for (const line of firstLines) {
                const cleanLine = line.trim();
                if (!cleanLine || cleanLine.length > 120) continue;
                const isScaleHeader = /all\s+figures\s+in|figures\s+in|amounts\s+in|scale:\s*\d|currency:\s*[A-Za-z]{3}\s*(?:thousands|millions|billions)|جميع\s+الأرقام|الأرقام\s+ب|المبالغ\s+ب|\(\s*(?:in\s+)?(?:thousands|millions|billions|'000)\s*\)/i.test(cleanLine);
                if (isScaleHeader) {
                    const textScale = extractScaleFromText(cleanLine);
                    if (textScale) {
                        scale = textScale.scale;
                        if (textScale.currency && !currency) currency = textScale.currency;
                        break;
                    }
                }
            }
        }
    }
    const finalDocScale = Number(scale) || 1;

    return {
        currency,
        scale: finalDocScale,
        reportingBasis,
        reportingScope,
        asOfDate,
        defaultPeriod,
        periodStart,
        periodEnd,
        fileName,
        documentIssuer: entityResolution.entity, // string or null
        entityResolution
    };
}

// ----------------------------------------------------------------------------
// 4. Dynamic Table Layout Analyzer
// ----------------------------------------------------------------------------

function analyzeTableLayout(table) {
    const headers = table.headers || (table.columns ? table.columns.map(c => c.header || '') : []);
    const headersLower = headers.map(h => String(h || '').trim().toLowerCase());
    const headerRowIndex = table.header_row_index ?? (table.structure?.headerRowIndex ?? -1);

    // Detect explicit Entity column
    const entityColIdx = headersLower.findIndex(h =>
        /^(entity|company|subsidiary|branch|division|department|unit|business\s*unit|reporting\s*entity|legal\s*entity|الكيان|الشركة|القطاع|الفرع|الوحدة)$/i.test(h)
    );

    // Detect explicit Period column
    const periodColIdx = headersLower.findIndex(h =>
        /^(quarter|period|reporting\s*period|year|month|date|as\s*of|as\s*at|الربع|الفترة|التاريخ)$/i.test(h)
    );

    // Detect Period columns in horizontal header
    const periodCols = [];
    headers.forEach((h, idx) => {
        if (/(\b20\d{2}\b|\bQ[1-4]\b|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|FY\s*\d{2,4}|الربع|٢٠\d{2})/i.test(h)) {
            periodCols.push(idx);
        }
    });

    // Detect if Column 0 is explicitly a Metric / Line Item header
    const col0IsMetric = headersLower.length > 0 &&
        /^(metric|line\s*item|particulars|account|description|measure|financial\s*item|item|البند|البيان)$/i.test(headersLower[0]);

    let layoutType = 'generic_tabular';

    if (entityColIdx !== -1 && periodColIdx !== -1) {
        layoutType = 'entity_period_records';
    } else if (entityColIdx !== -1) {
        layoutType = 'entity_records';
    } else if (col0IsMetric && headers.length > 2 && periodCols.length === 0) {
        layoutType = 'metric_dimension_matrix';
    } else if (periodCols.length >= 1 && entityColIdx === -1) {
        layoutType = 'time_series_matrix';
    } else if (headers.length === 2) {
        layoutType = 'key_value_pairs';
    }

    return {
        layoutType,
        headerRowIndex,
        entityColIdx,
        periodColIdx,
        periodCols,
        col0IsMetric
    };
}

// ----------------------------------------------------------------------------
// 5. Source Location Builder
// ----------------------------------------------------------------------------

function buildSourceLocation(table, rowIndex, columnIndex, colHeader = null) {
    const sheet = table.sheet_name || null;
    const page = table.page_number || (table.source?.pageNumber) || null;
    const tableId = table.table_id || table.elementId || table.element_id || 'Table_1';

    const locationObj = {
        table: tableId,
        row: rowIndex,
        column: colHeader || columnIndex
    };
    if (sheet) locationObj.sheet = sheet;
    if (page) locationObj.page = page;

    const parts = [];
    if (sheet) parts.push(`Sheet: ${sheet}`);
    if (page) parts.push(`Page: ${page}`);
    parts.push(`Table: ${tableId}`);
    parts.push(`Row: ${rowIndex}`);
    if (colHeader) parts.push(`Col: ${colHeader}`);

    return {
        sourceLocationJson: locationObj,
        sourceLocationText: parts.join('; ')
    };
}

// ----------------------------------------------------------------------------
// 5.5 Dynamic Fact Scale and Currency Resolution (Phase 4.3.2)
// ----------------------------------------------------------------------------

/**
 * Resolves scale and currency for a specific fact from column/table/document context.
 * Non-monetary facts (ratios, percentages, headcount) are protected from table scale multipliers.
 */
function resolveFactScaleAndCurrency(table, columnIndex, metricLabel, docContext) {
    const isRatio = isRatioMetric(metricLabel);
    const isHeadcount = isHeadcountMetric(metricLabel);

    if (isRatio) {
        return {
            scale: 1,
            currency: null,
            isRatio: true,
            isHeadcount: false,
            normalizedUnit: 'ratio',
            originalUnit: 'ratio'
        };
    }
    if (isHeadcount) {
        return {
            scale: 1,
            currency: null,
            isRatio: false,
            isHeadcount: true,
            normalizedUnit: 'headcount',
            originalUnit: 'headcount'
        };
    }

    // 1. Column-Level Scale & Currency (most specific)
    let colScale = null;
    let colCurrency = null;
    if (columnIndex !== undefined && columnIndex !== null) {
        const columns = table.columns || [];
        const colObj = columns[columnIndex] || {};
        const colHeader = (table.headers && table.headers[columnIndex]) || colObj.header || '';
        const headerPath = colObj.headerPath || [];

        const hScale = extractScaleFromText(colHeader);
        if (hScale) {
            colScale = hScale.scale;
            if (hScale.currency) colCurrency = hScale.currency;
        } else if (Array.isArray(headerPath)) {
            for (const p of headerPath) {
                const s = extractScaleFromText(p);
                if (s) {
                    colScale = s.scale;
                    if (s.currency) colCurrency = s.currency;
                    break;
                }
            }
        }
    }

    // 2. Table-Level Scale & Currency
    let tableScale = table.scale || table.metadata?.scale || table.structure?.scale || null;
    let tableCurrency = table.currency || table.metadata?.currency || null;
    if (!tableScale) {
        const tScale = extractScaleFromText(table.title || table.caption || table.sheet_name || '');
        if (tScale) {
            tableScale = tScale.scale;
            if (tScale.currency) tableCurrency = tScale.currency;
        }
    }

    // Check Pre-header table rows or row notes for scale declarations
    if (!tableScale && Array.isArray(table.rows)) {
        for (let r = 0; r < Math.min(table.rows.length, 3); r++) {
            const row = table.rows[r];
            if (row.rowType === 'header' || row.rowType === 'note') {
                const rowStr = (row.rawValues || (row.cells ? row.cells.map(c => c.value) : [])).join(' ');
                const rScale = extractScaleFromText(rowStr);
                if (rScale) {
                    tableScale = rScale.scale;
                    if (rScale.currency) tableCurrency = rScale.currency;
                    break;
                }
            }
        }
    }

    // 3. Hierarchical Resolution (Column > Table > Document > 1)
    const effectiveScale = colScale || tableScale || docContext.scale || 1;
    const effectiveCurrency = colCurrency || tableCurrency || docContext.currency || null;

    let originalUnit = 'amount';
    if (effectiveScale === 1000) originalUnit = 'thousand';
    else if (effectiveScale === 1000000) originalUnit = 'million';
    else if (effectiveScale === 1000000000) originalUnit = 'billion';

    return {
        scale: effectiveScale,
        currency: effectiveCurrency,
        isRatio: false,
        isHeadcount: false,
        normalizedUnit: 'amount',
        originalUnit
    };
}

/**
 * Dynamically resolves reporting basis for a row, column, or metric label.
 * Checks for Budget/Plan, Forecast/Projection, and Actual/Audited.
 * Falls back to document-level default reporting basis.
 */
function resolveRowReportingBasis(label, defaultBasis = 'Actual') {
    if (!label || typeof label !== 'string') return defaultBasis;
    if (/\b(?:budget(?:ed)?|plan(?:ned)?)\b|الميزانية|الخطة|ميزانية|خطة/i.test(label)) return 'Budget';
    if (/\b(?:forecast(?:ed)?|project(?:ed|ion)?)\b|التوقعات|توقعات/i.test(label)) return 'Forecast';
    if (/\b(?:audited|actual)\b|فعلي|مدقق/i.test(label)) return 'Actual';
    return defaultBasis;
}

// ----------------------------------------------------------------------------
// 6. Main Financial Fact Extraction Engine
// ----------------------------------------------------------------------------

function extractFinancialFacts(normalizedDoc, options = {}) {
    const facts = [];
    const elements = normalizedDoc.elements || [];
    const rawTables = normalizedDoc.tables || [];
    const tables = elements.filter(e => e.elementType === 'table').length > 0
        ? elements.filter(e => e.elementType === 'table')
        : rawTables;

    const docId = normalizedDoc.document?.documentId || normalizedDoc.document_id || null;
    const docContext = extractDocumentContext(normalizedDoc);

    let factSeq = 0;

    for (let tIdx = 0; tIdx < tables.length; tIdx++) {
        const table = tables[tIdx];
        const {
            layoutType,
            headerRowIndex,
            entityColIdx,
            periodColIdx,
            periodCols
        } = analyzeTableLayout(table);

        const columns = table.columns || [];
        const headers = table.headers || columns.map(c => c.header || '');

        // Resolve Table-Level Entity (from table title, caption, or sheet name if present)
        let tableEntity = docContext.documentIssuer;
        if (table.title || table.caption || table.sheet_name) {
            const tableTitleEntity = extractEntityFromText(table.title || table.caption || table.sheet_name);
            if (tableTitleEntity) {
                tableEntity = tableTitleEntity;
            }
        }

        // Filter genuine data/total rows (skip headers, notes, footnotes, disclaimers)
        const dataRows = (table.rows || []).filter(row => {
            if (headerRowIndex !== -1 && row.rowIndex <= headerRowIndex) return false;
            if (row.rowType && ['note', 'footnote', 'disclaimer', 'separator', 'header'].includes(row.rowType)) return false;
            const vals = row.rawValues || (row.cells ? row.cells.map(c => c.value) : []);
            return vals.some(v => v !== undefined && v !== null && String(v).trim() !== '');
        });

        // ---------------------------------------------------------------------
        // Case A: Entity-Period Records Table (e.g. Doc 11: Entity | Quarter | Revenue | Net profit)
        // ---------------------------------------------------------------------
        if (layoutType === 'entity_period_records') {
            for (const row of dataRows) {
                const vals = row.rawValues || (row.cells ? row.cells.map(c => c.value) : []);
                const entityVal = String(vals[entityColIdx] || '').trim();
                const periodVal = String(vals[periodColIdx] || '').trim() || docContext.defaultPeriod;
                if (!entityVal) continue;

                for (let c = 0; c < headers.length; c++) {
                    if (c === entityColIdx || c === periodColIdx) continue;
                    const colHeader = headers[c];
                    const rawVal = vals[c];
                    if (rawVal === undefined || rawVal === null || String(rawVal).trim() === '') continue;

                    const cellObj = row.cells ? row.cells[c] : null;
                    const isErrorCell = cellObj?.cellType === 'error' || /^#(DIV\/0!|N\/A|VALUE!|REF!|NAME\?|NUM!|NULL!)/i.test(String(rawVal).trim());

                    const metricName = colHeader.replace(/__\d+$/, '').trim();
                    const scaleInfo = resolveFactScaleAndCurrency(table, c, metricName, docContext);

                    let inputVal = rawVal;
                    if (cellObj && typeof cellObj.value === 'number') {
                        if (cellObj.value < 0 && typeof rawVal === 'string' && !rawVal.includes('-') && !rawVal.includes('(')) {
                            inputVal = cellObj.value;
                        }
                    }

                    let norm;
                    if (isErrorCell) {
                        norm = { originalValue: rawVal, originalTextValue: String(rawVal), originalUnit: 'unknown', normalizedValue: null, normalizedUnit: 'unknown', numericValue: null, currency: scaleInfo.currency, isError: true };
                    } else {
                        norm = normalizeFinancialValue(inputVal, {
                            scale: scaleInfo.scale,
                            currency: scaleInfo.currency,
                            normalizedUnit: scaleInfo.normalizedUnit,
                            originalUnit: scaleInfo.originalUnit,
                            originalTextValue: cellObj?.formattedValue || String(rawVal),
                            isRatio: scaleInfo.isRatio,
                            isHeadcount: scaleInfo.isHeadcount
                        });
                        // Skip non-numeric metadata/commentary columns (e.g. "Source used", "Comment")
                        if (!isErrorCell && norm.numericValue === null) continue;
                    }

                    const loc = buildSourceLocation(table, row.rowIndex, c, colHeader);
                    let normUnit = norm.normalizedUnit;
                    let factCurr = norm.currency || scaleInfo.currency;
                    if (scaleInfo.isRatio || normUnit === 'ratio' || normUnit === 'percentage') {
                        normUnit = 'ratio';
                        factCurr = null;
                    } else if (scaleInfo.isHeadcount || normUnit === 'headcount') {
                        normUnit = 'headcount';
                        factCurr = null;
                    }

                    factSeq++;
                    facts.push({
                        factId: `${docId}_fact_${factSeq}`,
                        documentId: docId,
                        metric: metricName,
                        metricLabel: metricName,
                        originalLabel: colHeader,
                        entity: entityVal,
                        entityLabel: entityVal,
                        periodLabel: periodVal,
                        periodStart: docContext.periodStart,
                        periodEnd: docContext.periodEnd,
                        temporalType: inferTemporalType(metricName, periodVal),
                        asOfDate: docContext.asOfDate,
                        reportingBasis: resolveRowReportingBasis(colHeader, resolveRowReportingBasis(metricName, docContext.reportingBasis)),
                        reportingScope: 'Entity',
                        rawValue: cellObj && cellObj.value !== undefined ? cellObj.value : rawVal,
                        originalValue: norm.originalValue,
                        originalTextValue: cellObj?.formattedValue || norm.originalTextValue || String(rawVal),
                        originalUnit: norm.originalUnit,
                        normalizedValue: norm.normalizedValue,
                        normalizedUnit: normUnit,
                        numericValue: norm.numericValue,
                        currency: factCurr,
                        dimensions: {},
                        sourceLocationJson: loc.sourceLocationJson,
                        sourceLocationText: loc.sourceLocationText,
                        sourceLocation: loc.sourceLocationText,
                        sourceFileName: docContext.fileName,
                        extractionMethod: table.extraction_method || 'LocalExtractor',
                        extractionConfidence: 0.98,
                        validationStatus: isErrorCell ? 'Invalid' : 'Validated',
                        mappingStatus: 'Approved'
                    });
                }
            }
        }
        // ---------------------------------------------------------------------
        // Case A2: Entity Records Table without Period Column (e.g. Doc 7: Entity | Revenue | Operating expenses | Net profit)
        // ---------------------------------------------------------------------
        else if (layoutType === 'entity_records') {
            for (const row of dataRows) {
                const vals = row.rawValues || (row.cells ? row.cells.map(c => c.value) : []);
                const entityVal = String(vals[entityColIdx] || '').trim();
                if (!entityVal) continue;

                for (let c = 0; c < headers.length; c++) {
                    if (c === entityColIdx) continue;
                    const colHeader = headers[c];
                    const rawVal = vals[c];
                    if (rawVal === undefined || rawVal === null || String(rawVal).trim() === '') continue;

                    const cellObj = row.cells ? row.cells[c] : null;
                    const isErrorCell = cellObj?.cellType === 'error' || /^#(DIV\/0!|N\/A|VALUE!|REF!|NAME\?|NUM!|NULL!)/i.test(String(rawVal).trim());

                    const metricName = colHeader.replace(/__\d+$/, '').trim();
                    const scaleInfo = resolveFactScaleAndCurrency(table, c, metricName, docContext);

                    let inputVal = rawVal;
                    if (cellObj && typeof cellObj.value === 'number') {
                        if (cellObj.value < 0 && typeof rawVal === 'string' && !rawVal.includes('-') && !rawVal.includes('(')) {
                            inputVal = cellObj.value;
                        }
                    }

                    let norm;
                    if (isErrorCell) {
                        norm = { originalValue: rawVal, originalTextValue: String(rawVal), originalUnit: 'unknown', normalizedValue: null, normalizedUnit: 'unknown', numericValue: null, currency: scaleInfo.currency, isError: true };
                    } else {
                        norm = normalizeFinancialValue(inputVal, {
                            scale: scaleInfo.scale,
                            currency: scaleInfo.currency,
                            normalizedUnit: scaleInfo.normalizedUnit,
                            originalUnit: scaleInfo.originalUnit,
                            originalTextValue: cellObj?.formattedValue || String(rawVal),
                            isRatio: scaleInfo.isRatio,
                            isHeadcount: scaleInfo.isHeadcount
                        });
                        if (!isErrorCell && norm.numericValue === null) continue;
                    }

                    const loc = buildSourceLocation(table, row.rowIndex, c, colHeader);
                    let normUnit = norm.normalizedUnit;
                    let factCurr = norm.currency || scaleInfo.currency;
                    if (scaleInfo.isRatio || normUnit === 'ratio' || normUnit === 'percentage') {
                        normUnit = 'ratio';
                        factCurr = null;
                    } else if (scaleInfo.isHeadcount || normUnit === 'headcount') {
                        normUnit = 'headcount';
                        factCurr = null;
                    }

                    factSeq++;
                    facts.push({
                        factId: `${docId}_fact_${factSeq}`,
                        documentId: docId,
                        metric: metricName,
                        metricLabel: metricName,
                        originalLabel: colHeader,
                        entity: entityVal,
                        entityLabel: entityVal,
                        periodLabel: docContext.defaultPeriod,
                        periodStart: docContext.periodStart,
                        periodEnd: docContext.periodEnd,
                        temporalType: inferTemporalType(metricName, docContext.defaultPeriod),
                        asOfDate: docContext.asOfDate,
                        reportingBasis: resolveRowReportingBasis(colHeader, resolveRowReportingBasis(metricName, docContext.reportingBasis)),
                        reportingScope: entityVal.toLowerCase().includes('group') || entityVal.toLowerCase().includes('consolidated') ? 'Consolidated' : 'Entity',
                        rawValue: cellObj && cellObj.value !== undefined ? cellObj.value : rawVal,
                        originalValue: norm.originalValue,
                        originalTextValue: cellObj?.formattedValue || norm.originalTextValue || String(rawVal),
                        originalUnit: norm.originalUnit,
                        normalizedValue: norm.normalizedValue,
                        normalizedUnit: normUnit,
                        numericValue: norm.numericValue,
                        currency: factCurr,
                        dimensions: {},
                        sourceLocationJson: loc.sourceLocationJson,
                        sourceLocationText: loc.sourceLocationText,
                        sourceLocation: loc.sourceLocationText,
                        sourceFileName: docContext.fileName,
                        extractionMethod: table.extraction_method || 'LocalExtractor',
                        extractionConfidence: 0.98,
                        validationStatus: isErrorCell ? 'Invalid' : 'Validated',
                        mappingStatus: 'Approved'
                    });
                }
            }
        }
        // ---------------------------------------------------------------------
        // Case B: Time-Series Matrix (Row = Metric, Columns = Periods/Dates)
        // ---------------------------------------------------------------------
        else if (layoutType === 'time_series_matrix' || (headers.length > 2 && periodCols.length > 0)) {
            const labelColIdx = 0;

            for (const row of dataRows) {
                const vals = row.rawValues || (row.cells ? row.cells.map(c => c.value) : []);
                const rowLabel = String(vals[labelColIdx] || '').trim();
                if (!rowLabel || rowLabel.length < 2) continue;
                if (isFootnoteOrDisclaimerRow(rowLabel, row.rowType)) continue;

                for (let c = 1; c < headers.length; c++) {
                    const colHeader = headers[c];
                    const rawVal = vals[c];
                    if (rawVal === undefined || rawVal === null || String(rawVal).trim() === '') continue;

                    const cellObj = row.cells ? row.cells[c] : null;
                    const isErrorCell = cellObj?.cellType === 'error' || /^#(DIV\/0!|N\/A|VALUE!|REF!|NAME\?|NUM!|NULL!)/i.test(String(rawVal).trim());

                    const scaleInfo = resolveFactScaleAndCurrency(table, c, rowLabel, docContext);

                    let inputVal = rawVal;
                    if (cellObj && typeof cellObj.value === 'number') {
                        if (cellObj.value < 0 && typeof rawVal === 'string' && !rawVal.includes('-') && !rawVal.includes('(')) {
                            inputVal = cellObj.value;
                        }
                    }

                    let norm;
                    if (isErrorCell) {
                        norm = { originalValue: rawVal, originalTextValue: String(rawVal), originalUnit: 'unknown', normalizedValue: null, normalizedUnit: 'unknown', numericValue: null, currency: scaleInfo.currency, isError: true };
                    } else {
                        norm = normalizeFinancialValue(inputVal, {
                            scale: scaleInfo.scale,
                            currency: scaleInfo.currency,
                            normalizedUnit: scaleInfo.normalizedUnit,
                            originalUnit: scaleInfo.originalUnit,
                            originalTextValue: cellObj?.formattedValue || String(rawVal),
                            isRatio: scaleInfo.isRatio,
                            isHeadcount: scaleInfo.isHeadcount
                        });
                        if (!isErrorCell && norm.numericValue === null) continue;
                    }

                    // Handle 'As of [Date]' columns: preserve reporting period, extract asOfDate
                    let periodLabel = docContext.defaultPeriod;
                    let factAsOfDate = docContext.asOfDate;
                    if (/^(?:as\s+of|as\s+at|كما\s+في)\s*(.*)/i.test(colHeader)) {
                        const rawDateStr = colHeader.replace(/^(?:as\s+of|as\s+at|كما\s+في)\s*/i, '').trim();
                        const d = new Date(rawDateStr);
                        if (!isNaN(d.getTime())) {
                            factAsOfDate = d.toISOString().split('T')[0];
                        }
                    } else if (/(\b20\d{2}\b|\bQ[1-4]\b|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|FY\s*\d{2,4}|الربع|٢٠\d{2})/i.test(colHeader)) {
                        periodLabel = colHeader.replace(/__\d+$/, '').trim();
                    }

                    let rowBasis = resolveRowReportingBasis(colHeader, resolveRowReportingBasis(rowLabel, docContext.reportingBasis));

                    const loc = buildSourceLocation(table, row.rowIndex, c, colHeader);
                    let normUnit = norm.normalizedUnit;
                    let factCurr = norm.currency || scaleInfo.currency;
                    if (scaleInfo.isRatio || normUnit === 'ratio' || normUnit === 'percentage') {
                        normUnit = 'ratio';
                        factCurr = null;
                    } else if (scaleInfo.isHeadcount || normUnit === 'headcount') {
                        normUnit = 'headcount';
                        factCurr = null;
                    }

                    factSeq++;
                    facts.push({
                        factId: `${docId}_fact_${factSeq}`,
                        documentId: docId,
                        metric: rowLabel,
                        metricLabel: rowLabel,
                        originalLabel: rowLabel,
                        entity: tableEntity,
                        entityLabel: tableEntity,
                        periodLabel,
                        periodStart: docContext.periodStart,
                        periodEnd: docContext.periodEnd,
                        temporalType: inferTemporalType(rowLabel, periodLabel),
                        asOfDate: factAsOfDate,
                        reportingBasis: rowBasis,
                        reportingScope: docContext.reportingScope,
                        rawValue: cellObj && cellObj.value !== undefined ? cellObj.value : rawVal,
                        originalValue: norm.originalValue,
                        originalTextValue: cellObj?.formattedValue || norm.originalTextValue || String(rawVal),
                        originalUnit: norm.originalUnit,
                        normalizedValue: norm.normalizedValue,
                        normalizedUnit: normUnit,
                        numericValue: norm.numericValue,
                        currency: factCurr,
                        dimensions: {},
                        sourceLocationJson: loc.sourceLocationJson,
                        sourceLocationText: loc.sourceLocationText,
                        sourceLocation: loc.sourceLocationText,
                        sourceFileName: docContext.fileName,
                        extractionMethod: table.extraction_method || 'LocalExtractor',
                        extractionConfidence: docContext.entityResolution.confidence,
                        validationStatus: isErrorCell ? 'Invalid' : 'Validated',
                        mappingStatus: 'Approved'
                    });
                }
            }
        }
        // ---------------------------------------------------------------------
        // Case B2: Metric Dimension Matrix (e.g. Fixture 1: Metric | Segment 1 | Segment 2)
        // ---------------------------------------------------------------------
        else if (layoutType === 'metric_dimension_matrix') {
            const labelColIdx = 0;

            for (const row of dataRows) {
                const vals = row.rawValues || (row.cells ? row.cells.map(c => c.value) : []);
                const rowLabel = String(vals[labelColIdx] || '').trim();
                if (!rowLabel || rowLabel.length < 2) continue;
                if (isFootnoteOrDisclaimerRow(rowLabel, row.rowType)) continue;

                for (let c = 1; c < headers.length; c++) {
                    const colHeader = headers[c];
                    const colObj = columns[c] || {};
                    const headerPath = colObj.headerPath || [];
                    const rawVal = vals[c];
                    if (rawVal === undefined || rawVal === null || String(rawVal).trim() === '') continue;

                    const cellObj = row.cells ? row.cells[c] : null;
                    const isErrorCell = cellObj?.cellType === 'error' || /^#(DIV\/0!|N\/A|VALUE!|REF!|NAME\?|NUM!|NULL!)/i.test(String(rawVal).trim());

                    const scaleInfo = resolveFactScaleAndCurrency(table, c, rowLabel, docContext);

                    let inputVal = rawVal;
                    if (cellObj && typeof cellObj.value === 'number') {
                        if (cellObj.value < 0 && typeof rawVal === 'string' && !rawVal.includes('-') && !rawVal.includes('(')) {
                            inputVal = cellObj.value;
                        }
                    }

                    let norm;
                    if (isErrorCell) {
                        norm = { originalValue: rawVal, originalTextValue: String(rawVal), originalUnit: 'unknown', normalizedValue: null, normalizedUnit: 'unknown', numericValue: null, currency: scaleInfo.currency, isError: true };
                    } else {
                        norm = normalizeFinancialValue(inputVal, {
                            scale: scaleInfo.scale,
                            currency: scaleInfo.currency,
                            normalizedUnit: scaleInfo.normalizedUnit,
                            originalUnit: scaleInfo.originalUnit,
                            originalTextValue: cellObj?.formattedValue || String(rawVal),
                            isRatio: scaleInfo.isRatio,
                            isHeadcount: scaleInfo.isHeadcount
                        });
                        if (!isErrorCell && norm.numericValue === null) continue;
                    }

                    const dims = extractDimensionsFromHeader(colHeader, headerPath);
                    const loc = buildSourceLocation(table, row.rowIndex, c, colHeader);
                    let normUnit = norm.normalizedUnit;
                    let factCurr = norm.currency || scaleInfo.currency;
                    if (scaleInfo.isRatio || normUnit === 'ratio' || normUnit === 'percentage') {
                        normUnit = 'ratio';
                        factCurr = null;
                    } else if (scaleInfo.isHeadcount || normUnit === 'headcount') {
                        normUnit = 'headcount';
                        factCurr = null;
                    }

                    factSeq++;
                    facts.push({
                        factId: `${docId}_fact_${factSeq}`,
                        documentId: docId,
                        metric: rowLabel,
                        metricLabel: rowLabel,
                        originalLabel: rowLabel,
                        entity: tableEntity,
                        entityLabel: tableEntity,
                        periodLabel: docContext.defaultPeriod,
                        periodStart: docContext.periodStart,
                        periodEnd: docContext.periodEnd,
                        temporalType: inferTemporalType(rowLabel, docContext.defaultPeriod),
                        asOfDate: docContext.asOfDate,
                        reportingBasis: resolveRowReportingBasis(colHeader, resolveRowReportingBasis(rowLabel, docContext.reportingBasis)),
                        reportingScope: docContext.reportingScope,
                        rawValue: cellObj && cellObj.value !== undefined ? cellObj.value : rawVal,
                        originalValue: norm.originalValue,
                        originalTextValue: cellObj?.formattedValue || norm.originalTextValue || String(rawVal),
                        originalUnit: norm.originalUnit,
                        normalizedValue: norm.normalizedValue,
                        normalizedUnit: normUnit,
                        numericValue: norm.numericValue,
                        currency: factCurr,
                        dimensions: dims,
                        sourceLocationJson: loc.sourceLocationJson,
                        sourceLocationText: loc.sourceLocationText,
                        sourceLocation: loc.sourceLocationText,
                        sourceFileName: docContext.fileName,
                        extractionMethod: table.extraction_method || 'LocalExtractor',
                        extractionConfidence: docContext.entityResolution.confidence,
                        validationStatus: isErrorCell ? 'Invalid' : 'Validated',
                        mappingStatus: 'Approved'
                    });
                }
            }
        }
        // ---------------------------------------------------------------------
        // Case C: Key-Value Pairs (2-column summary sheets, e.g. Fixture 3)
        // ---------------------------------------------------------------------
        else if (layoutType === 'key_value_pairs' || headers.length === 2) {
            for (const row of dataRows) {
                const vals = row.rawValues || (row.cells ? row.cells.map(c => c.value) : []);
                const label = String(vals[0] || '').trim();
                const rawVal = vals[1];
                if (!label || rawVal === undefined || rawVal === null || String(rawVal).trim() === '') continue;
                if (isFootnoteOrDisclaimerRow(label, row.rowType)) continue;

                const cellObj = row.cells ? row.cells[1] : null;
                const isErrorCell = cellObj?.cellType === 'error' || /^#(DIV\/0!|N\/A|VALUE!|REF!|NAME\?|NUM!|NULL!)/i.test(String(rawVal).trim());

                const scaleInfo = resolveFactScaleAndCurrency(table, 1, label, docContext);

                let inputVal = rawVal;
                if (cellObj && typeof cellObj.value === 'number') {
                    if (cellObj.value < 0 && typeof rawVal === 'string' && !rawVal.includes('-') && !rawVal.includes('(')) {
                        inputVal = cellObj.value;
                    }
                }

                let norm;
                if (isErrorCell) {
                    norm = { originalValue: rawVal, originalTextValue: String(rawVal), originalUnit: 'unknown', normalizedValue: null, normalizedUnit: 'unknown', numericValue: null, currency: scaleInfo.currency, isError: true };
                } else {
                    norm = normalizeFinancialValue(inputVal, {
                        scale: scaleInfo.scale,
                        currency: scaleInfo.currency,
                        normalizedUnit: scaleInfo.normalizedUnit,
                        originalUnit: scaleInfo.originalUnit,
                        originalTextValue: cellObj?.formattedValue || String(rawVal),
                        isRatio: scaleInfo.isRatio,
                        isHeadcount: scaleInfo.isHeadcount
                    });
                    if (!isErrorCell && norm.numericValue === null) continue;
                }

                const loc = buildSourceLocation(table, row.rowIndex, 1, headers[1]);
                let normUnit = norm.normalizedUnit;
                let factCurr = norm.currency || scaleInfo.currency;
                if (scaleInfo.isRatio || normUnit === 'ratio' || normUnit === 'percentage') {
                    normUnit = 'ratio';
                    factCurr = null;
                } else if (scaleInfo.isHeadcount || normUnit === 'headcount') {
                    normUnit = 'headcount';
                    factCurr = null;
                }

                factSeq++;
                facts.push({
                    factId: `${docId}_fact_${factSeq}`,
                    documentId: docId,
                    metric: label,
                    metricLabel: label,
                    originalLabel: label,
                    entity: tableEntity,
                    entityLabel: tableEntity,
                    periodLabel: docContext.defaultPeriod,
                    periodStart: docContext.periodStart,
                    periodEnd: docContext.periodEnd,
                    temporalType: inferTemporalType(label, docContext.defaultPeriod),
                    asOfDate: docContext.asOfDate,
                    reportingBasis: resolveRowReportingBasis(label, docContext.reportingBasis),
                    reportingScope: docContext.reportingScope,
                    rawValue: cellObj && cellObj.value !== undefined ? cellObj.value : rawVal,
                    originalValue: norm.originalValue,
                    originalTextValue: cellObj?.formattedValue || norm.originalTextValue || String(rawVal),
                    originalUnit: norm.originalUnit,
                    normalizedValue: norm.normalizedValue,
                    normalizedUnit: normUnit,
                    numericValue: norm.numericValue,
                    currency: factCurr,
                    dimensions: {},
                    sourceLocationJson: loc.sourceLocationJson,
                    sourceLocationText: loc.sourceLocationText,
                    sourceLocation: loc.sourceLocationText,
                    sourceFileName: docContext.fileName,
                    extractionMethod: table.extraction_method || 'LocalExtractor',
                    extractionConfidence: docContext.entityResolution.confidence,
                    validationStatus: isErrorCell ? 'Invalid' : 'Validated',
                    mappingStatus: 'Approved'
                });
            }
        }
        // ---------------------------------------------------------------------
        // Case D: Generic Tabular Records
        // ---------------------------------------------------------------------
        else {
            for (const row of dataRows) {
                const vals = row.rawValues || (row.cells ? row.cells.map(c => c.value) : []);
                const rowLabel = String(vals[0] || '').trim();
                if (!rowLabel) continue;
                if (isFootnoteOrDisclaimerRow(rowLabel, row.rowType)) continue;

                for (let c = 1; c < headers.length; c++) {
                    const colHeader = headers[c];
                    const rawVal = vals[c];
                    if (rawVal === undefined || rawVal === null || String(rawVal).trim() === '') continue;

                    const cellObj = row.cells ? row.cells[c] : null;
                    const isErrorCell = cellObj?.cellType === 'error' || /^#(DIV\/0!|N\/A|VALUE!|REF!|NAME\?|NUM!|NULL!)/i.test(String(rawVal).trim());

                    const metricName = colHeader.replace(/__\d+$/, '').trim();
                    const scaleInfo = resolveFactScaleAndCurrency(table, c, metricName, docContext);

                    let inputVal = rawVal;
                    if (cellObj && typeof cellObj.value === 'number') {
                        if (cellObj.value < 0 && typeof rawVal === 'string' && !rawVal.includes('-') && !rawVal.includes('(')) {
                            inputVal = cellObj.value;
                        }
                    }

                    let norm;
                    if (isErrorCell) {
                        norm = { originalValue: rawVal, originalTextValue: String(rawVal), originalUnit: 'unknown', normalizedValue: null, normalizedUnit: 'unknown', numericValue: null, currency: scaleInfo.currency, isError: true };
                    } else {
                        norm = normalizeFinancialValue(inputVal, {
                            scale: scaleInfo.scale,
                            currency: scaleInfo.currency,
                            normalizedUnit: scaleInfo.normalizedUnit,
                            originalUnit: scaleInfo.originalUnit,
                            originalTextValue: cellObj?.formattedValue || String(rawVal),
                            isRatio: scaleInfo.isRatio,
                            isHeadcount: scaleInfo.isHeadcount
                        });
                        if (!isErrorCell && norm.numericValue === null) continue;
                    }

                    const loc = buildSourceLocation(table, row.rowIndex, c, colHeader);
                    let normUnit = norm.normalizedUnit;
                    let factCurr = norm.currency || scaleInfo.currency;
                    if (scaleInfo.isRatio || normUnit === 'ratio' || normUnit === 'percentage') {
                        normUnit = 'ratio';
                        factCurr = null;
                    } else if (scaleInfo.isHeadcount || normUnit === 'headcount') {
                        normUnit = 'headcount';
                        factCurr = null;
                    }

                    factSeq++;
                    facts.push({
                        factId: `${docId}_fact_${factSeq}`,
                        documentId: docId,
                        metric: metricName,
                        metricLabel: metricName,
                        originalLabel: colHeader,
                        entity: tableEntity,
                        entityLabel: tableEntity,
                        periodLabel: docContext.defaultPeriod,
                        periodStart: docContext.periodStart,
                        periodEnd: docContext.periodEnd,
                        temporalType: inferTemporalType(metricName, docContext.defaultPeriod),
                        asOfDate: docContext.asOfDate,
                        reportingBasis: resolveRowReportingBasis(colHeader, resolveRowReportingBasis(rowLabel, docContext.reportingBasis)),
                        reportingScope: 'Entity',
                        rawValue: cellObj && cellObj.value !== undefined ? cellObj.value : rawVal,
                        originalValue: norm.originalValue,
                        originalTextValue: cellObj?.formattedValue || norm.originalTextValue || String(rawVal),
                        originalUnit: norm.originalUnit,
                        normalizedValue: norm.normalizedValue,
                        normalizedUnit: normUnit,
                        numericValue: norm.numericValue,
                        currency: factCurr,
                        dimensions: {},
                        sourceLocationJson: loc.sourceLocationJson,
                        sourceLocationText: loc.sourceLocationText,
                        sourceLocation: loc.sourceLocationText,
                        sourceFileName: docContext.fileName,
                        extractionMethod: table.extraction_method || 'LocalExtractor',
                        extractionConfidence: docContext.entityResolution.confidence,
                        validationStatus: isErrorCell ? 'Invalid' : 'Validated',
                        mappingStatus: 'Approved'
                    });
                }
            }
        }
    }

    // -------------------------------------------------------------------------
    // 7. Process Narrative Paragraphs for Explicit Financial Facts (Phase 4.3.3)
    // -------------------------------------------------------------------------
    const paragraphs = normalizedDoc.paragraphs || (normalizedDoc.elements ? normalizedDoc.elements.filter(e => e.elementType === 'paragraph') : []);
    const narrativeFacts = extractNarrativeFinancialFacts(paragraphs, docContext, facts, docId, options);
    facts.push(...narrativeFacts);

    return facts;
}

// ----------------------------------------------------------------------------
// 6. Dynamic Narrative Financial Fact Extractor (Phase 4.3.3 & 4.3.5)
// ----------------------------------------------------------------------------

const FINANCIAL_VALUE_PATTERN = /(?:(?:AED|USD|EUR|GBP|SAR|QAR|KWD|BHD|OMR|JPY|CNY|CHF|AUD|CAD|[$€£¥₹])\s*[+-]?\d{1,3}(?:,\d{3})*(?:\.\d+)?(?:\s*(?:million|billion|thousand|mn|bn|k|m|مليون|مليار|ألف|آلاف))?|[+-]?\d{1,3}(?:,\d{3})*(?:\.\d+)?\s*(?:million|billion|thousand|mn|bn|k|m|مليون|مليار|ألف|آلاف)\s*(?:AED|USD|EUR|GBP|SAR|درهم|ريال|دولار|يورو|جنيه)?|[+-]?\d+(?:\.\d+)?\s*(?:%|bps|نقطة أساس)|[+-]?\d{1,3}(?:,\d{3})*(?:\.\d+)?\s*(?:AED|USD|EUR|GBP|SAR|درهم|ريال|دولار|يورو|جنيه))/gi;

/**
 * Separates temporal qualifications from financial metric labels.
 * e.g. "Revenue in Q2 2026" -> { metric: "Revenue", period: "Q2 2026" }
 * e.g. "المصاريف التشغيلية خلال الربع الأول 2026" -> { metric: "المصاريف التشغيلية", period: "الربع الأول 2026" }
 */
function cleanMetricLabel(rawLabel) {
    if (!rawLabel || typeof rawLabel !== 'string') return { metric: '', period: null };
    let metric = rawLabel.trim();
    let period = null;

    const temporalPreps = /\s+(?:in|for|during|as\s+of|خلال|في)\s+(?:the\s+year\s+|the\s+period\s+ended\s+|عام\s+|سنة\s+)?(Q[1-4](?:\s*20\d\d)?|FY\s*20\d\d|20\d\d(?:\s*Q[1-4])?|the\s+period\s+ended|الربع\s+(?:الأول|الثاني|الثالث|الرابع)(?:\s+\d{4})?|\d{4})/i;
    const match = metric.match(temporalPreps);
    if (match) {
        period = match[1].trim();
        metric = metric.slice(0, match.index).trim();
    }

    return { metric, period };
}

/**
 * Extracts financial facts embedded in free-form English and Arabic paragraphs.
 * Rejects dates, physical item counts, page numbers, and non-financial values.
 * Deduplicates against already extracted table facts using full business identity.
 * 
 * @param {Array<object|string>} paragraphs - Paragraph elements or text
 * @param {object} docContext - Resolved document context
 * @param {Array<object>} existingFacts - Facts already extracted (e.g. from tables)
 * @param {string} docId - Document identifier
 * @param {object} [options] - Additional extraction options
 * @returns {Array<object>} Extracted narrative facts
 */
function extractNarrativeFinancialFacts(paragraphs, docContext, existingFacts = [], docId = 'doc', options = {}) {
    const narrativeFacts = [];
    let factSeq = existingFacts.length;

    if (!Array.isArray(paragraphs) || paragraphs.length === 0) {
        return narrativeFacts;
    }

    for (let pIdx = 0; pIdx < paragraphs.length; pIdx++) {
        const pObj = paragraphs[pIdx];
        const pText = String(pObj.content || pObj.text || (typeof pObj === 'string' ? pObj : '')).trim();
        if (!pText || pText.length < 8) continue;

        const locText = pObj.elementId ? `Paragraph ${pObj.elementId}` : `Paragraph ${pIdx + 1}`;
        
        // Split into sentences (careful not to split on decimals like 5.0 or 34.5)
        const sentences = pText.split(/(?<=[^\d\s][.؛;]|\n+)/g).map(s => s.trim()).filter(Boolean);

        for (const sentence of sentences) {
            // Split into clauses by connectors (English & Arabic)
            const clauses = sentence.split(/(?:\s*,\s*and\s+|\s*;\s*|\s*؛\s*|\s*,\s*while\s+|(?<=[0-9%])\s+and\s+|(?<=\b(?:million|billion|thousand|mn|bn|k|bps|مليون|مليار|ألف)\b)\s+and\s+|،|\s+بينما\s+|\s+في حين\s+)/i).map(c => c.trim()).filter(Boolean);

            for (const clause of clauses) {
                let rawSubject = null;
                let rawVal = null;
                let isDelta = false;
                let isDecrease = false;

                // 1. Arabic Announcement Delta (e.g. سجلت الشركة نمواً في الإيرادات بنسبة 15%)
                const arAnnounceDelta = /(?:سجلت|حققت|شهدت|أظهرت)\s+(?:الشركة\s+)?(نمواً|زيادة|ارتفاعاً|تراجعاً|انخفاضاً)\s+(?:في\s+)?([A-Za-z\u0600-\u06FF\s]{2,40}?)\s+(?:بنسبة|بمقدار|بقيمة|لتصل إلى|قدره|قدرها)\s+([A-Za-z0-9\u0600-\u06FF%$€£¥₹\s,.-]+)/i;
                let m = clause.match(arAnnounceDelta);
                if (m) {
                    const vm = m[3].match(FINANCIAL_VALUE_PATTERN);
                    if (vm) {
                        rawSubject = m[2].trim();
                        rawVal = vm[0].trim();
                        isDelta = true;
                        isDecrease = /تراجعاً|انخفاضاً/i.test(m[1]);
                    }
                }

                // 2. Arabic Announcement / Achievement (e.g. حققت الشركة أرباحاً قدرها 34.5 مليون درهم)
                if (!rawSubject) {
                    const arAnnounce = /(?:حققت|سجلت|أعلنت|أظهرت|بلغت|وصلت)\s+(?:الشركة\s+)?([A-Za-z\u0600-\u06FF\s]{2,40}?)\s+(?:قدرها|قدره|بقيمة|تصل إلى|بواقع|نحو|إلى)\s+([A-Za-z0-9\u0600-\u06FF%$€£¥₹\s,.-]+)/i;
                    m = clause.match(arAnnounce);
                    if (m) {
                        const vm = m[2].match(FINANCIAL_VALUE_PATTERN);
                        if (vm) {
                            rawSubject = m[1].trim();
                            rawVal = vm[0].trim();
                        }
                    }
                }

                // 3. Arabic Change / Growth Verb (e.g. ارتفعت المصاريف / تراجعت التكاليف بنسبة 4%)
                if (!rawSubject) {
                    const arWithConn = /(ارتفعت|زادت|نمت|انخفضت|تراجعت|هبطت)\s+(?:الشركة\s+)?([A-Za-z\u0600-\u06FF\s]{2,40}?)\s+(?:بنسبة|بمقدار|بقيمة|لتصل إلى|إلى|نحو)\s+([A-Za-z0-9\u0600-\u06FF%$€£¥₹\s,.-]+)/i;
                    const arNoConn = /(ارتفعت|زادت|نمت|انخفضت|تراجعت|هبطت)\s+(?:الشركة\s+)?([A-Za-z\u0600-\u06FF\s]{2,40}?)\s+([0-9%$€£¥₹][A-Za-z0-9\u0600-\u06FF%$€£¥₹\s,.-]+)/i;
                    m = clause.match(arWithConn) || clause.match(arNoConn);
                    if (m) {
                        const vm = m[3].match(FINANCIAL_VALUE_PATTERN);
                        if (vm) {
                            rawSubject = m[2].trim();
                            rawVal = vm[0].trim();
                            isDelta = true;
                            isDecrease = /انخفضت|تراجعت|هبطت/i.test(m[1]);
                        }
                    }
                }

                // 4. Arabic VSO Stative / Reporting (e.g. بلغت الإيرادات 50 مليون دولار / حققت الشركة أرباحاً 10 مليون يورو)
                if (!rawSubject) {
                    const arVSO = /(?:بلغت|بلغ|وصلت|وصل|سجلت|سجل|حققت|حقق)\s+(?:الشركة\s+)?([A-Za-z\u0600-\u06FF\s]{2,40}?)\s+(?:نحو|حوالي|ما يقارب)?\s*([0-9%$€£¥₹][A-Za-z0-9\u0600-\u06FF%$€£¥₹\s,.-]+)/i;
                    m = clause.match(arVSO);
                    if (m) {
                        const vm = m[2].match(FINANCIAL_VALUE_PATTERN);
                        if (vm) {
                            rawSubject = m[1].trim();
                            rawVal = vm[0].trim();
                        }
                    }
                }

                // 5. English Growth / Change (e.g. Revenue grew 5.0% / operating expenses decreased by 5%)
                if (!rawSubject) {
                    const enChange = /([A-Z][A-Za-z0-9\s]{1,40}?)\s+(grew|surged|expanded|accelerated|increased|rose|decreased|declined|fell|dropped|contracted|slumped)(?:\s+by)?\s+([A-Za-z0-9%$€£¥₹\s,.-]+)/i;
                    m = clause.match(enChange);
                    if (m) {
                        const vm = m[3].match(FINANCIAL_VALUE_PATTERN);
                        if (vm) {
                            rawSubject = m[1].trim();
                            rawVal = vm[0].trim();
                            isDelta = true;
                            isDecrease = /decreased|declined|fell|dropped|contracted|slumped/i.test(m[2]);
                        }
                    }
                }

                // 6. English Announcement / Reporting (e.g. The company reported consolidated revenue of $34.5 million)
                if (!rawSubject) {
                    const enAnnounce = /(?:reported|achieved|recorded|posted|generated|delivered)\s+(?:a\s+|an\s+)?([A-Za-z0-9\s]{2,40}?)\s+(?:of|totaling|amounting to|reaching)\s+([A-Za-z0-9%$€£¥₹\s,.-]+)/i;
                    m = clause.match(enAnnounce);
                    if (m) {
                        const vm = m[2].match(FINANCIAL_VALUE_PATTERN);
                        if (vm) {
                            rawSubject = m[1].trim();
                            rawVal = vm[0].trim();
                        }
                    }
                }

                // 7. English Stative / Copula (e.g. Total cash stood at $15.2 million)
                if (!rawSubject) {
                    const enStative = /([A-Z][A-Za-z0-9\s]{1,40}?)\s+(?:was|were|reached|stood at|recorded at|totaled|amounted to|came in at)\s+([A-Za-z0-9%$€£¥₹\s,.-]+)/i;
                    m = clause.match(enStative);
                    if (m) {
                        const vm = m[2].match(FINANCIAL_VALUE_PATTERN);
                        if (vm) {
                            rawSubject = m[1].trim();
                            rawVal = vm[0].trim();
                        }
                    }
                }

                // 8. Arabic SVO Stative / Copula (e.g. إجمالي الأرباح بلغ 50 مليون درهم)
                if (!rawSubject) {
                    const arStative = /([A-Za-z\u0600-\u06FF\s]{2,40}?)\s+(?:كان|كانت|بلغ|بلغت|وصل|وصلت إلى)\s+([A-Za-z0-9\u0600-\u06FF%$€£¥₹\s,.-]+)/i;
                    m = clause.match(arStative);
                    if (m) {
                        const vm = m[2].match(FINANCIAL_VALUE_PATTERN);
                        if (vm) {
                            rawSubject = m[1].trim();
                            rawVal = vm[0].trim();
                        }
                    }
                }

                if (!rawSubject || !rawVal) continue;

                // Dynamic Metric Labeling & Temporal Qualification Separation (Defect 6 & 7)
                const cleanedMetric = cleanMetricLabel(rawSubject);
                let cleanSubj = cleanedMetric.metric;
                let periodFromMetric = cleanedMetric.period;

                const isArabic = /[\u0600-\u06FF]/.test(cleanSubj);
                const isPercentVal = rawVal.includes('%') || rawVal.includes('bps');

                let metricLabel = cleanSubj;
                if (isDelta && isPercentVal) {
                    if (isArabic) {
                        if (isDecrease) {
                            metricLabel = cleanSubj.startsWith('تراجع ') ? cleanSubj : `تراجع ${cleanSubj.replace(/^نمو\s+/, '')}`;
                        } else {
                            metricLabel = cleanSubj.startsWith('نمو ') ? cleanSubj : `نمو ${cleanSubj}`;
                        }
                    } else {
                        if (isDecrease) {
                            metricLabel = `${cleanSubj} decrease`;
                        } else {
                            if (!/\b(growth|rate|margin|ratio)\b/i.test(cleanSubj)) {
                                metricLabel = `${cleanSubj} growth`;
                            }
                        }
                    }
                }

                const isRatio = isRatioMetric(metricLabel) || isPercentVal;
                const isHeadcount = isHeadcountMetric(metricLabel);

                const norm = normalizeFinancialValue(rawVal, {
                    currency: docContext.currency,
                    scale: isRatio || isHeadcount ? 1 : docContext.scale,
                    isRatio,
                    isHeadcount
                });

                if (norm.numericValue === null) continue;

                // Polarity Correction for Negative Deltas (Defect 3)
                if (isDecrease && (isPercentVal || isRatio || norm.normalizedUnit === 'ratio')) {
                    norm.normalizedValue = -Math.abs(norm.normalizedValue);
                    norm.numericValue = -Math.abs(norm.numericValue);
                }

                let normUnit = norm.normalizedUnit;
                let factCurr = norm.currency || docContext.currency;
                let rawValNum = norm.numericValue !== null ? norm.numericValue : norm.originalValue;

                if (isRatio || normUnit === 'ratio' || normUnit === 'percentage') {
                    normUnit = 'ratio';
                    factCurr = null;
                } else if (isHeadcount || normUnit === 'headcount') {
                    normUnit = 'headcount';
                    factCurr = null;
                }

                // Entity resolution: check if clause specifically names an entity
                let factEntity = docContext.documentIssuer;
                if (!/(?:the company|الشركة)/i.test(clause)) {
                    const namedEntity = extractEntityFromText(clause);
                    if (typeof namedEntity === 'string' && namedEntity.length > 0 && !/^الشركة$/i.test(namedEntity)) {
                        factEntity = namedEntity;
                    } else if (namedEntity && typeof namedEntity === 'object' && namedEntity.entity) {
                        factEntity = namedEntity.entity;
                    }
                }

                // Period resolution (Defect 6)
                let periodLabel = periodFromMetric || docContext.defaultPeriod;
                if (!periodFromMetric) {
                    const arQuarterMatch = clause.match(/الربع\s+(الأول|الثاني|الثالث|الرابع)(?:\s+من\s+عام\s+(\d{4}))?/i);
                    if (arQuarterMatch) {
                        const qMap = { 'الأول': 'Q1', 'الثاني': 'Q2', 'الثالث': 'Q3', 'الرابع': 'Q4' };
                        const q = qMap[arQuarterMatch[1]] || 'Q1';
                        const yr = arQuarterMatch[2] || (docContext.defaultPeriod ? docContext.defaultPeriod.match(/\b\d{4}\b/)?.[0] : '2026');
                        periodLabel = `${q} ${yr}`;
                    } else {
                        const enQuarterMatch = clause.match(/\b(Q[1-4])\s*(\d{4})?\b/i);
                        if (enQuarterMatch && !clause.includes('on Q') && !clause.includes('vs Q')) {
                            const yr = enQuarterMatch[2] || (docContext.defaultPeriod ? docContext.defaultPeriod.match(/\b\d{4}\b/)?.[0] : '2026');
                            periodLabel = `${enQuarterMatch[1].toUpperCase()} ${yr}`;
                        }
                    }
                }

                // Reporting Scope & Basis
                let scope = docContext.reportingScope || 'Entity';
                if (/مجمعة|مجمع|consolidated|group/i.test(metricLabel) || /مجمعة|مجمع|consolidated|group/i.test(clause)) {
                    scope = 'Consolidated';
                }
                const basisVal = resolveRowReportingBasis(clause, docContext.reportingBasis);

                // Full Business Identity Deduplication (Defect 2)
                const isDuplicate = existingFacts.some(f => {
                    const mMatch = f.metric.toLowerCase().replace(/[^a-z0-9\u0621-\u064A]/g, '') === metricLabel.toLowerCase().replace(/[^a-z0-9\u0621-\u064A]/g, '');
                    const vMatch = Math.abs((Number(f.normalizedValue) || 0) - (Number(norm.normalizedValue) || 0)) < 0.001;
                    const eMatch = !f.entity || !factEntity || f.entity.toLowerCase() === factEntity.toLowerCase();
                    const pMatch = !f.periodLabel || !periodLabel || f.periodLabel.toLowerCase().includes(periodLabel.toLowerCase()) || periodLabel.toLowerCase().includes(f.periodLabel.toLowerCase());
                    const bMatch = !f.reportingBasis || !basisVal || f.reportingBasis.toLowerCase() === basisVal.toLowerCase();
                    return mMatch && vMatch && eMatch && pMatch && bMatch;
                }) || narrativeFacts.some(f => {
                    const mMatch = f.metric.toLowerCase().replace(/[^a-z0-9\u0621-\u064A]/g, '') === metricLabel.toLowerCase().replace(/[^a-z0-9\u0621-\u064A]/g, '');
                    const vMatch = Math.abs((Number(f.normalizedValue) || 0) - (Number(norm.normalizedValue) || 0)) < 0.001;
                    const eMatch = !f.entity || !factEntity || f.entity.toLowerCase() === factEntity.toLowerCase();
                    const pMatch = !f.periodLabel || !periodLabel || f.periodLabel.toLowerCase() === periodLabel.toLowerCase();
                    const bMatch = !f.reportingBasis || !basisVal || f.reportingBasis.toLowerCase() === basisVal.toLowerCase();
                    const uMatch = !f.normalizedUnit || !normUnit || f.normalizedUnit === normUnit;
                    const cMatch = !f.currency || !factCurr || f.currency === factCurr;
                    return mMatch && vMatch && eMatch && pMatch && bMatch && uMatch && cMatch;
                });

                if (isDuplicate) continue;

                factSeq++;
                narrativeFacts.push({
                    factId: `${docId}_fact_${factSeq}`,
                    documentId: docId,
                    metric: metricLabel,
                    metricLabel,
                    originalLabel: metricLabel,
                    entity: factEntity,
                    entityLabel: factEntity,
                    periodLabel,
                    periodStart: docContext.periodStart,
                    periodEnd: docContext.periodEnd,
                    temporalType: inferTemporalType(metricLabel, periodLabel),
                    asOfDate: docContext.asOfDate,
                    reportingBasis: basisVal,
                    reportingScope: scope,
                    rawValue: rawValNum,
                    originalValue: norm.originalValue,
                    originalTextValue: rawVal,
                    originalUnit: norm.originalUnit,
                    normalizedValue: norm.normalizedValue,
                    normalizedUnit: normUnit,
                    numericValue: norm.numericValue,
                    currency: factCurr,
                    dimensions: {},
                    sourceLocationJson: { paragraphIndex: pIdx, elementId: pObj.elementId || null, textSnippet: pText.slice(0, 100) },
                    sourceLocationText: locText,
                    sourceLocation: locText,
                    sourceFileName: docContext.fileName,
                    extractionMethod: 'NarrativeParser',
                    extractionConfidence: 0.85,
                    validationStatus: 'Validated',
                    mappingStatus: 'Approved'
                });
            }
        }
    }

    return narrativeFacts;
}

// ----------------------------------------------------------------------------
// 7. Contextual Metric-Value Association & Verification Helpers (Phase 4.3.5 Defect 1)
// ----------------------------------------------------------------------------

/**
 * Splits text into individual clauses along punctuation, conjunctions, and Arabic connectors.
 */
function splitIntoClauses(text) {
    if (!text || typeof text !== 'string') return [];
    const cleanText = text.replace(/[\r\n]+/g, ' ').trim();
    const clauseDelim = /(?:[.;!?]|\s+while\s+|\s+whereas\s+|\s+accompanied by\s+|\s+compared to\s+|\s+against\s+|،|\s+بينما\s+|\s+في حين\s+)/i;
    const initialChunks = cleanText.split(clauseDelim).map(s => s.trim()).filter(Boolean);
    const result = [];
    for (const chunk of initialChunks) {
        const subChunks = chunk.split(/(?:,(?=\s*[A-Z\u0600-\u06FF])|(?<=[0-9%])\s+and\s+|(?<=\b(?:million|billion|thousand|mn|bn|k|bps|مليون|مليار|ألف)\b)\s+and\s+)/i);
        for (const sub of subChunks) {
            const trimmed = sub.trim();
            if (trimmed) result.push(trimmed);
        }
    }
    return result;
}

/**
 * Extracts significant tokens from a phrase (ignoring common stop words).
 */
function extractSignificantTokens(phrase) {
    if (!phrase || typeof phrase !== 'string') return [];
    const stopWords = new Set([
        'the', 'a', 'an', 'of', 'in', 'on', 'at', 'by', 'for', 'with', 'to', 'from',
        'growth', 'increase', 'decrease', 'margin', 'rate', 'ratio',
        'من', 'في', 'على', 'إلى', 'عن', 'مع', 'خلال', 'نسبة', 'معدل', 'هامش'
    ]);
    return phrase.toLowerCase()
        .replace(/[^\w\s\u0600-\u06FF]/g, ' ')
        .split(/\s+/)
        .map(w => w.trim())
        .filter(w => w.length >= 3 && !stopWords.has(w));
}

/**
 * Checks whether a clause contains the numeric or formatted representation of a fact.
 */
function clauseContainsValue(clause, fact) {
    const textVal = String(fact.originalTextValue || fact.rawValue || '').trim();
    if (!textVal) return false;
    if (clause.toLowerCase().includes(textVal.toLowerCase())) return true;
    
    // Check if numeric value appears (e.g. 5% or 0.05)
    const num = parseFloat(String(fact.rawValue).replace(/,/g, ''));
    if (!isNaN(num)) {
        if (num > 0 && num < 1 && (fact.normalizedUnit === 'ratio' || textVal.includes('%'))) {
            const pct = Math.round(num * 10000) / 100;
            const pctRegex = new RegExp(`\\b${pct}\\s*(?:%|percent|بالمائة)`, 'i');
            if (pctRegex.test(clause)) return true;
        }
        const numClean = Math.abs(num);
        const numRegex = new RegExp(`\\b${numClean}\\b`);
        if (numRegex.test(clause.replace(/,/g, ''))) return true;
    }
    return false;
}

/**
 * Validates contextual metric-value association (Defect 1).
 * Ensures that the extracted metric and numeric value are associated within the same contextual clause.
 * Prevents cross-metric value misattributions from being accepted.
 */
function isMetricAssociatedWithValue(metric, fact, sourceText) {
    if (!sourceText) return false;
    const clauses = splitIntoClauses(sourceText);
    if (clauses.length <= 1) {
        return clauseContainsValue(sourceText, fact);
    }
    
    const candidateTokens = extractSignificantTokens(metric);
    const valueClauses = clauses.filter(c => clauseContainsValue(c, fact));
    if (valueClauses.length === 0) return false;
    
    // Check if any clause containing the value also contains the metric or its significant tokens
    for (const vc of valueClauses) {
        const vcLower = vc.toLowerCase();
        if (vcLower.includes(metric.toLowerCase())) return true;
        const hasToken = candidateTokens.some(token => vcLower.includes(token));
        if (hasToken) return true;
    }
    return false;
}

/**
 * Hybrid Financial Fact Extractor (Deterministic First + LLM Assisted)
 * 1. Runs deterministic table and narrative extraction first.
 * 2. If ambiguous, complex, or unparsed narrative paragraphs remain, selectively routes them to the LLM.
 * 3. Enforces ExtractedFactsV1 contract, anti-hallucination verification (checking that numbers exist in source text),
 *    and deduplicates against deterministic facts.
 * 4. Logs latency, token usage, and cost estimates.
 * 5. Gracefully falls back to deterministic extraction if LLM is unavailable or fails.
 * 
 * @param {object} normalizedDoc - Normalized document structure
 * @param {object} [options] - Options (useLLM, chatCompletion, batchSize, confidenceThreshold)
 * @returns {Promise<Array<object> & { stats: object }>} Extracted facts with performance stats
 */
async function extractFinancialFactsHybrid(normalizedDoc, options = {}) {
    const startTime = Date.now();
    const docId = normalizedDoc.document?.documentId || normalizedDoc.document_id || 'doc';
    const docContext = extractDocumentContext(normalizedDoc);
    
    // 1. Run Deterministic Extraction First
    const deterministicFacts = extractFinancialFacts(normalizedDoc, options);
    const deterministicCount = deterministicFacts.length;

    const stats = {
        extractionMethod: 'Hybrid (Deterministic + LLM)',
        deterministicFactsCount: deterministicCount,
        llmFactsCount: 0,
        totalFactsCount: deterministicCount,
        llmCallsCount: 0,
        tokens: { input: 0, output: 0, total: 0 },
        latencyMs: 0,
        estimatedCostUSD: 0,
        hallucinationsRejected: 0
    };

    // If LLM is explicitly disabled or not requested, return deterministic results
    if (options.useLLM === false || process.env.DISABLE_LLM_EXTRACTION === 'true') {
        stats.extractionMethod = 'DeterministicOnly';
        stats.latencyMs = Date.now() - startTime;
        const result = [...deterministicFacts];
        result.stats = stats;
        return result;
    }

    // 2. Identify candidate paragraphs that need LLM assistance
    const paragraphs = normalizedDoc.paragraphs || (normalizedDoc.elements ? normalizedDoc.elements.filter(e => e.elementType === 'paragraph') : []);
    const candidateParagraphs = [];

    for (let pIdx = 0; pIdx < paragraphs.length; pIdx++) {
        const pObj = paragraphs[pIdx];
        const pText = String(pObj.content || pObj.text || (typeof pObj === 'string' ? pObj : '')).trim();
        if (!pText || pText.length < 20) continue;

        // Check if this paragraph already had high-confidence facts extracted deterministically
        const locId = pObj.elementId ? `Paragraph ${pObj.elementId}` : `Paragraph ${pIdx + 1}`;
        const existingForPara = deterministicFacts.filter(f => f.sourceLocation === locId);
        
        if (existingForPara.length === 0) {
            // Check if paragraph contains potential financial figures and terms
            const hasPotentialNumbers = /\d+|%/.test(pText);
            const hasFinancialTerms = /revenue|profit|income|cost|expense|ebitda|margin|sales|cash|debt|assets|liabilities|run-rate|arr|mrr|subscription|turnover|earnings|dividend|capex|opex|إيرادات|أرباح|مصاريف|تكاليف|أصول|خصوم|ديون|سيولة|هامش|\b(AED|USD|SAR|EUR|GBP|[$€£¥₹]|درهم|ريال)\b/i.test(pText);
            if (hasPotentialNumbers && hasFinancialTerms) {
                candidateParagraphs.push({ pObj, pIdx, pText, locId });
            }
        }
    }

    // If no candidate paragraphs, return deterministic facts immediately
    if (candidateParagraphs.length === 0) {
        stats.latencyMs = Date.now() - startTime;
        const result = [...deterministicFacts];
        result.stats = stats;
        return result;
    }

    // 3. Batch and Process Candidate Paragraphs with LLM
    const batchSize = options.batchSize || 5;
    const llmFacts = [];

    // Resolve LLM chat completion function
    let chatCompletionFn = options.chatCompletion;
    if (!chatCompletionFn) {
        try {
            const modelClient = require('./model-client');
            chatCompletionFn = modelClient.chatCompletion;
        } catch (e) {
            // Model client unavailable; fallback gracefully
        }
    }

    if (!chatCompletionFn) {
        stats.extractionMethod = 'DeterministicOnly (LLM Client Unavailable)';
        stats.latencyMs = Date.now() - startTime;
        const result = [...deterministicFacts];
        result.stats = stats;
        return result;
    }

    for (let b = 0; b < candidateParagraphs.length; b += batchSize) {
        const batch = candidateParagraphs.slice(b, b + batchSize);
        const promptLines = [
            `Document Issuer: ${docContext.documentIssuer || 'Unknown'}`,
            `Default Reporting Period: ${docContext.defaultPeriod || 'Unknown'}`,
            `Document Currency: ${docContext.currency || 'USD'}`,
            '',
            'Extract all corporate financial facts mentioned in the following paragraphs.',
            'CRITICAL ANTI-HALLUCINATION RULE: Every numeric value and originalTextValue MUST exist verbatim in the paragraph text. Do not calculate, estimate, or invent values.',
            'Output a JSON object with a "facts" array. Format:',
            '{"facts": [{"paragraphId": "...", "metric": "...", "entity": "...", "periodLabel": "...", "temporalType": "instant"|"duration", "reportingBasis": "Actual"|"Budget"|"Forecast", "reportingScope": "Consolidated"|"Entity", "rawValue": number|string, "originalTextValue": "...", "originalUnit": "...", "normalizedUnit": "amount"|"ratio"|"headcount", "currency": "..."}]}',
            '',
            'Paragraphs to analyze:'
        ];

        batch.forEach(item => {
            promptLines.push(`[${item.locId}]: "${item.pText}"`);
        });

        try {
            stats.llmCallsCount++;
            const llmRes = await chatCompletionFn({
                messages: [
                    {
                        role: 'system',
                        content: 'You are an expert financial fact extraction system conforming to ExtractedFactsV1. You extract verifiable financial facts from corporate commentary.'
                    },
                    {
                        role: 'user',
                        content: promptLines.join('\n')
                    }
                ],
                jobId: options.jobId || 'narrative-hybrid-extraction',
                temperature: 0.0
            });

            if (llmRes.usage) {
                stats.tokens.input += llmRes.usage.inputTokens || 0;
                stats.tokens.output += llmRes.usage.outputTokens || 0;
                stats.tokens.total += llmRes.usage.totalTokens || 0;
                stats.estimatedCostUSD += ((llmRes.usage.inputTokens || 0) * 0.0000005) + ((llmRes.usage.outputTokens || 0) * 0.0000015);
            }

            // Parse response JSON
            let parsed = null;
            const textContent = llmRes.text || '';
            const jsonMatch = textContent.match(/```(?:json)?\s*([\s\S]*?)\s*```/) || [null, textContent];
            try {
                parsed = JSON.parse(jsonMatch[1].trim());
            } catch (pErr) {
                const braceMatch = textContent.match(/\{[\s\S]*\}/);
                if (braceMatch) {
                    parsed = JSON.parse(braceMatch[0]);
                }
            }

            const rawLLMFacts = Array.isArray(parsed?.facts) ? parsed.facts : [];

            // 4. Validate and Deduplicate LLM Facts
            for (const fact of rawLLMFacts) {
                if (!fact.metric || fact.rawValue === undefined || fact.rawValue === null) continue;

                // Find matching paragraph in batch
                const paraItem = batch.find(i => i.locId === fact.paragraphId) || batch[0];
                const sourceText = paraItem ? paraItem.pText : '';

                // Anti-Hallucination & Contextual Metric-Value Association Check (Defect 1)
                const isAssociated = isMetricAssociatedWithValue(fact.metric, fact, sourceText);
                if (!isAssociated) {
                    stats.hallucinationsRejected++;
                    continue; // REJECT HALLUCINATED / MISATTRIBUTED FACT
                }

                const textVal = String(fact.originalTextValue || fact.rawValue).trim();

                // Unit & Value Normalization
                const isRatio = isRatioMetric(fact.metric) || fact.normalizedUnit === 'ratio' || fact.normalizedUnit === 'percentage' || String(textVal).includes('%');
                const isHeadcount = isHeadcountMetric(fact.metric) || fact.normalizedUnit === 'headcount';

                const norm = normalizeFinancialValue(fact.rawValue, {
                    currency: fact.currency || docContext.currency,
                    scale: 1,
                    isRatio,
                    isHeadcount
                });

                if (norm.numericValue === null) continue;

                let normUnit = norm.normalizedUnit;
                let factCurr = norm.currency || fact.currency || docContext.currency;
                if (isRatio || normUnit === 'ratio' || normUnit === 'percentage') {
                    normUnit = 'ratio';
                    factCurr = null;
                } else if (isHeadcount || normUnit === 'headcount') {
                    normUnit = 'headcount';
                    factCurr = null;
                }

                const factMetric = String(fact.metric).trim();
                const factEntity = String(fact.entity || docContext.documentIssuer).trim();
                const factPeriod = String(fact.periodLabel || docContext.defaultPeriod).trim();

                // Deduplicate against deterministic facts and already added LLM facts using complete business identity (Defect 2)
                const isDup = deterministicFacts.some(df => {
                    const mMatch = df.metric.toLowerCase().replace(/[^a-z0-9\u0621-\u064A]/g, '') === factMetric.toLowerCase().replace(/[^a-z0-9\u0621-\u064A]/g, '');
                    const vMatch = Math.abs((Number(df.normalizedValue) || 0) - (Number(norm.normalizedValue) || 0)) < 0.001;
                    const eMatch = !df.entity || !factEntity || df.entity.toLowerCase() === factEntity.toLowerCase();
                    const pMatch = !df.periodLabel || !factPeriod || df.periodLabel.toLowerCase() === factPeriod.toLowerCase();
                    return mMatch && vMatch && eMatch && pMatch;
                }) || llmFacts.some(lf => {
                    const mMatch = lf.metric.toLowerCase().replace(/[^a-z0-9\u0621-\u064A]/g, '') === factMetric.toLowerCase().replace(/[^a-z0-9\u0621-\u064A]/g, '');
                    const vMatch = Math.abs((Number(lf.normalizedValue) || 0) - (Number(norm.normalizedValue) || 0)) < 0.001;
                    const eMatch = !lf.entity || !factEntity || lf.entity.toLowerCase() === factEntity.toLowerCase();
                    const pMatch = !lf.periodLabel || !factPeriod || lf.periodLabel.toLowerCase() === factPeriod.toLowerCase();
                    return mMatch && vMatch && eMatch && pMatch;
                });

                if (isDup) continue;

                const nextSeq = deterministicCount + llmFacts.length + 1;
                llmFacts.push({
                    factId: `${docId}_fact_${nextSeq}`,
                    documentId: docId,
                    metric: factMetric,
                    metricLabel: factMetric,
                    originalLabel: factMetric,
                    entity: factEntity,
                    entityLabel: factEntity,
                    periodLabel: factPeriod,
                    periodStart: docContext.periodStart,
                    periodEnd: docContext.periodEnd,
                    temporalType: fact.temporalType || inferTemporalType(factMetric, factPeriod),
                    asOfDate: docContext.asOfDate,
                    reportingBasis: fact.reportingBasis || docContext.reportingBasis || 'Actual',
                    reportingScope: fact.reportingScope || docContext.reportingScope || 'Entity',
                    rawValue: norm.numericValue !== null ? norm.numericValue : norm.originalValue,
                    originalValue: norm.originalValue,
                    originalTextValue: textVal,
                    originalUnit: norm.originalUnit || 'amount',
                    normalizedValue: norm.normalizedValue,
                    normalizedUnit: normUnit,
                    numericValue: norm.numericValue,
                    currency: factCurr,
                    dimensions: fact.dimensions || {},
                    sourceLocationJson: { paragraphIndex: paraItem.pIdx, elementId: paraItem.pObj.elementId || null, textSnippet: sourceText.slice(0, 100) },
                    sourceLocationText: paraItem.locId,
                    sourceLocation: paraItem.locId,
                    sourceFileName: docContext.fileName,
                    extractionMethod: 'LLM-Assisted',
                    extractionConfidence: 0.90,
                    validationStatus: 'Validated',
                    mappingStatus: 'Approved'
                });
            }
        } catch (llmErr) {
            console.warn(`[HybridExtractor] LLM batch execution failed: ${llmErr.message}. Falling back to deterministic extraction.`);
        }
    }

    stats.llmFactsCount = llmFacts.length;
    stats.totalFactsCount = deterministicCount + llmFacts.length;
    stats.latencyMs = Date.now() - startTime;

    const combinedFacts = [...deterministicFacts, ...llmFacts];
    combinedFacts.stats = stats;
    return combinedFacts;
}

module.exports = {
    extractFinancialFacts,
    extractFinancialFactsHybrid,
    extractNarrativeFinancialFacts,
    extractDocumentContext,
    analyzeTableLayout,
    resolveDocumentEntity,
    resolveFactScaleAndCurrency,
    extractEntityFromText,
    extractEntityFromFileName,
    isFootnoteOrDisclaimerRow,
    isRatioMetric,
    isHeadcountMetric,
    inferTemporalType,
    cleanMetricLabel,
    splitIntoClauses,
    isMetricAssociatedWithValue,
    resolveRowReportingBasis
};
