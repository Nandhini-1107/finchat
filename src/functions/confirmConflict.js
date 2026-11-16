// confirmConflict.js
// Azure Functions HTTP endpoint for human conflict approval and resolution.
// GET requests are strictly READ-ONLY review and preview operations (RFC 7231 / RFC 9110 Safe Methods).
// State mutations and conflict resolution decisions strictly require authenticated POST requests.

const { app } = require('@azure/functions');
const { verifyDecisionToken, hashToken } = require('../services/conflict-token');
const { getConflictById, resolveConflictDecisionTransaction, applyConflictDecision } = require('../services/sql');

/**
 * Standard enterprise HTTP security headers to prevent token leakage,
 * cache poisoning, clickjacking, and unauthorized frame embedding.
 */
const SECURITY_HEADERS = {
    'Cache-Control': 'no-store, no-cache, must-revalidate, private, max-age=0',
    'Pragma': 'no-cache',
    'Expires': '0',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'none'; frame-ancestors 'none';"
};

/**
 * Legitimate pending conflict states that are permitted to be resolved.
 */
const LEGITIMATE_PENDING_STATUSES = ['PendingApproval', 'PendingReview', 'Detected', 'Potential'];

/**
 * Sanitizes URLs to prevent token leakage in server and application logs.
 */
