import Phaser from "phaser";
import { RhythmEngine } from "../rhythm/RhythmEngine";
import { ComboTracker } from "../rhythm/ComboTracker";
import type { BeatNote, BeatMap } from "../data/types";
import type { SealType } from "../hand-detection/types";
import type { NoteHitEvent, NoteMissEvent } from "../rhythm/RhythmEngine";
import { DEMO_BEATMAP } from "../data/demoBeatmap";
import type { GameDataStore } from "../data/GameData";
import { network, PlayerRole } from "../network/NetworkManager";
import { getJutsuPower } from "../data/jutsuPower";

function musicVol() { return ((window as any)._audioVol?.music ?? 1) as number; }
function sfxVol()   { return ((window as any)._audioVol?.sfx   ?? 1) as number; }

// ── Layout ───────────────────────────────────────────────────────────────────
const HW_W    = 280;   // single centered lane
const HIT_Y_R = 0.80;
const CARD_W  = 240;   // wide card for big sprite
const CARD_H  = 130;   // tall card
const BASE_SPD = 300;
const ROUNDS_TO_WIN = 2;
const MAX_HP = 5;

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
const LANE_COLOR = 0x44aaff;

const KEY_MAP: Record<string, SealType> = {
  "1":"bird","2":"boar","3":"dog","4":"dragon","5":"hare","6":"horse","7":"monkey","8":"ox",
};

type RoundState = "countdown" | "playing" | "round_over" | "match_over";

interface OpponentSlot {
  role: string;
  hp: number;
  nameText: Phaser.GameObjects.Text;
  heartsText: Phaser.GameObjects.Text;
  eliminated: boolean;
}

interface SceneData {
  myBeatmapId:  string;
  oppBeatmapId: string;
  beatmaps:     Record<string, string>;
  role:         PlayerRole;
  playerCount:  number;
  startDelay:   number;
}

export class NetworkBattleScene extends Phaser.Scene {
  private engine!: RhythmEngine;
  private combo!: ComboTracker;
  private notes = new Map<BeatNote, Phaser.GameObjects.Container>();

  private beatmap!: BeatMap;
  private sealSequence: string[] = [];
  private progress = 0;
  private localHP = MAX_HP;
  private opponentHP = MAX_HP;
  private myWins = 0;
  private oppWins = 0;

  private roundState: RoundState = "countdown";
  private engineStartTime = 0;
  private lastSeal: SealType = "none";
  private noteSpeed = BASE_SPD;
  private hitLineY = 0;
  private hwLeft = 0;   // left edge of highway in screen coords

  private role!: PlayerRole;
  private myBeatmapId!:  string;
  private isBR = false;
  private brEliminated = false;
  private opponentSlots: Map<string, OpponentSlot> = new Map();

  // HUD refs
  private localHeartsText!: Phaser.GameObjects.Text;
  private oppHeartsText!:   Phaser.GameObjects.Text;
  private progressText!:    Phaser.GameObjects.Text;
  private scoreText!:       Phaser.GameObjects.Text;
  private oppProgressText!: Phaser.GameObjects.Text;
  private oppComboText!:    Phaser.GameObjects.Text;
  private sealDetectText!:  Phaser.GameObjects.Text;
  private myWinDots:  Phaser.GameObjects.Rectangle[] = [];
  private oppWinDots: Phaser.GameObjects.Rectangle[] = [];
  private roundOverlay!: Phaser.GameObjects.Container;
  private roundLabel!:   Phaser.GameObjects.Text;

  private timerText!: Phaser.GameObjects.Text;
  private roundTimerEvent: Phaser.Time.TimerEvent | null = null;
  private roundTimeLeft = 60;

  private lastSfxTime = 0;
  private progressTimer?: Phaser.Time.TimerEvent;

  constructor() { super("NetworkBattle"); }

