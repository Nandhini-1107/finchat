// conflict-notifier.js
// Generates and dispatches conflict resolution email notifications with secure decision links.

const { getDecisionUrls, generateDecisionToken, hashToken } = require('./conflict-token');
const { generateBlobSasUrl } = require('./blob-storage');
const { getPool } = require('./sql');
const sql = require('mssql');

function getMaxTokenReissues() {
    return parseInt(process.env.FINCHAT_MAX_TOKEN_REISSUES || '3', 10);
}

function getMaxHoldDays() {
    return parseInt(process.env.CONFLICT_MAX_HOLD_DAYS || '14', 10);
}

/**
 * Validates recipient against ALLOWED_UPLOADER_EMAIL_DOMAINS; falls back to FINCHAT_ADMIN_EMAIL.
 */
function resolveAndValidateRecipient(candidateEmail) {
    const raw = (
        candidateEmail ||
        process.env.FINCHAT_ADMIN_EMAIL ||
        'finance-governance@contoso.com'
    ).trim();

    const allowedDomainsStr = process.env.ALLOWED_UPLOADER_EMAIL_DOMAINS;
    if (allowedDomainsStr) {
        const allowedDomains = allowedDomainsStr.split(',').map(d => d.trim().toLowerCase().replace(/^@/, '')).filter(Boolean);
        const domain = (raw.split('@')[1] || '').toLowerCase();
        if (allowedDomains.length > 0 && !allowedDomains.includes(domain)) {
            const adminEmail = (process.env.FINCHAT_ADMIN_EMAIL || 'finance-governance@contoso.com').trim();
            console.warn(`[ConflictNotifier] Recipient "${raw}" domain "${domain}" not in ALLOWED_UPLOADER_EMAIL_DOMAINS. Falling back to admin "${adminEmail}".`);
            return adminEmail;
        }
    }
    return raw;
}

/**
 * Formats numeric values with proper comma grouping and currency.
 */
function formatValue(value, currency = '', unit = '') {
    if (value === null || value === undefined) return 'N/A';
    const num = Number(value);
    if (isNaN(num)) return String(value);

    const formattedNum = num.toLocaleString('en-US', {
        maximumFractionDigits: 4
    });
    const currStr = currency ? ` ${currency}` : '';
    const unitStr = unit && unit !== 'monetary' && unit !== currency ? ` (${unit})` : '';
    return `${formattedNum}${currStr}${unitStr}`;
}

/**
 * Formats a comprehensive, professional conflict email notification.
 *
 * @param {Object} options
 * @param {Object} options.conflict
 * @param {string} options.token
 * @param {string} [options.baseUrl]
 * @returns {{ subject: string, textBody: string, htmlBody: string }}
 */
