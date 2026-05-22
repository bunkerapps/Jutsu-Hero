import Phaser from "phaser";
import type { GameDataStore } from "../data/GameData";
import type { BeatMap } from "../data/types";

interface BeatmapRow {
  color: number;
  charKey: string;
}

const BEATMAP_META: Record<string, BeatmapRow> = {
  entrenamiento_12_sellos:  { color: 0x228833, charKey: "char_naruto" },
  kage_bunshin_normal:      { color: 0x00aa44, charKey: "char_naruto" },
  rasengan_hard:            { color: 0x00ccaa, charKey: "char_naruto" },
  chidori_normal:           { color: 0x2244cc, charKey: "char_sasuke" },
  katon_goukakyuu_normal:   { color: 0xcc6600, charKey: "char_sasuke" },
  katon_housenka_hard:      { color: 0xcc2222, charKey: "char_sasuke" },
  katon_ryuuka_hard:        { color: 0xcc2222, charKey: "char_itachi" },
};

const SPEED_LABELS = ["LENTO", "NORMAL", "RÁPIDO"];
const SPEED_MULTIPLIERS = [0.7, 1.0, 1.4];

export class LevelSelectScene extends Phaser.Scene {
  private selectedRow = 0;
  private selectedSpeed = 1;
  private rowBgs: Phaser.GameObjects.Rectangle[] = [];
  private beatmaps: BeatMap[] = [];
  private characterImage!: Phaser.GameObjects.Image;
  private speedBtns: Phaser.GameObjects.Text[] = [];

  constructor() { super("LevelSelect"); }

