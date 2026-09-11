import React, { useEffect, useRef, useState } from 'react';
import { EventBus } from '../EventBus';
import { TRACK, type RhythmState } from '../../../design/rhythm-game';
import type { LeaderboardResponse, LeaderboardSubmission } from '../../../design/leaderboard';
import './Leaderboard.css';

const NAME_STORAGE_KEY = 'bbangjo.rhythm.playerName';
const CONNECTION_ERROR = 'Could not submit your score. Please try again.';
function previousName() {
  try { return Array.from((localStorage.getItem(NAME_STORAGE_KEY) || '').replace(/\s+/gu, ' ').trim()).slice(0, 24).join(''); }
  catch { return ''; }
}

/** Mounted only for a finished result, so each run gets one retry-safe ID. */
export default function ScoreSubmission({ result }: { result: RhythmState }) {
  const [run] = useState(() => ({
    runId: crypto.randomUUID(), trackId: TRACK.id,
    perfect: result.perfect, great: result.great, good: result.good,
    misses: result.misses, maxCombo: result.maxCombo, score: result.score,
  }));
  const [name, setName] = useState(previousName);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState('');
  const [confirmation, setConfirmation] = useState<LeaderboardResponse | null>(null);
  const payload = useRef<LeaderboardSubmission | null>(null);
  const request = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const canSubmit = result.phase === 'finished' && !posting && !confirmation;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; request.current?.abort(); };
  }, []);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit || request.current) return;
    const cleanName = name.replace(/\s+/gu, ' ').trim();
    if (!cleanName || Array.from(cleanName).length > 24) { setError('Enter a name with 1–24 characters.'); return; }
    if (!payload.current) {
      const { score: _score, ...verdicts } = run;
      payload.current = { ...verdicts, name: cleanName };
      setName(cleanName);
    }
    const submission = payload.current;
    const controller = new AbortController();
    request.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    setPosting(true);
    setError('');
    try {
      const response = await fetch('/api/leaderboard', {
        method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(submission), signal: controller.signal,
      });
      if (!response.headers.get('content-type')?.includes('application/json')) throw new Error(CONNECTION_ERROR);
      const document: LeaderboardResponse & { error?: string } = await response.json();
      if (!response.ok) throw new Error(typeof document.error === 'string' ? document.error : CONNECTION_ERROR);
      const validEntry = document.entry && document.entry.runId === submission.runId && document.entry.trackId === submission.trackId
        && document.entry.name === submission.name && document.entry.perfect === submission.perfect
        && document.entry.great === submission.great && document.entry.good === submission.good
        && document.entry.misses === submission.misses && document.entry.maxCombo === submission.maxCombo;
      if (typeof document.saved !== 'boolean' || typeof document.duplicate !== 'boolean' || !Number.isInteger(document.rank)
        || (document.saved ? !validEntry || document.rank < 1 || document.rank > 200 : document.entry !== null || document.rank <= 200)) throw new Error(CONNECTION_ERROR);
      if (!mounted.current || request.current !== controller) return;
      setConfirmation(document);
      try { localStorage.setItem(NAME_STORAGE_KEY, submission.name); } catch { /* The server confirmation is independent of this preference. */ }
      EventBus.dispatch('leaderboard-updated', {});
    } catch (failure) {
      if (mounted.current && request.current === controller) setError(failure instanceof Error && failure.name !== 'AbortError' ? failure.message : CONNECTION_ERROR);
    } finally {
      window.clearTimeout(timeout);
      if (request.current === controller) request.current = null;
      if (mounted.current) setPosting(false);
    }
  }

  return <section className="score-submission" aria-label="Submit your finished score">
    <p className="score-submission-score">Final score <output aria-label="Final score">{new Intl.NumberFormat('en-US').format(run.score)}</output></p>
    <form onSubmit={submit} className="score-submission-form">
      <label htmlFor="rhythm-player-name">Name</label>
      <div className="score-submission-fields">
        <input id="rhythm-player-name" name="name" value={name} onChange={event => setName(event.target.value)} maxLength={24} required autoComplete="nickname" placeholder="Your name" readOnly={Boolean(payload.current)} disabled={posting || Boolean(confirmation)} />
        <button type="submit" disabled={!canSubmit}>{posting ? 'Submitting…' : confirmation ? confirmation.saved ? 'Saved' : 'Not ranked' : 'Submit score'}</button>
      </div>
      {error && <p className="score-submission-error" role="alert">{error}</p>}
      {confirmation && <p className="score-submission-notice" role="status">{confirmation.saved ? `Saved at rank ${confirmation.rank}.` : 'This score did not enter the top 200.'}</p>}
    </form>
    {confirmation && <button type="button" className="score-leaderboard-link" onClick={() => EventBus.dispatch('leaderboard-open', {})}>View leaderboard</button>}
  </section>;
}
