const { app } = require('@azure/functions');
const { validateChatRequest } = require('../utils/validation');
const { toErrorResponse, NotFoundError } = require('../utils/errors');
const { classifyIntent } = require('../services/intent-classifier');
const { generateEmbedding } = require('../services/embeddings');
const { searchSimilar } = require('../services/azure-search');
const { getDocumentById } = require('../services/sql');
const { getFactsWithConflictContext } = require('../services/conflict-resolver');
const { evaluateDeterministicCalculations, computePeriodComparison } = require('../services/calculation-engine');
const { findRelevantStructuredFacts, formatSourceReferences } = require('../services/evidence-validation');
const { generateAnswer } = require('../services/answer-generation');
const { getActiveModelInfo } = require('../services/model-client');
const { isArabicText } = require('../services/arabic-normalizer');

<<<<<<< Updated upstream
app.http('chat', {
    methods: ['POST'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        const generatedCorrelationId = `chat-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
=======
const chatHandler = async (request, context) => {
    const generatedCorrelationId = `chat-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
>>>>>>> Stashed changes
        let correlationId = generatedCorrelationId;
        context.log(`[${correlationId}] >>> START CHAT REQUEST <<< URL=${request.url}`);

        let currentStep = 'INITIALIZATION';

        try {
            // STEP 0: Parse request, validate permissions, and resolve active LLM
            currentStep = 'STEP 0: REQUEST PARSING & VALIDATION';
            const body = await request.json().catch(() => null);
            const { question, documentId } = validateChatRequest(body);
            const userGroupsHeader = request.headers.get('x-user-groups') || (body && body.userGroups) || null;
            const isArabic = isArabicText(question);

            const jobId = (body && (body.jobId || body.job_id || body.correlationId)) ||
                          request.headers.get('x-job-id') ||
                          request.headers.get('x-correlation-id') ||
                          generatedCorrelationId;
            correlationId = jobId;

            // Log the chosen LLM for this current job ID
            let activeModelInfo = { model: 'unknown', provider: 'unknown' };
            try {
                activeModelInfo = getActiveModelInfo();
                context.log(`[${jobId}] [Job: ${jobId}] Chosen LLM: Provider="${activeModelInfo.provider}", Model="${activeModelInfo.model}"`);
            } catch (modelErr) {
                context.warn(`[${jobId}] [Job: ${jobId}] Could not resolve active LLM: ${modelErr.message}`);
            }

            context.log(`[${correlationId}] Step 0 Output: Question="${question}", TargetDocument=${documentId || 'ALL'}, UserGroups=${userGroupsHeader || 'Public'}`);

            let targetDoc = null;
            let searchFilter = null;

            if (documentId) {
                targetDoc = await getDocumentById(documentId);
                if (!targetDoc) {
                    throw new NotFoundError(`Document with ID or name "${documentId}" was not found.`);
                }

                // TODO(PHASE2): In Phase 2, enforce document-level ACLs against caller's validated Entra ID group claims.
                // In Phase 1, the x-user-groups header is client-supplied and untrusted (see KNOWN_LIMITATIONS.md).
                if (targetDoc.AllowedUserGroups && userGroupsHeader) {
                    const allowed = targetDoc.AllowedUserGroups.split(',').map(g => g.trim().toLowerCase());
                    const userGroups = userGroupsHeader.split(',').map(g => g.trim().toLowerCase());
                    const hasAccess = userGroups.some(ug => allowed.includes(ug)) || allowed.includes('*');
                    if (!hasAccess) {
                        return {
                            status: 403,
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                status: 'FORBIDDEN',
                                answer: 'Access denied: You do not have the required permissions to access this document.',
                                documentId: targetDoc.DocumentId,
                                insufficientEvidence: true,
                                correlationId
                            })
                        };
                    }
                }

                if (targetDoc.IngestionStatus === 'Processing' || targetDoc.IndexingStatus === 'Indexing' || targetDoc.IndexingStatus === 'NotIndexed' || targetDoc.DocumentStatus === 'Preparing') {
                    return {
                        status: 200,
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            status: 'DOCUMENT_BEING_PREPARED',
                            governanceStatus: 'DOCUMENT_BEING_PREPARED',
                            answer: isArabic
                                ? `المستند "${targetDoc.FileName}" قيد الإعداد حاليًا. يرجى إعادة المحاولة بعد قليل.`
                                : `Document "${targetDoc.FileName}" is currently being prepared. Please check back shortly.`,
                            documentId: targetDoc.DocumentId,
                            sources: [],
                            insufficientEvidence: true,
                            correlationId
                        })
                    };
                }

<<<<<<< Updated upstream
=======
                // Rule A.8 & WP17: Conflict Hold - while conflict is open, NO answers are given for either conflicted document (HTTP 409, CONFLICT_PENDING)
                if (targetDoc.ConflictHold === true || targetDoc.ConflictHold === 1) {
                    return {
                        status: 409,
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            status: 'CONFLICT_PENDING',
                            answer: `Document "${targetDoc.FileName}" is held under active conflict governance review. Answers cannot be provided for this document until the conflict is resolved.`,
                            documentId: targetDoc.DocumentId,
                            openConflictId: targetDoc.OpenConflictId || null,
                            sources: [],
                            insufficientEvidence: true,
                            correlationId
                        })
                    };
                }

                if (targetDoc.IngestionStatus === 'PendingApproval' || targetDoc.IngestionStatus === 'PendingReview' || targetDoc.IngestionStatus === 'Pending') {
                    return {
                        status: 200,
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            status: 'PENDING_APPROVAL',
                            answer: `Document "${targetDoc.FileName}" has financial fact conflicts awaiting human approval and is not yet available for querying.`,
                            documentId: targetDoc.DocumentId,
                            sources: [],
                            insufficientEvidence: true,
                            correlationId
                        })
                    };
                }

                if (targetDoc.IngestionStatus === 'Rejected') {
                    return {
                        status: 200,
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            status: 'REJECTED',
                            answer: `Document "${targetDoc.FileName}" was rejected during conflict governance review and its facts are excluded from reporting.`,
                            documentId: targetDoc.DocumentId,
                            sources: [],
                            insufficientEvidence: true,
                            correlationId
                        })
                    };
                }

                if (targetDoc.IngestionStatus === 'Superseded') {
                    return {
                        status: 200,
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            status: 'SUPERSEDED',
                            answer: `Document "${targetDoc.FileName}" has been superseded by a more authoritative or restated financial filing and its facts are excluded from reporting.`,
                            documentId: targetDoc.DocumentId,
                            sources: [],
                            insufficientEvidence: true,
                            correlationId
                        })
                    };
                }

                if (targetDoc.IngestionStatus === 'PartiallyApproved') {
                    // Check if the query asks about a rejected or pending fact in this document
                    try {
                        const { getPool } = require('../services/sql');
                        const sql = require('mssql');
                        const pool = await getPool();
                        const unapprovedFactsRes = await pool.request()
                            .input('DocId', sql.BigInt, targetDoc.DocumentId)
                            .query(`
                                SELECT ISNULL(m.CanonicalMetric, f.Metric) AS Metric, f.NormalizedValue, f.Currency, f.MappingStatus 
                                FROM dbo.FinancialFacts f 
                                LEFT JOIN dbo.Metrics m ON f.MetricId = m.MetricId
                                WHERE f.DocumentId = @DocId AND f.MappingStatus IN ('Rejected', 'Pending')
                            `);
                        const unapprovedFacts = unapprovedFactsRes.recordset || [];
                        const qLower = question.toLowerCase();
                        const matchedFact = unapprovedFacts.find(uf => 
                            uf.Metric && qLower.includes(uf.Metric.toLowerCase())
                        );
                        if (matchedFact) {
                            const isRejected = matchedFact.MappingStatus === 'Rejected';
                            return {
                                status: 200,
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    status: isRejected ? 'REJECTED_FACT' : 'PENDING_FACT',
                                    answer: isRejected
                                        ? `The figure for "${matchedFact.Metric}" in "${targetDoc.FileName}" was explicitly rejected during financial conflict resolution and cannot be cited in reporting.`
                                        : `The figure for "${matchedFact.Metric}" in "${targetDoc.FileName}" is currently pending human conflict review and is not yet approved for reporting.`,
                                    documentId: targetDoc.DocumentId,
                                    sources: [],
                                    insufficientEvidence: true,
                                    correlationId
                                })
                            };
                        }
                    } catch {
                        // ignore
                    }
                }

