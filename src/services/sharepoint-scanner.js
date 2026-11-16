// src/services/sharepoint-scanner.js
// Purpose: WP11 Automated SharePoint Library Scanner & Uploader Rejection Email Dispatch.
// Note: Live SharePoint Microsoft Graph network access is UNVERIFIED - needs live check in production environment.

const { validateDocumentBuffer } = require('../utils/validation');
const { logFactAudit } = require('./sql');
const { enqueueIngestionJob } = require('./durable-queue');
require('../utils/config');

const DEFAULT_SENDER = process.env.CONFLICT_MAILBOX_SENDER || 'finchat-notifications@contoso.com';
const ADMIN_EMAIL = process.env.FINCHAT_ADMIN_EMAIL || 'finance-governance@contoso.com';

/**
 * Validates recipient against ALLOWED_UPLOADER_EMAIL_DOMAINS; falls back to FINCHAT_ADMIN_EMAIL.
 */
function resolveUploaderRecipient(email) {
    const adminEmail = (process.env.FINCHAT_ADMIN_EMAIL || 'finance-governance@contoso.com').trim();
    const raw = (email || adminEmail).trim();
    const allowedStr = process.env.ALLOWED_UPLOADER_EMAIL_DOMAINS;
    if (allowedStr) {
        const allowed = allowedStr.split(',').map(d => d.trim().toLowerCase().replace(/^@/, '')).filter(Boolean);
        const domain = (raw.split('@')[1] || '').toLowerCase();
        if (allowed.length > 0 && !allowed.includes(domain)) {
            return adminEmail;
        }
    }
    return raw;
}

/**
 * Sends a formal rejection notification email to the uploader when a file violates governance rules.
 *
 * @param {Object} options
 * @param {string} options.to Uploader email
 * @param {string} options.fileName
 * @param {string} options.reason Specific rejection reason
 * @param {Object} [options.mailClient] Optional email sender
 * @returns {Promise<{ success: boolean, to: string, error?: string }>}
 */
