import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  NoteStore,
  rankBySimilarity,
  rankByKeywords,
  type Note,
  type SearchResult,
} from "./lib/search";
import { TransformersEmbedder } from "./lib/embedder";
import { SEED_NOTES } from "./lib/seed";

type ModelState =
  | { kind: "loading"; msg: string }
  | { kind: "ready" }
  | { kind: "fallback"; reason: string };

export default function App() {
  const storeRef = useRef<NoteStore>();
  if (!storeRef.current) {
    storeRef.current = new NoteStore(window.localStorage);
    if (storeRef.current.size === 0) SEED_NOTES.forEach(t => storeRef.current!.add(t));
  }
  const store = storeRef.current;

  const embedder = useMemo(
    () => new TransformersEmbedder(undefined, msg => setModel(m => (m.kind === "ready" ? m : { kind: "loading", msg }))),
    [],
  );

  const [model, setModel] = useState<ModelState>({ kind: "loading", msg: "Warming up…" });
  const [notes, setNotes] = useState<Note[]>(store.all());
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [compare, setCompare] = useState(false);
  const [busy, setBusy] = useState(false);

  // Embed all notes once the model is up
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const all = store.all();
        const vectors = await embedder.embed(all.map(n => n.text));
        if (cancelled) return;
        all.forEach((n, i) => store.setVector(n.id, vectors[i]));
        setModel({ kind: "ready" });
      } catch (e) {
        if (!cancelled)
          setModel({ kind: "fallback", reason: e instanceof Error ? e.message : "model failed to load" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [embedder, store]);

  const addNote = useCallback(async () => {
    if (!draft.trim()) return;
    const note = store.add(draft);
    setDraft("");
    setNotes(store.all());
    if (model.kind === "ready") {
      const [v] = await embedder.embed([note.text]);
      store.setVector(note.id, v);
    }
  }, [draft, embedder, model.kind, store]);

  const removeNote = useCallback(
    (id: string) => {
      store.remove(id);
      setNotes(store.all());
      setResults(r => r?.filter(x => x.note.id !== id) ?? null);
    },
    [store],
  );

  const runSearch = useCallback(async () => {
    const q = query.trim();
    if (!q) {
      setResults(null);
      return;
    }
    setBusy(true);
    try {
      if (model.kind === "ready") {
        const [qv] = await embedder.embed([q]);
        setResults(rankBySimilarity(qv, store.all()));
      } else {
        setResults(rankByKeywords(q, store.all()));
      }
    } finally {
      setBusy(false);
    }
  }, [embedder, model.kind, query, store]);

  const keywordResults = useMemo(
    () => (compare && query.trim() ? rankByKeywords(query, notes) : null),
    [compare, query, notes],
  );

  return (
    <div className="shell">
      <header>
        <h1>
          Neural<span className="accent">Notes</span>
        </h1>
        <p className="sub">Search your notes by meaning, not keywords — AI running entirely in this tab.</p>
        <span className={`chip chip-${model.kind}`}>
          {model.kind === "loading" && `⏳ ${model.msg}`}
          {model.kind === "ready" && "● semantic model ready"}
          {model.kind === "fallback" && "○ keyword mode (model unavailable)"}
        </span>
      </header>

      <main>
        <section className="pane">
          <h2>Your notes ({notes.length})</h2>
          <div className="composer">
            <textarea
              value={draft}
              placeholder="Write a note…"
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), addNote())}
            />
            <button onClick={addNote} disabled={!draft.trim()}>
              Add
            </button>
          </div>
          <ul className="notes">
            {notes.map(n => (
              <li key={n.id}>
                <span>{n.text}</span>
                <button className="ghost" title="Delete" onClick={() => removeNote(n.id)}>
                  ×
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="pane">
          <h2>Search</h2>
          <div className="composer">
            <input
              value={query}
              placeholder='Try "car trouble" or "feeling stressed"…'
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === "Enter" && runSearch()}
            />
            <button onClick={runSearch} disabled={busy || !query.trim()}>
              {busy ? "…" : "Search"}
            </button>
          </div>
          <label className="toggle">
            <input type="checkbox" checked={compare} onChange={e => setCompare(e.target.checked)} />
            compare with plain keyword search
          </label>

          {results && (
            <>
              <h3>{results[0]?.method === "semantic" ? "Semantic results" : "Keyword results"}</h3>
              <ResultList results={results} />
            </>
          )}
          {keywordResults && results?.[0]?.method === "semantic" && (
            <>
              <h3>Keyword search found</h3>
              {keywordResults.length ? (
                <ResultList results={keywordResults} />
              ) : (
                <p className="empty">nothing — no shared words. That's the gap semantic search closes.</p>
              )}
            </>
          )}
        </section>
      </main>

      <footer>
        Day 001 of <a href="https://github.com/kbipul/kb-daily-builds">kb-daily-builds</a> · built by{" "}
        <a href="https://www.kumarbipul.com">Kumar Bipul</a>
      </footer>
    </div>
  );
}

function ResultList({ results }: { results: SearchResult[] }) {
  return (
    <ol className="results">
      {results.map(r => (
        <li key={r.note.id}>
          <div className="bar" style={{ width: `${Math.round(r.score * 100)}%` }} />
          <span className="score">{(r.score * 100).toFixed(0)}</span>
          <span className="text">{r.note.text}</span>
        </li>
      ))}
    </ol>
  );
}