  create() {
    const { width, height } = this.scale;
    const gameData = this.registry.get("gameData") as GameDataStore | null;
    this.beatmaps = gameData?.beatmaps ?? [];

    // Background
    this.add.image(width / 2, height / 2, "gameplay_bg").setDisplaySize(width, height);
    this.add.rectangle(0, 0, width, height, 0x000000, 0.55).setOrigin(0);

    // Title
    this.add.text(width / 2, 28, "SELECCIONAR JUTSU", {
      fontFamily: "monospace",
      fontSize: "34px",
      color: "#ffdd00",
      stroke: "#000000",
      strokeThickness: 4,
    }).setOrigin(0.5, 0);

    const listWidth = Math.floor(width * 0.62);
    const rightX = listWidth + 12;
    const rightW = width - rightX - 8;
    const rowH = 88;
    const listStartY = 90;
    const bottomBarH = 52;
    const listAreaH = height - listStartY - bottomBarH - 8;

    // ── Jutsu list rows ──────────────────────────────────────────────────
    this.beatmaps.forEach((bm, i) => {
      const jutsu = gameData?.jutsus.find(j => j.id === bm.jutsuId);
      const meta = BEATMAP_META[bm.id] ?? { color: 0x666666, charKey: "char_naruto" };
      const y = listStartY + i * rowH;

      const bg = this.add
        .rectangle(8, y, listWidth - 16, rowH - 6, meta.color, 0.35)
        .setOrigin(0)
        .setInteractive({ useHandCursor: true });

      const diffLabel = bm.difficultyId.toUpperCase();
      const displayName = jutsu?.name ?? bm.id;
      this.add.text(26, y + (rowH - 6) / 2, displayName, {
        fontFamily: "monospace",
        fontSize: "20px",
        color: "#ffffff",
        stroke: "#000000",
        strokeThickness: 2,
      }).setOrigin(0, 0.5);

      this.add.text(listWidth - 24, y + (rowH - 6) / 2, diffLabel, {
        fontFamily: "monospace",
        fontSize: "16px",
        color: "#dddddd",
      }).setOrigin(1, 0.5);

      bg.on("pointerdown", () => this.selectRow(i));
      this.rowBgs.push(bg);
    });

    // ── Right panel (character artwork) ─────────────────────────────────
    const btnAreaH = 82; // reserved at bottom of right panel for buttons
    const imgAreaH = listAreaH - btnAreaH;

    this.add.rectangle(rightX, listStartY, rightW, listAreaH, 0x0a0a1a, 0.85).setOrigin(0);
    this.add.rectangle(rightX, listStartY, rightW, listAreaH, 0x0a0a1a, 0)
      .setOrigin(0)
      .setStrokeStyle(2, 0x4455aa);

    this.characterImage = this.add
      .image(rightX + rightW / 2, listStartY + imgAreaH / 2, "char_naruto")
      .setDisplaySize(rightW - 8, imgAreaH - 4)
      .setOrigin(0.5);

    // Divider line between image and buttons
    const btnTop = listStartY + imgAreaH;
    this.add.rectangle(rightX + 4, btnTop, rightW - 8, 1, 0x334488).setOrigin(0);

    // COMENZAR button — top half of button area
    const comenzarBtn = this.add.text(rightX + rightW - 10, btnTop + 20,
      "  COMENZAR ▶  ", {
        fontFamily: "monospace",
        fontSize: "20px",
        color: "#ffffff",
        backgroundColor: "#007733",
        padding: { x: 14, y: 7 },
      }).setOrigin(1, 0.5).setInteractive({ useHandCursor: true });

    comenzarBtn
      .on("pointerover",  () => comenzarBtn.setBackgroundColor("#00aa44"))
      .on("pointerout",   () => comenzarBtn.setBackgroundColor("#007733"))
      .on("pointerdown",  () => this.startGame());

    // ⚔ BATALLA button — bottom half of button area
    const batallaBtn = this.add.text(rightX + rightW - 10, btnTop + 58,
      "  ⚔ BATALLA  ", {
        fontFamily: "monospace",
        fontSize: "17px",
        color: "#ffffff",
        backgroundColor: "#770044",
        padding: { x: 12, y: 6 },
      }).setOrigin(1, 0.5).setInteractive({ useHandCursor: true });

    batallaBtn
      .on("pointerover",  () => batallaBtn.setBackgroundColor("#aa0066"))
      .on("pointerout",   () => batallaBtn.setBackgroundColor("#770044"))
      .on("pointerdown",  () => this.startBattle());

    // ── Bottom bar: speed selector ───────────────────────────────────────
    const barY = height - bottomBarH / 2;
    this.add.rectangle(0, height - bottomBarH, width, bottomBarH, 0x000000, 0.75).setOrigin(0);

    this.add.text(16, barY, "SPEED:", {
      fontFamily: "monospace", fontSize: "17px", color: "#999999",
    }).setOrigin(0, 0.5);

    SPEED_LABELS.forEach((label, i) => {
      const btn = this.add.text(105 + i * 115, barY, `  ${label}  `, {
        fontFamily: "monospace",
        fontSize: "17px",
        color: i === this.selectedSpeed ? "#ffdd00" : "#888888",
        backgroundColor: i === this.selectedSpeed ? "#444400" : "#222222",
        padding: { x: 8, y: 6 },
      }).setOrigin(0, 0.5).setInteractive({ useHandCursor: true });

      btn.on("pointerdown", () => {
        this.selectedSpeed = i;
        this.speedBtns.forEach((b, j) => {
          b.setColor(j === i ? "#ffdd00" : "#888888");
          b.setBackgroundColor(j === i ? "#444400" : "#222222");
        });
      });
      this.speedBtns.push(btn);
    });

    // MENU button
    const menuBtn = this.add.text(listWidth - 6, barY, "  MENU  ", {
      fontFamily: "monospace",
      fontSize: "17px",
      color: "#ffffff",
      backgroundColor: "#333333",
      padding: { x: 12, y: 6 },
    }).setOrigin(1, 0.5).setInteractive({ useHandCursor: true });

    menuBtn
      .on("pointerover",  () => menuBtn.setColor("#ffcc00"))
      .on("pointerout",   () => menuBtn.setColor("#ffffff"))
      .on("pointerdown",  () => this.scene.start("Menu"));

    // Initial selection
    this.selectRow(0);

    // Keyboard nav
    this.input.keyboard?.on("keydown-UP",
      () => this.selectRow(Math.max(0, this.selectedRow - 1)));
    this.input.keyboard?.on("keydown-DOWN",
      () => this.selectRow(Math.min(this.beatmaps.length - 1, this.selectedRow + 1)));
    this.input.keyboard?.once("keydown-ENTER", () => this.startGame());
    this.input.keyboard?.once("keydown-ESC",   () => this.scene.start("Menu"));

    // Menu music continues here (don't restart if already playing)
    if (!this.sound.get("music_menu")?.isPlaying) {
      this.sound.stopAll();
      this.sound.play("music_menu", { loop: true, volume: 0.5 });
    }
  }

  private selectRow(index: number) {
    if (index < 0 || index >= this.beatmaps.length) return;
    this.selectedRow = index;

    this.rowBgs.forEach((bg, i) => {
      const meta = BEATMAP_META[this.beatmaps[i]?.id ?? ""] ?? { color: 0x666666 };
      if (i === index) {
        bg.setFillStyle(meta.color, 0.85);
        bg.setStrokeStyle(3, 0xffdd00);
      } else {
        bg.setFillStyle(meta.color, 0.35);
        bg.setStrokeStyle(0);
      }
    });

    const bm = this.beatmaps[index];
    if (bm) {
      const meta = BEATMAP_META[bm.id] ?? { charKey: "char_naruto" };
      this.characterImage.setTexture(meta.charKey);
    }
  }

  private startGame() {
    const bm = this.beatmaps[this.selectedRow];
    if (!bm) return;
    this.sound.stopAll();
    this.scene.start("Gameplay", {
      beatmapId: bm.id,
      speedMultiplier: SPEED_MULTIPLIERS[this.selectedSpeed] ?? 1.0,
    });
  }

  private startBattle() {
    const bm = this.beatmaps[this.selectedRow];
    if (!bm) return;
    this.sound.stopAll();
    this.scene.start("Battle", {
      beatmapId: bm.id,
      speedMultiplier: SPEED_MULTIPLIERS[this.selectedSpeed] ?? 1.0,
    });
  }
}
