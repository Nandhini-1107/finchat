// scripts/reset-stuck-docs.js
// Purpose: Clears stuck 'Processing' documents or resets test documents in local SQL database

require('../src/utils/config');
const { getPool } = require('../src/services/sql');

async function resetStuckDocs() {
    console.log('Connecting to local database...');
    const pool = await getPool();

    // 1. Check existing documents
    const checkRes = await pool.request().query(`
        SELECT DocumentId, FileName, AuthorityRank, IngestionStatus, ConflictHold, CreatedAt
        FROM dbo.Documents
        ORDER BY DocumentId DESC;
    `);

    console.log(`\nFound ${checkRes.recordset.length} document(s) in dbo.Documents:`);
    console.table(checkRes.recordset);

    // 2. Clear stuck Processing documents
    const updateRes = await pool.request().query(`
        UPDATE dbo.Documents
        SET IngestionStatus = 'Failed',
            ProcessingError = 'Manually reset: stuck in Processing from prior interrupted run'
        WHERE IngestionStatus = 'Processing';
    `);

    console.log(`\nReset ${updateRes.rowsAffected[0]} stuck 'Processing' document(s) to 'Failed'.`);
    console.log('You can now upload your documents without getting blocked by idempotency!');

    process.exit(0);
}

resetStuckDocs().catch(err => {
    console.error('Failed to reset documents:', err.message);
    process.exit(1);
});
