import Phaser from "phaser";

// Approximate timestamps (seconds) for each seal in hand_signs_tutorial.mp4.
// Adjust these to match the actual video cuts.
const SEAL_CHAPTERS: { id: string; name: string; japanese: string; t: number }[] = [
  { id: "rat",     name: "Ne · Rata",       japanese: "子",  t: 55  },
  { id: "ox",      name: "Ushi · Buey",     japanese: "丑",  t: 80  },
  { id: "tiger",   name: "Tora · Tigre",    japanese: "寅",  t: 105 },
  { id: "hare",    name: "U · Liebre",      japanese: "卯",  t: 127 },
  { id: "dragon",  name: "Tatsu · Dragón",  japanese: "辰",  t: 150 },
  { id: "serpent", name: "Mi · Serpiente",  japanese: "巳",  t: 180 },
  { id: "horse",   name: "Uma · Caballo",   japanese: "午",  t: 195 },
  { id: "ram",     name: "Hitsuji · Cabra", japanese: "未",  t: 250 },
  { id: "monkey",  name: "Saru · Mono",     japanese: "申",  t: 285 },
  { id: "bird",    name: "Tori · Pájaro",   japanese: "酉",  t: 315 },
  { id: "dog",     name: "Inu · Perro",     japanese: "戌",  t: 345 },
  { id: "boar",    name: "I · Jabalí",      japanese: "亥",  t: 360 },
];

const SEAL_IMG: Record<string, string> = {
  rat: "Ne.jpg", ox: "Ushi.jpg", tiger: "Tora.jpg", hare: "U.jpg",
  dragon: "Tatsu.jpg", serpent: "Mi.jpg", horse: "Uma.jpg", ram: "Hitsuji.jpg",
  monkey: "Saru.jpg", bird: "Tori.jpg", dog: "Inu.jpg", boar: "I.jpg",
};

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.5, 2];

export class TutorialScene extends Phaser.Scene {
  private overlay!: HTMLElement;
  private tutVideo!: HTMLVideoElement;
  private backHandler!: () => void;

  // Loop-chapter state
  private loopStart = -1;
  private loopEnd   = -1;
  private loopAF    = -1;

  constructor() { super("Tutorial"); }

  create() {
    let overlay = document.getElementById("tutorial-overlay");
    if (!overlay) overlay = this.buildOverlay();
    this.overlay  = overlay;
    this.tutVideo = document.getElementById("tutorial-video") as HTMLVideoElement;

    // Stop all Phaser audio so tutorial video audio plays cleanly
    this.sound.stopAll();

    this.backHandler = () => {
      this.tutVideo.pause();
      this.overlay.style.display = "none";
      cancelAnimationFrame(this.loopAF);
      this.scene.start("Menu");  // MenuScene.create() restarts music_menu
    };
    document.getElementById("tutorial-back")!.addEventListener("click", this.backHandler);

    this.overlay.style.display = "flex";
    this.tutVideo.currentTime = 0;
    this.tutVideo.play().catch(() => {});

    // Refresh control state now that video element is live
    this.syncControls();
  }

  shutdown() {
    document.getElementById("tutorial-back")?.removeEventListener("click", this.backHandler);
    cancelAnimationFrame(this.loopAF);
    if (this.overlay) this.overlay.style.display = "none";
  }

  // ── DOM build ─────────────────────────────────────────────────────────────

