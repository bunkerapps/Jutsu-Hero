import Phaser from "phaser";
import { RhythmEngine } from "../rhythm/RhythmEngine";
import { ComboTracker } from "../rhythm/ComboTracker";
import type { BeatNote, BeatMap } from "../data/types";
import type { SealType } from "../hand-detection/types";
import type { NoteHitEvent, NoteMissEvent } from "../rhythm/RhythmEngine";
import { DEMO_BEATMAP } from "../data/demoBeatmap";
import type { GameDataStore } from "../data/GameData";
import { ArcadeAnnouncer } from "../audio/ArcadeAnnouncer";

// Read runtime volume multipliers set by the audio mixer in main.ts
function musicVol() { return ((window as any)._audioVol?.music ?? 1) as number; }
function sfxVol()   { return ((window as any)._audioVol?.sfx   ?? 1) as number; }

// ── Layout ──────────────────────────────────────────────────────────────────
const HW_W      = 300;   // highway width (centered in each half)
const HIT_Y_R   = 0.80;
const CARD_W    = 230;
const CARD_H    = 130;
const BASE_SPD  = 300;
const ROUNDS_TO_WIN = 2;   // best-of-3

// ── Seal display maps ───────────────────────────────────────────────────────
const SEAL_KANJI: Record<string, string> = {
  rat:"子", ox:"丑", tiger:"寅", hare:"卯", dragon:"辰", serpent:"巳",
  horse:"午", ram:"未", monkey:"申", bird:"酉", dog:"戌", boar:"亥",
};
const SEAL_COLOR_KEY: Record<string, string> = {
  rat:"seal_rat_c", ox:"seal_ox_c", tiger:"seal_tiger_c", hare:"seal_hare_c",
  dragon:"seal_dragon_c", serpent:"seal_serpent_c", horse:"seal_horse_c",
  ram:"seal_ram_c", monkey:"seal_monkey_c", bird:"seal_bird_c",
  dog:"seal_dog_c", boar:"seal_boar_c",
};

// P1 keys 1-8 / P2 keys Q-I  →  same 8-seal mapping
const KEY_MAP: Record<string, SealType> = {
  "1":"bird","2":"boar","3":"dog","4":"dragon","5":"hare","6":"horse","7":"monkey","8":"ox",
  "q":"bird","w":"boar","e":"dog","r":"dragon","t":"hare","y":"horse","u":"monkey","i":"ox",
};

interface SceneData { beatmapId?: string; speedMultiplier?: number; }

type RoundState = "countdown" | "playing" | "round_over" | "match_over";

export class BattleScene extends Phaser.Scene {
  // engines + combo per player
  private p1Engine!: RhythmEngine;
  private p2Engine!: RhythmEngine;
  private p1Combo!: ComboTracker;
  private p2Combo!: ComboTracker;

  private p1Notes = new Map<BeatNote, Phaser.GameObjects.Container>();
  private p2Notes = new Map<BeatNote, Phaser.GameObjects.Container>();

  // state
  private jutsuId = "";
  private sealSequence: string[] = [];
  private p1Progress = 0;
  private p2Progress = 0;
  private p1Wins = 0;
  private p2Wins = 0;
  private roundNum = 0;
  private roundState: RoundState = "countdown";
  private p1StartTime = 0;    // per-player note timers (reset on sequence restart)
  private p2StartTime = 0;
  private lastP1Seal: SealType = "none";
  private lastP2Seal: SealType = "none";
  private noteSpeed = BASE_SPD;
  private hitLineY = 0;

  // Hand-replay recording (circular buffers, ~5s at 30fps)
  private readonly HAND_BUF = 150;
  private p1HandBuf: Array<{ lm: {x:number,y:number}[] }> = [];
  private p2HandBuf: Array<{ lm: {x:number,y:number}[] }> = [];

  // HUD refs
  private p1ScoreText!: Phaser.GameObjects.Text;
  private p2ScoreText!: Phaser.GameObjects.Text;
  private p1ProgressText!: Phaser.GameObjects.Text;
  private p2ProgressText!: Phaser.GameObjects.Text;
  private p1WinDots: Phaser.GameObjects.Rectangle[] = [];
  private p2WinDots: Phaser.GameObjects.Rectangle[] = [];
  private roundOverlay!: Phaser.GameObjects.Container;
  private roundLabel!: Phaser.GameObjects.Text;
  private countdownText!: Phaser.GameObjects.Text;
  private sealDetectText!: Phaser.GameObjects.Text;
  private roundNumText!: Phaser.GameObjects.Text;
  private timerText!:    Phaser.GameObjects.Text;

  private half  = 640;   // width / 2, set in create()
  private hwOff = 170;   // (half - HW_W) / 2

  private roundTimerEvent: Phaser.Time.TimerEvent | null = null;
  private roundTimeLeft = 60;

  private beatmap!: BeatMap;
  private lastSfxTime = 0;
  private announcer = new ArcadeAnnouncer();

  constructor() { super("Battle"); }

