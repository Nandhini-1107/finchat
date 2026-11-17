import React from 'react';
import FileUpload from '../components/ingestion/FileUpload';

export default function IngestionPage({ onNotify, onNavigateToChat }) {
  return (
    <div className="page-container">
      <FileUpload onNotify={onNotify} onNavigateToChat={onNavigateToChat} />
    </div>
  );
}

