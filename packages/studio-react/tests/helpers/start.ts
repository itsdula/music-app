import { fireEvent, screen } from '@testing-library/react';

/** On the start screen a rendered `<Studio />` shows after boot, creates an empty project. */
export async function startEmptyProject(): Promise<void> {
  fireEvent.click(await screen.findByTestId('start-new', {}, { timeout: 5000 }));
  await screen.findByTestId('transport-bar', {}, { timeout: 5000 });
}