  create(data: SceneData) {
    this.game.events.emit("battleStart");
    this.role         = data.role ?? "p1";
    this.myBeatmapId  = data.myBeatmapId;
    this.isBR         = (data.playerCount ?? 2) >= 3;
    this.brEliminated = false;
    this.opponentSlots.clear();

    // Reset state
    this.progress     = 0;
    this.localHP      = MAX_HP;
    this.opponentHP   = MAX_HP;
    this.myWins       = 0;
    this.oppWins      = 0;
    this.roundState   = "countdown";
    this.lastSeal     = "none";
    this.notes.clear();
    this.myWinDots    = [];
    this.oppWinDots   = [];

    const { width, height } = this.scale;
    this.hitLineY = height * HIT_Y_R;
    this.hwLeft   = (width - HW_W) / 2;

    // ── Background ──────────────────────────────────────────────────────────
    this.add.image(width / 2, height / 2, "gameplay_bg").setDisplaySize(width, height);
    this.add.rectangle(0, 0, width, height, 0x000000, 0.55).setOrigin(0);

    // ── Highway ─────────────────────────────────────────────────────────────
    this.add.rectangle(this.hwLeft, 0, HW_W, height, 0x111122, 0.55).setOrigin(0);
    // Hit line
    this.add.rectangle(this.hwLeft, this.hitLineY, HW_W, 4, 0x44aaff, 0.9).setOrigin(0, 0.5);
    // Hit zone
    this.add.ellipse(this.hwLeft + HW_W / 2, this.hitLineY, HW_W - 16, 32, LANE_COLOR, 0.22);

    // ── Top HUD ─────────────────────────────────────────────────────────────
    const MY_NAME  = this.role.toUpperCase();
    const myColor  = "#ff8800";

    if (this.isBR) {
      // BR: compact opponent slots across the top bar
      const allRoles = ["p1", "p2", "p3", "p4"].filter(r => r !== this.role);
      const slotW = width / allRoles.length;
      const barH  = 58;
      this.add.rectangle(0, 0, width, barH, 0x000000, 0.80).setOrigin(0);
      allRoles.forEach((r, idx) => {
        const sx = idx * slotW;
        const roleColor = r === "p1" ? "#4488ff" : r === "p2" ? "#ff8800" : r === "p3" ? "#44ff88" : "#ffdd44";
        this.add.text(sx + 8, 6, r.toUpperCase(), {
          fontFamily: "monospace", fontSize: "13px", color: roleColor,
        });
        const ht = this.add.text(sx + 8, 24, this.heartsStr(MAX_HP), {
          fontFamily: "monospace", fontSize: "16px", color: "#ff4444",
        });
        this.opponentSlots.set(r, { role: r, hp: MAX_HP, nameText: this.add.text(0,0,"").setVisible(false), heartsText: ht, eliminated: false });
      });
      // Use dummy texts for compat
      this.oppHeartsText   = this.add.text(0, 0, "").setVisible(false);
      this.oppProgressText = this.add.text(0, 0, "").setVisible(false);
      this.oppComboText    = this.add.text(0, 0, "").setVisible(false);
    } else {
      // 1v1: single opponent HUD
      const OPP_NAME = this.role === "p1" ? "P2" : "P1";
      const oppColor = this.role === "p1" ? "#4488ff" : "#ff8800";
      this.add.rectangle(0, 0, width, 62, 0x000000, 0.75).setOrigin(0);
      this.add.text(12, 8, OPP_NAME, { fontFamily: "monospace", fontSize: "16px", color: oppColor });
      this.oppHeartsText = this.add.text(12, 28, this.heartsStr(this.opponentHP), {
        fontFamily: "monospace", fontSize: "22px", color: "#ff4444",
      });
      this.oppProgressText = this.add.text(width * 0.35, 8, "Sellos: 0 / ?", {
        fontFamily: "monospace", fontSize: "14px", color: "#aaaaaa",
      }).setOrigin(0, 0);
      this.oppComboText = this.add.text(width * 0.35, 28, "Combo: 0", {
        fontFamily: "monospace", fontSize: "14px", color: "#aaaaaa",
      }).setOrigin(0, 0);
      // Win dots opponent (top right)
      for (let i = 0; i < ROUNDS_TO_WIN; i++) {
        const dot = this.add.rectangle(width - 18 - i * 28, 31, 20, 20, 0x333333)
          .setOrigin(0.5).setStrokeStyle(2, 0x666666);
        this.oppWinDots.unshift(dot);
      }
    }

    // ── Bottom HUD — local ──────────────────────────────────────────────────
    this.add.rectangle(0, height - 58, width, 58, 0x000000, 0.75).setOrigin(0);

    this.add.text(12, height - 52, MY_NAME, {
      fontFamily: "monospace", fontSize: "16px", color: myColor,
    });

    this.localHeartsText = this.add.text(12, height - 34, this.heartsStr(this.localHP), {
      fontFamily: "monospace", fontSize: "22px", color: "#ff4444",
    });

    this.progressText = this.add.text(width * 0.35, height - 52, "Sellos: 0 / ?", {
      fontFamily: "monospace", fontSize: "14px", color: "#cccccc",
    }).setOrigin(0, 0);

    this.scoreText = this.add.text(width * 0.35, height - 34, "Score: 0", {
      fontFamily: "monospace", fontSize: "14px", color: "#cccccc",
    }).setOrigin(0, 0);

    // Win dots local (bottom right — only in 1v1)
    if (!this.isBR) {
      for (let i = 0; i < ROUNDS_TO_WIN; i++) {
        const dot = this.add.rectangle(width - 18 - i * 28, height - 31, 20, 20, 0x333333)
          .setOrigin(0.5).setStrokeStyle(2, 0x666666);
        this.myWinDots.unshift(dot);
      }
    }

    // ── Countdown + seal detector ────────────────────────────────────────────
    this.add.text(width / 2, height / 2, "", {
      fontFamily: "monospace", fontSize: "100px",
      color: "#ffdd00", stroke: "#000", strokeThickness: 8,
    }).setOrigin(0.5).setDepth(10);

    this.sealDetectText = this.add.text(width - 8, height - 68, "", {
      fontFamily: "monospace", fontSize: "14px", color: "#44ff88",
      backgroundColor: "#000000aa", padding: { x: 6, y: 3 },
    }).setOrigin(1, 1);

    // ── Round timer (center top) ─────────────────────────────────────────────
    this.timerText = this.add.text(width / 2, 36, "1:00", {
      fontFamily: "monospace", fontSize: "32px", color: "#ffffff",
      stroke: "#000000", strokeThickness: 4,
    }).setOrigin(0.5, 0.5).setDepth(5).setVisible(false);

    // ── Round overlay ────────────────────────────────────────────────────────
    this.roundOverlay = this.add.container(width / 2, height / 2).setDepth(20).setVisible(false);
    const roBg = this.add.rectangle(0, 0, width, 100, 0x000000, 0.88).setOrigin(0.5);
    this.roundLabel = this.add.text(0, 0, "", {
      fontFamily: "monospace", fontSize: "44px",
      color: "#ffdd00", stroke: "#000", strokeThickness: 5,
    }).setOrigin(0.5);
    this.roundOverlay.add([roBg, this.roundLabel]);

    // ── Beatmap ──────────────────────────────────────────────────────────────
    const gameData = this.registry.get("gameData") as GameDataStore | null;
    this.beatmap = gameData?.beatmaps.find(b => b.id === this.myBeatmapId) ?? DEMO_BEATMAP;
    const jutsu  = gameData?.jutsus.find(j => j.id === this.beatmap.jutsuId);
    this.sealSequence = jutsu?.sealSequence ?? this.beatmap.notes.map(n => n.seal);
    this.noteSpeed    = BASE_SPD;

    this.progressText.setText(`Sellos: 0 / ${this.sealSequence.length}`);
    this.oppProgressText.setText(`Sellos: 0 / ?`);

    // ── Keyboard ─────────────────────────────────────────────────────────────
    this.input.keyboard?.on("keydown", (ev: KeyboardEvent) => {
      if (this.roundState !== "playing") return;
      const seal = KEY_MAP[ev.key];
      if (seal) this.engine.inputSeal(seal, Math.max(0, (performance.now() - this.engineStartTime) / 1000));
    });
    this.input.keyboard?.on("keydown-ESC", () => {
      this.sound.stopAll();
      network.clearCallbacks();
      this.scene.start("Menu");
    });

    // ── Network callbacks ────────────────────────────────────────────────────
    this.wireNetwork();

    // ── Music ────────────────────────────────────────────────────────────────
    this.sound.stopAll();
    this.sound.play("music_menu", { loop: true, volume: 0.45 * musicVol() });

    // ── Start first round after startDelay ───────────────────────────────────
    this.time.delayedCall(data.startDelay ?? 400, () => this.startRound());
  }

