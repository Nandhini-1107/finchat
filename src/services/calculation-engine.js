const { areValuesEqual } = require('./unit-normalizer');
const { Decimal } = require('../utils/decimal');

/**
 * Validates currency comparability across facts.
 * Rule 4: Strict currency isolation — never add, subtract, or compare across different currencies.
 */
function assertCurrencyMatch(factA, factB) {
    const curA = (factA.Currency || factA.currency || '').trim().toUpperCase();
    const curB = (factB.Currency || factB.currency || '').trim().toUpperCase();
    if (curA && curB && curA !== curB) {
        throw new Error(`CurrencyMismatch: Cannot compute calculations across different currencies (${curA} vs ${curB}). Never mix or convert currencies.`);
    }
}

/**
 * Computes variance between two facts (e.g. Actual vs Budget or Prior Period vs Current Period).
 * Enforces all 7 calculation rules:
 * Rule 1: Zero-base denominator -> percentChange = null with clear explanation.
 * Rule 2: Variance direction -> strictly Comparison - Base (valB - valA).
 * Rule 3: Missing period string -> formatted reason.
 * Rule 4: Strict currency isolation.
 * Rule 5: Half-up rounding to 2 decimal places for percentage and 4 decimal places for difference.
 * Rule 6: Preserved unit scaling.
 * Rule 7: Structured provenance format.
 */
function computeVariance(factA, factB) {
    if (!factA || !factB || factA.NumericValue === null || factA.NumericValue === undefined || factB.NumericValue === null || factB.NumericValue === undefined) {
        return null;
    }

    assertCurrencyMatch(factA, factB);

    const basePeriod = factA.PeriodLabel || factA.PeriodName || 'Unspecified Base Period';
    const compPeriod = factB.PeriodLabel || factB.PeriodName || 'Unspecified Comparison Period';

    const dA = new Decimal(factA.NumericValue);
    const dB = new Decimal(factB.NumericValue);

    // Rule 2: Direction = dB - dA
    const diffDec = dB.minus(dA);
    const difference = diffDec.toNumber(4);

    let percentChange = null;
    let percentChangeExplanation = null;

    // Rule 1: Zero base denominator returns null + explanation
    if (dA.isZero()) {
        percentChange = null;
        percentChangeExplanation = 'Base value is zero; percentage change undefined.';
    } else {
        // Rule 5: Half-up 2 decimal places
        // percentChange = ((dB - dA) / |dA|) * 100
        const pctDec = diffDec.times(100).dividedBy(dA.abs());
        percentChange = pctDec.toNumber(2);
    }

    const cur = factA.Currency || factB.Currency || 'AED';
    const unit = factA.Unit || factB.Unit || factA.NormalizedUnit || factB.NormalizedUnit || 'amount';

    return {
        type: 'VARIANCE',
        metric: factA.Metric || factA.CanonicalMetric,
        entity: factA.Entity || factA.EntityName,
        basePeriod,
        baseValue: dA.toNumber(4),
        comparisonPeriod: compPeriod,
        comparisonValue: dB.toNumber(4),
        difference,
        percentChange,
        percentChangeExplanation,
        currency: cur,
        unit,
        direction: diffDec.isNegative() ? 'Decrease' : (diffDec.isZero() ? 'Unchanged' : 'Increase'),
        formula: `(${dB.toFixed(4)} - ${dA.toFixed(4)}) = ${diffDec.toFixed(4)}`,
        // Rule 7: Structured Provenance Output
        provenance: {
            baseFactId: factA.FactId || null,
            baseFile: factA.SourceFileName || factA.FileName || null,
            baseLocation: factA.SourceLocation || factA.SourceLocationText || null,
            comparisonFactId: factB.FactId || null,
            comparisonFile: factB.SourceFileName || factB.FileName || null,
            comparisonLocation: factB.SourceLocation || factB.SourceLocationText || null
        }
    };
}

/**
 * Computes category sum with high-precision Decimal addition and stated total comparison.
 */
