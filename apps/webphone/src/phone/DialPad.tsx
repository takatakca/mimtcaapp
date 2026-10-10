import { useI18n } from "../i18n/I18nProvider";
import { DIAL_KEYS, DIAL_LETTERS, type DialKey } from "../lib/dial";

/** 3×4 keypad. Buttons are real buttons (Tab + Enter/Space work); physical keys are handled by the parent input. */
export function DialPad({ onKey, compact = false }: { onKey: (key: DialKey) => void; compact?: boolean }) {
  const { t } = useI18n();
  return (
    <div className={`dialpad${compact ? " dialpad--compact" : ""}`} role="group" aria-label={t("phone.keypad")}>
      {DIAL_KEYS.map((k) => (
        <button key={k} type="button" className="dialpad__key" onClick={() => onKey(k)} aria-label={t("calls.key", { key: k })}>
          <span className="dialpad__digit">{k}</span>
          <span className="dialpad__letters" aria-hidden="true">
            {DIAL_LETTERS[k] || " "}
          </span>
        </button>
      ))}
    </div>
  );
}
