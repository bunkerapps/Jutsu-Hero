import type { SealType } from "../hand-detection/types";

export interface BeatNote {
  time: number;       // seconds from song start
  seal: SealType;
  lane: number;       // 0-3
}

export interface BeatMap {
  id: string;
  jutsuId: string;
  difficultyId: string;
  title: string;
  artist: string;
  bpm: number;
  audioFile: string;
  audioOffsetSeconds: number;
  timingWindows: TimingWindow;
  notes: BeatNote[];
}

export interface JutsuData {
  id: string;
  name: string;
  seals: SealType[];
  beatMapId: string;
  clan: string;
}

export type TimingResult = "perfect" | "good" | "ok" | "miss";

export interface TimingWindow {
  perfect: number;  // ms
  good: number;
  ok: number;
}

export const DEFAULT_TIMING: TimingWindow = {
  perfect: 180,
  good:    350,
  ok:      550,
};
