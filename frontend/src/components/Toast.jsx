import React from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

export default function Toast({ toasts, onDismiss }) {
  if (!toasts || toasts.length === 0) return null;

  return (
    <div className="toast-container" role="region" aria-live="polite">
      {toasts.map((toast) => {
        const Icon =
          toast.type === 'success' ? CheckCircle2 :
          toast.type === 'error' ? AlertCircle : Info;

        return (
          <div key={toast.id} className={`toast ${toast.type || 'info'}`}>
            <Icon size={18} style={{ flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              {toast.title && <div style={{ fontWeight: 600, marginBottom: 2 }}>{toast.title}</div>}
              <div>{toast.message}</div>
            </div>
            <button
              onClick={() => onDismiss(toast.id)}
              style={{
                background: 'none',
                border: 'none',
                color: 'rgba(255,255,255,0.6)',
                cursor: 'pointer',
                padding: 4,
                display: 'flex'
              }}
              title="Close notification"
            >
              <X size={16} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