  private buildOverlay(): HTMLElement {
    const div = document.createElement("div");
    div.id = "tutorial-overlay";

    div.innerHTML = `
      <div id="tutorial-header">
        <button id="tutorial-back">← Volver</button>
        <span id="tutorial-title">📖 Tutorial — Sellos de Mano</span>
      </div>
      <div id="tutorial-body">
        <div id="tutorial-video-wrap">
          <video id="tutorial-video"
            src="/assets/audio/video/hand_signs_tutorial.mp4"
            playsinline>
          </video>
          <div id="tutorial-controls">
            <input type="range" id="tut-progress" min="0" max="100" value="0" step="0.05">
            <div class="tut-ctrl-row">
              <button class="tut-btn" id="tut-rew10">⏮ -10s</button>
              <button class="tut-btn" id="tut-rew5">◀ -5s</button>
              <button class="tut-btn" id="tut-playpause">▶</button>
              <button class="tut-btn" id="tut-fwd5">+5s ▶</button>
              <button class="tut-btn" id="tut-fwd10">+10s ⏭</button>
              <span id="tut-timecode">0:00 / 0:00</span>
            </div>
            <div class="tut-ctrl-row">
              <span id="tut-loop-label">Velocidad:</span>
              ${SPEEDS.map(s => `<button class="tut-btn tut-speed${s === 1 ? " active" : ""}" data-speed="${s}">${s}×</button>`).join("")}
              <button class="tut-btn" id="tut-loop-btn" title="Repetir sello actual en bucle">🔁 Loop sello</button>
            </div>
          </div>
        </div>
        <div id="tutorial-chapters">
          <div id="tutorial-chapters-title">Saltar al sello</div>
          <div id="tutorial-chapters-list"></div>
        </div>
      </div>
    `;

    const vid      = div.querySelector("#tutorial-video") as HTMLVideoElement;
    const progress = div.querySelector("#tut-progress") as HTMLInputElement;
    const ppBtn    = div.querySelector("#tut-playpause") as HTMLButtonElement;
    const timecode = div.querySelector("#tut-timecode")!;
    const loopBtn  = div.querySelector("#tut-loop-btn") as HTMLButtonElement;
    const list     = div.querySelector("#tutorial-chapters-list")!;

    // ── Playback controls ────────────────────────────────────────────────────

    ppBtn.addEventListener("click", () => {
      if (vid.paused) vid.play();
      else vid.pause();
    });

    div.querySelector("#tut-rew5")!.addEventListener("click",  () => { vid.currentTime = Math.max(0, vid.currentTime - 5); });
    div.querySelector("#tut-rew10")!.addEventListener("click", () => { vid.currentTime = Math.max(0, vid.currentTime - 10); });
    div.querySelector("#tut-fwd5")!.addEventListener("click",  () => { vid.currentTime += 5; });
    div.querySelector("#tut-fwd10")!.addEventListener("click", () => { vid.currentTime += 10; });

    vid.addEventListener("play",  () => { ppBtn.textContent = "⏸"; });
    vid.addEventListener("pause", () => { ppBtn.textContent = "▶"; });

    // ── Progress scrubber ────────────────────────────────────────────────────

    vid.addEventListener("timeupdate", () => {
      if (!vid.duration) return;
      const pct = (vid.currentTime / vid.duration) * 100;
      progress.value = String(pct);
      timecode.textContent = `${fmt(vid.currentTime)} / ${fmt(vid.duration)}`;
      // highlight active chapter
      const cur = [...SEAL_CHAPTERS].reverse().find(c => vid.currentTime >= c.t);
      list.querySelectorAll(".ch-btn").forEach(b => {
        b.classList.toggle("active", (b as HTMLElement).dataset.sealT === String(cur?.t ?? -1));
      });
    });

    vid.addEventListener("loadedmetadata", () => {
      progress.max = "100";
      timecode.textContent = `0:00 / ${fmt(vid.duration)}`;
    });

    progress.addEventListener("input", () => {
      if (vid.duration) vid.currentTime = (parseFloat(progress.value) / 100) * vid.duration;
    });

    // ── Speed buttons ────────────────────────────────────────────────────────

    div.querySelectorAll(".tut-speed").forEach(btn => {
      btn.addEventListener("click", () => {
        const s = parseFloat((btn as HTMLElement).dataset.speed ?? "1");
        vid.playbackRate = s;
        div.querySelectorAll(".tut-speed").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
      });
    });

    // ── Loop-chapter button ──────────────────────────────────────────────────

    let looping = false;
    loopBtn.addEventListener("click", () => {
      looping = !looping;
      loopBtn.classList.toggle("active", looping);
      if (looping) {
        // Find the chapter that matches current position
        const cur = [...SEAL_CHAPTERS].reverse().find(c => vid.currentTime >= c.t);
        if (!cur) { looping = false; loopBtn.classList.remove("active"); return; }
        const idx  = SEAL_CHAPTERS.indexOf(cur);
        this.loopStart = cur.t;
        this.loopEnd   = (SEAL_CHAPTERS[idx + 1]?.t ?? vid.duration) - 0.1;
        vid.currentTime = this.loopStart;
        vid.play();
        loopBtn.title = `Repitiendo: ${cur.name}`;
        const tick = () => {
          if (!looping) return;
          if (vid.currentTime >= this.loopEnd) vid.currentTime = this.loopStart;
          this.loopAF = requestAnimationFrame(tick);
        };
        this.loopAF = requestAnimationFrame(tick);
      } else {
        cancelAnimationFrame(this.loopAF);
        loopBtn.title = "Repetir sello actual en bucle";
      }
    });

    // ── Chapter buttons ──────────────────────────────────────────────────────

    for (const ch of SEAL_CHAPTERS) {
      const btn = document.createElement("button");
      btn.className = "ch-btn";
      btn.dataset.sealT = String(ch.t);
      btn.innerHTML = `
        <img src="/assets/art/seals/${SEAL_IMG[ch.id]}" alt="${ch.name}">
        <div class="ch-info">
          <span class="ch-name">${ch.name}</span>
          <span class="ch-ja">${ch.japanese}</span>
        </div>
      `;
      btn.addEventListener("click", () => {
        // If loop mode is on, re-anchor loop to this chapter
        if (looping) {
          const idx = SEAL_CHAPTERS.indexOf(ch);
          this.loopStart = ch.t;
          this.loopEnd   = (SEAL_CHAPTERS[idx + 1]?.t ?? vid.duration) - 0.1;
          loopBtn.title  = `Repitiendo: ${ch.name}`;
        }
        vid.currentTime = ch.t;
        vid.play().catch(() => {});
      });
      list.appendChild(btn);
    }

    document.getElementById("game-container")!.appendChild(div);
    return div;
  }

  private syncControls() {
    const pp = document.getElementById("tut-playpause");
    if (pp) pp.textContent = this.tutVideo?.paused ? "▶" : "⏸";
  }
}

function fmt(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}
