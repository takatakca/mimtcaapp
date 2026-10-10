// Extensions (postes): 3-4 digit numbers, never 9-1-1 or another N11 code (isValidExtension).
import { isValidExtension, type Extension, type ExtensionRequest } from "@mimt/shared";
import { useState, type FormEvent } from "react";
import { api } from "../../api/client";
import { toErrorKey } from "../../api/errors";
import { Icon } from "../../components/Icon";
import { Badge, Empty, ErrorNote, Field, Loading } from "../../components/ui";
import { useI18n } from "../../i18n/I18nProvider";
import type { TKey } from "../../i18n/core";
import { formatPhone } from "../../lib/dial";
import { normalizeExternal } from "../../lib/ivr";
import { useAsync } from "../../lib/useAsync";
import { useBusiness } from "./shared";

interface Draft {
  number: string;
  displayName: string;
  forwardToMobile: string;
  did: string;
  ringTimeoutS: number;
  voicemail: boolean;
}

const EMPTY: Draft = { number: "", displayName: "", forwardToMobile: "", did: "", ringTimeoutS: 20, voicemail: true };

function toDraft(e: Extension): Draft {
  return {
    number: e.number,
    displayName: e.displayName,
    forwardToMobile: e.forwardToMobile ? formatPhone(e.forwardToMobile) : "",
    did: e.did ? formatPhone(e.did) : "",
    ringTimeoutS: e.ringTimeoutS,
    voicemail: e.voicemail.enabled,
  };
}

type DraftErrors = Partial<Record<"number" | "displayName" | "forwardToMobile" | "did" | "ringTimeoutS", TKey>>;

/** Pure form check, mirrored by the API. */
export function validateExtensionDraft(d: Draft, taken: readonly string[]): DraftErrors {
  const errors: DraftErrors = {};
  if (!isValidExtension(d.number.trim())) errors.number = "biz.ext.invalidNumber";
  else if (taken.includes(d.number.trim())) errors.number = "error.duplicate";
  if (!d.displayName.trim()) errors.displayName = "validation.required";
  if (d.forwardToMobile.trim() && !normalizeExternal(d.forwardToMobile)) errors.forwardToMobile = "validation.externalNotNanp";
  if (d.did.trim() && !normalizeExternal(d.did)) errors.did = "validation.externalNotNanp";
  if (d.ringTimeoutS < 5 || d.ringTimeoutS > 120) errors.ringTimeoutS = "validation.ringTimeout";
  return errors;
}

