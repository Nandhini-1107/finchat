import React, { useState } from 'react';
import {
  User,
  Bot,
  Database,
  Search,
  FileText,
  AlertTriangle,
  Calculator,
  ChevronDown,
  ChevronUp,
  Cpu,
  Layers,
  ShieldAlert
} from 'lucide-react';
import MarkdownContent from './MarkdownContent';

export default function ChatMessage({ message }) {
  const isUser = message.role === 'user';
  const [showFacts, setShowFacts] = useState(false);
  const [showCalcs, setShowCalcs] = useState(false);
  const [showSources, setShowSources] = useState(false);

  // Assistant response data fields from backend contract
  const data = message.data || {};
  const answer = message.content || data.answer || '';
  const routeUsed = data.routeUsed;
  const intentType = data.intentType;
  const sources = data.sources || [];
  const factsUsed = data.factsUsed || [];
  const calculations = data.calculations || [];
  const hasConflict = data.hasUnresolvedConflict || factsUsed.some(f => f.hasConflict);
  const tokenUsage = data.tokenUsage;
  const llmModel = data.llmModel;
  const llmProvider = data.llmProvider;

  return (
    <div className={`chat-row ${isUser ? 'user' : 'assistant'}`}>
      <div className={`chat-avatar ${isUser ? 'user' : 'assistant'}`}>
        {isUser ? <User size={18} /> : <Bot size={19} />}
      </div>

      <div className="chat-content-box">
        {/* Metadata Badge for Assistant */}
        {!isUser && (routeUsed || llmModel) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 2 }}>
            {routeUsed && (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  fontSize: 11,
                  fontWeight: 600,
                  padding: '2px 8px',
                  borderRadius: 'var(--radius-full)',
                  background: routeUsed === 'DIRECT_SQL' ? 'var(--emerald-50)' : 'var(--blue-50)',
                  color: routeUsed === 'DIRECT_SQL' ? 'var(--emerald-600)' : 'var(--blue-600)',
                  border: `1px solid ${routeUsed === 'DIRECT_SQL' ? 'var(--emerald-100)' : 'var(--blue-100)'}`
                }}
              >
                {routeUsed === 'DIRECT_SQL' ? <Database size={11} /> : <Search size={11} />}
                {routeUsed}
              </span>
            )}

            {intentType && (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 500,
                  padding: '2px 8px',
                  borderRadius: 'var(--radius-full)',
                  background: 'var(--slate-100)',
                  color: 'var(--slate-600)'
                }}
              >
                {intentType}
              </span>
            )}

            {llmModel && (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  fontSize: 11,
                  color: 'var(--slate-400)'
                }}
                title={`Provider: ${llmProvider || 'Default'}`}
              >
                <Cpu size={11} />
                {llmModel}
              </span>
            )}

            {tokenUsage?.totalTokens > 0 && (
              <span style={{ fontSize: 11, color: 'var(--slate-400)' }}>
                • {tokenUsage.totalTokens} tokens
              </span>
            )}
          </div>
        )}

        {/* Message Bubble */}
        <div className={`chat-bubble ${isUser ? 'user' : 'assistant'}`}>
          {isUser ? (
            <div style={{ whiteSpace: 'pre-wrap' }}>{answer}</div>
          ) : (
            <MarkdownContent content={answer} />
          )}
        </div>

        {/* Conflict Notice if present */}
        {!isUser && hasConflict && (
          <div className="conflict-banner">
            <div className="conflict-banner-title">
              <ShieldAlert size={16} />
              <span>Data Discrepancy & Conflict Detected</span>
            </div>
            <div style={{ fontSize: 12.5, lineHeight: 1.5 }}>
              The database contains conflicting records for this metric across different sources. Review the specific status and resolution notes above before making financial decisions.
            </div>
          </div>
        )}

        {/* Accordion: Verified Facts Used */}
        {!isUser && factsUsed.length > 0 && (
          <div className="meta-accordion">
            <div className="meta-header" onClick={() => setShowFacts(!showFacts)}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Layers size={14} color="var(--blue-600)" />
                <span>Verified Facts Used ({factsUsed.length})</span>
              </div>
              {showFacts ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </div>

            {showFacts && (
              <div className="meta-body">
                <div className="facts-table-container">
                  <table className="facts-table">
                    <thead>
                      <tr>
                        <th>Metric</th>
                        <th>Entity</th>
                        <th>Period</th>
                        <th>Value</th>
                        <th>Source File</th>
                        <th>Authority</th>
                        <th>Conflict Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {factsUsed.map((fact, idx) => (
                        <tr key={idx}>
                          <td style={{ fontWeight: 600 }}>{fact.metric}</td>
                          <td>{fact.entity || '—'}</td>
                          <td>{fact.period || '—'}</td>
                          <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--blue-600)' }}>
                            {fact.currency ? `${fact.currency} ` : ''}
                            {typeof fact.value === 'number' ? fact.value.toLocaleString() : fact.value}
                            {fact.unit && fact.unit !== 'amount' ? ` ${fact.unit}` : ''}
                          </td>
                          <td style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={fact.sourceFile}>
                            {fact.sourceFile || '—'}
                          </td>
                          <td>
                            <span style={{ fontSize: 11, background: 'var(--slate-100)', padding: '2px 6px', borderRadius: 4 }}>
                              {fact.authorityType || `Rank ${fact.authorityRank || 4}`}
                            </span>
                          </td>
                          <td>
                            {fact.hasConflict ? (
                              <span style={{ fontSize: 11, color: '#b45309', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                <AlertTriangle size={12} />
                                {fact.conflictStatus || 'Conflict'}
                              </span>
                            ) : (
                              <span style={{ fontSize: 11, color: 'var(--emerald-600)' }}>Verified</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Accordion: Deterministic Calculations */}
        {!isUser && calculations.length > 0 && (
          <div className="meta-accordion">
            <div className="meta-header" onClick={() => setShowCalcs(!showCalcs)}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Calculator size={14} color="var(--emerald-600)" />
                <span>Deterministic Calculations ({calculations.length})</span>
              </div>
              {showCalcs ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </div>

            {showCalcs && (
              <div className="meta-body">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {calculations.map((calc, idx) => (
                    <div
                      key={idx}
                      style={{
                        padding: 10,
                        background: 'var(--white)',
                        borderRadius: 'var(--radius-sm)',
                        border: '1px solid var(--slate-200)',
                        fontSize: 12
                      }}
                    >
                      <div style={{ fontWeight: 600, color: 'var(--slate-800)', marginBottom: 2 }}>
                        {calc.type}: {calc.metric}
                      </div>
                      {calc.period1 && calc.period2 && (
                        <div style={{ color: 'var(--slate-600)' }}>
                          {calc.period1} ({calc.period1Value} {calc.currency}) vs {calc.period2} ({calc.period2Value} {calc.currency})
                          <span style={{ fontWeight: 600, color: 'var(--emerald-600)', marginLeft: 8 }}>
                            Variance: {calc.difference > 0 ? `+${calc.difference}` : calc.difference} {calc.currency}
                            {calc.percentChange !== null ? ` (${calc.percentChange}%)` : ''}
                          </span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Citations & Sources */}
        {!isUser && sources.length > 0 && (
          <div style={{ marginTop: 4 }}>
            <div className="sources-pills">
              <span style={{ fontSize: 11, color: 'var(--slate-500)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <FileText size={12} /> Sources:
              </span>
              {sources.map((src, idx) => (
                <span key={idx} className="source-pill" title={src.source}>
                  {src.source}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="chat-timestamp">
          {message.timestamp ? new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
        </div>
      </div>
    </div>
  );
}