  create(data: SceneData) {
    this.game.events.emit("battleStart");  // hides any leftover VFX from previous round
    // reset
    this.p1Notes = new Map(); this.p2Notes = new Map();
    this.p1Progress = 0; this.p2Progress = 0;
    this.p1Wins = 0; this.p2Wins = 0;
    this.roundNum = 0; this.roundState = "countdown";
    this.p1StartTime = 0; this.p2StartTime = 0;
    this.lastP1Seal = "none"; this.lastP2Seal = "none"; this.lastSfxTime = 0;
    this.p1WinDots = []; this.p2WinDots = [];
    this.sealSequence = [];
    this.p1HandBuf = []; this.p2HandBuf = [];

    const { width, height } = this.scale;
    this.half  = width / 2;
    this.hwOff = (this.half - HW_W) / 2;
    this.hitLineY = height * HIT_Y_R;
    this.noteSpeed = BASE_SPD * (data.speedMultiplier ?? 1.0);

    // ── Pick beatmap ──────────────────────────────────────────────────────
    const gameData = this.registry.get("gameData") as GameDataStore | null;
    this.beatmap = DEMO_BEATMAP;
    let jutsuName = "Shadow Clone Jutsu";

    if (gameData && data.beatmapId) {
      const found = gameData.beatmaps.find(b => b.id === data.beatmapId);
      if (found) {
        this.beatmap = found;
        const jutsu = gameData.jutsus.find(j => j.id === found.jutsuId);
        if (jutsu) { jutsuName = jutsu.name; this.sealSequence = jutsu.sealSequence; this.jutsuId = jutsu.id; }
      }
    }
    if (!this.sealSequence.length) this.sealSequence = this.beatmap.notes.map(n => n.seal);

    const HDR_H   = 54;   // header strip height
    const BOT_H   = 52;   // bottom progress strip height
    const C1      = 0xff8800;  // P1 orange
    const C2      = 0x4488ff;  // P2 blue

    // ── Themed background ─────────────────────────────────────────────────
    // Village art full-width as base
    this.add.image(width / 2, height / 2, "gameplay_bg")
      .setDisplaySize(width, height).setOrigin(0.5);
    // Dark overlays (per side, tinted with player color)
    this.add.rectangle(0,    0, this.half, height, 0x200800, 0.78).setOrigin(0);
    this.add.rectangle(this.half, 0, this.half, height, 0x000820, 0.78).setOrigin(0);

    // ── Character art in outer zones (outside highway, not blocking notes) ──
    const p2OuterX = this.half + this.hwOff + HW_W;
    const p2OuterW = width - p2OuterX;
    const outerW   = Math.min(this.hwOff, p2OuterW);  // use narrower side as reference
    if (outerW >= 50) {
      // Limit height so images don't look absurdly tall on narrow outer zones
      const charH = Math.min(Math.floor(height * 0.55), Math.floor(outerW * 3));
      const charY  = HDR_H + charH / 2;
      this.add.image(this.hwOff / 2, charY, "char_naruto")
        .setDisplaySize(this.hwOff - 4, charH).setOrigin(0.5).setAlpha(0.55);
      this.add.image(p2OuterX + p2OuterW / 2, charY, "char_sasuke")
        .setDisplaySize(p2OuterW - 4, charH).setOrigin(0.5).setAlpha(0.55);
    }

    // ── Header strips ─────────────────────────────────────────────────────
    this.add.rectangle(0,    0, this.half, HDR_H, 0x1a0800, 0.92).setOrigin(0);
    this.add.rectangle(this.half, 0, this.half, HDR_H, 0x00081a, 0.92).setOrigin(0);
    // Header bottom border line (player color)
    this.add.rectangle(0,    HDR_H - 2, this.half, 2, C1, 0.9).setOrigin(0);
    this.add.rectangle(this.half, HDR_H - 2, this.half, 2, C2, 0.9).setOrigin(0);

    // ── Outer side borders (colored frame per player) ─────────────────────
    this.add.rectangle(0,          0, 4, height, C1, 0.85).setOrigin(0); // P1 left edge
    this.add.rectangle(this.half - 4,   0, 4, height, C1, 0.45).setOrigin(0); // P1 right edge (inner)
    this.add.rectangle(this.half,       0, 4, height, C2, 0.45).setOrigin(0); // P2 left edge (inner)
    this.add.rectangle(width - 4,  0, 4, height, C2, 0.85).setOrigin(0); // P2 right edge

    // ── Center divider — wide decorative column ───────────────────────────
    const DIV_W  = 80;
    const DIV_X  = this.half - DIV_W / 2;   // centered at this.half
    // Background
    this.add.rectangle(DIV_X, 0, DIV_W, height, 0x000000, 0.88).setOrigin(0);
    // Colored edges
    this.add.rectangle(DIV_X,             0, 3, height, C1, 0.80).setOrigin(0);
    this.add.rectangle(DIV_X + DIV_W - 3, 0, 3, height, C2, 0.80).setOrigin(0);
    // Inner glow line
    this.add.rectangle(this.half - 1, 0, 2, height, 0x8899cc, 0.35).setOrigin(0);

    // Small character portraits inside divider
    const portH = Math.min(120, Math.floor((height - HDR_H - 52) * 0.28));
    const portW = DIV_W - 10;
    const portY1 = HDR_H + 16;
    const portY2 = HDR_H + portH + 28;
    this.add.image(this.half, portY1 + portH / 2, "char_naruto")
      .setDisplaySize(portW, portH).setOrigin(0.5).setAlpha(0.9);
    this.add.image(this.half, portY2 + portH / 2, "char_sasuke")
      .setDisplaySize(portW, portH).setOrigin(0.5).setAlpha(0.9);

    // VS label between portraits
    this.add.text(this.half, portY2 - 6, "VS", {
      fontFamily:"monospace", fontSize:"14px", color:"#ffdd00",
      stroke:"#000000", strokeThickness:3,
    }).setOrigin(0.5, 1);

    // Decorative seal kanji column (忍 = shinobi)
    const sealKanji = ["子","丑","寅","卯","辰","巳","午","未","申","酉","戌","亥"];
    const kanjiStartY = portY2 + portH + 20;
    const kanjiStep   = Math.floor((height - 52 - kanjiStartY) / sealKanji.length);
    sealKanji.forEach((k, i) => {
      this.add.text(this.half, kanjiStartY + i * kanjiStep, k, {
        fontFamily:"monospace", fontSize:"11px", color:"#334466",
      }).setOrigin(0.5, 0);
    });

    // 忍 (ninja) large watermark
    this.add.text(this.half, height / 2 + 40, "忍", {
      fontFamily:"monospace", fontSize:"52px", color:"#ffffff",
      stroke:"#000000", strokeThickness:2,
    }).setOrigin(0.5).setAlpha(0.06);

    // ── Bottom progress strips ────────────────────────────────────────────
    this.add.rectangle(0,    height - BOT_H, this.half, BOT_H, 0x1a0800, 0.88).setOrigin(0);
    this.add.rectangle(this.half, height - BOT_H, this.half, BOT_H, 0x00081a, 0.88).setOrigin(0);
    this.add.rectangle(0,    height - BOT_H, this.half, 2, C1, 0.7).setOrigin(0);
    this.add.rectangle(this.half, height - BOT_H, this.half, 2, C2, 0.7).setOrigin(0);

    // ── Highway background + frame ────────────────────────────────────────
    for (let p = 0; p < 2; p++) {
      const ox   = p * this.half + this.hwOff;
      const col  = p === 0 ? C1 : C2;
      // Highway background (slightly lighter)
      this.add.rectangle(ox, HDR_H, HW_W, height - HDR_H - BOT_H, 0x111122, 0.35).setOrigin(0);
      // Highway side borders
      this.add.rectangle(ox,          HDR_H, 2, height - HDR_H - BOT_H, col, 0.5).setOrigin(0);
      this.add.rectangle(ox + HW_W - 2, HDR_H, 2, height - HDR_H - BOT_H, col, 0.5).setOrigin(0);
      // Centered hit zone ellipse
      this.add.ellipse(ox + HW_W / 2, this.hitLineY, HW_W - 16, 28, col, 0.20);
      // Hit line
      this.add.rectangle(ox, this.hitLineY, HW_W, 3, col, 0.85).setOrigin(0, 0.5);
      // Hit line glow
      this.add.rectangle(ox, this.hitLineY, HW_W, 9, col, 0.18).setOrigin(0, 0.5);
    }

    // ── Header: player name ───────────────────────────────────────────────
    this.add.text(this.half / 2, HDR_H / 2, "⚡ P1  NARUTO", {
      fontFamily:"monospace", fontSize:"19px", color:"#ff9922",
      stroke:"#000", strokeThickness:3,
    }).setOrigin(0.5, 0.5);
    this.add.text(this.half + this.half / 2, HDR_H / 2, "P2  SASUKE ⚡", {
      fontFamily:"monospace", fontSize:"19px", color:"#55aaff",
      stroke:"#000", strokeThickness:3,
    }).setOrigin(0.5, 0.5);

    // ── Header: score ─────────────────────────────────────────────────────
    this.p1ScoreText = this.add.text(10, HDR_H / 2, "0", {
      fontFamily:"monospace", fontSize:"20px", color:"#ffffff",
      stroke:"#000", strokeThickness:2,
    }).setOrigin(0, 0.5);
    this.p2ScoreText = this.add.text(this.half + 10, HDR_H / 2, "0", {
      fontFamily:"monospace", fontSize:"20px", color:"#ffffff",
      stroke:"#000", strokeThickness:2,
    }).setOrigin(0, 0.5);

    // ── Header: win dots ─────────────────────────────────────────────────
    for (let i = 0; i < ROUNDS_TO_WIN; i++) {
      const dot = this.add.rectangle(this.half - 16 - i * 22, HDR_H / 2, 14, 14, 0x332200)
        .setOrigin(0.5).setStrokeStyle(2, C1);
      this.p1WinDots.push(dot);
    }
    for (let i = 0; i < ROUNDS_TO_WIN; i++) {
      const dot = this.add.rectangle(width - 16 - i * 22, HDR_H / 2, 14, 14, 0x001133)
        .setOrigin(0.5).setStrokeStyle(2, C2);
      this.p2WinDots.push(dot);
    }

    // ── Center: jutsu name + round ────────────────────────────────────────
    this.add.text(width / 2, HDR_H / 2 - 9, jutsuName.toUpperCase(), {
      fontFamily:"monospace", fontSize:"13px", color:"#00ffdd",
      stroke:"#000", strokeThickness:2,
    }).setOrigin(0.5, 0.5);
    this.roundNumText = this.add.text(width / 2, HDR_H / 2 + 10, "RONDA 1", {
      fontFamily:"monospace", fontSize:"12px", color:"#aaaaaa",
    }).setOrigin(0.5, 0.5);

    this.timerText = this.add.text(width / 2, HDR_H + 26, "1:00", {
      fontFamily:"monospace", fontSize:"32px", color:"#ffffff",
      stroke:"#000000", strokeThickness:4,
    }).setOrigin(0.5, 0.5).setDepth(5).setVisible(false);

    // ── Bottom: progress ─────────────────────────────────────────────────
    this.p1ProgressText = this.add.text(this.half / 2, height - BOT_H / 2, "0 / " + this.sealSequence.length, {
      fontFamily:"monospace", fontSize:"30px", color:"#ffffff",
      stroke:"#000", strokeThickness:3,
    }).setOrigin(0.5, 0.5);
    this.p2ProgressText = this.add.text(this.half + this.half / 2, height - BOT_H / 2, "0 / " + this.sealSequence.length, {
      fontFamily:"monospace", fontSize:"30px", color:"#ffffff",
      stroke:"#000", strokeThickness:3,
    }).setOrigin(0.5, 0.5);

    // Keys hint (bottom corners)
    this.add.text(8, height - 6, "P1: 1-8 keys  |  camera", {
      fontFamily:"monospace", fontSize:"10px", color:"#aa6600",
    }).setOrigin(0, 1);
    this.add.text(this.half + 8, height - 6, "P2: Q W E R T Y U I", {
      fontFamily:"monospace", fontSize:"10px", color:"#2255aa",
    }).setOrigin(0, 1);

    // ── Live seal detect (center HUD, below jutsu name) ───────────────────
    this.sealDetectText = this.add.text(width / 2, HDR_H + 10, "—", {
      fontFamily:"monospace", fontSize:"13px", color:"#66ffcc",
      stroke:"#000", strokeThickness:2,
    }).setOrigin(0.5, 0);

    // ── Round overlay (hidden by default) ────────────────────────────────
    this.roundOverlay = this.add.container(width/2, height/2);
    this.roundOverlay.setVisible(false);
    const ovBg = this.add.rectangle(0, 0, 700, 160, 0x000000, 0.88).setOrigin(0.5);
    this.roundLabel = this.add.text(0, 0, "", {
      fontFamily:"monospace", fontSize:"44px", color:"#ffdd00",
      stroke:"#000000", strokeThickness:5,
    }).setOrigin(0.5);
    this.roundOverlay.add([ovBg, this.roundLabel]);

    // ── Countdown overlay ─────────────────────────────────────────────────
    this.countdownText = this.add.text(width/2, height/2, "3", {
      fontFamily:"monospace", fontSize:"100px", color:"#ffffff",
      stroke:"#000", strokeThickness:6,
    }).setOrigin(0.5).setVisible(false);

    // ── Start music + countdown ───────────────────────────────────────────
    this.sound.stopAll();
    this.sound.play("music_menu", { loop:true, volume:0.45 * musicVol() });

    this.input.keyboard?.on("keydown-ESC", () => {
      this.sound.stopAll();
      this.scene.start("LevelSelect");
    });

    this.setupKeys();
    this.startRound();
  }

