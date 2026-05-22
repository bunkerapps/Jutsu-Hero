import type { BeatMap, TimingWindow } from "./types";
import type { SealType } from "../hand-detection/types";

interface BeatMapJSON {
  id: string;
  jutsuId: string;
  difficultyId: string;
  bpm: number;
  audioFile: string;
  audioOffsetSeconds: number;
  notes: Array<{ time: number; seal: string; lane: number }>;
}

interface DifficultyJSON {
  id: string;
  name: string;
  speedMultiplier: number;
  timingWindows: { perfect: number; good: number; ok: number };
}

interface JutsuJSON {
  id: string;
  name: string;
  nameES: string;
  nameJA?: string;
  clan: string;
  element: string;
  difficultyRating: number;
  sealSequence: string[];
  character: string;
}

interface SealJSON {
  id: string;
  index: number;
  japanese: string;
  sprite: string;
  spriteBW: string;
}

export interface GameDataStore {
  beatmaps: BeatMap[];
  difficulties: DifficultyJSON[];
  jutsus: JutsuJSON[];
  seals: SealJSON[];
}

export async function loadGameData(): Promise<GameDataStore> {
  const [bmRes, diffRes, jutsuRes, sealRes] = await Promise.all([
    fetch("assets/data/beatmaps.json"),
    fetch("assets/data/difficulty.json"),
    fetch("assets/data/jutsus.json"),
    fetch("assets/data/seals.json"),
  ]);

  const [bmData, diffData, jutsuData, sealData] = await Promise.all([
    bmRes.json()   as Promise<{ beatmaps: BeatMapJSON[] }>,
    diffRes.json() as Promise<{ difficulties: DifficultyJSON[] }>,
    jutsuRes.json() as Promise<{ jutsus: JutsuJSON[] }>,
    sealRes.json() as Promise<{ seals: SealJSON[] }>,
  ]);

  const diffMap = new Map(diffData.difficulties.map(d => [d.id, d]));

  const beatmaps: BeatMap[] = bmData.beatmaps.map(bm => {
    const diff = diffMap.get(bm.difficultyId);
    const tw: TimingWindow = diff
      ? diff.timingWindows
      : { perfect: 180, good: 350, ok: 550 };

    return {
      id: bm.id,
      jutsuId: bm.jutsuId,
      difficultyId: bm.difficultyId,
      title: bm.id,
      artist: "Jutsu Hero",
      bpm: bm.bpm,
      audioFile: bm.audioFile,
      audioOffsetSeconds: bm.audioOffsetSeconds,
      timingWindows: tw,
      notes: bm.notes.map(n => ({
        time: n.time,
        seal: n.seal as SealType,
        lane: n.lane,
      })),
    };
  });

  return {
    beatmaps,
    difficulties: diffData.difficulties,
    jutsus: jutsuData.jutsus,
    seals: sealData.seals,
  };
}