function computeCategorySum(componentFacts, totalFact = null) {
    if (!componentFacts || componentFacts.length === 0) return null;

    // Rule 4: Strict Currency Isolation
    const firstCurrency = (componentFacts[0].Currency || componentFacts[0].currency || '').trim().toUpperCase();
    for (const f of componentFacts) {
        const cur = (f.Currency || f.currency || '').trim().toUpperCase();
        if (firstCurrency && cur && firstCurrency !== cur) {
            throw new Error(`CurrencyMismatch: Cannot sum across different currencies (${firstCurrency} vs ${cur}).`);
        }
    }

    let calculatedDec = new Decimal(0);
    const components = [];

    for (const f of componentFacts) {
        if (f.NumericValue !== null && f.NumericValue !== undefined) {
            const decVal = new Decimal(f.NumericValue);
            calculatedDec = calculatedDec.plus(decVal);
            components.push({
                entity: f.Entity || f.EntityName,
                metric: f.Metric || f.CanonicalMetric,
                value: decVal.toNumber(4),
                factId: f.FactId || null
            });
        }
    }

    const calculatedTotal = calculatedDec.toNumber(4);
    let statedTotal = null;
    let variance = null;
    let matchesStated = null;

    if (totalFact && totalFact.NumericValue !== null && totalFact.NumericValue !== undefined) {
        assertCurrencyMatch(componentFacts[0], totalFact);
        const statedDec = new Decimal(totalFact.NumericValue);
        statedTotal = statedDec.toNumber(4);
        variance = calculatedDec.minus(statedDec).toNumber(4);
        matchesStated = areValuesEqual(calculatedTotal, statedTotal, 0.01);
    }

    const cur = componentFacts[0].Currency || componentFacts[0].currency || 'AED';
    const unit = componentFacts[0].Unit || componentFacts[0].unit || componentFacts[0].NormalizedUnit || 'amount';

    return {
        type: 'CATEGORY_SUM',
        metric: componentFacts[0].Metric || componentFacts[0].CanonicalMetric,
        components,
        calculatedTotal,
        statedTotal,
        variance,
        matchesStated,
        currency: cur,
        unit,
        formula: components.map(c => c.value).join(' + ') + ` = ${calculatedTotal}`,
        provenance: {
            componentFactIds: components.map(c => c.factId).filter(Boolean),
            statedTotalFactId: totalFact?.FactId || null
        }
    };
}

/**
 * Computes reconciliation discrepancy between two facts with strict Decimal arithmetic.
 */
function computeReconciliationDiscrepancy(gatewayFact, settlementFact) {
    if (!gatewayFact || !settlementFact) return null;

    assertCurrencyMatch(gatewayFact, settlementFact);

    const dGw = new Decimal(gatewayFact.NumericValue ?? 0);
    const dSet = new Decimal(settlementFact.NumericValue ?? 0);
    const diffDec = dGw.minus(dSet);
    const difference = diffDec.toNumber(4);
    const discrepancy = diffDec.abs().toNumber(4);
    const hasDiscrepancy = discrepancy > 0.005;

    return {
        type: 'RECONCILIATION_DISCREPANCY',
        entity: gatewayFact.Entity || gatewayFact.EntityName,
        gatewayAmount: dGw.toNumber(4),
        settlementAmount: dSet.toNumber(4),
        discrepancy,
        differenceSigned: difference,
        currency: gatewayFact.Currency || settlementFact.Currency || 'AED',
        hasDiscrepancy,
        status: hasDiscrepancy ? 'AMOUNT_MISMATCH' : 'MATCHED',
        provenance: {
            gatewayFactId: gatewayFact.FactId || null,
            settlementFactId: settlementFact.FactId || null
        }
    };
}

/**
 * Deterministically computes period-over-period comparison variance across 2 dates/periods.
 */
