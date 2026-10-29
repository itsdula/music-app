import { expect, test, type Page } from '@playwright/test';
import { installFakeMidi, lastSysexRequest, sendMidi, sendMidiBatch, setMidiPortConnected } from '../fake-midi';
import { openStudio, resetStorage } from '../helpers';

/**
 * Phase 5 with a simulated controller. The fake reproduces Web MIDI semantics and the
 * community-reported "MPK mini 3" port name; it is not evidence of hardware behaviour.
 */
const MPK = { id: 'mpk-in', name: 'MPK mini 3', manufacturer: 'AKAI' };
const KNOB1_CC = 70; // factory Program 1 (community-reported; see docs/midi-device-research.md)

async function connectMidi(page: Page): Promise<void> {
  await page.getByTestId('midi-connect').click();
  await expect(page.getByTestId('midi-devices').getByRole('status')).toHaveText('MIDI connected.');
}

async function openControllerView(page: Page, view: 'Hardware' | 'Mappings' | 'Diagnostics' | 'Compatibility'): Promise<void> {
  await page.getByRole('tab', { name: 'Controller' }).click();
  await page.getByTestId('controller-panel').getByRole('radio', { name: view }).click();
}

async function sliderValue(page: Page, name: string): Promise<number> {
  return Number(await page.getByRole('slider', { name, exact: true }).first().getAttribute('aria-valuenow'));
}

