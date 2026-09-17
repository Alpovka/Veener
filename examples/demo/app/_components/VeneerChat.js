'use client';
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useVeneer, useVeneerGenerate } from '@veneer/react';

/**
 * The demo's floating chat, built on the SDK's headless `useVeneerGenerate` hook. The SDK ships
 * no chat UI on purpose: every product has its own; copy this file as a starting point.
 */
export function VeneerChat({ endpoint = '/api/veneer', suggestions, anchor = 'viewport', headers }) {
  const { theme, resolvedMode } = useVeneer();
  const { generate, busy, history, clearHistory, reset, violation, clearViolation } = useVeneerGenerate({ endpoint, headers });
  const S = useMemo(() => makeStyles(theme, resolvedMode === 'dark'), [theme, resolvedMode]);
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [history, open, busy, violation]);

  async function send() {
    const message = input.trim();
    if (!message || busy) return;
    setInput('');
    await generate(message);
  }

  function clearConversation() {
    if (busy) return;
    clearHistory();
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
          <style>{`.veneer-chat-input::placeholder{color:${S.placeholderColor};opacity:0.8;}`}</style>
          <div style={S.header}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <SparkleIcon />
              <strong style={{ fontSize: 14 }}>Redesign with AI</strong>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                onClick={clearConversation}
                disabled={busy}
                style={ghostStyle(S, busy)}
                title="Clear the conversation"
              >
                Clear
              </button>
              <button
                onClick={reset}
                disabled={busy}
                style={ghostStyle(S, busy)}
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
              <div style={S.intro}>
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
            {violation && (
              <div style={S.notice} role="alert">
                <strong>Reverted for safety.</strong> {violationText(violation)}
                <button onClick={clearViolation} style={{ ...S.ghostBtn, marginLeft: 8 }}>
                  Dismiss
                </button>
              </div>
            )}
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

function violationText(v) {
  switch (v && v.reason) {
    case 'frame-navigated':
      return 'The generated view tried to leave the sandbox, so it was stopped and the default view restored.';
    case 'frame-unresponsive':
      return 'The generated view stopped responding, so it was stopped and the default view restored.';
    case 'scan-violation':
      return 'The generated view used something outside the allowed capabilities, so it was not run.';
    default:
      return 'The generated view was stopped and the default view restored.';
  }
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
function ghostStyle(S, disabled) {
  return {
    ...S.ghostBtn,
    opacity: disabled ? 0.45 : 1,
    cursor: disabled ? 'not-allowed' : 'pointer',
  };
}

/** Build the widget styles from the resolved theme tokens. */
function makeStyles(t, dark) {
  const c = (name) => (t && t.colors && t.colors[name] ? t.colors[name][dark ? 'dark' : 'light'] : undefined);
  const primary = c('primary');
  const accent = c('accent');
  const brandGradient = accent && accent !== primary ? `linear-gradient(135deg, ${primary}, ${accent})` : primary;
  const font = t && t.font ? t.font.sans : 'ui-sans-serif, system-ui, sans-serif';
  const radius = (k) => (t && t.radius && t.radius[k]) || '10px';
  const shadow = (k) => (t && t.shadow && t.shadow[k]) || 'none';
  const mix = (color, pct, base) => `color-mix(in srgb, ${color} ${pct}%, ${base})`;
  return {
    placeholderColor: c('muted'),
    launcher: {
      position: 'fixed',
      right: 24,
      bottom: 24,
      zIndex: 2147483000,
      display: 'inline-flex',
      alignItems: 'center',
      padding: '12px 18px',
      borderRadius: radius('full'),
      border: 'none',
      background: brandGradient,
      color: c('primaryForeground'),
      fontSize: 14,
      fontWeight: 600,
      cursor: 'pointer',
      boxShadow: shadow('md'),
      fontFamily: font,
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
      background: c('background'),
      color: c('foreground'),
      borderRadius: radius('lg'),
      boxShadow: shadow('md'),
      border: `1px solid ${c('border')}`,
      overflow: 'hidden',
      fontFamily: font,
    },
    header: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '12px 14px',
      borderBottom: `1px solid ${c('border')}`,
      color: primary,
    },
    messages: { flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 8 },
    userMsg: {
      alignSelf: 'flex-end',
      background: primary,
      color: c('primaryForeground'),
      padding: '8px 12px',
      borderRadius: `${radius('md')} ${radius('md')} ${radius('sm')} ${radius('md')}`,
      fontSize: 13,
      maxWidth: '85%',
    },
    aiMsg: {
      alignSelf: 'flex-start',
      background: c('surface'),
      color: c('foreground'),
      border: `1px solid ${c('border')}`,
      padding: '8px 12px',
      borderRadius: `${radius('md')} ${radius('md')} ${radius('md')} ${radius('sm')}`,
      fontSize: 13,
      maxWidth: '85%',
      whiteSpace: 'pre-wrap',
    },
    notice: {
      alignSelf: 'stretch',
      background: mix(c('warning'), 12, c('background')),
      border: `1px solid ${mix(c('warning'), 50, c('border'))}`,
      color: c('foreground'),
      padding: '8px 12px',
      borderRadius: radius('md'),
      fontSize: 12.5,
      lineHeight: 1.5,
    },
    intro: { color: c('muted'), fontSize: 13, lineHeight: 1.6 },
    suggestion: {
      textAlign: 'left',
      background: c('surface'),
      border: `1px solid ${c('border')}`,
      borderRadius: radius('md'),
      padding: '8px 10px',
      fontSize: 12.5,
      color: c('foreground'),
      cursor: 'pointer',
      fontFamily: font,
    },
    inputRow: { display: 'flex', gap: 8, padding: 12, borderTop: `1px solid ${c('border')}` },
    input: {
      flex: 1,
      border: `1px solid ${c('border')}`,
      borderRadius: radius('md'),
      padding: '10px 12px',
      fontSize: 13,
      outline: 'none',
      background: c('background'),
      color: c('foreground'),
      fontFamily: font,
    },
    sendBtn: {
      background: brandGradient,
      color: c('primaryForeground'),
      border: 'none',
      borderRadius: radius('md'),
      padding: '0 16px',
      fontSize: 13,
      fontWeight: 600,
      cursor: 'pointer',
      fontFamily: font,
    },
    ghostBtn: {
      background: 'transparent',
      border: `1px solid ${c('border')}`,
      borderRadius: radius('sm'),
      padding: '4px 8px',
      fontSize: 12,
      color: c('muted'),
      cursor: 'pointer',
      fontFamily: font,
    },
    iconBtn: {
      background: 'transparent',
      border: 'none',
      fontSize: 14,
      color: c('muted'),
      cursor: 'pointer',
    },
  };
}