function computePeriodComparison(facts = [], period1 = '', period2 = '') {
    const comparisons = [];
    if (!facts || facts.length === 0) return comparisons;

    const p1 = (period1 || '').toLowerCase();
    const p2 = (period2 || '').toLowerCase();

    // Group facts by metric
    const byMetric = new Map();
    for (const f of facts) {
        if (f.NumericValue !== null && f.NumericValue !== undefined) {
            const m = (f.Metric || f.CanonicalMetric || '').trim();
            if (!byMetric.has(m)) byMetric.set(m, []);
            byMetric.get(m).push(f);
        }
    }

    for (const [metric, metricFacts] of byMetric.entries()) {
        let fact1 = null;
        let fact2 = null;

        if (p1 && p2) {
            fact1 = metricFacts.find(f => (f.PeriodLabel || f.PeriodName || '').toLowerCase().includes(p1) || (f.SourceLocation || '').toLowerCase().includes(p1));
            fact2 = metricFacts.find(f => (f.PeriodLabel || f.PeriodName || '').toLowerCase().includes(p2) || (f.SourceLocation || '').toLowerCase().includes(p2));
        }

        // If specific period match wasn't found by label, compare first two distinct periods
        if (!fact1 || !fact2) {
            if (metricFacts.length >= 2) {
                fact1 = metricFacts[0];
                fact2 = metricFacts[1];
            }
        }

        if (fact1 && fact2 && fact1.FactId !== fact2.FactId) {
            assertCurrencyMatch(fact1, fact2);

            const v1Dec = new Decimal(fact1.NumericValue);
            const v2Dec = new Decimal(fact2.NumericValue);
            const diffDec = v2Dec.minus(v1Dec);
            const diff = diffDec.toNumber(4);

            let pct = null;
            let explanation = null;
            if (v1Dec.isZero()) {
                explanation = 'Base period value is zero; percentage change undefined.';
            } else {
                pct = diffDec.times(100).dividedBy(v1Dec.abs()).toNumber(2);
            }

            comparisons.push({
                type: 'PERIOD_COMPARISON',
                metric,
                period1: fact1.PeriodLabel || fact1.PeriodName || period1 || 'Period 1',
                period1Value: v1Dec.toNumber(4),
                period2: fact2.PeriodLabel || fact2.PeriodName || period2 || 'Period 2',
                period2Value: v2Dec.toNumber(4),
                difference: diff,
                percentChange: pct,
                percentChangeExplanation: explanation,
                currency: fact1.Currency || fact2.Currency || 'AED',
                direction: diffDec.isNegative() ? 'Decrease' : (diffDec.isZero() ? 'Unchanged' : 'Increase'),
                provenance: {
                    period1FactId: fact1.FactId || null,
                    period2FactId: fact2.FactId || null
                }
            });
        }
    }

    return comparisons;
}

function evaluateDeterministicCalculations(question, facts = [], intentContext = null) {
    if (!facts || facts.length === 0) return [];
    const q = question.toLowerCase();
    const calculations = [];

    // 1. Explicit multi-period comparison if intent requested comparison
    if (intentContext && intentContext.isComparison && intentContext.periods && intentContext.periods.length >= 2) {
        const periodCalcs = computePeriodComparison(facts, intentContext.periods[0], intentContext.periods[1]);
        if (periodCalcs.length > 0) {
            calculations.push(...periodCalcs);
        }
    }

    // 2. Gateway vs Settlement Discrepancy
    const isDiscrepancyQuery = q.includes('mismatch') || q.includes('discrepancy') || q.includes('difference') || q.includes('gateway') || q.includes('settlement');
    if (isDiscrepancyQuery) {
        const gwFacts = facts.filter(f => /gateway/i.test(f.Metric || f.CanonicalMetric));
        const setFacts = facts.filter(f => /settlement/i.test(f.Metric || f.CanonicalMetric) || (/transaction amount/i.test(f.Metric || f.CanonicalMetric) && f.Entity === 'Approved'));

        if (gwFacts.length > 0 && setFacts.length > 0) {
            const discCalc = computeReconciliationDiscrepancy(gwFacts[0], setFacts[0]);
            if (discCalc) calculations.push(discCalc);
        }
    }

    // 3. Category Sum vs Stated Total
    const isSumQuery = q.includes('sum') || q.includes('total') || q.includes('breakdown') || q.includes('categories') || q.includes('components');
    if (isSumQuery) {
        const countComponents = facts.filter(f => (f.Metric || f.CanonicalMetric) === 'Transaction Count' && ['Approved', 'Declined', 'Pending'].includes(f.Entity || f.EntityName));
        const totalCount = facts.find(f => (f.Metric || f.CanonicalMetric) === 'Transaction Count' && (f.Entity || f.EntityName) === 'All Transactions');
        if (countComponents.length > 0) {
            const countSumCalc = computeCategorySum(countComponents, totalCount);
            if (countSumCalc) calculations.push(countSumCalc);
        }

        const amountComponents = facts.filter(f => (f.Metric || f.CanonicalMetric) === 'Transaction Amount' && ['Approved', 'Declined', 'Pending'].includes(f.Entity || f.EntityName));
        const totalAmount = facts.find(f => (f.Metric || f.CanonicalMetric) === 'Transaction Amount' && (f.Entity || f.EntityName) === 'All Transactions');
        if (amountComponents.length > 0) {
            const amountSumCalc = computeCategorySum(amountComponents, totalAmount);
            if (amountSumCalc) calculations.push(amountSumCalc);
        }
    }

    // 4. Period-over-period or multi-source variance fallback
    const isVarianceQuery = q.includes('variance') || q.includes('growth') || q.includes('compare') || q.includes('change') || q.includes('increase') || q.includes('decrease');
    if (isVarianceQuery && calculations.length === 0) {
        const groups = new Map();
        for (const f of facts) {
            if (f.NumericValue !== null && f.NumericValue !== undefined) {
                const key = `${(f.Metric || f.CanonicalMetric || '').trim().toLowerCase()}|${(f.Entity || f.EntityName || 'global').trim().toLowerCase()}`;
                if (!groups.has(key)) groups.set(key, []);
                groups.get(key).push(f);
            }
        }

        for (const [, groupFacts] of groups.entries()) {
            if (groupFacts.length >= 2) {
                try {
                    const vCalc = computeVariance(groupFacts[0], groupFacts[1]);
                    if (vCalc) calculations.push(vCalc);
                } catch {
                    // Currency mismatch or uncomputable
                }
            }
        }
    }

    return calculations;
}

