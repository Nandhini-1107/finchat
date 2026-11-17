import React from 'react';

/**
 * Clean markdown renderer for enterprise financial answers
 * Handles bold, headings, bullet lists, blockquotes, code spans, line breaks, and tables.
 */
export default function MarkdownContent({ content }) {
  if (!content) return null;

  // Split into paragraphs / lines
  const rawLines = content.split('\n');

  const elements = [];
  let currentList = null;
  let inTable = false;
  let tableRows = [];

  const flushList = () => {
    if (currentList) {
      elements.push(
        <ul key={`ul-${elements.length}`} style={{ paddingLeft: 22, margin: '8px 0' }}>
          {currentList.map((item, idx) => (
            <li key={idx} style={{ marginBottom: 4 }}>
              {renderInline(item)}
            </li>
          ))}
        </ul>
      );
      currentList = null;
    }
  };

  const flushTable = () => {
    if (inTable && tableRows.length > 0) {
      const headerRow = tableRows[0];
      const bodyRows = tableRows.slice(1);

      elements.push(
        <div key={`table-${elements.length}`} className="facts-table-container" style={{ margin: '12px 0' }}>
          <table className="facts-table">
            <thead>
              <tr>
                {headerRow.map((col, idx) => (
                  <th key={idx}>{renderInline(col)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bodyRows.map((row, rIdx) => (
                <tr key={rIdx}>
                  {row.map((cell, cIdx) => (
                    <td key={cIdx}>{renderInline(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      inTable = false;
      tableRows = [];
    }
  };

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    const trimmed = line.trim();

    // Check table syntax (| col1 | col2 |)
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      flushList();
      const cells = trimmed.split('|').slice(1, -1).map(c => c.trim());
      // Skip separator row like |---|---|
      if (cells.every(c => /^[-:]+$/.test(c))) {
        continue;
      }
      inTable = true;
      tableRows.push(cells);
      continue;
    } else if (inTable) {
      flushTable();
    }

    // Bullet points (•, -, *)
    if (/^[\*\-•]\s+/.test(trimmed)) {
      if (!currentList) currentList = [];
      currentList.push(trimmed.replace(/^[\*\-•]\s+/, ''));
      continue;
    } else {
      flushList();
    }

    // Headings
    if (trimmed.startsWith('### ')) {
      elements.push(
        <h4 key={i} style={{ fontSize: 15, fontWeight: 700, margin: '14px 0 6px', color: 'var(--slate-900)' }}>
          {renderInline(trimmed.substring(4))}
        </h4>
      );
      continue;
    }
    if (trimmed.startsWith('## ')) {
      elements.push(
        <h3 key={i} style={{ fontSize: 16, fontWeight: 700, margin: '16px 0 8px', color: 'var(--slate-900)' }}>
          {renderInline(trimmed.substring(3))}
        </h3>
      );
      continue;
    }
    if (trimmed.startsWith('# ')) {
      elements.push(
        <h2 key={i} style={{ fontSize: 18, fontWeight: 700, margin: '18px 0 10px', color: 'var(--slate-900)' }}>
          {renderInline(trimmed.substring(2))}
        </h2>
      );
      continue;
    }

    // Blockquote
    if (trimmed.startsWith('> ')) {
      elements.push(
        <blockquote key={i}>
          {renderInline(trimmed.substring(2))}
        </blockquote>
      );
      continue;
    }

    // Empty line
    if (!trimmed) {
      continue;
    }

    // Normal paragraph
    elements.push(
      <p key={i} style={{ marginBottom: 10 }}>
        {renderInline(line)}
      </p>
    );
  }

  flushList();
  flushTable();

  return <div className="markdown-body">{elements}</div>;
}

/**
 * Renders inline markdown: bold, code, highlights, links
 */
function renderInline(text) {
  if (!text) return '';

  // Parse `code` first, then **bold**
  const parts = [];
  let remaining = text;
  let keyIdx = 0;

  // Simple token regex
  const regex = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let match;
  let lastIndex = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.substring(lastIndex, match.index));
    }

    const token = match[0];
    if (token.startsWith('**') && token.endsWith('**')) {
      parts.push(
        <strong key={`b-${keyIdx++}`}>
          {token.slice(2, -2)}
        </strong>
      );
    } else if (token.startsWith('`') && token.endsWith('`')) {
      parts.push(
        <code key={`c-${keyIdx++}`}>
          {token.slice(1, -1)}
        </code>
      );
    }

    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.substring(lastIndex));
  }

  return parts.length > 0 ? parts : text;
}

