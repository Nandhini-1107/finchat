// scripts/run-queue-now.js
// Purpose: Standalone CLI runner to execute SharePoint Queue Ingestion immediately
// Runs without needing func start, Azurite, or waiting for cron schedules.

require('../src/utils/config');
const {
    readPendingQueueItems,
    downloadDriveItemBuffer,
    updateQueueItemStatus
} = require('../src/services/sharepoint-queue');
const { processDocumentIngestion } = require('../src/services/ingestion-pipeline');
const { resolveDocumentKey, resolveQueueKey, blankToNull } = require('../src/services/search-document');
const {
    startIngestionRun,
    updateIngestionRunProgress,
    completeIngestionRun
} = require('../src/services/sql');

async function main() {
    console.log('================================================================');
    console.log('    FINORA AI — MANUAL SHAREPOINT QUEUE PROCESSOR RUNNER        ');
    console.log('================================================================\n');

    const consoleContext = {
        log: (...args) => console.log('[QueueRunner]', ...args),
        warn: (...args) => console.warn('[QueueRunner Warning]', ...args),
        error: (...args) => console.error('[QueueRunner Error]', ...args)
    };

    console.log('Connecting to Microsoft Graph and checking SharePoint queue list...');

    let queueData;
    try {
        queueData = await readPendingQueueItems(consoleContext);
    } catch (err) {
        console.error('\n[ERROR] Failed to query SharePoint queue list:', err.message);
        process.exit(1);
    }

    const { graphClient, siteId, listId, items } = queueData;
    const pendingItems = items || [];

    console.log(`\nFound ${pendingItems.length} pending record(s) in SharePoint queue.`);

    if (pendingItems.length === 0) {
        console.log('\n[INFO] No documents with ProcessingStatus="Pending" found.');
        console.log('To test ingestion, add or set a row in your SharePoint list to "Pending".');
        process.exit(0);
    }

    let batchRunId = null;
    try {
        batchRunId = await startIngestionRun(pendingItems.length);
        console.log(`[OK] Registered IngestionRun #${batchRunId} in SQL database.\n`);
    } catch (e) {
        console.warn(`[WARN] Could not register IngestionRun: ${e.message}`);
    }

    let succeededCount = 0;
    let failedCount = 0;

    for (let i = 0; i < pendingItems.length; i++) {
        const record = pendingItems[i];
        console.log(`\n----------------------------------------------------------------`);
        console.log(`Processing Item ${i + 1}/${pendingItems.length}: "${record.FileName}" (ID: ${record.id})`);
        console.log(`----------------------------------------------------------------`);

        try {
            await updateQueueItemStatus(graphClient, siteId, listId, record.id, 'Processing');
            console.log(`  - SharePoint item ${record.id} locked as "Processing"`);

            console.log(`  - Downloading file from DriveItem ${record.DriveItemId}...`);
            const fileBuffer = await downloadDriveItemBuffer(graphClient, record.DriveId, record.DriveItemId);
            console.log(`  - Downloaded ${(fileBuffer.length / 1024).toFixed(1)} KB`);

            console.log(`  - Running 10-step ingestion pipeline...`);
            const result = await processDocumentIngestion({
                fileBuffer,
                fileName: record.FileName,
                sourceType: 'SharePoint',
                authorityRank: Number(record.AuthorityRank) || 4,
                allowedUserGroups: record.AllowedUserGroups || null,
                correlationId: `cli-${Date.now()}-${record.id}`,
                context: consoleContext,
                existingRunId: batchRunId,
                documentKey: resolveDocumentKey(record),
                queueKey: resolveQueueKey(record),
                fileLink: blankToNull(record.FileLink),
                department: blankToNull(record.CreatedByDepartment),
                jobTitle: blankToNull(record.CreatedByJobTitle),
                modifiedDate: blankToNull(record.ModifiedDate),
                sharePointFileId: blankToNull(record.DriveItemId || record.id),
                fileVersion: blankToNull(record.FileVersion),
                modifiedByEmail: blankToNull(record.ModifiedByEmail),
                modifiedByName: blankToNull(record.ModifiedByName),
                modifiedByUserId: blankToNull(record.ModifiedByUserId),
                createdByEmail: blankToNull(record.CreatedByEmail),
                createdByName: blankToNull(record.CreatedByName),
                createdByUserId: blankToNull(record.CreatedByUserId),
                uploaderEmail: blankToNull(record.ModifiedByEmail || record.CreatedByEmail)
            });

            await updateQueueItemStatus(graphClient, siteId, listId, record.id, 'Processed', '');
            console.log(`  [SUCCESS] DocumentId=${result.documentId} ingested. SharePoint item marked "Processed".`);
            succeededCount++;

            if (batchRunId) {
                await updateIngestionRunProgress(batchRunId, true).catch(() => {});
            }
        } catch (itemErr) {
            console.error(`  [FAILURE] Could not process "${record.FileName}":`, itemErr.message);
            await updateQueueItemStatus(graphClient, siteId, listId, record.id, 'Failed', itemErr.message).catch(() => {});
            failedCount++;

            if (batchRunId) {
                await updateIngestionRunProgress(batchRunId, false, itemErr.message).catch(() => {});
            }
        }
    }

    if (batchRunId) {
        const overallStatus = failedCount === 0 ? 'Succeeded' : (succeededCount === 0 ? 'Failed' : 'CompletedWithErrors');
        await completeIngestionRun(batchRunId, succeededCount, failedCount, overallStatus).catch(() => {});
    }

    console.log('\n================================================================');
    console.log(`BATCH COMPLETE: ${succeededCount} Succeeded, ${failedCount} Failed.`);
    console.log('================================================================\n');

    process.exit(0);
}

main().catch(err => {
    console.error('Fatal runner error:', err);
    process.exit(1);
});
