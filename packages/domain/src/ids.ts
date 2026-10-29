/**
 * Stable entity identifiers.
 *
 * IDs are opaque strings branded at the type level so that a `TrackId` cannot be
 * passed where a `ClipId` is expected. Commands receive IDs in their payloads
 * (the caller generates them) so that applying a command is deterministic and
 * replayable — the domain never generates randomness itself.
 */
declare const brandSymbol: unique symbol;

export type Brand<T, B extends string> = T & { readonly [brandSymbol]: B };

export type ProjectId = Brand<string, 'ProjectId'>;
export type TrackId = Brand<string, 'TrackId'>;
export type ClipId = Brand<string, 'ClipId'>;
export type NoteId = Brand<string, 'NoteId'>;
export type AssetId = Brand<string, 'AssetId'>;
export type EffectId = Brand<string, 'EffectId'>;
export type MappingId = Brand<string, 'MappingId'>;
export type VocalNoteId = Brand<string, 'VocalNoteId'>;

export type EntityIdKind =
  'project' | 'track' | 'clip' | 'note' | 'asset' | 'effect' | 'mapping' | 'vocalNote';

const ID_PREFIX: Record<EntityIdKind, string> = {
  project: 'prj',
  track: 'trk',
  clip: 'clp',
  note: 'nte',
  asset: 'ast',
  effect: 'fx',
  mapping: 'map',
  vocalNote: 'vn',
};

interface IdTypeByKind {
  project: ProjectId;
  track: TrackId;
  clip: ClipId;
  note: NoteId;
  asset: AssetId;
  effect: EffectId;
  mapping: MappingId;
  vocalNote: VocalNoteId;
}

/** Source of unique suffixes; the host injects e.g. `crypto.randomUUID`. */
export type UniqueSuffixSource = () => string;

export interface IdFactory {
  create<K extends EntityIdKind>(kind: K): IdTypeByKind[K];
}

export function createIdFactory(nextSuffix: UniqueSuffixSource): IdFactory {
  return {
    create<K extends EntityIdKind>(kind: K): IdTypeByKind[K] {
      return `${ID_PREFIX[kind]}_${nextSuffix()}` as IdTypeByKind[K];
    },
  };
}

/** Deterministic factory for tests and fixtures: `trk_1`, `trk_2`, … */
export function createSequentialIdFactory(start = 1): IdFactory {
  let counter = start;
  return createIdFactory(() => String(counter++));
}

/** Unchecked cast helpers for boundaries that have already validated input. */
export const asTrackId = (value: string): TrackId => value as TrackId;
export const asClipId = (value: string): ClipId => value as ClipId;
export const asNoteId = (value: string): NoteId => value as NoteId;
export const asAssetId = (value: string): AssetId => value as AssetId;
export const asEffectId = (value: string): EffectId => value as EffectId;
export const asMappingId = (value: string): MappingId => value as MappingId;
export const asProjectId = (value: string): ProjectId => value as ProjectId;
export const asVocalNoteId = (value: string): VocalNoteId => value as VocalNoteId;
