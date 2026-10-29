import { readFileSync } from 'node:fs';
import { CURRENT_SCHEMA_VERSION, err, ok } from '@studio/domain';
import { describe, expect, it } from 'vitest';
import {
  MIGRATIONS,
  migrateProjectData,
  migrateWith,
  parseProject,
  parseProjectJson,
  type JsonRecord,
  type ProjectMigration,
} from '../src';
import { buildRichProject, mutableCopy } from './fixtures';

const v0Text = readFileSync(new URL('./fixtures/project-v0.json', import.meta.url), 'utf8');
const v0 = () => JSON.parse(v0Text) as JsonRecord;

describe('MIGRATIONS registry', () => {
  it('is ordered and contiguous up to the current version', () => {
    expect(MIGRATIONS).toHaveLength(CURRENT_SCHEMA_VERSION);
    MIGRATIONS.forEach((m, i) => {
      expect(m.fromVersion).toBe(i);
      expect(m.description.length).toBeGreaterThan(0);
    });
  });
});

describe('v0 → v1', () => {
  it('upgrades the frozen v0 fixture into a valid v1 project', () => {
    const result = parseProjectJson(v0Text);
    if (!result.ok) throw result.error;
    const { project, migratedFrom } = result.value;
    expect(migratedFrom).toBe(0);
    expect(project.schemaVersion).toBe(1);
    expect(project.bpm).toBe(92);
    expect(project.loop).toEqual({ enabled: true, startTick: 3840, endTick: 15360 });
    expect(project).not.toHaveProperty('tempo');
    expect(project).not.toHaveProperty('loopStart');
    expect(project).not.toHaveProperty('loopEnd');
    expect(project).not.toHaveProperty('loopEnabled');
    // Everything else passes through untouched.
    expect(project.name).toBe('Draft-era project');
    expect(Object.keys(project.clips).sort()).toEqual(['clp_a', 'clp_m']);
    expect(project.trackOrder).toEqual(['trk_keys', 'trk_audio']);
  });

  it('does not mutate its input', () => {
    const input = v0();
    const before = JSON.stringify(input);
    const result = migrateProjectData(input);
    expect(result.ok).toBe(true);
    expect(JSON.stringify(input)).toBe(before);
  });

  it('reports a current-version document as migratedFrom = current', () => {
    const result = migrateProjectData(buildRichProject().project);
    expect(result.ok && result.value.fromVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  const broken: [string, (d: JsonRecord) => void, string][] = [
    ['missing tempo', (d) => delete d['tempo'], 'tempo'],
    ['non-numeric tempo.bpm', (d) => (d['tempo'] = { bpm: 'fast' }), 'tempo.bpm'],
    ['missing loopStart', (d) => delete d['loopStart'], 'loopStart'],
    ['string loopEnd', (d) => (d['loopEnd'] = '100'), 'loopEnd'],
    ['numeric loopEnabled', (d) => (d['loopEnabled'] = 1), 'loopEnabled'],
    ['v1 field in a v0 document', (d) => (d['bpm'] = 120), 'bpm'],
  ];

  it.each(broken)('rejects a v0 document with %s', (_label, mutate, path) => {
    const doc = v0();
    mutate(doc);
    const result = parseProject(doc);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.stage).toBe('migration');
    const issue = result.error.issues.find((i) => i.path === path);
    expect(issue?.message).toMatch(/^v0→v1: /);
  });

  it('validates the migrated result against the v1 schema and invariants', () => {
    const doc = v0();
    doc['loopEnd'] = 100; // before loopStart: migrates fine, fails invariants
    const result = parseProject(doc);
    expect(!result.ok && result.error.stage).toBe('invariants');
  });
});

describe('version gate', () => {
  it('rejects documents from a newer schema instead of downgrading them', () => {
    const doc = mutableCopy(buildRichProject().project);
    doc['schemaVersion'] = CURRENT_SCHEMA_VERSION + 1;
    const result = migrateProjectData(doc);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.stage).toBe('version');
    expect(result.error.message).toMatch(/newer version of Studio \(schema 2\)/);
    expect(result.error.message).toMatch(/supports up to 1/);
  });

  it.each([[-1], [1.5], [Number.NaN], [null]])('rejects schemaVersion %s', (version) => {
    const doc = mutableCopy(buildRichProject().project);
    doc['schemaVersion'] = version;
    const result = migrateProjectData(doc);
    expect(!result.ok && result.error.stage).toBe('version');
  });
});

describe('migrateWith (pipeline mechanics)', () => {
  // A synthetic v1 → v2 step: renames `name` to `title`.
  const toV2: ProjectMigration = {
    fromVersion: 1,
    description: 'rename name to title',
    migrate: ({ name, ...rest }) =>
      typeof name === 'string'
        ? ok({ ...rest, title: name, schemaVersion: 2 })
        : err([{ path: 'name', message: 'must be a string' }]),
  };

  it('chains migrations in order from the stored version', () => {
    const result = migrateWith(v0(), [...MIGRATIONS, toV2], 2);
    if (!result.ok) throw result.error;
    expect(result.value.fromVersion).toBe(0);
    const data = result.value.data as JsonRecord;
    expect(data['schemaVersion']).toBe(2);
    expect(data['title']).toBe('Draft-era project');
    expect(data['bpm']).toBe(92);
  });

  it('fails when a step is missing from the registry', () => {
    const result = migrateWith(v0(), [toV2], 2);
    expect(!result.ok && result.error.issues[0]!.message).toBe(
      'no migration registered from schema 0',
    );
  });

  it('fails when a step does not produce the next version', () => {
    const bad: ProjectMigration = { ...toV2, migrate: (d) => ok({ ...d, schemaVersion: 5 }) };
    const result = migrateWith(buildRichProject().project, [...MIGRATIONS, bad], 2);
    expect(!result.ok && result.error.stage).toBe('migration');
  });
});
