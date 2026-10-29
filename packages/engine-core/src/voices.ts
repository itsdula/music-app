/**
 * Voice allocation and sustain-pedal bookkeeping (backend-neutral; the Web Audio and
 * future native backends share these decisions).
 */

export interface VoiceSpan {
  readonly id: number;
  /** Engine time the voice starts sounding (s). */
  readonly startTime: number;
  /** Engine time the voice is fully silent (s); +∞ while a held note has no release. */
  readonly endTime: number;
}

/**
 * Chooses which voices to steal so that a new voice starting at `time` keeps the number
 * of simultaneously sounding voices ≤ `maxVoices`. Only voices sounding at `time`
 * (startTime ≤ time < endTime) count; the oldest (smallest startTime, then smallest
 * id) are stolen first.
 *
 * - Units: seconds. `maxVoices` is clamped to ≥ 1.
 * - Determinism: total order on (startTime, id). Ownership: reads `voices` only.
 * - Complexity: O(n log n) for n candidate voices (n ≤ polyphony + a few in practice).
 */
export function selectVoicesToSteal(
  voices: readonly VoiceSpan[],
  time: number,
  maxVoices: number,
): number[] {
  const limit = Math.max(1, Math.floor(maxVoices));
  const active = voices.filter((v) => v.startTime <= time && time < v.endTime);
  const excess = active.length - (limit - 1);
  if (excess <= 0) return [];
  active.sort((a, b) => a.startTime - b.startTime || a.id - b.id);
  return active.slice(0, excess).map((v) => v.id);
}

/**
 * Sustain pedal (CC64) state for one instrument: keys released while the pedal is down
 * keep sounding until the pedal is lifted; re-pressing a sustained key removes it from
 * the pending-release set.
 *
 * - Ownership: owns its sets. Complexity: O(1) per event, O(k log k) on pedal release.
 */
export class SustainPedal {
  private down = false;
  private readonly held = new Set<number>();
  private readonly sustained = new Set<number>();

  get isDown(): boolean {
    return this.down;
  }

  /** Records a key press. */
  noteOn(pitch: number): void {
    this.held.add(pitch);
    this.sustained.delete(pitch);
  }

  /** Records a key release; returns true when the note must be released now. */
  noteOff(pitch: number): boolean {
    this.held.delete(pitch);
    if (this.down) {
      this.sustained.add(pitch);
      return false;
    }
    return true;
  }

  /** Sets the pedal; lifting it returns the sustained pitches to release now (ascending). */
  setDown(down: boolean): number[] {
    const wasDown = this.down;
    this.down = down;
    if (down || !wasDown) return [];
    const release = [...this.sustained].filter((p) => !this.held.has(p)).sort((a, b) => a - b);
    this.sustained.clear();
    return release;
  }

  /** Clears all state; returns every pitch that was held or sustained (ascending). */
  reset(): number[] {
    const all = [...new Set([...this.held, ...this.sustained])].sort((a, b) => a - b);
    this.held.clear();
    this.sustained.clear();
    this.down = false;
    return all;
  }
}
