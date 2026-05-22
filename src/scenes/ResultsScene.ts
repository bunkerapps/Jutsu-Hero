import Phaser from "phaser";

interface ResultsData {
  score: number;
  maxCombo: number;
  completions: number;
  totalSealsHit: number;
  sealsPerCycle: number;
  timePlayed: number;
}

export class ResultsScene extends Phaser.Scene {
  constructor() { super("Results"); }

  create(data: ResultsData) {
    const { width, height } = this.scale;

    this.add.image(width / 2, height / 2, "gameplay_bg").setDisplaySize(width, height);
    this.add.rectangle(0, 0, width, height, 0x000000, 0.72).setOrigin(0);

    this.add.text(width / 2, height * 0.10, "RESULTADOS", {
      fontFamily: "monospace", fontSize: "52px", color: "#ffcc00",
      stroke: "#000000", strokeThickness: 5,
    }).setOrigin(0.5);

    const lines: [string, string][] = [
      ["Score",          data.score.toLocaleString()],
      ["Max Combo",      `${data.maxCombo}x`],
      ["Jutsu completos",`${data.completions}`],
      ["Sellos logrados",`${data.totalSealsHit}`],
      ["Tiempo",         `${data.timePlayed}s`],
    ];

    lines.forEach(([label, value], i) => {
      const y = height * 0.26 + i * 54;
      this.add.text(width / 2 - 160, y, label, {
        fontFamily: "monospace", fontSize: "24px", color: "#aaaaaa",
      }).setOrigin(0, 0.5);
      this.add.text(width / 2 + 160, y, value, {
        fontFamily: "monospace", fontSize: "24px", color: "#ffffff",
      }).setOrigin(1, 0.5);
      this.add.rectangle(width / 2, y + 22, 340, 1, 0x333333).setOrigin(0.5);
    });

    // Grade based on completions
    const grade = data.completions >= 5 ? "S"
      : data.completions >= 3 ? "A"
      : data.completions >= 2 ? "B"
      : data.completions >= 1 ? "C" : "D";
    const gradeColors: Record<string, string> = {
      S: "#ffdd00", A: "#00ff88", B: "#44aaff", C: "#ffffff", D: "#ff6644",
    };
    this.add.text(width * 0.82, height * 0.42, grade, {
      fontFamily: "monospace", fontSize: "96px", color: gradeColors[grade] ?? "#ffffff",
      stroke: "#000000", strokeThickness: 6,
    }).setOrigin(0.5);

    // Buttons
    const retryBtn = this.add.text(width / 2 - 110, height * 0.83, "  ▶  JUGAR DE NUEVO  ", {
      fontFamily: "monospace", fontSize: "22px", color: "#ffffff",
      backgroundColor: "#cc0000", padding: { x: 16, y: 10 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });

    retryBtn
      .on("pointerover",  () => retryBtn.setBackgroundColor("#ff2222"))
      .on("pointerout",   () => retryBtn.setBackgroundColor("#cc0000"))
      .on("pointerdown",  () => { this.sound.stopAll(); this.scene.start("LevelSelect"); });

    const menuBtn = this.add.text(width / 2 + 140, height * 0.83, "  MENU  ", {
      fontFamily: "monospace", fontSize: "22px", color: "#ffffff",
      backgroundColor: "#0044cc", padding: { x: 16, y: 10 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });

    menuBtn
      .on("pointerover",  () => menuBtn.setBackgroundColor("#0066ff"))
      .on("pointerout",   () => menuBtn.setBackgroundColor("#0044cc"))
      .on("pointerdown",  () => { this.sound.stopAll(); this.scene.start("Menu"); });

    this.input.keyboard?.once("keydown-ENTER", () => { this.sound.stopAll(); this.scene.start("LevelSelect"); });
    this.input.keyboard?.once("keydown-ESC",   () => { this.sound.stopAll(); this.scene.start("Menu"); });

    this.sound.play("music_menu", { loop: true, volume: 0.5 });
  }
}
