import React from 'react';
import { Globe, Server, Database } from 'lucide-react';
import { getApiBaseUrl } from '../services/api';

const TAB_TITLES = {
  chat: {
    title: 'Financial Intelligence Chat',
    subtitle: 'Direct SQL retrieval, deterministic variance math & Azure AI Search'
  },
  ingestion: {
    title: 'Document Ingestion Pipeline',
    subtitle: 'Upload statements, extract financial facts & authority rankings'
  },
  history: {
    title: 'Ingestion Status & Managed Documents',
    subtitle: 'Track asynchronous ingestion progress and database fact counts'
  }
};

export default function Header({ activeTab }) {
  const meta = TAB_TITLES[activeTab] || TAB_TITLES.chat;
  const currentUrl = getApiBaseUrl();
  const isLocal = currentUrl.includes('localhost') || currentUrl.includes('127.0.0.1');

  return (
    <header className="top-header">
      <div className="header-title-group">
        <h2>{meta.title}</h2>
        <p>{meta.subtitle}</p>
      </div>

      <div className="header-actions">
        {/* Active Backend Indicator */}
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 7,
            padding: '5px 12px',
            borderRadius: 'var(--radius-full)',
            background: isLocal ? 'var(--amber-50)' : 'var(--blue-50)',
            border: `1px solid ${isLocal ? 'var(--amber-100)' : 'var(--blue-100)'}`,
            fontSize: 12,
            fontWeight: 500,
            color: isLocal ? 'var(--amber-600)' : 'var(--blue-600)'
          }}
          title={`Backend Endpoint: ${currentUrl}`}
        >
          <Server size={13} />
          <span>Local Functions (:7071)</span>
        </div>
      </div>
    </header>
  );
}

