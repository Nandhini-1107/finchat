require('../utils/config');
const fs = require('fs');
const path = require('path');
const { validateDocumentBuffer } = require('../utils/validation');
const { ValidationError, sanitizeErrorMessage } = require('../utils/errors');
const { analyzeDocument } = require('./document-intelligence');
const { normalizeContent } = require('./content-normalizer');
const { extractFinancialFacts } = require('./fact-extraction');
const { createChunks } = require('./chunking');
const { generateBatchEmbeddings } = require('./embeddings');
const { uploadChunks, deleteReplacedChunks } = require('./azure-search');
const { buildSearchDocument, blankToNull } = require('./search-document');
const {
    startIngestionRun,
    completeIngestionRun,
    createDocument,
    updateDocumentStatus,
    insertFinancialFacts,
    deleteDocumentFacts,
    getCompleteFinancialFacts,
    savePendingFactsAndConflicts
} = require('./sql');
<<<<<<< Updated upstream
const { detectAndResolveConflicts } = require('./conflict-resolver');
<<<<<<< Updated upstream
=======
const { logConflictDetected } = require('./audit-log');
const { sendConflictNotificationEmail } = require('./notification');
=======
const { detectFinancialFactConflicts, detectAndResolveConflicts } = require('./conflict-resolver');
const { sendConflictNotification } = require('./conflict-notifier');

/**
 * Saves full extracted and normalized content to a temporary JSON file in the project folder.
 */
