import { describe, it, expect } from "vitest";
import {
  cosineSimilarity,
  rankBySimilarity,
  rankByKeywords,
  NoteStore,
  type Note,
  type KV,
} from "../search";

const vec = (...n: number[]) => Float32Array.from(n);

let seq = 0;
const note = (id: string, text: string, vector?: Float32Array): Note => ({
  id,
  text,
  createdAt: Date.now(),
  seq: seq++,
  vector,
});

describe("cosineSimilarity", () => {
  it("is 1 for identical vectors", () => {
    expect(cosineSimilarity(vec(1, 2, 3), vec(1, 2, 3))).toBeCloseTo(1);
  });
  it("is 0 for orthogonal vectors", () => {
    expect(cosineSimilarity(vec(1, 0), vec(0, 1))).toBeCloseTo(0);
  });
  it("is -1 for opposite vectors", () => {
    expect(cosineSimilarity(vec(1, 0), vec(-1, 0))).toBeCloseTo(-1);
  });
  it("handles zero and mismatched vectors safely", () => {
    expect(cosineSimilarity(vec(0, 0), vec(1, 1))).toBe(0);
    expect(cosineSimilarity(vec(1), vec(1, 2))).toBe(0);
    expect(cosineSimilarity(vec(), vec())).toBe(0);
  });
});

describe("rankBySimilarity", () => {
  const notes = [
    note("far", "unrelated", vec(0, 1, 0)),
    note("close", "very related", vec(0.9, 0.1, 0)),
    note("exact", "the same thing", vec(1, 0, 0)),
    note("unembedded", "no vector yet"),
  ];

  it("orders by similarity, best first", () => {
    const results = rankBySimilarity(vec(1, 0, 0), notes);
    expect(results.map(r => r.note.id)).toEqual(["exact", "close", "far"]);
  });
  it("maps scores into [0,1] and skips unembedded notes", () => {
    const results = rankBySimilarity(vec(1, 0, 0), notes);
    for (const r of results) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1);
    }
    expect(results.find(r => r.note.id === "unembedded")).toBeUndefined();
  });
  it("respects the limit", () => {
    expect(rankBySimilarity(vec(1, 0, 0), notes, 2)).toHaveLength(2);
  });
});

describe("rankByKeywords", () => {
  const notes = [
    note("a", "Oil change due for the car service"),
    note("b", "Quarterly budget review with finance"),
    note("c", "The car brake pads are squeaking"),
  ];

  it("finds notes sharing tokens with the query", () => {
    const ids = rankByKeywords("car service", notes).map(r => r.note.id);
    expect(ids[0]).toBe("a"); // matches both tokens
    expect(ids).toContain("c"); // matches "car"
    expect(ids).not.toContain("b");
  });
  it("is case-insensitive and ignores punctuation", () => {
    expect(rankByKeywords("BUDGET, review!", notes)[0].note.id).toBe("b");
  });
  it("returns empty for empty or stop-ish queries", () => {
    expect(rankByKeywords("", notes)).toEqual([]);
    expect(rankByKeywords("a", notes)).toEqual([]); // single-char tokens dropped
  });
});

describe("NoteStore", () => {
  const memKV = (): KV & { data: Map<string, string> } => {
    const data = new Map<string, string>();
    return {
      data,
      getItem: k => data.get(k) ?? null,
      setItem: (k, v) => void data.set(k, v),
    };
  };

  it("adds, lists newest-first (deterministic even same-millisecond), removes", () => {
    const store = new NoteStore();
    const first = store.add("first");
    const second = store.add("second");
    const third = store.add("third");
    expect(store.all().map(n => n.id)).toEqual([third.id, second.id, first.id]);
    store.remove(first.id);
    expect(store.size).toBe(2);
  });

  it("keeps ordering stable across persistence reloads", () => {
    const kv = memKV();
    const store = new NoteStore(kv);
    store.add("one");
    store.add("two");
    const reloaded = new NoteStore(kv);
    expect(reloaded.all().map(n => n.text)).toEqual(["two", "one"]);
    reloaded.add("three");
    expect(reloaded.all()[0].text).toBe("three");
  });

  it("rejects empty notes", () => {
    expect(() => new NoteStore().add("   ")).toThrow();
  });

  it("persists to KV and reloads — without vectors", () => {
    const kv = memKV();
    const store = new NoteStore(kv);
    const n = store.add("remember me");
    store.setVector(n.id, vec(1, 2, 3));

    const reloaded = new NoteStore(kv);
    expect(reloaded.size).toBe(1);
    expect(reloaded.all()[0].text).toBe("remember me");
    expect(reloaded.all()[0].vector).toBeUndefined();
  });

  it("survives corrupted persistence", () => {
    const kv = memKV();
    kv.setItem("neural-notes/v1", "{not json");
    expect(new NoteStore(kv).size).toBe(0);
  });
});
