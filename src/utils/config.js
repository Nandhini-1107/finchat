const path = require('path');
const fs = require('fs');
require('dotenv').config();

// Auto-load local.settings.json in development environments
if (!process.env.AZURE_SQL_SERVER) {
    const localSettingsPath = path.resolve(__dirname, '../../local.settings.json');
    if (fs.existsSync(localSettingsPath)) {
        try {
            const raw = fs.readFileSync(localSettingsPath, 'utf8');
            const parsed = JSON.parse(raw);
            if (parsed.Values) {
                for (const [key, val] of Object.entries(parsed.Values)) {
                    if (!process.env[key]) {
                        process.env[key] = String(val);
                    }
                }
            }
        } catch (_) {}
    }
}

/**
 * Evaluates whether authentication and authorization enforcement is active.
 * Phase 2 Boundary Guardrail (Operating Rule A.7).
 * Reads process.env.ENFORCE_AUTH at call time without mutating process.env.
 * Defaults to false if ENFORCE_AUTH is unset, empty, or false.
 */
function isAuthEnforced() {
    const val = (process.env.ENFORCE_AUTH || '').trim().toLowerCase();
    return val === 'true' || val === '1';
}

module.exports = {
    isAuthEnforced
};