  // ── Round management ──────────────────────────────────────────────────────
  private startRound() {
    this.game.events.emit("roundStart");
    this.roundState = "countdown";
    this.p1Progress = 0; this.p2Progress = 0;
    this.clearNotes();
    this.p1Combo = new ComboTracker();
    this.p2Combo = new ComboTracker();

    this.roundNumText.setText(`RONDA ${this.roundNum + 1}`);
    this.p1ProgressText.setText(`0 / ${this.sealSequence.length}`);
    this.p2ProgressText.setText(`0 / ${this.sealSequence.length}`);
    this.p1ScoreText.setText("0");
    this.p2ScoreText.setText("0");

    const p1NotesCopy = this.beatmap.notes.map(n => ({...n}));
    const p2NotesCopy = this.beatmap.notes.map(n => ({...n}));
    this.p1Engine = new RhythmEngine();
    this.p2Engine = new RhythmEngine();
    this.p1Engine.load(p1NotesCopy);
    this.p2Engine.load(p2NotesCopy);
    this.p1Engine.onNoteSpawn = n => this.spawnNote(n, 0);
    this.p2Engine.onNoteSpawn = n => this.spawnNote(n, this.half);
    this.p1Engine.onNoteHit   = e => this.onHit(e, 1);
    this.p2Engine.onNoteHit   = e => this.onHit(e, 2);
    this.p1Engine.onNoteMiss  = e => this.onMiss(e, 1);
    this.p2Engine.onNoteMiss  = e => this.onMiss(e, 2);
    this.p1Engine.onSongEnd = () => this.checkSongEndTiebreak();
    this.p2Engine.onSongEnd = () => this.checkSongEndTiebreak();

    // KOF-style ROUND banner + real voice clip, then countdown 3-2-1
    this.announcer.roundBeep();
    const rn = Math.min(this.roundNum + 1, 3);
    this.time.delayedCall(80, () => {
      if (this.sound.get(`voice_round${rn}`) || this.cache.audio.has(`voice_round${rn}`))
        this.sound.play(`voice_round${rn}`, { volume: 0.85 * sfxVol() });
    });
    this.showRoundBanner(this.roundNum + 1, () => {
      let count = 3;
      this.announcer.countdownTick(count);
      this.countdownText.setText(`${count}`).setScale(1.5).setVisible(true);
      this.tweens.add({ targets: this.countdownText, scaleX: 1, scaleY: 1, duration: 600, ease: "Back.Out" });

      this.time.addEvent({
        delay: 800, repeat: 3,
        callback: () => {
          count--;
          this.announcer.countdownTick(count);
          if (count > 0) {
            this.countdownText.setText(`${count}`).setScale(1.5);
            this.tweens.add({ targets: this.countdownText, scaleX: 1, scaleY: 1, duration: 600, ease: "Back.Out" });
          } else if (count === 0) {
            this.countdownText.setVisible(false);
            this.announcer.fightChord();
            if (this.cache.audio.has("voice_fight"))
              this.sound.play("voice_fight", { volume: 0.9 * sfxVol() });
            this.showFightBanner();
          } else {
            this.roundState = "playing";
            this.p1StartTime = performance.now();
            this.p2StartTime = performance.now();
            this.p1Engine.start();
            this.p2Engine.start();
            this.startRoundTimer();
          }
        },
      });
    });
  }

