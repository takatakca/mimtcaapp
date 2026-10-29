// Softphone context: one engine per signed-in session (Twilio WebRTC, or the demo engine with
// VITE_MOCK_API=1), the floating panel state, and dial() with the 9-1-1 rule applied.
import { normalizeHandle } from "@mimt/shared";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { api } from "../api/client";
import { useSession } from "../auth/SessionProvider";
import { env } from "../env";
import { useI18n } from "../i18n/I18nProvider";
import { callBlockReason, toDialable, type CallBlockReason } from "../lib/dial";
import { MockEngine } from "./mockEngine";
import { TwilioEngine } from "./twilioEngine";
import { INITIAL_SNAPSHOT, type PhoneEngine, type PhoneSnapshot } from "./types";

interface Phone {
  engine: PhoneEngine | null;
  state: PhoneSnapshot;
  panelOpen: boolean;
  setPanelOpen: (open: boolean) => void;
  /** Number shown on the dial pad (prefilled from recents, messages, contacts). */
  draft: string;
  setDraft: (value: string) => void;
  /** Places a call. Returns why it was refused, or null. 9-1-1 is never refused. */
  dial: (input: string) => CallBlockReason;
  /** Opens the panel with this number ready to call. */
  prepare: (number: string) => void;
}

const PhoneContext = createContext<Phone | null>(null);
const noopSubscribe = () => () => undefined;
const initial = () => INITIAL_SNAPSHOT;

export function PhoneProvider({ children }: { children: ReactNode }) {
  const { status, me } = useSession();
  const { t } = useI18n();
  const [engine, setEngine] = useState<PhoneEngine | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (status !== "signedIn") return;
    const e: PhoneEngine = env.mock
      ? new MockEngine()
      : new TwilioEngine({ getToken: async () => (await api.voiceToken()).token, closeProtection: t("phone.closeProtection"), edges: env.twilioEdges });
    setEngine(e);
    e.start().catch(() => undefined);
    if (env.mock) (window as unknown as { mimtDemo?: unknown }).mimtDemo = e;
    return () => {
      e.stop().catch(() => undefined);
      setEngine(null);
    };
    // The close-protection text is read once per session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const state = useSyncExternalStore(engine?.subscribe ?? noopSubscribe, engine?.getSnapshot ?? initial, initial);

  // Show an incoming call in the tab title (the toast handles the rest).
  useEffect(() => {
    if (state.status === "incoming") {
      const prev = document.title;
      document.title = `☎ ${t("call.incoming")} — MIMT`;
      return () => {
        document.title = prev;
      };
    }
    return undefined;
  }, [state.status, t]);

  const dial = useCallback(
    (input: string): CallBlockReason => {
      const reason = callBlockReason(input, me?.e911);
      if (reason) return reason;
      const to = input.trim().startsWith("@") ? normalizeHandle(input) : toDialable(input);
      if (!to || !engine) return "invalid";
      setPanelOpen(true);
      void engine.connect(to);
      return null;
    },
    [engine, me],
  );

  const prepare = useCallback((number: string) => {
    setDraft(number);
    setPanelOpen(true);
  }, []);

  const value = useMemo<Phone>(
    () => ({ engine, state, panelOpen, setPanelOpen, draft, setDraft, dial, prepare }),
    [engine, state, panelOpen, draft, dial, prepare],
  );
  return <PhoneContext.Provider value={value}>{children}</PhoneContext.Provider>;
}

export function usePhone(): Phone {
  const ctx = useContext(PhoneContext);
  if (!ctx) throw new Error("usePhone outside PhoneProvider");
  return ctx;
}
