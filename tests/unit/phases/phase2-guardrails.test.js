const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { isAuthEnforced } = require('../../../src/utils/config');

test('WP1: Baseline Traceability & Phase 2 Guardrails', async (t) => {
    await t.test('1. Configuration: ENFORCE_AUTH defaults to false and isAuthEnforced() reflects environment', () => {
        const originalEnv = process.env.ENFORCE_AUTH;
        try {
            delete process.env.ENFORCE_AUTH;
            assert.equal(isAuthEnforced(), false, 'isAuthEnforced should return false when ENFORCE_AUTH is unset');
            assert.equal(process.env.isAuthEnforced, undefined, 'process.env must not have global mutation');

            process.env.ENFORCE_AUTH = 'false';
            assert.equal(isAuthEnforced(), false, 'isAuthEnforced should return false when ENFORCE_AUTH=false');

            process.env.ENFORCE_AUTH = '0';
            assert.equal(isAuthEnforced(), false, 'isAuthEnforced should return false when ENFORCE_AUTH=0');

            process.env.ENFORCE_AUTH = '';
            assert.equal(isAuthEnforced(), false, 'isAuthEnforced should return false when ENFORCE_AUTH is empty');

            process.env.ENFORCE_AUTH = 'true';
            assert.equal(isAuthEnforced(), true, 'isAuthEnforced should return true when ENFORCE_AUTH=true');

            process.env.ENFORCE_AUTH = '1';
            assert.equal(isAuthEnforced(), true, 'isAuthEnforced should return true when ENFORCE_AUTH=1');
        } finally {
            if (originalEnv !== undefined) {
                process.env.ENFORCE_AUTH = originalEnv;
            } else {
                delete process.env.ENFORCE_AUTH;
            }
        }
    });

    await t.test('2. TODO(PHASE2) Markers: All 4 key boundary files contain explicit markers', () => {
        const targetFiles = [
            'src/functions/confirmConflict.js',
            'src/functions/ingestDocument.js',
            'src/functions/chat.js',
            'src/services/sharepoint-queue.js'
        ];

        for (const relPath of targetFiles) {
            const fullPath = path.resolve(__dirname, '../../..', relPath);
            assert.ok(fs.existsSync(fullPath), `Target file must exist: ${relPath}`);
            const content = fs.readFileSync(fullPath, 'utf8');
            assert.ok(
                content.includes('TODO(PHASE2)'),
                `File ${relPath} must contain a TODO(PHASE2) marker`
            );
        }
    });

    await t.test('3. Documentation: KNOWN_LIMITATIONS.md and REQUIREMENTS_TRACE.md exist and document Phase 2 boundaries', () => {
        const rootDir = path.resolve(__dirname, '../../..');
        const knownLimitationsPath = path.join(rootDir, 'KNOWN_LIMITATIONS.md');
        const reqTracePath = path.join(rootDir, 'REQUIREMENTS_TRACE.md');

        assert.ok(fs.existsSync(knownLimitationsPath), 'KNOWN_LIMITATIONS.md must exist in root');
        assert.ok(fs.existsSync(reqTracePath), 'REQUIREMENTS_TRACE.md must exist in root');

        const limitations = fs.readFileSync(knownLimitationsPath, 'utf8');
        assert.ok(limitations.includes('ENFORCE_AUTH=false'), 'Must document ENFORCE_AUTH=false');
        assert.ok(limitations.includes('x-user-email'), 'Must document x-user-email boundary');
        assert.ok(limitations.includes('File-Level Decisions'), 'Must document D2 file-level superseding');

        const trace = fs.readFileSync(reqTracePath, 'utf8');
        assert.ok(trace.includes('A.1') && trace.includes('A.8'), 'Must trace all Operating Rules A.1 to A.8');
        assert.ok(trace.includes('D.1') || trace.includes('D1'), 'Must trace Decisions D1 to D8');
    });

    await t.test('4. Acceptance Dataset: tests/acceptance/acceptance-dataset.json has WP1 baseline case', () => {
        const datasetPath = path.resolve(__dirname, '../../acceptance', 'acceptance-dataset.json');
        assert.ok(fs.existsSync(datasetPath), 'acceptance-dataset.json must exist');
        const dataset = JSON.parse(fs.readFileSync(datasetPath, 'utf8'));
        assert.ok(Array.isArray(dataset), 'acceptance dataset must be an array');
        const wp1Case = dataset.find(d => d.package === 'WP1' || d.id === 'wp1-baseline-auth-guardrail');
        assert.ok(wp1Case, 'Dataset must include WP1 baseline case');
        assert.equal(wp1Case.expected.defaultValue, 'false');
    });
});

