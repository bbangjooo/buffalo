import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Leaderboard from './Application/UI/components/Leaderboard';

const embedded = window.parent !== window;

type DisplayMessage = { type: 'leaderboard-display'; active: boolean; night: boolean; refresh?: boolean };
function isDisplayMessage(value: unknown): value is DisplayMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as Partial<DisplayMessage>;
  return message.type === 'leaderboard-display' && typeof message.active === 'boolean' && typeof message.night === 'boolean'
    && (message.refresh === undefined || typeof message.refresh === 'boolean');
}

function LeaderboardPage() {
  const [display, setDisplay] = useState({ active: !embedded, night: false, refreshKey: 0 });

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!embedded || event.source !== window.parent || event.origin !== window.location.origin || !isDisplayMessage(event.data)) return;
      const message = event.data;
      setDisplay(previous => ({
        active: message.active, night: message.night,
        refreshKey: previous.refreshKey + (message.refresh ? 1 : 0),
      }));
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (!embedded || event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) window.parent.postMessage({ type: 'keydown', key: 'Escape' }, window.location.origin);
    };
    window.addEventListener('message', onMessage);
    document.addEventListener('keydown', onKeyDown);
    if (embedded) window.parent.postMessage({ type: 'leaderboard-ready' }, window.location.origin);
    return () => {
      window.removeEventListener('message', onMessage);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  useEffect(() => {
    document.body.dataset.night = String(display.night);
    document.documentElement.style.colorScheme = display.night ? 'dark' : 'light';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', display.night ? '#050607' : '#eadcc0');
  }, [display.night]);

  return <Leaderboard active={display.active} refreshKey={display.refreshKey} />;
}

createRoot(document.getElementById('leaderboard-root')!).render(<LeaderboardPage />);
