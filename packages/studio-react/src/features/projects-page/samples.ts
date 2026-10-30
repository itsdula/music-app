/** A built-in sample song (embedded `.studio` bundle, loaded on demand). */
export interface SampleProject {
  readonly id: string;
  readonly genre: string;
  readonly title: string;
  readonly description: string;
  readonly bpm: number;
  readonly bars: number;
  readonly tracks: number;
  /** Resolves the bundle bytes as base64 (dynamic import, so unused samples cost nothing). */
  readonly load: () => Promise<string>;
}

export const GENRE_LABELS: Readonly<Record<string, string>> = {
  edm: 'EDM',
  rock: 'Rock',
  rap: 'Rap',
  house: 'House',
  pop: 'Pop',
  techno: 'Techno',
};

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
