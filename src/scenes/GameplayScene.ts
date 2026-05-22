import Phaser from "phaser";
import { RhythmEngine } from "../rhythm/RhythmEngine";
import { ComboTracker } from "../rhythm/ComboTracker";
import type { BeatNote, BeatMap } from "../data/types";
import type { SealType } from "../hand-detection/types";
import type { NoteHitEvent, NoteMissEvent } from "../rhythm/RhythmEngine";
import { DEMO_BEATMAP } from "../data/demoBeatmap";
import type { GameDataStore } from "../data/GameData";

function musicVol() { return ((window as any)._audioVol?.music ?? 1) as number; }
function sfxVol()   { return ((window as any)._audioVol?.sfx   ?? 1) as number; }

// ── Layout constants ────────────────────────────────────────────────────────
const LEFT_W_RATIO  = 0.70;
const HIT_Y_RATIO   = 0.80;
const BASE_SPEED    = 300;
const TIME_LIMIT_SEC = 60;

// ── Seal display data ───────────────────────────────────────────────────────
const SEAL_KANJI: Record<string, string> = {
  rat: "子", ox: "丑", tiger: "寅", hare: "卯",
  dragon: "辰", serpent: "巳", horse: "午", ram: "未",
  monkey: "申", bird: "酉", dog: "戌", boar: "亥",
};

const SEAL_COLOR_KEY: Record<string, string> = {
  rat: "seal_rat_c",     ox: "seal_ox_c",     tiger: "seal_tiger_c",
  hare: "seal_hare_c",   dragon: "seal_dragon_c", serpent: "seal_serpent_c",
  horse: "seal_horse_c", ram: "seal_ram_c",   monkey: "seal_monkey_c",
  bird: "seal_bird_c",   dog: "seal_dog_c",   boar: "seal_boar_c",
};

const CARD_W = 270;
const CARD_H = 160;

interface SceneData {
  beatmapId?: string;
  speedMultiplier?: number;
}

// Generate N looping copies of a note sequence offset in time
function buildLoopingNotes(base: BeatNote[], loops: number): { notes: BeatNote[]; cycleDuration: number } {
  const sorted = [...base].sort((a, b) => a.time - b.time);
  if (!sorted.length) return { notes: [], cycleDuration: 0 };

  const lastTime   = sorted[sorted.length - 1].time;
  const firstTime  = sorted[0].time;
  const avgGap     = sorted.length > 1
    ? (lastTime - firstTime) / (sorted.length - 1)
    : 2;
  const cycleDuration = lastTime + avgGap;

  const result: BeatNote[] = [];
  for (let i = 0; i < loops; i++) {
    for (const n of sorted) {
      result.push({ ...n, time: n.time + i * cycleDuration });
    }
  }
  return { notes: result, cycleDuration };
}

export class GameplayScene extends Phaser.Scene {
  private engine!: RhythmEngine;
  private combo!: ComboTracker;
  private noteObjects = new Map<BeatNote, Phaser.GameObjects.Container>();

  // HUD
  private scoreText!: Phaser.GameObjects.Text;
  private comboText!: Phaser.GameObjects.Text;
  private timerText!: Phaser.GameObjects.Text;
  private timerBar!: Phaser.GameObjects.Rectangle;
  private sealText!: Phaser.GameObjects.Text;
  private progressText!: Phaser.GameObjects.Text;
  private completionsText!: Phaser.GameObjects.Text;

  // Queue panel
  private queueItems: Phaser.GameObjects.Container[] = [];
  private sealSequence: string[] = [];
  private sealsHit = 0;         // within current cycle
  private totalSealsHit = 0;    // across all cycles
  private completions = 0;

  // Timing
  private songStartTime = 0;   // for the countdown timer only (never reset)
  private engineStartTime = 0; // for note timing (resets on sequence restart)
  private songTime = 0;
  private loopNotes: BeatNote[] = [];
  private lastSealSeen: SealType = "none";
  private noteSpeed   = BASE_SPEED;
  private baseSpeed   = BASE_SPEED;   // starting speed for this session
  private musicSound: Phaser.Sound.BaseSound | null = null;
  private lastSfxTime = 0;
  private gameEnded   = false;

