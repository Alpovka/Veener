'use client';
import React, { useState, useRef, useEffect } from 'react';
import { useVeneer } from './context';

/**
 * Floating chat. The end user describes how they want the page to look; we POST the request
 * (with the registry, current UI, and recent history) to the host's /api/veneer endpoint,
 * then swap in + persist the returned UI code. Capabilities the AI can use are bounded by
 * the registry, so the model is told up front exactly what's available.
 *
 * Styled with inline styles so the package carries no dependency on the host app's CSS / Tailwind.
 */
export function VeneerChat({ endpoint = '/api/veneer', suggestions, anchor = 'viewport' }) {
  const { registry, ui, setUi, reset } = useVeneer();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [history, setHistory] = useState([]);
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [history, open, busy]);

  async function send() {
    const message = input.trim();
    if (!message || busy) return;
    setInput('');
    const priorHistory = history;
    setHistory((h) => [...h, { role: 'user', content: message }]);
    setBusy(true);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, registry, currentUI: ui, history: priorHistory }),
      });
      const json = await res.json();
      if (json.error) {
        setHistory((h) => [...h, { role: 'assistant', content: 'Error: ' + json.error }]);
      } else {
        if (json.code) setUi(json.code);
        setHistory((h) => [...h, { role: 'assistant', content: json.reply || 'Done.' }]);
      }
    } catch (e) {
      setHistory((h) => [...h, { role: 'assistant', content: 'Network error — please try again.' }]);
    }
    setBusy(false);
  }

  function clearConversation() {
    if (busy) return;
    setHistory([]);
    setInput('');
  }

  const tips =
    suggestions && suggestions.length
      ? suggestions
      : [
          'Make this a kanban board grouped by status',
          'Show a calendar by due date',
          'Give me a colorful dashboard with progress',
        ];

  // When anchor='container', the launcher + panel float inside the nearest
  // positioned ancestor (e.g. the demo card) instead of the viewport.
  const contained = anchor === 'container';
  const launcherStyle = contained
    ? { ...S.launcher, position: 'absolute', right: 16, bottom: 16 }
    : S.launcher;
  const panelStyle = contained
    ? {
        ...S.panel,
        position: 'absolute',
        top: 16,
        right: 16,
        bottom: 16,
        height: 'auto',
        maxHeight: 'none',
        width: 'min(360px, calc(100% - 32px))',
      }
    : S.panel;

  return (
    <>
      {/* Floating launcher */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          style={launcherStyle}
          aria-label="Talk with AI to change the UI"
        >
          <SparkleIcon />
          <span style={{ marginLeft: 8 }}>Talk with AI to change the look of this page</span>
        </button>
      )}

      {/* Panel */}
      {open && (
        <div style={panelStyle} role="dialog" aria-label="Veneer AI chat">
          {/* Scoped so the input placeholder stays legible regardless of the host page's
              inherited text color (e.g. a dark-mode body color leaking in). */}
          <style>{`.veneer-chat-input::placeholder{color:#94a3b8;opacity:1;}`}</style>
          <div style={S.header}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <SparkleIcon />
              <strong style={{ fontSize: 14 }}>Redesign with AI</strong>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                onClick={clearConversation}
                disabled={busy}
                style={ghostStyle(busy)}
                title="Clear the conversation"
              >
                Clear
              </button>
              <button
                onClick={reset}
                disabled={busy}
                style={ghostStyle(busy)}
                title="Reset the canvas to the default view"
              >
                Reset
              </button>
              <button onClick={() => setOpen(false)} style={S.iconBtn} aria-label="Close">
                ✕
              </button>
            </div>
          </div>

          <div ref={scrollRef} data-lenis-prevent style={S.messages}>
            {history.length === 0 && (
              <div style={{ color: '#64748b', fontSize: 13, lineHeight: 1.6 }}>
                Describe how you want this page to look. The AI writes the UI; it can only use
                the capabilities this app registered.
                <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {tips.map((s) => (
                    <button
                      key={s}
                      onClick={() => setInput(s)}
                      disabled={busy}
                      style={{
                        ...S.suggestion,
                        opacity: busy ? 0.5 : 1,
                        cursor: busy ? 'not-allowed' : 'pointer',
                      }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {history.map((m, i) => (
              <div key={i} style={m.role === 'user' ? S.userMsg : S.aiMsg}>
                {m.content}
              </div>
            ))}
            {busy && <div style={S.aiMsg}>Designing…</div>}
          </div>

          <div style={S.inputRow}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && send()}
              placeholder="e.g. make this a kanban board…"
              className="veneer-chat-input"
              style={S.input}
              disabled={busy}
            />
            <button
              onClick={send}
              disabled={busy || !input.trim()}
              style={{
                ...S.sendBtn,
                opacity: busy || !input.trim() ? 0.6 : 1,
                cursor: busy || !input.trim() ? 'not-allowed' : 'pointer',
              }}
            >
              {busy ? '…' : 'Send'}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function SparkleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 2l2.2 5.8L20 10l-5.8 2.2L12 18l-2.2-5.8L4 10l5.8-2.2L12 2z"
        fill="currentColor"
      />
    </svg>
  );
}

// Ghost button style with a disabled (busy) appearance.
function ghostStyle(disabled) {
  return {
    ...S.ghostBtn,
    opacity: disabled ? 0.45 : 1,
    cursor: disabled ? 'not-allowed' : 'pointer',
  };
}

const S = {
  launcher: {
    position: 'fixed',
    right: 24,
    bottom: 24,
    zIndex: 2147483000,
    display: 'inline-flex',
    alignItems: 'center',
    padding: '12px 18px',
    borderRadius: 9999,
    border: 'none',
    background: 'linear-gradient(135deg,#4f46e5,#9333ea)',
    color: '#fff',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    boxShadow: '0 10px 30px rgba(79,70,229,0.35)',
    fontFamily: 'ui-sans-serif, system-ui, sans-serif',
  },
  panel: {
    position: 'fixed',
    right: 24,
    bottom: 24,
    zIndex: 2147483000,
    width: 380,
    maxWidth: 'calc(100vw - 32px)',
    height: 560,
    maxHeight: 'calc(100vh - 48px)',
    display: 'flex',
    flexDirection: 'column',
    background: '#fff',
    borderRadius: 18,
    boxShadow: '0 20px 60px rgba(15,23,42,0.25)',
    border: '1px solid #e2e8f0',
    overflow: 'hidden',
    fontFamily: 'ui-sans-serif, system-ui, sans-serif',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 14px',
    borderBottom: '1px solid #eef2f7',
    color: '#4f46e5',
  },
  messages: { flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 8 },
  userMsg: {
    alignSelf: 'flex-end',
    background: '#4f46e5',
    color: '#fff',
    padding: '8px 12px',
    borderRadius: '14px 14px 4px 14px',
    fontSize: 13,
    maxWidth: '85%',
  },
  aiMsg: {
    alignSelf: 'flex-start',
    background: '#f1f5f9',
    color: '#0f172a',
    padding: '8px 12px',
    borderRadius: '14px 14px 14px 4px',
    fontSize: 13,
    maxWidth: '85%',
    whiteSpace: 'pre-wrap',
  },
  suggestion: {
    textAlign: 'left',
    background: '#f8fafc',
    border: '1px solid #e2e8f0',
    borderRadius: 10,
    padding: '8px 10px',
    fontSize: 12.5,
    color: '#334155',
    cursor: 'pointer',
  },
  inputRow: { display: 'flex', gap: 8, padding: 12, borderTop: '1px solid #eef2f7' },
  input: {
    flex: 1,
    border: '1px solid #e2e8f0',
    borderRadius: 10,
    padding: '10px 12px',
    fontSize: 13,
    outline: 'none',
    background: '#fff',
    color: '#0f172a',
  },
  sendBtn: {
    background: 'linear-gradient(135deg,#4f46e5,#9333ea)',
    color: '#fff',
    border: 'none',
    borderRadius: 10,
    padding: '0 16px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  ghostBtn: {
    background: 'transparent',
    border: '1px solid #e2e8f0',
    borderRadius: 8,
    padding: '4px 8px',
    fontSize: 12,
    color: '#64748b',
    cursor: 'pointer',
  },
  iconBtn: {
    background: 'transparent',
    border: 'none',
    fontSize: 14,
    color: '#94a3b8',
    cursor: 'pointer',
  },
};
