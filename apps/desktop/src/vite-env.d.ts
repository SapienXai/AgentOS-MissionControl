/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AGENTOS_DESKTOP_ENV?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
