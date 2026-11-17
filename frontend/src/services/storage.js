/**
 * Client-Side Persistence for Documents & History
 */

const STORAGE_KEY_INGESTED_DOCS = 'finchat_ingested_documents';
const STORAGE_KEY_CHAT_HISTORY = 'finchat_chat_sessions';

export function getStoredIngestions() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_INGESTED_DOCS);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveStoredIngestion(doc) {
  if (!doc || !doc.documentId) return;
  try {
    const existing = getStoredIngestions();
    const index = existing.findIndex(d => String(d.documentId) === String(doc.documentId));
    if (index >= 0) {
      existing[index] = { ...existing[index], ...doc, updatedAt: new Date().toISOString() };
    } else {
      existing.unshift({
        ...doc,
        createdAt: doc.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    }
    // Limit to latest 50
    localStorage.setItem(STORAGE_KEY_INGESTED_DOCS, JSON.stringify(existing.slice(0, 50)));
  } catch (e) {
    console.error('Failed to save ingestion item:', e);
  }
}

export function removeStoredIngestion(documentId) {
  try {
    const existing = getStoredIngestions();
    const filtered = existing.filter(d => String(d.documentId) !== String(documentId));
    localStorage.setItem(STORAGE_KEY_INGESTED_DOCS, JSON.stringify(filtered));
  } catch (e) {
    console.error('Failed to remove ingestion item:', e);
  }
}

export function getStoredChatMessages() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_CHAT_HISTORY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveStoredChatMessages(messages) {
  try {
    localStorage.setItem(STORAGE_KEY_CHAT_HISTORY, JSON.stringify(messages || []));
  } catch (e) {
    console.error('Failed to save chat messages:', e);
  }
}

export function clearStoredChatMessages() {
  try {
    localStorage.removeItem(STORAGE_KEY_CHAT_HISTORY);
  } catch (e) {
    console.error('Failed to clear chat messages:', e);
  }
}

