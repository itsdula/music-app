import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TUTORIAL_ANCHORS } from '../src/features/tutorial/anchors';
import { BUILTIN_TUTORIALS } from '../src/features/tutorial/builtin';
import {
  parseTarget,
  TUTORIAL_LIMITS,
  validateTutorial,
  type Tutorial,
} from '../src/features/tutorial/schema';

const valid = (): Tutorial => ({
  id: 'add-reverb',
  title: 'Add reverb',
  description: 'Put reverb on a track.',
  steps: [
    {
      id: 'add',
      title: 'Add an effect',
      body: 'Click Add effect and choose Reverb.',
      target: 'add-effect',
      before: { openPanel: 'track' },
      advance: { type: 'condition', condition: { type: 'effectCount', added: 1 } },
    },
    { id: 'done', title: 'Done', body: 'Nice.', advance: { type: 'next' } },
  ],
});

function errorsFor(input: unknown, options?: Parameters<typeof validateTutorial>[1]) {
  const result = validateTutorial(input, options);
  return result.ok ? [] : result.errors;
}

describe('validateTutorial', () => {
  it('accepts a well-formed tutorial and returns a detached copy', () => {
    const input = valid();
    const result = validateTutorial(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tutorial).toEqual(input);
    expect(result.tutorial).not.toBe(input);
  });

  it('accepts every built-in tutorial', () => {
    for (const tutorial of BUILTIN_TUTORIALS) {
      expect(errorsFor(tutorial), tutorial.id).toEqual([]);
    }
    expect(new Set(BUILTIN_TUTORIALS.map((t) => t.id)).size).toBe(BUILTIN_TUTORIALS.length);
  });

  it('rejects non-objects and missing fields with paths', () => {
    expect(errorsFor(null)).toEqual(['tutorial must be an object']);
    expect(errorsFor({})).toEqual([
      'tutorial.id is required',
      'tutorial.title is required',
      'tutorial.description is required',
      'tutorial.steps is required',
    ]);
  });

  it('reports bad ids, unknown keys, empty and over-long text', () => {
    const errors = errorsFor({
      ...valid(),
      id: 'Add Reverb',
      extra: 1,
      title: ' ',
      description: 'x'.repeat(TUTORIAL_LIMITS.descriptionMaxLength + 1),
    });
    expect(errors).toEqual([
      'tutorial.extra is not allowed (allowed keys: id, title, description, steps)',
      expect.stringMatching(/^tutorial\.id must be lowercase letters, digits and dashes/),
      'tutorial.title must not be empty',
      `tutorial.description must be at most ${TUTORIAL_LIMITS.descriptionMaxLength} characters (got ${TUTORIAL_LIMITS.descriptionMaxLength + 1})`,
    ]);
  });

  it('rejects control characters but allows newlines in bodies', () => {
    const t = valid();
    const ok = { ...t, steps: [{ ...t.steps[1]!, body: 'line one\nline two' }] };
    expect(errorsFor(ok)).toEqual([]);
    const bad = { ...t, steps: [{ ...t.steps[1]!, body: 'bell\u0007' }] };
    expect(errorsFor(bad)).toEqual([
      'tutorial.steps[0].body must be plain text without control characters',
    ]);
  });

  it('limits the number of steps and requires unique step ids', () => {
    const step = valid().steps[1]!;
    const many = Array.from({ length: TUTORIAL_LIMITS.maxSteps + 1 }, (_, i) => ({
      ...step,
      id: `s${i}`,
    }));
    expect(errorsFor({ ...valid(), steps: many })).toEqual([
      `tutorial.steps allows at most ${TUTORIAL_LIMITS.maxSteps} steps (got ${TUTORIAL_LIMITS.maxSteps + 1})`,
    ]);
    expect(errorsFor({ ...valid(), steps: [] })).toEqual([
      'tutorial.steps needs at least one step',
    ]);
    expect(errorsFor({ ...valid(), steps: [step, step] })).toEqual([
      'tutorial.steps[1].id "done" is used by an earlier step',
    ]);
  });

  it('checks targets against the anchor list and the role allow-list', () => {
    const t = valid();
    const withTarget = (target: string) => ({ ...t, steps: [{ ...t.steps[1]!, target }] });
    expect(errorsFor(withTarget('track-header:last'))).toEqual([]);
    expect(errorsFor(withTarget('tab:Mixer'))).toEqual([]);
    expect(errorsFor(withTarget('nope-not-real'))[0]).toMatch(
      /^tutorial\.steps\[0\]\.target "nope-not-real" is not a known anchor/,
    );
    expect(errorsFor(withTarget('#app > div'))[0]).toMatch(/is not a valid target/);
    expect(errorsFor(withTarget('link:Home'))[0]).toMatch(/is not a valid target/);
  });

  it('validates advance rules', () => {
    const t = valid();
    const withAdvance = (advance: unknown, target?: string) => ({
      ...t,
      steps: [{ id: 'a', title: 'A', body: 'B', advance, ...(target ? { target } : {}) }],
    });
    expect(errorsFor(withAdvance(undefined))).toEqual(['tutorial.steps[0].advance is required']);
    expect(errorsFor(withAdvance({ type: 'wait' }))).toEqual([
      'tutorial.steps[0].advance.type must be one of next | click | tool | condition; got "wait"',
    ]);
    expect(errorsFor(withAdvance({ type: 'click' }))).toEqual([
      'tutorial.steps[0].advance (type "click") needs a target on the step or on the advance',
    ]);
    expect(errorsFor(withAdvance({ type: 'click' }, 'transport-play'))).toEqual([]);
    expect(errorsFor(withAdvance({ type: 'tool', name: 'Bad Name' }))).toEqual([
      'tutorial.steps[0].advance.name must be a tool name matching ^[a-z][a-z0-9_]{0,63}$',
    ]);
    expect(
      errorsFor(withAdvance({ type: 'tool', name: 'make_coffee' }), { knownTools: ['add_track'] }),
    ).toEqual(['tutorial.steps[0].advance.name "make_coffee" is not an available tool']);
    expect(errorsFor(withAdvance({ type: 'next', target: 'x' }))).toEqual([
      'tutorial.steps[0].advance.target is not allowed (allowed keys: type)',
    ]);
  });

  it('validates conditions from the closed set, including counts and nesting', () => {
    const t = valid();
    const withCondition = (condition: unknown) => ({
      ...t,
      steps: [{ id: 'a', title: 'A', body: 'B', advance: { type: 'condition', condition } }],
    });
    const p = 'tutorial.steps[0].advance.condition';
    expect(errorsFor(withCondition({ type: 'playing' }))).toEqual([]);
    expect(errorsFor(withCondition({ type: 'teleport' }))[0]).toMatch(
      new RegExp(`^${p.replace(/[[\].]/g, '\\$&')}\\.type must be one of view \\| panelOpen`),
    );
    expect(errorsFor(withCondition({ type: 'view', view: 'mixer' }))).toEqual([
      `${p}.view must be one of projects | arrange | editor; got "mixer"`,
    ]);
    expect(errorsFor(withCondition({ type: 'trackCount', kind: 'midi', min: 1 }))).toEqual([
      `${p}.kind must be one of instrument | audio | vocal; got "midi"`,
    ]);
    expect(errorsFor(withCondition({ type: 'clipCount' }))).toEqual([
      `${p} (type "clipCount") needs exactly one of "min" (absolute) or "added" (since the step started)`,
    ]);
    expect(errorsFor(withCondition({ type: 'noteCount', min: 1, added: 1 }))).toHaveLength(1);
    expect(errorsFor(withCondition({ type: 'noteCount', min: -1 }))).toEqual([
      `${p}.min must be an integer from 0 to ${TUTORIAL_LIMITS.maxCount}`,
    ]);
    expect(errorsFor(withCondition({ type: 'playing', value: true }))).toEqual([
      `${p}.value is not allowed (allowed keys: type)`,
    ]);
    expect(
      errorsFor(
        withCondition({
          type: 'all',
          conditions: [{ type: 'playing' }, { type: 'any', conditions: [{ type: 'loopEnabled' }] }],
        }),
      ),
    ).toEqual([]);
    expect(
      errorsFor(
        withCondition({
          type: 'all',
          conditions: [
            { type: 'any', conditions: [{ type: 'all', conditions: [{ type: 'playing' }] }] },
          ],
        }),
      ),
    ).toEqual([`${p}.conditions[0].conditions[0].conditions nests too deeply (max depth 3)`]);
    expect(errorsFor(withCondition({ type: 'any', conditions: [] }))).toEqual([
      `${p}.conditions must be a non-empty array of conditions`,
    ]);
  });

  it('rejects reserved ids', () => {
    expect(
      errorsFor({ ...valid(), id: 'getting-started' }, { reservedIds: ['getting-started'] }),
    ).toEqual([
      'tutorial.id "getting-started" is reserved by a built-in tutorial; choose another id',
    ]);
  });
});

