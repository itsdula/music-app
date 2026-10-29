import { afterEach, describe, expect, it } from 'vitest';
import {
  matchesTarget,
  placeCard,
  resolveTarget,
  TUTORIAL_LAYER_ATTR,
} from '../src/features/tutorial/target';

afterEach(() => {
  document.body.innerHTML = '';
});

function mount(html: string): HTMLElement {
  document.body.innerHTML = `<button data-testid="outside">Outside</button><div data-testid="studio-root">${html}</div>`;
  return document.querySelector<HTMLElement>('[data-testid="studio-root"]')!;
}

describe('resolveTarget', () => {
  it('finds test ids inside the root only, first or last', () => {
    const root = mount(
      '<div data-testid="track-header" id="a"></div><div data-testid="track-header" id="b"></div>',
    );
    expect(resolveTarget(root, 'track-header')?.id).toBe('a');
    expect(resolveTarget(root, 'track-header:first')?.id).toBe('a');
    expect(resolveTarget(root, 'track-header:last')?.id).toBe('b');
    expect(resolveTarget(root, 'outside')).toBeNull();
    expect(resolveTarget(root, 'missing')).toBeNull();
    expect(resolveTarget(root, 'div > *')).toBeNull();
  });

  it('finds controls by role and accessible name (exact before prefix)', () => {
    const root = mount(`
      <div role="tablist">
        <button role="tab" id="t1">Track</button>
        <button role="tab" id="t2">Mixer</button>
      </div>
      <button id="b1"><svg></svg> Analyze vocal again</button>
      <button id="b2" aria-label="Analyze vocal"></button>
      <span role="radio" id="r1">Pitch (vocal)</span>
      <input type="range" id="s1" aria-labelledby="lbl" /><span id="lbl">Auto Tune</span>
    `);
    expect(resolveTarget(root, 'tab:Mixer')?.id).toBe('t2');
    expect(resolveTarget(root, 'tab:mixer')?.id).toBe('t2');
    expect(resolveTarget(root, 'button:Analyze vocal')?.id).toBe('b2');
    expect(resolveTarget(root, 'button:Analyze')?.id).toBe('b1');
    expect(resolveTarget(root, 'radio:Pitch (vocal)')?.id).toBe('r1');
    expect(resolveTarget(root, 'slider:Auto Tune')?.id).toBe('s1');
    // A button with an explicit other role is not a "button".
    expect(resolveTarget(root, 'button:Track')).toBeNull();
  });

  it('never resolves to tutorial UI', () => {
    const root = mount(
      `<div ${TUTORIAL_LAYER_ATTR}><button id="next">Next</button></div><button id="real">Next</button>`,
    );
    expect(resolveTarget(root, 'button:Next')?.id).toBe('real');
  });
});

describe('matchesTarget', () => {
  it('matches the target element and its descendants', () => {
    const root = mount(
      '<button data-testid="add-effect"><span id="inner">+</span></button><div data-testid="mixer"><b id="strip"></b></div>',
    );
    const inner = document.getElementById('inner')!;
    expect(matchesTarget(root, 'add-effect', inner)).toBe(true);
    expect(matchesTarget(root, 'mixer', inner)).toBe(false);
    expect(matchesTarget(root, 'mixer', document.getElementById('strip')!)).toBe(true);
    expect(matchesTarget(root, 'nonsense target', inner)).toBe(false);
  });
});

describe('placeCard', () => {
  const size = { width: 300, height: 150 };
  const bounds = { width: 1200, height: 800 };

  it('centers without a target', () => {
    expect(placeCard(null, size, bounds)).toEqual({ left: 450, top: 325, side: 'center' });
    expect(placeCard({ left: 0, top: 0, width: 10, height: 10 }, size, bounds, 'center')).toEqual({
      left: 450,
      top: 325,
      side: 'center',
    });
  });

  it('uses the preferred side when it fits and clamps along the other axis', () => {
    const target = { left: 20, top: 10, width: 40, height: 30 };
    expect(placeCard(target, size, bounds, 'bottom')).toEqual({ left: 8, top: 52, side: 'bottom' });
    expect(placeCard(target, size, bounds, 'right')).toEqual({ left: 72, top: 8, side: 'right' });
    // No room above: falls back to the side with the most spare room.
    expect(placeCard(target, size, bounds, 'top').side).toBe('right');
  });

  it('picks the roomiest side automatically', () => {
    const nearBottomRight = { left: 1100, top: 700, width: 60, height: 40 };
    const pos = placeCard(nearBottomRight, size, bounds);
    expect(pos).toEqual({ left: 788, top: 642, side: 'left' });
    const wide = { left: 100, top: 700, width: 1000, height: 40 };
    expect(placeCard(wide, size, bounds)).toEqual({ left: 450, top: 538, side: 'top' });
  });

  it('goes inside a target that fills the screen', () => {
    const huge = { left: 0, top: 0, width: 1200, height: 800 };
    expect(placeCard(huge, size, bounds)).toEqual({ left: 884, top: 634, side: 'inside' });
  });
});
