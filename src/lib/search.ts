// Core search logic — pure, framework-free, fully unit-tested.

export interface Note {
  id: string;
  text: string;
  createdAt: number;
  /** Monotonic insertion counter — makes "newest first" deterministic even
   *  when two notes share the same createdAt millisecond. */
  seq: number;
  vector?: Float32Array;
}

export interface SearchResult {
  note: Note;
  score: number; // 0..1
  method: "semantic" | "keyword";
}

/** Cosine similarity between two vectors. Returns 0 for degenerate input. */
export function cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Rank notes by semantic similarity to the query vector. */
export function rankBySimilarity(queryVec: ArrayLike<number>, notes: Note[], limit = 8): SearchResult[] {
  return notes
    .filter((n): n is Note & { vector: Float32Array } => n.vector !== undefined)
    .map(note => ({
      note,
      // cosine of normalized MiniLM vectors lands in [-1, 1]; map to [0, 1]
      score: (cosineSimilarity(queryVec, note.vector) + 1) / 2,
      method: "semantic" as const,
    }))
    .sort((x, y) => y.score - x.score)
    .slice(0, limit);
}

const tokenize = (s: string): string[] =>
  s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(t => t.length > 1);

/** Keyword fallback: Jaccard-ish overlap of query tokens against note tokens. */
export function rankByKeywords(query: string, notes: Note[], limit = 8): SearchResult[] {
  const qTokens = new Set(tokenize(query));
  if (qTokens.size === 0) return [];
  return notes
    .map(note => {
      const nTokens = new Set(tokenize(note.text));
      let hits = 0;
      for (const t of qTokens) if (nTokens.has(t)) hits++;
      return { note, score: hits / qTokens.size, method: "keyword" as const };
    })
    .filter(r => r.score > 0)
    .sort((x, y) => y.score - x.score)
    .slice(0, limit);
}

/** Note store with pluggable persistence (localStorage in the app, memory in tests). */
export interface KV {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export class NoteStore {
  private notes = new Map<string, Note>();
  private counter = 0;
  constructor(private kv?: KV, private key = "neural-notes/v1") {
    const raw = kv?.getItem(this.key);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Array<Omit<Note, "vector" | "seq"> & { seq?: number }>;
        for (const n of parsed) {
          const s = n.seq ?? this.counter; // tolerate pre-seq stored data
          this.notes.set(n.id, { ...n, seq: s });
          this.counter = Math.max(this.counter, s + 1);
        }
      } catch {
        /* corrupted store — start fresh */
      }
    }
  }

  all(): Note[] {
    return [...this.notes.values()].sort((a, b) => b.seq - a.seq);
  }

  add(text: string): Note {
    const trimmed = text.trim();
    if (!trimmed) throw new Error("Note text is empty");
    const note: Note = {
      id: `n_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      text: trimmed,
      createdAt: Date.now(),
      seq: this.counter++,
    };
    this.notes.set(note.id, note);
    this.persist();
    return note;
  }

  remove(id: string): void {
    this.notes.delete(id);
    this.persist();
  }

  setVector(id: string, vector: Float32Array): void {
    const n = this.notes.get(id);
    if (n) n.vector = vector;
  }

  get size(): number {
    return this.notes.size;
  }

  private persist(): void {
    // vectors are recomputed on load — never serialized (keeps storage tiny)
    this.kv?.setItem(
      this.key,
      JSON.stringify(this.all().map(({ vector: _v, ...rest }) => rest)),
    );
  }
}
