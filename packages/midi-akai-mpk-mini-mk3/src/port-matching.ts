/**
 * Port-name matching for the MPK Mini MK3.
 *
 * Evidence (docs/midi-device-research.md §8.3): three independent community projects
 * match the prefix "MPK mini 3" on Linux/ALSA and one on macOS/CoreMIDI (COMMUNITY). The
 * kernel's naming makes "MPK mini 3 MIDI 1" likely on Linux. Windows names and the exact
 * full strings are UNVERIFIED. Sibling models must not match: "MPK mini Play" (Play mk3),
 * "MPK mini Plus", "MPK Mini Mk II" / "MPKmini2" and "MPK mini IV".
 */
import type { MidiPortDescriptor } from '@studio/midi-core';

/** Score for the community-observed "MPK mini 3" name. */
export const MPK_MINI_MK3_EXACT_MATCH_SCORE = 100;
/** Score for marketing-name variants ("MPK mini mk3", "MPK mini MKIII") never seen as port names. */
export const MPK_MINI_MK3_ALIAS_MATCH_SCORE = 60;

const normalize = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[\s_\-.]+/g, ' ')
    .trim();

const SIBLING = /\b(play|plus)\b/;
const EXACT = /(^|[^a-z0-9])mpk ?mini ?3(?![a-z0-9])/;
const ALIAS = /(^|[^a-z0-9])mpk ?mini ?(mk ?3|mk ?iii|iii)(?![a-z0-9])/;

/** 0 = not an MPK Mini MK3 port; higher = better match. */
export function matchMpkMiniMk3PortName(name: string): number {
  const normalized = normalize(name);
  if (SIBLING.test(normalized)) return 0;
  if (EXACT.test(normalized)) return MPK_MINI_MK3_EXACT_MATCH_SCORE;
  if (ALIAS.test(normalized)) return MPK_MINI_MK3_ALIAS_MATCH_SCORE;
  return 0;
}

export function matchMpkMiniMk3Port(port: Pick<MidiPortDescriptor, 'name'>): number {
  return matchMpkMiniMk3PortName(port.name);
}

export function isMpkMiniMk3Port(port: Pick<MidiPortDescriptor, 'name'>): boolean {
  return matchMpkMiniMk3Port(port) > 0;
}