  // KOF "ROUND X" banner: left/right halves slide in, hold, slide out
  private showRoundBanner(n: number, onDone: () => void) {
    const { width, height } = this.scale;
    const cy = height / 2;

    // Full-width dark strip
    const strip = this.add.rectangle(width / 2, cy, width, 80, 0x000000, 0.82).setOrigin(0.5);

    // "ROUND" from the left
    const tLeft = this.add.text(-60, cy, "ROUND", {
      fontFamily: "monospace", fontSize: "52px", color: "#ffdd00",
      stroke: "#000000", strokeThickness: 6,
    }).setOrigin(1, 0.5);

    // Round number from the right
    const tRight = this.add.text(width + 60, cy, `${n}`, {
      fontFamily: "monospace", fontSize: "68px", color: "#ffffff",
      stroke: "#000000", strokeThickness: 7,
    }).setOrigin(0, 0.5);

    const targetL = width / 2 - 12;
    const targetR = width / 2 + 18;

    // Slide in
    this.tweens.add({ targets: tLeft,  x: targetL, duration: 320, ease: "Quad.Out" });
    this.tweens.add({ targets: tRight, x: targetR, duration: 320, ease: "Quad.Out",
      onComplete: () => {
        // Flash
        this.cameras.main.flash(120, 255, 220, 80);
        // Hold, then slide out
        this.time.delayedCall(600, () => {
          this.tweens.add({ targets: tLeft,  x: -200, duration: 280, ease: "Quad.In" });
          this.tweens.add({ targets: [tRight, strip], alpha: 0, duration: 280, ease: "Quad.In",
            onComplete: () => {
              [tLeft, tRight, strip].forEach(o => o.destroy());
              onDone();
            },
          });
        });
      },
    });
  }

  // KOF "FIGHT!" banner: explodes from center
  private showFightBanner() {
    const { width, height } = this.scale;
    const t = this.add.text(width / 2, height / 2, "FIGHT!", {
      fontFamily: "monospace", fontSize: "88px", color: "#ff4400",
      stroke: "#000000", strokeThickness: 8,
    }).setOrigin(0.5).setScale(2.2).setAlpha(0);

    this.tweens.add({
      targets: t, scaleX: 1, scaleY: 1, alpha: 1,
      duration: 180, ease: "Back.Out",
      onComplete: () => {
        this.time.delayedCall(480, () => {
          this.tweens.add({ targets: t, alpha: 0, scaleX: 0.8, scaleY: 0.8, duration: 260,
            onComplete: () => t.destroy(),
          });
        });
      },
    });
  }

  private clearNotes() {
    for (const c of this.p1Notes.values()) c.destroy();
    for (const c of this.p2Notes.values()) c.destroy();
    this.p1Notes.clear();
    this.p2Notes.clear();
  }

