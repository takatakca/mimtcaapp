/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_TAKATAK_ISSUER?: string;
  readonly VITE_TAKATAK_CLIENT_ID?: string;
  readonly VITE_MOCK_API?: string;
  readonly VITE_ADSENSE_CLIENT?: string;
  readonly VITE_ADSENSE_SLOT_BANNER?: string;
  readonly VITE_ADSENSE_SLOT_SIDEBAR?: string;
  readonly VITE_TWILIO_EDGE?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
