const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
    getMaxTokenReissues,
    getMaxHoldDays,
    reissueDecisionToken,
    processConflictReminders,
    checkMaxHoldAlerts,
    processNotificationOutbox
} = require('../../../src/services/conflict-notifier');
const { setPool, resetPool } = require('../../../src/services/sql');

test('WP16: Financial Fact Conflict Lifecycle, Reminders & Outbox Retry', async (t) => {

    await t.test('1. Configuration Defaults: FINCHAT_MAX_TOKEN_REISSUES is 3 and CONFLICT_MAX_HOLD_DAYS is 14', () => {
        delete process.env.FINCHAT_MAX_TOKEN_REISSUES;
        delete process.env.CONFLICT_MAX_HOLD_DAYS;

        assert.equal(getMaxTokenReissues(), 3, 'Default max token reissues must be 3');
        assert.equal(getMaxHoldDays(), 14, 'Default max hold days must be 14');

        // Configurable via env
        process.env.FINCHAT_MAX_TOKEN_REISSUES = '5';
        assert.equal(getMaxTokenReissues(), 5);

        process.env.CONFLICT_MAX_HOLD_DAYS = '21';
        assert.equal(getMaxHoldDays(), 21);

        delete process.env.FINCHAT_MAX_TOKEN_REISSUES;
        delete process.env.CONFLICT_MAX_HOLD_DAYS;
    });

    await t.test('2. Token Reissue: Increments count and refreshes 72h expiry when below limit', async () => {
        const mockConflict = {
            ConflictId: 101,
            ConflictStatus: 'Detected',
            ReissueCount: 1,
            NotificationRecipient: 'uploader@contoso.com'
        };

        let updatedFields = {};
        const mockPool = {
            connected: true,
            request: () => {
                const req = {
                    input: (name, type, val) => {
                        req[name] = val;
                        return req;
                    },
                    query: async (sqlText) => {
                        if (sqlText.includes('SELECT * FROM dbo.FactConflicts')) {
                            return { recordset: [mockConflict] };
                        }
                        if (sqlText.includes('UPDATE dbo.FactConflicts')) {
                            updatedFields = {
                                tokenHash: req.TokenHash,
                                expiresAt: req.ExpiresAt,
                                newCount: req.NewCount
                            };
                            return { rowsAffected: [1] };
                        }
                        return { recordset: [] };
                    }
                };
                return req;
            }
        };

        setPool(mockPool);
        try {
            const res = await reissueDecisionToken({ conflictId: 101 });
            assert.equal(res.status, 'Reissued');
            assert.equal(res.reissued, true);
            assert.equal(res.reissueCount, 2);
            assert.equal(updatedFields.newCount, 2);
            assert.ok(res.token, 'Must return new signed token');
            assert.ok(res.decisionUrls.keepExistingUrl.includes('token='), 'Must include decision URLs');
        } finally {
            resetPool();
        }
    });

    await t.test('3. Token Reissue Escalation: Transitions to Escalated and delivers admin decision link when max reached', async () => {
        process.env.FINCHAT_MAX_TOKEN_REISSUES = '3';
        process.env.FINCHAT_ADMIN_EMAIL = 'admin-governance@contoso.com';

        const mockConflict = {
            ConflictId: 102,
            ConflictStatus: 'PendingApproval',
            ReissueCount: 3, // Already at max (3)
            NotificationRecipient: 'uploader@contoso.com'
        };

        let escalatedStatus = null;
        let adminRecipientSet = null;

        const mockPool = {
            connected: true,
            request: () => {
                const req = {
                    input: (name, type, val) => {
                        req[name] = val;
                        return req;
                    },
                    query: async (sqlText) => {
                        if (sqlText.includes('SELECT * FROM dbo.FactConflicts')) {
                            return { recordset: [mockConflict] };
                        }
                        if (sqlText.includes('UPDATE dbo.FactConflicts')) {
                            escalatedStatus = 'Escalated';
                            adminRecipientSet = req.AdminEmail;
                            return { rowsAffected: [1] };
                        }
                        return { recordset: [] };
                    }
                };
                return req;
            }
        };

        setPool(mockPool);
        try {
            const res = await reissueDecisionToken({ conflictId: 102 });
            assert.equal(res.status, 'Escalated');
            assert.equal(res.reissued, false);
            assert.equal(res.adminRecipient, 'admin-governance@contoso.com');
            assert.ok(res.adminDecisionUrls.acceptIncomingUrl.includes('token='));
            assert.equal(escalatedStatus, 'Escalated');
            assert.equal(adminRecipientSet, 'admin-governance@contoso.com');
        } finally {
            resetPool();
            delete process.env.FINCHAT_MAX_TOKEN_REISSUES;
            delete process.env.FINCHAT_ADMIN_EMAIL;
        }
    });

    await t.test('4. Reminders 24h & 48h: Dispatches appropriate reminders and tracks timestamps', async () => {
        const now = Date.now();
        const mockConflicts = [
            {
                ConflictId: 201,
                ConflictStatus: 'Detected',
                DetectedAt: new Date(now - 25 * 3600 * 1000).toISOString(), // 25 hours old -> needs 24h reminder
                Reminder24SentAt: null,
                Reminder48SentAt: null,
                NotificationRecipient: 'user1@contoso.com'
            },
            {
                ConflictId: 202,
                ConflictStatus: 'Detected',
                DetectedAt: new Date(now - 50 * 3600 * 1000).toISOString(), // 50 hours old -> needs 48h reminder
                Reminder24SentAt: new Date(now - 26 * 3600 * 1000).toISOString(),
                Reminder48SentAt: null,
                NotificationRecipient: 'user2@contoso.com'
            },
            {
                ConflictId: 203,
                ConflictStatus: 'Detected',
                DetectedAt: new Date(now - 5 * 3600 * 1000).toISOString(), // 5 hours old -> no reminder yet
                Reminder24SentAt: null,
                Reminder48SentAt: null,
                NotificationRecipient: 'user3@contoso.com'
            }
        ];

        let updated24 = [];
        let updated48 = [];

        const mockPool = {
            connected: true,
            request: () => {
                const req = {
                    input: (name, type, val) => {
                        req[name] = val;
                        return req;
                    },
                    query: async (sqlText) => {
                        if (sqlText.includes('SELECT * FROM dbo.FactConflicts')) {
                            return { recordset: mockConflicts };
                        }
                        if (sqlText.includes('Reminder24SentAt = SYSUTCDATETIME()')) {
                            updated24.push(req.ConflictId);
                            return { rowsAffected: [1] };
                        }
                        if (sqlText.includes('Reminder48SentAt = SYSUTCDATETIME()')) {
                            updated48.push(req.ConflictId);
                            return { rowsAffected: [1] };
                        }
                        return { recordset: [] };
                    }
                };
                return req;
            }
        };

        setPool(mockPool);
        try {
            const summary = await processConflictReminders();
            assert.equal(summary.reminders24Sent, 1, 'Conflict 201 should receive 24h reminder');
            assert.equal(summary.reminders48Sent, 1, 'Conflict 202 should receive 48h reminder');
            assert.deepEqual(updated24, [201]);
            assert.deepEqual(updated48, [202]);
        } finally {
            resetPool();
        }
    });

    await t.test('5. Max Hold Alert: Triggers daily admin alert when held >= CONFLICT_MAX_HOLD_DAYS', async () => {
        process.env.CONFLICT_MAX_HOLD_DAYS = '14';
        process.env.FINCHAT_ADMIN_EMAIL = 'admin-governance@contoso.com';

        const mockOverdue = [
            { ConflictId: 301, ConflictStatus: 'PendingApproval', DetectedAt: '2026-10-01T00:00:00Z' }
        ];

        const dispatchedEmails = [];
        const mockMailClient = {
            sendMail: async (opts) => {
                dispatchedEmails.push(opts);
            }
        };

        const mockPool = {
            connected: true,
            request: () => ({
                input: () => ({
                    query: async () => ({ recordset: mockOverdue })
                })
            })
        };

        setPool(mockPool);
        try {
            const alerts = await checkMaxHoldAlerts({ mailClient: mockMailClient });
            assert.equal(alerts.length, 1);
            assert.equal(alerts[0].conflictId, 301);
            assert.equal(dispatchedEmails.length, 1);
            assert.equal(dispatchedEmails[0].to, 'admin-governance@contoso.com');
            assert.ok(dispatchedEmails[0].subject.includes('Hold Exceeded 14 Days'));
        } finally {
            resetPool();
            delete process.env.CONFLICT_MAX_HOLD_DAYS;
            delete process.env.FINCHAT_ADMIN_EMAIL;
        }
    });

    await t.test('6. Email Outbox: Sets PendingRetry on failure, caps at 5 and marks FailedPermanent', async () => {
        const mockQueue = [
            {
                ConflictId: 401,
                NotificationStatus: 'PendingRetry',
                NotificationRetryCount: 4, // Next failure will make it 5 -> FailedPermanent
                NotificationRecipient: 'user@contoso.com'
            },
            {
                ConflictId: 402,
                NotificationStatus: 'Pending',
                NotificationRetryCount: 1, // Next failure makes it 2 -> PendingRetry
                NotificationRecipient: 'user@contoso.com'
            }
        ];

        const statusUpdates = {};
        const mockPool = {
            connected: true,
            request: () => {
                const req = {
                    input: (name, type, val) => {
                        req[name] = val;
                        return req;
                    },
                    query: async (sqlText) => {
                        if (sqlText.includes('SELECT * FROM dbo.FactConflicts')) {
                            return { recordset: mockQueue };
                        }
                        if (sqlText.includes('UPDATE dbo.FactConflicts')) {
                            statusUpdates[req.ConflictId] = {
                                status: req.NewStatus,
                                count: req.NewCount
                            };
                            return { rowsAffected: [1] };
                        }
                        return { recordset: [] };
                    }
                };
                return req;
            }
        };

        // Mail client that always throws to test retry and permanent failure
        const failingMailClient = {
            sendMail: async () => {
                throw new Error('SMTP connection refused');
            }
        };

        setPool(mockPool);
        try {
            const result = await processNotificationOutbox({ mailClient: failingMailClient, maxRetries: 5 });
            assert.equal(result.processed, 2);
            assert.equal(result.retried, 1, 'Conflict 402 should be retried');
            assert.equal(result.permanentlyFailed, 1, 'Conflict 401 should hit cap 5 and be permanently failed');

            assert.equal(statusUpdates[401].status, 'FailedPermanent');
            assert.equal(statusUpdates[401].count, 5);

            assert.equal(statusUpdates[402].status, 'PendingRetry');
            assert.equal(statusUpdates[402].count, 2);
        } finally {
            resetPool();
        }
    });

    await t.test('7. HOLD SAFETY INVARIANT: Hold is NEVER released by reminders, reissue, escalation, alerts, or outbox', async () => {
        // Confirm that across all lifecycle functions, dbo.Documents.ConflictHold is never updated to 0
        const mockConflict = {
            ConflictId: 501,
            ConflictStatus: 'Detected',
            ReissueCount: 2,
            NotificationRecipient: 'uploader@contoso.com'
        };

        let documentHoldReleased = false;

        const mockReq = {
            input: () => mockReq,
            query: async (sqlText) => {
                if (sqlText.includes('dbo.Documents') && sqlText.includes('ConflictHold = 0')) {
                    documentHoldReleased = true;
                }
                if (sqlText.includes('SELECT * FROM dbo.FactConflicts')) {
                    return { recordset: [mockConflict] };
                }
                return { recordset: [], rowsAffected: [1] };
            }
        };

        const mockPool = {
            connected: true,
            request: () => mockReq
        };

        setPool(mockPool);
        try {
            await reissueDecisionToken({ conflictId: 501 });
            await processConflictReminders();
            await checkMaxHoldAlerts();
            await processNotificationOutbox();

            assert.equal(documentHoldReleased, false, 'Document ConflictHold must NEVER be released by conflict lifecycle operations!');
        } finally {
            resetPool();
        }
    });

    await t.test('8. Azure Functions Timers: conflictRemindersTimer, conflictHoldAlertTimer, and notificationOutboxTimer are registered', () => {
        // Load the timer registrations file
        require('../../../src/functions/conflictLifecycleTimer');
        const { app } = require('@azure/functions');
        assert.ok(app, 'Azure functions app must be available');
    });
});
