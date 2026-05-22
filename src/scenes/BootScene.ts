import Phaser from "phaser";
import { SealClassifier } from "../hand-detection/SealClassifier";
import { loadGameData } from "../data/GameData";
import { DEMO_BEATMAP } from "../data/demoBeatmap";
import type { MediaPipeDetector } from "../hand-detection/MediaPipeDetector";

export class BootScene extends Phaser.Scene {
  private loadingText!: Phaser.GameObjects.Text;

  constructor() { super("Boot"); }

  preload() {
    // Use Phaser's built-in loader with correct asset path
    this.load.setPath("assets/");

    // BW seal sprites (fallback / queue panel)
    const sealBwFiles: [string, string][] = [
      ["seal_rat",     "art/seals-bw/Ne.png"],
      ["seal_ox",      "art/seals-bw/Ushi.png"],
      ["seal_tiger",   "art/seals-bw/Tora.png"],
      ["seal_hare",    "art/seals-bw/U.png"],
      ["seal_dragon",  "art/seals-bw/Tatsu.png"],
      ["seal_serpent", "art/seals-bw/Mi.png"],
      ["seal_horse",   "art/seals-bw/Uma.png"],
      ["seal_ram",     "art/seals-bw/Hitsuji.png"],
      ["seal_monkey",  "art/seals-bw/Saru.png"],
      ["seal_bird",    "art/seals-bw/Tori.png"],
      ["seal_dog",     "art/seals-bw/Inu.png"],
      ["seal_boar",    "art/seals-bw/I.png"],
    ];
    for (const [key, path] of sealBwFiles) this.load.image(key, path);

    // Color seal photos (falling note cards + queue thumbnails)
    const sealColorFiles: [string, string][] = [
      ["seal_rat_c",     "art/seals/Ne.jpg"],
      ["seal_ox_c",      "art/seals/Ushi.jpg"],
      ["seal_tiger_c",   "art/seals/Tora.jpg"],
      ["seal_hare_c",    "art/seals/U.jpg"],
      ["seal_dragon_c",  "art/seals/Tatsu.jpg"],
      ["seal_serpent_c", "art/seals/Mi.jpg"],
      ["seal_horse_c",   "art/seals/Uma.jpg"],
      ["seal_ram_c",     "art/seals/Hitsuji.jpg"],
      ["seal_monkey_c",  "art/seals/Saru.jpg"],
      ["seal_bird_c",    "art/seals/Tori.jpg"],
      ["seal_dog_c",     "art/seals/Inu.jpg"],
      ["seal_boar_c",    "art/seals/I.jpg"],
    ];
    for (const [key, path] of sealColorFiles) this.load.image(key, path);

    // Character artwork (LevelSelect right panel)
    const charFiles: [string, string][] = [
      ["char_naruto",        "art/characters/naruto_artwork.jpg"],
      ["char_kakashi",       "art/characters/kakashi_artwork.jpg"],
      ["char_kakashi_lb",    "art/characters/kakashi_lightning_blade.jpg"],
      ["char_sasuke",        "art/characters/sasuke_artwork.jpg"],
      ["char_itachi",        "art/characters/itachi_artwork.jpg"],
      // Battle win screens — transparent PNG renders
      ["char_naruto_battle", "art/characters/naruto_battle.png"],
      ["char_sasuke_battle", "art/characters/sasuke_battle.png"],
    ];
    for (const [key, path] of charFiles) this.load.image(key, path);

    // Background
    this.load.image("gameplay_bg", "art/backgrounds/gameplay_bg.jpg");

    // Music & SFX
    this.load.audio("music_menu",        "audio/music/menu.mp3");
    // jutsu.mp3 = jutsu completion fanfare (NOT background music)
    this.load.audio("sfx_jutsu_complete","audio/music/jutsu.mp3");
    this.load.audio("sfx_perfect",       "audio/sfx/hit_perfect.wav");
    this.load.audio("sfx_good",          "audio/sfx/hit_good.wav");
    this.load.audio("sfx_ok",            "audio/sfx/hit_great.wav");
    this.load.audio("sfx_miss",          "audio/sfx/hit_miss.wav");

    // Battle announcer voice (Dragon + Male Fighting Announcer packs — OpenGameArt CC-BY)
    this.load.audio("voice_round1",  "audio/voice/round1.wav");
    this.load.audio("voice_round2",  "audio/voice/round2.wav");
    this.load.audio("voice_round3",  "audio/voice/round3.wav");
    this.load.audio("voice_fight",   "audio/voice/fight.wav");
    this.load.audio("voice_p1wins",  "audio/voice/p1wins.wav");
    this.load.audio("voice_p2wins",  "audio/voice/p2wins.wav");
    this.load.audio("voice_winner",  "audio/voice/winner.wav");
    // Character shouts — Naruto screams "¡Sasuke!" on P1 win, Sasuke screams "¡Naruto!" on P2 win
    this.load.audio("voice_naruto_win", "audio/voice/naruto_win.mp3");
    this.load.audio("voice_sasuke_win", "audio/voice/sasuke_win.mp3");
    this.load.audio("voice_finish_him", "audio/voice/finish_him.mp3");

    // Loading bar
    const { width, height } = this.scale;
    const barBg  = this.add.rectangle(width / 2, height / 2 + 30, 400, 16, 0x333333).setOrigin(0.5);
    const bar    = this.add.rectangle(width / 2 - 200, height / 2 + 30, 0, 16, 0xff6600).setOrigin(0, 0.5);
    this.loadingText = this.add.text(width / 2, height / 2 - 20, "Loading…", {
      fontFamily: "monospace", fontSize: "22px", color: "#ffffff",
    }).setOrigin(0.5);

    this.load.on("progress", (v: number) => { bar.width = 400 * v; });
    this.load.on("complete", () => { barBg.destroy(); bar.destroy(); });
    void barBg; // suppress unused warning
  }

