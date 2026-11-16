// tests/wp7-conflict-notifier.test.js
// Test Suite for WP7: Uploader Conflict Email with Dual Links & Domain Validation

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    formatConflictEmailNotification,
    sendConflictNotification,
    resolveAndValidateRecipient
} = require('../../../src/services/conflict-notifier');

const { generateDecisionToken } = require('../../../src/services/conflict-token');
const { setPool, resetPool } = require('../../../src/services/sql');

test('WP7: Uploader Conflict Email with Dual Links & Domain Validation', async (t) => {

    const token = generateDecisionToken({ conflictId: 701, recipientEmail: 'analyst@contoso.com' });

    const mockConflict = {
        conflictId: 701,
        metric: 'NetRevenue',
        entity: 'Contoso Retail LLC',
        periodLabel: 'Q1 2026',
        reportingBasis: 'Actual',
        existingValue: 1200000,
        incomingValue: 1250000,
        currency: 'AED',
        unit: 'amount',
        existingFileName: 'Master_Q1_2026.xlsx',
        incomingFileName: 'Uploaded_Q1_2026_v2.xlsx',
        sharePointWebUrl: 'https://contoso.sharepoint.com/sites/finance/Master_Q1_2026.xlsx',
        modifiedUserEmail: 'analyst@contoso.com'
    };

    await t.test('1. Recipient domain validation against ALLOWED_UPLOADER_EMAIL_DOMAINS', () => {
        const prevDomains = process.env.ALLOWED_UPLOADER_EMAIL_DOMAINS;
        const prevAdmin = process.env.FINCHAT_ADMIN_EMAIL;

        process.env.ALLOWED_UPLOADER_EMAIL_DOMAINS = 'contoso.com, contoso.ae';
        process.env.FINCHAT_ADMIN_EMAIL = 'admin-governance@contoso.com';

        // Valid domain passes
        const validRecipient = resolveAndValidateRecipient('auditor@contoso.com');
        assert.equal(validRecipient, 'auditor@contoso.com');

        const validAeRecipient = resolveAndValidateRecipient('cfo@contoso.ae');
        assert.equal(validAeRecipient, 'cfo@contoso.ae');

        // External unapproved domain falls back to admin email
        const fallbackRecipient = resolveAndValidateRecipient('attacker@external-domain.org');
        assert.equal(fallbackRecipient, 'admin-governance@contoso.com');

        process.env.ALLOWED_UPLOADER_EMAIL_DOMAINS = prevDomains || '';
        process.env.FINCHAT_ADMIN_EMAIL = prevAdmin || '';
    });

    await t.test('2. Dual Links: Formats both SharePoint Web URL and Read-Only Blob SAS URL', () => {
        const email = formatConflictEmailNotification({ conflict: mockConflict, token });

        assert.ok(email.textBody.includes('DOCUMENT SOURCE ACCESS (DUAL LINKS):'));
        assert.ok(email.textBody.includes('https://contoso.sharepoint.com/sites/finance/Master_Q1_2026.xlsx'));
        assert.ok(email.textBody.includes('.blob.core.windows.net/'));
        assert.ok(email.textBody.includes('sp=r')); // read-only SAS param

        // Check HTML version
        assert.ok(email.htmlBody.includes('View on SharePoint Web'));
        assert.ok(email.htmlBody.includes('View Read-Only Blob (72h Access)'));
    });

    await t.test('3. Figures-Lost Disclosure: Explicitly states what is lost in both options', () => {
        const email = formatConflictEmailNotification({ conflict: mockConflict, token });

        assert.ok(email.textBody.includes('FIGURES LOST DISCLOSURE:'));
        assert.ok(email.textBody.includes('Option A (Retain Existing Fact)'));
        assert.ok(email.textBody.includes('Option B (Accept Incoming Fact)'));
        assert.ok(email.textBody.includes('superseded in financial reporting'));

        // Check HTML version
        assert.ok(email.htmlBody.includes('Figures Lost Disclosure'));
    });

    await t.test('4. Sender Mailbox: Uses CONFLICT_MAILBOX_SENDER in mail dispatch', async () => {
        const prevSender = process.env.CONFLICT_MAILBOX_SENDER;
        process.env.CONFLICT_MAILBOX_SENDER = 'finance-notifications@contoso.com';

        let capturedMail = null;
        const mockMailClient = {
            sendMail: async (mailOpts) => {
                capturedMail = mailOpts;
                return { messageId: 'msg-12345' };
            }
        };

        const mockPool = {
            connected: true,
            request: () => ({
                input: () => mockPool.request(),
                query: async () => ({ rowsAffected: [1] })
            })
        };
        setPool(mockPool);

        const res = await sendConflictNotification({
            conflict: mockConflict,
            token,
            recipientEmail: 'analyst@contoso.com',
            mailClient: mockMailClient
        });

        assert.equal(res.success, true);
        assert.ok(capturedMail);
        assert.equal(capturedMail.from, 'finance-notifications@contoso.com');
        assert.equal(capturedMail.to, 'analyst@contoso.com');
        assert.ok(capturedMail.subject.includes('Action Required: Financial Fact Conflict'));

        process.env.CONFLICT_MAILBOX_SENDER = prevSender || '';
        resetPool();
    });
});

