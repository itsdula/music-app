import type { AssetRef, Project } from '@studio/domain';
import type { CommandOf } from '../types';
import { deepEqual, fail, getOwn, omitEntries, requireFinite, requireInt, setEntry } from '../util';

function validateAsset(asset: AssetRef): void {
  if (typeof asset.id !== 'string' || asset.id.length === 0) {
    fail('invalid-argument', 'asset id must be a non-empty string');
  }
  if (asset.kind !== 'audio')
    fail('invalid-argument', `unsupported asset kind ${String(asset.kind)}`);
  if (!(requireFinite(asset.sampleRate, 'sampleRate') > 0)) {
    fail('invalid-argument', 'sampleRate must be positive');
  }
  requireInt(asset.channels, 'channels', 1);
  requireInt(asset.frames, 'frames', 0);
  requireInt(asset.byteLength, 'byteLength', 0);
}

/** Registering an identical AssetRef again is a no-op; conflicting content is rejected. */
export function registerAsset(project: Project, command: CommandOf<'asset.register'>): Project {
  const { asset } = command;
  validateAsset(asset);
  const existing = getOwn(project.assets, asset.id);
  if (existing) {
    if (deepEqual(existing, asset)) return project;
    fail('invalid-argument', `asset ${asset.id} is already registered with different content`);
  }
  return { ...project, assets: setEntry(project.assets, asset.id, asset) };
}

/** Precondition: no clip, sampler instrument or vocal edit doc references the asset. */
export function removeAsset(project: Project, command: CommandOf<'asset.remove'>): Project {
  const { assetId } = command;
  if (!getOwn(project.assets, assetId)) fail('not-found', `asset ${assetId} not found`);
  const clip = Object.values(project.clips).find(
    (c) => c.kind === 'audio' && c.assetId === assetId,
  );
  if (clip) fail('precondition-failed', `asset ${assetId} is used by clip ${clip.id}`);
  const track = Object.values(project.tracks).find((t) => t.instrument?.sampleAssetId === assetId);
  if (track) fail('precondition-failed', `asset ${assetId} is used by track ${track.id}`);
  if (
    getOwn(project.vocalEdits, assetId) ||
    Object.values(project.vocalEdits).some((d) => d.assetId === assetId)
  ) {
    fail('precondition-failed', `asset ${assetId} has vocal edits`);
  }
  return { ...project, assets: omitEntries(project.assets, new Set([assetId])) };
}
