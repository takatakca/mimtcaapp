// Automated attendant (réceptionniste automatique): bilingual greeting, French first, and key options.
import type { IvrMenu, IvrMenuRequest, IvrOption, RouteTarget } from "@mimt/shared";
import { useState, type FormEvent } from "react";
import { api } from "../../api/client";
import { toErrorKey } from "../../api/errors";
import { Icon } from "../../components/Icon";
import { Empty, ErrorNote, Field, Loading } from "../../components/ui";
import { useI18n } from "../../i18n/I18nProvider";
import type { TKey } from "../../i18n/core";
import { IVR_DIGITS, validateIvrMenu } from "../../lib/ivr";
import { TargetPicker, targetContext, useBusiness, useDescribeTarget, useDirectory, useIssueText, type Directory } from "./shared";

const DEFAULT_GREETING = {
  fr: "Bonjour et merci d'avoir appelé. Pour les ventes, faites le 1. Pour le soutien, faites le 2.",
  en: "Hello and thank you for calling. For sales, press 1. For support, press 2.",
};

export function IvrMenus() {
  const { t } = useI18n();
  const { id, canAdmin } = useBusiness();
  const dir = useDirectory(id);
  const describe = useDescribeTarget(dir.data);
  const [editing, setEditing] = useState<IvrMenu | "new" | null>(null);

  const remove = async (m: IvrMenu) => {
    if (!window.confirm(t("biz.ivr.deleteConfirm", { name: m.name }))) return;
    try {
      await api.deleteIvrMenu(id, m.id);
      dir.setData((d) => d && { ...d, menus: d.menus.filter((x) => x.id !== m.id) });
    } catch (err) {
      window.alert(t(toErrorKey(err)));
    }
  };

  const menus = dir.data?.menus ?? [];
  return (
    <section className="card" aria-labelledby="ivr-h">
      <div className="card__head">
        <h2 id="ivr-h" className="card__title">
          {t("biz.nav.ivr")}
        </h2>
        {canAdmin ? (
          <button type="button" className="btn btn--primary btn--sm" onClick={() => setEditing("new")}>
            <Icon name="plus" size={16} /> {t("biz.ivr.add")}
          </button>
        ) : null}
      </div>
      <p className="muted small">{t("biz.ivr.intro")}</p>
      <ErrorNote error={dir.error} onRetry={dir.reload} />
      {dir.loading ? <Loading /> : null}
      {editing && dir.data ? (
        <IvrForm
          key={editing === "new" ? "new" : editing.id}
          initial={editing === "new" ? null : editing}
          dir={dir.data}
          onCancel={() => setEditing(null)}
          onSaved={(saved) => {
            dir.setData((d) => d && { ...d, menus: [...d.menus.filter((x) => x.id !== saved.id), saved] });
            setEditing(null);
          }}
        />
      ) : null}
      {dir.data && menus.length === 0 ? <Empty>{t("biz.ivr.empty")}</Empty> : null}
      <ul className="stack">
        {menus.map((m) => (
          <li key={m.id} className="ivr-card">
            <div className="card__head">
              <h3 className="ivr-card__name">{m.name}</h3>
              {canAdmin ? (
                <span className="row">
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => setEditing(m)}>
                    {t("common.edit")}
                  </button>
                  <button type="button" className="icon-btn" onClick={() => void remove(m)} aria-label={t("biz.ivr.delete", { name: m.name })}>
                    <Icon name="trash" />
                  </button>
                </span>
              ) : null}
            </div>
            <p className="muted small" lang="fr-CA">
              « {m.greeting.fr} »
            </p>
            <ul className="keys">
              {m.options.map((o) => (
                <li key={o.digit}>
                  <span className="keys__digit">{o.digit}</span> {describe(o.target)}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}

function IvrForm({ initial, dir, onCancel, onSaved }: { initial: IvrMenu | null; dir: Directory; onCancel: () => void; onSaved: (m: IvrMenu) => void }) {
  const { t } = useI18n();
  const { id } = useBusiness();
  const [menu, setMenu] = useState<IvrMenuRequest>(() =>
    initial
      ? {
          name: initial.name,
          greeting: initial.greeting,
          greetingRecordingUrl: initial.greetingRecordingUrl,
          options: initial.options,
          timeoutS: initial.timeoutS,
          maxRetries: initial.maxRetries,
          timeoutTarget: initial.timeoutTarget,
          invalidTarget: initial.invalidTarget,
        }
      : { name: "", greeting: DEFAULT_GREETING, options: [], timeoutS: 6, maxRetries: 2, timeoutTarget: null, invalidTarget: null },
  );
  const [showIssues, setShowIssues] = useState(false);
  const [error, setError] = useState<TKey | null>(null);
  const [busy, setBusy] = useState(false);
  const issues = validateIvrMenu(menu, targetContext(dir, initial?.id ?? null));
  const issue = useIssueText(showIssues ? issues : []);

  const setOption = (i: number, patch: Partial<IvrOption>) =>
    setMenu((m) => ({ ...m, options: m.options.map((o, j) => (j === i ? { ...o, ...patch } : o)) }));
  const addOption = () => {
    const used = new Set(menu.options.map((o) => o.digit));
    const digit = IVR_DIGITS.find((d) => !used.has(d)) ?? "1";
    const first: RouteTarget = dir.extensions[0] ? { type: "extension", extensionId: dir.extensions[0].id } : { type: "voicemail" };
    setMenu((m) => ({ ...m, options: [...m.options, { digit, target: first }] }));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setShowIssues(true);
    if (issues.length) return;
    setBusy(true);
    setError(null);
    const body: IvrMenuRequest = { ...menu, name: menu.name.trim(), greeting: { fr: menu.greeting.fr.trim(), en: menu.greeting.en.trim() } };
    try {
      onSaved(initial ? await api.updateIvrMenu(id, initial.id, body) : await api.createIvrMenu(id, body));
    } catch (er) {
      setError(toErrorKey(er));
      setBusy(false);
    }
  };

  return (
    <form className="editor" onSubmit={submit} noValidate aria-label={initial ? t("biz.ivr.edit") : t("biz.ivr.add")}>
      <Field id="ivr-name" label={t("biz.ivr.name")} error={issue("name")}>
        <input id="ivr-name" className="input" value={menu.name} onChange={(e) => setMenu({ ...menu, name: e.target.value })} />
      </Field>
      <div className="form-grid">
        <Field id="ivr-fr" label={t("biz.ivr.greetingFr")} error={issue("greeting.fr")}>
          <textarea id="ivr-fr" className="input" rows={3} lang="fr-CA" value={menu.greeting.fr} onChange={(e) => setMenu({ ...menu, greeting: { ...menu.greeting, fr: e.target.value } })} />
        </Field>
        <Field id="ivr-en" label={t("biz.ivr.greetingEn")} hint={t("biz.ivr.greetingEnHint")}>
          <textarea id="ivr-en" className="input" rows={3} lang="en-CA" value={menu.greeting.en} onChange={(e) => setMenu({ ...menu, greeting: { ...menu.greeting, en: e.target.value } })} />
        </Field>
      </div>
      <fieldset className="fieldset">
        <legend>{t("biz.ivr.options")}</legend>
        {issue("options") ? (
          <p className="field__error" role="alert">
            {issue("options")}
          </p>
        ) : null}
        {menu.options.map((o, i) => (
          <div key={i} className="ivr-option">
            <Field id={`ivr-digit-${i}`} label={t("biz.ivr.digit")} error={issue(`options.${i}.digit`)}>
              <select id={`ivr-digit-${i}`} className="input input--narrow" value={o.digit} onChange={(e) => setOption(i, { digit: e.target.value })}>
                {IVR_DIGITS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </Field>
            <TargetPicker
              id={`ivr-target-${i}`}
              label={t("biz.ivr.goesTo")}
              value={o.target}
              onChange={(target) => target && setOption(i, { target })}
              dir={dir}
              error={issue(`options.${i}.target`)}
            />
            <button
              type="button"
              className="icon-btn"
              onClick={() => setMenu((m) => ({ ...m, options: m.options.filter((_, j) => j !== i) }))}
              aria-label={t("biz.ivr.removeOption", { digit: o.digit })}
            >
              <Icon name="trash" />
            </button>
          </div>
        ))}
        <button type="button" className="btn btn--ghost btn--sm" onClick={addOption} disabled={menu.options.length >= IVR_DIGITS.length}>
          <Icon name="plus" size={16} /> {t("biz.ivr.addOption")}
        </button>
      </fieldset>
      <div className="form-grid">
        <Field id="ivr-timeout" label={t("biz.ivr.timeout")} error={issue("timeoutS")}>
          <input id="ivr-timeout" className="input" type="number" min={3} max={30} value={menu.timeoutS ?? 6} onChange={(e) => setMenu({ ...menu, timeoutS: Number(e.target.value) })} />
        </Field>
        <Field id="ivr-retries" label={t("biz.ivr.retries")} error={issue("maxRetries")}>
          <input id="ivr-retries" className="input" type="number" min={0} max={5} value={menu.maxRetries ?? 2} onChange={(e) => setMenu({ ...menu, maxRetries: Number(e.target.value) })} />
        </Field>
      </div>
      <TargetPicker
        id="ivr-timeout-target"
        label={t("biz.ivr.timeoutTarget")}
        value={menu.timeoutTarget ?? null}
        onChange={(timeoutTarget) => setMenu({ ...menu, timeoutTarget })}
        dir={dir}
        allowNone
        error={issue("timeoutTarget")}
      />
      <p className="field__hint">{t("biz.ivr.timeoutTargetHint")}</p>
      <p className="note note--info">{t("biz.ivr.e911Note")}</p>
      <ErrorNote error={error} />
      <div className="row">
        <button type="submit" className="btn btn--primary" disabled={busy}>
          {t("common.save")}
        </button>
        <button type="button" className="btn btn--ghost" onClick={onCancel}>
          {t("common.cancel")}
        </button>
      </div>
    </form>
  );
}
