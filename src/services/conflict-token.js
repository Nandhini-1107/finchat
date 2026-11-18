// src/services/conflict-token.js
// Cryptographic single-use decision tokens and HMAC signatures for conflict resolution workflow.

const crypto = require('crypto');
require('../utils/config');

const DEFAULT_SECRET = process.env.CONFLICT_TOKEN_SECRET || process.env.CLIENT_SECRET || 'finchat-default-conflict-secret-key-32ch';
const DEFAULT_TTL_HOURS = 72;
const DEFAULT_EXPIRY_DAYS = 7;

/**
 * Encodes an object or string to a URL-safe Base64 string.
 */
function base64UrlEncode(str) {
    return Buffer.from(str, 'utf8')
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

/**
 * Decodes a URL-safe Base64 string.
 */
function base64UrlDecode(str) {
    let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) {
        base64 += '=';
    }
    return Buffer.from(base64, 'base64').toString('utf8');
}

/**
 * Generates an HMAC SHA-256 signature for a payload string.
 */
function createSignature(payloadString, secret = DEFAULT_SECRET) {
    return crypto.createHmac('sha256', secret)
        .update(payloadString)
        .digest('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

/**
 * Computes a SHA-256 hex digest of a token string for safe database storage.
 *
 * @param {string} token
 * @returns {string} SHA-256 hex string (64 characters)
 */
function hashToken(token) {
    if (!token || typeof token !== 'string') return '';
    return crypto.createHash('sha256').update(token.trim()).digest('hex');
}

/**
 * Generates an enterprise-grade, HMAC-SHA256 signed single-use decision token for a conflict.
 *
 * @param {Object} params
 * @param {number|string} params.conflictId - Conflict ID in Azure SQL
 * @param {string} [params.recipientEmail] - Target human recipient
 * @param {number} [params.ttlHours=72] - Time-to-live in hours (default 72h)
 * @returns {string} Signed token: `<base64UrlPayload>.<base64UrlSignature>`
 */
function generateDecisionToken({
    conflictId,
    recipientEmail = null,
    ttlHours = DEFAULT_TTL_HOURS
}) {
    if (!conflictId) {
        throw new Error('conflictId is required to generate a decision token.');
    }

    const issuedAt = Math.floor(Date.now() / 1000);
    const expiresAt = issuedAt + Math.round(ttlHours * 3600);

    const payload = {
        cid: Number(conflictId) || conflictId,
        email: recipientEmail ? String(recipientEmail).trim().toLowerCase() : null,
        iat: issuedAt,
        exp: expiresAt,
        nonce: crypto.randomBytes(16).toString('hex')
    };

    const payloadString = JSON.stringify(payload);
    const encodedPayload = base64UrlEncode(payloadString);
    const signature = createSignature(encodedPayload);

    return `${encodedPayload}.${signature}`;
}

/**
 * Validates a decision token, verifying its cryptographic signature and expiration.
 *
 * @param {string} token - Signed decision token
 * @param {string} [secret] - Optional secret override
 * @returns {{ valid: boolean, payload?: Object, error?: string, expired?: boolean }}
 */
function verifyDecisionToken(token, secret = DEFAULT_SECRET) {
    if (!token || typeof token !== 'string') {
        return { valid: false, error: 'Token is missing or not a string.' };
    }

    const parts = token.trim().split('.');
    if (parts.length !== 2) {
        return { valid: false, error: 'Token format is invalid (expected payload.signature).' };
    }

    const [encodedPayload, providedSignature] = parts;
    const expectedSignature = createSignature(encodedPayload, secret);

    const providedBuffer = Buffer.from(providedSignature);
    const expectedBuffer = Buffer.from(expectedSignature);

    if (providedBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(providedBuffer, expectedBuffer)) {
        return {
            valid: false,
            reason: 'INVALID_SIGNATURE',
            error: 'Invalid token signature (token has been tampered with or expired secret).'
        };
    }

    try {
        const payloadJson = base64UrlDecode(encodedPayload);
        const payload = JSON.parse(payloadJson);

        const currentSeconds = Math.floor(Date.now() / 1000);
        if (payload.exp && currentSeconds > payload.exp) {
            return {
                valid: false,
                expired: true,
                reason: 'EXPIRED',
                error: `Token expired at ${new Date(payload.exp * 1000).toISOString()}. Please request a fresh link.`
            };
        }

        return {
            valid: true,
            payload: {
                conflictId: payload.cid || payload.docId,
                recipientEmail: payload.email,
                issuedAt: new Date(payload.iat * 1000),
                expiresAt: new Date(payload.exp * 1000)
            }
        };
    } catch (parseErr) {
        return { valid: false, error: `Malformed token payload: ${parseErr.message}` };
    }
}

/**
 * Builds the canonical decision URLs for email notification links.
 *
 * @param {string} token
 * @param {string} [baseUrl]
 * @returns {{ previewUrl: string, keepExistingUrl: string, acceptIncomingUrl: string }}
 */
function getDecisionUrls(token, baseUrl = null) {
    const rawBase = baseUrl || process.env.FINCHAT_BASE_URL || 'http://localhost:7071';
    const base = String(rawBase).replace(/\/+$/, '');
    const encodedToken = encodeURIComponent(token);

    return {
        previewUrl: `${base}/api/confirmConflict?token=${encodedToken}`,
        keepExistingUrl: `${base}/api/confirmConflict?token=${encodedToken}&action=keep_existing`,
        acceptIncomingUrl: `${base}/api/confirmConflict?token=${encodedToken}&action=accept_incoming`
    };
}

/**
 * Backward-compatible helper for legacy document-level resolution tokens.
 */
function generateConflictResolutionToken({
    documentId,
    userEmail = null,
    action = null,
    expiresInDays = DEFAULT_EXPIRY_DAYS
}) {
    return generateDecisionToken({
        conflictId: documentId,
        recipientEmail: userEmail,
        ttlHours: expiresInDays * 24
    });
}

/**
 * Backward-compatible helper for legacy document-level resolution token verification.
 */
function verifyConflictResolutionToken(token, secret = DEFAULT_SECRET) {
    return verifyDecisionToken(token, secret);
}

module.exports = {
    DEFAULT_TTL_HOURS,
    generateDecisionToken,
    verifyDecisionToken,
    hashToken,
    getDecisionUrls,
    generateConflictResolutionToken,
    verifyConflictResolutionToken
};