  // ── update ────────────────────────────────────────────────────────────────
  update() {
    if (this.roundState !== "playing") return;

    // Per-player note timers — each resets independently on sequence restart
    const p1Time = Math.max(0, (performance.now() - this.p1StartTime) / 1000);
    const p2Time = Math.max(0, (performance.now() - this.p2StartTime) / 1000);
    this.p1Engine.update(p1Time);
    this.p2Engine.update(p2Time);

    // Record hand frames for victory replay
    const p1Frame = this.registry.get("p1Frame");
    if (p1Frame?.landmarks) {
      this.p1HandBuf.push({ lm: p1Frame.landmarks.map((l: any) => ({ x: l.x, y: l.y })) });
      if (this.p1HandBuf.length > this.HAND_BUF) this.p1HandBuf.shift();
    }
    const p2Frame = this.registry.get("p2Frame");
    if (p2Frame?.landmarks) {
      this.p2HandBuf.push({ lm: p2Frame.landmarks.map((l: any) => ({ x: l.x, y: l.y })) });
      if (this.p2HandBuf.length > this.HAND_BUF) this.p2HandBuf.shift();
    }

    // Camera seal → P1 (edge-triggered)
    const p1Seal = (this.registry.get("p1Seal") as SealType | undefined) ?? "none";
    if (p1Seal !== "none") this.sealDetectText.setText(p1Seal.toUpperCase());
    if (p1Seal !== "none" && p1Seal !== this.lastP1Seal) {
      this.p1Engine.inputSeal(p1Seal, p1Time);
    }
    this.lastP1Seal = p1Seal;

    // Camera seal → P2 (edge-triggered)
    const p2Seal = (this.registry.get("p2Seal") as SealType | undefined) ?? "none";
    if (p2Seal !== "none" && p2Seal !== this.lastP2Seal) {
      this.p2Engine.inputSeal(p2Seal, p2Time);
    }
    this.lastP2Seal = p2Seal;

    // Move notes using per-player time
    for (const [note, c] of this.p1Notes) {
      c.y = this.hitLineY - (note.time - p1Time) * this.noteSpeed;
    }
    for (const [note, c] of this.p2Notes) {
      c.y = this.hitLineY - (note.time - p2Time) * this.noteSpeed;
    }
  }

  // ── Keyboard input ────────────────────────────────────────────────────────
  private setupKeys() {
    this.input.keyboard?.on("keydown", (ev: KeyboardEvent) => {
      const seal = KEY_MAP[ev.key.toLowerCase()];
      if (!seal || this.roundState !== "playing") return;
      const isP1 = "12345678".includes(ev.key);
      const isP2 = "qwertyui".includes(ev.key.toLowerCase());
      const now = performance.now();
      if (isP1) this.p1Engine.inputSeal(seal, Math.max(0, (now - this.p1StartTime) / 1000));
      if (isP2) this.p2Engine.inputSeal(seal, Math.max(0, (now - this.p2StartTime) / 1000));
    });
  }

  // ── Note spawn ────────────────────────────────────────────────────────────
  private spawnNote(note: BeatNote, offsetX: number) {
    const x = offsetX + this.hwOff + HW_W / 2;
    const c = this.add.container(x, -CARD_H / 2);

    const playerColor = offsetX === 0 ? 0xff8800 : 0x4488ff;
    c.add(this.add.rectangle(0, 0, CARD_W, CARD_H, 0x111122, 0.9).setOrigin(0.5));
    const bw = 3;
    c.add(this.add.rectangle(0, -CARD_H/2+bw/2, CARD_W, bw, playerColor).setOrigin(0.5));
    c.add(this.add.rectangle(0,  CARD_H/2-bw/2, CARD_W, bw, playerColor).setOrigin(0.5));
    c.add(this.add.rectangle(-CARD_W/2+bw/2, 0, bw, CARD_H, playerColor).setOrigin(0.5));
    c.add(this.add.rectangle( CARD_W/2-bw/2, 0, bw, CARD_H, playerColor).setOrigin(0.5));

    const ck = SEAL_COLOR_KEY[note.seal];
    if (ck && this.textures.exists(ck)) {
      const imgW = 110, imgH = 83;
      c.add(this.add.image(-CARD_W/2 + imgW/2 + 6, 0, ck).setDisplaySize(imgW, imgH).setOrigin(0.5));
    }
    const k = SEAL_KANJI[note.seal] ?? "?";
    c.add(this.add.text(CARD_W/2 - 46, -14, k, {
      fontFamily:"monospace", fontSize:"44px", color:"#fff", stroke:"#000", strokeThickness:3,
    }).setOrigin(0.5));
    c.add(this.add.text(CARD_W/2 - 46, 26, note.seal.toUpperCase(), {
      fontFamily:"monospace", fontSize:"15px", color:"#ccc",
    }).setOrigin(0.5));

    if (offsetX === 0) this.p1Notes.set(note, c);
    else               this.p2Notes.set(note, c);
  }

  // ── Hit / Miss ────────────────────────────────────────────────────────────
  private onHit(evt: NoteHitEvent, player: 1 | 2) {
    const map = player === 1 ? this.p1Notes : this.p2Notes;
    map.get(evt.note)?.destroy();
    map.delete(evt.note);

    const combo = player === 1 ? this.p1Combo : this.p2Combo;
    combo.hit(evt.result);

    if (player === 1) {
      this.p1Progress++;
      this.p1ProgressText.setText(`${this.p1Progress} / ${this.sealSequence.length}`);
      this.p1ScoreText.setText(this.p1Combo.score.toLocaleString());
    } else {
      this.p2Progress++;
      this.p2ProgressText.setText(`${this.p2Progress} / ${this.sealSequence.length}`);
      this.p2ScoreText.setText(this.p2Combo.score.toLocaleString());
    }

    // Hit text
    const colors: Record<string, string> = { perfect:"#ffff00", good:"#00ff88", ok:"#fff" };
    const ox = (player === 1 ? 0 : this.half) + this.hwOff + HW_W / 2;
    const ht = this.add.text(ox, this.hitLineY - 36, evt.result.toUpperCase(), {
      fontFamily:"monospace", fontSize:"18px", color: colors[evt.result] ?? "#fff",
      stroke:"#000", strokeThickness:2,
    }).setOrigin(0.5);
    this.tweens.add({ targets:ht, y: ht.y - 55, alpha:0, duration:550, onComplete:()=>ht.destroy() });

    // SFX
    const sfxMap: Record<string,string> = { perfect:"sfx_perfect", good:"sfx_good", ok:"sfx_ok" };
    const sk = sfxMap[evt.result];
    const now = performance.now();
    if (sk && now - this.lastSfxTime > 150) { this.sound.play(sk, {volume:0.6 * sfxVol()}); this.lastSfxTime = now; }

    // Check round win
    if (this.p1Progress >= this.sealSequence.length) this.endRound(1);
    else if (this.p2Progress >= this.sealSequence.length) this.endRound(2);
  }