  // ── Round management ──────────────────────────────────────────────────────

  private startRound() {
    this.game.events.emit("roundStart");
    this.roundState   = "countdown";
    this.progress     = 0;
    this.localHP      = MAX_HP;
    this.opponentHP   = MAX_HP;
    this.notes.forEach(c => c.destroy());
    this.notes.clear();

    this.localHeartsText.setText(this.heartsStr(MAX_HP));
    this.oppHeartsText.setText(this.heartsStr(MAX_HP));
    this.progressText.setText(`Sellos: 0 / ${this.sealSequence.length}`);
    this.combo = new ComboTracker();
    this.scoreText.setText("Score: 0");

    this.engine = new RhythmEngine();
    const notesCopy = this.beatmap.notes.map(n => ({ ...n }));
    this.engine.load(notesCopy);
    this.engine.onNoteSpawn = n => this.spawnNote(n);
    this.engine.onNoteHit   = e => this.onHit(e);
    this.engine.onNoteMiss  = e => this.onMiss(e);

    // Short countdown banner, then start
    this.showRoundBanner(() => {
      this.sound.play("voice_fight", { volume: 0.9 * sfxVol() });
      this.showFightBanner();
      this.time.delayedCall(600, () => {
        this.roundState = "playing";
        this.engineStartTime = performance.now();
        this.engine.start();
        this.startRoundTimer();

        // Periodic progress reports to opponent
        this.progressTimer?.remove(false);
        this.progressTimer = this.time.addEvent({
          delay: 500, loop: true,
          callback: () => {
            if (this.roundState === "playing") {
              network.sendProgress(this.progress, this.combo.combo, this.localHP);
            }
          },
        });
      });
    });
  }

  private startRoundTimer() {
    this.roundTimeLeft = 60;
    this.timerText.setText("1:00").setColor("#ffffff").setVisible(true);
    this.roundTimerEvent?.remove(false);
    this.roundTimerEvent = this.time.addEvent({
      delay: 1000, loop: true,
      callback: () => {
        if (this.roundState !== "playing") return;
        this.roundTimeLeft--;
        const mm = Math.floor(Math.max(0, this.roundTimeLeft) / 60);
        const ss = String(Math.max(0, this.roundTimeLeft) % 60).padStart(2, "0");
        this.timerText.setText(`${mm}:${ss}`);
        if (this.roundTimeLeft <= 10) this.timerText.setColor("#ff3333");
        if (this.roundTimeLeft <= 0) {
          if (this.isBR) {
            // BR: timer pressure only — reset and keep going
            this.roundTimeLeft = 60;
            this.timerText.setColor("#ffffff");
          } else {
            // 1v1: most seals wins; HP as tiebreaker
            const oppData = this.registry.get("netOppProgress") as
              { progress: number; combo: number; hp: number } | undefined;
            const oppSeals = oppData ? oppData.progress : 0;
            const oppHP    = oppData ? oppData.hp       : 0;
            let localWon: boolean;
            if (this.progress !== oppSeals) {
              localWon = this.progress > oppSeals;
            } else {
              localWon = this.localHP >= oppHP;
            }
            this.endRound(localWon);
          }
        }
      },
    });
  }