  // Layout
  private leftW = 0;
  private hitLineY = 0;

  constructor() { super("Gameplay"); }

  create(data: SceneData) {
    // Reset all state on every create() call
    this.noteObjects    = new Map();
    this.queueItems     = [];
    this.sealSequence   = [];
    this.loopNotes      = [];
    this.sealsHit       = 0;
    this.totalSealsHit  = 0;
    this.completions    = 0;
    this.songTime       = 0;
    // Initialize to future time so timer is negative (clamped to 0) until engine actually starts
    this.songStartTime  = performance.now() + 1000;
    this.engineStartTime = performance.now() + 1000;
    this.lastSealSeen   = "none";
    this.lastSfxTime    = 0;
    this.gameEnded      = false;

    const { width, height } = this.scale;
    this.leftW     = Math.floor(width * LEFT_W_RATIO);
    this.hitLineY  = height * HIT_Y_RATIO;
    this.baseSpeed  = BASE_SPEED * (data.speedMultiplier ?? 1.0);
    this.noteSpeed  = this.baseSpeed;

    // ── Pick beatmap ──────────────────────────────────────────────────────
    const gameData = this.registry.get("gameData") as GameDataStore | null;
    let beatmap: BeatMap = DEMO_BEATMAP;
    let jutsuName   = "Shadow Clone Jutsu";
    let jutsuNameJA = "影分身の術";

    if (gameData && data.beatmapId) {
      const found = gameData.beatmaps.find(b => b.id === data.beatmapId);
      if (found) {
        beatmap = found;
        const jutsu = gameData.jutsus.find(j => j.id === found.jutsuId);
        if (jutsu) {
          jutsuName   = jutsu.name;
          jutsuNameJA = jutsu.nameJA ?? jutsu.name;
          this.sealSequence = jutsu.sealSequence;
        }
      }
    }
    if (!this.sealSequence.length) this.sealSequence = beatmap.notes.map(n => n.seal);

    // ── Build looping notes ───────────────────────────────────────────────
    // Enough loops to fill TIME_LIMIT_SEC + 10s buffer
    const { notes: loopNotes } = buildLoopingNotes(
      beatmap.notes,
      Math.ceil((TIME_LIMIT_SEC + 10) / Math.max(1, beatmap.notes[beatmap.notes.length - 1]?.time ?? 10)) + 2,
    );
    this.loopNotes = loopNotes;

    // ── Left panel: camera + notes ────────────────────────────────────────
    this.add.rectangle(0, 0, this.leftW, height, 0x000000, 0.18).setOrigin(0);

    this.add.rectangle(0, this.hitLineY, this.leftW, 3, 0xffffff, 0.65).setOrigin(0, 0.5);
    // Single centered hit zone
    this.add.ellipse(this.leftW / 2, this.hitLineY, this.leftW - 32, 32, 0x44aaff, 0.18);

    // ── Right panel ───────────────────────────────────────────────────────
    const panelX = this.leftW;
    const panelW = width - this.leftW;
    this.add.rectangle(panelX, 0, panelW, height, 0x0d0d1a).setOrigin(0);
    this.add.rectangle(panelX, 0, 3, height, 0x334488).setOrigin(0);

    this.add.text(panelX + panelW / 2, 18, jutsuNameJA, {
      fontFamily: "monospace", fontSize: "20px", color: "#ccccff",
    }).setOrigin(0.5, 0);
    this.add.text(panelX + panelW / 2, 46, jutsuName, {
      fontFamily: "monospace", fontSize: "12px", color: "#666688",
    }).setOrigin(0.5, 0);
    this.add.rectangle(panelX + 8, 68, panelW - 16, 1, 0x334488).setOrigin(0);

    // ── Seal queue ────────────────────────────────────────────────────────
    const queueTop  = 78;
    const queueBot  = height - 100;
    const queueH    = queueBot - queueTop;
    const itemH     = Math.min(78, Math.max(36, Math.floor(queueH / this.sealSequence.length)));
    const thumbH    = itemH - 6;

    this.sealSequence.forEach((seal, i) => {
      const cx = panelX + panelW / 2;
      const cy = queueTop + i * itemH + itemH / 2;
      const container = this.add.container(cx, cy);

      const bg = this.add.rectangle(0, 0, panelW - 16, itemH - 4, 0x1a1a2e).setOrigin(0.5);
      container.add(bg);

      // Image: height-constrained, 4:3 aspect ratio (source images are 320×240)
      const imgH_q = thumbH;
      const imgW_q = Math.round(imgH_q * 4 / 3);
      const imgX_q = -(panelW / 2 - imgW_q / 2 - 6);  // left-aligned with small margin
      const colorKey = SEAL_COLOR_KEY[seal];
      if (colorKey && this.textures.exists(colorKey)) {
        const img = this.add.image(imgX_q, 0, colorKey)
          .setDisplaySize(imgW_q, imgH_q).setOrigin(0.5);
        container.add(img);
      }

      const kanji = SEAL_KANJI[seal] ?? "?";
      const labelX_q = imgX_q + imgW_q / 2 + 8;  // right of image
      const label = this.add.text(labelX_q, 0,
        `${kanji} ${seal.toUpperCase()}`, {
          fontFamily: "monospace", fontSize: "12px", color: "#aaaacc",
        }).setOrigin(0, 0.5);
      container.add(label);

      this.queueItems.push(container);
    });
    this.updateQueueHighlight();

    // ── Right panel bottom: completions + progress ────────────────────────
    this.completionsText = this.add.text(panelX + panelW / 2, height - 88,
      "× 0  completados", {
        fontFamily: "monospace", fontSize: "18px", color: "#ffdd00",
        stroke: "#000000", strokeThickness: 2,
      }).setOrigin(0.5, 0);

    this.progressText = this.add.text(panelX + panelW / 2, height - 56,
      `0 / ${this.sealSequence.length}`, {
        fontFamily: "monospace", fontSize: "34px", color: "#ffffff",
        stroke: "#000000", strokeThickness: 3,
      }).setOrigin(0.5, 0.5);

    // ── Left panel HUD ────────────────────────────────────────────────────
    this.scoreText = this.add.text(10, 10, "0", {
      fontFamily: "monospace", fontSize: "26px", color: "#ffffff",
    });
    this.comboText = this.add.text(this.leftW / 2, 10, "", {
      fontFamily: "monospace", fontSize: "22px", color: "#ffcc00",
    }).setOrigin(0.5, 0);
    this.sealText = this.add.text(this.leftW - 10, 10, "—", {
      fontFamily: "monospace", fontSize: "16px", color: "#66ffcc",
    }).setOrigin(1, 0);

    // ── Timer display (bottom of left panel) ─────────────────────────────
    // Timer bar background
    const tbY = height - 36;
    this.add.rectangle(0, tbY, this.leftW, 20, 0x111111, 0.8).setOrigin(0, 0.5);
    this.timerBar = this.add.rectangle(0, tbY, this.leftW, 20, 0x00aaff, 0.85).setOrigin(0, 0.5);

    // Jutsu name in cyan above timer bar
    this.add.text(this.leftW / 2, height - 56, jutsuName.toUpperCase(), {
      fontFamily: "monospace", fontSize: "14px", color: "#00ffdd",
      stroke: "#000000", strokeThickness: 2,
    }).setOrigin(0.5, 0.5);

    // Timer countdown number (large, over bar)
    this.timerText = this.add.text(this.leftW / 2, tbY, `${TIME_LIMIT_SEC}`, {
      fontFamily: "monospace", fontSize: "17px", color: "#ffffff",
      stroke: "#000000", strokeThickness: 2,
    }).setOrigin(0.5, 0.5);

    // ── Rhythm engine ─────────────────────────────────────────────────────
    this.engine = new RhythmEngine();
    this.engine.load(loopNotes);
    this.engine.onNoteSpawn = (note) => this.spawnNote(note);
    this.engine.onNoteHit   = (evt)  => this.onHit(evt);
    this.engine.onNoteMiss  = (evt)  => this.onMiss(evt);
    this.engine.onSongEnd   = ()     => { if (!this.gameEnded) this.endSong(); };

    this.combo = new ComboTracker();

    this.time.delayedCall(1000, () => {
      this.songStartTime   = performance.now();
      this.engineStartTime = performance.now();
      this.engine.start();
      this.sound.stopAll();
      this.sound.play("music_menu", { loop: true, volume: 0.45 * musicVol() });
      this.musicSound = this.sound.get("music_menu");
    });

    // ── Keyboard ─────────────────────────────────────────────────────────
    this.input.keyboard?.on("keydown", (ev: KeyboardEvent) => {
      const map: Record<string, SealType> = {
        "1": "bird", "2": "boar", "3": "dog", "4": "dragon",
        "5": "hare", "6": "horse", "7": "monkey", "8": "ox",
      };
      const seal = map[ev.key];
      if (seal) this.engine.inputSeal(seal, this.songTime);
    });
    this.input.keyboard?.once("keydown-ESC", () => this.endSong());
    this.input.keyboard?.on("keydown-R", () => {
      this.sound.stopAll();
      this.scene.restart({ beatmapId: data.beatmapId, speedMultiplier: data.speedMultiplier });
    });
  }