// In-memory alias cache loaded from dbo.EntityAliases and dbo.MetricAliases
let entityAliasesCache = [];
let metricAliasesCache = [];

function initializeDefaultAliases() {
    entityAliasesCache = [
        // Contoso entities (approved seeds)
        { alias: 'contoso retail llc', canonical: 'Contoso Retail LLC', lang: 'en' },
        { alias: 'contoso retail', canonical: 'Contoso Retail LLC', lang: 'en' },
        { alias: 'retail llc', canonical: 'Contoso Retail LLC', lang: 'en' },
        { alias: 'شركة كونتوسو للتجزئة ذ.م.م', canonical: 'Contoso Retail LLC', lang: 'ar' },
        { alias: 'شركة كونتوسو للتجزئة', canonical: 'Contoso Retail LLC', lang: 'ar' },
        { alias: 'كونتوسو للتجزئة', canonical: 'Contoso Retail LLC', lang: 'ar' },

        { alias: 'contoso logistics llc', canonical: 'Contoso Logistics LLC', lang: 'en' },
        { alias: 'contoso logistics', canonical: 'Contoso Logistics LLC', lang: 'en' },
        { alias: 'logistics llc', canonical: 'Contoso Logistics LLC', lang: 'en' },
        { alias: 'شركة كونتوسو للخدمات اللوجستية ذ.م.م', canonical: 'Contoso Logistics LLC', lang: 'ar' },
        { alias: 'شركة كونتوسو للخدمات اللوجستية', canonical: 'Contoso Logistics LLC', lang: 'ar' },
        { alias: 'كونتوسو للخدمات اللوجستية', canonical: 'Contoso Logistics LLC', lang: 'ar' },
        { alias: 'كونتوسو اللوجستية', canonical: 'Contoso Logistics LLC', lang: 'ar' },
        { alias: 'كونتوسو للوجستيات', canonical: 'Contoso Logistics LLC', lang: 'ar' },

        { alias: 'contoso properties llc', canonical: 'Contoso Properties LLC', lang: 'en' },
        { alias: 'contoso properties', canonical: 'Contoso Properties LLC', lang: 'en' },
        { alias: 'properties llc', canonical: 'Contoso Properties LLC', lang: 'en' },
        { alias: 'شركة كونتوسو العقارية ذ.م.م', canonical: 'Contoso Properties LLC', lang: 'ar' },
        { alias: 'شركة كونتوسو العقارية', canonical: 'Contoso Properties LLC', lang: 'ar' },
        { alias: 'كونتوسو العقارية', canonical: 'Contoso Properties LLC', lang: 'ar' },

        { alias: 'contoso holdings ltd', canonical: 'Contoso Holdings', lang: 'en' },
        { alias: 'contoso holdings', canonical: 'Contoso Holdings', lang: 'en' },
        { alias: 'مجموعة كونتوسو القابضة', canonical: 'Contoso Holdings', lang: 'ar' },
        { alias: 'مجموعة كونتوسو', canonical: 'Contoso Holdings', lang: 'ar' },
        { alias: 'كونتوسو القابضة', canonical: 'Contoso Holdings', lang: 'ar' },

        { alias: 'contoso medical supplies llc', canonical: 'Contoso Medical Supplies LLC', lang: 'en' },
        { alias: 'contoso medical supplies', canonical: 'Contoso Medical Supplies LLC', lang: 'en' },
        { alias: 'شركة كونتوسو للمستلزمات الطبية ذ.م.م', canonical: 'Contoso Medical Supplies LLC', lang: 'ar' },
        { alias: 'كونتوسو للمستلزمات الطبية', canonical: 'Contoso Medical Supplies LLC', lang: 'ar' },

        // Non-Contoso test entities
        { alias: 'apex global logistics llc', canonical: 'Apex Global Logistics LLC', lang: 'en' },
        { alias: 'apex global logistics', canonical: 'Apex Global Logistics LLC', lang: 'en' },
        { alias: 'apex global', canonical: 'Apex Global Logistics LLC', lang: 'en' },
        { alias: 'أبيكس العالمية للخدمات اللوجستية', canonical: 'Apex Global Logistics LLC', lang: 'ar' },
        { alias: 'أبيكس العالمية', canonical: 'Apex Global Logistics LLC', lang: 'ar' }
    ];

    metricAliasesCache = [
        { alias: 'operating profit', canonical: 'Operating Profit', lang: 'en' },
        { alias: 'operating income', canonical: 'Operating Profit', lang: 'en' },
        { alias: 'ebit', canonical: 'Operating Profit', lang: 'en' },
        { alias: 'الربح التشغيلي', canonical: 'Operating Profit', lang: 'ar' },
        { alias: 'الأرباح التشغيلية', canonical: 'Operating Profit', lang: 'ar' },
        { alias: 'ارباح تشغيلية', canonical: 'Operating Profit', lang: 'ar' },

        { alias: 'operating expenses', canonical: 'Operating Expenses', lang: 'en' },
        { alias: 'opex', canonical: 'Operating Expenses', lang: 'en' },
        { alias: 'مصروفات تشغيلية', canonical: 'Operating Expenses', lang: 'ar' },
        { alias: 'مصاريف تشغيل', canonical: 'Operating Expenses', lang: 'ar' },

        { alias: 'net profit', canonical: 'Net Profit', lang: 'en' },
        { alias: 'net income', canonical: 'Net Profit', lang: 'en' },
        { alias: 'صافي الربح', canonical: 'Net Profit', lang: 'ar' },
        { alias: 'الربح الصافي', canonical: 'Net Profit', lang: 'ar' },
        { alias: 'أرباح', canonical: 'Net Profit', lang: 'ar' },
        { alias: 'ارباح', canonical: 'Net Profit', lang: 'ar' },

        { alias: 'revenue', canonical: 'Revenue', lang: 'en' },
        { alias: 'sales', canonical: 'Revenue', lang: 'en' },
        { alias: 'turnover', canonical: 'Revenue', lang: 'en' },
        { alias: 'إيرادات', canonical: 'Revenue', lang: 'ar' },
        { alias: 'ايرادات', canonical: 'Revenue', lang: 'ar' },
        { alias: 'مبيعات', canonical: 'Revenue', lang: 'ar' },

        { alias: 'ebitda', canonical: 'EBITDA', lang: 'en' },
        { alias: 'الأرباح قبل الفوائد والضرائب والاستهلاك', canonical: 'EBITDA', lang: 'ar' },
        { alias: 'الأرباح قبل الفوائد', canonical: 'EBITDA', lang: 'ar' },

        { alias: 'headcount', canonical: 'Headcount', lang: 'en' },
        { alias: 'staff count', canonical: 'Headcount', lang: 'en' },
        { alias: 'staff', canonical: 'Headcount', lang: 'en' },
        { alias: 'employees', canonical: 'Headcount', lang: 'en' },
        { alias: 'عدد الموظفين', canonical: 'Headcount', lang: 'ar' },
        { alias: 'الموظفين', canonical: 'Headcount', lang: 'ar' },

        { alias: 'employee costs', canonical: 'Employee Costs', lang: 'en' },
        { alias: 'payroll', canonical: 'Employee Costs', lang: 'en' },
        { alias: 'salaries', canonical: 'Employee Costs', lang: 'en' },
        { alias: 'salary', canonical: 'Employee Costs', lang: 'en' },
        { alias: 'أجور', canonical: 'Employee Costs', lang: 'ar' },
        { alias: 'رواتب', canonical: 'Employee Costs', lang: 'ar' },

        { alias: 'total assets', canonical: 'Total Assets', lang: 'en' },
        { alias: 'إجمالي الأصول', canonical: 'Total Assets', lang: 'ar' },
        { alias: 'اجمالي الاصول', canonical: 'Total Assets', lang: 'ar' },

        { alias: 'operating cash flow', canonical: 'Operating Cash Flow', lang: 'en' },
        { alias: 'cash flow', canonical: 'Operating Cash Flow', lang: 'en' },
        { alias: 'التدفقات النقدية التشغيلية', canonical: 'Operating Cash Flow', lang: 'ar' },
        { alias: 'التدفق النقدي', canonical: 'Operating Cash Flow', lang: 'ar' }
    ];

    entityAliasesCache.sort((a, b) => b.alias.length - a.alias.length);
    metricAliasesCache.sort((a, b) => b.alias.length - a.alias.length);
}

