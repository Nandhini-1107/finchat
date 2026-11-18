const { getPool } = require('../src/services/sql');

async function check() {
    const p = await getPool();
    const conflicts = await p.request().query(`
        SELECT c.ConflictId, 
               c.ConflictDescription,
               c.DifferencePercentage,
               c.NotificationRecipient,
               c.NotificationStatus,
               c.NotificationSentAt,
               f1.OriginalLabel AS ExistingMetric,
               f1.NormalizedValue AS ExistingVal,
               f2.NormalizedValue AS IncomingVal
        FROM dbo.FactConflicts c
        JOIN dbo.FinancialFacts f1 ON c.ExistingFactId = f1.FactId
        JOIN dbo.FinancialFacts f2 ON c.IncomingFactId = f2.FactId
        WHERE c.ConflictId >= 2
        ORDER BY c.ConflictId ASC
    `);
    console.table(conflicts.recordset);
    process.exit(0);
}

check().catch(e => { console.error(e); process.exit(1); });
