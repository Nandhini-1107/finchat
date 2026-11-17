import React, { useState, useEffect } from 'react';
import {
  FileText,
  Search,
  RefreshCw,
  CheckCircle2,
  Clock,
  AlertCircle,
  Trash2,
  ExternalLink,
  MessageSquare,
  Layers,
  Database
} from 'lucide-react';
import { getIngestionStatus } from '../../services/api';
import {
  getStoredIngestions,
  saveStoredIngestion,
  removeStoredIngestion
} from '../../services/storage';

export default function IngestionHistory({ onNotify, onNavigateToChat }) {
  const [documents, setDocuments] = useState(() => getStoredIngestions());
  const [searchDocId, setSearchDocId] = useState('');
  const [lookupResult, setLookupResult] = useState(null);
  const [isSearching, setIsSearching] = useState(false);
  const [refreshingId, setRefreshingId] = useState(null);

  useEffect(() => {
    setDocuments(getStoredIngestions());
  }, []);

  const handleLookup = async (e) => {
    if (e) e.preventDefault();
    if (!searchDocId.trim()) return;

    setIsSearching(true);
    setLookupResult(null);

    try {
      const data = await getIngestionStatus(searchDocId.trim());
      setLookupResult(data);

      // Save or update in history
      saveStoredIngestion({
        documentId: data.documentId,
        fileName: data.fileName,
        authorityRank: data.authorityRank,
        sourceType: data.sourceType,
        ingestionStatus: data.ingestionStatus,
        factsCount: data.factsCount,
        lastProcessedAt: data.lastProcessedAt
      });
      setDocuments(getStoredIngestions());

      onNotify && onNotify({
        type: 'success',
        title: 'Status Retrieved',
        message: `Document "${data.fileName}" is ${data.ingestionStatus}.`
      });
    } catch (err) {
      console.error('Status lookup error:', err);
      onNotify && onNotify({
        type: 'error',
        title: 'Lookup Failed',
        message: err.message
      });
    } finally {
      setIsSearching(false);
    }
  };

  const handleRefreshSingle = async (docId) => {
    setRefreshingId(docId);
    try {
      const data = await getIngestionStatus(docId);
      saveStoredIngestion({
        documentId: data.documentId,
        fileName: data.fileName,
        authorityRank: data.authorityRank,
        sourceType: data.sourceType,
        ingestionStatus: data.ingestionStatus,
        factsCount: data.factsCount,
        lastProcessedAt: data.lastProcessedAt
      });
      setDocuments(getStoredIngestions());

      onNotify && onNotify({
        type: 'info',
        title: 'Status Updated',
        message: `Document #${docId} status: ${data.ingestionStatus} (${data.factsCount || 0} facts).`
      });
    } catch (err) {
      onNotify && onNotify({
        type: 'error',
        title: 'Refresh Error',
        message: err.message
      });
    } finally {
      setRefreshingId(null);
    }
  };

  const handleRemove = (docId) => {
    removeStoredIngestion(docId);
    setDocuments(getStoredIngestions());
  };

  const renderStatusBadge = (status) => {
    const s = (status || '').toLowerCase();
    if (s === 'succeeded') {
      return (
        <span style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          padding: '3px 8px',
          borderRadius: 'var(--radius-full)',
          background: 'var(--emerald-50)',
          color: 'var(--emerald-600)',
          fontSize: 12,
          fontWeight: 600
        }}>
          <CheckCircle2 size={12} />
          Succeeded
        </span>
      );
    }
    if (s === 'processing') {
      return (
        <span style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          padding: '3px 8px',
          borderRadius: 'var(--radius-full)',
          background: 'var(--amber-50)',
          color: 'var(--amber-600)',
          fontSize: 12,
          fontWeight: 600
        }}>
          <Clock size={12} />
          Processing
        </span>
      );
    }
    return (
      <span style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '3px 8px',
        borderRadius: 'var(--radius-full)',
        background: 'var(--rose-50)',
        color: 'var(--rose-600)',
        fontSize: 12,
        fontWeight: 600
      }}>
        <AlertCircle size={12} />
        {status || 'Unknown'}
      </span>
    );
  };

  return (
    <div style={{ maxWidth: 960, margin: '0 auto' }}>
      {/* Lookup Card */}
      <div className="ingest-card" style={{ padding: 24, marginBottom: 24 }}>
        <h4 style={{ fontSize: 16, fontWeight: 700, color: 'var(--slate-900)', marginBottom: 4 }}>
          Query Ingestion Status by Document ID
        </h4>
        <p style={{ fontSize: 13, color: 'var(--slate-500)', marginBottom: 16 }}>
          Directly query <code>GET /api/getIngestionStatus?documentId=&lt;id&gt;</code> to verify current database pipeline status and extracted facts count.
        </p>

        <form onSubmit={handleLookup} style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1, position: 'relative' }}>
            <input
              type="text"
              className="form-control"
              placeholder="Enter Document ID (e.g. 303)..."
              value={searchDocId}
              onChange={(e) => setSearchDocId(e.target.value)}
              disabled={isSearching}
            />
          </div>

          <button type="submit" className="btn btn-primary" disabled={!searchDocId.trim() || isSearching}>
            <Search size={15} />
            <span>{isSearching ? 'Querying...' : 'Check Status'}</span>
          </button>
        </form>

        {/* Lookup Result Box */}
        {lookupResult && (
          <div style={{
            marginTop: 18,
            padding: 16,
            background: 'var(--slate-50)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--slate-200)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 12
          }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--slate-900)' }}>
                  {lookupResult.fileName}
                </span>
                {renderStatusBadge(lookupResult.ingestionStatus)}
              </div>
              <div style={{ fontSize: 12, color: 'var(--slate-500)', marginTop: 4 }}>
                Document ID: #{lookupResult.documentId} • Source Type: {lookupResult.sourceType} • Authority: Rank {lookupResult.authorityRank} • Facts Count: <strong>{lookupResult.factsCount}</strong>
              </div>
            </div>

            {lookupResult.ingestionStatus === 'Succeeded' && (
              <button
                className="btn btn-primary"
                style={{ padding: '6px 12px', fontSize: 12 }}
                onClick={() => onNavigateToChat && onNavigateToChat(lookupResult.documentId)}
              >
                <MessageSquare size={13} />
                <span>Chat with this Document</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* History Table */}
      <div className="ingest-card" style={{ padding: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <h4 style={{ fontSize: 16, fontWeight: 700, color: 'var(--slate-900)' }}>
              Ingestion History & Managed Documents
            </h4>
            <p style={{ fontSize: 13, color: 'var(--slate-500)' }}>
              Documents submitted through this interface or verified via status lookup.
            </p>
          </div>

          <span style={{ fontSize: 12, color: 'var(--slate-400)' }}>
            {documents.length} document{documents.length === 1 ? '' : 's'} tracked
          </span>
        </div>

        {documents.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--slate-400)' }}>
            <FileText size={36} style={{ margin: '0 auto 10px', opacity: 0.5 }} />
            <p style={{ fontSize: 14 }}>No documents tracked in history yet.</p>
            <p style={{ fontSize: 12, marginTop: 4 }}>Upload a document or query a Document ID above to track status.</p>
          </div>
        ) : (
          <div className="facts-table-container">
            <table className="facts-table">
              <thead>
                <tr>
                  <th>Doc ID</th>
                  <th>File Name</th>
                  <th>Status</th>
                  <th>Authority</th>
                  <th>Facts Extracted</th>
                  <th>Last Updated</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {documents.map((doc) => (
                  <tr key={doc.documentId}>
                    <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--blue-600)' }}>
                      #{doc.documentId}
                    </td>
                    <td style={{ fontWeight: 600, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={doc.fileName}>
                      {doc.fileName}
                    </td>
                    <td>{renderStatusBadge(doc.ingestionStatus)}</td>
                    <td>
                      <span style={{ fontSize: 11, background: 'var(--slate-100)', padding: '2px 6px', borderRadius: 4 }}>
                        Rank {doc.authorityRank || 4}
                      </span>
                    </td>
                    <td style={{ fontWeight: 600 }}>
                      {doc.factsCount !== undefined ? doc.factsCount : '—'}
                    </td>
                    <td style={{ fontSize: 11, color: 'var(--slate-500)' }}>
                      {doc.lastProcessedAt ? new Date(doc.lastProcessedAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : (doc.updatedAt ? new Date(doc.updatedAt).toLocaleTimeString() : '—')}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <button
                          className="btn btn-outline"
                          style={{ padding: '4px 8px', fontSize: 11 }}
                          onClick={() => handleRefreshSingle(doc.documentId)}
                          disabled={refreshingId === doc.documentId}
                          title="Refresh status from backend"
                        >
                          <RefreshCw size={12} style={{ animation: refreshingId === doc.documentId ? 'spin 1s linear infinite' : 'none' }} />
                        </button>

                        <button
                          className="btn btn-outline"
                          style={{ padding: '4px 8px', fontSize: 11 }}
                          onClick={() => onNavigateToChat && onNavigateToChat(doc.documentId)}
                          title="Query in Chat"
                        >
                          <MessageSquare size={12} />
                        </button>

                        <button
                          className="btn btn-outline"
                          style={{ padding: '4px 8px', fontSize: 11, color: 'var(--rose-600)' }}
                          onClick={() => handleRemove(doc.documentId)}
                          title="Remove from history"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

