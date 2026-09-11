import React, { useCallback, useEffect, useRef, useState } from 'react';
import './Guestbook.css';

type Entry = { id: string; author: string; body: string; createdAt: string };
type Submission = { submissionId: string; author: string; body: string };
const CONNECTION_ERROR = 'Could not reach the guestbook. Please try again shortly.';
const normalize = (value: string) => value.replace(/\s+/gu, ' ').trim();
class GuestbookRequestError extends Error {}

function isEntry(entry: Entry) {
  return entry && typeof entry.id === 'string' && typeof entry.author === 'string'
    && typeof entry.body === 'string' && typeof entry.createdAt === 'string'
    && Number.isFinite(Date.parse(entry.createdAt));
}

async function readResponse(response: Response) {
  if (!response.headers.get('content-type')?.includes('application/json')) throw new GuestbookRequestError(CONNECTION_ERROR);
  const document = await response.json();
  if (!response.ok) throw new GuestbookRequestError(typeof document.error === 'string' ? document.error : CONNECTION_ERROR);
  return document;
}

export default function Guestbook() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [author, setAuthor] = useState('');
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState('');
  const bodyInput = useRef<HTMLInputElement>(null);
  const activeRequest = useRef<AbortController | null>(null);
  const pendingPost = useRef<AbortController | null>(null);
  const retrySubmission = useRef<Submission | null>(null);
  const mounted = useRef(false);

  const loadEntries = useCallback(async () => {
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setLoading(true);
    setLoadError('');
    try {
      const document = await readResponse(await fetch('/api/guestbook', { cache: 'no-store', signal: controller.signal }));
      if (!Array.isArray(document.entries) || !document.entries.every(isEntry)) throw new Error(CONNECTION_ERROR);
      if (mounted.current && !controller.signal.aborted) setEntries(document.entries.slice(0, 200));
    } catch (error) {
      if (mounted.current && !controller.signal.aborted) setLoadError(error instanceof GuestbookRequestError ? error.message : CONNECTION_ERROR);
    } finally {
      if (mounted.current && !controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void loadEntries();
    return () => {
      mounted.current = false;
      activeRequest.current?.abort();
      pendingPost.current?.abort();
    };
  }, [loadEntries]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || pendingPost.current) return;
    const cleanAuthor = normalize(author);
    const cleanBody = normalize(body);
    if (!cleanAuthor || !cleanBody) {
      setFormError('Please enter your name and a message.');
      return;
    }
    setSubmitting(true);
    setFormError('');
    setNotice('');
    const controller = new AbortController();
    pendingPost.current = controller;
    try {
      // An uncertain response must retry the same request, not create a second entry.
      if (!retrySubmission.current || retrySubmission.current.author !== cleanAuthor || retrySubmission.current.body !== cleanBody) {
        retrySubmission.current = { submissionId: crypto.randomUUID(), author: cleanAuthor, body: cleanBody };
      }
      const document = await readResponse(await fetch('/api/guestbook', {
        method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(retrySubmission.current), signal: controller.signal,
      }));
      if (!isEntry(document.entry)) throw new Error(CONNECTION_ERROR);
      if (!mounted.current || controller.signal.aborted) return;
      retrySubmission.current = null;
      setAuthor(cleanAuthor);
      setBody('');
      setEntries((current) => [document.entry, ...current.filter((entry) => entry.id !== document.entry.id)].slice(0, 200));
      setNotice('Message posted.');
      bodyInput.current?.focus({ preventScroll: true });
      void loadEntries();
    } catch (error) {
      if (mounted.current && !controller.signal.aborted) setFormError(error instanceof GuestbookRequestError ? error.message : CONNECTION_ERROR);
    } finally {
      if (pendingPost.current === controller) pendingPost.current = null;
      if (mounted.current && !controller.signal.aborted) setSubmitting(false);
    }
  }

  return <section className="guestbook-reader" aria-labelledby="guestbook-heading">
    <h1 id="guestbook-heading">Guestbook</h1>
    <form className="guestbook-reader-form" onSubmit={submit}>
      <label htmlFor="guestbook-author">Name</label>
      <input id="guestbook-author" name="author" value={author} onChange={(event) => {
        if (retrySubmission.current && retrySubmission.current.author !== normalize(event.target.value)) retrySubmission.current = null;
        setAuthor(event.target.value);
      }} maxLength={24} required autoComplete="nickname" disabled={submitting} placeholder="Your name" />
      <label htmlFor="guestbook-body">Message</label>
      <input ref={bodyInput} id="guestbook-body" name="body" value={body} onChange={(event) => {
        if (retrySubmission.current && retrySubmission.current.body !== normalize(event.target.value)) retrySubmission.current = null;
        setBody(event.target.value);
      }} maxLength={120} required disabled={submitting} placeholder="A short message" />
      <div className="guestbook-reader-submit"><button type="submit" disabled={submitting}>{submitting ? 'Posting…' : 'Post'}</button></div>
      {formError && <p className="guestbook-reader-error" role="alert">{formError}</p>}
      <p className="guestbook-reader-notice" role="status">{notice}</p>
    </form>
    {loadError && <p className="guestbook-reader-error" role="alert">{loadError} <button type="button" onClick={() => void loadEntries()}>Reload</button></p>}
    {!loadError && !loading && entries.length === 0 && <p className="guestbook-reader-empty">No messages yet.</p>}
    <ol className="guestbook-reader-entries" aria-label="Guestbook entries" aria-busy={loading}>
      {entries.map((entry) => <li key={entry.id}><strong>{entry.author}</strong><p>{entry.body}</p></li>)}
    </ol>
  </section>;
}