function sanitizeUrlForLogging(rawUrl) {
    if (!rawUrl) return '';
    return String(rawUrl).replace(/([?&]token=)[^&#]+/gi, '$1[REDACTED]');
}

/**
 * Escapes HTML characters to prevent XSS in rendered review pages.
 */
function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Formats numeric values with commas and precision.
 */
function formatNumber(val) {
    if (val === null || val === undefined) return 'N/A';
    const num = Number(val);
    if (isNaN(num)) return String(val);
    return num.toLocaleString('en-US', { maximumFractionDigits: 4 });
}

/**
 * Generates an interactive, responsive HTML review page for GET requests.
 * Allows human reviewers to inspect both facts side-by-side and execute a decision via POST.
 */
function generateReviewHtml({ conflict, token, recommendedAction = null }) {
    const conflictId = conflict.ConflictId || conflict.conflictId;
    const metric = conflict.ExistingMetric || conflict.IncomingMetric || conflict.Metric || 'Financial Metric';
    const entity = conflict.ExistingEntity || conflict.IncomingEntity || conflict.Entity || 'Organization';
    const period = conflict.ExistingPeriodLabel || conflict.IncomingPeriodLabel || conflict.Period || 'Current Period';
    const basis = conflict.ReportingBasis || 'Actual';

    const existingFile = conflict.ExistingFileName || 'Existing Master Document';
    const incomingFile = conflict.IncomingFileName || 'Incoming Staged Document';

    const existingVal = formatNumber(conflict.ExistingNormalizedValue ?? conflict.ExistingValue);
    const incomingVal = formatNumber(conflict.IncomingNormalizedValue ?? conflict.IncomingValue);
    const currency = conflict.ExistingCurrency || conflict.IncomingCurrency || conflict.Currency || '';
    const unit = conflict.ExistingUnit || conflict.IncomingUnit || conflict.Unit || '';

    const diffVal = conflict.DifferenceValue ? formatNumber(conflict.DifferenceValue) : 'N/A';
    const diffPct = conflict.DifferencePercentage ? `${conflict.DifferencePercentage}%` : 'N/A';

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Conflict Review #${conflictId} &bull; FinChat Financial Governance</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #f4f6f8; margin: 0; padding: 30px 15px; color: #202124; }
  .container { max-width: 760px; margin: 0 auto; background: #fff; border-radius: 8px; border: 1px solid #dadce0; box-shadow: 0 2px 6px rgba(0,0,0,0.06); overflow: hidden; }
  .header { background: #1a73e8; color: #fff; padding: 24px; text-align: center; }
  .header h1 { margin: 0 0 6px 0; font-size: 22px; font-weight: 600; }
  .header p { margin: 0; opacity: 0.9; font-size: 14px; }
  .badge { display: inline-block; background: #fef7e0; color: #b06000; border: 1px solid #f9ab00; padding: 4px 10px; border-radius: 12px; font-size: 12px; font-weight: 600; margin-top: 10px; }
  .content { padding: 24px 28px; }
  .meta-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; background: #f8f9fa; padding: 14px 18px; border-radius: 6px; margin-bottom: 24px; }
  .meta-item { display: flex; flex-direction: column; }
  .meta-label { font-size: 11px; text-transform: uppercase; color: #5f6368; font-weight: 700; }
  .meta-val { font-size: 14px; color: #202124; font-weight: 500; margin-top: 2px; }
  .comparison-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 20px; }
  @media (max-width: 600px) { .comparison-grid { grid-template-columns: 1fr; } }
  .fact-box { border: 1px solid #dadce0; border-radius: 6px; padding: 16px; position: relative; }
  .fact-box.existing { border-left: 4px solid #1a73e8; background: #fafcff; }
  .fact-box.incoming { border-left: 4px solid #e37400; background: #fffdfa; }
  .box-title { font-size: 13px; font-weight: 700; text-transform: uppercase; margin-bottom: 10px; }
  .existing .box-title { color: #1a73e8; }
  .incoming .box-title { color: #e37400; }
  .fact-val { font-size: 22px; font-weight: 700; color: #202124; margin-bottom: 8px; }
  .fact-unit { font-size: 13px; font-weight: normal; color: #5f6368; }
  .fact-detail { font-size: 12px; color: #3c4043; margin-top: 4px; }
  .variance-bar { background: #fce8e6; border: 1px solid #f5c2c7; color: #c5221f; padding: 10px 14px; border-radius: 6px; font-size: 13px; font-weight: 500; margin-bottom: 24px; text-align: center; }
  .form-section { background: #f8f9fa; border: 1px solid #e8eaed; border-radius: 6px; padding: 20px; margin-top: 10px; }
  .form-section h3 { margin: 0 0 12px 0; font-size: 15px; }
  .form-group { margin-bottom: 16px; }
  .form-group label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 6px; }
  .form-input { width: 100%; box-sizing: border-box; padding: 10px 12px; border: 1px solid #dadce0; border-radius: 4px; font-size: 13px; }
  .btn-group { display: flex; gap: 12px; }
  @media (max-width: 600px) { .btn-group { flex-direction: column; } }
  .btn { flex: 1; padding: 12px 18px; border: none; border-radius: 4px; font-size: 14px; font-weight: 600; cursor: pointer; text-align: center; transition: background 0.15s; }
  .btn-keep { background: #1a73e8; color: #fff; }
  .btn-keep:hover { background: #1765cc; }
  .btn-accept { background: #1e8e3e; color: #fff; }
  .btn-accept:hover { background: #187733; }
  .footer { background: #f1f3f4; padding: 14px 24px; font-size: 12px; color: #5f6368; text-align: center; }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>Conflict Review & Authorization</h1>
    <p>Conflict #${conflictId} &bull; Human Authorization Required</p>
    <div class="badge">Awaiting Authorized Review</div>
  </div>
  <div class="content">
    <div class="meta-grid">
      <div class="meta-item"><span class="meta-label">Metric</span><span class="meta-val">${escapeHtml(metric)}</span></div>
      <div class="meta-item"><span class="meta-label">Entity</span><span class="meta-val">${escapeHtml(entity)}</span></div>
      <div class="meta-item"><span class="meta-label">Period</span><span class="meta-val">${escapeHtml(period)}</span></div>
      <div class="meta-item"><span class="meta-label">Reporting Basis</span><span class="meta-val">${escapeHtml(basis)}</span></div>
    </div>

    <div class="comparison-grid">
      <div class="fact-box existing">
        <div class="box-title">Existing Approved Fact</div>
        <div class="fact-val">${existingVal} <span class="fact-unit">${escapeHtml(currency)} ${escapeHtml(unit)}</span></div>
        <div class="fact-detail"><strong>Document:</strong> ${escapeHtml(existingFile)}</div>
        <div class="fact-detail"><strong>Status:</strong> Approved in Master Store</div>
      </div>
      <div class="fact-box incoming">
        <div class="box-title">Incoming Candidate Fact</div>
        <div class="fact-val">${incomingVal} <span class="fact-unit">${escapeHtml(currency)} ${escapeHtml(unit)}</span></div>
        <div class="fact-detail"><strong>Document:</strong> ${escapeHtml(incomingFile)}</div>
        <div class="fact-detail"><strong>Status:</strong> Staged / Pending Approval</div>
      </div>
    </div>

    <div class="variance-bar">
      Variance: ${diffVal} ${escapeHtml(currency)} (${diffPct}) &bull; Conflicting values detected across sources
    </div>

    <div class="form-section">
      <h3>Select Authorized Action</h3>
      <p style="font-size: 13px; color: #5f6368; margin: 0 0 16px 0;">
        Review both figures above. Submitting this form issues an authenticated <strong>POST</strong> transaction to resolve the conflict. GET requests are strictly read-only.
      </p>

      <form method="POST" action="/api/confirmConflict">
        <input type="hidden" name="token" value="${escapeHtml(token)}">
        <div class="form-group">
          <label for="notes">Reviewer Justification / Audit Notes (Optional):</label>
          <input type="text" id="notes" name="notes" class="form-input" placeholder="e.g. Approved statutory revision per Board audit sign-off">
        </div>
        <div class="btn-group">
          <button type="submit" name="action" value="keep_existing" class="btn btn-keep">
            Option A: Retain Existing Fact (Reject Candidate)
          </button>
          <button type="submit" name="action" value="accept_incoming" class="btn btn-accept">
            Option B: Accept Incoming Fact (Supersede Existing)
          </button>
        </div>
      </form>
    </div>
  </div>
  <div class="footer">
    FinChat Financial Governance &bull; Single-Use Expiring Token Protected &bull; RFC 7231 Safe Review
  </div>
</div>
</body>
</html>`;
}

/**
 * Generates an informative page when a conflict has already been resolved.
 */
function generateAlreadyResolvedHtml({ conflictId, conflict }) {
    const status = conflict.ConflictStatus || conflict.ResolutionStatus || 'Resolved';
    const reviewer = conflict.ReviewedBy || 'Authorized Reviewer';
    const reviewedAt = conflict.ReviewedAt ? new Date(conflict.ReviewedAt).toUTCString() : 'Previously';

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Conflict Already Resolved &bull; FinChat</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #f8f9fa; margin: 0; padding: 40px 20px; color: #202124; }
  .card { max-width: 600px; margin: 0 auto; background: #fff; border-radius: 8px; border: 1px solid #dadce0; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
  .banner { background-color: #5f6368; color: #fff; padding: 24px; text-align: center; }
  .banner h1 { margin: 0 0 6px 0; font-size: 20px; }
  .body { padding: 24px; text-align: center; font-size: 14px; line-height: 1.6; }
  .badge { display: inline-block; padding: 6px 14px; border-radius: 4px; font-size: 13px; font-weight: bold; background: #e8f0fe; color: #1a73e8; margin-bottom: 12px; }
  .footer { background: #f1f3f4; padding: 14px 24px; font-size: 12px; color: #5f6368; text-align: center; }
</style>
</head>
<body>
<div class="card">
  <div class="banner">
    <h1>Conflict #${conflictId} Already Resolved</h1>
  </div>
  <div class="body">
    <div class="badge">Current Status: ${escapeHtml(status)}</div>
    <p>This conflict record was already resolved by <strong>${escapeHtml(reviewer)}</strong> on ${escapeHtml(reviewedAt)}.</p>
    <p style="color: #5f6368; font-size: 13px;">FinChat single-use decision tokens cannot be re-executed once a decision has been recorded.</p>
  </div>
  <div class="footer">
    FinChat Financial Governance &bull; Immutable Audit Trail
  </div>
</div>
</body>
</html>`;
}

/**
 * Generates an HTML response page upon successful decision execution via POST.
 */
function generateConfirmationHtml({ conflictId, action, status, metric, entity, period, message }) {
    const isKeep = action === 'keep_existing';
    const title = isKeep ? 'Decision Recorded: Existing Fact Retained' : 'Decision Recorded: Incoming Fact Accepted';
    const bannerColor = isKeep ? '#1a73e8' : '#1e8e3e';

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #f8f9fa; margin: 0; padding: 40px 20px; color: #202124; }
  .card { max-width: 600px; margin: 0 auto; background: #fff; border-radius: 8px; border: 1px solid #dadce0; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
  .banner { background-color: ${bannerColor}; color: #fff; padding: 24px; text-align: center; }
  .banner h1 { margin: 0 0 8px 0; font-size: 22px; }
  .banner p { margin: 0; opacity: 0.9; font-size: 14px; }
  .body { padding: 24px; }
  .field { margin-bottom: 12px; }
  .field-label { font-size: 12px; color: #5f6368; text-transform: uppercase; font-weight: bold; }
  .field-value { font-size: 16px; color: #202124; margin-top: 2px; }
  .status-badge { display: inline-block; padding: 4px 10px; border-radius: 4px; font-size: 12px; font-weight: bold; background: #e6f4ea; color: #137333; }
  .footer { background: #f1f3f4; padding: 16px 24px; font-size: 12px; color: #5f6368; text-align: center; }
</style>
</head>
<body>
<div class="card">
  <div class="banner">
    <h1>${title}</h1>
    <p>Conflict #${conflictId} has been successfully resolved</p>
  </div>
  <div class="body">
    <div class="field">
      <div class="field-label">Resolution Status</div>
      <div class="field-value"><span class="status-badge">${escapeHtml(status)}</span></div>
    </div>
    <div class="field">
      <div class="field-label">Subject Metric & Entity</div>
      <div class="field-value">${escapeHtml(metric || 'Financial Metric')} &bull; ${escapeHtml(entity || 'Company')} (${escapeHtml(period || 'Period')})</div>
    </div>
    <div class="field">
      <div class="field-label">Audit Note</div>
      <div class="field-value">${escapeHtml(message)}</div>
    </div>
    <p style="margin-top: 20px; font-size: 14px; color: #3c4043;">
      The financial facts repository and document ingestion status have been atomically updated in accordance with your authorized decision.
    </p>
  </div>
  <div class="footer">
    FinChat Financial Governance &bull; Single-Use Decision Token Executed
  </div>
</div>
</body>
</html>`;
}

/**
 * Generates an error HTML response.
 */
function generateErrorHtml({ title, message, status = 400 }) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Conflict Resolution Error</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #f8f9fa; margin: 0; padding: 40px 20px; color: #202124; }
  .card { max-width: 600px; margin: 0 auto; background: #fff; border-radius: 8px; border: 1px solid #dadce0; overflow: hidden; }
  .banner { background-color: #ea4335; color: #fff; padding: 24px; text-align: center; }
  .banner h1 { margin: 0 0 8px 0; font-size: 20px; }
  .body { padding: 24px; text-align: center; font-size: 15px; }
  .footer { background: #f1f3f4; padding: 16px 24px; font-size: 12px; color: #5f6368; text-align: center; }
</style>
</head>
<body>
<div class="card">
  <div class="banner">
    <h1>${escapeHtml(title)}</h1>
    <p>HTTP Error ${status}</p>
  </div>
  <div class="body">
    <p>${escapeHtml(message)}</p>
  </div>
  <div class="footer">
    FinChat Financial Governance
  </div>
</div>
</body>
</html>`;
}

const confirmConflictHandler = async (request, context) => {
    const correlationId = `confirm-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const sanitizedUrl = sanitizeUrlForLogging(request.url);
    context.log(`[${correlationId}] Conflict resolution request: Method=${request.method}, URL=${sanitizedUrl}`);

    let token = null;
    let action = null;
    let reviewer = null;
    let notes = null;

    // 1. Extract parameters from query string
    if (request.query) {
        for (const [key, val] of request.query.entries()) {
            const k = key.toLowerCase();
            if (k === 'token') token = val;
            else if (k === 'action' || k === 'decision') action = val;
            else if (k === 'reviewer' || k === 'user') reviewer = val;
            else if (k === 'notes' || k === 'reason') notes = val;
        }
    }

    // 2. Extract parameters from POST body if available (JSON or URL-encoded)
    if (request.method === 'POST') {
        const contentType = (request.headers.get('content-type') || '').toLowerCase();
        if (contentType.includes('application/json')) {
            try {
                const body = await request.json().catch(() => null);
                if (body && typeof body === 'object') {
                    if (body.token) token = body.token;
                    if (body.action) action = body.action;
                    if (body.decision) action = body.decision;
                    if (body.reviewer) reviewer = body.reviewer;
                    if (body.notes) notes = body.notes;
                }
            } catch {
                // Ignore JSON parsing failures
            }
        } else if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
            try {
                if (typeof request.formData === 'function') {
                    const formData = await request.formData();
                    if (formData.has('token')) token = formData.get('token');
                    if (formData.has('action')) action = formData.get('action');
                    if (formData.has('decision')) action = formData.get('decision');
                    if (formData.has('reviewer')) reviewer = formData.get('reviewer');
                    if (formData.has('notes')) notes = formData.get('notes');
                } else {
                    const rawText = await request.text().catch(() => '');
                    const params = new URLSearchParams(rawText);
                    if (params.has('token')) token = params.get('token');
                    if (params.has('action')) action = params.get('action');
                    if (params.has('decision')) action = params.get('decision');
                    if (params.has('reviewer')) reviewer = params.get('reviewer');
                    if (params.has('notes')) notes = params.get('notes');
                }
            } catch {
                try {
                    const rawText = await request.text().catch(() => '');
                    const params = new URLSearchParams(rawText);
                    if (params.has('token')) token = params.get('token');
                    if (params.has('action')) action = params.get('action');
                    if (params.has('decision')) action = params.get('decision');
                    if (params.has('notes')) notes = params.get('notes');
                } catch {
                    // ignore
                }
            }
        } else {
            try {
                const body = await request.json().catch(() => null);
                if (body && typeof body === 'object') {
                    if (body.token) token = body.token;
                    if (body.action) action = body.action;
                    if (body.decision) action = body.decision;
                    if (body.reviewer) reviewer = body.reviewer;
                    if (body.notes) notes = body.notes;
                }
            } catch {
                // ignore
            }
        }
    }

    // Check Entra ID / user email header if present
    const headerReviewer = request.headers.get('x-user-email') || request.headers.get('x-ms-client-principal-name');
    if (headerReviewer && !reviewer) {
        reviewer = headerReviewer.trim();
    }

    const acceptHeader = (request.headers.get('accept') || '').toLowerCase();
    const prefersJson = acceptHeader.includes('application/json') && !acceptHeader.includes('text/html');

    // Validation: Token presence
    if (!token) {
        const errorMsg = 'Missing required decision token.';
        if (!prefersJson) {
            return {
                status: 400,
                headers: { ...SECURITY_HEADERS, 'Content-Type': 'text/html' },
                body: generateErrorHtml({ title: 'Invalid Request', message: errorMsg, status: 400 })
            };
        }
        return {
            status: 400,
            headers: { ...SECURITY_HEADERS, 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'BAD_REQUEST', error: errorMsg, correlationId })
        };
    }

    // 3. Cryptographic Token Verification
    const tokenCheck = verifyDecisionToken(token);
    if (!tokenCheck.valid) {
        const isExpired = tokenCheck.reason === 'EXPIRED';
        const status = isExpired ? 410 : 401;
        const errorMsg = isExpired
            ? 'This decision link has expired (72-hour validity period exceeded). Please contact your administrator.'
            : 'Invalid or forged decision token.';

        if (!prefersJson) {
            return {
                status,
                headers: { ...SECURITY_HEADERS, 'Content-Type': 'text/html' },
                body: generateErrorHtml({ title: isExpired ? 'Link Expired' : 'Unauthorized Token', message: errorMsg, status })
            };
        }
        return {
            status,
            headers: { ...SECURITY_HEADERS, 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: isExpired ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN', error: errorMsg, correlationId })
        };
    }

    const { conflictId, recipientEmail } = tokenCheck.payload;

    // 4. Query Conflict from Database
    const conflict = await getConflictById(conflictId);
    if (!conflict) {
        const errorMsg = `Conflict #${conflictId} does not exist in the database.`;
        if (!prefersJson) {
            return {
                status: 404,
                headers: { ...SECURITY_HEADERS, 'Content-Type': 'text/html' },
                body: generateErrorHtml({ title: 'Not Found', message: errorMsg, status: 404 })
            };
        }
        return {
            status: 404,
            headers: { ...SECURITY_HEADERS, 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'NOT_FOUND', error: errorMsg, correlationId })
        };
    }

    // 5. Verify Token Hash against Stored Hash (Single-use token integrity)
    // CRITICAL (Phase 4.4.2 Priority Item 1): Missing or NULL DecisionTokenHash must NEVER bypass validation!
    const calculatedHash = hashToken(token);
    if (!conflict.DecisionTokenHash || conflict.DecisionTokenHash !== calculatedHash) {
        const errorMsg = 'Token verification failed: Decision token does not match the active authorization record, is missing from the database record, or has been revoked.';
        if (!prefersJson) {
            return {
                status: 401,
                headers: { ...SECURITY_HEADERS, 'Content-Type': 'text/html' },
                body: generateErrorHtml({ title: 'Token Revoked', message: errorMsg, status: 401 })
            };
        }
        return {
            status: 401,
            headers: { ...SECURITY_HEADERS, 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'INVALID_TOKEN_HASH', error: errorMsg, correlationId })
        };
    }

    // 6. Check if conflict is in a legitimate pending status (Priority Item 6)
    const isPending = LEGITIMATE_PENDING_STATUSES.includes(conflict.ConflictStatus);
    if (!isPending) {
        if (!prefersJson) {
            return {
                status: 200,
                headers: { ...SECURITY_HEADERS, 'Content-Type': 'text/html' },
                body: generateAlreadyResolvedHtml({ conflictId, conflict })
            };
        }
        return {
            status: 409,
            headers: { ...SECURITY_HEADERS, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                status: 'ALREADY_RESOLVED',
                error: `Conflict #${conflictId} has already been resolved or is not in a resolvable pending status (current status: "${conflict.ConflictStatus}"). Only pending conflicts can be resolved.`,
                currentStatus: conflict.ConflictStatus,
                reviewedBy: conflict.ReviewedBy,
                reviewedAt: conflict.ReviewedAt,
                correlationId
            })
        };
    }

    // =========================================================================
    // AUDIT 1 & RFC 7231 / RFC 9110: GET REQUESTS ARE STRICTLY READ-ONLY
    // Never execute state mutations on GET, even if action is in query parameters!
    // =========================================================================
    if (request.method === 'GET') {
        context.log(`[${correlationId}] GET review request for conflict #${conflictId}. Rendering preview/review page (read-only).`);

        if (prefersJson) {
            return {
                status: 200,
                headers: { ...SECURITY_HEADERS, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    status: 'PENDING_DECISION',
                    conflictId: Number(conflictId),
                    metric: conflict.ExistingMetric || conflict.IncomingMetric,
                    entity: conflict.ExistingEntity || conflict.IncomingEntity,
                    period: conflict.ExistingPeriodLabel || conflict.IncomingPeriodLabel,
                    reportingBasis: conflict.ReportingBasis || 'Actual',
                    existingValue: conflict.ExistingNormalizedValue,
                    existingFileName: conflict.ExistingFileName,
                    incomingValue: conflict.IncomingNormalizedValue,
                    incomingFileName: conflict.IncomingFileName,
                    differenceValue: conflict.DifferenceValue,
                    differencePercentage: conflict.DifferencePercentage,
                    currentStatus: conflict.ConflictStatus,
                    figuresLost: {
                        ifKeepExisting: `Incoming candidate fact [${conflict.IncomingFileName || 'Incoming'}: ${conflict.IncomingNormalizedValue}] will be rejected`,
                        ifAcceptIncoming: `Existing master fact [${conflict.ExistingFileName || 'Existing'}: ${conflict.ExistingNormalizedValue}] will be superseded`
                    },
                    recommendedAction: action || null,
                    instructions: 'GET is strictly read-only. Submit an HTTP POST request to /api/confirmConflict with { token, action } to resolve this conflict.'
                })
            };
        }

        return {
            status: 200,
            headers: { ...SECURITY_HEADERS, 'Content-Type': 'text/html' },
            body: generateReviewHtml({ conflict, token, recommendedAction: action })
        };
    }

    // =========================================================================
    // POST REQUESTS: EXECUTE MUTATION UNDER TRANSACTIONAL AUDIT
    // =========================================================================

    // Validation: Action presence on POST
    if (!action) {
        const errorMsg = 'Missing required decision action. Must be "keep_existing" or "accept_incoming".';
        if (!prefersJson) {
            return {
                status: 400,
                headers: { ...SECURITY_HEADERS, 'Content-Type': 'text/html' },
                body: generateErrorHtml({ title: 'Invalid Action', message: errorMsg, status: 400 })
            };
        }
        return {
            status: 400,
            headers: { ...SECURITY_HEADERS, 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'BAD_REQUEST', error: errorMsg, correlationId })
        };
    }

    let cleanAction = action.trim().toLowerCase();
    if (cleanAction === 'keep_incoming') cleanAction = 'accept_incoming';
    if (cleanAction !== 'keep_existing' && cleanAction !== 'accept_incoming') {
        const errorMsg = `Invalid action "${action}". Allowed actions are "keep_existing" or "accept_incoming".`;
        if (!prefersJson) {
            return {
                status: 400,
                headers: { ...SECURITY_HEADERS, 'Content-Type': 'text/html' },
                body: generateErrorHtml({ title: 'Invalid Action', message: errorMsg, status: 400 })
            };
        }
        return {
            status: 400,
            headers: { ...SECURITY_HEADERS, 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'BAD_REQUEST', error: errorMsg, correlationId })
        };
    }

    // TODO(PHASE2): In Phase 2, verify caller identity via Entra ID / Microsoft identity token
    // rather than relying solely on the HMAC decision token and caller-supplied reviewer email.
    // In Phase 1, the HMAC decision token proves authorization to decide on this conflict,
    // and if a reviewer email is provided, it must match the recipient email or be an admin.
    if (reviewer && recipientEmail) {
        const normReviewer = reviewer.trim().toLowerCase();
        const normRecipient = recipientEmail.trim().toLowerCase();
        if (normReviewer !== normRecipient && !normReviewer.includes('admin')) {
            const errorMsg = `Unauthorized reviewer (${reviewer}). Only the designated owner (${recipientEmail}) or an administrator can resolve this conflict.`;
            if (!prefersJson) {
                return {
                    status: 403,
                    headers: { ...SECURITY_HEADERS, 'Content-Type': 'text/html' },
                    body: generateErrorHtml({ title: 'Access Denied', message: errorMsg, status: 403 })
                };
            }
            return {
                status: 403,
                headers: { ...SECURITY_HEADERS, 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: 'FORBIDDEN', error: errorMsg, correlationId })
            };
        }
    }

    const effectiveReviewer = reviewer || recipientEmail || 'Authorized Reviewer';

    // Execute atomic SQL transaction for decision resolution
    try {
        const resolution = await applyConflictDecision({
            conflictId,
            action: cleanAction,
            reviewerEmail: effectiveReviewer,
            notes
        });

        context.log(`[${correlationId}] Conflict #${conflictId} successfully resolved: NewStatus=${resolution.newStatus}, Action=${cleanAction}`);

        if (!prefersJson) {
            const htmlBody = generateConfirmationHtml({
                conflictId,
                action: cleanAction,
                status: resolution.newStatus,
                metric: conflict.ExistingMetric || conflict.IncomingMetric,
                entity: conflict.ExistingEntity || conflict.IncomingEntity,
                period: conflict.ExistingPeriodLabel || conflict.IncomingPeriodLabel,
                message: resolution.resolutionReason
            });
            return {
                status: 200,
                headers: { ...SECURITY_HEADERS, 'Content-Type': 'text/html' },
                body: htmlBody
            };
        }

        return {
            status: 200,
            headers: { ...SECURITY_HEADERS, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                status: 'SUCCESS',
                conflictId: Number(conflictId),
                action: cleanAction,
                newStatus: resolution.newStatus,
                selectedFactId: resolution.selectedFactId,
                message: resolution.resolutionReason,
                correlationId
            })
        };
    } catch (txnError) {
        context.error(`[${correlationId}] Failed resolving conflict #${conflictId}: ${txnError.message}`);
        if (!prefersJson) {
            return {
                status: 500,
                headers: { ...SECURITY_HEADERS, 'Content-Type': 'text/html' },
                body: generateErrorHtml({ title: 'Resolution Failed', message: `Transaction rolled back: ${txnError.message}`, status: 500 })
            };
        }
        return {
            status: 500,
            headers: { ...SECURITY_HEADERS, 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'INTERNAL_ERROR', error: txnError.message, correlationId })
        };
    }
};

app.http('confirmConflict', {
    methods: ['GET', 'POST'],
    authLevel: 'anonymous',
    handler: confirmConflictHandler
});

module.exports = {
    confirmConflictHandler,
    generateReviewHtml,
    generateConfirmationHtml,
    generateErrorHtml,
    generateAlreadyResolvedHtml,
    sanitizeUrlForLogging,
    SECURITY_HEADERS,
    LEGITIMATE_PENDING_STATUSES
};