describe('parseTarget', () => {
  it('parses test ids with an optional pick and role forms', () => {
    expect(parseTarget('transport-play')).toEqual({
      kind: 'testid',
      id: 'transport-play',
      pick: 'first',
    });
    expect(parseTarget('track-arm:last')).toEqual({
      kind: 'testid',
      id: 'track-arm',
      pick: 'last',
    });
    expect(parseTarget('tab:Mixer')).toEqual({ kind: 'role', role: 'tab', name: 'Mixer' });
    expect(parseTarget('radio:Pitch (vocal)')).toEqual({
      kind: 'role',
      role: 'radio',
      name: 'Pitch (vocal)',
    });
    for (const bad of [
      '',
      'Transport',
      '[data-testid=x]',
      'a b',
      'track-arm:nth(2)',
      'tab:',
      'div:x',
    ])
      expect(parseTarget(bad), bad).toBeNull();
  });
});

describe('tutorial anchors', () => {
  const srcRoot = join(import.meta.dirname, '..', 'src');
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.tsx?$/.test(name)) files.push(path);
    }
  };
  walk(srcRoot);
  const source = files.map((f) => readFileSync(f, 'utf8')).join('\n');

  it('are unique and documented', () => {
    const ids = TUTORIAL_ANCHORS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const anchor of TUTORIAL_ANCHORS) {
      expect(anchor.description.length, anchor.id).toBeGreaterThan(5);
      expect(anchor.where.length, anchor.id).toBeGreaterThan(2);
    }
  });

  it.each(TUTORIAL_ANCHORS.map((a) => a.id))('"%s" exists as a data-testid in the source', (id) => {
    const pattern = new RegExp(`(data-testid|testId)=["'{\`]+${id}["'\`}]`);
    expect(pattern.test(source), `no data-testid="${id}" in packages/studio-react/src`).toBe(true);
  });

  it('cover every testid target used by the built-in tutorials', () => {
    for (const tutorial of BUILTIN_TUTORIALS)
      for (const step of tutorial.steps) {
        const target = step.target ? parseTarget(step.target) : null;
        if (target?.kind === 'testid')
          expect(
            TUTORIAL_ANCHORS.some((a) => a.id === target.id),
            `${tutorial.id}/${step.id}`,
          ).toBe(true);
      }
  });
});
