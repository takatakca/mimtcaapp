// AI receptionist (MIMT Affaires): GET/PUT /v1/business/:id/ai-receptionist (docs/MIMT-AI.md §4).
// Admins edit the settings; only the owner accepts the terms (AI disclosure, callers' speech sent to
// the AI provider). It cannot be turned on before the current terms version is accepted.
import { AI_RECEPTIONIST_TERMS_VERSION, type AiReceptionistConfigDto, type AiTransferTarget } from "@mimt/shared";
import { useEffect, useState, type FormEvent } from "react";
import { api } from "../../api/client";
import { Icon } from "../../components/Icon";
import { Badge, ErrorNote, Field, Loading } from "../../components/ui";
import { useI18n } from "../../i18n/I18nProvider";
import type { TKey } from "../../i18n/core";
import { aiErrorKey } from "../../lib/aiErrors";
import { formatDateTime } from "../../lib/format";
import { normalizeExternal } from "../../lib/ivr";
import { useAsync } from "../../lib/useAsync";
import { useBusiness, useDirectory } from "./shared";

const KEY_RE = /^[a-z0-9_-]{1,32}$/;
const TERMS: TKey[] = ["ai.rec.terms.p1", "ai.rec.terms.p2", "ai.rec.terms.p3", "ai.rec.terms.p4"];

interface TargetRow {
  key: string;
  label: string;
  kind: "number" | "extension";
  number: string;
  extension: string;
}

interface Form {
  businessName: string;
  greeting: string;
  hoursText: string;
  address: string;
  faqMarkdown: string;
  english: boolean;
  targets: TargetRow[];
}

function toForm(c: AiReceptionistConfigDto): Form {
  return {
    businessName: c.businessName,
    greeting: c.greeting ?? "",
    hoursText: c.hoursText,
    address: c.address ?? "",
    faqMarkdown: c.faqMarkdown,
    english: c.languages.some((l) => l.startsWith("en")),
    targets: c.transferTargets.map((x) => ({
      key: x.key,
      label: x.label,
      kind: x.extension ? "extension" : "number",
      number: x.number ?? "",
      extension: x.extension ?? "",
    })),
  };
}

/** Field-level problems (key → message key), checked before the PUT; the API checks the same rules. */
export function validateReceptionist(f: Form): Record<string, TKey> {
  const out: Record<string, TKey> = {};
  if (!f.businessName.trim()) out.businessName = "validation.required";
  const seen = new Set<string>();
  f.targets.forEach((x, i) => {
    if (!KEY_RE.test(x.key)) out[`key-${i}`] = "ai.rec.target.keyInvalid";
    else if (seen.has(x.key)) out[`key-${i}`] = "ai.rec.target.keyDuplicate";
    seen.add(x.key);
    if (!x.label.trim()) out[`label-${i}`] = "validation.required";
    if (x.kind === "number" && !normalizeExternal(x.number)) out[`number-${i}`] = "validation.externalNotNanp";
    if (x.kind === "extension" && !x.extension) out[`extension-${i}`] = "validation.required";
  });
  return out;
}