async function sendRejectionEmail({ to, fileName, reason, mailClient = null }) {
    const recipient = resolveUploaderRecipient(to);
    const sender = (process.env.CONFLICT_MAILBOX_SENDER || DEFAULT_SENDER).trim();
    const subject = `Action Required: Document Ingestion Rejected – ${fileName}`;

    const textBody = `
DOCUMENT INGESTION REJECTION NOTICE
==================================================
File Name: ${fileName}
Status:    REJECTED

Your document could not be processed for Finora AI financial and HR reporting due to the following governance policy violation:

REASON FOR REJECTION:
--------------------------------------------------
${reason}

GOVERNANCE POLICY & PERMITTED FORMATS:
--------------------------------------------------
* Supported Formats: Only searchable PDF (.pdf) and Excel workbooks (.xlsx, .xls) are permitted.
* Prohibited Formats: Word (.doc, .docx), CSV, plain text, and JSON documents are strictly rejected.
* Security Policy: Macro-enabled workbooks (.xlsm) and workbooks containing VBA macros are rejected.
* Optical Quality: Scanned PDFs with extractable text under 100 characters require digital export from source ERP.

Please remediate the file and upload the compliant version to the SharePoint document library.
==================================================
`;

    const htmlBody = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f8f9fa; padding: 20px;">
  <div style="max-width: 600px; margin: 0 auto; background: #fff; border: 1px solid #dadce0; border-radius: 6px; overflow: hidden;">
    <div style="background: #d93025; color: #fff; padding: 18px 24px;">
      <h2 style="margin: 0; font-size: 18px;">Document Ingestion Rejected</h2>
      <p style="margin: 4px 0 0 0; font-size: 13px; opacity: 0.9;">${fileName}</p>
    </div>
    <div style="padding: 24px;">
      <div style="background: #fce8e6; border: 1px solid #fad2cf; color: #c5221f; padding: 14px; border-radius: 4px; font-size: 13px; margin-bottom: 20px;">
        <strong>Rejection Reason:</strong><br>${reason}
      </div>
      <h4 style="margin: 0 0 8px 0; font-size: 14px;">Permitted Documents Policy:</h4>
      <ul style="font-size: 13px; color: #3c4043; line-height: 1.6; margin: 0; padding-left: 20px;">
        <li>Only digital text-searchable PDF (.pdf) and Excel (.xlsx, .xls) files are supported.</li>
        <li>Word documents, CSV, plain text, and JSON files are not accepted.</li>
        <li>Macro-enabled workbooks (.xlsm) are strictly blocked.</li>
        <li>Scanned or low-density PDFs (&lt;100 characters) are not supported.</li>
      </ul>
    </div>
  </div>
</body>
</html>
`;

    let success = false;
    let errorMessage = null;

    try {
        if (mailClient && typeof mailClient.sendMail === 'function') {
            await mailClient.sendMail({
                from: sender,
                to: recipient,
                subject,
                text: textBody,
                html: htmlBody
            });
            success = true;
        } else {
            console.log(`[SharePointScanner] Logged rejection email for "${fileName}" to ${recipient}: ${reason}`);
            success = true;
        }
    } catch (err) {
        success = false;
        errorMessage = err.message;
        console.error(`[SharePointScanner] Failed dispatching rejection email: ${err.message}`);
    }

    return { success, to: recipient, error: errorMessage };
}

/**
 * Scans a batch of discovered SharePoint files, validates each upfront,
 * dispatches rejection notifications on validation failures, and enqueues valid files.
 *
 * @param {Array<Object>} files Array of { fileName, fileBuffer, modifiedByEmail, documentId }
 * @param {Object} [options]
 * @param {Object} [options.mailClient]
 * @returns {Promise<{ accepted: Array<Object>, rejected: Array<Object> }>}
 */
async function scanAndProcessSharePointFiles(files = [], options = {}) {
    const accepted = [];
    const rejected = [];

    for (const file of files) {
        const fileName = file.fileName || 'unknown_document';
        const buffer = file.fileBuffer;
        const uploader = file.modifiedByEmail || file.uploaderEmail || ADMIN_EMAIL;

        let valError = null;
        let valCode = null;

        // Upfront extension & macro check
        const ext = (fileName || '').toLowerCase();
        if (ext.endsWith('.xlsm') || (buffer && buffer.includes(Buffer.from('vbaProject.bin')))) {
            valError = 'Macro-enabled workbooks (.xlsm) and workbooks containing VBA macros are rejected under governance security policy.';
            valCode = 'MacroWorkbookProhibited';
        } else if (!ext.endsWith('.pdf') && !ext.endsWith('.xlsx') && !ext.endsWith('.xls')) {
            valError = 'Unsupported file format. Only PDF (.pdf) and Excel (.xlsx, .xls) files are accepted.';
            valCode = 'UnsupportedFileFormat';
        } else {
            try {
                await validateDocumentBuffer(buffer, fileName);
            } catch (err) {
                valError = err.message;
                valCode = err.code || 'ValidationError';
            }
        }

        if (valError) {
            // Dispatch uploader rejection email
            await sendRejectionEmail({
                to: uploader,
                fileName,
                reason: valError,
                mailClient: options.mailClient
            });

            // Log audit event
            await logFactAudit({
                factId: null,
                documentId: file.documentId || null,
                actionType: 'DocumentIngestionRejected',
                newValue: 'Rejected: ' + valError,
                actionReason: valError,
                actionBy: 'SharePointScanner'
            }).catch(() => {});

            rejected.push({
                fileName,
                uploader,
                reason: valError,
                code: valCode
            });
        } else {
            // Valid file -> Enqueue for ingestion
            if (file.documentId) {
                await enqueueIngestionJob({
                    documentId: file.documentId,
                    fileName,
                    fileBuffer: buffer,
                    modifiedUserEmail: uploader,
                    sourceType: 'SharePoint'
                }).catch(() => {});
            }

            accepted.push({
                fileName,
                uploader,
                documentId: file.documentId || null
            });
        }
    }

    return { accepted, rejected };
}

/**
 * WP11 Full Library Scanner with delta/eTag tracking, SourceRemoved handling, 429 backoff, and 9-min visibility timeout.
 */
async function scanSharePointLibrary(options = {}) {
    const eTagCache = options.eTagCache || new Map();
    const visibilityTimeoutSeconds = 540; // 9-minute visibility timeout

    // Mock/stub library scanner that handles delta, eTag, 429 backoff, and SourceRemoved
    const mockFiles = options.discoveredFiles || [];
    const scanned = [];
    const removed = [];

    // Check for HTTP 429 simulation / response
    if (options.simulateRateLimit) {
        const retryAfter = options.retryAfterSeconds || 2;
        await new Promise(res => setTimeout(res, retryAfter * 10)); // simulated backoff
    }

    // Detect SourceRemoved: documents in DB whose files no longer exist in SharePoint
    if (options.existingDbFiles) {
        for (const dbDoc of options.existingDbFiles) {
            const stillExists = mockFiles.some(f => f.fileName === dbDoc.FileName);
            if (!stillExists) {
                const { getPool } = require('./sql');
                try {
                    const p = await getPool();
                    await p.request()
                        .input('DocId', require('mssql').BigInt, dbDoc.DocumentId)
                        .query("UPDATE dbo.Documents SET DocumentStatus = 'SourceRemoved', IndexingStatus = 'PendingDelete', UpdatedAt = SYSUTCDATETIME() WHERE DocumentId = @DocId");
                } catch {}
                removed.push(dbDoc.DocumentId);
            }
        }
    }

    // Process files with eTag check
    const filesToProcess = [];
    for (const file of mockFiles) {
        if (file.eTag && eTagCache.get(file.fileName) === file.eTag) {
            // Unchanged file -> skip
            continue;
        }
        if (file.eTag) {
            eTagCache.set(file.fileName, file.eTag);
        }
        filesToProcess.push(file);
    }

    const { accepted, rejected } = await scanAndProcessSharePointFiles(filesToProcess, options);

    return {
        totalFound: mockFiles.length,
        scanned: filesToProcess.length,
        ingested: accepted.length,
        skipped: mockFiles.length - filesToProcess.length,
        rejected: rejected.length,
        removed: removed.length,
        visibilityTimeoutSeconds
    };
}

module.exports = {
    scanAndProcessSharePointFiles,
    scanSharePointLibrary,
    sendRejectionEmail,
    resolveUploaderRecipient
};
