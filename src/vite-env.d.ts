/// <reference types="unplugin-icons/types/svelte5" />
/// <reference types="svelte" />
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SOURCE_CODE_URL?: string;
}

declare const __GIT_HASH__: string;
declare const __APP_VERSION__: string;
declare const __OFFLINE_BUILD__: boolean;

declare module 'tar-js' {
  export default class Tar {
    constructor(recordsPerBlock?: number);
    append(filepath: string, input: string | Uint8Array, opts?: Record<string, unknown>, callback?: (out: Uint8Array) => void): Uint8Array;
    out: Uint8Array;
    clear(): void;
  }
}

declare module 'js-untar' {
  interface UntarFile {
    name: string;
    buffer: ArrayBuffer;
    type?: string;
    size?: number;
  }
  export default function untar(buffer: ArrayBuffer): Promise<UntarFile[]>;
}