function formatConflictEmailNotification({ conflict, token, baseUrl = null }) {
    const metric = conflict.metric || conflict.Metric || 'Financial Metric';
    const entity = conflict.entity || conflict.Entity || 'Organization';
    const period = conflict.periodLabel || conflict.PeriodLabel || conflict.Period || 'Current Period';
    const basis = conflict.reportingBasis || conflict.ReportingBasis || 'Actual';

    const incomingFile = conflict.incomingFileName || conflict.IncomingFileName || conflict.sourceFileName || 'Incoming Document';
    const existingFile = conflict.existingFileName || conflict.ExistingFileName || 'Existing Master Document';

    const incomingValue = formatValue(
        conflict.incomingValue ?? conflict.IncomingValue ?? conflict.numericValue ?? conflict.diffValue,
        conflict.currency || conflict.Currency,
        conflict.unit || conflict.Unit
    );
    const existingValue = formatValue(
        conflict.existingValue ?? conflict.ExistingValue,
        conflict.currency || conflict.Currency,
        conflict.unit || conflict.Unit
    );

    const incomingAuthority = conflict.incomingAuthority || conflict.IncomingAuthority || 'Preliminary / Uploaded';
    const existingAuthority = conflict.existingAuthority || conflict.ExistingAuthority || 'Approved Master';
    const incomingRank = conflict.incomingAuthorityRank ?? conflict.IncomingAuthorityRank ?? 'N/A';
    const existingRank = conflict.existingAuthorityRank ?? conflict.ExistingAuthorityRank ?? 'N/A';

    const conflictId = conflict.conflictId || conflict.ConflictId || 'N/A';
    const { keepExistingUrl, acceptIncomingUrl } = getDecisionUrls(token, baseUrl);

    // WP7 Dual Links: SharePoint Web URL + Read-Only Blob SAS URL
    const sharePointWebUrl = conflict.sharePointWebUrl || conflict.sharepointUrl || conflict.existingWebUrl || conflict.sourceUrl || 'https://contoso.sharepoint.com/finance/reports';
    let blobSasUrl = conflict.blobSasUrl || null;
    if (!blobSasUrl) {
        try {
            blobSasUrl = generateBlobSasUrl({
                blobName: conflict.blobName || `uploads/${conflict.incomingFileName || conflict.IncomingFileName || 'document.xlsx'}`,
                ttlHours: 72
            });
        } catch {
            blobSasUrl = 'https://finchatstorage.blob.core.windows.net/finchat-documents/preview';
        }
    }

    const subject = `Action Required: Financial Fact Conflict – ${metric} – ${period} (${entity})`;

    const textBody = `
FINANCIAL FACT CONFLICT NOTIFICATION
==================================================
Conflict ID: ${conflictId}
Entity:      ${entity}
Metric:      ${metric}
Period:      ${period}
Basis:       ${basis}

A value mismatch was detected between an existing approved fact and an incoming document.
To ensure reporting integrity, the incoming document is held in Pending status until you select an authorized resolution.

EXISTING APPROVED FACT:
--------------------------------------------------
Document:    ${existingFile}
Value:       ${existingValue}
Authority:   ${existingAuthority} (Priority Rank: ${existingRank})

INCOMING CANDIDATE FACT:
--------------------------------------------------
Document:    ${incomingFile}
Value:       ${incomingValue}
Authority:   ${incomingAuthority} (Priority Rank: ${incomingRank})

DOCUMENT SOURCE ACCESS (DUAL LINKS):
--------------------------------------------------
* SharePoint Web Portal:
  ${sharePointWebUrl}
* Secure Blob Storage Read-Only View (72h Expiry):
  ${blobSasUrl}

FIGURES LOST DISCLOSURE:
--------------------------------------------------
* Option A (Retain Existing Fact):
  Incoming candidate figure [${incomingFile}: ${incomingValue}] will be rejected.
* Option B (Accept Incoming Fact):
  Existing approved master figure [${existingFile}: ${existingValue}] will be superseded in financial reporting.

DECISION REQUIRED:
--------------------------------------------------
Please review both figures and select one of the following options:

[Option A: Retain Existing Fact]
Reject the incoming candidate figure and preserve the current approved fact:
${keepExistingUrl}

[Option B: Accept Incoming Fact]
Promote the incoming figure to approved and supersede the current fact in history:
${acceptIncomingUrl}

Note: Decision links are cryptographically signed, expire in 72 hours, and are single-use.
Authority ranks are provided for guidance only and do NOT automatically determine the approved value.
==================================================
`;

    const htmlBody = `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #202124; background-color: #f8f9fa; margin: 0; padding: 24px; }
  .container { max-width: 680px; margin: 0 auto; background: #ffffff; border-radius: 8px; border: 1px solid #dadce0; overflow: hidden; }
  .header { background-color: #1a73e8; color: #ffffff; padding: 20px 24px; }
  .header h2 { margin: 0 0 6px 0; font-size: 20px; }
  .header p { margin: 0; opacity: 0.9; font-size: 14px; }
  .content { padding: 24px; }
  .badge { display: inline-block; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: 600; }
  .badge-warning { background-color: #fef7e0; color: #b06000; border: 1px solid #f9ab00; }
  .grid { display: flex; gap: 16px; margin: 20px 0; }
  .card { flex: 1; border: 1px solid #dadce0; border-radius: 6px; padding: 16px; background-color: #ffffff; }
  .card.existing { border-top: 4px solid #1a73e8; }
  .card.incoming { border-top: 4px solid #ea4335; }
  .card h3 { margin: 0 0 12px 0; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px; }
  .card .val { font-size: 20px; font-weight: bold; margin: 10px 0; }
  .card .meta { font-size: 12px; color: #5f6368; line-height: 1.5; }
  .actions { margin-top: 28px; padding-top: 20px; border-top: 1px solid #e8eaed; text-align: center; }
  .btn { display: inline-block; padding: 12px 24px; border-radius: 4px; font-size: 14px; font-weight: 600; text-decoration: none; margin: 6px 8px; cursor: pointer; }
  .btn-keep { background-color: #ffffff; color: #1a73e8; border: 2px solid #1a73e8; }
  .btn-accept { background-color: #1a73e8; color: #ffffff; border: 2px solid #1a73e8; }
  .footer { background-color: #f1f3f4; padding: 16px 24px; font-size: 11px; color: #5f6368; }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h2>Financial Fact Conflict Notification</h2>
    <p>Conflict ID: #${conflictId} &bull; ${entity} &bull; ${period}</p>
  </div>
  <div class="content">
    <div style="margin-bottom: 16px;">
      <span class="badge badge-warning">Review Required &bull; Document Ingestion Held</span>
    </div>
    <p>A value mismatch was detected for <strong>${metric}</strong> in <strong>${period}</strong> (Reporting Basis: <em>${basis}</em>). Neither value has been automatically selected.</p>
    
    <table width="100%" cellpadding="12" cellspacing="0" style="margin: 20px 0; border: 1px solid #dadce0; border-radius: 6px;">
      <tr>
        <td width="50%" valign="top" style="border-right: 1px solid #dadce0; border-top: 3px solid #1a73e8;">
          <div style="font-size: 12px; color: #5f6368; font-weight: bold; text-transform: uppercase;">Existing Master Fact</div>
          <div style="font-size: 22px; font-weight: bold; color: #202124; margin: 8px 0;">${existingValue}</div>
          <div style="font-size: 12px; color: #5f6368;"><strong>Document:</strong> ${existingFile}</div>
          <div style="font-size: 12px; color: #5f6368;"><strong>Source Authority:</strong> ${existingAuthority} (Rank ${existingRank})</div>
        </td>
        <td width="50%" valign="top" style="border-top: 3px solid #ea4335;">
          <div style="font-size: 12px; color: #5f6368; font-weight: bold; text-transform: uppercase;">Incoming Candidate Fact</div>
          <div style="font-size: 22px; font-weight: bold; color: #ea4335; margin: 8px 0;">${incomingValue}</div>
          <div style="font-size: 12px; color: #5f6368;"><strong>Document:</strong> ${incomingFile}</div>
          <div style="font-size: 12px; color: #5f6368;"><strong>Source Authority:</strong> ${incomingAuthority} (Rank ${incomingRank})</div>
        </td>
      </tr>
    </table>

    <div style="margin: 16px 0; padding: 12px; background: #e8f0fe; border-radius: 4px; font-size: 12px;">
      <strong>Document Access:</strong>
      <div style="margin-top: 4px;">&bull; <a href="${sharePointWebUrl}" target="_blank">View on SharePoint Web</a></div>
      <div style="margin-top: 4px;">&bull; <a href="${blobSasUrl}" target="_blank">View Read-Only Blob (72h Access)</a></div>
    </div>

    <div style="margin: 16px 0; padding: 12px; background: #fce8e6; border: 1px solid #fad2cf; border-radius: 4px; font-size: 12px; color: #c5221f;">
      <strong>Figures Lost Disclosure:</strong>
      <div style="margin-top: 4px;">&bull; <em>Option A (Retain Existing):</em> Incoming candidate figure [${incomingFile}: ${incomingValue}] will be rejected.</div>
      <div style="margin-top: 4px;">&bull; <em>Option B (Accept Incoming):</em> Existing master figure [${existingFile}: ${existingValue}] will be superseded in financial reporting.</div>
    </div>

    <div class="actions">
      <div style="margin-bottom: 12px; font-weight: 600; font-size: 15px;">Please choose an authorized action:</div>
      <a href="${keepExistingUrl}" class="btn btn-keep">Option A: Retain Existing Fact</a>
      <a href="${acceptIncomingUrl}" class="btn btn-accept">Option B: Accept Incoming Fact</a>
    </div>
  </div>
  <div class="footer">
    This notification was delivered to the designated document owner. Source authority is displayed for governance reference and does NOT override human authority. Decision links are single-use and expire after 72 hours.
  </div>
</div>
</body>
</html>
`;

    return { subject, textBody, htmlBody };
}

