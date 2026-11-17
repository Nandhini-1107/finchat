/**
 * FinChat API Client Service
 *
 * Exclusively integrates with existing backend Azure Function endpoints:
 * - POST /api/chat
 * - POST /api/ingestDocument
 * - GET  /api/getIngestionStatus?documentId=<id>
 * - GET  /api/dbHealth
 */

const DEFAULT_API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ||
  '/api';

const STORAGE_KEY_API_URL = 'finchat_api_base_url';
const STORAGE_KEY_USER_GROUPS = 'finchat_user_groups';

/**
 * Get active API Base URL (preference to user-configured URL in localStorage, then .env).
 */
export function getApiBaseUrl() {
  const custom = localStorage.getItem(STORAGE_KEY_API_URL);
  // Ignore any legacy/stale cloud URLs from previous test runs
  if (custom && custom.trim() && !custom.includes('azurewebsites.net')) {
    return custom.trim().replace(/\/+$/, '');
  }
  return DEFAULT_API_BASE_URL.replace(/\/+$/, '');
}

/**
 * Save custom API Base URL.
 */
export function setApiBaseUrl(url) {
  if (url && url.trim()) {
    localStorage.setItem(STORAGE_KEY_API_URL, url.trim().replace(/\/+$/, ''));
  } else {
    localStorage.removeItem(STORAGE_KEY_API_URL);
  }
}

/**
 * Get active User Groups header for RBAC testing.
 */
export function getUserGroups() {
  return localStorage.getItem(STORAGE_KEY_USER_GROUPS) || '';
}

/**
 * Set active User Groups header.
 */
export function setUserGroups(groups) {
  if (groups && groups.trim()) {
    localStorage.setItem(STORAGE_KEY_USER_GROUPS, groups.trim());
  } else {
    localStorage.removeItem(STORAGE_KEY_USER_GROUPS);
  }
}

/**
 * Unified error parser extracting backend error messages.
 */
async function parseErrorResponse(response) {
  let message = `Request failed with status ${response.status} (${response.statusText || 'Error'})`;
  let details = null;
  let code = null;

  try {
    const data = await response.json();
    if (data) {
      if (typeof data.message === 'string') message = data.message;
      else if (typeof data.error === 'string') message = data.error;
      else if (typeof data.answer === 'string') message = data.answer;

      if (data.details) details = data.details;
      if (data.code) code = data.code;
    }
  } catch {
    // If not JSON, try text
    try {
      const text = await response.text();
      if (text && text.length < 300) message = text;
    } catch {
      // Keep default message
    }
  }

  const err = new Error(message);
  err.status = response.status;
  err.details = details;
  err.code = code;
  return err;
}

/**
 * Send a chat question to /api/chat
 *
 * @param {Object} options
 * @param {string} options.question - User's question
 * @param {string|number} [options.documentId] - Optional target document ID
 * @param {string} [options.userGroups] - Optional RBAC user groups
 * @param {Array} [options.conversationHistory] - Previous chat messages
 * @returns {Promise<Object>} Backend response matching chat endpoint contract
 */
export async function sendChatMessage({ question, documentId = null, userGroups = null, conversationHistory = null }) {
  if (!question || typeof question !== 'string' || !question.trim()) {
    throw new Error('Question must be a non-empty string.');
  }

  const baseUrl = getApiBaseUrl();
  const endpoint = `${baseUrl}/chat`;

  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  };

  const effectiveUserGroups = userGroups !== null ? userGroups : getUserGroups();
  if (effectiveUserGroups && effectiveUserGroups.trim()) {
    headers['x-user-groups'] = effectiveUserGroups.trim();
  }

  const payload = {
    question: question.trim()
  };

  if (documentId !== null && documentId !== undefined && String(documentId).trim()) {
    payload.documentId = documentId;
  }

  if (effectiveUserGroups && effectiveUserGroups.trim()) {
    payload.userGroups = effectiveUserGroups.trim();
  }

  if (Array.isArray(conversationHistory) && conversationHistory.length > 0) {
    payload.conversationHistory = conversationHistory;
  }

  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });
  } catch (networkErr) {
    throw new Error(`Cannot connect to backend (${endpoint}): ${networkErr.message}. Please verify the local Azure Functions host is running ('cd finchat; func start --cors "*"').`);
  }

  if (!response.ok) {
    throw await parseErrorResponse(response);
  }

  return await response.json();
}

