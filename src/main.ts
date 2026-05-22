import { createGame } from "./game";
import { MediaPipeDetector } from "./hand-detection/MediaPipeDetector";
import { network } from "./network/NetworkManager";

// Game layout constants shared with BattleScene
const HW_W     = 300;
const BOT_H    = 52;
// Portrait PiP (taller than wide — TikTok style)
const PIP_W    = 130;   // portrait width  (game-space px)
const PIP_H    = 220;   // portrait height (game-space px)
const REPLAY_SCALE = 2; // display at 2× capture size

// Compute PiP/replay positions relative to the live game dimensions
function pipPositions(gW: number, gH: number) {
  const half   = gW / 2;
  const hwOff  = Math.max(0, (half - HW_W) / 2);
  const pipY   = gH - BOT_H - 8 - PIP_H;
  // Center PiP inside outer zone; clamp to keep it fully within canvas
  const p1Raw  = (hwOff - PIP_W) / 2;
  const p2Raw  = half + hwOff + HW_W + (hwOff - PIP_W) / 2;
  return {
    p1X:  Math.max(0, Math.min(half - PIP_W, p1Raw)),
    p2X:  Math.max(half, Math.min(gW - PIP_W, p2Raw)),
    pipY,
    rp1X: gW * 0.74,
    rp2X: gW * 0.26,
    rpY:  gH * 0.46,
  };
}

