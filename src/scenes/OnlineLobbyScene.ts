import Phaser from "phaser";
import type { GameDataStore } from "../data/GameData";
import type { BeatMap } from "../data/types";
import { network } from "../network/NetworkManager";
import { getJutsuPower, powerStars } from "../data/jutsuPower";

const SERVER_URL = (import.meta as any).env?.VITE_SERVER_URL
  ?? (typeof window !== "undefined" ? window.location.origin : "http://localhost:3001");

const ELEMENT_ICON: Record<string, string> = { fire: "🔥", lightning: "⚡", wind: "💨" };

const ELEMENT_BG: Record<string, number> = {
  wind: 0x003322, lightning: 0x001155, fire: 0x551100,
};

type LobbyPhase = "main" | "create" | "join" | "select";

export class OnlineLobbyScene extends Phaser.Scene {
  private beatmaps: BeatMap[]       = [];
  private battleBeatmaps: BeatMap[] = [];
  private gameData: GameDataStore | null = null;

  private currentPhase: LobbyPhase  = "main";
  private selectedBeatmapId: string | null = null;
  private opponentBeatmapId: string | null = null;
  private localReady = false;
  private playerCount = 1;
  private countdownEvent: Phaser.Time.TimerEvent | null = null;

  private codeInput: HTMLInputElement | null = null;

  // Live UI refs
  private mainTitle!:          Phaser.GameObjects.Text;
  private codeDisplay!:        Phaser.GameObjects.Text;
  private statusText!:         Phaser.GameObjects.Text;
  private opponentPickBanner!: Phaser.GameObjects.Text;
  private p1HintText!:         Phaser.GameObjects.Text;
  private selectedLabel!:      Phaser.GameObjects.Text;
  private readyBtn!:           Phaser.GameObjects.Text;
  private countdownText!:      Phaser.GameObjects.Text;

  // Phase groups
  private mainGroup:   Phaser.GameObjects.GameObject[] = [];
  private createGroup: Phaser.GameObjects.GameObject[] = [];
  private joinGroup:   Phaser.GameObjects.GameObject[] = [];
  private selectGroup: Phaser.GameObjects.GameObject[] = [];

  constructor() { super("OnlineLobby"); }

  create() {
    this.selectedBeatmapId = null;
    this.opponentBeatmapId = null;
    this.playerCount = 1;
    this.localReady        = false;
    this.countdownEvent?.remove(false);
    this.countdownEvent = null;

    const { width, height } = this.scale;
    this.gameData      = this.registry.get("gameData") as GameDataStore | null;
    this.beatmaps      = this.gameData?.beatmaps ?? [];
    // Battle jutsus sorted by seal count (fewer = faster/weaker, more = slower/stronger)
    this.battleBeatmaps = this.beatmaps
      .filter(bm => bm.jutsuId !== "entrenamiento_12_sellos")
      .sort((a, b) => a.notes.length - b.notes.length);

    this.add.image(width / 2, height / 2, "gameplay_bg").setDisplaySize(width, height);
    this.add.rectangle(0, 0, width, height, 0x000000, 0.65).setOrigin(0);

    this.mainTitle = this.add.text(width / 2, 36, "MODO ONLINE", {
      fontFamily: "monospace", fontSize: "46px",
      color: "#ffdd00", stroke: "#000000", strokeThickness: 5,
    }).setOrigin(0.5, 0);

    const back = this.add.text(20, 20, "◀ MENÚ", {
      fontFamily: "monospace", fontSize: "20px",
      color: "#aaaaaa", backgroundColor: "#00000080",
      padding: { x: 10, y: 6 },
    }).setOrigin(0, 0).setInteractive({ useHandCursor: true });
    back.on("pointerover", () => back.setColor("#ffffff"));
    back.on("pointerout",  () => back.setColor("#aaaaaa"));
    back.on("pointerdown", () => {
      this.countdownEvent?.remove(false);
      this.destroyCodeInput();
      network.clearCallbacks();
      network.disconnect();
      this.scene.start("Menu");
    });

    this.buildMainPhase();
    this.buildCreatePhase();
    this.buildJoinPhase();
    this.buildSelectPhase();

    this.showPhase("main");
    this.wireNetwork();

    network.onConnected    = () => { if (this.currentPhase === "main") this.showStatus("✓ Conectado", "#44ff88"); };
    network.onConnectError = (e) => { if (this.currentPhase === "main") this.showStatus(`✗ Sin conexión: ${e.message}`, "#ff4444"); };
    this.showStatus("Conectando…", "#aaaaff");
    network.connect(SERVER_URL);
  }

