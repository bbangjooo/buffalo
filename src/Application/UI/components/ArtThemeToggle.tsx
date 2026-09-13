import React, { useEffect, useRef, useState } from 'react';
import { EventBus } from '../EventBus';
import type { ArtTheme } from '../../../design/art-themes';
import './ArtThemeToggle.css';

const THEMES: { id: ArtTheme; label: string }[] = [
  { id: 'ink', label: 'Pen drawing' },
  { id: 'classic', label: 'Low-poly' },
];

export default function ArtThemeToggle({ theme, disabled }: { theme: ArtTheme; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const choices = useRef<(HTMLButtonElement | null)[]>([]);
  const restoreAfterSwap = useRef(false);
  const activeIndex = theme === 'classic' ? 1 : 0;
  const close = (restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus({ preventScroll: true });
  };

  useEffect(() => {
    if (disabled) setOpen(false);
    else if (restoreAfterSwap.current) {
      restoreAfterSwap.current = false;
      trigger.current?.focus({ preventScroll: true });
    }
  }, [disabled]);
  useEffect(() => {
    if (!open) return undefined;
    choices.current[activeIndex]?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => {
      if (!host.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      close(true);
    };
    const leave = (event: FocusEvent) => {
      if (!host.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('keydown', escape, true);
    document.addEventListener('focusin', leave);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('keydown', escape, true);
      document.removeEventListener('focusin', leave);
    };
  }, [open, activeIndex]);

  return <div className="art-theme-toggle" ref={host}>
    <button ref={trigger} type="button" className="art-theme-trigger" disabled={disabled}
      aria-label={`Theme: ${THEMES[activeIndex].label}`} title={`Theme: ${THEMES[activeIndex].label}`} aria-haspopup="menu" aria-expanded={open}
      onClick={() => setOpen(value => !value)}
      onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault(); event.stopPropagation(); setOpen(true);
        }
      }}>
      <svg className="art-theme-symbol" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m12 3-9 5 9 5 9-5-9-5ZM3 12l9 5 9-5M3 16l9 5 9-5" /></svg>
      <span className="art-theme-title"><span>Theme</span><strong>{THEMES[activeIndex].label}</strong></span>
      <svg className="art-theme-chevron" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
    </button>
    {open && <div className="art-theme-menu" role="menu" aria-label="Art theme" onKeyDown={event => {
      const index = choices.current.findIndex(choice => choice === document.activeElement);
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); event.stopPropagation();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + THEMES.length) % THEMES.length;
        choices.current[next]?.focus();
      }
    }}>
      {THEMES.map((choice, index) => <button key={choice.id} type="button" ref={element => { choices.current[index] = element; }}
        role="menuitemradio" aria-checked={theme === choice.id} disabled={disabled}
        onClick={() => {
          restoreAfterSwap.current = choice.id !== theme;
          close(true);
          if (choice.id !== theme) EventBus.dispatch('art-theme-toggle', { theme: choice.id });
        }}>
        <span>{choice.label}</span><span aria-hidden="true">{theme === choice.id ? '✓' : ''}</span>
      </button>)}
    </div>}
  </div>;
}