  private endRound(localWon: boolean) {
    if (this.roundState !== "playing") return;
    this.roundState = "round_over";
    this.roundTimerEvent?.remove(false);
    this.roundTimerEvent = null;
    this.timerText.setVisible(false);
    this.engine.stop();
    this.progressTimer?.remove(false);

    if (localWon) {
      this.myWins++;
      this.myWinDots[this.myWins - 1]?.setFillStyle(this.role === "p1" ? 0xff8800 : 0x4488ff);
    } else {
      this.oppWins++;
      this.oppWinDots[this.oppWins - 1]?.setFillStyle(this.role === "p1" ? 0x4488ff : 0xff8800);
    }

    this.sound.play("sfx_jutsu_complete", { volume: 1.0 * sfxVol() });
    this.cameras.main.flash(300, localWon ? 255 : 80, localWon ? 200 : 0, localWon ? 50 : 0);

    const color = localWon ? "#ff8800" : "#4488ff";
    const msg   = localWon ? "¡GANASTE LA RONDA!" : "¡PERDISTE LA RONDA!";
    this.roundLabel.setText(msg).setColor(color);
    this.roundOverlay.setVisible(true);

    // Report to server
    const winner: PlayerRole = localWon ? this.role : (this.role === "p1" ? "p2" : "p1");
    const p1Wins = this.role === "p1" ? this.myWins : this.oppWins;
    const p2Wins = this.role === "p1" ? this.oppWins : this.myWins;
    network.reportRoundOver(winner, p1Wins, p2Wins);

    // Check match win
    const matchDone = this.myWins >= ROUNDS_TO_WIN || this.oppWins >= ROUNDS_TO_WIN;
    if (matchDone) {
      const matchWinner: PlayerRole = this.myWins >= ROUNDS_TO_WIN
        ? this.role : (this.role === "p1" ? "p2" : "p1");
      network.reportMatchOver(matchWinner);
      this.time.delayedCall(2000, () => this.showMatchResult(localWon));
    } else {
      this.time.delayedCall(2000, () => {
        this.roundOverlay.setVisible(false);
        this.startRound();
      });
    }
  }

  // ── Note rendering ────────────────────────────────────────────────────────

  private spawnNote(note: BeatNote) {
    const x = this.hwLeft + HW_W / 2;
    const c = this.add.container(x, -CARD_H / 2);

    c.add(this.add.rectangle(0, 0, CARD_W, CARD_H, 0x111122, 0.9).setOrigin(0.5));
    const bw = 3;
    c.add(this.add.rectangle(0, -CARD_H/2+bw/2, CARD_W, bw, LANE_COLOR).setOrigin(0.5));
    c.add(this.add.rectangle(0,  CARD_H/2-bw/2, CARD_W, bw, LANE_COLOR).setOrigin(0.5));
    c.add(this.add.rectangle(-CARD_W/2+bw/2, 0, bw, CARD_H, LANE_COLOR).setOrigin(0.5));
    c.add(this.add.rectangle( CARD_W/2-bw/2, 0, bw, CARD_H, LANE_COLOR).setOrigin(0.5));

    const ck = SEAL_COLOR_KEY[note.seal];
    if (ck && this.textures.exists(ck)) {
      const imgW = 100, imgH = Math.round(imgW * 3 / 4);
      c.add(this.add.image(-CARD_W/2 + imgW/2 + 6, 0, ck).setDisplaySize(imgW, imgH).setOrigin(0.5));
    }
    c.add(this.add.text(CARD_W/2 - 44, -14, SEAL_KANJI[note.seal] ?? "?", {
      fontFamily:"monospace", fontSize:"36px", color:"#fff", stroke:"#000", strokeThickness:2,
    }).setOrigin(0.5));
    c.add(this.add.text(CARD_W/2 - 44, 20, note.seal.toUpperCase(), {
      fontFamily:"monospace", fontSize:"14px", color:"#ccc",
    }).setOrigin(0.5));

    this.notes.set(note, c);
  }

  // ── Hit / Miss ────────────────────────────────────────────────────────────

  private onHit(evt: NoteHitEvent) {
    this.notes.get(evt.note)?.destroy();
    this.notes.delete(evt.note);
    this.combo.hit(evt.result);
    this.progress++;

    this.progressText.setText(`Sellos: ${this.progress} / ${this.sealSequence.length}`);
    this.scoreText.setText(`Score: ${this.combo.score.toLocaleString()}`);

    // Hit feedback
    const colors: Record<string, string> = { perfect:"#ffff00", good:"#00ff88", ok:"#fff" };
    const laneX = this.hwLeft + HW_W / 2;
    const ht = this.add.text(laneX, this.hitLineY - 36, evt.result.toUpperCase(), {
      fontFamily:"monospace", fontSize:"18px", color: colors[evt.result] ?? "#fff",
      stroke:"#000", strokeThickness:2,
    }).setOrigin(0.5);
    this.tweens.add({ targets:ht, y: ht.y - 55, alpha:0, duration:550, onComplete:()=>ht.destroy() });

    const sfxMap: Record<string,string> = { perfect:"sfx_perfect", good:"sfx_good", ok:"sfx_ok" };
    const sk = sfxMap[evt.result];
    const now = performance.now();
    if (sk && now - this.lastSfxTime > 150) { this.sound.play(sk, {volume:0.6 * sfxVol()}); this.lastSfxTime = now; }

    // Jutsu complete?
    if (this.progress >= this.sealSequence.length) {
      this.onJutsuComplete();
    }
  }

