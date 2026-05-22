import type { BeatNote, TimingResult, TimingWindow } from "../data/types";
import { DEFAULT_TIMING } from "../data/types";
import type { SealType } from "../hand-detection/types";

export interface NoteHitEvent {
  note: BeatNote;
  result: TimingResult;
  delta: number;   // ms, negative = early
}

export interface NoteMissEvent {
  note: BeatNote;
}

export class RhythmEngine {
  private notes: BeatNote[] = [];
  private nextIdx = 0;
  private startTime = 0;
  private running = false;
  private window: TimingWindow;

  // Active notes — spawned and waiting for input
  private active: BeatNote[] = [];

  onNoteSpawn: ((note: BeatNote) => void) | null = null;
  onNoteHit:   ((evt: NoteHitEvent) => void) | null = null;
  onNoteMiss:  ((evt: NoteMissEvent) => void) | null = null;
  onSongEnd:   (() => void) | null = null;

  constructor(window: TimingWindow = DEFAULT_TIMING) {
    this.window = window;
  }

  load(notes: BeatNote[]): void {
    this.notes = [...notes].sort((a, b) => a.time - b.time);
    this.nextIdx = 0;
    this.active = [];
  }

  // Reset note pointer to start without changing running state or callbacks.
  // Pass notes to also replace the note list (e.g. for a fresh loop copy).
  reload(notes?: BeatNote[]): void {
    if (notes !== undefined) this.notes = [...notes].sort((a, b) => a.time - b.time);
    this.nextIdx = 0;
    this.active = [];
  }

  start(): void {
    this.startTime = performance.now();
    this.running = true;
  }

  stop(): void {
    this.running = false;
  }

  get currentTime(): number {
    return (performance.now() - this.startTime) / 1000;
  }

  // Call once per animation frame
  update(songTime: number): void {
    if (!this.running) return;

    const t = songTime;
    const spawnAhead = 2.0; // seconds ahead to spawn notes

    // Spawn upcoming notes
    while (this.nextIdx < this.notes.length &&
           this.notes[this.nextIdx].time <= t + spawnAhead) {
      const note = this.notes[this.nextIdx++];
      this.active.push(note);
      this.onNoteSpawn?.(note);
    }

    // Expire missed notes
    const missWindow = this.window.ok / 1000;
    for (let i = this.active.length - 1; i >= 0; i--) {
      if (t > this.active[i].time + missWindow) {
        const missed = this.active.splice(i, 1)[0];
        this.onNoteMiss?.({ note: missed });
      }
    }

    // Check song completion
    if (this.nextIdx >= this.notes.length && this.active.length === 0) {
      this.running = false;
      this.onSongEnd?.();
    }
  }

  // Called when a seal is detected.
  // Enforces strict sequential order: only the earliest active note can be hit.
  // A later note cannot be accepted while an earlier one is still on screen.
  inputSeal(seal: SealType, songTime: number): void {
    if (!this.running) return;
    if (seal === "none") return;
    if (this.active.length === 0) return;

    // Target is always active[0] — notes stay sorted by time, never skip ahead
    const note = this.active[0];
    if (note.seal !== seal) return;

    const delta = Math.abs(songTime - note.time) * 1000;
    if (delta > this.window.ok) return; // too early or too late

    this.active.splice(0, 1);
    const signedDelta = (songTime - note.time) * 1000;

    let result: TimingResult;
    if (delta <= this.window.perfect) result = "perfect";
    else if (delta <= this.window.good) result = "good";
    else result = "ok";

    this.onNoteHit?.({ note, result, delta: signedDelta });
  }
}
