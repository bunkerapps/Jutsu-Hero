import Phaser from "phaser";

export class MenuScene extends Phaser.Scene {
  constructor() { super("Menu"); }

  create() {
    const { width, height } = this.scale;

    // Village background (opaque)
    this.add.image(width / 2, height / 2, "gameplay_bg").setDisplaySize(width, height);
    this.add.rectangle(0, 0, width, height, 0x000000, 0.45).setOrigin(0);

    // Title
    this.add.text(width / 2, height * 0.22, "JUTSU HERO", {
      fontFamily: "monospace",
      fontSize: "80px",
      color: "#ffdd00",
      stroke: "#000000",
      strokeThickness: 6,
    }).setOrigin(0.5);

    // Subtitle
    this.add.text(width / 2, height * 0.36, "Master the Hand Seals", {
      fontFamily: "monospace",
      fontSize: "28px",
      color: "#ffffff",
      stroke: "#000000",
      strokeThickness: 3,
    }).setOrigin(0.5);

    // START button
    const startBtn = this.add.text(width / 2, height * 0.50, "  ▶  START  ", {
      fontFamily: "monospace",
      fontSize: "36px",
      color: "#ffffff",
      backgroundColor: "#cc0000",
      padding: { x: 36, y: 16 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });

    startBtn
      .on("pointerover",  () => startBtn.setBackgroundColor("#ff2222"))
      .on("pointerout",   () => startBtn.setBackgroundColor("#cc0000"))
      .on("pointerdown",  () => this.scene.start("LevelSelect"));

    // ONLINE button
    const onlineBtn = this.add.text(width / 2, height * 0.62, "  🌐  ONLINE  ", {
      fontFamily: "monospace",
      fontSize: "28px",
      color: "#ffffff",
      backgroundColor: "#006622",
      padding: { x: 32, y: 12 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });

    onlineBtn
      .on("pointerover",  () => onlineBtn.setBackgroundColor("#009933"))
      .on("pointerout",   () => onlineBtn.setBackgroundColor("#006622"))
      .on("pointerdown",  () => this.scene.start("OnlineLobby"));

    // TUTORIAL button
    const tutBtn = this.add.text(width / 2, height * 0.73, "  📖  TUTORIAL  ", {
      fontFamily: "monospace",
      fontSize: "26px",
      color: "#ffffff",
      backgroundColor: "#885500",
      padding: { x: 28, y: 11 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });

    tutBtn
      .on("pointerover",  () => tutBtn.setBackgroundColor("#bb7700"))
      .on("pointerout",   () => tutBtn.setBackgroundColor("#885500"))
      .on("pointerdown",  () => this.scene.start("Tutorial"));

    // QUIT button
    const quitBtn = this.add.text(width / 2, height * 0.83, "  QUIT  ", {
      fontFamily: "monospace",
      fontSize: "26px",
      color: "#ffffff",
      backgroundColor: "#0044cc",
      padding: { x: 28, y: 11 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });

    quitBtn
      .on("pointerover",  () => quitBtn.setBackgroundColor("#0066ff"))
      .on("pointerout",   () => quitBtn.setBackgroundColor("#0044cc"))
      .on("pointerdown",  () => this.showQuitConfirm(width, height));

    // Keyboard hints
    this.add.text(width / 2, height * 0.92,
      "Keys 1-8 trigger seal inputs  |  R = restart  |  Esc = stop", {
      fontFamily: "monospace",
      fontSize: "16px",
      color: "#aaaaaa",
    }).setOrigin(0.5);

    this.input.keyboard?.once("keydown-ENTER", () => this.scene.start("LevelSelect"));
    this.input.keyboard?.once("keydown-SPACE", () => this.scene.start("LevelSelect"));

    // Menu music — start only if not already playing (scene restart-safe)
    if (!this.sound.get("music_menu")?.isPlaying) {
      this.sound.stopAll();
      const savedVol = parseInt(localStorage.getItem("jutsu-hero-music-vol") ?? "70", 10) / 100;
      this.sound.play("music_menu", { loop: true, volume: 0.45 * savedVol });
    }
  }

  private showQuitConfirm(width: number, height: number) {
    const cx = width / 2;
    const cy = height / 2;

    const overlay = this.add.rectangle(0, 0, width, height, 0x000000, 0.65)
      .setOrigin(0).setDepth(100).setInteractive();

    const border  = this.add.rectangle(cx, cy, 384, 184, 0x4455ff).setDepth(100.5);
    const panel   = this.add.rectangle(cx, cy, 380, 180, 0x111122).setDepth(101);
    const label   = this.add.text(cx, cy - 44, "¿Cerrar el juego?", {
      fontFamily: "monospace", fontSize: "22px", color: "#ffffff",
    }).setOrigin(0.5).setDepth(102);

    const yesBtn = this.add.text(cx - 70, cy + 20, "  SÍ  ", {
      fontFamily: "monospace", fontSize: "20px", color: "#ffffff",
      backgroundColor: "#cc0000", padding: { x: 18, y: 10 },
    }).setOrigin(0.5).setDepth(102).setInteractive({ useHandCursor: true });

    const noBtn = this.add.text(cx + 70, cy + 20, "  NO  ", {
      fontFamily: "monospace", fontSize: "20px", color: "#ffffff",
      backgroundColor: "#226600", padding: { x: 18, y: 10 },
    }).setOrigin(0.5).setDepth(102).setInteractive({ useHandCursor: true });

    const destroy = () => {
      overlay.destroy(); border.destroy(); panel.destroy();
      label.destroy(); yesBtn.destroy(); noBtn.destroy();
      this.input.keyboard?.off("keydown-ESC", destroy);
    };

    yesBtn
      .on("pointerover",  () => yesBtn.setBackgroundColor("#ff2222"))
      .on("pointerout",   () => yesBtn.setBackgroundColor("#cc0000"))
      .on("pointerdown",  () => window.close());

    noBtn
      .on("pointerover",  () => noBtn.setBackgroundColor("#33aa00"))
      .on("pointerout",   () => noBtn.setBackgroundColor("#226600"))
      .on("pointerdown",  () => destroy());

    this.input.keyboard?.once("keydown-ESC", destroy);
  }
}
