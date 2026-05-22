import {
  HandLandmarker,
  FilesetResolver,
  type HandLandmarkerResult,
} from "@mediapipe/tasks-vision";
import type { HandFrame } from "./types";

const MEDIAPIPE_CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/wasm";
const HAND_MODEL_URL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

export class MediaPipeDetector {
  private landmarker!: HandLandmarker;
  private video: HTMLVideoElement;
  private rafId = -1;
  private lastTimestamp = -1;

  /** Called every frame with the single-player (P1) frame — backward compat */
  onFrame: ((frame: HandFrame) => void) | null = null;

  /** Called every frame with both player frames for Battle mode */
  onDualFrame: ((p1: HandFrame | null, p2: HandFrame | null) => void) | null = null;

  /** Latest detected frames — readable at any time for overlay tracking */
  lastP1: HandFrame | null = null;
  lastP2: HandFrame | null = null;

  constructor(video: HTMLVideoElement) {
    this.video = video;
  }

  async init(): Promise<void> {
    const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_CDN);
    this.landmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: HAND_MODEL_URL,
        delegate: "GPU",
      },
      runningMode: "VIDEO",
      numHands: 4,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
  }

  start(): void {
    if (this.rafId !== -1) return;
    this.loop();
  }

  stop(): void {
    if (this.rafId !== -1) {
      cancelAnimationFrame(this.rafId);
      this.rafId = -1;
    }
  }

  private loop = (): void => {
    this.rafId = requestAnimationFrame(this.loop);
    if (this.video.readyState < 2) return;
    const now = performance.now();
    if (now === this.lastTimestamp) return;
    this.lastTimestamp = now;
    const result = this.landmarker.detectForVideo(this.video, now);
    this.processResult(result, now);
  };

  private processResult(result: HandLandmarkerResult, timestamp: number): void {
    if (!result.landmarks || result.landmarks.length === 0) {
      this.onDualFrame?.(null, null);
      return;
    }

    // ── Single-player backward-compat frame ───────────────────────────────
    const [primary, secondary] = this.orderHands(result);
    if (primary) {
      const frame: HandFrame = {
        landmarks: primary,
        secondaryLandmarks: secondary,
        confidence: 1,
        timestamp: timestamp / 1000,
      };
      this.onFrame?.(frame);
      this.lastP1 = frame;
    }

    // ── Dual-player frame ─────────────────────────────────────────────────
    if (this.onDualFrame) {
      const { p1, p2 } = this.splitForDual(result, timestamp);
      this.lastP1 = p1;
      this.lastP2 = p2;
      this.onDualFrame(p1, p2);
    }
  }

  // ── Dual-player hand splitting ────────────────────────────────────────────
  // Splits detected hands into two player slots by raw-video x position.
  // Raw-video x > 0.5 → P1 (appears on screen-LEFT after CSS scaleX(-1) mirror).
  // Raw-video x ≤ 0.5 → P2 (appears on screen-RIGHT after CSS mirror).
  // Dead zone ±DEAD around the center prevents hands near the boundary from
  // jumping between players.
  private p1LastX = 0.75;   // hysteresis: last known P1 centroid x
  private p2LastX = 0.25;   // hysteresis: last known P2 centroid x

  private splitForDual(
    result: HandLandmarkerResult,
    timestamp: number,
  ): { p1: HandFrame | null; p2: HandFrame | null } {
    const n = result.landmarks.length;
    const t = timestamp / 1000;
    if (n === 0) return { p1: null, p2: null };

    // Dead zone: hands within DEAD of 0.5 are assigned by their last known side
    const DEAD = 0.07;
    const p1Indices: number[] = [];
    const p2Indices: number[] = [];
    for (let i = 0; i < n; i++) {
      const x = result.landmarks[i][0].x;
      if (x > 0.5 + DEAD)      p1Indices.push(i);       // clearly P1's side
      else if (x < 0.5 - DEAD) p2Indices.push(i);       // clearly P2's side
      else {
        // In dead zone: assign to whichever player centroid is closer
        const toP1 = Math.abs(x - this.p1LastX);
        const toP2 = Math.abs(x - this.p2LastX);
        (toP1 <= toP2 ? p1Indices : p2Indices).push(i);
      }
    }

    // Update centroids for hysteresis
    if (p1Indices.length) {
      const avgX = p1Indices.reduce((s, i) => s + result.landmarks[i][0].x, 0) / p1Indices.length;
      this.p1LastX = this.p1LastX * 0.7 + avgX * 0.3;
    }
    if (p2Indices.length) {
      const avgX = p2Indices.reduce((s, i) => s + result.landmarks[i][0].x, 0) / p2Indices.length;
      this.p2LastX = this.p2LastX * 0.7 + avgX * 0.3;
    }

    const buildGroupFrame = (indices: number[]): HandFrame | null => {
      if (indices.length === 0) return null;
      // Within the group prefer: Left hand = primary, Right hand = secondary
      let primaryIdx = indices[0];
      let secondaryIdx: number | null = null;
      for (const i of indices) {
        const label = result.handedness[i]?.[0]?.categoryName ?? "";
        if (label === "Left")  primaryIdx   = i;
        else if (label === "Right") secondaryIdx = i;
      }
      return {
        landmarks: result.landmarks[primaryIdx],
        secondaryLandmarks: secondaryIdx !== null ? result.landmarks[secondaryIdx] : null,
        confidence: 1,
        timestamp: t,
      };
    };

    return { p1: buildGroupFrame(p1Indices), p2: buildGroupFrame(p2Indices) };
  }

  // Order hands: Left → primary, Right → secondary (matches training convention)
  private orderHands(result: HandLandmarkerResult) {
    if (result.landmarks.length === 1) {
      return [result.landmarks[0], null] as const;
    }

    const label = (i: number) => result.handedness[i]?.[0]?.categoryName ?? "";
    const l0 = label(0);
    const l1 = label(1);

    if (l0 === "Left"  && l1 === "Right") return [result.landmarks[0], result.landmarks[1]] as const;
    if (l0 === "Right" && l1 === "Left")  return [result.landmarks[1], result.landmarks[0]] as const;

    // Fallback: order by wrist.x
    const x0 = result.landmarks[0][0].x;
    const x1 = result.landmarks[1][0].x;
    return x0 <= x1
      ? [result.landmarks[0], result.landmarks[1]] as const
      : [result.landmarks[1], result.landmarks[0]] as const;
  }
}
