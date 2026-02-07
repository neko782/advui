/// <reference types="svelte" />
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SOURCE_CODE_URL?: string;
}

declare const __GIT_HASH__: string;