  update() {
    if (this.gameEnded) return;

    this.songTime = (performance.now() - this.songStartTime) / 1000;

    // Timer uses song time (never reset)
    const timerTime   = Math.max(0, this.songTime);
    // Note engine uses its own start time (reset when sequence restarts)
    const engineTime  = Math.max(0, (performance.now() - this.engineStartTime) / 1000);

    // Timer logic
    const remaining = Math.max(0, TIME_LIMIT_SEC - timerTime);
    const secs = Math.ceil(remaining);
    this.timerText.setText(`${secs}`);
    this.timerBar.width = this.leftW * (remaining / TIME_LIMIT_SEC);
    if (remaining <= 10) this.timerBar.setFillStyle(0xff4400);
    else if (remaining <= 20) this.timerBar.setFillStyle(0xffaa00);
    else this.timerBar.setFillStyle(0x00aaff);

    if (remaining <= 0) { this.endSong(); return; }

    this.engine.update(engineTime);

    // Hand-seal detection (edge-trigger)
    const seal = (this.registry.get("lastSeal") as SealType | undefined) ?? "none";
    if (seal !== "none") this.sealText.setText(seal.toUpperCase());
    if (seal !== "none" && seal !== this.lastSealSeen) {
      this.engine.inputSeal(seal, engineTime);
    }
    this.lastSealSeen = seal;

    // Move note cards
    for (const [note, container] of this.noteObjects) {
      container.y = this.hitLineY - (note.time - engineTime) * this.noteSpeed;
    }
  }

