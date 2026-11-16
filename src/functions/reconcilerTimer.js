// src/functions/reconcilerTimer.js
// Azure Functions Timer trigger for periodic fact and document reconciliation scan (WP9).
const { app } = require('@azure/functions');
const { runReconciliationScan } = require('../services/reconciler');
require('../utils/config');

app.timer('reconcilerTimer', {
    // Runs every 15 minutes by default
    schedule: process.env.RECONCILER_CRON || '0 */15 * * * *',
    handler: async (myTimer, context) => {
        const timeStamp = new Date().toISOString();
        context.log(`[ReconcilerTimer] Running periodic reconciliation scan at: ${timeStamp}`);

        try {
            const summary = await runReconciliationScan();
            context.log(`[ReconcilerTimer] Scan completed. Holds released: ${summary.holdsReleased}, Documents superseded: ${summary.documentsSuperseded}, Facts reconciled: ${summary.factsReconciled}`);
        } catch (err) {
            context.error(`[ReconcilerTimer] Reconciliation scan encountered an error: ${err.message}`);
        }
    }
});

module.exports = {
    // For unit testing
    schedule: process.env.RECONCILER_CRON || '0 */15 * * * *'
};

