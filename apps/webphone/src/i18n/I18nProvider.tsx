import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { setApiLocale } from "../api/client";
import { localeTag, pickLanguage, translate, type Lang, type TKey, type Vars } from "./core";

const STORAGE_KEY = "mimt.lang";

interface I18n {
  lang: Lang;
  locale: "fr-CA" | "en-CA";
  t: (key: TKey, vars?: Vars) => string;
  setLang: (lang: Lang) => void;
}

const I18nContext = createContext<I18n | null>(null);

function initialLang(): Lang {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(STORAGE_KEY);
  } catch {
    // Storage blocked: fall back to the browser language.
  }
  return pickLanguage(typeof navigator === "undefined" ? [] : navigator.languages ?? [navigator.language], saved);
}

export function I18nProvider({ children, initial }: { children: ReactNode; initial?: Lang }) {
  const [lang, setLangState] = useState<Lang>(() => initial ?? initialLang());
  useEffect(() => {
    document.documentElement.lang = localeTag(lang);
    setApiLocale(localeTag(lang));
  }, [lang]);
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      // Ignore: the choice just won't survive a reload.
    }
  }, []);
  const value = useMemo<I18n>(
    () => ({ lang, locale: localeTag(lang), t: (key, vars) => translate(lang, key, vars), setLang }),
    [lang, setLang],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n outside I18nProvider");
  return ctx;
}