  // ── Note spawning ─────────────────────────────────────────────────────────
  private spawnNote(note: BeatNote) {
    const x = this.leftW / 2;
    const borderColor = 0x44aaff;

    const container = this.add.container(x, -CARD_H / 2 - 10);

    const cardBg = this.add.rectangle(0, 0, CARD_W, CARD_H, 0x111122, 0.92).setOrigin(0.5);
    container.add(cardBg);

    const bw = 3;
    container.add(this.add.rectangle(0, -CARD_H / 2 + bw / 2, CARD_W, bw, borderColor).setOrigin(0.5));
    container.add(this.add.rectangle(0,  CARD_H / 2 - bw / 2, CARD_W, bw, borderColor).setOrigin(0.5));
    container.add(this.add.rectangle(-CARD_W / 2 + bw / 2, 0, bw, CARD_H, borderColor).setOrigin(0.5));
    container.add(this.add.rectangle( CARD_W / 2 - bw / 2, 0, bw, CARD_H, borderColor).setOrigin(0.5));

    const colorKey = SEAL_COLOR_KEY[note.seal];
    if (colorKey && this.textures.exists(colorKey)) {
      const imgW = 140, imgH = 105;
      const img = this.add.image(-CARD_W / 2 + imgW / 2 + 8, 0, colorKey)
        .setDisplaySize(imgW, imgH).setOrigin(0.5);
      container.add(img);
    }

    const kanji = SEAL_KANJI[note.seal] ?? "?";
    container.add(this.add.text(CARD_W / 2 - 52, -18, kanji, {
      fontFamily: "monospace", fontSize: "52px", color: "#ffffff",
      stroke: "#000000", strokeThickness: 4,
    }).setOrigin(0.5));
    container.add(this.add.text(CARD_W / 2 - 52, 28, note.seal.toUpperCase(), {
      fontFamily: "monospace", fontSize: "17px", color: "#cccccc",
    }).setOrigin(0.5));

    this.noteObjects.set(note, container);
  }