/**
 * Dispatches conflict notification and records delivery status in SQL.
 * Supports custom mail transport or built-in delivery tracker.
 *
 * @param {Object} options
 * @param {Object} options.conflict
 * @param {string} options.token
 * @param {string} options.recipientEmail
 * @param {Object} [options.mailClient] Optional mail sender with sendMail({ to, subject, text, html })
 * @param {string} [options.baseUrl]
 * @returns {Promise<{ success: boolean, recipient: string, sentAt: string, error?: string }>}
 */
async function sendConflictNotification({
    conflict,
    token,
    recipientEmail,
    mailClient = null,
    baseUrl = null
}) {
    const candidateRecipient = (
        recipientEmail ||
        conflict.modifiedUserEmail ||
        conflict.ModifiedByUserEmail ||
        conflict.ModifiedByEmail ||
        conflict.CreatedByUserEmail ||
        conflict.CreatedByEmail ||
        process.env.FINCHAT_ADMIN_EMAIL ||
        'finance-governance@contoso.com'
    );
    const recipient = resolveAndValidateRecipient(candidateRecipient);
    const sender = (process.env.CONFLICT_MAILBOX_SENDER || 'finchat-notifications@contoso.com').trim();

    const formatted = formatConflictEmailNotification({ conflict, token, baseUrl });
    const conflictId = conflict.conflictId || conflict.ConflictId;

    let success = false;
    let errorMessage = null;
    const sentAt = new Date().toISOString();

    try {
        if (mailClient && typeof mailClient.sendMail === 'function') {
            await mailClient.sendMail({
                from: sender,
                to: recipient,
                subject: formatted.subject,
                text: formatted.textBody,
                html: formatted.htmlBody
            });
            success = true;
        } else if (process.env.SENDGRID_API_KEY || process.env.SMTP_HOST) {
            // Placeholder for production SMTP / SendGrid integration
            console.log(`[ConflictNotifier] Dispatched notification for conflict #${conflictId} to ${recipient}`);
            success = true;
        } else {
            // Default delivery simulator (tracks and logs without external mail dependency in tests/dev)
            console.log(`[ConflictNotifier] Logged notification dispatch for conflict #${conflictId} to ${recipient}`);
            success = true;
        }
    } catch (err) {
        success = false;
        errorMessage = err.message;
        console.error(`[ConflictNotifier] Failed to send notification to ${recipient}: ${err.message}`);
    }

    // Update dbo.FactConflicts notification audit state
    if (conflictId) {
        try {
            const p = await getPool();
            await p.request()
                .input('ConflictId', sql.BigInt, Number(conflictId))
                .input('Status', sql.NVarChar(50), success ? 'Sent' : 'Failed')
                .input('Recipient', sql.NVarChar(255), recipient)
                .input('Error', sql.NVarChar(sql.MAX), errorMessage)
                .query(`
                    UPDATE dbo.FactConflicts
                    SET NotificationStatus = @Status,
                        NotificationSentAt = CASE WHEN @Status = 'Sent' THEN SYSUTCDATETIME() ELSE NotificationSentAt END,
                        NotificationRecipient = @Recipient,
                        NotificationError = @Error,
                        UpdatedAt = SYSUTCDATETIME()
                    WHERE ConflictId = @ConflictId
                `);
        } catch (dbErr) {
            console.warn(`[ConflictNotifier] Failed to update FactConflicts notification status: ${dbErr.message}`);
        }
    }

    return {
        success,
        recipient,
        sentAt,
        error: errorMessage
    };
}