initializeDefaultAliases();

/**
 * Loads and refreshes entity and metric aliases from dbo.EntityAliases and dbo.MetricAliases.
 *
 * @param {object} [pool=null] Optional mssql pool instance
 * @returns {Promise<boolean>}
 */
async function loadAliasesFromDatabase(pool = null) {
    try {
        const { getPool } = require('./sql');
        const p = pool || await getPool();
        if (!p) return false;

        const entityRes = await p.request().query(`
            SELECT a.AliasText, a.LanguageCode, e.EntityName
            FROM dbo.EntityAliases a
            JOIN dbo.Entities e ON a.EntityId = e.EntityId
            WHERE ISNULL(a.IsApproved, 1) = 1
        `).catch(() => ({ recordset: [] }));

        if (entityRes.recordset && entityRes.recordset.length > 0) {
            entityAliasesCache = entityRes.recordset.map(r => ({
                alias: (r.AliasText || '').trim().toLowerCase(),
                canonical: r.EntityName,
                lang: r.LanguageCode || 'en'
            }));
            entityAliasesCache.sort((a, b) => b.alias.length - a.alias.length);
        }

        const metricRes = await p.request().query(`
            SELECT a.AliasText, a.LanguageCode, m.CanonicalMetric
            FROM dbo.MetricAliases a
            JOIN dbo.Metrics m ON a.MetricId = m.MetricId
            WHERE ISNULL(a.IsApproved, 1) = 1
        `).catch(() => ({ recordset: [] }));

        if (metricRes.recordset && metricRes.recordset.length > 0) {
            metricAliasesCache = metricRes.recordset.map(r => ({
                alias: (r.AliasText || '').trim().toLowerCase(),
                canonical: r.CanonicalMetric,
                lang: r.LanguageCode || 'en'
            }));
            metricAliasesCache.sort((a, b) => b.alias.length - a.alias.length);
        }

        return true;
    } catch {
        return false;
    }
}

