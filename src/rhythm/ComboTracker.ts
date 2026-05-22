import type { TimingResult } from "../data/types";

const MULTIPLIERS: Record<string, number> = {
  "0-9":   1,
  "10-19": 2,
  "20-29": 3,
  "30+":   4,
};

export class ComboTracker {
  combo = 0;
  maxCombo = 0;
  score = 0;
  health = 100;

  private readonly HIT_SCORE: Record<TimingResult, number> = {
    perfect: 300,
    good:    200,
    ok:      100,
    miss:    0,
  };
  private readonly HEALTH_DELTA: Record<TimingResult, number> = {
    perfect: 5,
    good:    3,
    ok:      1,
    miss:    -15,
  };

  hit(result: TimingResult): void {
    if (result === "miss") {
      this.combo = 0;
      this.health = Math.max(0, this.health + this.HEALTH_DELTA.miss);
      return;
    }
    this.combo++;
    if (this.combo > this.maxCombo) this.maxCombo = this.combo;
    this.score += this.HIT_SCORE[result] * this.multiplier;
    this.health = Math.min(100, this.health + this.HEALTH_DELTA[result]);
  }

  get multiplier(): number {
    if (this.combo >= 30) return MULTIPLIERS["30+"];
    if (this.combo >= 20) return MULTIPLIERS["20-29"];
    if (this.combo >= 10) return MULTIPLIERS["10-19"];
    return MULTIPLIERS["0-9"];
  }

  get isDead(): boolean {
    return this.health <= 0;
  }

  reset(): void {
    this.combo = 0;
    this.maxCombo = 0;
    this.score = 0;
    this.health = 100;
  }
}
