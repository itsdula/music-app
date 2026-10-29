/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Absolute URL of a Studio `/api/assistant` endpoint; unset = no AI assistant. */
  readonly VITE_STUDIO_ASSISTANT_URL?: string;
  /** Optional shared secret matching the server's STUDIO_ASSISTANT_TOKEN (public in the bundle). */
  readonly VITE_STUDIO_ASSISTANT_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
