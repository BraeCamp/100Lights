'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

interface CommandAction {
  id: string;
  label: string;
  group?: string;
  keywords?: string[];
  shortcut?: string;
  action: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  actions: CommandAction[];
}

type FilteredItem =
  | { kind: 'header'; group: string }
  | { kind: 'action'; action: CommandAction; matchScore: number };

function scoreMatch(action: CommandAction, query: string): number | null {
  const q = query.toLowerCase();
  const label = action.label.toLowerCase();
  const keywords = (action.keywords ?? []).map((k) => k.toLowerCase());

  if (label.startsWith(q)) return 0;
  if (label.includes(q)) return 1;
  if (keywords.some((k) => k.startsWith(q))) return 2;
  if (keywords.some((k) => k.includes(q))) return 3;
  return null;
}

function buildList(actions: CommandAction[], query: string): FilteredItem[] {
  const q = query.trim();

  if (q === '') {
    const grouped: Record<string, CommandAction[]> = {};
    const ungrouped: CommandAction[] = [];

    for (const a of actions) {
      if (a.group) {
        if (!grouped[a.group]) grouped[a.group] = [];
        grouped[a.group].push(a);
      } else {
        ungrouped.push(a);
      }
    }

    const items: FilteredItem[] = [];
    for (const [group, groupActions] of Object.entries(grouped)) {
      items.push({ kind: 'header', group });
      for (const a of groupActions) {
        items.push({ kind: 'action', action: a, matchScore: 0 });
      }
    }
    for (const a of ungrouped) {
      items.push({ kind: 'action', action: a, matchScore: 0 });
    }
    return items;
  }

  const scored: Array<{ action: CommandAction; matchScore: number }> = [];
  for (const a of actions) {
    const score = scoreMatch(a, q);
    if (score !== null) scored.push({ action: a, matchScore: score });
  }
  scored.sort((a, b) => a.matchScore - b.matchScore);

  return scored.slice(0, 50).map((s) => ({
    kind: 'action' as const,
    action: s.action,
    matchScore: s.matchScore,
  }));
}

function actionItems(list: FilteredItem[]): Array<{ action: CommandAction; index: number }> {
  const result: Array<{ action: CommandAction; index: number }> = [];
  let idx = 0;
  for (const item of list) {
    if (item.kind === 'action') {
      result.push({ action: item.action, index: idx });
      idx++;
    }
  }
  return result;
}

export default function CommandPalette({ open, onClose, actions }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [focusedIndex, setFocusedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const list = buildList(actions, query);
  const flat = actionItems(list);
  const total = flat.length;

  const execute = useCallback(
    (idx: number) => {
      const item = flat[idx];
      if (item) {
        item.action.action();
        onClose();
      }
    },
    [flat, onClose],
  );

  useEffect(() => {
    if (open) {
      setQuery('');
      setFocusedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusedIndex((i) => Math.min(i + 1, total - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        execute(focusedIndex);
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, focusedIndex, total, execute, onClose]);

  // Scroll focused row into view
  useEffect(() => {
    if (!listRef.current) return;
    const focused = listRef.current.querySelector<HTMLElement>('[data-focused="true"]');
    focused?.scrollIntoView({ block: 'nearest' });
  }, [focusedIndex]);

  // Reset focused index when list changes
  useEffect(() => {
    setFocusedIndex(0);
  }, [query]);

  if (!open) return null;

  let actionCounter = -1;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 560,
          maxHeight: 420,
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
        }}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Type a command…"
          style={{
            width: '100%',
            boxSizing: 'border-box',
            fontSize: 14,
            padding: '12px',
            background: 'var(--bg-surface)',
            border: 'none',
            borderBottom: '1px solid var(--border)',
            color: 'var(--text-primary)',
            outline: 'none',
            flexShrink: 0,
          }}
        />

        <div
          ref={listRef}
          style={{
            overflowY: 'auto',
            maxHeight: 340,
          }}
        >
          {list.length === 0 && (
            <div
              style={{
                padding: '20px 14px',
                fontSize: 13,
                color: 'var(--text-muted)',
                textAlign: 'center',
              }}
            >
              No commands found
            </div>
          )}

          {list.map((item, i) => {
            if (item.kind === 'header') {
              return (
                <div
                  key={`header-${item.group}`}
                  style={{
                    padding: '4px 14px 2px',
                    fontSize: 10,
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    color: 'var(--text-muted)',
                    userSelect: 'none',
                  }}
                >
                  {item.group}
                </div>
              );
            }

            actionCounter++;
            const idx = actionCounter;
            const isFocused = focusedIndex === idx;

            return (
              <div
                key={item.action.id}
                data-focused={isFocused ? 'true' : undefined}
                onMouseEnter={() => setFocusedIndex(idx)}
                onClick={() => execute(idx)}
                style={{
                  padding: '8px 14px',
                  fontSize: 13,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  cursor: 'pointer',
                  background: isFocused ? 'rgba(139,92,246,0.15)' : 'transparent',
                  color: isFocused ? 'rgba(167,139,250,1)' : 'var(--text-primary)',
                  userSelect: 'none',
                }}
              >
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.action.label}
                </span>

                <span style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0, marginLeft: 12 }}>
                  {item.action.group && query.trim() !== '' && (
                    <span
                      style={{
                        fontSize: 10,
                        padding: '2px 6px',
                        borderRadius: 4,
                        background: 'var(--accent-subtle)',
                        color: 'var(--text-muted)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.06em',
                      }}
                    >
                      {item.action.group}
                    </span>
                  )}
                  {item.action.shortcut && (
                    <span
                      style={{
                        fontSize: 11,
                        padding: '2px 6px',
                        borderRadius: 4,
                        background: 'var(--bg-surface)',
                        color: 'var(--text-muted)',
                        border: '1px solid var(--border)',
                        fontFamily: 'monospace',
                      }}
                    >
                      {item.action.shortcut}
                    </span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
