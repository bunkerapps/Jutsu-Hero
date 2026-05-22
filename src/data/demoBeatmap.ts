import type { BeatMap } from "./types";

// Fallback beatmap used only if GameData.loadGameData() fails.
// Real beatmaps are loaded from public/assets/data/beatmaps.json
export const DEMO_BEATMAP: BeatMap = {
  id: "kage_bunshin_tutorial",
  jutsuId: "kage_bunshin",
  difficultyId: "tutorial",
  title: "Shadow Clone Jutsu",
  artist: "Jutsu Hero",
  bpm: 60,
  audioFile: "assets/audio/music/menu.mp3",
  audioOffsetSeconds: 0,
  timingWindows: { perfect: 350, good: 600, ok: 1000 },
  notes: [
    { time: 4.00,  seal: "rat",     lane: 0 },
    { time: 8.00,  seal: "ox",      lane: 1 },
    { time: 12.00, seal: "tiger",   lane: 2 },
    { time: 16.00, seal: "hare",    lane: 3 },
    { time: 20.00, seal: "dragon",  lane: 0 },
    { time: 24.00, seal: "serpent", lane: 1 },
    { time: 28.00, seal: "horse",   lane: 2 },
    { time: 32.00, seal: "ram",     lane: 3 },
    { time: 36.00, seal: "monkey",  lane: 0 },
    { time: 40.00, seal: "bird",    lane: 1 },
    { time: 44.00, seal: "dog",     lane: 2 },
    { time: 48.00, seal: "boar",    lane: 3 },
  ],
};