  private onMiss(evt: NoteMissEvent) {
    this.notes.get(evt.note)?.destroy();
    this.notes.delete(evt.note);
    this.combo.hit("miss");

    const now = performance.now();
    if (now - this.lastSfxTime > 150) { this.sound.play("sfx_miss", {volume:0.5 * sfxVol()}); this.lastSfxTime = now; }

    // Clear remaining notes, reset sequence
    for (const c of this.notes.values()) c.destroy();
    this.notes.clear();

    const freshNotes = this.beatmap.notes.map(n => ({...n}));
    this.engine.reload(freshNotes);
    this.engineStartTime = performance.now();
    this.progress = 0;
    this.progressText.setText(`Sellos: 0 / ${this.sealSequence.length}`);

    this.showResetBanner();
  }

  private onJutsuComplete() {
    if (this.roundState !== "playing") return;

    const power = getJutsuPower(this.beatmap.jutsuId).power;
    if (!this.isBR) this.opponentHP = Math.max(0, this.opponentHP - power);
    network.castJutsu(this.beatmap.jutsuId, power);

    this.sound.play("sfx_jutsu_complete", { volume: 1.0 * sfxVol() });

    // Show cast text
    const { width } = this.scale;
    const powerDef = getJutsuPower(this.beatmap.jutsuId);
    const jutsuName = this.registry.get("gameData") as GameDataStore | null;
    const j = jutsuName?.jutsus.find(j => j.id === this.beatmap.jutsuId);
    const castTxt = this.add.text(width / 2, this.scale.height * 0.45,
      `${j?.nameES ?? this.beatmap.jutsuId}  -${power}HP`, {
      fontFamily:"monospace", fontSize:"28px", color:"#ffff00",
      stroke:"#000", strokeThickness:4,
    }).setOrigin(0.5).setDepth(15);
    this.tweens.add({ targets:castTxt, y: castTxt.y - 60, alpha:0, duration:900,
      onComplete:()=>castTxt.destroy() });

    if (!this.isBR && this.opponentHP <= 0) {
      // 1v1 round-winning hit
      const isFinalRound = this.myWins + 1 >= ROUNDS_TO_WIN;
      this.showJutsuEffect(isFinalRound);
      this.endRound(true);
    } else {
      // Loop sequence (always in BR; or 1v1 when opp still has HP)
      for (const c of this.notes.values()) c.destroy();
      this.notes.clear();
      const freshNotes = this.beatmap.notes.map(n => ({...n}));
      this.engine.reload(freshNotes);
      this.engineStartTime = performance.now();
      this.progress = 0;
      this.progressText.setText(`Sellos: 0 / ${this.sealSequence.length}`);
      this.scoreText.setText(`Score: ${this.combo.score.toLocaleString()}`);

      const flashColor = powerDef.element === "lightning" ? "#ffff00"
                       : powerDef.element === "fire"      ? "#ff6600"
                       : "#aaffff";
      const dmgTxt = this.add.text(width / 2, 30,
        this.isBR ? `¡-${power} HP a todos!` : `¡-${power} HP al oponente!`, {
        fontFamily:"monospace", fontSize:"18px", color: flashColor,
        stroke:"#000", strokeThickness:3,
      }).setOrigin(0.5).setDepth(15);
      this.tweens.add({ targets:dmgTxt, y:-20, alpha:0, duration:800,
        onComplete:()=>dmgTxt.destroy() });

      if (this.isBR) this.showJutsuEffect(false);
    }
  }

  // ── Network wiring ────────────────────────────────────────────────────────