  private onMiss(evt: NoteMissEvent, player: 1 | 2) {
    const map = player === 1 ? this.p1Notes : this.p2Notes;
    map.get(evt.note)?.destroy();
    map.delete(evt.note);
    (player === 1 ? this.p1Combo : this.p2Combo).hit("miss");
    const now = performance.now();
    if (now - this.lastSfxTime > 150) { this.sound.play("sfx_miss", {volume:0.5 * sfxVol()}); this.lastSfxTime = now; }

    // Sequence integrity: miss resets this player's sequence from note 0
    for (const c of map.values()) c.destroy();
    map.clear();

    const freshNotes = this.beatmap.notes.map(n => ({...n}));
    if (player === 1) {
      this.p1Engine.reload(freshNotes);
      this.p1StartTime = performance.now();
      this.p1Progress  = 0;
      this.p1ProgressText.setText(`0 / ${this.sealSequence.length}`);
    } else {
      this.p2Engine.reload(freshNotes);
      this.p2StartTime = performance.now();
      this.p2Progress  = 0;
      this.p2ProgressText.setText(`0 / ${this.sealSequence.length}`);
    }

    this.showResetBanner(player);
  }

  private showResetBanner(player: 1 | 2) {
    const { height } = this.scale;
    const x = player === 1 ? this.half / 2 : this.half + this.half / 2;
    const t = this.add.text(x, height / 2, "¡REINICIA!", {
      fontFamily: "monospace", fontSize: "30px", color: "#ff4444",
      stroke: "#000000", strokeThickness: 5,
    }).setOrigin(0.5).setDepth(20);
    this.tweens.add({
      targets: t, alpha: 0, y: t.y - 65, delay: 300, duration: 500,
      onComplete: () => t.destroy(),
    });
  }

  // ── Jutsu special effects ─────────────────────────────────────────────────
  private showJutsuEffect(winner: 1 | 2, isFinalRound = false) {
    const { height } = this.scale;
    const cx = winner === 1 ? this.half / 2 : this.half + this.half / 2;
    const cy = height / 2;
    const depth = 9;

    // Fire event so main.ts can play the MP4 overlay
    this.game.events.emit("jutsuVfx", this.jutsuId, winner, isFinalRound);

    if (this.jutsuId === "rasengan") {
      // Spiral wind burst — teal/white rings expanding outward
      this.cameras.main.flash(400, 140, 255, 220);
      this.cameras.main.shake(300, 0.006);
      const rings = 4;
      for (let i = 0; i < rings; i++) {
        const ring = this.add.circle(cx, cy, 20, 0x88ffee, 0.85).setDepth(depth);
        this.tweens.add({
          targets: ring, scaleX: 9, scaleY: 9, alpha: 0,
          duration: 500, delay: i * 80, ease: "Quad.Out",
          onComplete: () => ring.destroy(),
        });
      }
      // "螺旋丸" + name burst
      const label = this.add.text(cx, cy - 40, "螺旋丸\nRASENGAN!", {
        fontFamily: "monospace", fontSize: "28px", color: "#aaffee",
        stroke: "#004433", strokeThickness: 5, align: "center",
      }).setOrigin(0.5).setDepth(depth + 1).setScale(0);
      this.tweens.add({ targets: label, scale: 1.4, duration: 250, ease: "Back.Out",
        onComplete: () => this.tweens.add({ targets: label, scale: 0, alpha: 0, delay: 600, duration: 300,
          onComplete: () => label.destroy() }) });

    } else if (this.jutsuId === "chidori") {
      // Lightning blast — rapid yellow flicker + bolt lines
      this.cameras.main.flash(500, 255, 240, 60);
      this.cameras.main.shake(350, 0.010);
      // Draw jagged bolt lines from center
      const gfx = this.add.graphics().setDepth(depth);
      const drawBolt = (ox: number, oy: number) => {
        gfx.clear();
        gfx.lineStyle(3, 0xffffaa, 1);
        gfx.beginPath();
        gfx.moveTo(cx, cy);
        let px = cx, py = cy;
        for (let s = 0; s < 6; s++) {
          px += ox + Phaser.Math.Between(-30, 30);
          py += oy + Phaser.Math.Between(-20, 20);
          gfx.lineTo(px, py);
        }
        gfx.strokePath();
      };
      let tick = 0;
      const flickerTimer = this.time.addEvent({
        delay: 60, repeat: 7,
        callback: () => {
          tick++;
          if (tick % 2 === 0) drawBolt(-25, -30);
          else drawBolt(25, -30);
        },
      });
      this.time.delayedCall(500, () => { flickerTimer.remove(); gfx.destroy(); });

      const label = this.add.text(cx, cy - 40, "千鳥\nCHIDORI!", {
        fontFamily: "monospace", fontSize: "28px", color: "#ffff88",
        stroke: "#442200", strokeThickness: 5, align: "center",
      }).setOrigin(0.5).setDepth(depth + 1).setScale(0);
      this.tweens.add({ targets: label, scale: 1.4, duration: 200, ease: "Back.Out",
        onComplete: () => this.tweens.add({ targets: label, scale: 0, alpha: 0, delay: 650, duration: 300,
          onComplete: () => label.destroy() }) });

    } else {
      // Generic flash for all other jutsus
      this.cameras.main.flash(300, 255, 200, 50);
    }
  }

  // ── Round / match end ─────────────────────────────────────────────────────
  private checkSongEndTiebreak() {
    if (this.roundState !== "playing") return;
    // Only act when both engines have finished
    if (this.p1Engine["running"] || this.p2Engine["running"]) return;
    // Whoever got more seals wins; if tied P1 wins (arbitrary)
    if (this.p1Progress >= this.p2Progress) this.endRound(1);
    else this.endRound(2);
  }

  private startRoundTimer() {
    this.roundTimeLeft = 60;
    this.timerText.setText("1:00").setColor("#ffffff").setVisible(true);
    this.roundTimerEvent?.remove(false);
    this.roundTimerEvent = this.time.addEvent({
      delay: 1000, repeat: 59,
      callback: () => {
        if (this.roundState !== "playing") return;
        this.roundTimeLeft--;
        const mm = Math.floor(this.roundTimeLeft / 60);
        const ss = String(this.roundTimeLeft % 60).padStart(2, "0");
        this.timerText.setText(`${mm}:${ss}`);
        if (this.roundTimeLeft <= 10) this.timerText.setColor("#ff3333");
        if (this.roundTimeLeft <= 0) {
          // Time's up — most seals wins; P1 wins on tie
          const winner = this.p1Progress >= this.p2Progress ? 1 : 2;
          this.endRound(winner);
        }
      },
    });
  }