export function AiReceptionist() {
  const { t, locale } = useI18n();
  const { id, biz, canAdmin } = useBusiness();
  const isOwner = biz.role === "owner";
  const cfg = useAsync(() => api.aiReceptionist(id), [id]);
  const dir = useDirectory(id);
  const [form, setForm] = useState<Form | null>(null);
  const [issues, setIssues] = useState<Record<string, TKey>>({});
  const [error, setError] = useState<TKey | null>(null);
  const [saved, setSaved] = useState<TKey | null>(null);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (cfg.data) setForm(toForm(cfg.data));
  }, [cfg.data]);

  const c = cfg.data;
  const accepted = Boolean(c?.acceptedAt && c.acceptedVersion === AI_RECEPTIONIST_TERMS_VERSION);

  const put = async (body: Parameters<typeof api.putAiReceptionist>[1], ok: TKey) => {
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const next = await api.putAiReceptionist(id, body);
      cfg.setData(() => next);
      setSaved(ok);
    } catch (e) {
      setError(aiErrorKey(e));
    } finally {
      setBusy(false);
    }
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!form) return;
    const found = validateReceptionist(form);
    setIssues(found);
    if (Object.keys(found).length) return;
    const transferTargets: AiTransferTarget[] = form.targets.map((x) =>
      x.kind === "number"
        ? { key: x.key, label: x.label.trim(), number: normalizeExternal(x.number)! }
        : { key: x.key, label: x.label.trim(), extension: x.extension },
    );
    await put(
      {
        businessName: form.businessName.trim(),
        greeting: form.greeting.trim() || null,
        hoursText: form.hoursText,
        address: form.address.trim() || null,
        faqMarkdown: form.faqMarkdown,
        // French first, always (Charter of the French language); English is offered second.
        languages: form.english ? ["fr-CA", "en-CA"] : ["fr-CA"],
        transferTargets,
      },
      "ai.rec.saved",
    );
  };

  if (cfg.loading && !c) return <Loading />;
  if (!c || !form) {
    return (
      <section className="card">
        <h2 className="card__title">{t("biz.nav.ai")}</h2>
        <ErrorNote error={cfg.error ? (cfg.error === "error.notConfigured" ? "ai.error.notConfigured" : cfg.error) : null} onRetry={cfg.reload} />
      </section>
    );
  }

  const set = (patch: Partial<Form>) => setForm({ ...form, ...patch });
  const setTarget = (i: number, patch: Partial<TargetRow>) => set({ targets: form.targets.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  const pbxTargets = [
    ...(dir.data?.extensions.map((e) => ({ id: e.id, label: `${t("target.extension")} ${e.number} · ${e.displayName}` })) ?? []),
    ...(dir.data?.ringGroups.map((g) => ({ id: g.id, label: `${t("target.ringGroup")} · ${g.name}` })) ?? []),
  ];
  const ro = !canAdmin;

  return (
    <div className="stack">
      <section className="card" aria-labelledby="air-h">
        <h2 id="air-h" className="card__title">
          {t("biz.nav.ai")}{" "}
          {c.enabled ? <Badge tone="ok">{t("common.on")}</Badge> : <Badge tone="muted">{t("common.off")}</Badge>}
        </h2>
        <p className="muted small">{t("ai.rec.intro")}</p>
        <p className="note note--info">{t("ai.rec.e911")}</p>
        <label className="switch-row">
          <span>
            <span className="switch-row__label">{t("ai.rec.enabled")}</span>
            <span className="field__hint">{accepted ? t("ai.rec.enabledHint") : t("ai.rec.needsTerms")}</span>
          </span>
          <input
            type="checkbox"
            role="switch"
            className="switch"
            checked={c.enabled}
            disabled={ro || busy || (!accepted && !c.enabled)}
            onChange={(e) => void put({ enabled: e.target.checked }, e.target.checked ? "ai.rec.turnedOn" : "ai.rec.turnedOff")}
          />
        </label>
      </section>

      <section className="card" aria-labelledby="air-terms-h">
        <h2 id="air-terms-h" className="card__title">
          {t("ai.rec.terms.title")}{" "}
          {accepted ? <Badge tone="ok">{t("ai.rec.terms.accepted")}</Badge> : <Badge tone="warn">{t("ai.rec.terms.pending")}</Badge>}
        </h2>
        <div className="summary" tabIndex={0} aria-label={t("ai.rec.terms.title")}>
          {TERMS.map((k) => (
            <p key={k}>{t(k)}</p>
          ))}
          <p className="muted small">{t("ai.rec.terms.version", { version: AI_RECEPTIONIST_TERMS_VERSION })}</p>
        </div>
        {accepted && c.acceptedAt ? (
          <p className="muted small">{t("ai.rec.terms.acceptedOn", { date: formatDateTime(c.acceptedAt, locale) })}</p>
        ) : isOwner ? (
          <>
            <label className="check">
              <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
              <span>{t("ai.rec.terms.agree")}</span>
            </label>
            <button type="button" className="btn btn--primary btn--sm" disabled={!agree || busy} onClick={() => void put({ accept: true }, "ai.rec.terms.done")}>
              {t("ai.rec.terms.accept")}
            </button>
          </>
        ) : (
          <p className="note note--warn">{t("ai.rec.terms.ownerOnly")}</p>
        )}
      </section>

      <form className="card stack" onSubmit={save} noValidate aria-labelledby="air-set-h">
        <h2 id="air-set-h" className="card__title">
          {t("ai.rec.settings")}
        </h2>
        <fieldset className="fieldset" disabled={ro}>
          <div className="form-grid">
            <Field id="air-name" label={t("ai.rec.businessName")} error={issues.businessName ? t(issues.businessName) : null}>
              <input id="air-name" className="input" maxLength={120} value={form.businessName} onChange={(e) => set({ businessName: e.target.value })} />
            </Field>
            <Field id="air-address" label={t("ai.rec.address")}>
              <input id="air-address" className="input" maxLength={300} value={form.address} onChange={(e) => set({ address: e.target.value })} />
            </Field>
          </div>
          <Field id="air-greeting" label={t("ai.rec.greeting")} hint={t("ai.rec.greetingHint")}>
            <input id="air-greeting" className="input" maxLength={300} value={form.greeting} onChange={(e) => set({ greeting: e.target.value })} />
          </Field>
          <Field id="air-hours" label={t("ai.rec.hours")}>
            <textarea id="air-hours" className="input" rows={2} maxLength={1000} value={form.hoursText} onChange={(e) => set({ hoursText: e.target.value })} />
          </Field>
          <Field id="air-faq" label={t("ai.rec.faq")} hint={t("ai.rec.faqHint")}>
            <textarea id="air-faq" className="input" rows={6} maxLength={8000} value={form.faqMarkdown} onChange={(e) => set({ faqMarkdown: e.target.value })} />
          </Field>
          <div className="checks">
            <label className="check">
              <input type="checkbox" checked disabled />
              <span>{t("ai.rec.lang.fr")}</span>
            </label>
            <label className="check">
              <input type="checkbox" checked={form.english} onChange={(e) => set({ english: e.target.checked })} />
              <span>{t("ai.rec.lang.en")}</span>
            </label>
          </div>
        </fieldset>

        <fieldset className="fieldset" disabled={ro}>
          <legend>{t("ai.rec.targets")}</legend>
          <p className="field__hint">{t("ai.rec.targetsHint")}</p>
          {form.targets.map((x, i) => (
            <div key={i} className="form-grid">
              <Field id={`air-key-${i}`} label={t("ai.rec.target.key")} error={issues[`key-${i}`] ? t(issues[`key-${i}`]!) : null}>
                <input id={`air-key-${i}`} className="input" value={x.key} onChange={(e) => setTarget(i, { key: e.target.value.trim().toLowerCase() })} />
              </Field>
              <Field id={`air-label-${i}`} label={t("ai.rec.target.label")} error={issues[`label-${i}`] ? t(issues[`label-${i}`]!) : null}>
                <input id={`air-label-${i}`} className="input" maxLength={80} value={x.label} onChange={(e) => setTarget(i, { label: e.target.value })} />
              </Field>
              <Field id={`air-kind-${i}`} label={t("ai.rec.target.kind")}>
                <select id={`air-kind-${i}`} className="input" value={x.kind} onChange={(e) => setTarget(i, { kind: e.target.value as TargetRow["kind"] })}>
                  <option value="extension">{t("ai.rec.target.pbx")}</option>
                  <option value="number">{t("target.external")}</option>
                </select>
              </Field>
              {x.kind === "number" ? (
                <Field id={`air-num-${i}`} label={t("ai.rec.target.number")} error={issues[`number-${i}`] ? t(issues[`number-${i}`]!) : null}>
                  <input id={`air-num-${i}`} className="input" type="tel" value={x.number} onChange={(e) => setTarget(i, { number: e.target.value })} />
                </Field>
              ) : (
                <Field id={`air-ext-${i}`} label={t("ai.rec.target.pbx")} error={issues[`extension-${i}`] ? t(issues[`extension-${i}`]!) : null}>
                  <select id={`air-ext-${i}`} className="input" value={x.extension} onChange={(e) => setTarget(i, { extension: e.target.value })}>
                    <option value="">—</option>
                    {pbxTargets.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              <div className="form-grid__actions">
                <button type="button" className="icon-btn" onClick={() => set({ targets: form.targets.filter((_, j) => j !== i) })} aria-label={t("ai.rec.target.remove", { key: x.key || String(i + 1) })}>
                  <Icon name="trash" />
                </button>
              </div>
            </div>
          ))}
          {form.targets.length < 10 ? (
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => set({ targets: [...form.targets, { key: "", label: "", kind: "extension", number: "", extension: "" }] })}>
              <Icon name="plus" size={16} /> {t("ai.rec.target.add")}
            </button>
          ) : null}
        </fieldset>
        {canAdmin ? (
          <div className="row">
            <button type="submit" className="btn btn--primary" disabled={busy}>
              {t("common.save")}
            </button>
          </div>
        ) : null}
      </form>
      <ErrorNote error={error} />
      {saved ? (
        <p className="ok-text" role="status">
          {t(saved)}
        </p>
      ) : null}
    </div>
  );
}
