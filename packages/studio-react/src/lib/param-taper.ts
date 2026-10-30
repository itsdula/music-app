import { denormalizeParam, normalizeParam, type ParamSpec } from '@studio/domain';
import type { Taper } from '@studio/audio-ui';

/**
 * The position law of a ParamSpec as an audiocn taper, so a fader's travel matches the
 * normalized space used by MIDI mappings and automation.
 */
export function paramTaper(spec: ParamSpec): Taper {
  return {
    toPosition: (value) => normalizeParam(spec, value),
    toValue: (position) => denormalizeParam(spec, position),
  };
}
