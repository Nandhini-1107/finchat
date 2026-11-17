import React, { useEffect, useState } from 'react';
import {
  MessageSquare,
  UploadCloud,
  FileCheck2,
  ShieldCheck,
  Activity,
  Layers
} from 'lucide-react';
import { checkDbHealth } from '../services/api';

export default function Sidebar({ activeTab, onTabChange }) {
  const [healthStatus, setHealthStatus] = useState({ connected: null, checking: true });

  useEffect(() => {
    let mounted = true;
    const check = async () => {
      try {
        const res = await checkDbHealth();
        if (mounted) {
          setHealthStatus({ connected: res.connected, checking: false, details: res });
        }
      } catch {
        if (mounted) {
          setHealthStatus({ connected: false, checking: false });
        }
      }
    };

    check();
    const interval = setInterval(check, 30000); // Check every 30s
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  const navItems = [
    { id: 'chat', label: 'Chat Assistant', icon: MessageSquare },
    { id: 'ingestion', label: 'File Ingestion', icon: UploadCloud },
    { id: 'history', label: 'Ingestion History', icon: FileCheck2 }
  ];

  return (
    <aside className="sidebar">
      {/* Brand Header */}
      <div className="sidebar-brand">
        <div className="sidebar-logo-icon">
          <Layers size={20} />
        </div>
        <div className="sidebar-brand-text">
          <h1>FinChat AI</h1>
          <span>Financial Intelligence</span>
        </div>
      </div>

      {/* Navigation Links */}
      <nav className="sidebar-nav">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              className={`nav-item ${isActive ? 'active' : ''}`}
              onClick={() => onTabChange(item.id)}
            >
              <Icon size={18} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Sidebar Footer with Live Health Indicator */}
      <div className="sidebar-footer">
        <div className="health-status-badge">
          <div
            className={`status-dot ${
              healthStatus.checking
                ? 'yellow'
                : healthStatus.connected
                ? 'green'
                : 'red'
            }`}
          />
          <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {healthStatus.checking
              ? 'Checking Backend...'
              : healthStatus.connected
              ? 'Azure SQL Connected'
              : 'Backend Offline'}
          </span>
          <Activity size={13} style={{ opacity: 0.6 }} />
        </div>
      </div>
    </aside>
  );
}

