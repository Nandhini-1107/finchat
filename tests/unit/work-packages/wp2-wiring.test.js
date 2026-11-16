const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

test('Package 2: Azure Functions Registrations, Queue Decoupling & Arabic Wiring', async (t) => {

    await t.test('1. Reconciler Timer: src/functions/reconcilerTimer.js is registered', () => {
        const filePath = path.resolve(__dirname, '../../../src/functions/reconcilerTimer.js');
        assert.ok(fs.existsSync(filePath), 'reconcilerTimer.js must exist');
        const content = fs.readFileSync(filePath, 'utf8');
        assert.ok(content.includes("app.timer('reconcilerTimer'"), 'Must register app.timer reconcilerTimer');
        assert.ok(content.includes('runReconciliationScan'), 'Must invoke runReconciliationScan');
    });

    await t.test('2. Storage Queue Worker: src/functions/processDocumentQueue.js registers app.storageQueue', () => {
        const filePath = path.resolve(__dirname, '../../../src/functions/processDocumentQueue.js');
        assert.ok(fs.existsSync(filePath), 'processDocumentQueue.js must exist');
        const content = fs.readFileSync(filePath, 'utf8');
        assert.ok(content.includes("app.storageQueue('processIngestionQueue'"), 'Must register app.storageQueue');
        assert.ok(content.includes('finchat-ingestion-queue'), 'Must bind to finchat-ingestion-queue');
        assert.ok(content.includes('dequeueCount >= 5'), 'Must check poison threshold after 5 dequeues');
    });

    await t.test('3. SharePoint Scanner: Monthly Timer & Manual HTTP trigger registered', () => {
        const filePath = path.resolve(__dirname, '../../../src/functions/sharepointScanner.js');
        assert.ok(fs.existsSync(filePath), 'sharepointScanner.js must exist');
        const content = fs.readFileSync(filePath, 'utf8');
        assert.ok(content.includes("app.timer('sharepointMonthlyScan'"), 'Must register monthly scan timer');
        assert.ok(content.includes("app.http('triggerSharepointScan'"), 'Must register manual scan HTTP endpoint');
    });

    await t.test('4. Admin Conflicts: GET /api/admin/conflicts registered', () => {
        const filePath = path.resolve(__dirname, '../../../src/functions/adminConflicts.js');
        assert.ok(fs.existsSync(filePath), 'adminConflicts.js must exist');
        const content = fs.readFileSync(filePath, 'utf8');
        assert.ok(content.includes("app.http('adminConflicts'"), 'Must register admin conflicts HTTP endpoint');
        assert.ok(content.includes("'admin/conflicts'"), 'Must route to admin/conflicts');
    });

    await t.test('5. Arabic Normalizer Integration: unit-normalizer and content-normalizer call arabic-normalizer', () => {
        const unitNorm = fs.readFileSync(path.resolve(__dirname, '../../../src/services/unit-normalizer.js'), 'utf8');
        assert.ok(unitNorm.includes("require('./arabic-normalizer')"), 'unit-normalizer must import arabic-normalizer');
        assert.ok(unitNorm.includes('normalizeArabicDigits'), 'unit-normalizer must call normalizeArabicDigits');

        const contentNorm = fs.readFileSync(path.resolve(__dirname, '../../../src/services/content-normalizer.js'), 'utf8');
        assert.ok(contentNorm.includes("require('./arabic-normalizer')"), 'content-normalizer must import arabic-normalizer');
        assert.ok(contentNorm.includes('normalizeArabicText'), 'content-normalizer must call normalizeArabicText');
    });

    await t.test('6. Ingestion Enqueue & 202: ingestDocument uses durableQueue and has zero detached workers', () => {
        const ingestCode = fs.readFileSync(path.resolve(__dirname, '../../../src/functions/ingestDocument.js'), 'utf8');
        assert.ok(ingestCode.includes('durableQueue.enqueueIngestionJob'), 'Must enqueue to durableQueue');
        assert.ok(!ingestCode.includes('(async () => {'), 'Must NOT have detached in-process background IIFE');
    });
});

