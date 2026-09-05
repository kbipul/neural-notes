// Embedding layer. The transformers.js pipeline is lazy-loaded so the app
// paints instantly and tests never touch the network.

export interface Embedder {
  embed(texts: string[]): Promise<Float32Array[]>;
}

type FeatureExtractor = (
  texts: string[],
  opts: { pooling: "mean"; normalize: boolean },
) => Promise<{ tolist(): number[][] }>;

/**
 * MiniLM-L6-v2 via transformers.js — ~23 MB quantized ONNX, downloaded once
 * by the browser and cached. Runs on WASM/WebGPU, fully client-side.
 */
export class TransformersEmbedder implements Embedder {
  private extractorPromise: Promise<FeatureExtractor> | null = null;

  constructor(
    private model = "Xenova/all-MiniLM-L6-v2",
    private onProgress?: (msg: string) => void,
  ) {}

  private load(): Promise<FeatureExtractor> {
    this.extractorPromise ??= (async () => {
      const { pipeline } = await import("@huggingface/transformers");
      this.onProgress?.("Downloading model (one time, ~23 MB)…");
      const extractor = await pipeline("feature-extraction", this.model, {
        dtype: "q8",
        progress_callback: (p: { status?: string; progress?: number }) => {
          if (p.status === "progress" && typeof p.progress === "number") {
            this.onProgress?.(`Downloading model… ${Math.round(p.progress)}%`);
          }
        },
      });
      this.onProgress?.("Model ready");
      return extractor as unknown as FeatureExtractor;
    })();
    return this.extractorPromise;
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    const extractor = await this.load();
    const output = await extractor(texts, { pooling: "mean", normalize: true });
    return output.tolist().map(v => Float32Array.from(v));
  }
}