async function bootstrap() {
  const statusEl = document.getElementById("mp-status")!;
  const videoEl  = document.getElementById("mp-video") as HTMLVideoElement;
  const camP1    = document.getElementById("cam-p1") as HTMLCanvasElement;
  const camP2    = document.getElementById("cam-p2") as HTMLCanvasElement;

  // Set fixed internal resolution for PiP canvases
  camP1.width  = PIP_W;
  camP1.height = PIP_H;
  camP2.width  = PIP_W;
  camP2.height = PIP_H;

  const ctx1 = camP1.getContext("2d")!;
  const ctx2 = camP2.getContext("2d")!;

  // ── Temp canvas for compressed outgoing frames (network battle) ───────────
  const FRAME_W = 160;
  const FRAME_H = 120;
  const frameCapCanvas = document.createElement("canvas");
  frameCapCanvas.width  = FRAME_W;
  frameCapCanvas.height = FRAME_H;
  const frameCapCtx = frameCapCanvas.getContext("2d")!;

  let netFrameInterval = -1;   // setInterval id for sending camera frames

  function startNetCameraStream() {
    if (netFrameInterval !== -1) return;
    netFrameInterval = window.setInterval(() => {
      if (videoEl.readyState < 2) return;
      // Mirror + scale down
      frameCapCtx.save();
      frameCapCtx.translate(FRAME_W, 0);
      frameCapCtx.scale(-1, 1);
      frameCapCtx.drawImage(videoEl, 0, 0, FRAME_W, FRAME_H);
      frameCapCtx.restore();
      frameCapCanvas.toBlob((blob) => {
        blob?.arrayBuffer().then((buf) => network.sendCameraFrame(buf));
      }, "image/jpeg", 0.45);
    }, 200); // 5 fps
  }

  function stopNetCameraStream() {
    clearInterval(netFrameInterval);
    netFrameInterval = -1;
  }

  // ── Receive opponent camera frames and draw to cam-p2 ────────────────────
  // Called from updateCameraDisplay when NetworkBattle is active
  function drawOpponentOverlay(ctx: CanvasRenderingContext2D, progress: number, combo: number, hp: number) {
    const W = PIP_W, H = PIP_H;
    const MAX_HP = 5;

    // HP hearts at top-left
    for (let i = 0; i < MAX_HP; i++) {
      ctx.fillStyle = i < hp ? "#ff2244" : "rgba(255,255,255,0.15)";
      ctx.beginPath();
      ctx.arc(9 + i * 14, 11, 5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Progress bar at bottom
    const barH = 7;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, H - barH, W, barH);
    const barColor = progress > 0.66 ? "#ff4400" : progress > 0.33 ? "#ffaa00" : "#00dd55";
    ctx.fillStyle = barColor;
    ctx.fillRect(0, H - barH, W * Math.min(1, progress), barH);

    // Combo badge (top-right)
    if (combo > 1) {
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(W - 36, 2, 34, 16);
      ctx.fillStyle = "#ffdd00";
      ctx.font = "bold 11px monospace";
      ctx.textAlign = "right";
      ctx.fillText(`×${combo}`, W - 4, 14);
      ctx.textAlign = "left";
    }
  }

  // Set up one-time opponent frame receiver (wired when NetworkBattle starts)
  network.onOpponentFrame = async (data: ArrayBuffer) => {
    const blob   = new Blob([data], { type: "image/jpeg" });
    const bitmap = await createImageBitmap(blob);
    // Center-crop landscape JPEG into portrait canvas (no stretching)
    const bw = bitmap.width, bh = bitmap.height;
    const srcW = bh * (PIP_W / PIP_H);
    const srcX = (bw - srcW) / 2;
    ctx2.clearRect(0, 0, PIP_W, PIP_H);
    ctx2.drawImage(bitmap, srcX, 0, srcW, bh, 0, 0, PIP_W, PIP_H);
    bitmap.close();
    camP2.dataset.hasRemote = "1";   // make it visible in updateCameraDisplay
    // Draw overlay on top
    const opp = game.registry.get("netOppProgress") as
      { progress: number; combo: number; hp: number } | undefined;
    if (opp) drawOpponentOverlay(ctx2, opp.progress / 10, opp.combo, opp.hp);
    drawPipLabel(ctx2, "RIVAL", "rgba(68,136,255,0.85)");
  };

  // ── Victory replay canvas (created dynamically, same container as PiP) ────
  const replayCam = document.createElement("canvas");
  replayCam.id     = "replay-cam";
  replayCam.width  = PIP_W;    // capture resolution
  replayCam.height = PIP_H;
  Object.assign(replayCam.style, {
    position: "absolute",
    display:  "none",
    zIndex:   "6",
    borderRadius: "8px",
    imageRendering: "auto",
  } as CSSStyleDeclaration);
  // Will be appended once game container exists (after Phaser init)
  const replayCtx = replayCam.getContext("2d")!;

  // Circular capture buffers — every 3rd RAF frame ≈ 20fps, 200 frames ≈ 10 seconds each
  const MAX_FRAMES = 200;
  const CAPTURE_EVERY = 3;   // sample every Nth RAF frame
  const REPLAY_SPEED  = 2.5; // fast-motion highlight reel
  const p1FrameBuf: ImageData[] = [];
  const p2FrameBuf: ImageData[] = [];
  // Snapshots frozen at the moment of the match-winning seal
  const p1JutsuSnap: ImageData[] = [];
  const p2JutsuSnap: ImageData[] = [];
  let captureCount = 0;
  let replayRafId  = -1;

  // Start Phaser FIRST — game is playable immediately (keyboard mode)
  const game = createGame(null);
  (window as any)._game = game;

  // ── Audio mixer — music + SFX sliders, persisted in localStorage ────────
  const audioBtn    = document.getElementById("audio-btn")!;
  const audioPanel  = document.getElementById("audio-panel")!;
  const musicSlider = document.getElementById("vol-music") as HTMLInputElement;
  const sfxSlider   = document.getElementById("vol-sfx")   as HTMLInputElement;
  const vmPct       = document.getElementById("vm-pct")!;
  const vsPct       = document.getElementById("vs-pct")!;
  const muteToggle  = document.getElementById("mute-toggle")!;

  // Restore saved values (default: music 70, sfx 80)
  const savedMusic = parseInt(localStorage.getItem("jutsu-hero-music-vol") ?? "70", 10);
  const savedSfx   = parseInt(localStorage.getItem("jutsu-hero-sfx-vol")   ?? "80", 10);
  let   muted      = localStorage.getItem("jutsu-hero-muted") === "1";

  musicSlider.value = String(savedMusic);
  sfxSlider.value   = String(savedSfx);
  vmPct.textContent = String(savedMusic);
  vsPct.textContent = String(savedSfx);

  // Global volume state — read by scenes when playing sounds
  const audioVol = { music: savedMusic / 100, sfx: savedSfx / 100 };
  (window as any)._audioVol = audioVol;

  const MUSIC_BASE = 0.45;

  function updateAudioIcon() {
    audioBtn.textContent = (muted || (audioVol.music === 0 && audioVol.sfx === 0)) ? "🔇" : "🔊";
  }

  function applyMusicVolume() {
    const s = game.sound.get("music_menu");
    if (s) (s as Phaser.Sound.WebAudioSound | Phaser.Sound.HTML5AudioSound)
      .setVolume(muted ? 0 : MUSIC_BASE * audioVol.music);
  }

  function applyVfxVolume() {
    const vol = muted ? 0 : audioVol.sfx;
    vfxRasengan.volume = vol;
    vfxChidori.volume  = vol;
  }

  function applyMuteState() {
    // Phaser global mute silences everything instantly
    if (game.sound) game.sound.mute = muted;
    applyVfxVolume();
    muteToggle.textContent = muted ? "🔊 Activar sonido" : "🔇 Silenciar todo";
    muteToggle.classList.toggle("active", muted);
    updateAudioIcon();
  }

  muteToggle.addEventListener("click", (e) => {
    e.stopPropagation();
    muted = !muted;
    localStorage.setItem("jutsu-hero-muted", muted ? "1" : "0");
    applyMuteState();
  });

  musicSlider.addEventListener("input", () => {
    audioVol.music = parseInt(musicSlider.value, 10) / 100;
    vmPct.textContent = musicSlider.value;
    localStorage.setItem("jutsu-hero-music-vol", musicSlider.value);
    if (!muted) applyMusicVolume();
    updateAudioIcon();
  });

  sfxSlider.addEventListener("input", () => {
    audioVol.sfx = parseInt(sfxSlider.value, 10) / 100;
    vsPct.textContent = sfxSlider.value;
    localStorage.setItem("jutsu-hero-sfx-vol", sfxSlider.value);
    applyVfxVolume();
    updateAudioIcon();
  });

  // Toggle panel on button click; close when clicking outside
  audioBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    audioPanel.classList.toggle("open");
  });
  document.addEventListener("click", () => audioPanel.classList.remove("open"));

  // Apply volume+mute and attach replay canvas once Phaser is ready
  game.events.once("ready", () => {
    game.canvas.parentElement?.appendChild(replayCam);
    applyMuteState();
    // Fix persistence: correct music volume every time music_menu starts
    game.sound.on("play", (sound: Phaser.Sound.BaseSound) => {
      if (sound.key === "music_menu") {
        (sound as Phaser.Sound.WebAudioSound | Phaser.Sound.HTML5AudioSound)
          .setVolume(muted ? 0 : MUSIC_BASE * audioVol.music);
      }
    });
  });

  // ── Jutsu VFX video overlays (rasengan / chidori) ────────────────────────
  const vfxRasengan = document.getElementById("vfx-rasengan") as HTMLVideoElement;
  const vfxChidori  = document.getElementById("vfx-chidori")  as HTMLVideoElement;

  // ── Fatality overlay elements ─────────────────────────────────────────────
  const fatalityOverlay = document.getElementById("fatality-overlay")!;
  const fatalityTextEl  = document.getElementById("fatality-text")!;
  const fatalitySubEl   = document.getElementById("fatality-sub")!;

  let lastJutsuId  = "";             // for replay overlay
  let vfxTrackRaf  = -1;            // palm-tracking RAF
  let activePipCanvas: HTMLCanvasElement | null = null;  // PiP being zoomed
  let activeVfxEl: HTMLVideoElement | null = null;

  // Fatality recording
  let fatalityRecorder:    MediaRecorder | null     = null;
  let fatalityRecRaf:      number                   = -1;
  let fatalityClipUrl:     string | null            = null;
  let fatalityClipWinner:  1 | 2                    = 1;
  let fatalityReplayVid:   HTMLVideoElement | null  = null;
  // Last tracked palm position in raw-video coords (for replay VFX positioning)
  let lastVfxRawX      = 0.5;
  let lastVfxRawY      = 0.65;
  let lastVfxCropStart = 0;
  let lastVfxCropWidth = 0;

  // Canvases currently in VFX-zoom — positionPip skips these and clears transform otherwise
  const frozenPips = new Set<HTMLCanvasElement>();
  let pipResetTimer    = -1;  // auto-reset for local PiP expand
  let oppPipResetTimer = -1;  // auto-reset for opponent PiP expand


  function stopVfxTracking() {
    cancelAnimationFrame(vfxTrackRaf);
    vfxTrackRaf = -1;
  }

  function clearPipTransform(canvas: HTMLCanvasElement) {
    canvas.style.transition      = "";
    canvas.style.transform       = "";
    canvas.style.transformOrigin = "";
    canvas.style.zIndex          = "5";
    frozenPips.delete(canvas);
  }

  function resetPip(canvas: HTMLCanvasElement) {
    canvas.style.transition      = "transform 0.28s ease-in";
    canvas.style.transform       = "scale(1)";
    canvas.style.zIndex          = "5";
    // Unfreeze immediately so positionPip resumes (it will clear the transform next frame)
    frozenPips.delete(canvas);
    setTimeout(() => clearPipTransform(canvas), 300);
  }

  function hideAllVfx() {
    clearTimeout(pipResetTimer);
    clearTimeout(oppPipResetTimer);
    stopVfxTracking();
    vfxRasengan.style.display = "none";
    vfxChidori.style.display  = "none";
    // Immediately clear transform on ALL pips — no transition, instant snap
    clearPipTransform(camP1);
    clearPipTransform(camP2);
    activePipCanvas = null;
    activeVfxEl     = null;
  }

  // Expand opponent's PiP (camP2) to fill the right half — called when we receive damage
  function expandOpponentPip() {
    if (camP2.dataset.hasRemote !== "1" || camP2.style.display === "none") return;
    const gW    = game.scale.width;
    const SCALE = (gW / 2) / PIP_W;
    clearTimeout(oppPipResetTimer);
    frozenPips.add(camP2);
    camP2.style.display         = "block";
    camP2.style.transition      = "transform 0.4s cubic-bezier(0.34,1.56,0.64,1)";
    camP2.style.transformOrigin = "bottom right";
    camP2.style.transform       = `scale(${SCALE.toFixed(2)})`;
    camP2.style.zIndex          = "12";
    oppPipResetTimer = window.setTimeout(() => resetPip(camP2), 2500);
  }

  // ── Palm position → screen position inside a zoomed PiP ─────────────────
  // rawX / rawY: normalized MediaPipe landmark coords (raw video space)
  // cropStart / cropWidth: the x-crop slice used by drawPip/drawPipFull
  // pipCanvas: the PiP canvas (with transform:scale already applied)

  // ── Expand PiP to fill the player's zone (intermediate round win, no VFX) ──
  function expandPipToZone(pipCanvas: HTMLCanvasElement, winner: 1 | 2) {
    clearTimeout(pipResetTimer);
    stopVfxTracking();
    if (activePipCanvas && activePipCanvas !== pipCanvas) resetPip(activePipCanvas);
    if (activeVfxEl) { activeVfxEl.style.display = "none"; activeVfxEl = null; }
    activePipCanvas = pipCanvas;

    if (pipCanvas.style.display === "none") return;

    const gW    = game.scale.width;
    // Scale so PiP width covers the player's half of the game canvas
    const SCALE = (gW / 2) / PIP_W;

    frozenPips.add(pipCanvas);
    pipCanvas.style.transition      = "transform 0.4s cubic-bezier(0.34,1.56,0.64,1)";
    // Grow from the bottom of the PiP, centered horizontally
    pipCanvas.style.transformOrigin = winner === 1 ? "bottom left" : "bottom right";
    pipCanvas.style.transform       = `scale(${SCALE.toFixed(2)})`;
    pipCanvas.style.zIndex          = "12";
    pipCanvas.style.opacity         = "1";

    // Auto-reset after 2.5s (in BR there's no roundStart to trigger the reset)
    pipResetTimer = window.setTimeout(() => {
      if (activePipCanvas === pipCanvas) {
        resetPip(pipCanvas);
        activePipCanvas = null;
      }
    }, 2500);
  }

  // ── Battle/network events ─────────────────────────────────────────────────
  // VFX video is only played inside showFatality (Finish Him mode).
  // On regular round wins, just expand the PiP to fill the player's zone.
  game.events.on("jutsuVfx", (jutsuId: string, winner: 1 | 2) => {
    lastJutsuId = jutsuId;
    expandPipToZone(winner === 1 ? camP1 : camP2, winner);
  });

  game.events.on("jutsuVfxNet", (jutsuId: string) => {
    lastJutsuId = jutsuId;
    expandPipToZone(camP1, 1);
  });

  // Opponent completed a jutsu and damaged us — expand their camera so we see who hit us
  game.events.on("oppCastReceived", () => {
    expandOpponentPip();
  });

  // Reset PiP to normal size when a new round begins
  game.events.on("roundStart", () => {
    if (activePipCanvas) {
      resetPip(activePipCanvas);
      activePipCanvas = null;
      activeVfxEl     = null;
    }
  });

  // ── Fatality mode — full-screen "Finish Him" with palm-tracked VFX ─────────
  function endFatality(vfxEl: HTMLVideoElement) {
    fatalityActive = false;
    stopVfxTracking();
    fatalityTextEl.classList.remove("show");
    fatalitySubEl.classList.remove("show");
    fatalityOverlay.style.display = "none";
    vfxEl.style.display = "none";
    vfxEl.muted  = true;
    vfxEl.loop   = false;
    // Restore video defaults — updateCameraDisplay will manage display from here
    videoEl.style.zIndex     = "";
    videoEl.style.opacity    = "0.35";
    videoEl.style.transition = "";

    // Stop recording → blob ready → show as looping victory clip
    cancelAnimationFrame(fatalityRecRaf);
    fatalityRecRaf = -1;
    if (fatalityRecorder && fatalityRecorder.state !== "inactive") {
      fatalityRecorder.stop();
      // onstop callback in showFatality creates the video element
    }
  }

  function showFatalityClip(blobUrl: string, winner: 1 | 2) {
    // Revoke any previous clip
    if (fatalityClipUrl && fatalityClipUrl !== blobUrl) URL.revokeObjectURL(fatalityClipUrl);
    fatalityClipUrl = blobUrl;

    if (!fatalityReplayVid) {
      fatalityReplayVid = document.createElement("video");
      fatalityReplayVid.id            = "fatality-replay-vid";
      fatalityReplayVid.autoplay      = true;
      fatalityReplayVid.loop          = true;
      fatalityReplayVid.muted         = true;
      fatalityReplayVid.playsInline   = true;
      fatalityReplayVid.style.cssText = `
        position:absolute; border-radius:6px; pointer-events:none;
        display:none; object-fit:cover; z-index:20;
        border:3px solid rgba(255,80,0,0.9);
        box-shadow:0 0 28px rgba(255,80,0,0.7);
      `;
      game.canvas.parentElement!.appendChild(fatalityReplayVid);
    }

    fatalityReplayVid.src = blobUrl;
    fatalityReplayVid.load();

    // Position using same logic as replayCam
    const pRect = game.canvas.getBoundingClientRect();
    const cRect = game.canvas.parentElement!.getBoundingClientRect();
    const scale = pRect.width / game.scale.width;
    const cLeft = pRect.left - cRect.left;
    const cTop  = pRect.top  - cRect.top;
    const pos   = pipPositions(game.scale.width, game.scale.height);
    const panelX = winner === 1 ? pos.rp1X : pos.rp2X;

    // 16:9 landscape clip, displayed wider than the portrait replay
    const dispW = PIP_W * REPLAY_SCALE * 1.5;
    const dispH = dispW * (270 / 480);

    fatalityReplayVid.style.left    = `${cLeft + (panelX - dispW / 2) * scale}px`;
    fatalityReplayVid.style.top     = `${cTop  + (pos.rpY - dispH / 2) * scale}px`;
    fatalityReplayVid.style.width   = `${dispW * scale}px`;
    fatalityReplayVid.style.height  = `${dispH * scale}px`;
    fatalityReplayVid.style.display  = "block";
    fatalityReplayVid.playbackRate   = REPLAY_SPEED;   // fast-motion replay (2.5×)
    fatalityReplayVid.play().catch(() => {});
  }

  function startFullScreenTracking(vfxEl: HTMLVideoElement, effectSize: number, isP2: boolean) {
    const container = game.canvas.parentElement!;
    function tick() {
      vfxTrackRaf = requestAnimationFrame(tick);
      const detector = game.registry.get("detector") as MediaPipeDetector | null;
      const frame = (isP2 ? detector?.lastP2 : detector?.lastP1)
                 ?? (isP2 ? detector?.lastP1 : detector?.lastP2);
      if (!frame?.landmarks) return;
      const lm = frame.landmarks;
      const PALM_IDX = [0, 5, 9, 13, 17];
      let sumX = 0, sumY = 0;
      for (const i of PALM_IDX) { sumX += lm[i].x; sumY += lm[i].y; }
      const rawX = sumX / PALM_IDX.length;
      const rawY = sumY / PALM_IDX.length;
      // Full-screen: CSS scaleX(-1) on video → rawX 0=right, 1=left in DOM space
      const cRect = container.getBoundingClientRect();
      const sx = (1 - rawX) * cRect.width;
      const sy = rawY * cRect.height;
      vfxEl.style.left = `${sx - effectSize / 2}px`;
      vfxEl.style.top  = `${sy - effectSize / 2}px`;
    }
    vfxTrackRaf = requestAnimationFrame(tick);
  }

  function showFatality(winner: 1 | 2, jutsuId: string) {
    const container  = game.canvas.parentElement!;
    const cRect      = container.getBoundingClientRect();
    const isP2       = winner === 2;
    const vfxEl      = jutsuId === "rasengan" ? vfxRasengan : vfxChidori;

    fatalityActive     = true;
    fatalityClipWinner = winner;

    // ── Start recording the fatality to a video blob ────────────────────────
    const REC_W = 480, REC_H = 270;
    const recCanvas = document.createElement("canvas");
    recCanvas.width = REC_W; recCanvas.height = REC_H;
    const recCtx = recCanvas.getContext("2d")!;
    const chunks: BlobPart[] = [];

    // Pick best supported mimeType
    const mimeType = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"]
      .find(t => MediaRecorder.isTypeSupported(t)) ?? "";

    let recorder: MediaRecorder | null = null;
    try {
      recorder = new MediaRecorder(recCanvas.captureStream(30), {
        mimeType: mimeType || undefined,
        videoBitsPerSecond: 2_500_000,
      });
    } catch { /* MediaRecorder not available — skip recording */ }

    if (recorder) {
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: mimeType || "video/webm" });
        showFatalityClip(URL.createObjectURL(blob), fatalityClipWinner);
      };
      recorder.start();
      fatalityRecorder = recorder;

      // Draw loop: mirror-cropped video + VFX overlay
      cancelAnimationFrame(fatalityRecRaf);
      const drawRec = () => {
        fatalityRecRaf = requestAnimationFrame(drawRec);
        const vw = videoEl.videoWidth || 640, vh = videoEl.videoHeight || 480;
        recCtx.clearRect(0, 0, REC_W, REC_H);
        recCtx.save();
        recCtx.translate(REC_W, 0); recCtx.scale(-1, 1);
        // Center-crop source to 16:9 (crop top/bottom of 4:3 camera)
        const cropH = vw * (REC_H / REC_W);
        const srcY  = (vh - cropH) / 2;
        recCtx.drawImage(videoEl, 0, srcY, vw, cropH, 0, 0, REC_W, REC_H);
        recCtx.restore();
        // Overlay VFX — center-crop the 16:9 source to square so circle stays round
        if (vfxEl.readyState >= 2) {
          const vRect  = vfxEl.getBoundingClientRect();
          const scaleX = REC_W / cRect.width;
          const scaleY = REC_H / cRect.height;
          const vcx    = (vRect.left + vRect.width  / 2 - cRect.left) * scaleX;
          const vcy    = (vRect.top  + vRect.height / 2 - cRect.top ) * scaleY;
          const rSz    = vRect.width * scaleX;
          // Source: square center-crop of the 16:9 VFX video
          const vSrcH  = vfxEl.videoHeight || 720;
          const vSrcX  = ((vfxEl.videoWidth || 1280) - vSrcH) / 2;
          recCtx.globalCompositeOperation = "screen";
          recCtx.drawImage(vfxEl, vSrcX, 0, vSrcH, vSrcH, vcx - rSz/2, vcy - rSz/2, rSz, rSz);
          recCtx.globalCompositeOperation = "source-over";
        }
      };
      fatalityRecRaf = requestAnimationFrame(drawRec);
    }
    // ────────────────────────────────────────────────────────────────────────

    // Show full camera (both players) above the Phaser canvas
    videoEl.style.display    = "block";
    videoEl.style.zIndex     = "45";
    videoEl.style.opacity    = "1";
    videoEl.style.transition = "opacity 0.25s";

    // Show overlay (dim tint + text)
    fatalityOverlay.style.display = "block";
    requestAnimationFrame(() => {
      fatalityTextEl.classList.add("show");
      fatalitySubEl.classList.add("show");
    });

    // "Finish Him" — use the real MK audio; Speech API as fallback
    const sfxVol = ((window as any)._audioVol?.sfx ?? 1) as number;
    if (game.cache.audio.has("voice_finish_him")) {
      game.sound.play("voice_finish_him", { volume: 1.0 * sfxVol });
    } else if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance("Finish him");
      u.pitch = 0.05; u.rate = 0.55; u.volume = 1.0;
      window.speechSynthesis.speak(u);
    }

    // After 2.2s: collapse text, play VFX + jutsu sound tracking the winner's palm
    setTimeout(() => {
      fatalityTextEl.classList.remove("show");
      fatalitySubEl.classList.remove("show");
      stopVfxTracking();

      const effectSize = Math.min(cRect.width, cRect.height) * (jutsuId === "chidori" ? 0.85 : 0.52);
      // Initial position: center of winner's half
      const initX = cRect.width  * (isP2 ? 0.75 : 0.25);
      const initY = cRect.height * 0.5;

      // Unmute so the jutsu MP4 audio plays during fatality (respect SFX volume)
      vfxEl.muted   = muted;
      vfxEl.volume  = audioVol.sfx;
      Object.assign(vfxEl.style, {
        display:  "block",
        width:    `${effectSize}px`,
        height:   `${effectSize}px`,
        left:     `${initX - effectSize / 2}px`,
        top:      `${initY - effectSize / 2}px`,
        zIndex:   "55",
        transition: "",
      } as CSSStyleDeclaration);
      vfxEl.loop        = false;
      vfxEl.currentTime = 0;
      vfxEl.play().catch(() => {});

      startFullScreenTracking(vfxEl, effectSize, isP2);

      vfxEl.onended = () => endFatality(vfxEl);
    }, 2200);
  }

  // Destroy everything when a new battle starts (revancha / scene restart)
  game.events.on("battleStart", () => {
    fatalityActive = false;
    stopNetCameraStream();
    camP2.dataset.hasRemote      = "";
    camP2.dataset.styledAsRemote = "";
    hideAllVfx();
    // Stop any in-progress recording — discard the clip, do not show it
    cancelAnimationFrame(fatalityRecRaf); fatalityRecRaf = -1;
    if (fatalityRecorder && fatalityRecorder.state !== "inactive") {
      fatalityRecorder.onstop = null;   // prevent onstop from showing clip after revancha
      fatalityRecorder.stop();
    }
    fatalityRecorder = null;
    // Hide and teardown the fatality clip video
    if (fatalityReplayVid) {
      fatalityReplayVid.pause();
      fatalityReplayVid.src = "";
      fatalityReplayVid.style.display = "none";
    }
    if (fatalityClipUrl) { URL.revokeObjectURL(fatalityClipUrl); fatalityClipUrl = null; }
    endFatality(vfxRasengan);
    endFatality(vfxChidori);
    cancelAnimationFrame(replayRafId);
    replayRafId = -1;
    replayCam.style.display = "none";
  });

  // ── Snapshot the live buffer when a jutsu is completed ───────────────────
  game.events.on("jutsuComplete", (player: 1 | 2) => {
    const src = player === 1 ? p1FrameBuf : p2FrameBuf;
    const dst = player === 1 ? p1JutsuSnap : p2JutsuSnap;
    dst.length = 0;
    dst.push(...src);   // freeze a copy at this exact moment
  });

  // ── Victory replay handler ────────────────────────────────────────────────
  game.events.on("matchWinReplay", (winner: 1 | 2) => {
    hideAllVfx();

    // Power jutsus → Fatality mode (full-screen camera + "Finish Him!")
    if (lastJutsuId === "rasengan" || lastJutsuId === "chidori") {
      showFatality(winner, lastJutsuId);
      return;
    }

    // ── Standard small-replay for other jutsus ────────────────────────────

    // Use the frozen jutsu snapshot; fall back to live buffer if snapshot empty
    const snap = winner === 1 ? p1JutsuSnap : p2JutsuSnap;
    const buf  = (snap.length > 0 ? snap : (winner === 1 ? p1FrameBuf : p2FrameBuf)).slice();
    if (buf.length === 0) return;  // no camera — hand skeleton fallback shows instead

    const color = winner === 1 ? "rgba(255,136,0,0.9)" : "rgba(68,136,255,0.9)";
    Object.assign(replayCam.style, {
      border: `3px solid ${color}`,
      boxShadow: `0 0 24px ${color}`,
    } as CSSStyleDeclaration);

    // Position relative to game canvas
    const pRect = game.canvas.getBoundingClientRect();
    const cRect = game.canvas.parentElement!.getBoundingClientRect();
    const scale = pRect.width / game.scale.width;
    const cLeft = pRect.left - cRect.left;
    const cTop  = pRect.top  - cRect.top;

    const dispW = PIP_W * REPLAY_SCALE;
    const dispH = PIP_H * REPLAY_SCALE;
    const pos   = pipPositions(game.scale.width, game.scale.height);
    const panelX = winner === 1 ? pos.rp1X : pos.rp2X;
    replayCam.style.left    = `${cLeft + (panelX - dispW / 2) * scale}px`;
    replayCam.style.top     = `${cTop  + (pos.rpY - dispH / 2) * scale}px`;
    replayCam.style.width   = `${dispW * scale}px`;
    replayCam.style.height  = `${dispH * scale}px`;
    replayCam.style.display = "block";

    // VFX baked into canvas — start playing hidden, draw via ctx.drawImage each frame
    const replayVfxEl = lastJutsuId === "rasengan" ? vfxRasengan
                      : lastJutsuId === "chidori"  ? vfxChidori : null;
    if (replayVfxEl) {
      replayVfxEl.loop        = true;
      replayVfxEl.currentTime = 0;
      replayVfxEl.onended     = null;
      replayVfxEl.play().catch(() => {});
      // Keep display:none — composited directly onto replayCtx below
    }

    // Palm position in canvas-pixel coords using saved tracking data
    const palmCvX = lastVfxCropWidth > 0
      ? (1 - Math.max(0, Math.min(1, (lastVfxRawX - lastVfxCropStart) / lastVfxCropWidth))) * PIP_W
      : PIP_W * 0.5;
    const palmCvY   = lastVfxRawY * PIP_H;
    const vfxCvSize = PIP_W * 1.8;  // slightly wider than the canvas

    cancelAnimationFrame(replayRafId);

    const captureRate = 60 / CAPTURE_EVERY;
    const FRAME_MS    = 1000 / captureRate / REPLAY_SPEED;

    let frameIdx    = 0;
    let lastAdvance = performance.now();

    function animateReplay() {
      replayRafId = requestAnimationFrame(animateReplay);
      const now = performance.now();
      if (now - lastAdvance >= FRAME_MS) {
        frameIdx    = (frameIdx + 1) % buf.length;
        lastAdvance = now;
      }
      replayCtx.putImageData(buf[frameIdx], 0, 0);
      // Composite VFX on top — center-crop 16:9 source to square so circle stays round
      if (replayVfxEl && replayVfxEl.readyState >= 2) {
        const rSrcH = replayVfxEl.videoHeight || 720;
        const rSrcX = ((replayVfxEl.videoWidth || 1280) - rSrcH) / 2;
        replayCtx.save();
        replayCtx.globalCompositeOperation = "screen";
        replayCtx.drawImage(
          replayVfxEl,
          rSrcX, 0, rSrcH, rSrcH,
          palmCvX - vfxCvSize / 2,
          palmCvY - vfxCvSize / 2,
          vfxCvSize, vfxCvSize,
        );
        replayCtx.restore();
      }
    }
    animateReplay();
  });

  // ── Camera display RAF ────────────────────────────────────────────────────
  let lastBattle    = false;
  let fatalityActive = false;  // true while fatality full-screen is showing

  // dispW/dispH: override display size in CSS px (defaults to PIP_W/H * scale)
  function positionPip(canvas: HTMLCanvasElement, gameX: number, gameY: number,
                        scale: number, containerLeft: number, containerTop: number,
                        dispW?: number, dispH?: number) {
    if (frozenPips.has(canvas)) return;
    if (canvas.style.transform) {
      canvas.style.transition      = "";
      canvas.style.transform       = "";
      canvas.style.transformOrigin = "";
      canvas.style.zIndex          = "5";
    }
    canvas.style.left   = `${containerLeft + gameX * scale}px`;
    canvas.style.top    = `${containerTop  + gameY * scale}px`;
    canvas.style.width  = `${dispW ?? PIP_W * scale}px`;
    canvas.style.height = `${dispH ?? PIP_H * scale}px`;
  }

  // Label drawn at bottom of PiP canvas (persists until canvas is cleared)
  function drawPipLabel(ctx: CanvasRenderingContext2D, label: string, color: string) {
    const W = PIP_W, H = PIP_H;
    ctx.save();
    ctx.fillStyle = color;
    ctx.fillRect(0, H - 18, W, 18);
    ctx.fillStyle = "#fff";
    ctx.font      = "bold 10px monospace";
    ctx.textAlign = "center";
    ctx.fillText(label, W / 2, H - 5);
    ctx.textAlign = "left";
    ctx.restore();
  }

  function drawPip(ctx: CanvasRenderingContext2D, rightHalf: boolean) {
    const vw = videoEl.videoWidth  || 640;
    const vh = videoEl.videoHeight || 480;
    ctx.clearRect(0, 0, PIP_W, PIP_H);
    ctx.save();
    ctx.translate(PIP_W, 0);
    ctx.scale(-1, 1);

    // Center-crop each player's half to portrait aspect ratio (no distortion)
    const halfW = vw / 2;
    const cropW = Math.min(vh * (PIP_W / PIP_H), halfW);
    const cropX = (halfW - cropW) / 2;
    const srcX  = rightHalf ? halfW + cropX : cropX;
    ctx.drawImage(videoEl, srcX, 0, cropW, vh, 0, 0, PIP_W, PIP_H);

    ctx.restore();
  }

  function drawPipFull(ctx: CanvasRenderingContext2D) {
    // NetworkBattle: center-crop to portrait aspect ratio to avoid stretching
    const vw = videoEl.videoWidth  || 640;
    const vh = videoEl.videoHeight || 480;
    ctx.clearRect(0, 0, PIP_W, PIP_H);
    ctx.save();
    ctx.translate(PIP_W, 0);
    ctx.scale(-1, 1);
    // Crop source to match PIP_W:PIP_H ratio (portrait), centered
    const cropW = vh * (PIP_W / PIP_H);
    const cropX = (vw - cropW) / 2;
    ctx.drawImage(videoEl, cropX, 0, cropW, vh, 0, 0, PIP_W, PIP_H);
    ctx.restore();
  }

  function updateCameraDisplay() {
    requestAnimationFrame(updateCameraDisplay);

    const activeScenes = game.scene.getScenes(true).map(s => s.scene.key);
    const isBattle    = activeScenes.includes("Battle");
    const isNetBattle = activeScenes.includes("NetworkBattle");

    if (!isBattle && !isNetBattle) {
      videoEl.style.display = "block";
      if (lastBattle) {
        camP1.style.display = "none";
        camP2.style.display = "none";
        camP2.dataset.hasRemote      = "";
        camP2.dataset.styledAsRemote = "";
        stopNetCameraStream();
        cancelAnimationFrame(replayRafId);
        replayCam.style.display = "none";
        hideAllVfx();
      }
      lastBattle = false;
      return;
    }

    // During fatality: video is shown full-screen — don't touch it or PiPs
    if (fatalityActive) {
      camP1.style.display = "none";
      camP2.style.display = "none";
      return;
    }

    // Battle / NetworkBattle mode — hide full-screen video, show PiP overlays
    videoEl.style.display = "none";

    const pRect = game.canvas.getBoundingClientRect();
    const cRect = game.canvas.parentElement!.getBoundingClientRect();
    const scale = pRect.width / game.scale.width;
    const cLeft = pRect.left - cRect.left;
    const cTop  = pRect.top  - cRect.top;
    const pos   = pipPositions(game.scale.width, game.scale.height);

    if (isBattle) {
      // Local 2P — two PiPs
      camP1.style.display = "block";
      camP2.style.display = "block";
      positionPip(camP1, pos.p1X, pos.pipY, scale, cLeft, cTop);
      positionPip(camP2, pos.p2X, pos.pipY, scale, cLeft, cTop);

      if (videoEl.readyState >= 2) {
        drawPip(ctx1, true);
        drawPip(ctx2, false);

        if (captureCount++ % CAPTURE_EVERY === 0) {
          const f1 = ctx1.getImageData(0, 0, PIP_W, PIP_H);
          p1FrameBuf.push(f1); if (p1FrameBuf.length > MAX_FRAMES) p1FrameBuf.shift();
          const f2 = ctx2.getImageData(0, 0, PIP_W, PIP_H);
          p2FrameBuf.push(f2); if (p2FrameBuf.length > MAX_FRAMES) p2FrameBuf.shift();
        }
      }
    } else {
      // NetworkBattle — local PiP bottom-left, opponent PiP bottom-right
      const gW = game.scale.width;
      const gH = game.scale.height;
      // Responsive PiP: available side gap on each side of the highway
      const NET_HW_W   = 280;
      const sideGap    = (gW - NET_HW_W) / 2;    // px in game-space
      const margin     = 8;
      const pipDispW   = Math.max(60, Math.min(PIP_W, sideGap - margin)) * scale;
      const pipDispH   = pipDispW * (PIP_H / PIP_W);
      const netPipY    = gH - BOT_H - 8 - PIP_H;
      const netLocalX  = margin;
      const netRemoteX = gW - Math.max(60, Math.min(PIP_W, sideGap - margin)) - margin;

      camP1.style.display = "block";
      positionPip(camP1, netLocalX, netPipY, scale, cLeft, cTop, pipDispW, pipDispH);

      if (videoEl.readyState >= 2) {
        drawPipFull(ctx1);
        drawPipLabel(ctx1, "TÚ", "rgba(0,180,80,0.85)");
        if (captureCount++ % CAPTURE_EVERY === 0) {
          const f1 = ctx1.getImageData(0, 0, PIP_W, PIP_H);
          p1FrameBuf.push(f1); if (p1FrameBuf.length > MAX_FRAMES) p1FrameBuf.shift();
        }
      }

      // Opponent PiP — only show when we have received at least one frame
      const hasRemote = camP2.dataset.hasRemote === "1";
      if (hasRemote) {
        camP2.style.display = "block";
        positionPip(camP2, netRemoteX, netPipY, scale, cLeft, cTop, pipDispW, pipDispH);
        // ctx2 is updated by onOpponentFrame; just ensure border color is set
        if (!camP2.dataset.styledAsRemote) {
          camP2.style.border      = "2px solid rgba(68,136,255,0.85)";
          camP2.style.boxShadow   = "0 0 10px rgba(50,100,255,0.6)";
          camP2.dataset.styledAsRemote = "1";
        }
      } else {
        camP2.style.display = "none";
      }

      // Start sending local camera frames to opponent
      startNetCameraStream();
    }

    lastBattle = true;
  }
  requestAnimationFrame(updateCameraDisplay);

  // ── Camera + MediaPipe init ───────────────────────────────────────────────
  let activeStream:   MediaStream | null = null;
  let activeDeviceId: string | null      = null;
  let detector:       MediaPipeDetector | null = null;

  async function startCamera(deviceId?: string) {
    activeStream?.getTracks().forEach((t) => t.stop());
    const constraints: MediaStreamConstraints = {
      video: deviceId
        ? { deviceId: { exact: deviceId }, width: 640, height: 480 }
        : { width: 640, height: 480, facingMode: "user" },
    };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    videoEl.srcObject = stream;
    await videoEl.play();
    activeStream   = stream;
    activeDeviceId = deviceId ?? null;
    // Persist last-used camera
    if (deviceId) localStorage.setItem("cam-device-id", deviceId);
  }

  statusEl.textContent = "Requesting camera…";
  try {
    const saved = localStorage.getItem("cam-device-id") ?? undefined;
    await startCamera(saved);

    statusEl.textContent = "Loading MediaPipe…";
    detector = new MediaPipeDetector(videoEl);
    await detector.init();
    detector.start();
    statusEl.textContent = "";

    game.registry.set("detector", detector);
    game.registry.set("detectorReady", true);
    game.events.emit("detectorReady", detector);
  } catch (err) {
    console.warn("[bootstrap] Camera/MediaPipe unavailable:", err);
    statusEl.textContent = "Camera unavailable — use keys 1–8";
    game.registry.set("detectorReady", false);
    game.events.emit("detectorReady", null);
  }

  // ── Camera selector ───────────────────────────────────────────────────────
  const camBtn   = document.getElementById("cam-btn")!;
  const camPanel = document.getElementById("cam-panel")!;
  const camList  = document.getElementById("cam-list")!;

  async function populateCameras() {
    // Permissions must be granted first — getUserMedia above ensures that
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cams    = devices.filter((d) => d.kind === "videoinput");
    camList.innerHTML = "";
    for (const cam of cams) {
      const label = cam.label || `Cámara ${camList.children.length + 1}`;
      const btn   = document.createElement("button");
      btn.className   = "cam-item";
      btn.textContent = label;
      if (cam.deviceId === activeDeviceId ||
          (!activeDeviceId && camList.children.length === 0)) {
        btn.classList.add("active");
      }
      btn.addEventListener("click", async () => {
        try {
          await startCamera(cam.deviceId);
          // MediaPipe keeps using videoEl — no reinit needed
          camList.querySelectorAll(".cam-item").forEach((b) => b.classList.remove("active"));
          btn.classList.add("active");
          camPanel.classList.remove("open");
        } catch (e) {
          console.warn("[cam] switch failed:", e);
        }
      });
      camList.appendChild(btn);
    }
  }

  camBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    castPanel.classList.remove("open");
    if (!camPanel.classList.contains("open")) populateCameras();
    camPanel.classList.toggle("open");
  });

  // ── DLNA / Cast panel ─────────────────────────────────────────────────────
  const castBtn       = document.getElementById("cast-btn")!;
  const castPanel     = document.getElementById("cast-panel")!;
  const castDlnaList  = document.getElementById("cast-dlna-list")!;
  const castScanBtn   = document.getElementById("cast-scan-btn")!;
  const castStatusMsg = document.getElementById("cast-status-msg")!;
  const castServerUrl = document.getElementById("cast-server-url")!;

  const SERVER_URL = (import.meta as any).env?.VITE_SERVER_URL as string | undefined
                  ?? "http://localhost:3001";

  let streamInterval  = -1;
  let activeCastHost  = "";

  function startCanvasStream() {
    if (streamInterval !== -1) return;
    streamInterval = window.setInterval(() => {
      game.canvas.toBlob((blob) => {
        if (!blob) return;
        fetch(`${SERVER_URL}/stream/frame`, { method: "POST", body: blob,
          headers: { "Content-Type": "image/jpeg" } }).catch(() => {});
      }, "image/jpeg", 0.65);
    }, 50); // ~20 fps
  }

  function stopCanvasStream() {
    clearInterval(streamInterval);
    streamInterval = -1;
  }

  async function loadServerInfo() {
    try {
      const info = await fetch(`${SERVER_URL}/info`).then((r) => r.json()) as
        { port: number; ips: string[]; dlnaDevices: number };
      if (info.ips?.length) {
        const url = `http://${info.ips[0]}:${info.port}/cast`;
        castServerUrl.textContent = `📡 ${url}`;
        castServerUrl.style.display = "block";
        castStatusMsg.textContent = `${info.dlnaDevices} dispositivo(s) DLNA encontrado(s)`;
      }
    } catch {
      castStatusMsg.textContent = "Servidor no disponible";
    }
  }

  async function loadDlnaDevices() {
    try {
      castStatusMsg.textContent = "Buscando…";
      const devices = await fetch(`${SERVER_URL}/dlna/devices`).then((r) => r.json()) as
        { name: string; host: string; hasAV: boolean }[];
      castDlnaList.innerHTML = "";
      if (devices.length === 0) {
        castStatusMsg.textContent = "No se encontraron dispositivos DLNA";
        return;
      }
      castStatusMsg.textContent = `${devices.length} dispositivo(s)`;
      for (const dev of devices) {
        const btn = document.createElement("button");
        btn.className   = "cast-device-btn";
        btn.textContent = `📺 ${dev.name}`;
        if (!dev.hasAV) btn.textContent += " (sin AVTransport)";
        if (dev.host === activeCastHost) btn.classList.add("active");
        btn.addEventListener("click", async () => {
          if (!dev.hasAV) { castStatusMsg.textContent = "Dispositivo no soporta AVTransport"; return; }
          try {
            startCanvasStream();
            const infoRes = await fetch(`${SERVER_URL}/info`).then((r) => r.json()) as { ips: string[]; port: number };
            const streamUrl = `http://${infoRes.ips[0]}:${infoRes.port}/stream/mjpeg`;
            castStatusMsg.textContent = "Conectando…";
            await fetch(`${SERVER_URL}/dlna/cast`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ host: dev.host, streamUrl }),
            });
            activeCastHost = dev.host;
            castDlnaList.querySelectorAll(".cast-device-btn").forEach((b) => b.classList.remove("active"));
            btn.classList.add("active");
            castStatusMsg.textContent = `✅ Transmitiendo a ${dev.name}`;
          } catch (e) {
            castStatusMsg.textContent = `Error: ${(e as Error).message}`;
            stopCanvasStream();
          }
        });
        castDlnaList.appendChild(btn);
      }
    } catch {
      castStatusMsg.textContent = "Error al contactar el servidor";
    }
  }

  castScanBtn.addEventListener("click", async () => {
    castScanBtn.textContent = "⏳ Escaneando…";
    try {
      await fetch(`${SERVER_URL}/dlna/scan`, { method: "POST" });
      await loadDlnaDevices();
    } catch {
      castStatusMsg.textContent = "Error de conexión con el servidor";
    }
    castScanBtn.textContent = "🔍 Buscar dispositivos";
  });

  castBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    camPanel.classList.remove("open");
    if (!castPanel.classList.contains("open")) {
      loadServerInfo();
      loadDlnaDevices();
    }
    castPanel.classList.toggle("open");
  });

  // Close panels on outside click
  document.addEventListener("click", () => {
    castPanel.classList.remove("open");
    camPanel.classList.remove("open");
  });
}

bootstrap();