  private wireNetwork() {
    network.onOpponentCast = ({ damage }) => {
      if (this.roundState !== "playing") return;
      if (this.isBR && this.brEliminated) return;
      this.localHP = Math.max(0, this.localHP - damage);
      this.localHeartsText.setText(this.heartsStr(this.localHP));
      this.cameras.main.flash(250, 200, 0, 0);
      // Expand opponent's camera PiP so we see who hit us
      this.game.events.emit("oppCastReceived");

      const { width } = this.scale;
      const dmgTxt = this.add.text(width / 2, this.scale.height / 2,
        `-${damage} HP`, {
        fontFamily:"monospace", fontSize:"48px", color:"#ff4444",
        stroke:"#000", strokeThickness:6,
      }).setOrigin(0.5).setDepth(15);
      this.tweens.add({ targets:dmgTxt, y: dmgTxt.y - 60, alpha:0, duration:700,
        onComplete:()=>dmgTxt.destroy() });

      if (this.localHP <= 0) {
        if (this.isBR) {
          this.eliminateSelf();
        } else {
          this.endRound(false);
        }
      }
    };

    network.onOpponentProgress = ({ progress, combo, hp, role }) => {
      if (this.isBR && role) {
        const slot = this.opponentSlots.get(role);
        if (slot && !slot.eliminated) {
          slot.hp = hp;
          slot.heartsText.setText(this.heartsStr(hp));
        }
      } else {
        this.oppProgressText.setText(`Sellos: ${progress} / ?`);
        this.oppComboText.setText(`Combo: ${combo}`);
        this.oppHeartsText.setText(this.heartsStr(hp));
      }
      this.game.registry.set("netOppProgress", { progress, combo, hp });
    };

    network.onOpponentEliminated = (role) => {
      const slot = this.opponentSlots.get(role);
      if (slot) {
        slot.eliminated = true;
        slot.heartsText.setText("💀").setColor("#888888");
        slot.hp = 0;
      }
    };

    network.onRoundOver = (_data) => {
      // Received from server — ignore if we already ended the round locally
    };

    network.onMatchOver = (winner) => {
      const localWon = winner === this.role;
      if (this.roundState !== "match_over") {
        this.showMatchResult(localWon);
      }
    };

    network.onOpponentDisconnected = () => {
      if (this.roundState === "playing" || this.roundState === "countdown") {
        this.engine.stop();
        this.progressTimer?.remove(false);
        const { width, height } = this.scale;
        this.add.text(width / 2, height / 2, "Oponente desconectado", {
          fontFamily:"monospace", fontSize:"32px", color:"#ff4444",
          stroke:"#000", strokeThickness:5, backgroundColor:"#000000aa",
          padding:{ x:16, y:10 },
        }).setOrigin(0.5).setDepth(30);
        this.time.delayedCall(2500, () => {
          network.clearCallbacks();
          this.sound.stopAll();
          this.scene.start("Menu");
        });
      }
    };
  }

  // ── BR elimination ────────────────────────────────────────────────────────

  private eliminateSelf() {
    if (this.brEliminated) return;
    this.brEliminated = true;
    this.roundState = "round_over";
    this.engine.stop();
    this.progressTimer?.remove(false);
    this.roundTimerEvent?.remove(false);
    network.sendEliminated();

    const { width, height } = this.scale;
    this.cameras.main.flash(400, 180, 0, 0);
    this.add.rectangle(0, 0, width, height, 0x000000, 0.72).setOrigin(0).setDepth(25);
    const txt = this.add.text(width / 2, height / 2, "¡ELIMINADO!", {
      fontFamily:"monospace", fontSize:"72px", color:"#ff4444",
      stroke:"#000", strokeThickness:8,
    }).setOrigin(0.5).setDepth(26).setAlpha(0).setScale(1.6);
    this.tweens.add({ targets:txt, alpha:1, scaleX:1, scaleY:1, duration:400, ease:"Back.Out" });

    this.time.delayedCall(1200, () => {
      this.add.text(width / 2, height * 0.65, "Esperando resultado…", {
        fontFamily:"monospace", fontSize:"22px", color:"#aaaaaa",
      }).setOrigin(0.5).setDepth(26);
    });
  }

  // ── update ────────────────────────────────────────────────────────────────

  update() {
    if (this.roundState !== "playing") return;

    const t = Math.max(0, (performance.now() - this.engineStartTime) / 1000);
    this.engine.update(t);

    // Camera seal input (edge-triggered)
    const camSeal = (this.registry.get(this.role === "p1" ? "p1Seal" : "lastSeal") as SealType | undefined) ?? "none";
    if (camSeal !== "none") this.sealDetectText.setText(camSeal.toUpperCase());
    if (camSeal !== "none" && camSeal !== this.lastSeal) {
      this.engine.inputSeal(camSeal, t);
    }
    this.lastSeal = camSeal;

    // Move notes
    for (const [note, c] of this.notes) {
      c.y = this.hitLineY - (note.time - t) * this.noteSpeed;
    }
  }

  // ── Visual helpers ────────────────────────────────────────────────────────

  private heartsStr(hp: number): string {
    return "♥".repeat(Math.max(0, hp)) + "♡".repeat(Math.max(0, MAX_HP - hp));
  }

