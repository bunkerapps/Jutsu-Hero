import * as ort from "onnxruntime-web";
import { preprocessLandmarks } from "./LandmarkPreprocessor";
import type { HandFrame, SealType } from "./types";
import { SEAL_LABELS } from "./types";

const CONFIDENCE_THRESHOLD = 0.6;
const SMOOTHING_WINDOW = 3;

export class SealClassifier {
  private session!: ort.InferenceSession;
  private history: SealType[] = [];

  async init(modelUrl: string): Promise<SealClassifier> {
    // Serve WASM locally to avoid CDN MIME/COEP issues. numThreads=1 avoids
    // SharedArrayBuffer requirement (no COEP needed for single-threaded WASM).
    ort.env.wasm.wasmPaths = "./assets/ort-wasm/";
    ort.env.wasm.numThreads = 1;
    this.session = await ort.InferenceSession.create(modelUrl, {
      executionProviders: ["wasm"],
    });
    return this;
  }

  async classify(frame: HandFrame): Promise<SealType> {
    const features = preprocessLandmarks(frame);
    const tensor = new ort.Tensor("float32", features, [1, 84]);
    const feeds = { [this.session.inputNames[0]]: tensor };
    const results = await this.session.run(feeds);

    const output = results[this.session.outputNames[0]].data as Float32Array;
    const maxIdx = argmax(output);
    const confidence = output[maxIdx];

    const raw: SealType = confidence >= CONFIDENCE_THRESHOLD
      ? SEAL_LABELS[maxIdx]
      : "none";

    return this.smooth(raw);
  }

  private smooth(seal: SealType): SealType {
    this.history.push(seal);
    if (this.history.length > SMOOTHING_WINDOW) this.history.shift();

    // Majority vote over window
    const counts = new Map<SealType, number>();
    for (const s of this.history) counts.set(s, (counts.get(s) ?? 0) + 1);

    let best: SealType = "none";
    let bestCount = 0;
    for (const [s, c] of counts) {
      if (c > bestCount) { best = s; bestCount = c; }
    }
    return best;
  }
}

function argmax(arr: Float32Array): number {
  let maxIdx = 0;
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] > arr[maxIdx]) maxIdx = i;
  }
  return maxIdx;
}
