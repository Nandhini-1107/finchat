// src/functions/sharepointScanner.js
// Azure Functions Timer trigger (monthly) and HTTP manual trigger for SharePoint library scan (WP11).
const { app } = require('@azure/functions');
const { scanSharePointLibrary } = require('../services/sharepoint-scanner');
require('../utils/config');

// 1. Monthly Timer Trigger (first day of every month at midnight)
app.timer('sharepointMonthlyScan', {
    schedule: process.env.SHAREPOINT_SCAN_CRON || '0 0 0 1 * *',
    handler: async (myTimer, context) => {
        context.log(`[SharePointScanner] Monthly library scan triggered at: ${new Date().toISOString()}`);
        try {
            const summary = await scanSharePointLibrary();
            context.log(`[SharePointScanner] Monthly scan finished. Found: ${summary.totalFound}, Ingested: ${summary.ingested}, Skipped: ${summary.skipped}`);
        } catch (err) {
            context.error(`[SharePointScanner] Monthly scan error: ${err.message}`);
        }
    }
});

// 2. Manual HTTP Trigger Endpoint
app.http('triggerSharepointScan', {
    methods: ['POST'],
    authLevel: 'function',
    route: 'admin/sharepoint/scan',
    handler: async (request, context) => {
        context.log('[SharePointScanner] Manual SharePoint scan invoked via HTTP');
        try {
            const summary = await scanSharePointLibrary();
            return {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    status: 'Succeeded',
                    message: 'SharePoint scan completed successfully.',
                    summary
                })
            };
        } catch (err) {
            return {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    status: 'Failed',
                    error: err.message
                })
            };
        }
    }
});

module.exports = {
    scanSchedule: process.env.SHAREPOINT_SCAN_CRON || '0 0 0 1 * *'
};

