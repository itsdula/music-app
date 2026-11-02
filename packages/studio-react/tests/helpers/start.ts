import { fireEvent, screen, waitFor } from '@testing-library/react';
import { expect } from 'vitest';

/** In the start dialog a rendered `<Studio />` shows after boot, creates an empty project. */
export async function startEmptyProject(): Promise<void> {
  fireEvent.click(await screen.findByTestId('start-new', {}, { timeout: 5000 }));
  await waitFor(() => expect(screen.queryByTestId('start-screen')).toBeNull(), { timeout: 5000 });
}
