import React, { useEffect, useState } from 'react';
import { EventBus } from '../EventBus';
import type { PianoAssetState } from '../../PianoDownloads';
import './PianoAssetProgress.css';

export default function PianoAssetProgress() {
  const [assets, setAssets] = useState<Partial<Record<PianoAssetState['id'], PianoAssetState>>>({});
  useEffect(() => {
    const off = EventBus.on('piano-assets', (next: PianoAssetState) => setAssets(previous => ({ ...previous, [next.id]: next })));
    EventBus.dispatch('world-request-state', {});
    return off;
  }, []);
  return <div className="piano-asset-stack">{[assets.performance, assets.keys].filter(Boolean).map(state => <AssetProgress key={state.id} state={state} />)}</div>;
}

function AssetProgress({ state }: { state: PianoAssetState }) {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    setHidden(false);
    if (state?.phase !== 'downloaded' && state?.phase !== 'ready') return undefined;
    const timer = window.setTimeout(() => setHidden(true), 4000);
    return () => window.clearTimeout(timer);
  }, [state?.phase]);
  if (!state || state.phase === 'idle' || hidden) return null;
  const displayName = state.id === 'performance' ? 'Music' : 'Keyboard';
  const percent = Math.min(state.phase === 'downloading' ? 99 : 100, state.total > 0 ? Math.floor(state.received / state.total * 100) : 0);
  const label = state.phase === 'error' ? `${displayName} unavailable`
    : state.phase === 'preparing' ? `Preparing ${displayName.toLowerCase()}`
    : state.phase === 'ready' ? `${displayName} ready`
    : state.phase === 'downloaded' ? `${displayName} downloaded` : `Loading ${displayName.toLowerCase()}`;
  return <aside className="piano-asset-progress" aria-label={displayName} data-phase={state.phase}>
    <div className="piano-asset-heading"><span role="status">{label}</span>
      {state.phase === 'downloading' && state.total > 0 && <span aria-hidden="true">{percent}%</span>}
      {state.phase === 'error' && <button type="button" onClick={() => EventBus.dispatch('piano-assets-retry', { id: state.id })}>Retry</button>}
      {(state.phase === 'ready' || state.phase === 'downloaded') && <span aria-hidden="true">✓</span>}
    </div>
    {(state.phase === 'downloading' || state.phase === 'preparing') && <>
      <progress max={100} value={state.phase === 'preparing' || state.total <= 0 ? undefined : percent} aria-label={label} />
      <small>{state.phase === 'preparing' ? 'Download complete' : state.unit === 'seconds' ? `${Math.floor(state.received)} s buffered` : `${(state.received / 1e6).toFixed(1)} / ${(state.total / 1e6).toFixed(1)} MB`}</small>
    </>}
  </aside>;
}
