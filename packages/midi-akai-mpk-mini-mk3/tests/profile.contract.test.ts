/**
 * Generic invariants every MidiDeviceProfile must satisfy, run against the MPK Mini MK3.
 */
import { describe, expect, it } from 'vitest';
import type { MidiControlSource } from '@studio/domain';
import {
  encodeMidiMessage,
  parseMidiMessage,
  type MidiDeviceProfile,
  type MidiMessage,
} from '@studio/midi-core';
import { controlIdsForLayoutElement, mpkMiniMk3Profile } from '../src';

function messageFor(source: MidiControlSource): MidiMessage | null {
  const channel = source.channel === 'any' ? 1 : source.channel;
  switch (source.kind) {
    case 'note':
      return { type: 'noteOn', channel, note: source.note, velocity: 100 };
    case 'cc':
      return { type: 'controlChange', channel, controller: source.controller, value: 100 };
    case 'pitchBend':
      return { type: 'pitchBend', channel, value: 1000 };
    case 'programChange':
      return source.program === undefined
        ? null
        : { type: 'programChange', channel, program: source.program };
  }
}

function deviceProfileContract(profile: MidiDeviceProfile): void {
  describe(`device profile contract: ${profile.id}`, () => {
    it('has identity fields', () => {
      expect(profile.id).toMatch(/^[a-z0-9-]+\.[a-z0-9.-]+$/);
      expect(profile.displayName.length).toBeGreaterThan(0);
      expect(profile.manufacturer.length).toBeGreaterThan(0);
    });

    it('has unique control ids with verification metadata and no hardware claims', () => {
      const ids = profile.controls.map((c) => c.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const control of profile.controls) {
        expect(['documented', 'community', 'unverified', 'verified-hardware']).toContain(
          control.verification,
        );
        expect(control.label.length).toBeGreaterThan(0);
      }
    });

    it('identifies every control from its default message (through the wire format)', () => {
      for (const control of profile.controls) {
        if (!control.defaultSource) continue;
        const message = messageFor(control.defaultSource);
        if (!message) continue;
        const parsed = parseMidiMessage(encodeMidiMessage(message));
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) continue;
        expect(profile.identify(parsed.value)?.controlId, control.id).toBe(control.id);
      }
    });

    it('identify values are within 0..1', () => {
      for (const control of profile.controls) {
        const message = control.defaultSource && messageFor(control.defaultSource);
        if (!message) continue;
        const value = profile.identify(message)?.value ?? 0;
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    });

    it('default mappings are global, enabled and point at this profile', () => {
      const first = profile.defaultMappings();
      expect(profile.defaultMappings()).not.toBe(first);
      for (const mapping of first) {
        expect(mapping.scope).toBe('global');
        expect(mapping.enabled).toBe(true);
        expect(mapping.device).toEqual({ profileId: profile.id });
        expect(mapping.label?.length).toBeGreaterThan(0);
      }
    });

    it('capabilities have unique ids and notes', () => {
      const ids = profile.capabilities.map((c) => c.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const c of profile.capabilities) expect(c.note.length).toBeGreaterThan(0);
    });

    it('layout rects lie inside the unit panel and reference known controls', () => {
      const layout = profile.layout;
      if (!layout) return;
      expect(layout.aspectRatio).toBeGreaterThan(0);
      expect(layout.referenceNote.length).toBeGreaterThan(0);
      const controlIds = new Set(profile.controls.map((c) => c.id));
      for (const element of layout.elements) {
        const { x, y, w, h } = element.rect;
        expect(x, element.controlId).toBeGreaterThanOrEqual(0);
        expect(y, element.controlId).toBeGreaterThanOrEqual(0);
        expect(w, element.controlId).toBeGreaterThan(0);
        expect(h, element.controlId).toBeGreaterThan(0);
        expect(x + w, element.controlId).toBeLessThanOrEqual(1);
        expect(y + h, element.controlId).toBeLessThanOrEqual(1);
        for (const id of controlIdsForLayoutElement(element.controlId)) {
          expect(controlIds.has(id), `${element.controlId} → ${id}`).toBe(true);
        }
      }
    });
  });
}

deviceProfileContract(mpkMiniMk3Profile);
