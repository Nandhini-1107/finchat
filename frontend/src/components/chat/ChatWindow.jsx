import React, { useState, useEffect, useRef } from 'react';
import {
  Sparkles,
  Trash2,
  TrendingUp,
  GitCompare,
  AlertOctagon,
  FileSearch,
  Bot
} from 'lucide-react';
import ChatMessage from './ChatMessage';
import ChatInput from './ChatInput';
import LoadingIndicator from '../LoadingIndicator';
import { sendChatMessage } from '../../services/api';
import {
  getStoredChatMessages,
  saveStoredChatMessages,
  clearStoredChatMessages
} from '../../services/storage';

const PROMPT_SUGGESTIONS = [
  {
    tag: 'Single Period Fact',
    query: 'What was the net profit for Contoso Properties LLC in Q1 2026?'
  },
  {
    tag: 'Period Comparison',
    query: 'Compare Q1 2026 vs Q2 2026 revenue for Contoso Retail LLC'
  },
  {
    tag: 'Conflict Check',
    query: 'Are there any data conflicts or discrepancies in Contoso records?'
  },
  {
    tag: 'Operational Query',
    query: 'What is the total revenue and gross profit for Contoso Logistics?'
  }
];

export default function ChatWindow({ onNotify, initialDocumentId = null }) {
  const [messages, setMessages] = useState(() => getStoredChatMessages());
  const [isLoading, setIsLoading] = useState(false);
  const [targetDocumentId, setTargetDocumentId] = useState(initialDocumentId ? String(initialDocumentId) : '');
  const messagesEndRef = useRef(null);

  useEffect(() => {
    if (initialDocumentId) {
      setTargetDocumentId(String(initialDocumentId));
    }
  }, [initialDocumentId]);

  // Sync messages to storage
  useEffect(() => {
    saveStoredChatMessages(messages);
  }, [messages]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const handleSendMessage = async (questionText) => {
    if (!questionText.trim() || isLoading) return;

    const userMessage = {
      id: `usr-${Date.now()}`,
      role: 'user',
      content: questionText,
      timestamp: new Date().toISOString()
    };

    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);

    try {
      // Build lightweight conversation history for follow-ups
      const history = messages.slice(-4).map((m) => ({
        role: m.role,
        content: m.content
      }));

      const response = await sendChatMessage({
        question: questionText,
        documentId: targetDocumentId ? targetDocumentId.trim() : null,
        conversationHistory: history.length > 0 ? history : null
      });

      const assistantMessage = {
        id: `ast-${Date.now()}`,
        role: 'assistant',
        content: response.answer || 'No response text received from backend.',
        data: response,
        timestamp: new Date().toISOString()
      };

      setMessages((prev) => [...prev, assistantMessage]);

      if (response.hasUnresolvedConflict) {
        onNotify && onNotify({
          type: 'error',
          title: 'Data Conflict Detected',
          message: 'The requested metric has equal-rank conflicting figures in database records.'
        });
      }
    } catch (err) {
      console.error('Chat error:', err);

      const errorMessage = {
        id: `err-${Date.now()}`,
        role: 'assistant',
        content: `⚠️ **Error retrieving answer:** ${err.message}`,
        data: {
          answer: `⚠️ **Error retrieving answer:** ${err.message}`,
          insufficientEvidence: true
        },
        timestamp: new Date().toISOString()
      };

      setMessages((prev) => [...prev, errorMessage]);

      onNotify && onNotify({
        type: 'error',
        title: err.status ? `HTTP ${err.status} Error` : 'Request Failed',
        message: err.message
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleClearChat = () => {
    if (window.confirm('Clear current chat history?')) {
      clearStoredChatMessages();
      setMessages([]);
      onNotify && onNotify({
        type: 'info',
        message: 'Chat history cleared.'
      });
    }
  };

  return (
    <div className="chat-container">
      {/* Top chat action header */}
      <div style={{
        padding: '10px 32px',
        borderBottom: '1px solid var(--slate-100)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: 'var(--white)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--slate-500)' }}>
          <Sparkles size={15} color="var(--blue-600)" />
          <span>Grounded in verified Azure SQL facts & Azure AI Search index</span>
        </div>

        {messages.length > 0 && (
          <button
            onClick={handleClearChat}
            className="btn btn-outline"
            style={{ padding: '4px 10px', fontSize: 12 }}
            title="Clear current conversation"
          >
            <Trash2 size={13} />
            <span>Clear Chat</span>
          </button>
        )}
      </div>

      {/* Messages Scroll Area */}
      <div className="chat-messages-scroll">
        {messages.length === 0 ? (
          <div className="welcome-hero">
            <div className="welcome-icon">
              <Bot size={28} />
            </div>
            <h3>Finora AI Financial Intelligence</h3>
            <p>
              Direct SQL fact-based retrieval, deterministic variance calculations, and Azure AI Search document intelligence with authority-based conflict resolution.
            </p>

            <div className="prompt-suggestions">
              {PROMPT_SUGGESTIONS.map((item, idx) => (
                <div
                  key={idx}
                  className="prompt-card"
                  onClick={() => handleSendMessage(item.query)}
                >
                  <span className="prompt-card-label">{item.tag}</span>
                  <span className="prompt-card-query">{item.query}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg) => <ChatMessage key={msg.id} message={msg} />)
        )}

        {isLoading && (
          <div className="chat-row assistant">
            <div className="chat-avatar assistant">
              <Bot size={19} />
            </div>
            <div className="chat-content-box">
              <div className="chat-bubble assistant" style={{ display: 'inline-flex', alignItems: 'center', padding: '14px 18px' }}>
                <LoadingIndicator text="Analyzing query & retrieving grounded evidence..." />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Chat Input */}
      <ChatInput
        onSendMessage={handleSendMessage}
        isLoading={isLoading}
        targetDocumentId={targetDocumentId}
        onTargetDocumentChange={setTargetDocumentId}
      />
    </div>
  );
}