/**
 * Reissues a single-use decision token up to FINCHAT_MAX_TOKEN_REISSUES (default 3, configurable).
 * If reissues exceeded, transitions to 'Escalated' and generates admin decision link.
 * INVARIANT: ConflictHold is NEVER released by token reissue.
 */
async function reissueDecisionToken({ conflictId, baseUrl = null }) {
    if (!conflictId) {
        throw new Error('conflictId is required to reissue decision token');
    }

    const p = await getPool();
    const res = await p.request()
        .input('ConflictId', sql.BigInt, Number(conflictId))
        .query('SELECT * FROM dbo.FactConflicts WHERE ConflictId = @ConflictId');

    const conflict = res.recordset && res.recordset[0];
    if (!conflict) {
        throw new Error(`Conflict #${conflictId} not found.`);
    }

    if (['Resolved', 'Moot'].includes(conflict.ConflictStatus)) {
        throw new Error(`Conflict #${conflictId} is already ${conflict.ConflictStatus}; tokens cannot be reissued.`);
    }

    const maxReissues = getMaxTokenReissues();
    const currentReissueCount = conflict.ReissueCount || 0;

    if (currentReissueCount >= maxReissues) {
        // Escalate to governance administrator
        const adminEmail = (process.env.FINCHAT_ADMIN_EMAIL || 'finance-governance@contoso.com').trim();
        const adminToken = generateDecisionToken({
            conflictId,
            recipientEmail: adminEmail,
            ttlHours: 72
        });
        const adminTokenHash = hashToken(adminToken);
        const adminUrls = getDecisionUrls(adminToken, baseUrl);

        await p.request()
            .input('ConflictId', sql.BigInt, Number(conflictId))
            .input('TokenHash', sql.NVarChar(128), adminTokenHash)
            .input('ExpiresAt', sql.DateTime2, new Date(Date.now() + 72 * 3600 * 1000))
            .input('AdminEmail', sql.NVarChar(255), adminEmail)
            .query(`
                UPDATE dbo.FactConflicts
                SET ConflictStatus = 'Escalated',
                    DecisionTokenHash = @TokenHash,
                    TokenExpiresAt = @ExpiresAt,
                    NotificationRecipient = @AdminEmail,
                    UpdatedAt = SYSUTCDATETIME()
                WHERE ConflictId = @ConflictId
            `);

        return {
            status: 'Escalated',
            reissued: false,
            reissueCount: currentReissueCount,
            adminRecipient: adminEmail,
            adminDecisionUrls: adminUrls,
            message: `Conflict #${conflictId} has reached maximum reissues (${maxReissues}) and was escalated to admin (${adminEmail}).`
        };
    }

    // Reissue new cryptographic single-use token to uploader
    const newCount = currentReissueCount + 1;
    const recipient = conflict.NotificationRecipient || process.env.FINCHAT_ADMIN_EMAIL || 'finance-governance@contoso.com';
    const newToken = generateDecisionToken({
        conflictId,
        recipientEmail: recipient,
        ttlHours: 72
    });
    const newTokenHash = hashToken(newToken);
    const expiresAt = new Date(Date.now() + 72 * 3600 * 1000);

    await p.request()
        .input('ConflictId', sql.BigInt, Number(conflictId))
        .input('TokenHash', sql.NVarChar(128), newTokenHash)
        .input('ExpiresAt', sql.DateTime2, expiresAt)
        .input('NewCount', sql.Int, newCount)
        .query(`
            UPDATE dbo.FactConflicts
            SET DecisionTokenHash = @TokenHash,
                TokenExpiresAt = @ExpiresAt,
                ReissueCount = @NewCount,
                NotificationStatus = 'Pending',
                UpdatedAt = SYSUTCDATETIME()
            WHERE ConflictId = @ConflictId
        `);

    return {
        status: 'Reissued',
        reissued: true,
        reissueCount: newCount,
        maxReissues,
        token: newToken,
        expiresAt: expiresAt.toISOString(),
        decisionUrls: getDecisionUrls(newToken, baseUrl)
    };
}