  // ── Hit / Miss ────────────────────────────────────────────────────────────
  private onHit(evt: NoteHitEvent) {
    this.noteObjects.get(evt.note)?.destroy();
    this.noteObjects.delete(evt.note);
    this.combo.hit(evt.result);
    this.sealsHit++;
    this.totalSealsHit++;
    this.updateHUD();
    this.updateQueueHighlight();

    // Hit SFX (per-note)
    const sfxMap: Record<string, string> = { perfect: "sfx_perfect", good: "sfx_good", ok: "sfx_ok" };
    const sfxKey = sfxMap[evt.result];
    const now = performance.now();
    if (sfxKey && now - this.lastSfxTime > 150) {
      this.sound.play(sfxKey, { volume: 0.7 * sfxVol() });
      this.lastSfxTime = now;
    }

    const colors: Record<string, string> = { perfect: "#ffff00", good: "#00ff88", ok: "#ffffff" };
    this.showHitText(evt.result.toUpperCase(), colors[evt.result] ?? "#ffffff");

    // Check cycle completion
    if (this.sealsHit >= this.sealSequence.length) {
      this.completions++;
      this.sealsHit = 0;
      this.updateQueueHighlight();
      this.completionsText.setText(`× ${this.completions}  completados`);
      this.sound.play("sfx_jutsu_complete", { volume: 1.0 * sfxVol() });
      this.cameras.main.flash(250, 255, 220, 80);
      this.showJutsuComplete();
      this.applySpeedRamp();
    }
  }

  private onMiss(evt: NoteMissEvent) {
    this.noteObjects.get(evt.note)?.destroy();
    this.noteObjects.delete(evt.note);
    this.combo.hit("miss");

    const now = performance.now();
    if (now - this.lastSfxTime > 150) {
      this.sound.play("sfx_miss", { volume: 0.6 * sfxVol() });
      this.lastSfxTime = now;
    }

    // Sequence integrity: any miss resets the whole sequence from the start.
    // Clear all remaining notes, reload engine from note 0.
    for (const c of this.noteObjects.values()) c.destroy();
    this.noteObjects.clear();
    this.engine.reload(this.loopNotes);
    this.engineStartTime = performance.now();
    this.sealsHit = 0;
    this.updateHUD();
    this.updateQueueHighlight();
    this.cameras.main.flash(180, 255, 30, 30);
    this.showResetText();
  }

  private showResetText() {
    const t = this.add.text(this.leftW / 2, this.hitLineY - 60, "¡VUELVE A EMPEZAR!", {
      fontFamily: "monospace", fontSize: "22px", color: "#ff4444",
      stroke: "#000000", strokeThickness: 4,
    }).setOrigin(0.5).setDepth(20);
    this.tweens.add({
      targets: t, alpha: 0, y: t.y - 55, delay: 350, duration: 500,
      onComplete: () => t.destroy(),
    });
  }

  // ── HUD helpers ───────────────────────────────────────────────────────────
  private showHitText(label: string, color: string) {
    const x = this.leftW / 2;
    const y = this.hitLineY - 40;
    const t = this.add.text(x, y, label, {
      fontFamily: "monospace", fontSize: "22px", color,
      stroke: "#000000", strokeThickness: 2,
    }).setOrigin(0.5);
    this.tweens.add({
      targets: t, y: y - 60, alpha: 0, duration: 600,
      onComplete: () => t.destroy(),
    });
  }