export function Extensions() {
  const { t } = useI18n();
  const { id, canAdmin } = useBusiness();
  const list = useAsync(() => api.extensions(id), [id]);
  const [editing, setEditing] = useState<Extension | "new" | null>(null);

  const remove = async (e: Extension) => {
    if (!window.confirm(t("biz.ext.deleteConfirm", { number: e.number }))) return;
    try {
      await api.deleteExtension(id, e.id);
      list.setData((d) => d && { extensions: d.extensions.filter((x) => x.id !== e.id) });
    } catch (err) {
      window.alert(t(toErrorKey(err)));
    }
  };

  const extensions = list.data?.extensions ?? [];
  return (
    <section className="card" aria-labelledby="ext-h">
      <div className="card__head">
        <h2 id="ext-h" className="card__title">
          {t("biz.nav.extensions")}
        </h2>
        {canAdmin ? (
          <button type="button" className="btn btn--primary btn--sm" onClick={() => setEditing("new")}>
            <Icon name="plus" size={16} /> {t("biz.ext.add")}
          </button>
        ) : null}
      </div>
      <p className="muted small">{t("biz.ext.intro")}</p>
      <ErrorNote error={list.error} onRetry={list.reload} />
      {list.loading ? <Loading /> : null}
      {editing ? (
        <ExtensionForm
          key={editing === "new" ? "new" : editing.id}
          initial={editing === "new" ? null : editing}
          taken={extensions.filter((x) => editing === "new" || x.id !== editing.id).map((x) => x.number)}
          onCancel={() => setEditing(null)}
          onSaved={(saved) => {
            list.setData((d) => {
              const rest = (d?.extensions ?? []).filter((x) => x.id !== saved.id);
              return { extensions: [...rest, saved].sort((a, b) => a.number.localeCompare(b.number)) };
            });
            setEditing(null);
          }}
        />
      ) : null}
      {list.data && extensions.length === 0 ? <Empty>{t("biz.ext.empty")}</Empty> : null}
      {extensions.length > 0 ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t("biz.ext.number")}</th>
                <th scope="col">{t("biz.ext.name")}</th>
                <th scope="col">{t("biz.ext.did")}</th>
                <th scope="col">{t("biz.ext.forward")}</th>
                <th scope="col">{t("biz.ext.voicemail")}</th>
                <th scope="col">
                  <span className="sr-only">{t("common.actions")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {extensions.map((e) => (
                <tr key={e.id}>
                  <td>
                    <strong>{e.number}</strong>
                  </td>
                  <td>{e.displayName}</td>
                  <td>{e.did ? formatPhone(e.did) : "—"}</td>
                  <td>{e.forwardToMobile ? formatPhone(e.forwardToMobile) : "—"}</td>
                  <td>{e.voicemail.enabled ? <Badge tone="ok">{t("common.on")}</Badge> : <Badge tone="muted">{t("common.off")}</Badge>}</td>
                  <td className="table__actions">
                    {canAdmin ? (
                      <>
                        <button type="button" className="btn btn--ghost btn--sm" onClick={() => setEditing(e)}>
                          {t("common.edit")}
                        </button>
                        <button type="button" className="icon-btn" onClick={() => void remove(e)} aria-label={t("biz.ext.delete", { number: e.number })}>
                          <Icon name="trash" />
                        </button>
                      </>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

function ExtensionForm({
  initial,
  taken,
  onCancel,
  onSaved,
}: {
  initial: Extension | null;
  taken: string[];
  onCancel: () => void;
  onSaved: (e: Extension) => void;
}) {
  const { t } = useI18n();
  const { id } = useBusiness();
  const [d, setD] = useState<Draft>(initial ? toDraft(initial) : EMPTY);
  const [errors, setErrors] = useState<DraftErrors>({});
  const [error, setError] = useState<TKey | null>(null);
  const [busy, setBusy] = useState(false);
  const err = (k: keyof DraftErrors) => (errors[k] ? t(errors[k]!) : null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const found = validateExtensionDraft(d, taken);
    setErrors(found);
    if (Object.keys(found).length) return;
    const body: ExtensionRequest = {
      number: d.number.trim(),
      displayName: d.displayName.trim(),
      forwardToMobile: d.forwardToMobile.trim() ? normalizeExternal(d.forwardToMobile) : null,
      did: d.did.trim() ? normalizeExternal(d.did) : null,
      ringTimeoutS: d.ringTimeoutS,
      voicemail: { enabled: d.voicemail, greeting: initial?.voicemail.greeting ?? null },
    };
    setBusy(true);
    setError(null);
    try {
      onSaved(initial ? await api.updateExtension(id, initial.id, body) : await api.createExtension(id, body));
    } catch (er) {
      setError(toErrorKey(er));
      setBusy(false);
    }
  };

  return (
    <form className="editor" onSubmit={submit} noValidate aria-label={initial ? t("biz.ext.edit") : t("biz.ext.add")}>
      <div className="form-grid">
        <Field id="ext-number" label={t("biz.ext.number")} hint={t("biz.ext.numberHint")} error={err("number")}>
          <input id="ext-number" className="input" inputMode="numeric" maxLength={4} value={d.number} onChange={(e) => setD({ ...d, number: e.target.value.replace(/\D/g, "") })} />
        </Field>
        <Field id="ext-name" label={t("biz.ext.name")} error={err("displayName")}>
          <input id="ext-name" className="input" value={d.displayName} onChange={(e) => setD({ ...d, displayName: e.target.value })} />
        </Field>
        <Field id="ext-did" label={t("biz.ext.did")} hint={t("biz.ext.didHint")} error={err("did")}>
          <input id="ext-did" className="input" type="tel" value={d.did} onChange={(e) => setD({ ...d, did: e.target.value })} />
        </Field>
        <Field id="ext-fwd" label={t("biz.ext.forward")} hint={t("biz.ext.forwardHint")} error={err("forwardToMobile")}>
          <input id="ext-fwd" className="input" type="tel" value={d.forwardToMobile} onChange={(e) => setD({ ...d, forwardToMobile: e.target.value })} />
        </Field>
        <Field id="ext-timeout" label={t("biz.ext.ringTimeout")} error={err("ringTimeoutS")}>
          <input id="ext-timeout" className="input" type="number" min={5} max={120} value={d.ringTimeoutS} onChange={(e) => setD({ ...d, ringTimeoutS: Number(e.target.value) || 0 })} />
        </Field>
        <label className="check">
          <input type="checkbox" checked={d.voicemail} onChange={(e) => setD({ ...d, voicemail: e.target.checked })} />
          <span>{t("biz.ext.voicemailOn")}</span>
        </label>
      </div>
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
