import type { Hasher } from '@studio/platform-contracts';

export function createWebCryptoHasher(subtle: SubtleCrypto = crypto.subtle): Hasher {
  return {
    async sha256(bytes: Uint8Array): Promise<string> {
      const digest = await subtle.digest('SHA-256', bytes.slice().buffer);
      return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
    },
  };
}