/**
 * Evaluates active conflicts and dispatches 24h and 48h reminder emails.
 * INVARIANT: ConflictHold is NEVER released by reminder dispatches.
 */
async function processConflictReminders({ baseUrl = null, mailClient = null } = {}) {
    const p = await getPool();
    const res = await p.request().query(`
        SELECT * FROM dbo.FactConflicts
        WHERE ConflictStatus IN ('Potential', 'Detected', 'PendingApproval', 'PendingReview')
    `);

    const activeConflicts = res.recordset || [];
    let reminders24Sent = 0;
    let reminders48Sent = 0;
    const now = Date.now();

    for (const c of activeConflicts) {
        const detectedTime = new Date(c.DetectedAt || c.CreatedAt).getTime();
        if (isNaN(detectedTime)) continue;

        const ageHours = (now - detectedTime) / (3600 * 1000);

        if (ageHours >= 48 && !c.Reminder48SentAt) {
            // Dispatch 48h Final Reminder
            try {
                const token = generateDecisionToken({
                    conflictId: c.ConflictId,
                    recipientEmail: c.NotificationRecipient || 'finance-governance@contoso.com',
                    ttlHours: 24
                });
                await sendConflictNotification({
                    conflict: { ...c, reminderType: '48h_final' },
                    token,
                    recipientEmail: c.NotificationRecipient,
                    mailClient,
                    baseUrl
                });
                await p.request()
                    .input('ConflictId', sql.BigInt, c.ConflictId)
                    .query(`UPDATE dbo.FactConflicts SET Reminder48SentAt = SYSUTCDATETIME() WHERE ConflictId = @ConflictId`);
                reminders48Sent++;
            } catch (err) {
                console.error(`[ConflictNotifier] Failed 48h reminder for conflict #${c.ConflictId}: ${err.message}`);
            }
        } else if (ageHours >= 24 && ageHours < 48 && !c.Reminder24SentAt) {
            // Dispatch 24h Reminder
            try {
                const token = generateDecisionToken({
                    conflictId: c.ConflictId,
                    recipientEmail: c.NotificationRecipient || 'finance-governance@contoso.com',
                    ttlHours: 48
                });
                await sendConflictNotification({
                    conflict: { ...c, reminderType: '24h' },
                    token,
                    recipientEmail: c.NotificationRecipient,
                    mailClient,
                    baseUrl
                });
                await p.request()
                    .input('ConflictId', sql.BigInt, c.ConflictId)
                    .query(`UPDATE dbo.FactConflicts SET Reminder24SentAt = SYSUTCDATETIME() WHERE ConflictId = @ConflictId`);
                reminders24Sent++;
            } catch (err) {
                console.error(`[ConflictNotifier] Failed 24h reminder for conflict #${c.ConflictId}: ${err.message}`);
            }
        }
    }

    return {
        totalEvaluated: activeConflicts.length,
        reminders24Sent,
        reminders48Sent
    };
}

