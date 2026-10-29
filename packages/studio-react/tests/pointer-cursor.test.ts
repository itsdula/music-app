import { describe, expect, it } from 'vitest';
import { classifyEdge, edgeZoneWidth, type EdgeZoneSpec } from '../src/lib/edge-zones';
import { CURSORS, resolveCursor, type CursorInput } from '../src/lib/pointer-cursor';

const base: CursorInput = { target: 'empty', tool: 'select', modifiers: { alt: false } };

describe('resolveCursor', () => {
  it.each<[string, Partial<CursorInput>, string]>([
    ['empty space with the select tool', {}, 'default'],
    ['a marquee drag on empty space', { dragging: true }, 'crosshair'],
    ['empty space with the draw tool', { tool: 'draw' }, 'crosshair'],
    ['drawing where it is impossible', { tool: 'draw', allowed: false }, 'not-allowed'],
    ['a region/note body', { target: 'body' }, 'grab'],
    ['dragging a body', { target: 'body', dragging: true }, 'grabbing'],
    ['Alt over a body (duplicate)', { target: 'body', modifiers: { alt: true } }, 'copy'],
    ['Alt-dragging a body', { target: 'body', modifiers: { alt: true }, dragging: true }, 'copy'],
    ['a body with the draw tool (still moves)', { target: 'body', tool: 'draw' }, 'grab'],
    ['the start edge', { target: 'start-edge' }, 'ew-resize'],
    ['the end edge', { target: 'end-edge' }, 'ew-resize'],
    ['dragging an edge', { target: 'end-edge', dragging: true }, 'ew-resize'],
    [
      'Alt over an edge (no duplicate on trims)',
      { target: 'end-edge', modifiers: { alt: true } },
      'ew-resize',
    ],
    [
      'moving onto an incompatible track',
      { target: 'body', dragging: true, allowed: false },
      'not-allowed',
    ],
  ])('%s', (_label, input, expected) => {
    expect(resolveCursor({ ...base, ...input })).toBe(expected);
  });

  it('gives the loop handle its own cursor with a standard fallback', () => {
    const cursor = resolveCursor({ ...base, target: 'loop-handle' });
    expect(cursor).toBe(CURSORS.loop);
    expect(cursor).toMatch(/^url\("data:image\/svg\+xml,[^"]+"\) 10 10, e-resize$/);
    expect(cursor).not.toBe(resolveCursor({ ...base, target: 'end-edge' }));
  });
});

describe('edge zones', () => {
  const spec: EdgeZoneSpec = { max: 7, min: 4, outer: 4 };

  it('scales with width between the minimum and the maximum, keeping a third as body', () => {
    expect(edgeZoneWidth(200, spec)).toBe(7);
    expect(edgeZoneWidth(20, spec)).toBe(5);
    expect(edgeZoneWidth(12, spec)).toBe(4);
    expect(edgeZoneWidth(6, spec)).toBe(2); // a third of a tiny item
  });

  it('classifies inner zones and the slop just outside each edge', () => {
    expect(classifyEdge(50, 0, 100, spec, false)).toBe('inside');
    expect(classifyEdge(1, 0, 100, spec, false)).toBe('start');
    expect(classifyEdge(98, 0, 100, spec, false)).toBe('end');
    expect(classifyEdge(102, 0, 100, spec, false)).toBeNull();
    expect(classifyEdge(102, 0, 100, spec, true)).toBe('end');
    expect(classifyEdge(-3, 0, 100, spec, true)).toBe('start');
    expect(classifyEdge(-5, 0, 100, spec, true)).toBeNull();
  });

  it('keeps both edges of a very short item grabbable', () => {
    // A 3 px clip: inner zones are 1 px, but 4 px of slop on each side remain usable.
    expect(classifyEdge(-2, 0, 3, spec, true)).toBe('start');
    expect(classifyEdge(4, 0, 3, spec, true)).toBe('end');
    expect(classifyEdge(1.5, 0, 3, spec, false)).toBe('inside');
  });
});