>>>>>>> Stashed changes
                if (targetDoc.IngestionStatus === 'Failed') {
                    return {
                        status: 200,
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            status: 'FAILED',
                            answer: `Ingestion previously failed for document "${targetDoc.FileName}". Please re-ingest the document.`,
                            documentId: targetDoc.DocumentId,
                            sources: [],
                            insufficientEvidence: true,
                            correlationId
                        })
                    };
                }

                searchFilter = `source eq '${targetDoc.FileName.replace(/'/g, "''")}'`;
            }

            // STEP 1: Intent classification and routing (LLM with rule fallback)
            currentStep = 'STEP 1: INTENT CLASSIFICATION';
            context.log(`[${correlationId}] === ${currentStep} ===`);

            const intent = await classifyIntent(question, correlationId);
            context.log(`[${correlationId}] Step 1 Output (Intent Routing):`);
            context.log(`[${correlationId}]   - Selected Route: ${intent.route}`);
            context.log(`[${correlationId}]   - Intent Type: ${intent.intentType}`);
            context.log(`[${correlationId}]   - Is Comparison: ${intent.isComparison}`);
            context.log(`[${correlationId}]   - Target Periods/Dates: [${(intent.periods || []).join(', ')}]`);
            context.log(`[${correlationId}]   - Target Metrics: [${(intent.metrics || []).join(', ')}]`);
            context.log(`[${correlationId}]   - Routing Confidence: ${intent.confidence}`);
            context.log(`[${correlationId}]   - Reasoning: ${intent.reasoning}`);

            // WP17: Check for OUT_OF_SCOPE_QUESTION or NEEDS_CLARIFICATION
            if (intent.intentType === 'OUT_OF_SCOPE' || intent.route === 'OUT_OF_SCOPE') {
                return {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        status: 'OUT_OF_SCOPE_QUESTION',
                        governanceStatus: 'OUT_OF_SCOPE_QUESTION',
                        answer: isArabic
                            ? 'هذا السؤال خارج نطاق الخدمة. يجيب نظام فينورا فقط على الأسئلة المتعلقة بالقوائم المالية المعتمدة وفق معايير التقارير المالية الدولية وتقارير الموارد البشرية لكيانات كونتوسو.'
                            : 'This question is out of scope. Finora AI only answers questions regarding IFRS financial statements and HR reports for Contoso entities.',
                        documentId: targetDoc ? targetDoc.DocumentId : null,
                        sources: [],
                        factsUsed: [],
                        insufficientEvidence: true,
                        correlationId
                    })
                };
            }

            if (intent.intentType === 'NEEDS_CLARIFICATION' || intent.route === 'NEEDS_CLARIFICATION') {
                return {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        status: 'NEEDS_CLARIFICATION',
                        governanceStatus: 'NEEDS_CLARIFICATION',
                        answer: isArabic
                            ? 'يرجى توضيح سؤالك: حدد اسم الكيان بدقة (مثل شركة كونتوسو للتجزئة)، أو الفترة المالية (مثل الربع الأول 2026)، أو المؤشر المالي المطلوب.'
                            : 'Please clarify your question: specify the exact entity, period (e.g., Q1 2026), or metric you are referring to.',
                        documentId: targetDoc ? targetDoc.DocumentId : null,
                        sources: [],
                        factsUsed: [],
                        insufficientEvidence: true,
                        correlationId
                    })
                };
            }

            let routeUsed = intent.route;
            let finalAnswer = '';
            let formattedSources = [];
            let relevantFacts = [];
            let calculations = [];
            let insufficientEvidence = false;
            let totalInputTokens = intent?.usage?.inputTokens || 0;
            let totalOutputTokens = intent?.usage?.outputTokens || 0;

            // FLOW A: Query SQL facts, compute deterministic math, and generate answer
            if (routeUsed === 'DIRECT_SQL') {
                currentStep = 'FLOW A: DIRECT SQL RETRIEVAL & CALCULATIONS';
                context.log(`[${correlationId}] === ${currentStep} ===`);

                // 1. Fetch structured facts from database with conflict context and user authorization
                const userGroupsList = userGroupsHeader ? userGroupsHeader.split(',').map(g => g.trim()) : null;
                const allFacts = await getFactsWithConflictContext(targetDoc ? targetDoc.DocumentId : null, userGroupsList);
                relevantFacts = findRelevantStructuredFacts(question, allFacts);

                // For PartiallyApproved documents, only consider facts that specifically matched the query (do not use arbitrary fallback facts)
                if (targetDoc && targetDoc.IngestionStatus === 'PartiallyApproved' && allFacts.length > 0) {
                    const qWords = question.toLowerCase().split(/[\s,?;:()"]+/).filter(w => w.length > 2);
                    const strictlyMatched = relevantFacts.filter(f => {
                        const m = String(f.Metric || f.metric || f.CanonicalMetric || '').toLowerCase();
                        return qWords.some(w => m.includes(w));
                    });
                    if (strictlyMatched.length === 0) {
                        relevantFacts = [];
                    }
                }

                context.log(`[${correlationId}] Step 2A Output: Retrieved ${relevantFacts.length} relevant structured fact(s) from SQL`);

                // 2. Compute period comparisons deterministically (e.g., Q1 vs Q2)
                if (intent.isComparison && intent.periods && intent.periods.length >= 2) {
                    const periodDiffs = computePeriodComparison(allFacts, intent.periods[0], intent.periods[1]);
                    if (periodDiffs.length > 0) {
                        calculations.push(...periodDiffs);
                        context.log(`[${correlationId}]   - Computed ${periodDiffs.length} period-over-period comparison variance(s).`);
                    }
                }

                // 3. Compute deterministic arithmetic (variances, category sums, discrepancies)
                const mathCalcs = evaluateDeterministicCalculations(question, relevantFacts, intent);
                if (mathCalcs.length > 0) {
                    calculations.push(...mathCalcs);
                    context.log(`[${correlationId}]   - Evaluated ${mathCalcs.length} deterministic calculation(s).`);
                }

                // Check if any retrieved facts have document conflicts
                const conflictsPresent = relevantFacts.filter(f => f.hasConflict);
                if (conflictsPresent.length > 0) {
                    context.log(`[${correlationId}]   - Active Conflicts Found: ${conflictsPresent.length} (Passing governance notes to LLM)`);
                }

                // 4. Synthesize final answer with LLM or fallback to Azure AI Search
                if (relevantFacts.length > 0 || calculations.length > 0) {
                    currentStep = 'FLOW A: LLM SQL ANSWER SYNTHESIS';
                    context.log(`[${correlationId}] === ${currentStep} ===`);

                    let llmResult = null;
                    try {
                        llmResult = await generateAnswer(question, [], relevantFacts, calculations, correlationId);
                        finalAnswer = llmResult.answer;
                        insufficientEvidence = llmResult.insufficientEvidence;
                        if (llmResult.usage) {
                            totalInputTokens += llmResult.usage.inputTokens || 0;
                            totalOutputTokens += llmResult.usage.outputTokens || 0;
                        }
                    } catch (err) {
                        context.warn(`[${correlationId}] LLM synthesis unavailable (${err.message}). Using deterministic answer formulation per Rule A.5.`);
                        if (calculations.length > 0) {
                            finalAnswer = calculations.map(c => {
                                if (c.type === 'CATEGORY_SUM') return `Total ${c.metric}: ${c.calculatedTotal} ${c.currency}`;
                                if (c.type === 'PERIOD_COMPARISON') return `Comparison for ${c.metric}: ${c.period1} (${c.period1Value}) vs ${c.period2} (${c.period2Value}), difference = ${c.difference} ${c.currency}`;
                                if (c.type === 'VARIANCE') return `Variance for ${c.metric}: difference = ${c.difference} ${c.currency}`;
                                return JSON.stringify(c);
                            }).join('. ');
                        } else if (relevantFacts.length > 0) {
                            finalAnswer = relevantFacts.map(f => `${f.Metric} for ${f.Entity || 'Global'} (${f.PeriodLabel || 'N/A'}): ${f.NumericValue} ${f.Currency || f.Unit || ''}`).join('; ');
                        }
                        insufficientEvidence = false;
                    }

                    // Format source file references
                    const uniqueFiles = [...new Set(relevantFacts.map(f => f.SourceFileName).filter(Boolean))];
                    formattedSources = uniqueFiles.map((file, idx) => ({
                        id: idx + 1,
                        source: file,
                        citation: `[${idx + 1}] ${file}`
                    }));

                    context.log(`[${correlationId}] Flow A Completed: Synthesized answer using LLM Model="${llmResult?.model || activeModelInfo.model}" (Provider: ${llmResult?.provider || activeModelInfo.provider}) (${finalAnswer.length} chars).`);
                } else if (targetDoc && targetDoc.IngestionStatus === 'PartiallyApproved') {
                    context.log(`[${correlationId}] Flow A Notice: Target document is PartiallyApproved and 0 approved SQL facts matched. Narrative RAG suppressed to prevent exposure of unapproved or rejected figures.`);
                    finalAnswer = `Document "${targetDoc.FileName}" has partial approval status. Only approved financial facts may be cited in reporting, and no approved figures matched your query. Unapproved narrative content cannot be cited.`;
                    insufficientEvidence = true;
                } else {
                    context.log(`[${correlationId}] Flow A Notice: 0 SQL facts matched. Seamlessly falling back to Flow B (Azure AI Search)...`);
                    routeUsed = 'AZURE_SEARCH';
                }
            }

            // FLOW B: Search document text via Azure AI Search (semantic search)
            if (routeUsed === 'AZURE_SEARCH') {
                // If targeted document is PartiallyApproved, do not allow unapproved narrative extraction
                if (targetDoc && targetDoc.IngestionStatus === 'PartiallyApproved') {
                    return {
                        status: 200,
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            status: 'SUCCESS',
                            answer: `Document "${targetDoc.FileName}" has partial approval status. Narrative document excerpts cannot be cited to prevent exposing rejected or unapproved financial figures.`,
                            documentId: targetDoc.DocumentId,
                            sources: [],
                            insufficientEvidence: true,
                            correlationId
                        })
                    };
                }

                currentStep = 'FLOW B: AZURE AI SEARCH';
                context.log(`[${correlationId}] === ${currentStep} ===`);

                let chunks = [];
                try {
                    // 1. Generate query vector embedding (Azure OpenAI)
                    context.log(`[${correlationId}] Step 2B: Generating query vector embedding...`);
                    const queryVector = await generateEmbedding(question, correlationId);

                    // Build effective search filter excluding unapproved, pending, or rejected documents
                    let effectiveFilter = searchFilter;
                    const disallowedDocs = new Set();
                    // D7 SQL Allow-list for Azure AI Search:
                    // Only documents where IngestionStatus='Succeeded', ConflictHold=0, not superseded/rejected/partially approved
                    let allowedDocumentIds = [];
                    try {
                        const { getSearchAllowList } = require('../services/sql');
                        allowedDocumentIds = await getSearchAllowList(userGroups);
                    } catch (dbErr) {
                        context.warn(`[${correlationId}] Failed to retrieve SQL search allow-list: ${dbErr.message}`);
                    }

                    // 2. Perform hybrid / semantic search against index using SQL allow-list
                    context.log(`[${correlationId}] Step 2B: Searching Azure AI Search index "${process.env.AZURE_SEARCH_INDEX || 'configured index'}" (Allow-list size: ${allowedDocumentIds.length})...`);
                    const rawChunks = await searchSimilar(queryVector, {
                        top: 4,
                        filter: effectiveFilter,
                        allowedDocumentIds,
                        searchText: question
                    });

                    // Post-filter safety check: eliminate any chunk originating from unapproved documents
                    chunks = (rawChunks || []).filter(c => {
                        const src = (c.source || c.fileName || '').toLowerCase();
                        return !disallowedDocs.has(src);
                    });
                } catch (searchErr) {
                    context.warn(`[${correlationId}] Search flow fallback: ${searchErr.message}`);
                    chunks = [];
                }
                context.log(`[${correlationId}] Step 2B Output: Retrieved ${chunks.length} matching search chunk(s) (after governance filtering).`);

                // 3. Format source citations
                formattedSources = formatSourceReferences(chunks);

                // 4. Synthesize final answer using active LLM
                if (chunks.length > 0) {
                    currentStep = 'FLOW B: LLM SEARCH ANSWER SYNTHESIS';
                    context.log(`[${correlationId}] === ${currentStep} ===`);

                    const llmResult = await generateAnswer(question, chunks, [], [], correlationId);
                    finalAnswer = llmResult.answer;
                    insufficientEvidence = llmResult.insufficientEvidence;
                    if (llmResult.usage) {
                        totalInputTokens += llmResult.usage.inputTokens || 0;
                        totalOutputTokens += llmResult.usage.outputTokens || 0;
                    }

                    context.log(`[${correlationId}] Flow B Completed: Synthesized answer using LLM Model="${llmResult.model || activeModelInfo.model}" (Provider: ${llmResult.provider || activeModelInfo.provider}) (${finalAnswer.length} chars).`);
                } else {
                    insufficientEvidence = true;
                }
            }

            const tokenUsage = {
                inputTokens: totalInputTokens,
                outputTokens: totalOutputTokens,
                totalTokens: totalInputTokens + totalOutputTokens
            };

            // STEP 3: Assemble response and log token usage
            context.log(`[${correlationId}] [Job: ${correlationId}] === TOKEN USAGE PER REQUEST ===`);
            context.log(`[${correlationId}]   - LLM Provider:               ${activeModelInfo.provider}`);
            context.log(`[${correlationId}]   - LLM Model:                  ${activeModelInfo.model}`);
            context.log(`[${correlationId}]   - Input (Prompt) Tokens:      ${tokenUsage.inputTokens}`);
            context.log(`[${correlationId}]   - Output (Completion) Tokens: ${tokenUsage.outputTokens}`);
            context.log(`[${correlationId}]   - Total Tokens:               ${tokenUsage.totalTokens}`);
            context.log(`[${correlationId}] >>> CHAT REQUEST COMPLETED SUCCESSFULLY <<< JobID=${correlationId}, Route=${routeUsed}, LLM=${activeModelInfo.model}`);

            const isNoEvidence = insufficientEvidence || (!finalAnswer && formattedSources.length === 0 && relevantFacts.length === 0);
            const status = isNoEvidence ? 'NO_APPROVED_EVIDENCE' : 'SUCCESS';
            const governanceStatus = status;

            if (isNoEvidence && (!finalAnswer || finalAnswer.length === 0)) {
                finalAnswer = isArabic
                    ? 'لم يتم العثور على أي أدلة أو بيانات معتمدة في السجلات المالية المعتمدة للإجابة على هذا السؤال.'
                    : 'No approved evidence was found in the authoritative financial records to answer this question.';
            }

            return {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    status,
                    governanceStatus,
                    routeUsed,
                    intentType: intent.intentType,
                    answer: finalAnswer,
                    documentId: targetDoc ? targetDoc.DocumentId : (relevantFacts[0]?.DocumentId || null),
                    sources: formattedSources,
                    factsUsed: relevantFacts.map(f => ({
                        metric: f.Metric,
                        entity: f.Entity,
                        period: f.PeriodLabel,
                        value: f.NumericValue !== null ? f.NumericValue : f.TextValue,
                        unit: f.Unit,
                        currency: f.Currency,
                        location: f.SourceLocation,
                        sourceFile: f.SourceFileName,
                        authorityRank: f.AuthorityRank,
                        authorityType: f.AuthorityType,
                        hasConflict: f.hasConflict || false,
                        conflictStatus: f.conflictStatus || null,
                        conflictExplanation: f.conflictExplanation || null
                    })),
                    calculations,
                    insufficientEvidence,
                    tokenUsage,
                    llmProvider: activeModelInfo.provider,
                    llmModel: activeModelInfo.model,
                    jobId: correlationId,
                    correlationId
                })
            };

        } catch (error) {
            context.error(`[${correlationId}] !!! CHAT FAILED AT [${currentStep}] !!!`);
            context.error(`[${correlationId}] Error: ${error.message}`);
            if (error.stack) context.error(`[${correlationId}] Stack: ${error.stack}`);
            return toErrorResponse(error, correlationId);
        }
<<<<<<< Updated upstream
    }
=======
};

app.http('chat', {
    methods: ['POST'],
    authLevel: 'anonymous',
    handler: chatHandler
>>>>>>> Stashed changes
});