/**
 * Upload a document to /api/ingestDocument
 *
 * @param {Object} options
 * @param {File|Blob} options.file - File to upload
 * @param {string} [options.fileName] - Name of the file
 * @param {number} [options.authorityRank=4] - Authority Rank 1 to 4
 * @param {string} [options.sourceType='ManualUpload'] - Source classification
 * @param {string} [options.allowedUserGroups] - RBAC groups
 * @param {boolean} [options.isAsync=true] - Asynchronous ingestion (default)
 * @returns {Promise<Object>} Ingestion response (202 Accepted or 200 Succeeded)
 */
export async function uploadDocument({
  file,
  fileName = null,
  authorityRank = 4,
  sourceType = 'ManualUpload',
  allowedUserGroups = null,
  isAsync = true
}) {
  if (!file) {
    throw new Error('Please select a file to upload.');
  }

  const baseUrl = getApiBaseUrl();
  const queryParams = new URLSearchParams();
  queryParams.set('async', isAsync ? 'true' : 'false');

  const finalName = fileName || file.name;
  if (finalName) {
    queryParams.set('fileName', finalName);
  }

  const endpoint = `${baseUrl}/ingestDocument?${queryParams.toString()}`;

  const formData = new FormData();
  formData.append('file', file, finalName);
  formData.append('authorityRank', String(authorityRank || 4));
  formData.append('sourceType', sourceType || 'ManualUpload');

  const effectiveUserGroups = allowedUserGroups !== null ? allowedUserGroups : getUserGroups();
  if (effectiveUserGroups && effectiveUserGroups.trim()) {
    formData.append('allowedUserGroups', effectiveUserGroups.trim());
  }

  const headers = {};
  if (effectiveUserGroups && effectiveUserGroups.trim()) {
    headers['x-user-groups'] = effectiveUserGroups.trim();
  }

  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: formData
    });
  } catch (networkErr) {
    throw new Error(`Cannot connect to backend (${endpoint}): ${networkErr.message}. Please verify the local Azure Functions host is running ('cd finchat; func start --cors "*"').`);
  }

  if (!response.ok && response.status !== 202) {
    throw await parseErrorResponse(response);
  }

  return await response.json();
}

/**
 * Fetch the current ingestion status for a document
 *
 * @param {string|number} documentId - Document identifier
 * @returns {Promise<Object>} Status object
 */
export async function getIngestionStatus(documentId) {
  if (!documentId) {
    throw new Error('Document ID is required to fetch ingestion status.');
  }

  const baseUrl = getApiBaseUrl();
  const endpoint = `${baseUrl}/getIngestionStatus?documentId=${encodeURIComponent(String(documentId))}`;

  let response;
  try {
    response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      }
    });
  } catch (networkErr) {
    throw new Error(`Cannot connect to backend (${endpoint}): ${networkErr.message}. Please verify the local Azure Functions host is running.`);
  }

  if (!response.ok) {
    throw await parseErrorResponse(response);
  }

  return await response.json();
}

/**
 * Ping backend database health
 *
 * @returns {Promise<Object>} Health check payload
 */
export async function checkDbHealth() {
  const baseUrl = getApiBaseUrl();
  const endpoint = `${baseUrl}/dbHealth`;

  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    });

    if (!response.ok) {
      const err = await parseErrorResponse(response);
      return { connected: false, error: err.message, status: response.status };
    }

    const data = await response.json();
    return { connected: true, ...data };
  } catch (err) {
    return { connected: false, error: err.message };
  }
}