  create() {
    this.loadingText.setText("Initializing…");

    // Load game data JSON and ONNX classifier in parallel (non-blocking)
    const dataPromise = loadGameData().catch(err => {
      console.warn("[Boot] GameData load failed, using demo:", err);
      return { beatmaps: [DEMO_BEATMAP], difficulties: [], jutsus: [], seals: [] };
    });

    const classifierPromise = new SealClassifier().init("assets/seal_classifier.onnx")
      .then(classifier => classifier)
      .catch(err => { console.warn("[Boot] Classifier init failed:", err); return null; });

    // When both are ready, wire up detector and transition to Menu
    Promise.all([dataPromise, classifierPromise]).then(([gameData, classifier]) => {
      this.registry.set("gameData", gameData);

      if (classifier) {
        this.registry.set("classifier", classifier);

        // Wire detector if already available (loaded before boot finished)
        const detector = this.registry.get("detector") as MediaPipeDetector | null;
        if (detector) this.wireDetector(detector, classifier);

        // Also listen for late-arriving detector (MediaPipe still loading)
        this.game.events.once("detectorReady", (det: MediaPipeDetector | null) => {
          if (det && classifier) this.wireDetector(det, classifier);
        });
      }

      this.loadingText.destroy();
      this.scene.start("Menu");
    });
  }

  private wireDetector(detector: MediaPipeDetector, classifier: SealClassifier) {
    // Start with single-player detection immediately
    detector.onFrame = async (frame) => {
      const seal = await classifier.classify(frame);
      this.registry.set("lastSeal", seal);
      this.registry.set("p1Seal",   seal);
    };

    // Load a second classifier instance for P2 and upgrade to dual detection
    new SealClassifier().init("assets/seal_classifier.onnx")
      .then(p2clf => {
        // Once P2 classifier is ready, switch to dual detection
        detector.onFrame = null; // onDualFrame now handles everything
        detector.onDualFrame = async (p1Frame, p2Frame) => {
          const p1Seal = p1Frame ? await classifier.classify(p1Frame) : ("none" as const);
          const p2Seal = p2Frame ? await p2clf.classify(p2Frame)      : ("none" as const);
          // lastSeal: P1 preferred, fall back to P2 so single-player works anywhere on screen
          this.registry.set("lastSeal", p1Seal !== "none" ? p1Seal : p2Seal);
          this.registry.set("p1Seal",   p1Seal);
          this.registry.set("p2Seal",   p2Seal);
          // Raw frames for hand-replay feature
          this.registry.set("p1Frame",  p1Frame);
          this.registry.set("p2Frame",  p2Frame);
        };
      })
      .catch(err => console.warn("[Boot] P2 classifier init failed:", err));

    detector.start();
  }
}
