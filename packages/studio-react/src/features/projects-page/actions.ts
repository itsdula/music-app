import type { StudioSession } from '../../session/studio-session';
import { base64ToBytes, type SampleProject } from './samples';

/** Imports a copy of a built-in sample song and opens it. */
export async function openSampleProject(
  session: StudioSession,
  sample: SampleProject,
): Promise<void> {
  const bytes = base64ToBytes(await sample.load());
  await session.projects.importBundle({
    name: `${sample.id}.studio`,
    mimeType: 'application/zip',
    bytes,
  });
}

/** Asks for a `.studio` bundle and opens it. Resolves `false` when the picker was cancelled. */
export async function importProjectFile(session: StudioSession): Promise<boolean> {
  const [file] = await session.platform.fileDialogs.openFiles({
    accept: ['.studio', 'application/zip'],
    multiple: false,
  });
  if (!file) return false;
  await session.projects.importBundle(file);
  return true;
}
