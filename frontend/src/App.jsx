import React, { useState } from 'react';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import Toast from './components/Toast';
import ChatPage from './pages/ChatPage';
import IngestionPage from './pages/IngestionPage';
import StatusPage from './pages/StatusPage';

export default function App() {
  const [activeTab, setActiveTab] = useState('chat');
  const [toasts, setToasts] = useState([]);
  const [selectedDocIdForChat, setSelectedDocIdForChat] = useState(null);

  const addToast = ({ type = 'info', title = null, message }) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const newToast = { id, type, title, message };
    setToasts((prev) => [...prev, newToast]);

    // Auto dismiss after 4.5s
    setTimeout(() => {
      dismissToast(id);
    }, 4500);
  };

  const dismissToast = (id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const handleNavigateToChat = (documentId) => {
    setSelectedDocIdForChat(documentId);
    setActiveTab('chat');
    addToast({
      type: 'info',
      title: 'Target Document Active',
      message: `Now querying with Document ID #${documentId}`
    });
  };

  return (
    <div className="app-container">
      {/* Navigation Sidebar */}
      <Sidebar activeTab={activeTab} onTabChange={setActiveTab} />

      {/* Main Content Area */}
      <div className="main-wrapper">
        <Header activeTab={activeTab} />

        {activeTab === 'chat' && (
          <ChatPage
            onNotify={addToast}
            initialDocumentId={selectedDocIdForChat}
          />
        )}

        {activeTab === 'ingestion' && (
          <IngestionPage
            onNotify={addToast}
            onNavigateToChat={handleNavigateToChat}
          />
        )}

        {activeTab === 'history' && (
          <StatusPage
            onNotify={addToast}
            onNavigateToChat={handleNavigateToChat}
          />
        )}
      </div>

      {/* Global Notifications */}
      <Toast toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

