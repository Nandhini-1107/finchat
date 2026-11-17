import React from 'react';
import IngestionHistory from '../components/status/IngestionHistory';

export default function StatusPage({ onNotify, onNavigateToChat }) {
  return (
    <div className="page-container">
      <IngestionHistory onNotify={onNotify} onNavigateToChat={onNavigateToChat} />
    </div>
  );
}

