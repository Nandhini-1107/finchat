const { app } = require('@azure/functions');
const {
    processConflictReminders,
    checkMaxHoldAlerts,
    processNotificationOutbox
} = require('../services/conflict-notifier');

// 1. Conflict Reminders Timer (Hourly: sends 24h & 48h reminders for open conflicts)
app.timer('conflictRemindersTimer', {
    schedule: '0 0 */1 * * *',
    handler: async (myTimer, context) => {
        context.log('[Timer] Starting Conflict Reminders Scan...');
        try {
            const summary = await processConflictReminders();
            context.log(`[Timer] Conflict Reminders completed: ${JSON.stringify(summary)}`);
            return summary;
        } catch (err) {
            context.error(`[Timer] Conflict Reminders error: ${err.message}`);
            throw err;
        }
    }
});

// 2. Conflict Max Hold Alert Timer (Daily at 8 AM: alerts admin if any conflict held >= 14 days)
app.timer('conflictHoldAlertTimer', {
    schedule: '0 0 8 * * *',
    handler: async (myTimer, context) => {
        context.log('[Timer] Starting Conflict Hold Age Scan...');
        try {
            const summary = await checkMaxHoldAlerts();
            context.log(`[Timer] Conflict Hold Age check completed: ${JSON.stringify(summary)}`);
            return summary;
        } catch (err) {
            context.error(`[Timer] Conflict Hold Age check error: ${err.message}`);
            throw err;
        }
    }
});

// 3. Notification Outbox Retry Timer (Every 5 minutes: retries failed notification emails up to 5 times)
app.timer('notificationOutboxTimer', {
    schedule: '0 */5 * * * *',
    handler: async (myTimer, context) => {
        context.log('[Timer] Starting Notification Outbox dispatch...');
        try {
            const summary = await processNotificationOutbox();
            context.log(`[Timer] Notification Outbox completed: ${JSON.stringify(summary)}`);
            return summary;
        } catch (err) {
            context.error(`[Timer] Notification Outbox error: ${err.message}`);
            throw err;
        }
    }
});

module.exports = {
    // Exported for registration tests
};

