import React from 'react';
import ChatWindow from '../components/chat/ChatWindow';

export default function ChatPage({ onNotify, initialDocumentId }) {
  return <ChatWindow onNotify={onNotify} initialDocumentId={initialDocumentId} />;
}