function registerEntityAlias(aliasText, canonicalName, lang = 'en') {
    if (!aliasText || !canonicalName) return;
    entityAliasesCache.push({
        alias: aliasText.trim().toLowerCase(),
        canonical: canonicalName,
        lang
    });
    entityAliasesCache.sort((a, b) => b.alias.length - a.alias.length);
}

function registerMetricAlias(aliasText, canonicalMetric, lang = 'en') {
    if (!aliasText || !canonicalMetric) return;
    metricAliasesCache.push({
        alias: aliasText.trim().toLowerCase(),
        canonical: canonicalMetric,
        lang
    });
    metricAliasesCache.sort((a, b) => b.alias.length - a.alias.length);
}

function resetAliasesCache() {
    initializeDefaultAliases();
}

/**
 * WP3: Question-to-Fact Resolution
 * Pre-SQL translation mapping natural language queries to canonical dimensions:
 * - Metric Aliases (loaded from dbo.MetricAliases, cached)
 * - Entity Aliases (loaded from dbo.EntityAliases, cached)
 * - Period Resolution (Arabic quarters, fiscal years, and relative periods)
 * - Reporting Basis (Actual vs Budget vs Forecast)
 *
 * @param {string} question
 * @returns {object} Canonical dimensions { entity, metric, period, basis, isRelative, needsClarification }
 */