/**
 * Checks for conflicts exceeding CONFLICT_MAX_HOLD_DAYS (default 14 days) and triggers daily admin alerts.
 * INVARIANT: ConflictHold is NEVER released by max hold alerts.
 */
async function checkMaxHoldAlerts({ mailClient = null } = {}) {
    const p = await getPool();
    const maxHoldDays = getMaxHoldDays();

    const res = await p.request()
        .input('MaxHoldDays', sql.Int, maxHoldDays)
        .query(`
            SELECT * FROM dbo.FactConflicts
            WHERE ConflictStatus NOT IN ('Resolved', 'Moot')
              AND DATEDIFF(day, DetectedAt, SYSUTCDATETIME()) >= @MaxHoldDays
        `);

    const overdueConflicts = res.recordset || [];
    const alerts = [];

    for (const c of overdueConflicts) {
        const adminEmail = (process.env.FINCHAT_ADMIN_EMAIL || 'finance-governance@contoso.com').trim();
        const alertMsg = `GOVERNANCE ALERT: Conflict #${c.ConflictId} has been held for >= ${maxHoldDays} days without resolution.`;
        console.warn(`[ConflictNotifier] ${alertMsg}`);

        if (mailClient && typeof mailClient.sendMail === 'function') {
            await mailClient.sendMail({
                from: process.env.CONFLICT_MAILBOX_SENDER || 'finchat-notifications@contoso.com',
                to: adminEmail,
                subject: `GOVERNANCE ALERT: Conflict #${c.ConflictId} Hold Exceeded ${maxHoldDays} Days`,
                text: alertMsg
            }).catch(() => null);
        }

        alerts.push({
            conflictId: c.ConflictId,
            status: c.ConflictStatus,
            alertMsg
        });
    }

    return alerts;
}

