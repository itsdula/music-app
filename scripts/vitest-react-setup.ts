import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// jsdom lacks layout/canvas APIs used by Studio and Radix; provide inert stand-ins.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;
if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = (() =>
    null) as unknown as HTMLCanvasElement['getContext'];
}
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}
if (typeof Element !== 'undefined') {
  const stubs: Partial<Record<keyof Element, () => unknown>> = {
    hasPointerCapture: () => false,
    setPointerCapture: () => undefined,
    releasePointerCapture: () => undefined,
    scrollIntoView: () => undefined,
  };
  for (const [name, value] of Object.entries(stubs)) {
    if (!(name in Element.prototype)) {
      Object.defineProperty(Element.prototype, name, { value, configurable: true, writable: true });
    }
  }
}

afterEach(() => {
  cleanup();
});
