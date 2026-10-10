/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_TAKATAK_ISSUER?: string;
  readonly VITE_TAKATAK_CLIENT_ID?: string;
  readonly VITE_MOCK_API?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
