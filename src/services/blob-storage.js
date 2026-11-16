// src/services/blob-storage.js
// Purpose: Azure Blob Storage integration and Read-Only SAS Token Generation (72h TTL).
// Note: Live network access to Azure Blob Storage endpoint is UNVERIFIED - needs live check in production environment.

const crypto = require('crypto');
const https = require('https');
require('../utils/config');

const DEFAULT_CONTAINER = process.env.AZURE_STORAGE_CONTAINER_NAME || 'finchat-documents';
const DEFAULT_ACCOUNT_NAME = process.env.AZURE_STORAGE_ACCOUNT_NAME || 'finchatstorage';
const DEFAULT_ACCOUNT_KEY = process.env.AZURE_STORAGE_ACCOUNT_KEY || 'ZmFrZV9rZXlfZm9yX3Rlc3RpbmdfcHVycG9zZXNfb25seV8xMjM0NQ=='; // Base64 fallback

/**
 * Generates a standard Azure Blob Storage Service SAS URL with read-only permissions and 72-hour TTL.
 *
 * @param {Object} options
 * @param {string} [options.accountName] Azure storage account name
 * @param {string} [options.accountKey] Storage account primary/secondary key (Base64)
 * @param {string} [options.containerName] Blob container name
 * @param {string} options.blobName Name/path of the blob
 * @param {number} [options.ttlHours=72] Time to live in hours (default 72)
 * @param {Date} [options.startTime] Optional start time (defaults to 5 minutes ago for clock skew)
 * @returns {string} Fully qualified Blob SAS URL
 */
function generateBlobSasUrl({
    accountName = null,
    accountKey = null,
    containerName = null,
    blobName,
    ttlHours = 72,
    startTime = null
} = {}) {
    if (!blobName) {
        throw new Error('blobName is required to generate a Blob SAS URL');
    }

    const accName = (accountName || process.env.AZURE_STORAGE_ACCOUNT_NAME || DEFAULT_ACCOUNT_NAME).trim();
    const accKey = (accountKey || process.env.AZURE_STORAGE_ACCOUNT_KEY || DEFAULT_ACCOUNT_KEY).trim();
    const container = (containerName || DEFAULT_CONTAINER).trim();
    const cleanBlobName = String(blobName).replace(/^\/+/, '');

    // Format ISO timestamps (UTC, without milliseconds, trailing Z)
    const now = startTime ? new Date(startTime) : new Date();
    const start = new Date(now.getTime() - 5 * 60 * 1000); // 5 mins in past for clock skew
    const expiry = new Date(now.getTime() + ttlHours * 3600 * 1000);

    const st = start.toISOString().replace(/\.\d{3}Z$/, 'Z');
    const se = expiry.toISOString().replace(/\.\d{3}Z$/, 'Z');
    const sv = '2020-10-02';
    const sp = 'r'; // read-only
    const sr = 'b'; // blob resource
    const spr = 'https';

    const canonicalizedResource = `/blob/${accName}/${container}/${cleanBlobName}`;

    // Azure Storage 2020-10-02 StringToSign specification:
    // signedpermissions + "\n" +
    // signedstart + "\n" +
    // signedexpiry + "\n" +
    // canonicalizedresource + "\n" +
    // signedidentifier + "\n" +
    // signedIP + "\n" +
    // signedProtocol + "\n" +
    // signedversion + "\n" +
    // signedResource + "\n" +
    // signedSnapshotTime + "\n" +
    // rscc + "\n" + rscd + "\n" + rsce + "\n" + rscl + "\n" + rsct
    const stringToSign = [
        sp,
        st,
        se,
        canonicalizedResource,
        '', // signedidentifier
        '', // signedIP
        spr,
        sv,
        sr,
        '', // signedSnapshotTime
        '', // rscc
        '', // rscd
        '', // rsce
        '', // rscl
        ''  // rsct
    ].join('\n');

    let keyBuffer;
    try {
        keyBuffer = Buffer.from(accKey, 'base64');
    } catch {
        keyBuffer = Buffer.from(accKey, 'utf8');
    }

    const signature = crypto
        .createHmac('sha256', keyBuffer)
        .update(stringToSign, 'utf8')
        .digest('base64');

    const queryParams = new URLSearchParams({
        sp,
        st,
        se,
        spr,
        sv,
        sr,
        sig: signature
    });

    return `https://${accName}.blob.core.windows.net/${container}/${cleanBlobName}?${queryParams.toString()}`;
}

/**
 * Uploads a buffer to Azure Blob Storage and returns the BlobUri.
 * Supports Azure REST API PUT if configured, or simulated storage store.
 *
 * @param {Object} options
 * @param {string} [options.containerName]
 * @param {string} options.blobName
 * @param {Buffer} options.buffer
 * @param {string} [options.contentType='application/octet-stream']
 * @returns {Promise<{ success: boolean, blobUri: string, blobName: string, containerName: string }>}
 */
async function uploadBufferToBlob({
    containerName = null,
    blobName,
    buffer,
    contentType = 'application/octet-stream'
}) {
    if (!blobName) throw new Error('blobName is required for blob upload');
    if (!buffer || !Buffer.isBuffer(buffer)) throw new Error('buffer must be a valid Buffer instance');

    const container = (containerName || DEFAULT_CONTAINER).trim();
    const accName = (process.env.AZURE_STORAGE_ACCOUNT_NAME || DEFAULT_ACCOUNT_NAME).trim();
    const cleanBlobName = String(blobName).replace(/^\/+/, '');
    const blobUri = `https://${accName}.blob.core.windows.net/${container}/${cleanBlobName}`;

    // If live storage credentials are not set to real production values or in test mode, return successful simulation
    const accKey = process.env.AZURE_STORAGE_ACCOUNT_KEY;
    if (!accKey || accKey === DEFAULT_ACCOUNT_KEY || process.env.NODE_ENV === 'test') {
        return {
            success: true,
            blobUri,
            blobName: cleanBlobName,
            containerName: container,
            sizeBytes: buffer.length,
            contentType,
            simulated: true
        };
    }

    // In live Azure environment, issue an HTTP PUT Block Blob request
    return new Promise((resolve, reject) => {
        const url = new URL(blobUri);
        const req = https.request({
            hostname: url.hostname,
            path: url.pathname,
            method: 'PUT',
            headers: {
                'x-ms-blob-type': 'BlockBlob',
                'Content-Type': contentType,
                'Content-Length': buffer.length,
                'x-ms-version': '2020-10-02',
                'x-ms-date': new Date().toUTCString()
            }
        }, (res) => {
            if (res.statusCode === 201) {
                resolve({
                    success: true,
                    blobUri,
                    blobName: cleanBlobName,
                    containerName: container,
                    sizeBytes: buffer.length,
                    contentType,
                    simulated: false
                });
            } else {
                reject(new Error(`Azure Blob Storage upload failed with status ${res.statusCode}: ${res.statusMessage}`));
            }
        });

        req.on('error', (err) => {
            reject(new Error(`Azure Blob Storage network error: ${err.message}`));
        });

        req.write(buffer);
        req.end();
    });
}

module.exports = {
    generateBlobSasUrl,
    uploadBufferToBlob,
    DEFAULT_CONTAINER
};

