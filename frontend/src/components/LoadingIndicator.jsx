import React from 'react';
import { Loader2 } from 'lucide-react';

export default function LoadingIndicator({ size = 20, text = 'Processing...' }) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, color: 'var(--blue-600)', fontSize: 13, fontWeight: 500 }}>
      <Loader2 size={size} style={{ animation: 'spin 1s linear infinite' }} />
      {text && <span>{text}</span>}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

