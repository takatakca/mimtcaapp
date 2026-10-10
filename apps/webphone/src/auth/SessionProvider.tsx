// Signed-in state: restores the session from the refresh token on load, then loads /v1/me and the
// user's business memberships (GET /v1/business) to decide whether the admin portal is shown.
import type { AuthTokensResponse, BusinessResponse, MeResponse } from "@mimt/shared";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, http, onSignedOut } from "../api/client";

type Status = "loading" | "signedOut" | "signedIn";

interface Session {
  status: Status;
  me: MeResponse | null;
  businesses: BusinessResponse[];
  signIn: (tokens: AuthTokensResponse) => Promise<void>;
  signOut: () => Promise<void>;
  refreshMe: () => Promise<void>;
}

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [me, setMe] = useState<MeResponse | null>(null);
  const [businesses, setBusinesses] = useState<BusinessResponse[]>([]);

  const load = useCallback(async () => {
    const [m, b] = await Promise.all([api.me(), api.businesses().catch(() => ({ businesses: [] }))]);
    setMe(m);
    setBusinesses(b.businesses);
    setStatus("signedIn");
  }, []);

  useEffect(() => {
    const off = onSignedOut(() => {
      setMe(null);
      setBusinesses([]);
      setStatus("signedOut");
    });
    http
      .restore()
      .then((ok) => (ok ? load() : setStatus("signedOut")))
      .catch(() => setStatus("signedOut"));
    return () => {
      off();
    };
  }, [load]);

  const value = useMemo<Session>(
    () => ({
      status,
      me,
      businesses,
      async signIn(tokens) {
        http.setTokens(tokens);
        await load();
      },
      async signOut() {
        await api.logout();
      },
      refreshMe: load,
    }),
    [status, me, businesses, load],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession outside SessionProvider");
  return ctx;
}