  private showJutsuEffect(isFinalRound = false, expandPip = true) {
    const { width, height } = this.scale;
    const cx = width / 2;
    const cy = height / 2;
    const depth = 9;
    const jutsuId = this.beatmap.jutsuId;

    // Fire event so main.ts expands the PiP — skip for BR looping hits
    if (expandPip) this.game.events.emit("jutsuVfxNet", jutsuId, isFinalRound);

    if (jutsuId === "rasengan") {
      this.cameras.main.flash(400, 140, 255, 220);
      this.cameras.main.shake(300, 0.006);
      for (let i = 0; i < 4; i++) {
        const ring = this.add.circle(cx, cy, 20, 0x88ffee, 0.85).setDepth(depth);
        this.tweens.add({
          targets: ring, scaleX: 9, scaleY: 9, alpha: 0,
          duration: 500, delay: i * 80, ease: "Quad.Out",
          onComplete: () => ring.destroy(),
        });
      }
      const label = this.add.text(cx, cy - 80, "螺旋丸", {
        fontFamily: "monospace", fontSize: "36px", color: "#aaffee",
        stroke: "#004433", strokeThickness: 5,
      }).setOrigin(0.5).setDepth(depth + 1).setScale(0);
      this.tweens.add({ targets: label, scale: 1.4, duration: 250, ease: "Back.Out",
        onComplete: () => this.tweens.add({ targets: label, scale: 0, alpha: 0, delay: 600, duration: 300,
          onComplete: () => label.destroy() }) });

    } else if (jutsuId === "chidori") {
      this.cameras.main.flash(500, 255, 240, 60);
      this.cameras.main.shake(350, 0.010);
      const gfx = this.add.graphics().setDepth(depth);
      let tick = 0;
      const flickerTimer = this.time.addEvent({
        delay: 60, repeat: 7,
        callback: () => {
          tick++;
          gfx.clear();
          gfx.lineStyle(3, 0xffffaa, 1);
          gfx.beginPath();
          gfx.moveTo(cx, cy);
          let px = cx, py = cy;
          const ox = tick % 2 === 0 ? -25 : 25;
          for (let s = 0; s < 6; s++) {
            px += ox + Phaser.Math.Between(-30, 30);
            py += -30 + Phaser.Math.Between(-20, 20);
            gfx.lineTo(px, py);
          }
          gfx.strokePath();
        },
      });
      this.time.delayedCall(500, () => { flickerTimer.remove(); gfx.destroy(); });
      const label = this.add.text(cx, cy - 80, "千鳥", {
        fontFamily: "monospace", fontSize: "36px", color: "#ffff88",
        stroke: "#442200", strokeThickness: 5,
      }).setOrigin(0.5).setDepth(depth + 1).setScale(0);
      this.tweens.add({ targets: label, scale: 1.4, duration: 200, ease: "Back.Out",
        onComplete: () => this.tweens.add({ targets: label, scale: 0, alpha: 0, delay: 650, duration: 300,
          onComplete: () => label.destroy() }) });

    } else {
      this.cameras.main.flash(300, 255, 200, 50);
    }
  }

  private showRoundBanner(onDone: () => void) {
    const { width, height } = this.scale;
    const cy = height / 2;
    const strip = this.add.rectangle(width / 2, cy, width, 80, 0x000000, 0.82).setOrigin(0.5).setDepth(12);

    const tLeft = this.add.text(-60, cy, "RONDA", {
      fontFamily:"monospace", fontSize:"52px", color:"#ffdd00",
      stroke:"#000", strokeThickness:6,
    }).setOrigin(1, 0.5).setDepth(13);

    const roundNum = this.myWins + this.oppWins + 1;
    const tRight = this.add.text(width + 60, cy, `${roundNum}`, {
      fontFamily:"monospace", fontSize:"68px", color:"#ffffff",
      stroke:"#000", strokeThickness:7,
    }).setOrigin(0, 0.5).setDepth(13);

    const roundVoice = roundNum === 1 ? "voice_round1" : roundNum === 2 ? "voice_round2" : "voice_round3";
    this.sound.play(roundVoice, { volume: 0.9 * sfxVol() });

    this.tweens.add({ targets: tLeft,  x: width / 2 - 12, duration: 320, ease:"Quad.Out" });
    this.tweens.add({ targets: tRight, x: width / 2 + 18, duration: 320, ease:"Quad.Out",
      onComplete: () => {
        this.cameras.main.flash(120, 255, 220, 80);
        this.time.delayedCall(600, () => {
          this.tweens.add({ targets: tLeft,  x: -200, duration: 280, ease:"Quad.In" });
          this.tweens.add({ targets:[tRight, strip], alpha: 0, duration: 280, ease:"Quad.In",
            onComplete: () => { [tLeft, tRight, strip].forEach(o=>o.destroy()); onDone(); },
          });
        });
      },
    });
  }

  private showFightBanner() {
    const { width, height } = this.scale;
    const t = this.add.text(width / 2, height / 2, "FIGHT!", {
      fontFamily:"monospace", fontSize:"88px", color:"#ff4400",
      stroke:"#000", strokeThickness:8,
    }).setOrigin(0.5).setScale(2.2).setAlpha(0).setDepth(14);
    this.tweens.add({
      targets:t, scaleX:1, scaleY:1, alpha:1, duration:180, ease:"Back.Out",
      onComplete: () => this.time.delayedCall(480, () =>
        this.tweens.add({ targets:t, alpha:0, scaleX:0.8, scaleY:0.8, duration:260,
          onComplete:()=>t.destroy() })),
    });
  }

  private showResetBanner() {
    const { width, height } = this.scale;
    const t = this.add.text(width / 2, height * 0.5, "¡REINICIA!", {
      fontFamily:"monospace", fontSize:"36px", color:"#ff4444",
      stroke:"#000", strokeThickness:4, backgroundColor:"#000000bb",
      padding:{ x:14, y:8 },
    }).setOrigin(0.5).setDepth(15);
    this.tweens.add({ targets:t, y: t.y - 60, alpha:0, duration:900, ease:"Quad.Out",
      onComplete:()=>t.destroy() });
  }