  private updateHUD() {
    this.scoreText.setText(this.combo.score.toLocaleString());
    this.comboText.setText(this.combo.combo > 1 ? `${this.combo.combo}x` : "");
    this.progressText.setText(`${this.sealsHit} / ${this.sealSequence.length}`);
  }

  private updateQueueHighlight() {
    this.queueItems.forEach((container, i) => {
      const bg = container.list[0] as Phaser.GameObjects.Rectangle | undefined;
      if (!bg) return;
      if (i < this.sealsHit) {
        bg.setFillStyle(0x0a0a10);
        bg.setStrokeStyle(0);
        container.setAlpha(0.4);
      } else if (i === this.sealsHit) {
        bg.setFillStyle(0x1a3388);
        bg.setStrokeStyle(2, 0xffdd00);
        container.setAlpha(1.0);
      } else {
        bg.setFillStyle(0x1a1a2e);
        bg.setStrokeStyle(0);
        container.setAlpha(0.85);
      }
    });
  }

  private showJutsuComplete() {
    const { width, height } = this.scale;
    const overlay = this.add.container(width / 2, height / 2 - 60);

    const bg = this.add.rectangle(0, 0, 460, 90, 0x000000, 0.82).setOrigin(0.5);
    const txt = this.add.text(0, -10, "✦  JUTSU COMPLETADO  ✦", {
      fontFamily: "monospace", fontSize: "28px", color: "#ffdd00",
      stroke: "#000000", strokeThickness: 4,
    }).setOrigin(0.5);
    const sub = this.add.text(0, 26, `× ${this.completions}  veces`, {
      fontFamily: "monospace", fontSize: "17px", color: "#ffffff",
    }).setOrigin(0.5);

    overlay.add([bg, txt, sub]);
    overlay.setAlpha(0);

    this.tweens.add({
      targets: overlay, alpha: 1, duration: 180,
      onComplete: () => {
        this.tweens.add({
          targets: overlay, alpha: 0, delay: 900, duration: 400,
          onComplete: () => overlay.destroy(),
        });
      },
    });
  }

  private applySpeedRamp() {
    // Tetris-style: 20% faster each completion, cap at 5×
    const mult     = Math.min(1 + this.completions * 0.20, 5.0);
    const newSpeed = this.baseSpeed * mult;
    if (newSpeed <= this.noteSpeed + 1) return;  // already at cap
    this.noteSpeed = newSpeed;

    // Speed up music proportionally (cap at 2× — adds to the frenzy feeling)
    const musicRate = Math.min(mult, 2.0);
    const snd = this.musicSound as (Phaser.Sound.WebAudioSound | Phaser.Sound.HTML5AudioSound | null);
    if (snd && "setRate" in snd) (snd as Phaser.Sound.WebAudioSound).setRate(musicRate);

    // "¡VEL. ×N!" flash in center
    const { width } = this.scale;
    const label = mult >= 4.9 ? "¡MÁX. VELOCIDAD!" : `⬆ VEL. ×${mult.toFixed(1)}`;
    const t = this.add.text(width / 2, this.hitLineY - 100, label, {
      fontFamily: "monospace", fontSize: "26px",
      color: mult >= 2.9 ? "#ff4444" : "#ffdd00",
      stroke: "#000000", strokeThickness: 4,
    }).setOrigin(0.5).setDepth(25);
    this.tweens.add({
      targets: t, alpha: 0, y: t.y - 60, delay: 300, duration: 700,
      onComplete: () => t.destroy(),
    });
  }

  private endSong() {
    if (this.gameEnded) return;
    this.gameEnded = true;
    this.engine.stop();
    this.sound.stopAll();
    this.scene.start("Results", {
      score:        this.combo.score,
      maxCombo:     this.combo.maxCombo,
      completions:  this.completions,
      totalSealsHit: this.totalSealsHit,
      sealsPerCycle: this.sealSequence.length,
      timePlayed:   TIME_LIMIT_SEC,
    });
  }
}
