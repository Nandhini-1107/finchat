import React, { useState, useRef, useEffect } from 'react';
import { Send, FileText, CornerDownLeft, Sparkles, X } from 'lucide-react';

export default function ChatInput({ onSendMessage, isLoading, targetDocumentId, onTargetDocumentChange }) {
  const [text, setText] = useState('');
  const textareaRef = useRef(null);

  // Auto-resize textarea height
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`;
    }
  }, [text]);

  const handleSubmit = (e) => {
    if (e) e.preventDefault();
    if (!text.trim() || isLoading) return;

    onSendMessage(text.trim());
    setText('');
    if (textareaRef.current) {
      textareaRef.current.style.height = '48px';
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="chat-input-wrapper">
      <form onSubmit={handleSubmit} className="chat-input-box">
        <textarea
          ref={textareaRef}
          className="chat-textarea"
          placeholder="Ask a financial question (e.g. 'What was the net profit for Contoso Properties LLC in Q1 2026?')..."
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isLoading}
          rows={1}
        />

        <div className="chat-input-controls">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {/* Target Document Filter */}
            <div className="target-doc-badge" title="Filter search strictly to a specific Document ID">
              <FileText size={12} />
              <span>Doc ID:</span>
              <input
                type="text"
                placeholder="All (optional)"
                value={targetDocumentId || ''}
                onChange={(e) => onTargetDocumentChange && onTargetDocumentChange(e.target.value)}
                disabled={isLoading}
              />
              {targetDocumentId && (
                <button
                  type="button"
                  onClick={() => onTargetDocumentChange && onTargetDocumentChange('')}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--slate-400)', display: 'flex' }}
                >
                  <X size={12} />
                </button>
              )}
            </div>

            <span style={{ fontSize: 11, color: 'var(--slate-400)' }}>
              Enter to send, Shift+Enter for new line
            </span>
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            disabled={!text.trim() || isLoading}
            style={{ padding: '6px 14px' }}
          >
            <span>Send</span>
            {isLoading ? (
              <span style={{ width: 14, height: 14, border: '2px solid white', borderTopColor: 'transparent', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.8s linear infinite' }} />
            ) : (
              <Send size={14} />
            )}
          </button>
        </div>
      </form>
    </div>
  );
}