  private endRound(winner: 1 | 2) {
    if (this.roundState !== "playing") return;
    this.roundState = "round_over";
    this.roundTimerEvent?.remove(false);
    this.roundTimerEvent = null;
    this.timerText.setVisible(false);
    this.p1Engine.stop();
    this.p2Engine.stop();

    if (winner === 1) {
      this.p1Wins++;
      this.p1WinDots[this.p1Wins - 1]?.setFillStyle(0xff8800);
    } else {
      this.p2Wins++;
      this.p2WinDots[this.p2Wins - 1]?.setFillStyle(0x4488ff);
    }

    // Play jutsu SFX + special effect per jutsu
    const isFinalRound = this.p1Wins >= ROUNDS_TO_WIN || this.p2Wins >= ROUNDS_TO_WIN;
    this.sound.play("sfx_jutsu_complete", { volume: 1.0 * sfxVol() });
    this.showJutsuEffect(winner, isFinalRound);
    // Round win voice (generic announcer only — character shout is reserved for match win)
    this.time.delayedCall(400, () => {
      const key = winner === 1 ? "voice_p1wins" : "voice_p2wins";
      if (this.cache.audio.has(key)) this.sound.play(key, { volume: 0.80 * sfxVol() });
    });

    const color = winner === 1 ? "#ff8800" : "#4488ff";
    const msg   = winner === 1 ? "¡P1 GANA LA RONDA!" : "¡P2 GANA LA RONDA!";
    this.roundLabel.setText(msg).setColor(color);
    this.roundOverlay.setVisible(true);

    this.roundNum++;

    if (this.p1Wins >= ROUNDS_TO_WIN || this.p2Wins >= ROUNDS_TO_WIN) {
      // Freeze the winner's frame buffer NOW — before the player moves their hands
      this.game.events.emit("jutsuComplete", winner);
      this.time.delayedCall(2200, () => this.showMatchWinner());
    } else {
      this.time.delayedCall(2200, () => {
        this.roundOverlay.setVisible(false);
        this.startRound();
      });
    }
  }

  private showMatchWinner() {
    if (this.roundState === "match_over") return;   // guard against double-call
    this.roundState = "match_over";
    this.roundOverlay.setVisible(false);
    this.clearNotes();
    const { width, height } = this.scale;
    const winner = this.p1Wins > this.p2Wins ? 1 : 2;
    const wColor    = winner === 1 ? 0xff8800 : 0x4488ff;
    const wColorHex = winner === 1 ? "#ff8800" : "#4488ff";
    const wName     = winner === 1 ? "NARUTO" : "SASUKE";
    const wArt      = winner === 1 ? "char_naruto_battle" : "char_sasuke_battle";

    // ── Dark overlay ──────────────────────────────────────────────────────
    const overlay = this.add.rectangle(0, 0, width, height, 0x000000, 0)
      .setOrigin(0).setDepth(10);
    this.tweens.add({ targets: overlay, alpha: 0.82, duration: 400, ease: "Quad.Out" });

    // ── Character art — slides in from winner's side, tall + dramatic ─────
    const charH   = height * 0.95;
    const charW   = charH * 0.65;
    const charX   = winner === 1 ? charW * 0.45 : width - charW * 0.45;
    const offEdge = winner === 1 ? -charW : width + charW;
    const charImg = this.add.image(offEdge, height * 0.48, wArt)
      .setDisplaySize(charW, charH)
      .setOrigin(0.5)
      .setDepth(11)
      .setAlpha(0);

    this.tweens.add({
      targets: charImg, x: charX, alpha: 1,
      duration: 450, ease: "Back.Out", delay: 150,
      onComplete: () => {
        // Shockwave ring burst (looping concentric rings)
        for (let r = 0; r < 3; r++) {
          const ring = this.add.circle(charX, height * 0.55, 30, wColor, 0).setDepth(12)
            .setStrokeStyle(3, wColor, 0.9);
          this.tweens.add({
            targets: ring, scaleX: 8 + r * 3, scaleY: 8 + r * 3, alpha: 0,
            delay: r * 100, duration: 700, ease: "Quad.Out",
            onComplete: () => ring.destroy(),
          });
        }
        // Chakra sparkles — small diamonds fanning out
        for (let i = 0; i < 18; i++) {
          const angle = (i / 18) * Math.PI * 2;
          const dist  = 80 + Math.random() * 120;
          const sp = this.add.rectangle(charX, height * 0.55, 8, 8, wColor, 0.9)
            .setAngle(45).setDepth(12);
          this.tweens.add({
            targets: sp,
            x: charX + Math.cos(angle) * dist,
            y: height * 0.55 + Math.sin(angle) * dist,
            scaleX: 0, scaleY: 0, alpha: 0,
            duration: 600 + Math.random() * 300,
            ease: "Quad.Out",
            onComplete: () => sp.destroy(),
          });
        }
        this.cameras.main.shake(280, 0.012);
      },
    });

    // ── "WINNER!" kanji-style drop — falls from top ───────────────────────
    const winnerLabel = this.add.text(width / 2, -80, "WINNER!", {
      fontFamily: "monospace", fontSize: "62px", color: "#ffdd00",
      stroke: "#000000", strokeThickness: 7,
    }).setOrigin(0.5, 0).setDepth(13).setAlpha(0);
    this.tweens.add({
      targets: winnerLabel, y: height * 0.08, alpha: 1,
      delay: 400, duration: 380, ease: "Bounce.Out",
    });

    // ── Winner name — explodes from center ────────────────────────────────
    const nameText = this.add.text(width / 2, height * 0.38, wName, {
      fontFamily: "monospace", fontSize: "80px", color: wColorHex,
      stroke: "#000000", strokeThickness: 8,
    }).setOrigin(0.5).setDepth(13).setScale(2.5).setAlpha(0);
    this.tweens.add({
      targets: nameText, scaleX: 1, scaleY: 1, alpha: 1,
      delay: 700, duration: 300, ease: "Back.Out",
    });

    // ── Score + player tag ────────────────────────────────────────────────
    const scoreText = this.add.text(width / 2, height * 0.52, `${this.p1Wins}  -  ${this.p2Wins}`, {
      fontFamily: "monospace", fontSize: "44px", color: "#ffffff",
      stroke: "#000000", strokeThickness: 4,
    }).setOrigin(0.5).setDepth(13).setAlpha(0);
    this.tweens.add({ targets: scoreText, alpha: 1, delay: 1100, duration: 300 });

    // ── Buttons appear after animation ───────────────────────────────────
    this.time.delayedCall(1800, () => {
      const again = this.add.text(width / 2 - 130, height * 0.78, "  ▶ REVANCHA  ", {
        fontFamily: "monospace", fontSize: "22px", color: "#fff",
        backgroundColor: "#cc0000", padding: { x: 14, y: 10 },
      }).setOrigin(0.5).setDepth(14).setInteractive({ useHandCursor: true }).setAlpha(0);
      const menu = this.add.text(width / 2 + 130, height * 0.78, "  MENU  ", {
        fontFamily: "monospace", fontSize: "22px", color: "#fff",
        backgroundColor: "#0044cc", padding: { x: 14, y: 10 },
      }).setOrigin(0.5).setDepth(14).setInteractive({ useHandCursor: true }).setAlpha(0);
      this.tweens.add({ targets: [again, menu], alpha: 1, duration: 300 });
      again.on("pointerdown", () => { this.sound.stopAll(); this.scene.restart({ beatmapId: this.beatmap.id }); });
      menu.on("pointerdown",  () => { this.sound.stopAll(); this.scene.start("Menu"); });
      this.input.keyboard?.once("keydown-ENTER", () => { this.sound.stopAll(); this.scene.restart({ beatmapId: this.beatmap.id }); });
    });

    // ── Audio — winner shout (sfx_jutsu_complete already played in endRound) ─
    this.time.delayedCall(700, () => {
      const key = winner === 1 ? "voice_naruto_win" : "voice_sasuke_win";
      if (this.cache.audio.has(key)) this.sound.play(key, { volume: 1.0 * sfxVol() });
      else if (this.cache.audio.has("voice_winner")) this.sound.play("voice_winner", { volume: 0.9 * sfxVol() });
    });

    // ── Victory replay ────────────────────────────────────────────────────
    // Try camera video replay first (main.ts handles it if frames are available).
    // Hand skeleton shows as background layer if no camera was connected.
    this.time.delayedCall(600, () => {
      this.game.events.emit("matchWinReplay", winner);
      // Fatality jutsus have their own full-screen victory — skip skeleton replay
      if (this.jutsuId !== "rasengan" && this.jutsuId !== "chidori") {
        const winBuf = winner === 1 ? this.p1HandBuf : this.p2HandBuf;
        this.showVictoryJutsu(winBuf, winner);
      }
    });
  }

