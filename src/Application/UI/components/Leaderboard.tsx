import React, { useCallback, useEffect, useRef, useState } from 'react';
import { TRACK } from '../../../design/rhythm-track.mjs';
import type { LeaderboardEntry, LeaderboardListResponse } from '../../../design/leaderboard';
import './Leaderboard.css';

const CONNECTION_ERROR = 'Could not load the leaderboard. Please try again.';
const formatScore = (score: number) => new Intl.NumberFormat('en-US').format(score);

function isEntry(entry: LeaderboardEntry) {
  return entry && typeof entry.id === 'string' && typeof entry.name === 'string' && entry.trackId === TRACK.id
    && Number.isInteger(entry.score) && entry.score >= 0 && entry.score <= 1_000_000
    && Number.isFinite(entry.accuracy) && entry.accuracy >= 0 && entry.accuracy <= 100
    && Number.isInteger(entry.maxCombo) && entry.maxCombo >= 0;
}

/** A plain document: its parent owns the physical screen and reading controls. */
export default function Leaderboard({ active = true, refreshKey = 0 }: { active?: boolean; refreshKey?: number }) {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(false);
  const request = useRef<AbortController | null>(null);

  const loadEntries = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/leaderboard', { cache: 'no-store', signal: controller.signal });
      if (!response.headers.get('content-type')?.includes('application/json')) throw new Error(CONNECTION_ERROR);
      const result: LeaderboardListResponse & { error?: string } = await response.json();
      if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : CONNECTION_ERROR);
      if (!Array.isArray(result.entries) || !result.entries.every(isEntry)) throw new Error(CONNECTION_ERROR);
      if (mounted.current && request.current === controller) {
        setEntries(result.entries.slice(0, 200));
        setLoaded(true);
      }
    } catch (failure) {
      if (mounted.current && request.current === controller) setError(failure instanceof Error && failure.name !== 'AbortError' ? failure.message : CONNECTION_ERROR);
    } finally {
      window.clearTimeout(timeout);
      if (mounted.current && request.current === controller) {
        request.current = null;
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current?.abort();
      request.current = null;
    };
  }, []);

  useEffect(() => {
    if (active) void loadEntries();
    else {
      const pending = request.current;
      request.current = null;
      pending?.abort();
      setLoading(false);
    }
  }, [active, refreshKey, loadEntries]);

  return <main className="leaderboard-page" aria-labelledby="leaderboard-title" aria-describedby="leaderboard-song" data-active={active}>
    <header className="leaderboard-heading">
      <h1 id="leaderboard-title">Leaderboard</h1>
      <p id="leaderboard-song">{TRACK.title} <span>{TRACK.artist}</span></p>
    </header>
    <div className="leaderboard-table-region" tabIndex={active ? 0 : -1} role="region" aria-label="Ranked scores" aria-busy={loading}>
      <table className="leaderboard-table">
        <colgroup><col className="leaderboard-rank-column" /><col className="leaderboard-name-column" /><col className="leaderboard-score-column" /><col className="leaderboard-accuracy-column" /><col className="leaderboard-combo-column" /></colgroup>
        <thead><tr><th scope="col">Rank</th><th scope="col">Name</th><th scope="col">Score</th><th scope="col">Accuracy</th><th scope="col">Combo</th></tr></thead>
        <tbody>{entries.map((entry, index) => <tr key={entry.id}>
          <td>{index + 1}</td><th scope="row">{entry.name}</th><td>{formatScore(entry.score)}</td><td>{entry.accuracy.toFixed(1)}%</td><td>{entry.maxCombo}</td>
        </tr>)}</tbody>
      </table>
      {loading && entries.length === 0 && <p className="leaderboard-feedback" role="status">Loading scores…</p>}
      {loaded && !loading && !error && entries.length === 0 && <p className="leaderboard-feedback">No scores yet.</p>}
    </div>
    <footer className="leaderboard-footer">
      <p role={error ? 'alert' : 'status'}>{error || (loading && entries.length > 0 ? 'Refreshing…' : '')}</p>
      <button type="button" disabled={!active || loading} onClick={() => { if (active) void loadEntries(); }}>{error ? 'Retry' : 'Refresh'}</button>
    </footer>
  </main>;
}