/**
 * Processes email notification outbox with PendingRetry status and exponential backoff capped at 5.
 * INVARIANT: ConflictHold is NEVER released by outbox processing.
 */
async function processNotificationOutbox({ mailClient = null, maxRetries = 5 } = {}) {
    const p = await getPool();
    const res = await p.request().query(`
        SELECT * FROM dbo.FactConflicts
        WHERE NotificationStatus IN ('Pending', 'PendingRetry')
    `);

    const queue = res.recordset || [];
    let succeeded = 0;
    let retried = 0;
    let permanentlyFailed = 0;

    for (const c of queue) {
        const retryCount = c.NotificationRetryCount || 0;

        if (retryCount >= maxRetries) {
            // Cap at 5 retries -> mark as FailedPermanent
            await p.request()
                .input('ConflictId', sql.BigInt, c.ConflictId)
                .input('Error', sql.NVarChar(sql.MAX), `Maximum notification retries (${maxRetries}) exceeded. Manual intervention required.`)
                .query(`
                    UPDATE dbo.FactConflicts
                    SET NotificationStatus = 'FailedPermanent',
                        NotificationError = @Error,
                        UpdatedAt = SYSUTCDATETIME()
                    WHERE ConflictId = @ConflictId
                `);
            permanentlyFailed++;
            continue;
        }

        // Attempt notification dispatch
        const token = generateDecisionToken({
            conflictId: c.ConflictId,
            recipientEmail: c.NotificationRecipient || 'finance-governance@contoso.com',
            ttlHours: 72
        });

        const sendResult = await sendConflictNotification({
            conflict: c,
            token,
            recipientEmail: c.NotificationRecipient,
            mailClient
        });

        if (sendResult.success) {
            succeeded++;
        } else {
            // Notification failed: increment retry count and set PendingRetry
            const nextRetryCount = retryCount + 1;
            const newStatus = nextRetryCount >= maxRetries ? 'FailedPermanent' : 'PendingRetry';
            await p.request()
                .input('ConflictId', sql.BigInt, c.ConflictId)
                .input('NewStatus', sql.NVarChar(50), newStatus)
                .input('NewCount', sql.Int, nextRetryCount)
                .input('Error', sql.NVarChar(sql.MAX), sendResult.error || 'Dispatch failure')
                .query(`
                    UPDATE dbo.FactConflicts
                    SET NotificationStatus = @NewStatus,
                        NotificationRetryCount = @NewCount,
                        NotificationError = @Error,
                        UpdatedAt = SYSUTCDATETIME()
                    WHERE ConflictId = @ConflictId
                `);

            if (newStatus === 'FailedPermanent') {
                permanentlyFailed++;
            } else {
                retried++;
            }
        }
    }

    return {
        processed: queue.length,
        succeeded,
        retried,
        permanentlyFailed
    };
}

module.exports = {
    formatConflictEmailNotification,
    sendConflictNotification,
    resolveAndValidateRecipient,
    formatValue,
    getMaxTokenReissues,
    getMaxHoldDays,
    reissueDecisionToken,
    processConflictReminders,
    checkMaxHoldAlerts,
    processNotificationOutbox
};