  // ── Phase builders ─────────────────────────────────────────────────────────

  private buildMainPhase() {
    const { width, height } = this.scale;

    const createBtn = this.add.text(width / 2, height * 0.44, "  CREAR SALA  ", {
      fontFamily: "monospace", fontSize: "36px",
      color: "#ffffff", backgroundColor: "#cc0000",
      padding: { x: 36, y: 16 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    createBtn.on("pointerover", () => createBtn.setBackgroundColor("#ff2222"));
    createBtn.on("pointerout",  () => createBtn.setBackgroundColor("#cc0000"));
    createBtn.on("pointerdown", () => {
      if (!network.connected) { this.showStatus("Conectando…"); return; }
      network.createRoom();
    });

    const joinBtn = this.add.text(width / 2, height * 0.62, "  UNIRME A SALA  ", {
      fontFamily: "monospace", fontSize: "36px",
      color: "#ffffff", backgroundColor: "#004499",
      padding: { x: 36, y: 16 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    joinBtn.on("pointerover", () => joinBtn.setBackgroundColor("#0066cc"));
    joinBtn.on("pointerout",  () => joinBtn.setBackgroundColor("#004499"));
    joinBtn.on("pointerdown", () => {
      if (!network.connected) { this.showStatus("Conectando…"); return; }
      this.showPhase("join");
    });

    this.statusText = this.add.text(width / 2, height * 0.84, "", {
      fontFamily: "monospace", fontSize: "18px", color: "#ffaa44",
    }).setOrigin(0.5);

    this.mainGroup = [createBtn, joinBtn];
  }

  private buildCreatePhase() {
    const { width, height } = this.scale;

    this.add.text(width / 2, height * 0.30, "TU CÓDIGO DE SALA:", {
      fontFamily: "monospace", fontSize: "22px", color: "#aaaaaa",
    }).setOrigin(0.5).setVisible(false);

    this.codeDisplay = this.add.text(width / 2, height * 0.46, "----", {
      fontFamily: "monospace", fontSize: "88px",
      color: "#ffdd00", stroke: "#000000", strokeThickness: 6, letterSpacing: 18,
    }).setOrigin(0.5).setVisible(false);

    const waitLabel = this.add.text(width / 2, height * 0.68, "Esperando al oponente…", {
      fontFamily: "monospace", fontSize: "24px", color: "#aaaaff",
    }).setOrigin(0.5).setVisible(false);

    this.createGroup = [this.codeDisplay, waitLabel];
  }

  private buildJoinPhase() {
    const { width, height } = this.scale;

    const label = this.add.text(width / 2, height * 0.33, "Ingresa el código de sala:", {
      fontFamily: "monospace", fontSize: "26px", color: "#ffffff",
    }).setOrigin(0.5).setVisible(false);

    const inputBox = this.add.rectangle(width / 2, height * 0.50, 320, 80, 0x111133, 0.9)
      .setOrigin(0.5).setVisible(false);
    const inputHint = this.add.text(width / 2, height * 0.50, "XXXX", {
      fontFamily: "monospace", fontSize: "52px", color: "#445566", letterSpacing: 14,
    }).setOrigin(0.5).setVisible(false);

    const confirmBtn = this.add.text(width / 2, height * 0.66, "  ENTRAR  ", {
      fontFamily: "monospace", fontSize: "30px",
      color: "#ffffff", backgroundColor: "#005500",
      padding: { x: 28, y: 12 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true }).setVisible(false);
    confirmBtn.on("pointerdown", () => this.confirmJoin());

    this.joinGroup = [label, inputBox, inputHint, confirmBtn];
  }

  private buildSelectPhase() {
    const { width, height } = this.scale;
    const bms    = this.battleBeatmaps;
    const listW  = Math.min(width - 32, 720);
    const startX = (width - listW) / 2;
    const startY = height * 0.21;
    const rowH   = Math.max(46, Math.floor((height * 0.53) / bms.length));

    // P1 hint: shown only for P1
    this.p1HintText = this.add.text(width / 2, height * 0.12,
      "El oponente verá tu elección · él elige segundo", {
      fontFamily: "monospace", fontSize: "13px", color: "#888888",
    }).setOrigin(0.5).setVisible(false);

    // Opponent pick banner: shown for P2 once P1 has selected
    this.opponentPickBanner = this.add.text(width / 2, height * 0.12, "", {
      fontFamily: "monospace", fontSize: "15px",
      color: "#ffcc44", backgroundColor: "#441100",
      padding: { x: 14, y: 6 }, stroke: "#000", strokeThickness: 2,
    }).setOrigin(0.5).setVisible(false);

    // Jutsu list rows
    bms.forEach((bm, i) => {
      const jutsu    = this.gameData?.jutsus.find(j => j.id === bm.jutsuId);
      const power    = getJutsuPower(bm.jutsuId);
      const bgColor  = ELEMENT_BG[power.element ?? ""] ?? 0x223344;
      const elemIcon = power.element ? (ELEMENT_ICON[power.element] ?? "○") : "○";
      const stars    = powerStars(power.power);
      const seals    = bm.notes.length;
      const y        = startY + i * rowH;

      const bg = this.add.rectangle(startX, y, listW, rowH - 4, bgColor, 0.45)
        .setOrigin(0).setInteractive({ useHandCursor: true }).setVisible(false);

      const nameText = this.add.text(startX + 12, y + (rowH - 4) / 2,
        `${elemIcon} ${jutsu?.nameES ?? bm.id}`, {
        fontFamily: "monospace", fontSize: "17px",
        color: "#ffffff", stroke: "#000", strokeThickness: 2,
      }).setOrigin(0, 0.5).setVisible(false);

      const metaText = this.add.text(startX + listW - 12, y + (rowH - 4) / 2,
        `${seals} sellos  ${stars}  Rng ${power.rank}`, {
        fontFamily: "monospace", fontSize: "14px", color: "#ffcc44",
      }).setOrigin(1, 0.5).setVisible(false);

      bg.on("pointerover",  () => { if (!this.localReady) bg.setFillStyle(bgColor, 0.80); });
      bg.on("pointerout",   () => { if (!this.localReady) bg.setFillStyle(bgColor, 0.45); });
      bg.on("pointerdown",  () => {
        if (this.localReady) return;
        this.selectedBeatmapId = bm.id;
        network.selectJutsu(bm.id);
        if (network.role !== "p1") {
          // Non-host (both 1v1 and BR): auto-ready on selection — host decides when to start
          this.localReady = true;
          network.setReady();
          this.selectedLabel.setText(`✓ ${jutsu?.nameES ?? bm.id}  — ¡Votado!`);
        } else {
          this.selectedLabel.setText(`► ${jutsu?.nameES ?? bm.id}  (${seals} sellos  ${stars})`);
        }
      });

      this.selectGroup.push(bg, nameText, metaText);
    });

    // Bottom elements — positioned below the list
    const listEndY   = startY + bms.length * rowH;
    const labelY     = listEndY + 14;
    const cdY        = Math.max(labelY + 32, height * 0.85);
    const readyBtnY  = Math.max(cdY + 42, height * 0.92);

    this.selectedLabel = this.add.text(width / 2, labelY, "Toca un jutsu para seleccionar", {
      fontFamily: "monospace", fontSize: "15px", color: "#aaffaa",
    }).setOrigin(0.5).setVisible(false);

    this.countdownText = this.add.text(width / 2, cdY, "", {
      fontFamily: "monospace", fontSize: "18px", color: "#ffdd44",
    }).setOrigin(0.5).setVisible(false);

    this.readyBtn = this.add.text(width / 2, readyBtnY, "  ¡LISTO!  ", {
      fontFamily: "monospace", fontSize: "28px",
      color: "#ffffff", backgroundColor: "#006600",
      padding: { x: 28, y: 10 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true }).setVisible(false);
    this.readyBtn.on("pointerdown", () => this.confirmReady());

    this.selectGroup.push(
      this.p1HintText, this.opponentPickBanner,
      this.selectedLabel, this.countdownText, this.readyBtn,
    );
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  private confirmReady() {
    if (!this.selectedBeatmapId || this.localReady) return;
    this.localReady = true;
    this.countdownEvent?.remove(false);
    this.countdownEvent = null;
    this.countdownText.setVisible(false);
    this.readyBtn.setBackgroundColor("#004400").setText("  Esperando oponente…  ");
    network.setReady();
  }


  // ── Phase visibility ───────────────────────────────────────────────────────

  private showPhase(p: LobbyPhase) {
    this.currentPhase = p;
    const hide = (arr: Phaser.GameObjects.GameObject[]) =>
      arr.forEach(o => (o as any).setVisible?.(false));
    const show = (arr: Phaser.GameObjects.GameObject[]) =>
      arr.forEach(o => (o as any).setVisible?.(true));

    hide(this.mainGroup);
    hide(this.createGroup);
    hide(this.joinGroup);
    hide(this.selectGroup);

    this.mainTitle?.setText(p === "select" ? "ELIGE TU JUTSU" : "MODO ONLINE");

    if (p === "main")   { show(this.mainGroup); }
    if (p === "create") { show(this.createGroup); this.codeDisplay.setVisible(true); }
    if (p === "join")   { show(this.joinGroup); this.spawnCodeInput(); }

    if (p === "select") {
      show(this.selectGroup);
      this.destroyCodeInput();
      this.opponentPickBanner.setVisible(false);
      this.countdownText.setVisible(false);

      const isBR = this.playerCount >= 3;
      if (network.role === "p1") {
        // Host: LISTO button — can start anytime
        this.p1HintText.setVisible(!isBR);
        this.readyBtn
          .setBackgroundColor("#006600")
          .setText("  ¡LISTO!  ")
          .setVisible(true)
          .setInteractive({ useHandCursor: true });
        if (isBR) {
          this.showStatus(`Battle Royale — Jugadores: ${this.playerCount}/4`, "#ffaa44");
        }
      } else {
        // Non-host (P2/P3/P4, 1v1 or BR): just select jutsu — host decides when to start
        this.p1HintText.setVisible(false);
        this.readyBtn.setVisible(false);
        const hint = isBR
          ? `BR ${this.playerCount}/4 — Elige tu jutsu`
          : "Elige tu jutsu — el creador decide cuándo empezar";
        this.showStatus(hint, "#ffaa44");
      }
    }
  }

  private showStatus(msg: string, color = "#ffaa44") {
    this.statusText?.setText(msg).setColor(color);
  }

  // ── HTML code input ────────────────────────────────────────────────────────

  private spawnCodeInput() {
    this.destroyCodeInput();
    const input = document.createElement("input");
    input.type = "text"; input.maxLength = 4;
    input.placeholder = "XXXX";
    input.autocomplete = "off";
    input.autocapitalize = "characters";
    Object.assign(input.style, {
      position: "fixed", top: "50%", left: "50%",
      transform: "translate(-50%, -60%)",
      fontSize: "48px", fontFamily: "monospace",
      width: "240px", textAlign: "center",
      background: "#111133", color: "#ffdd00",
      border: "3px solid #4466aa", borderRadius: "8px",
      padding: "8px 16px", outline: "none",
      letterSpacing: "14px", zIndex: "100",
      textTransform: "uppercase",
    } as CSSStyleDeclaration);
    document.body.appendChild(input);
    input.focus();
    this.codeInput = input;
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") this.confirmJoin(); });
  }

  private destroyCodeInput() {
    if (this.codeInput) { this.codeInput.remove(); this.codeInput = null; }
  }

  private confirmJoin() {
    const code = (this.codeInput?.value ?? "").trim().toUpperCase();
    if (code.length !== 4) { this.showStatus("Ingresa un código de 4 letras"); return; }
    network.joinRoom(code);
    this.showStatus("Conectando…");
  }

  // ── Network callbacks ──────────────────────────────────────────────────────

  private wireNetwork() {
    network.onRoomCreated = (code) => {
      this.showPhase("create");
      this.codeDisplay.setText(code);
    };

    network.onRoomJoined = (_role, count) => {
      this.playerCount = count;
      this.showPhase("select");
      this.selectedLabel.setText("Toca un jutsu para seleccionar");
    };

    network.onRoomError = (msg) => { this.showStatus(`Error: ${msg}`); };

    network.onOpponentConnected = (_role, count) => {
      this.playerCount = count;
      const isBR = count >= 3;
      if (this.currentPhase !== "select") {
        this.showPhase("select");
        this.selectedLabel.setText("Toca un jutsu para seleccionar");
      } else {
        // Already in select — update status
        this.countdownEvent?.remove(false);
        this.countdownText.setVisible(false);
        const hint = isBR
          ? (network.role === "p1"
              ? `Battle Royale — Jugadores: ${count}/4`
              : `BR ${count}/4 — Elige tu jutsu`)
          : `Jugadores: ${count}/4`;
        this.showStatus(hint, "#ffaa44");
        // If a non-host player joined and already selected a jutsu, auto-ready them now
        if (network.role !== "p1" && this.selectedBeatmapId && !this.localReady) {
          this.localReady = true;
          network.setReady();
          const bm = this.battleBeatmaps.find(b => b.id === this.selectedBeatmapId);
          const j  = this.gameData?.jutsus.find(ju => ju.id === bm?.jutsuId);
          this.selectedLabel.setText(`✓ ${j?.nameES ?? this.selectedBeatmapId}  — ¡Votado!`);
        }
      }
    };

    network.onSelectionStart = () => { this.showPhase("select"); };

    network.onOpponentJutsuSelected = (beatmapId, role) => {
      this.opponentBeatmapId = beatmapId;
      const bm    = this.battleBeatmaps.find(b => b.id === beatmapId);
      const jutsu = this.gameData?.jutsus.find(j => j.id === bm?.jutsuId);
      const power = getJutsuPower(bm?.jutsuId ?? "");
      const stars = powerStars(power.power);
      const seals = bm?.notes.length ?? "?";
      const name  = jutsu?.nameES ?? beatmapId;

      this.opponentPickBanner
        .setText(`⚔ ${role.toUpperCase()} ELIGIÓ: ${name}  —  ${seals} sellos  ${stars}`)
        .setVisible(true);
      // P1 sees live vote tally — no counter-pick lock needed
    };

    network.onOpponentReady = () => {
      if (network.role === "p1" && this.opponentBeatmapId && this.playerCount < 3) {
        const bm   = this.battleBeatmaps.find(b => b.id === this.opponentBeatmapId);
        const j    = this.gameData?.jutsus.find(ju => ju.id === bm?.jutsuId);
        const name = j?.nameES ?? this.opponentBeatmapId;
        this.opponentPickBanner
          .setText(`✓ Oponente contra-eligió: ${name} y está listo`)
          .setVisible(true);
      }
    };

    network.onMatchStart = (data) => {
      this.destroyCodeInput();
      this.countdownEvent?.remove(false);
      network.clearCallbacks();
      const myRole = network.role ?? "p1";
      const myBeatmap  = data.beatmaps?.[myRole] ?? data.p1BeatmapId;
      const oppBeatmap = data.beatmaps?.["p2"] ?? data.p2BeatmapId;
      this.time.delayedCall(data.startDelay - 400, () => {
        this.scene.start("NetworkBattle", {
          myBeatmapId:  myBeatmap,
          oppBeatmapId: oppBeatmap,
          beatmaps:     data.beatmaps,
          role:         network.role,
          playerCount:  data.playerCount ?? 2,
          startDelay:   400,
        });
      });
      // Countdown animation
      let n = Math.round(data.startDelay / 1000);
      const ct = this.add.text(this.scale.width / 2, this.scale.height / 2, `${n}`, {
        fontFamily: "monospace", fontSize: "100px", color: "#ffdd00",
        stroke: "#000", strokeThickness: 8,
      }).setOrigin(0.5).setDepth(10);
      const tick = this.time.addEvent({
        delay: 1000, repeat: n - 1,
        callback: () => {
          n--;
          if (n > 0) {
            ct.setText(`${n}`).setScale(1.4);
            this.tweens.add({ targets: ct, scaleX: 1, scaleY: 1, duration: 400, ease: "Back.Out" });
          } else {
            ct.setText("¡YA!").setColor("#ff4400");
            this.tweens.add({ targets: ct, alpha: 0, duration: 500,
              onComplete: () => { ct.destroy(); tick.remove(); } });
          }
        },
      });
    };

    network.onOpponentDisconnected = () => {
      this.countdownEvent?.remove(false);
      this.showStatus("El oponente se desconectó");
      this.showPhase("main");
    };
  }

  shutdown() {
    this.countdownEvent?.remove(false);
    this.destroyCodeInput();
    network.clearCallbacks();
  }
}