function resolveQuestionToDimensions(question) {
    if (!question || typeof question !== 'string') {
        return { entity: null, metric: null, period: null, basis: null, isRelative: false, needsClarification: true };
    }

    const q = question.toLowerCase();

    // 1. Entity Aliases (Loaded from dbo.EntityAliases / cached, not hardcoded)
    let entity = null;
    for (const item of entityAliasesCache) {
        if (q.includes(item.alias)) {
            entity = item.canonical;
            break;
        }
    }

    // 2. Metric Aliases (Loaded from dbo.MetricAliases / cached)
    let metric = null;
    for (const item of metricAliasesCache) {
        if (item.alias.length <= 4) {
            // For short acronyms (e.g. 'ebit', 'opex'), match with word boundaries
            const re = new RegExp(`\\b${item.alias}\\b`, 'i');
            if (re.test(q)) {
                metric = item.canonical;
                break;
            }
        } else if (q.includes(item.alias)) {
            metric = item.canonical;
            break;
        }
    }

    // 3. Period Resolution (Arabic & Relative)
    let period = null;
    let isRelative = false;

    if (/(q1\s*2026|الربع\s+الأول\s+2026|الربع\s+الأول\s+٢٠٢٦)/i.test(q)) {
        period = 'Q1 2026';
    } else if (/(q2\s*2026|الربع\s+الثاني\s+2026|الربع\s+الثاني\s+٢٠٢٦)/i.test(q)) {
        period = 'Q2 2026';
    } else if (/(q3\s*2026|الربع\s+الثالث\s+2026|الربع\s+الثالث\s+٢٠٢٦)/i.test(q)) {
        period = 'Q3 2026';
    } else if (/(q4\s*2026|الربع\s+الرابع\s+2026|الربع\s+الرابع\s+٢٠٢٦)/i.test(q)) {
        period = 'Q4 2026';
    } else if (/(fy\s*2026|2026|السنة\s+المالية\s+2026|عام\s+2026|٢٠٢٦)/i.test(q)) {
        period = 'FY2026';
    } else if (/(last\s+quarter|prior\s+quarter|previous\s+quarter|الربع\s+الماضي|الربع\s+السابق)/i.test(q)) {
        period = 'PriorQuarter';
        isRelative = true;
    } else if (/(last\s+year|prior\s+year|previous\s+year|السنة\s+الماضية|العام\s+السابق)/i.test(q)) {
        period = 'PriorYear';
        isRelative = true;
    }

    // 4. Reporting Basis
    let basis = 'Actual';
    if (/(budget|ميزانية|موازنة|الموازنة\s+التقديرية)/i.test(q)) {
        basis = 'Budget';
    } else if (/(forecast|توقعات|التوقعات)/i.test(q)) {
        basis = 'Forecast';
    }

    // 5. Ambiguity Check
    const needsClarification = !entity && !metric && !period;

    return {
        entity,
        metric,
        period,
        basis,
        isRelative,
        needsClarification
    };
}

module.exports = {
    assertCurrencyMatch,
    computeVariance,
    computeCategorySum,
    computeReconciliationDiscrepancy,
    computePeriodComparison,
    evaluateDeterministicCalculations,
    resolveQuestionToDimensions,
    loadAliasesFromDatabase,
    registerEntityAlias,
    registerMetricAlias,
    resetAliasesCache
};
