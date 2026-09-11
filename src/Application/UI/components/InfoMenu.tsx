import React, { useCallback, useEffect, useRef, useState } from 'react';
import './InfoMenu.css';

export default function InfoMenu() {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const credits = useRef<HTMLAnchorElement>(null);
  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    credits.current?.focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      close();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) close();
    };
    const onFocusIn = (event: FocusEvent) => {
      if (!container.current?.contains(event.target as Node)) close(false);
    };
    window.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('focusin', onFocusIn);
    };
  }, [open, close]);

  return <div ref={container} className="info-menu">
    <button ref={trigger} id="information-trigger" type="button" className="icon-control info-menu-trigger" aria-label="Information" title="Information"
      aria-haspopup="menu" aria-expanded={open} aria-controls="information-menu" onClick={() => open ? close() : setOpen(true)}
      onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); event.stopPropagation(); setOpen(true); }
      }}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 11v6m0-10v.1" /></svg>
    </button>
    {open && <div id="information-menu" className="info-menu-panel" role="menu" aria-labelledby="information-trigger" onKeyDown={event => {
      event.stopPropagation();
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) { event.preventDefault(); credits.current?.focus(); }
      if (event.key === 'Tab') close(false);
    }}>
      <a ref={credits} role="menuitem" href="/audio/piano/index.html" target="_blank" rel="noopener noreferrer" onClick={() => close()}>
        Credits <span aria-hidden="true">↗</span><span className="sr-only"> (new tab)</span>
      </a>
    </div>}
  </div>;
}
