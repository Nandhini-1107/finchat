// scripts/run-migrations.js
// Purpose: Automated CLI migration runner that executes all idempotent SQL migrations
// in database/migrations/ in sequence against the configured Azure SQL database.

require('../src/utils/config');
const fs = require('fs');
const path = require('path');
const sql = require('mssql');

async function runMigrations() {
    console.log('================================================================');
    console.log('       FINORA AI — AZURE SQL DATABASE MIGRATION RUNNER          ');
    console.log('================================================================\n');

    const config = {
        server: process.env.AZURE_SQL_SERVER,
        database: process.env.AZURE_SQL_DATABASE,
        user: process.env.AZURE_SQL_USER,
        password: process.env.AZURE_SQL_PASSWORD,
        options: {
            encrypt: process.env.AZURE_SQL_ENCRYPT !== 'false',
            trustServerCertificate: process.env.AZURE_SQL_TRUST_CERT === 'true' || process.env.AZURE_SQL_ENCRYPT === 'false'
        },
        connectionTimeout: 30000,
        requestTimeout: 60000
    };

    if (!config.server || !config.database || !config.user) {
        console.error('Error: AZURE_SQL_SERVER, AZURE_SQL_DATABASE, and AZURE_SQL_USER must be configured.');
        process.exit(1);
    }

    console.log(`Connecting to Azure SQL: ${config.server} / ${config.database} (User: ${config.user})...`);
    let pool;
    try {
        pool = await sql.connect(config);
        console.log('[OK] Connected to Azure SQL successfully.\n');
    } catch (err) {
        console.error('[ERROR] Failed to connect to Azure SQL:', err.message);
        process.exit(1);
    }

    const migrationsDir = path.resolve(__dirname, '../database/migrations');
    if (!fs.existsSync(migrationsDir)) {
        console.error(`Error: Migrations directory not found at ${migrationsDir}`);
        process.exit(1);
    }

    const migrationFiles = fs.readdirSync(migrationsDir)
        .filter(f => f.endsWith('.sql'))
        .sort();

    console.log(`Discovered ${migrationFiles.length} migration file(s) in database/migrations/:\n`);

    for (const file of migrationFiles) {
        const filePath = path.join(migrationsDir, file);
        console.log(`--- Applying Migration: ${file} ---`);
        const sqlContent = fs.readFileSync(filePath, 'utf8');

        // Split by T-SQL 'GO' batch separators
        const batches = sqlContent
            .split(/\r?\n[gG][oO]\s*(?:\r?\n|$)/)
            .map(b => b.trim())
            .filter(b => b.length > 0);

        try {
            for (let i = 0; i < batches.length; i++) {
                const batch = batches[i];
                await pool.request().batch(batch);
            }
            console.log(`[PASS] Successfully applied ${file} (${batches.length} batch(es))\n`);
        } catch (err) {
            console.error(`[FAIL] Error executing migration ${file}:`, err.message);
            console.error('Aborting further migrations.');
            await pool.close();
            process.exit(1);
        }
    }

    console.log('================================================================');
    console.log('  ALL MIGRATIONS APPLIED SUCCESSFULLY!                          ');
    console.log('================================================================\n');

    await pool.close();
}

runMigrations().catch(err => {
    console.error('Fatal error during migration:', err);
    process.exit(1);
});