  // ── Victory jutsu: replay winner's hand movements as glowing skeleton ────
  private showVictoryJutsu(buffer: Array<{ lm: {x:number,y:number}[] }>, winner: 1 | 2) {
    if (buffer.length === 0) return;

    const { width, height } = this.scale;
    const color  = winner === 1 ? 0xff8800 : 0x4488ff;
    // Opposite side from the character art
    const panelX = winner === 1 ? width * 0.74 : width * 0.26;
    const panelY = height * 0.46;
    const PANEL_W = 260;
    const PANEL_H = 320;

    // Compute global bounding box across ALL frames so scale stays constant
    let gMinX = Infinity, gMaxX = -Infinity, gMinY = Infinity, gMaxY = -Infinity;
    for (const frame of buffer) {
      for (const p of frame.lm) {
        if (p.x < gMinX) gMinX = p.x;
        if (p.x > gMaxX) gMaxX = p.x;
        if (p.y < gMinY) gMinY = p.y;
        if (p.y > gMaxY) gMaxY = p.y;
      }
    }
    const rangeX = Math.max(gMaxX - gMinX, 0.04);
    const rangeY = Math.max(gMaxY - gMinY, 0.04);
    // Scale to fill 80% of the panel, preserving aspect ratio
    const S = Math.min((PANEL_W * 0.80) / rangeX, (PANEL_H * 0.80) / rangeY);

    const CONNECTIONS: [number, number][] = [
      [0,1],[1,2],[2,3],[3,4],
      [0,5],[5,6],[6,7],[7,8],
      [5,9],[9,10],[10,11],[11,12],
      [9,13],[13,14],[14,15],[15,16],
      [13,17],[17,18],[18,19],[19,20],
      [0,17],
    ];

    // Pulsing glow disc behind the hand
    const disc = this.add.circle(panelX, panelY, PANEL_W * 0.48, color, 0.07).setDepth(14);
    this.tweens.add({
      targets: disc, alpha: 0.15, scaleX: 1.08, scaleY: 1.08,
      yoyo: true, repeat: -1, duration: 860, ease: "Sine.InOut",
    });

    // Label just above the disc
    const label = this.add.text(panelX, panelY - PANEL_H * 0.55, "JUTSU VICTORIOSO", {
      fontFamily: "monospace", fontSize: "15px", color: "#ffffff",
      stroke: "#000000", strokeThickness: 3,
    }).setOrigin(0.5).setDepth(15).setAlpha(0);
    this.tweens.add({ targets: label, alpha: 0.85, duration: 400, delay: 100 });

    const g = this.add.graphics().setDepth(15);
    let frameIdx = 0;

    this.time.addEvent({
      delay: 33,
      repeat: -1,
      callback: () => {
        g.clear();
        const frame = buffer[frameIdx % buffer.length];
        frameIdx++;
        const lm = frame.lm;
        if (!lm || lm.length < 17) return;

        // Per-frame centroid keeps the hand centered while global S keeps it stable
        let sumX = 0, sumY = 0;
        for (const p of lm) { sumX += p.x; sumY += p.y; }
        const centX = sumX / lm.length;
        const centY = sumY / lm.length;

        // Mirror x (negative) to match CSS-mirrored camera
        const fx = (p: {x:number,y:number}) => panelX - (p.x - centX) * S;
        const fy = (p: {x:number,y:number}) => panelY + (p.y - centY) * S;

        // Glow pass — thick, low opacity
        g.lineStyle(8, color, 0.20);
        g.beginPath();
        for (const [a, b] of CONNECTIONS) {
          if (!lm[a] || !lm[b]) continue;
          g.moveTo(fx(lm[a]), fy(lm[a]));
          g.lineTo(fx(lm[b]), fy(lm[b]));
        }
        g.strokePath();

        // Main skeleton
        g.lineStyle(3, color, 0.92);
        g.beginPath();
        for (const [a, b] of CONNECTIONS) {
          if (!lm[a] || !lm[b]) continue;
          g.moveTo(fx(lm[a]), fy(lm[a]));
          g.lineTo(fx(lm[b]), fy(lm[b]));
        }
        g.strokePath();

        // Joint dots
        g.fillStyle(color, 1.0);
        for (const p of lm) g.fillCircle(fx(p), fy(p), 5);

        // Fingertip highlights
        g.fillStyle(0xffffff, 0.95);
        for (const tip of [4, 8, 12, 16, 20]) {
          if (lm[tip]) g.fillCircle(fx(lm[tip]), fy(lm[tip]), 7);
        }
      },
    });
  }
}
