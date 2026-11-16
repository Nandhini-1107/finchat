// tests/wp11-sharepoint-scanner.test.js
// Test Suite for WP11: SharePoint Scanner & Uploader Rejection Emails

const test = require('node:test');
const assert = require('node:assert/strict');
const xlsx = require('xlsx');

const {
    scanAndProcessSharePointFiles,
    sendRejectionEmail,
    resolveUploaderRecipient
} = require('../../../src/services/sharepoint-scanner');

const { setPool, resetPool } = require('../../../src/services/sql');

test('WP11: SharePoint Scanner & Uploader Rejection Emails', async (t) => {

    await t.test('1. Upfront Format Rejection: Rejects Word, CSV and dispatches rejection email', async () => {
        let sentEmail = null;
        const mockMailClient = {
            sendMail: async (mailOpts) => {
                sentEmail = mailOpts;
                return { messageId: 'msg-rejected-1' };
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

        const files = [
            {
                fileName: 'Q1_Financial_Summary.docx',
                fileBuffer: Buffer.from('WORD_MOCK_DATA'),
                modifiedByEmail: 'analyst@contoso.com',
                documentId: 201
            },
            {
                fileName: 'Transactions_Export.csv',
                fileBuffer: Buffer.from('Date,Amount,Metric\n2026-01-01,1000,Revenue'),
                modifiedByEmail: 'analyst@contoso.com',
                documentId: 202
            }
        ];

        const { accepted, rejected } = await scanAndProcessSharePointFiles(files, { mailClient: mockMailClient });
        assert.equal(accepted.length, 0);
        assert.equal(rejected.length, 2);
        assert.ok(rejected[0].reason.includes('Unsupported file format'));
        assert.ok(sentEmail);
        assert.equal(sentEmail.to, 'analyst@contoso.com');
        assert.ok(sentEmail.subject.includes('Document Ingestion Rejected'));
        assert.ok(sentEmail.text.toUpperCase().includes('PERMITTED FORMATS'));

        resetPool();
    });

    await t.test('2. Macro-Enabled Workbook Rejection: Rejects .xlsm and dispatches security policy warning', async () => {
        let sentEmail = null;
        const mockMailClient = {
            sendMail: async (mailOpts) => {
                sentEmail = mailOpts;
                return { messageId: 'msg-rejected-macro' };
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

        const macroFile = [
            {
                fileName: 'Contoso_Budget_FY2026.xlsm',
                fileBuffer: Buffer.from('MOCK_XLSM_WITH_VBA'),
                modifiedByEmail: 'finance-lead@contoso.com',
                documentId: 203
            }
        ];

        const { accepted, rejected } = await scanAndProcessSharePointFiles(macroFile, { mailClient: mockMailClient });
        assert.equal(accepted.length, 0);
        assert.equal(rejected.length, 1);
        assert.equal(rejected[0].code, 'MacroWorkbookProhibited');
        assert.ok(sentEmail.text.includes('Macro-enabled workbooks (.xlsm) and workbooks containing VBA macros are rejected'));

        resetPool();
    });

    await t.test('3. Valid PDF & Excel pass scanner and are accepted', async () => {
        const wb = xlsx.utils.book_new();
        const ws = xlsx.utils.aoa_to_sheet([['Metric', 'Amount'], ['Revenue', 50000]]);
        xlsx.utils.book_append_sheet(wb, ws, 'Financials');
        const validXlsxBuffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

        const validFiles = [
            {
                fileName: 'Contoso_Forecast_FY2026.xlsx',
                fileBuffer: validXlsxBuffer,
                modifiedByEmail: 'controller@contoso.com',
                documentId: 205
            }
        ];

        const { accepted, rejected } = await scanAndProcessSharePointFiles(validFiles);
        assert.equal(accepted.length, 1);
        assert.equal(rejected.length, 0);
    });

    await t.test('4. Recipient domain validation: Unapproved external domain falls back to admin email', () => {
        const prevDomains = process.env.ALLOWED_UPLOADER_EMAIL_DOMAINS;
        const prevAdmin = process.env.FINCHAT_ADMIN_EMAIL;

        process.env.ALLOWED_UPLOADER_EMAIL_DOMAINS = 'contoso.com,contoso.ae';
        process.env.FINCHAT_ADMIN_EMAIL = 'admin-governance@contoso.com';

        const approved = resolveUploaderRecipient('internal-user@contoso.com');
        assert.equal(approved, 'internal-user@contoso.com');

        const fallback = resolveUploaderRecipient('external-hacker@suspicious-domain.xyz');
        assert.equal(fallback, 'admin-governance@contoso.com');

        process.env.ALLOWED_UPLOADER_EMAIL_DOMAINS = prevDomains || '';
        process.env.FINCHAT_ADMIN_EMAIL = prevAdmin || '';
    });
});