function saveExtractedContentToTemp({
    documentId,
    fileName,
    correlationId,
    authorityRank,
    docIntelResult,
    normalized,
    extractedFacts,
    conflicts,
    chunks
}) {
    try {
        const tempDir = path.resolve(process.cwd(), 'temp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }
        const safeBaseName = (fileName || 'doc').replace(/[^a-zA-Z0-9_\-\.]/g, '_');
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const fileTarget = `extracted-${timestamp}-doc-${documentId || 'unassigned'}-${safeBaseName}.json`;
        const fullPath = path.join(tempDir, fileTarget);

        const payload = {
            metadata: {
                timestamp: new Date().toISOString(),
                correlationId,
                documentId,
                fileName,
                authorityRank
            },
            rawExtraction: {
                pageCount: docIntelResult?.pages?.length || 0,
                tableCount: docIntelResult?.tables?.length || 0,
                paragraphCount: docIntelResult?.paragraphs?.length || 0,
                contentLength: (docIntelResult?.content || '').length,
                pages: docIntelResult?.pages || [],
                tables: docIntelResult?.tables || [],
                paragraphs: docIntelResult?.paragraphs || [],
                rawContent: docIntelResult?.content || ''
            },
            normalizedContent: {
                document_id: normalized?.document_id,
                tables: normalized?.tables || [],
                paragraphs: normalized?.paragraphs || [],
                fullMarkdown: normalized?.fullMarkdown || ''
            },
            extractedFacts: extractedFacts || [],
            conflicts: conflicts || [],
            chunks: chunks || []
        };

        fs.writeFileSync(fullPath, JSON.stringify(payload, null, 2), 'utf8');

        // Also save latest copy for quick access
        const latestPath = path.join(tempDir, 'latest-extracted-content.json');
        fs.writeFileSync(latestPath, JSON.stringify(payload, null, 2), 'utf8');

        return { fullPath, relativePath: path.join('temp', fileTarget) };
    } catch (err) {
        console.warn(`[TempWriter] Failed to write extracted content to temp file: ${err.message}`);
        return null;
    }
}
>>>>>>> Stashed changes
>>>>>>> Stashed changes

/**
 * Orchestrates the full 10-step enterprise ingestion pipeline.
 * Used by both HTTP ingestion endpoint (ingestDocument) and 
 * scheduled SharePoint queue processor (processDocumentQueue).
 * 
 * Guarantees:
 * 1. Scope enforcement (PDF & Excel IFRS/HR reports only; Word, CSV, images excluded)
 * 2. Status tracking per file in Azure SQL (dbo.Documents, dbo.IngestionRuns)
 * 3. Structured fact extraction into dbo.FinancialFacts (metric, entity, period, value, unit, source, location, as-of date)
 * 4. Conflict detection across documents with authority ranks & equal-rank review flags
 * 5. Multilingual 1536-dim vector embeddings & hybrid search indexing in Azure AI Search
 * 6. Exclusion of failed files: on error, status is marked 'Failed' and partial facts are rolled back.
 */
async function processDocumentIngestion({
    fileBuffer,
    fileName,
    sourceType = 'ManualUpload',
    authorityRank = 4,
    allowedUserGroups = null,
    correlationId = null,
    context = console,
    documentKey = null,
    queueKey = null,
    documentVersionId = null,
    fileLink = null,
    department = null,
    jobTitle = null,
    modifiedDate = null,
    authoritySource = null,
    existingRunId = null,
    manageRun = null,
<<<<<<< Updated upstream
    existingDocumentId = null
=======
    existingDocumentId = null,
    modifiedByEmail = null,
<<<<<<< Updated upstream
    modifiedByName = null,
    modifiedByUserId = null,
    baseUrl = null
=======
    createdByEmail = null,
    modifiedUserEmail = null
>>>>>>> Stashed changes
>>>>>>> Stashed changes
}) {
    const corrId = correlationId || `ingest-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const log = (msg) => (context.log ? context.log(`[${corrId}] ${msg}`) : console.log(`[${corrId}] ${msg}`));
    const errorLog = (msg) => (context.error ? context.error(`[${corrId}] ${msg}`) : console.error(`[${corrId}] ${msg}`));

    const shouldManageRun = manageRun !== null ? Boolean(manageRun) : (existingRunId === null);
    let currentStep = 'INITIALIZATION';
    let runId = existingRunId || null;
    let documentId = null;

    try {
        // STEP 1: VALIDATION & SCOPE ENFORCEMENT
        currentStep = 'STEP 1: VALIDATION & SCOPE ENFORCEMENT';
        log(`=== ${currentStep} ===`);

        await validateDocumentBuffer(fileBuffer, fileName);

        log(`Step 1 Output: File "${fileName}" validated successfully (${(fileBuffer.length / 1024).toFixed(1)} KB, Rank ${authorityRank}).`);

        // STEP 2: INGESTION LIFECYCLE REGISTRATION (AZURE SQL)
        currentStep = 'STEP 2: INGESTION LIFECYCLE REGISTRATION (AZURE SQL)';
        log(`=== ${currentStep} ===`);

        if (shouldManageRun && !runId) {
            runId = await startIngestionRun(1);
        }
        if (existingDocumentId) {
            documentId = existingDocumentId;
        } else {
            documentId = await createDocument(fileName, sourceType, authorityRank, allowedUserGroups);
        }

        log(`Step 2 Output: dbo.IngestionRuns ID=${runId || 'N/A'}, dbo.Documents ID=${documentId} (Status: Processing).`);

        // STEP 3: DOCUMENT EXTRACTION (PDF / EXCEL EXTRACTOR)
        currentStep = 'STEP 3: DOCUMENT EXTRACTION (PDF / EXCEL)';
        log(`=== ${currentStep} ===`);

        const docIntelResult = await analyzeDocument(fileBuffer, fileName, { log });
        const extractedPages = docIntelResult.pages || [];
        const extractedTables = docIntelResult.tables || [];
        const extractedParagraphs = docIntelResult.paragraphs || [];
        const rawContentLen = (docIntelResult.content || '').length;

        log(`Step 3 Output: Extracted ${extractedPages.length} page(s), ${extractedTables.length} table(s), ${extractedParagraphs.length} paragraph(s), ${rawContentLen} chars raw content.`);

        if (extractedTables.length > 0) {
            log(`Step 3 Extracted Tables Summary (${extractedTables.length} table(s)):`);
            extractedTables.forEach((t, i) => {
                const sheetInfo = t.sheetName ? `Sheet="${t.sheetName}", ` : '';
                const pageInfo = t.boundingRegions?.[0]?.pageNumber ? `Page=${t.boundingRegions[0].pageNumber}, ` : '';
                log(`  [Table ${i + 1}] ${sheetInfo}${pageInfo}Dimensions=${t.rowCount} rows x ${t.columnCount} cols (${t.cells?.length || 0} cells)`);
            });
        } else {
            log('Step 3 Notice: 0 structured tables detected by extractor (document will be processed via paragraph text stream).');
        }

        if (extractedParagraphs.length > 0) {
            const sampleParaLimit = Math.min(extractedParagraphs.length, 2);
            log(`Step 3 Extracted Paragraphs Sample (First ${sampleParaLimit} of ${extractedParagraphs.length}):`);
            for (let i = 0; i < sampleParaLimit; i++) {
                const snippet = (extractedParagraphs[i].content || '').slice(0, 120).replace(/\r?\n/g, ' ');
                log(`  [Para ${i + 1}] Page ${extractedParagraphs[i].boundingRegions?.[0]?.pageNumber || 1}: "${snippet}${extractedParagraphs[i].content?.length > 120 ? '...' : ''}"`);
            }
        }

        // STEP 4: CONTENT NORMALIZATION
        currentStep = 'STEP 4: CONTENT NORMALIZATION';
        log(`=== ${currentStep} ===`);

        const normalized = normalizeContent(docIntelResult, documentId, { log });
        const normMarkdownLen = (normalized.fullMarkdown || normalized.content || '').length;

        log(`Step 4 Output: Normalized ${normalized.tables.length} table(s), ${normalized.paragraphs.length} paragraph(s) (${normMarkdownLen} chars markdown).`);

        if (normalized.tables.length > 0) {
            log(`Step 4 Normalized Tables Detail (${normalized.tables.length} table(s)):`);
            normalized.tables.forEach((t, i) => {
                const headerStr = (t.headers || []).join(' | ');
                log(`  [Norm Table ${i + 1}] ElementID="${t.element_id}", Page=${t.page_number}, Rows=${t.rows?.length || 0}, Headers: [${headerStr}]`);
                if (t.rows && t.rows.length > 0) {
                    const firstRowVals = (t.rows[0].rawValues || []).slice(0, 4).join(', ');
                    log(`    Sample Row 1: [${firstRowVals}${t.rows[0].rawValues?.length > 4 ? ', ...' : ''}]`);
                }
            });
        } else {
            log('Step 4 Notice: 0 normalized tables (markdown text only).');
        }

        if (normalized.paragraphs.length > 0) {
            const sampleNormLimit = Math.min(normalized.paragraphs.length, 2);
            log(`Step 4 Normalized Paragraphs Detail (First ${sampleNormLimit} of ${normalized.paragraphs.length}):`);
            for (let i = 0; i < sampleNormLimit; i++) {
                const p = normalized.paragraphs[i];
                const snippet = (p.content || '').slice(0, 100).replace(/\r?\n/g, ' ');
                log(`  [Norm Para ${i + 1}] ElementID="${p.element_id}", Page=${p.page_number}: "${snippet}${p.content?.length > 100 ? '...' : ''}"`);
            }
        }

        // Save raw extraction & normalized content to temp file immediately after Step 4
        const savedTemp = saveExtractedContentToTemp({
            documentId,
            fileName,
            correlationId: corrId,
            authorityRank,
            docIntelResult,
            normalized
        });
        if (savedTemp) {
            log(`[Artifact] Extracted & normalized content saved to temp file: "${savedTemp.relativePath}" (and "temp/latest-extracted-content.json").`);
        }

        // STEP 5: STRUCTURED FACT EXTRACTION (IFRS & HR FIGURES)
        currentStep = 'STEP 5: STRUCTURED FACT EXTRACTION';
        log(`=== ${currentStep} ===`);

        const extractedFacts = extractFinancialFacts(normalized);
        log(`Step 5 Output (Extracted Facts Count): ${extractedFacts.length}`);
        if (extractedFacts.length > 0) {
            const sampleLimit = Math.min(extractedFacts.length, 4);
            log(`Step 5 Fact Samples (First ${sampleLimit}):`);
            for (let i = 0; i < sampleLimit; i++) {
                const f = extractedFacts[i];
                log(`  [Fact ${i + 1}] Metric="${f.metric}", Entity="${f.entity || 'N/A'}", Value=${f.numericValue ?? f.textValue} ${f.currency || f.unit || ''}, Location="${f.sourceLocation || 'N/A'}"`);
            }
        } else {
            log('Step 5 Notice: No structured financial metrics discovered in document text/tables.');
        }

        // STEP 6: FACT PERSISTENCE & CONFLICT AUDITING (AZURE SQL)
        currentStep = 'STEP 6: FACT PERSISTENCE & CONFLICT AUDITING';
        log(`=== ${currentStep} ===`);

        let conflicts = [];
        let insertedFactIds = [];
        let hasUnresolvedConflicts = false;
        const effectiveModifiedEmail = modifiedUserEmail || modifiedByEmail || createdByEmail || null;

        if (extractedFacts.length > 0) {
            // 1. Fetch existing approved master facts from database for dynamic conflict comparison
            let existingApprovedFacts = [];
            try {
                existingApprovedFacts = await getCompleteFinancialFacts();
            } catch (err) {
                log(`Step 6 Warning: Could not retrieve existing facts for conflict comparison: ${err.message}`);
            }

            // 2. Run dynamic conflict detection
            conflicts = detectFinancialFactConflicts(extractedFacts, existingApprovedFacts, {
                authorityRank,
                authoritySource,
                fileName,
                documentId,
                modifiedUserEmail: effectiveModifiedEmail
            });

            log(`Step 6 Conflict Detection: Discovered ${conflicts.length} conflict(s).`);

            if (conflicts.length > 0) {
<<<<<<< Updated upstream
                for (const c of conflicts) {
                    log(`  - Discrepancy on "${c.fact1?.Metric}": ${c.status} (${c.fact1?.SourceFileName}: ${c.fact1?.NumericValue} vs ${c.fact2?.SourceFileName}: ${c.fact2?.NumericValue})`);
                }
<<<<<<< Updated upstream
=======

                // Log audit trail
                await logConflictDetected({ documentId, conflicts, correlationId: corrId });

                // Dispatch conflict notification email with resolution links
                await sendConflictNotificationEmail({
                    documentId,
                    fileName,
                    modifiedByEmail,
                    modifiedByName,
                    conflicts,
                    baseUrl,
                    correlationId: corrId,
                    context
                });
=======
                hasUnresolvedConflicts = true;
                log(`Step 6 Notice: Document contains ${conflicts.length} unresolved financial conflict(s). Staging all facts as Pending and holding document in PendingApproval.`);

                // 3. Stage facts with MappingStatus = 'Pending' and create FactConflicts with decision tokens
                const staged = await savePendingFactsAndConflicts({
                    documentId,
                    incomingFacts: extractedFacts,
                    conflicts,
                    authorityRank,
                    fileName,
                    modifiedUserEmail: effectiveModifiedEmail
                });

                insertedFactIds = staged.insertedFactIds;
                conflicts = staged.conflicts;

                // 4. Send email notifications with secure decision links to document owner
                for (const conflict of conflicts) {
                    log(`  - Discrepancy on "${conflict.metric}": Held for review (Existing [${conflict.existingFileName}]: ${conflict.existingValue} vs Incoming: ${conflict.incomingValue})`);
                    if (conflict.token) {
                        try {
                            const notifResult = await sendConflictNotification({
                                conflict,
                                token: conflict.token,
                                recipientEmail: effectiveModifiedEmail
                            });
                            log(`  - Dispatched notification to ${notifResult.recipient}: Success=${notifResult.success}`);
                        } catch (notifErr) {
                            log(`  - Notification warning: ${notifErr.message}`);
                        }
                    }
                }
            } else {
                // No conflicts detected: insert facts as Approved
                const insertedCount = await insertFinancialFacts(documentId, extractedFacts, authorityRank, fileName, { mappingStatus: 'Approved' });
                insertedFactIds = insertedCount;
                log(`Step 6 Output (dbo.FinancialFacts): Inserted ${insertedCount.length || extractedFacts.length} approved row(s).`);
>>>>>>> Stashed changes
>>>>>>> Stashed changes
            }
        } else {
            log('Step 6 Output: Skipped SQL fact insertion (0 facts extracted).');
        }

<<<<<<< Updated upstream
=======
<<<<<<< Updated upstream
        const hasConflicts = conflicts.length > 0;
=======
        // If conflicts were detected, hold ingestion in PendingApproval status (do not index into search)
        if (hasUnresolvedConflicts) {
            log(`Step 7-9 Notice: Retrieval chunking and vector search indexing deferred while document has pending conflicts.`);
            currentStep = 'STEP 10: INGESTION HOLD (PENDING APPROVAL)';
            log(`=== ${currentStep} ===`);
            log(`Step 10 Output: DocumentId=${documentId} held in PendingApproval due to ${conflicts.length} active conflict(s).`);

            return {
                status: 'PendingApproval',
                documentId,
                runId,
                fileName,
                authorityRank,
                factsExtracted: extractedFacts.length,
                chunksIndexed: 0,
                conflictsProcessed: conflicts.length,
                conflicts,
                correlationId: corrId
            };
        }
>>>>>>> Stashed changes

>>>>>>> Stashed changes
        /// STEP 7: RETRIEVAL CHUNKING
        currentStep = 'STEP 7: RETRIEVAL CHUNKING';
        log(`=== ${currentStep} ===`);

        const chunks = createChunks(normalized, fileName, null, null, { queueKey });
        log(`Step 7 Output (Created Chunks): ${chunks.length} retrieval chunk(s).`);
        if (chunks.length > 0) {
            log(`  - Chunk 0: ID="${chunks[0].id}", Title="${chunks[0].title}", Length=${chunks[0].content.length} chars`);
            if (chunks.length > 1) {
                const lastIdx = chunks.length - 1;
                log(`  - Chunk ${lastIdx}: ID="${chunks[lastIdx].id}", Title="${chunks[lastIdx].title}", Length=${chunks[lastIdx].content.length} chars`);
            }
        }

        // Update temp file with complete pipeline artifacts (facts, conflicts, chunks)
        const updatedTemp = saveExtractedContentToTemp({
            documentId,
            fileName,
            correlationId: corrId,
            authorityRank,
            docIntelResult,
            normalized,
            extractedFacts,
            conflicts,
            chunks
        });
        if (updatedTemp) {
            log(`[Artifact] Pipeline artifacts updated in temp file: "${updatedTemp.relativePath}" (and "temp/latest-extracted-content.json").`);
        }

        // STEP 8 & 9: MULTILINGUAL EMBEDDINGS & AZURE AI SEARCH INDEXING
        currentStep = 'STEP 8 & 9: MULTILINGUAL EMBEDDINGS & AZURE AI SEARCH';
        log(`=== ${currentStep} ===`);

        if (chunks.length > 0) {
            const chunkTexts = chunks.map(c => `${c.title}\n${c.content}`);
            const embeddings = await generateBatchEmbeddings(chunkTexts);
            const vectorDimensions = embeddings[0] ? embeddings[0].length : 0;

            log(`Step 8 Output (Embeddings): Produced ${embeddings.length} vector(s) of ${vectorDimensions} dimensions.`);

            const searchIndex = process.env.AZURE_SEARCH_INDEX || 'finance-hr-documents';
            const searchMetadata = {
                documentId,
                documentVersionId: blankToNull(documentVersionId),
                documentKey: blankToNull(documentKey),
                queueKey: blankToNull(queueKey),
                fileName,
                fileLink: blankToNull(fileLink),
                department: blankToNull(department),
                jobTitle: blankToNull(jobTitle),
                authorityRank,
                authoritySource: blankToNull(authoritySource),
                modifiedDate: blankToNull(modifiedDate)
            };
            const searchDocuments = chunks.map((chunk, idx) => buildSearchDocument({
                chunk,
                contentVector: embeddings[idx],
                metadata: searchMetadata
            }));

            await uploadChunks(searchDocuments);
            const deleted = await deleteReplacedChunks(
                searchMetadata.documentKey,
                searchDocuments.map(document => document.id)
            );
            log(`Step 9 Output (Azure AI Search): Uploaded ${searchDocuments.length} hybrid vector chunk(s) to index "${searchIndex}". Deleted replaced chunks: ${deleted}.`);
        } else {
            log('Step 8 & 9 Output: Skipped search indexing (0 chunks).');
        }

        // STEP 10: INGESTION COMPLETION & FINAL STATUS UPDATE
        currentStep = 'STEP 10: INGESTION COMPLETION';
        log(`=== ${currentStep} ===`);

        await updateDocumentStatus(documentId, 'Succeeded');
        if (shouldManageRun && runId) {
            await completeIngestionRun(runId, 1, 0, 'Succeeded');
            log(`Step 10 Output: Ingestion finalized as Succeeded for DocumentId=${documentId}, RunId=${runId}.`);
        } else {
            log(`Step 10 Output: Ingestion finalized as Succeeded for DocumentId=${documentId} (Batch RunId=${runId || 'N/A'}).`);
        }
        log(`>>> INGESTION FINISHED SUCCESSFULLY <<< DocumentId=${documentId}, Facts=${extractedFacts.length}, Chunks=${chunks.length}`);

        const finalResult = {
            status: 'success',
            documentId,
            runId,
            fileName,
            authorityRank,
            factsExtracted: extractedFacts.length,
            chunksIndexed: chunks.length,
<<<<<<< Updated upstream
            conflictsProcessed: conflicts.length,
=======
<<<<<<< Updated upstream
            conflictsProcessed: 0,
=======
            conflictsProcessed: conflicts.length,
            tempArtifactPath: savedTemp?.relativePath || null,
>>>>>>> Stashed changes
>>>>>>> Stashed changes
            correlationId: corrId
        };

        return finalResult;

    } catch (err) {
        errorLog(`!!! INGESTION FAILED AT [${currentStep}] !!!`);
        errorLog(`Error Name: ${err.name || 'Error'}`);
        errorLog(`Error Message: ${err.message}`);
        if (err.stack) {
            errorLog(`Error Stack Trace: ${err.stack}`);
        }

        if (documentId) {
            errorLog(`Rolling back partial facts and setting DocumentId=${documentId} status to 'Failed'...`);
            await deleteDocumentFacts(documentId).catch(e => {
                errorLog(`Failed to delete partial facts: ${e.message}`);
            });
            await updateDocumentStatus(documentId, 'Failed').catch(e => {
                errorLog(`Failed to update document status to Failed: ${e.message}`);
            });
        }

        if (shouldManageRun && runId) {
            await completeIngestionRun(runId, 0, 1, 'Failed', sanitizeErrorMessage(err)).catch(e => {
                errorLog(`Failed to update ingestion run to Failed: ${e.message}`);
            });
        }

        throw err;
    }
}

module.exports = {
    processDocumentIngestion
};
