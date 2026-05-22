// KOF-style arcade announcer — beeps/SFX via Web Audio API.
// Voice clips are played directly by BattleScene using Phaser (real WAV files).
export class ArcadeAnnouncer {
  private audioCtx: AudioContext | null = null;

  private getCtx(): AudioContext {
    if (!this.audioCtx) this.audioCtx = new AudioContext();
    return this.audioCtx;
  }

  beep(freq: number, dur: number, vol = 0.30, type: OscillatorType = "square") {
    try {
      const ctx  = this.getCtx();
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(vol, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + dur);
    } catch { /* AudioContext blocked until first user interaction */ }
  }

  // Short "ding" before round voice clip
  roundBeep() {
    this.beep(330, 0.06, 0.22, "square");
  }

  // Countdown tick: different tone per count
  countdownTick(count: number) {
    if (count > 0) {
      this.beep(523, 0.10, 0.35, "square");  // C5
    } else {
      this.beep(784, 0.08, 0.45, "square");  // G5
      setTimeout(() => this.beep(1047, 0.20, 0.5, "square"), 80);  // C6
    }
  }

  // Punchy chord that fires just before the "FIGHT!" voice clip
  fightChord() {
    this.beep(220, 0.04, 0.5, "sawtooth");
    setTimeout(() => this.beep(440, 0.04, 0.5, "sawtooth"), 30);
    setTimeout(() => this.beep(660, 0.18, 0.6, "sawtooth"), 55);
  }
}
