import React, { useState, useRef, useEffect } from 'react';
import {
  UploadCloud,
  FileText,
  CheckCircle2,
  AlertCircle,
  Clock,
  Layers,
  Database,
  RefreshCw,
  FileCheck,
  X,
  MessageSquare,
  ShieldCheck
} from 'lucide-react';
import { uploadDocument, getIngestionStatus } from '../../services/api';
import { saveStoredIngestion } from '../../services/storage';

const ACCEPTED_EXTENSIONS = ['.pdf', '.xlsx', '.xls', '.csv', '.txt', '.md'];

export default function FileUpload({ onNotify, onNavigateToChat }) {
  const [file, setFile] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  // Ingestion Result & Live Polling State
  const [ingestionResult, setIngestionResult] = useState(null);
  const [liveStatus, setLiveStatus] = useState(null);
  const [isPolling, setIsPolling] = useState(false);

  const fileInputRef = useRef(null);
  const pollingTimerRef = useRef(null);

  // Stop polling on unmount
  useEffect(() => {
    return () => {
      if (pollingTimerRef.current) clearInterval(pollingTimerRef.current);
    };
  }, []);

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      validateAndSelectFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileSelect = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      validateAndSelectFile(e.target.files[0]);
    }
  };

  const validateAndSelectFile = (selectedFile) => {
    const ext = '.' + selectedFile.name.split('.').pop().toLowerCase();
    if (!ACCEPTED_EXTENSIONS.includes(ext)) {
      onNotify && onNotify({
        type: 'error',
        title: 'Unsupported File Format',
        message: `Accepted formats are PDF, Excel (.xlsx/.xls), CSV, or Text. Selected: ${selectedFile.name}`
      });
      return;
    }

    setFile(selectedFile);
    setIngestionResult(null);
    setLiveStatus(null);
  };

  const handleUpload = async (e) => {
    e.preventDefault();
    if (!file || isUploading) return;

    setIsUploading(true);
    setIngestionResult(null);
    setLiveStatus(null);

    try {
      const response = await uploadDocument({
        file,
        fileName: file.name,
        authorityRank: 4,
        sourceType: 'ManualUpload',
        isAsync: true
      });

      setIngestionResult(response);

      const docId = response.documentId;
      const initialStatus = response.ingestionStatus || (response.status === 'Accepted' ? 'Processing' : 'Succeeded');

      // Save to local storage history
      saveStoredIngestion({
        documentId: docId,
        fileName: response.fileName || file.name,
        authorityRank: response.authorityRank || 4,
        sourceType: 'ManualUpload',
        ingestionStatus: initialStatus,
        createdAt: new Date().toISOString()
      });

      onNotify && onNotify({
        type: 'success',
        title: 'Upload Accepted',
        message: `Document "${file.name}" uploaded. DocumentId: ${docId}`
      });

      // Default asynchronous: start polling status immediately
      if (docId) {
        startStatusPolling(docId);
      }
    } catch (err) {
      console.error('Upload failed:', err);
      onNotify && onNotify({
        type: 'error',
        title: 'Ingestion Failed',
        message: err.message
      });
    } finally {
      setIsUploading(false);
    }
  };

  const startStatusPolling = (docId) => {
    if (pollingTimerRef.current) clearInterval(pollingTimerRef.current);
    setIsPolling(true);

    let attempts = 0;
    const maxAttempts = 30; // poll for up to 75 seconds

    const poll = async () => {
      attempts++;
      try {
        const statusData = await getIngestionStatus(docId);
        setLiveStatus(statusData);

        // Update stored history
        saveStoredIngestion({
          documentId: docId,
          fileName: statusData.fileName,
          authorityRank: statusData.authorityRank,
          sourceType: statusData.sourceType,
          ingestionStatus: statusData.ingestionStatus,
          factsCount: statusData.factsCount,
          lastProcessedAt: statusData.lastProcessedAt
        });

        if (statusData.ingestionStatus === 'Succeeded') {
          clearInterval(pollingTimerRef.current);
          setIsPolling(false);
          onNotify && onNotify({
            type: 'success',
            title: 'Ingestion Complete',
            message: `Document "${statusData.fileName}" processed successfully!`
          });
        } else if (statusData.ingestionStatus === 'Failed') {
          clearInterval(pollingTimerRef.current);
          setIsPolling(false);
          onNotify && onNotify({
            type: 'error',
            title: 'Ingestion Failed',
            message: `Document processing failed in pipeline.`
          });
        } else if (attempts >= maxAttempts) {
          clearInterval(pollingTimerRef.current);
          setIsPolling(false);
        }
      } catch (err) {
        console.warn('Status poll attempt failed:', err.message);
      }
    };

    poll();
    pollingTimerRef.current = setInterval(poll, 2500);
  };

  const formatFileSize = (bytes) => {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div style={{ maxWidth: 840, margin: '0 auto' }}>
      <div className="ingest-card">
        <h3 style={{ fontSize: 18, fontWeight: 700, color: 'var(--slate-900)', marginBottom: 6 }}>
          Ingest Financial & Enterprise Documents
        </h3>
        <p style={{ fontSize: 13.5, color: 'var(--slate-600)', marginBottom: 24, lineHeight: 1.6 }}>
          Upload audited statements, management packs, transaction sheets, or board packets. The pipeline extracts structured financial facts, computes authority ranks, detects data conflicts, and indexes semantic chunks in Azure AI Search.
        </p>

        {/* Dropzone */}
        <div
          className={`dropzone ${isDragging ? 'active' : ''}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileSelect}
            style={{ display: 'none' }}
            accept=".pdf,.xlsx,.xls,.csv,.txt,.md"
          />

          <UploadCloud className="dropzone-icon" />
          <h4 style={{ fontSize: 15, fontWeight: 600, color: 'var(--slate-800)', marginBottom: 4 }}>
            Drag and drop your file here, or click to browse
          </h4>
          <p style={{ fontSize: 12.5, color: 'var(--slate-500)' }}>
            Supported formats: PDF, Excel (.xlsx, .xls), CSV, Markdown, Text (up to 50MB)
          </p>
        </div>

        {/* Selected File Card */}
        {file && (
          <div className="file-preview-card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{
                width: 40,
                height: 40,
                borderRadius: 'var(--radius-md)',
                background: 'var(--blue-600)',
                color: 'white',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 700,
                fontSize: 12
              }}>
                {file.name.split('.').pop().toUpperCase()}
              </div>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--slate-900)' }}>{file.name}</div>
                <div style={{ fontSize: 12, color: 'var(--slate-500)' }}>
                  Size: {formatFileSize(file.size)} • Type: {file.type || 'Document'}
                </div>
              </div>
            </div>

            <button
              onClick={() => setFile(null)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--slate-400)', padding: 6 }}
              title="Remove file"
            >
              <X size={18} />
            </button>
          </div>
        )}

        {/* Upload Action */}
        <form onSubmit={handleUpload}>
          <div style={{ marginTop: 24, display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!file || isUploading}
              style={{ minWidth: 140, padding: '10px 20px', fontSize: 14 }}
            >
              {isUploading ? (
                <>
                  <span style={{ width: 14, height: 14, border: '2px solid white', borderTopColor: 'transparent', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.8s linear infinite' }} />
                  <span>Uploading...</span>
                </>
              ) : (
                <>
                  <UploadCloud size={16} />
                  <span>Upload</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      {/* Live Ingestion Status Banner & Facts Card */}
      {(ingestionResult || liveStatus) && (
        <div className="ingest-card" style={{ borderColor: 'var(--blue-200)', background: 'linear-gradient(180deg, #f8fafc 0%, #ffffff 100%)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 32,
                height: 32,
                borderRadius: '50%',
                background: liveStatus?.ingestionStatus === 'Succeeded' ? 'var(--emerald-50)' : 'var(--blue-50)',
                color: liveStatus?.ingestionStatus === 'Succeeded' ? 'var(--emerald-600)' : 'var(--blue-600)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                {liveStatus?.ingestionStatus === 'Succeeded' ? <CheckCircle2 size={18} /> : <Clock size={18} />}
              </div>
              <div>
                <h4 style={{ fontSize: 15, fontWeight: 700, color: 'var(--slate-900)' }}>
                  Ingestion Run Status: {liveStatus?.ingestionStatus || ingestionResult?.ingestionStatus || 'Processing'}
                </h4>
                <div style={{ fontSize: 12, color: 'var(--slate-500)' }}>
                  Document ID: {liveStatus?.documentId || ingestionResult?.documentId} • File: {liveStatus?.fileName || ingestionResult?.fileName}
                </div>
              </div>
            </div>

            {isPolling && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--blue-600)', fontWeight: 500 }}>
                <RefreshCw size={13} style={{ animation: 'spin 1.5s linear infinite' }} />
                <span>Polling pipeline status...</span>
              </div>
            )}
          </div>

          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            background: 'var(--white)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--slate-200)',
            marginBottom: 16
          }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--slate-500)', textTransform: 'uppercase' }}>Pipeline State</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: liveStatus?.ingestionStatus === 'Succeeded' ? 'var(--emerald-600)' : 'var(--blue-600)', marginTop: 2 }}>
                {liveStatus?.ingestionStatus || 'Processing'}
              </div>
            </div>
          </div>

          {liveStatus?.ingestionStatus === 'Succeeded' && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button
                className="btn btn-primary"
                onClick={() => onNavigateToChat && onNavigateToChat(liveStatus?.documentId)}
              >
                <MessageSquare size={14} />
                <span>Ask Questions About This Document in Chat</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