test.describe('Phase 5: MPK Mini MK3 (simulated Web MIDI port)', () => {
  test.beforeEach(async ({ page }) => {
    await installFakeMidi(page, [MPK]);
    await openStudio(page);
    await resetStorage(page);
    await page.reload();
    await expect(page.getByTestId('studio-root')).toHaveAttribute('data-studio-status', 'ready', { timeout: 30_000 });
  });

  test('detects the controller by port name, applies its profile and never requests SysEx', async ({ page }) => {
    await connectMidi(page);
    const device = page.getByTestId('midi-device');
    await expect(device).toHaveCount(1);
    await expect(device).toContainText('MPK mini 3');
    await expect(device).toContainText('Profile');
    expect(await lastSysexRequest(page)).toBe(false);

    await page.getByRole('tab', { name: 'Controller' }).click();
    await expect(page.getByTestId('controller-panel')).toContainText('Connected · MPK mini 3');
    await expect(page.getByTestId('mpk-hardware-view')).toBeVisible();
    await openControllerView(page, 'Compatibility');
    await expect(page.getByTestId('mpk-compatibility')).toContainText('Nothing below has been tested on a physical unit yet');
  });

  test('pads and keys play the selected instrument and appear in diagnostics', async ({ page }) => {
    await connectMidi(page);
    // Pad 1 (channel 10, note 36) and a key (channel 1, middle C).
    await sendMidi(page, MPK.id, [0x99, 36, 100]);
    await sendMidi(page, MPK.id, [0x89, 36, 0]);
    await sendMidi(page, MPK.id, [0x90, 60, 90]);
    await sendMidi(page, MPK.id, [0x80, 60, 0]);
    await openControllerView(page, 'Diagnostics');
    const log = page.getByTestId('midi-diagnostics');
    await expect(log).toContainText('Note On ch 10');
    await expect(log).toContainText('Note On ch 1');
    await expect(log.getByText('instrument', { exact: true }).first()).toBeVisible();
  });

  test('knob 1 controls the selected track volume with pickup takeover', async ({ page }) => {
    await connectMidi(page);
    await page.getByRole('tab', { name: 'Mixer' }).click();
    const before = await sliderValue(page, 'Keys volume');
    // A knob far from the current value must not make the volume jump.
    await sendMidi(page, MPK.id, [0xb0, KNOB1_CC, 0]);
    await expect.poll(() => sliderValue(page, 'Keys volume')).toBeCloseTo(before, 3);
    // Sweeping through the current value picks it up; from then on the knob is in control.
    await sendMidiBatch(
      page,
      MPK.id,
      Array.from({ length: 128 }, (_, v) => [0xb0, KNOB1_CC, v]),
    );
    await expect.poll(() => sliderValue(page, 'Keys volume')).toBeCloseTo(1, 2);
    await sendMidi(page, MPK.id, [0xb0, KNOB1_CC, 64]);
    await expect.poll(() => sliderValue(page, 'Keys volume')).toBeCloseTo(64 / 127, 2);
  });

  test('MIDI Learn maps a new CC to an instrument parameter and stores it in the project', async ({ page }) => {
    await connectMidi(page);
    await page.getByRole('tab', { name: /Track|Clip/ }).click();
    await page.getByRole('slider', { name: 'Cutoff', exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'MIDI Learn…' }).click();
    await expect(page.getByTestId('learn-banner')).toContainText('MIDI Learn: move a knob');
    await sendMidi(page, MPK.id, [0xb0, 21, 100]);
    await expect(page.getByTestId('learn-banner')).toContainText('CC 21');
    await page.getByTestId('learn-confirm-project').click();
    await expect(page.getByTestId('learn-banner')).toHaveCount(0);

    // The learned control now drives the cutoff (pickup: sweep through the current value).
    await sendMidiBatch(
      page,
      MPK.id,
      Array.from({ length: 128 }, (_, v) => [0xb0, 21, v]),
    );
    await expect.poll(() => sliderValue(page, 'Cutoff')).toBeCloseTo(1, 2);

    await openControllerView(page, 'Mappings');
    await expect(page.getByTestId('mapping-row').filter({ hasText: 'CC 21' })).toHaveCount(1);
    // Project mappings are undoable like any edit: undo the cutoff sweep, then the mapping.
    await page.keyboard.press('ControlOrMeta+z');
    await page.keyboard.press('ControlOrMeta+z');
    await expect(page.getByTestId('mapping-row').filter({ hasText: 'CC 21' })).toHaveCount(0);
  });

  test('project and global mappings survive a reload', async ({ page }) => {
    await connectMidi(page);
    await page.getByRole('tab', { name: /Track|Clip/ }).click();
    const learn = async (param: string, cc: number, scope: 'project' | 'global') => {
      await page.getByRole('slider', { name: param, exact: true }).click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'MIDI Learn…' }).click();
      await sendMidi(page, MPK.id, [0xb0, cc, 90]);
      await expect(page.getByTestId('learn-banner')).toContainText(`CC ${cc}`);
      await page.getByRole('button', { name: scope === 'project' ? 'Map in this project' : 'Map for all projects' }).click();
      await expect(page.getByTestId('learn-banner')).toHaveCount(0);
    };
    await learn('Cutoff', 21, 'project');
    await learn('Resonance', 22, 'global');
    await expect(page.getByTestId('save-status')).toHaveAttribute('data-status', 'saved', { timeout: 10_000 });

    await page.reload();
    await expect(page.getByTestId('studio-root')).toHaveAttribute('data-studio-status', 'ready', { timeout: 30_000 });
    await openControllerView(page, 'Mappings');
    const rows = page.getByTestId('mapping-row');
    await expect(rows.filter({ hasText: 'CC 21' })).toHaveCount(1);
    await expect(rows.filter({ hasText: 'CC 22' })).toHaveCount(1);
  });

  test('hot-unplug and reconnect update the device state without a reload', async ({ page }) => {
    await connectMidi(page);
    await page.getByRole('tab', { name: 'Controller' }).click();
    const panel = page.getByTestId('controller-panel');
    await expect(panel).toContainText('Connected · MPK mini 3');
    await setMidiPortConnected(page, MPK.id, false);
    await expect(panel).toContainText('Not connected');
    await setMidiPortConnected(page, MPK.id, true);
    await expect(panel).toContainText('Connected · MPK mini 3');
    // Input still flows after reconnecting.
    await openControllerView(page, 'Diagnostics');
    await sendMidi(page, MPK.id, [0x90, 64, 80]);
    await expect(page.getByTestId('midi-diagnostics')).toContainText('Note On ch 1');
  });
});
