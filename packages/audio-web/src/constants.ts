/**
 * Tunable constants of the Web Audio backend. Rationale for each value is documented
 * in docs/audio-engine.md ("Scheduling constants").
 */

/** Heartbeat period of the lookahead scheduler (Worker timer). */
export const SCHEDULER_INTERVAL_MS = 25;
/** How far ahead of AudioContext.currentTime events are scheduled. */
export const LOOKAHEAD_SECONDS = 0.12;
/** Delay between play()/seek() and the first scheduled sample (lets the first window be planned). */
export const START_DELAY_SECONDS = 0.03;
/** Minimum distance from currentTime for newly scheduled events (edits, replans). */
export const MIN_LEAD_SECONDS = 0.01;
/** Notes up to this late are played immediately; later ones are dropped. */
export const LATE_NOTE_TOLERANCE_SECONDS = 0.05;

/** setTargetAtTime time constant for parameter changes (≈ 5·τ = 60 ms to settle). */
export const PARAM_TIME_CONSTANT = 0.012;
/** Linear crossfade for effect bypass and chain rewiring. */
export const BYPASS_CROSSFADE_SECONDS = 0.01;
/** Fade used when stop/pause/seek cuts sounding voices. */
export const STOP_FADE_SECONDS = 0.01;
/** Fade used when a voice is stolen. */
export const STEAL_FADE_SECONDS = 0.005;
/** De-click ramp for audio clips started mid-way or cut early. */
export const AUDIO_DECLICK_SECONDS = 0.005;

/** Reverb impulse responses are regenerated this long after the last decay/damping change. */
export const REVERB_IR_DEBOUNCE_MS = 150;
/** Crossfade between the old and new convolver after regeneration. */
export const REVERB_SWAP_SECONDS = 0.06;
/** Drum kit buffers are re-rendered this long after the last tune/decay/tone change. */
export const DRUM_RENDER_DEBOUNCE_MS = 60;

/** Offline render: events are scheduled chunk by chunk at suspend points. */
export const RENDER_CHUNK_SECONDS = 2;
/** Offline render: each chunk schedules this much beyond its end. */
export const RENDER_LEAD_SECONDS = 0.25;
/** Hard cap on offline render length (memory: 2 ch × 48 kHz × 1 h ≈ 1.4 GB float32). */
export const MAX_RENDER_SECONDS = 3600;

/** Recorder chunk size posted from the worklet (≈ 85 ms at 48 kHz). */
export const RECORDER_CHUNK_FRAMES = 4096;

/** Peak amplitude of one synth voice at full velocity (headroom for polyphony). */
export const SYNTH_VOICE_LEVEL = 0.5;
/** Sampler voice limit (oldest stolen). */
export const SAMPLER_MAX_VOICES = 32;
/** Seed for the deterministic drum kit synthesis. */
export const DRUM_KIT_SEED = 0x5d12;
/** Every mixer channel is stereo (mono sources are up-mixed by the channel input). */
export const MIXER_CHANNELS = 2;
