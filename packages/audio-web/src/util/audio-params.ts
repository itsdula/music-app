/**
 * AudioParam helpers: click-free parameter changes and safe node teardown.
 */
import { PARAM_TIME_CONSTANT } from '../constants';

/**
 * Freezes automation of `param` at `time` and anchors it at `value` (the caller's
 * knowledge of the value at `time`; defaults to the current value, which is only exact
 * for `time` ≈ currentTime).
 *
 * The explicit setValueAtTime after cancelAndHoldAtTime is required: in Chromium a
 * linear ramp scheduled right after cancelAndHoldAtTime while a setTargetAtTime is active
 * jumps immediately to the ramp's end value (an audible click). Where
 * cancelAndHoldAtTime is unsupported, `rampPending` (a ramp ends after `time`) makes the
 * fallback ramp to `value` instead of stepping, so the cancelled ramp's early part survives.
 */
export function holdParam(
  param: AudioParam,
  time: number,
  value: number = param.value,
  rampPending = false,
): void {
  if (typeof param.cancelAndHoldAtTime === 'function') {
    param.cancelAndHoldAtTime(time);
    param.setValueAtTime(value, time);
  } else {
    param.cancelScheduledValues(time);
    if (rampPending) param.linearRampToValueAtTime(value, time);
    else param.setValueAtTime(value, time);
  }
}

/**
 * Sets a parameter. `immediate` writes the value directly (graph construction, before
 * any audio flows); otherwise the change glides with setTargetAtTime (no zipper noise).
 */
export function setParam(
  param: AudioParam,
  value: number,
  ctx: BaseAudioContext,
  immediate: boolean,
  timeConstant = PARAM_TIME_CONSTANT,
): void {
  if (!Number.isFinite(value)) return;
  if (immediate) {
    param.cancelScheduledValues(0);
    param.value = value;
    return;
  }
  const now = ctx.currentTime;
  holdParam(param, now);
  param.setTargetAtTime(value, now, timeConstant);
}

/** Linear ramp from the current value to `value` over `seconds`, starting now. */
export function rampParam(
  param: AudioParam,
  value: number,
  ctx: BaseAudioContext,
  seconds: number,
): void {
  const now = ctx.currentTime;
  holdParam(param, now);
  param.linearRampToValueAtTime(value, now + Math.max(seconds, 1e-4));
}

/** Disconnects without throwing when the connection does not exist. */
export function safeDisconnect(node: AudioNode, destination?: AudioNode | AudioParam): void {
  try {
    if (destination === undefined) node.disconnect();
    else if (destination instanceof AudioParam) node.disconnect(destination);
    else node.disconnect(destination);
  } catch {
    // Already disconnected.
  }
}

/** Stops a scheduled source without throwing when it was never started/already stopped. */
export function safeStop(node: AudioScheduledSourceNode, when: number): void {
  try {
    node.stop(Math.max(0, when));
  } catch {
    // Not started yet or already stopped.
  }
}

/** FNV-1a 32-bit hash: deterministic seeds from string ids. */
export function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
