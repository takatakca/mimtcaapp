// Ring groups (groupes d'appel): simultaneous or sequential, with an overflow target.
import { isValidExtension, type RingGroup, type RingGroupRequest, type RingStrategy, type RouteTarget } from "@mimt/shared";
import { useState, type FormEvent } from "react";
import { api } from "../../api/client";
import { toErrorKey } from "../../api/errors";
import { Icon } from "../../components/Icon";
import { Empty, ErrorNote, Field, Loading } from "../../components/ui";
import { useI18n } from "../../i18n/I18nProvider";
import type { TKey } from "../../i18n/core";
import { validateTarget } from "../../lib/ivr";
import { TargetPicker, targetContext, useBusiness, useDescribeTarget, useDirectory, useIssueText, type Directory } from "./shared";

const STRATEGY_KEY: Record<RingStrategy, TKey> = {
  simultaneous: "biz.rg.simultaneous",
  sequential: "biz.rg.sequential",
};

export function RingGroups() {
  const { t } = useI18n();
  const { id, canAdmin } = useBusiness();
  const dir = useDirectory(id);
  const describe = useDescribeTarget(dir.data);
  const [editing, setEditing] = useState<RingGroup | "new" | null>(null);

  const remove = async (g: RingGroup) => {
    if (!window.confirm(t("biz.rg.deleteConfirm", { name: g.name }))) return;
    try {
      await api.deleteRingGroup(id, g.id);
      dir.setData((d) => d && { ...d, ringGroups: d.ringGroups.filter((x) => x.id !== g.id) });
    } catch (err) {
      window.alert(t(toErrorKey(err)));
    }
  };

  const groups = dir.data?.ringGroups ?? [];
  const extName = (extId: string) => dir.data?.extensions.find((e) => e.id === extId)?.number ?? "?";
  return (
    <section className="card" aria-labelledby="rg-h">
      <div className="card__head">
        <h2 id="rg-h" className="card__title">
          {t("biz.nav.ringGroups")}
        </h2>
        {canAdmin ? (
          <button type="button" className="btn btn--primary btn--sm" onClick={() => setEditing("new")} disabled={!dir.data?.extensions.length}>
            <Icon name="plus" size={16} /> {t("biz.rg.add")}
          </button>
        ) : null}
      </div>
      <p className="muted small">{t("biz.rg.intro")}</p>
      <ErrorNote error={dir.error} onRetry={dir.reload} />
      {dir.loading ? <Loading /> : null}
      {dir.data && dir.data.extensions.length === 0 ? <p className="note note--info">{t("biz.rg.needExtensions")}</p> : null}
      {editing && dir.data ? (
        <RingGroupForm
          key={editing === "new" ? "new" : editing.id}
          initial={editing === "new" ? null : editing}
          dir={dir.data}
          onCancel={() => setEditing(null)}
          onSaved={(saved) => {
            dir.setData((d) => d && { ...d, ringGroups: [...d.ringGroups.filter((x) => x.id !== saved.id), saved] });
            setEditing(null);
          }}
        />
      ) : null}
      {dir.data && groups.length === 0 ? <Empty>{t("biz.rg.empty")}</Empty> : null}
      <ul className="list">
        {groups.map((g) => (
          <li key={g.id} className="list__row">
            <span className="list__main">
              <span className="list__title">
                {g.name}
                {g.number ? ` · ${g.number}` : ""}
              </span>
              <span className="list__sub">
                {t(STRATEGY_KEY[g.strategy])} · {t("biz.rg.membersCount", { count: g.memberExtensionIds.length })} ({g.memberExtensionIds.map(extName).join(", ")}) ·{" "}
                {t("biz.rg.timeoutShort", { seconds: g.timeoutS })}
              </span>
              <span className="list__sub">
                {t("biz.rg.overflow")} : {g.overflow ? describe(g.overflow) : t("biz.rg.overflowDefault")}
              </span>
            </span>
            {canAdmin ? (
              <span className="row">
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => setEditing(g)}>
                  {t("common.edit")}
                </button>
                <button type="button" className="icon-btn" onClick={() => void remove(g)} aria-label={t("biz.rg.delete", { name: g.name })}>
                  <Icon name="trash" />
                </button>
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function RingGroupForm({
  initial,
  dir,
  onCancel,
  onSaved,
}: {
  initial: RingGroup | null;
  dir: Directory;
  onCancel: () => void;
  onSaved: (g: RingGroup) => void;
}) {
  const { t } = useI18n();
  const { id } = useBusiness();
  const [name, setName] = useState(initial?.name ?? "");
  const [number, setNumber] = useState(initial?.number ?? "");
  const [strategy, setStrategy] = useState<RingStrategy>(initial?.strategy ?? "simultaneous");
  const [members, setMembers] = useState<string[]>(initial?.memberExtensionIds ?? []);
  const [timeoutS, setTimeoutS] = useState(initial?.timeoutS ?? 25);
  const [overflow, setOverflow] = useState<RouteTarget | null>(initial?.overflow ?? null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<TKey | null>(null);
  const [busy, setBusy] = useState(false);
  const issueText = useIssueText(overflow ? validateTarget(overflow, targetContext(dir), "overflow") : []);

  const toggle = (extId: string, on: boolean) => setMembers((m) => (on ? [...m.filter((x) => x !== extId), extId] : m.filter((x) => x !== extId)));
  const move = (index: number, delta: number) =>
    setMembers((m) => {
      const next = [...m];
      const [item] = next.splice(index, 1);
      next.splice(Math.max(0, Math.min(next.length, index + delta)), 0, item!);
      return next;
    });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const found: Record<string, string> = {};
    if (!name.trim()) found.name = t("validation.required");
    const taken = [...dir.extensions.map((x) => x.number), ...dir.ringGroups.filter((g) => g.id !== initial?.id).map((g) => g.number ?? "")];
    if (number.trim() && !isValidExtension(number.trim())) found.number = t("biz.ext.invalidNumber");
    else if (number.trim() && taken.includes(number.trim())) found.number = t("error.duplicate");
    if (members.length === 0) found.members = t("biz.rg.needMember");
    if (timeoutS < 5 || timeoutS > 300) found.timeoutS = t("validation.ringTimeout");
    const overflowIssue = issueText("overflow");
    if (overflowIssue) found.overflow = overflowIssue;
    setErrors(found);
    if (Object.keys(found).length) return;
    const body: RingGroupRequest = { name: name.trim(), number: number.trim() || null, strategy, memberExtensionIds: members, timeoutS, overflow };
    setBusy(true);
    setError(null);
    try {
      onSaved(initial ? await api.updateRingGroup(id, initial.id, body) : await api.createRingGroup(id, body));
    } catch (er) {
      setError(toErrorKey(er));
      setBusy(false);
    }
  };

  const byId = new Map(dir.extensions.map((x) => [x.id, x]));
  return (
    <form className="editor" onSubmit={submit} noValidate aria-label={initial ? t("biz.rg.edit") : t("biz.rg.add")}>
      <div className="form-grid">
        <Field id="rg-name" label={t("biz.rg.name")} error={errors.name}>
          <input id="rg-name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field id="rg-number" label={t("biz.rg.number")} hint={t("biz.rg.numberHint")} error={errors.number}>
          <input id="rg-number" className="input" inputMode="numeric" maxLength={4} value={number} onChange={(e) => setNumber(e.target.value.replace(/\D/g, ""))} />
        </Field>
        <Field id="rg-strategy" label={t("biz.rg.strategy")}>
          <select id="rg-strategy" className="input" value={strategy} onChange={(e) => setStrategy(e.target.value as RingStrategy)}>
            {(Object.keys(STRATEGY_KEY) as RingStrategy[]).map((s) => (
              <option key={s} value={s}>
                {t(STRATEGY_KEY[s])}
              </option>
            ))}
          </select>
        </Field>
        <Field id="rg-timeout" label={strategy === "sequential" ? t("biz.rg.timeoutEach") : t("biz.rg.timeoutTotal")} error={errors.timeoutS}>
          <input id="rg-timeout" className="input" type="number" min={5} max={300} value={timeoutS} onChange={(e) => setTimeoutS(Number(e.target.value) || 0)} />
        </Field>
      </div>
      <fieldset className="fieldset">
        <legend>{t("biz.rg.members")}</legend>
        <div className="checks">
          {dir.extensions.map((x) => (
            <label key={x.id} className="check">
              <input type="checkbox" checked={members.includes(x.id)} onChange={(e) => toggle(x.id, e.target.checked)} />
              <span>
                {x.number} · {x.displayName}
              </span>
            </label>
          ))}
        </div>
        {strategy === "sequential" && members.length > 1 ? (
          <ol className="order-list" aria-label={t("biz.rg.order")}>
            {members.map((m, i) => (
              <li key={m}>
                <span>
                  {byId.get(m)?.number} · {byId.get(m)?.displayName}
                </span>
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label={t("biz.rg.moveUp")}>
                  ↑
                </button>
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => move(i, 1)} disabled={i === members.length - 1} aria-label={t("biz.rg.moveDown")}>
                  ↓
                </button>
              </li>
            ))}
          </ol>
        ) : null}
        {errors.members ? (
          <p className="field__error" role="alert">
            {errors.members}
          </p>
        ) : null}
      </fieldset>
      <TargetPicker
        id="rg-overflow"
        label={t("biz.rg.overflow")}
        value={overflow}
        onChange={setOverflow}
        dir={dir}
        types={["extension", "ring_group", "ivr", "voicemail", "external", "ai_receptionist", "hangup"]}
        allowNone
        error={errors.overflow}
      />
      <p className="field__hint">{t("biz.rg.overflowHint")}</p>
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