  private showMatchResult(localWon: boolean) {
    if (this.roundState === "match_over") return;
    this.roundState = "match_over";
    this.engine?.stop();
    this.progressTimer?.remove(false);

    const { width, height } = this.scale;
    this.sound.stopAll();
    this.sound.play("sfx_jutsu_complete", { volume: 1.0 * sfxVol() });

    // ── Announcer voices ────────────────────────────────────────────────────
    if (this.role === "p1" || this.role === "p2") {
      const winVoice  = this.role === "p1" ? "voice_p1wins" : "voice_p2wins";
      const loseVoice = this.role === "p1" ? "voice_p2wins" : "voice_p1wins";
      this.time.delayedCall(400, () => {
        this.sound.play(localWon ? winVoice : loseVoice, { volume: 1.0 * sfxVol() });
      });
    }
    if (localWon) {
      this.time.delayedCall(1400, () => {
        this.sound.play("voice_winner", { volume: 1.0 * sfxVol() });
        if (this.role === "p1" || this.role === "p2") {
          const shout = this.role === "p1" ? "voice_naruto_win" : "voice_sasuke_win";
          this.sound.play(shout, { volume: 0.85 * sfxVol() });
        }
      });
      // Trigger camera victory replay (main.ts handles the replayCam)
      this.game.events.emit("jutsuComplete", 1);
      this.time.delayedCall(200, () => this.game.events.emit("matchWinReplay", 1));
    }

    // ── Full-screen overlay ──────────────────────────────────────────────────
    this.cameras.main.flash(500, localWon ? 255 : 180, localWon ? 220 : 0, localWon ? 50 : 0);
    this.add.rectangle(0, 0, width, height, 0x000000, 0.84).setOrigin(0).setDepth(20);

    // Character artwork (p1=Naruto, p2=Sasuke; p3/p4 have none)
    const charKey = this.role === "p1" ? "char_naruto_battle"
                  : this.role === "p2" ? "char_sasuke_battle" : null;
    if (charKey && this.textures.exists(charKey)) {
      const charH   = Math.min(height * 0.65, 480);
      const charW   = charH * 0.6;
      const charX   = localWon ? width * 0.72 : width * 0.28;
      const charImg = this.add.image(charX, height * 0.52, charKey)
        .setDisplaySize(charW, charH).setDepth(21).setAlpha(0);
      if (!localWon) charImg.setFlipX(true);
      this.tweens.add({ targets: charImg, alpha: 0.88, duration: 500, delay: 150 });
    }

    const msg   = localWon ? "¡VICTORIA!" : "¡DERROTA!";
    const color = localWon ? "#ffdd00" : "#ff4444";
    const title = this.add.text(width / 2, height * 0.22, msg, {
      fontFamily:"monospace", fontSize:"80px", color,
      stroke:"#000", strokeThickness:7,
    }).setOrigin(0.5).setDepth(22).setAlpha(0).setScale(1.8);
    this.tweens.add({ targets:title, alpha:1, scaleX:1, scaleY:1, duration:400, ease:"Back.Out" });

    if (!this.isBR) {
      this.add.text(width / 2, height * 0.42, `${this.myWins} — ${this.oppWins}`, {
        fontFamily:"monospace", fontSize:"52px", color:"#ffffff",
        stroke:"#000", strokeThickness:5,
      }).setOrigin(0.5).setDepth(22);
    }

    this.add.text(width / 2, height * 0.55, `Score: ${this.combo.score.toLocaleString()}`, {
      fontFamily:"monospace", fontSize:"26px", color:"#aaffaa",
    }).setOrigin(0.5).setDepth(22);

    this.time.delayedCall(1800, () => {
      const rematch = this.add.text(width / 2 - 140, height * 0.72, "  REVANCHA  ", {
        fontFamily:"monospace", fontSize:"26px",
        color:"#fff", backgroundColor:"#cc0000",
        padding:{ x:22, y:10 },
      }).setOrigin(0.5).setDepth(22).setInteractive({ useHandCursor:true });
      rematch.on("pointerdown", () => {
        network.requestRematch();
        rematch.setText("Esperando…").setBackgroundColor("#660000");
      });

      const menu = this.add.text(width / 2 + 140, height * 0.72, "  MENÚ  ", {
        fontFamily:"monospace", fontSize:"26px",
        color:"#fff", backgroundColor:"#004499",
        padding:{ x:22, y:10 },
      }).setOrigin(0.5).setDepth(22).setInteractive({ useHandCursor:true });
      menu.on("pointerdown", () => {
        this.sound.stopAll();
        network.clearCallbacks();
        this.scene.start("Menu");
      });

      network.onOpponentRematch = () => {
        rematch.setText("¡Revancha!").setBackgroundColor("#006600");
        network.acceptRematch();
      };

      network.onSelectionStart = () => {
        network.clearCallbacks();
        this.sound.stopAll();
        this.scene.start("OnlineLobby");
      };
    });
  }

  shutdown() {
    this.progressTimer?.remove(false);
    network.clearCallbacks();
  }
}
