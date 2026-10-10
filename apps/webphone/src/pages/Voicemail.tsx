import type { Urgency, VoicemailDto } from "@mimt/shared";
import { useState } from "react";
import { api } from "../api/client";
import { AiErrorNote } from "../components/AiErrorNote";
import { Icon } from "../components/Icon";
import { Badge, Empty, ErrorNote, Loading, PageHeader } from "../components/ui";
import { useI18n } from "../i18n/I18nProvider";
import type { TKey } from "../i18n/core";
import { aiErrorKey } from "../lib/aiErrors";
import { formatPhone } from "../lib/dial";
import { formatDuration, formatWhen } from "../lib/format";
import { useAsync } from "../lib/useAsync";
import { usePhone } from "../phone/PhoneProvider";

const URGENCY: Record<Urgency, { key: TKey; tone: "error" | "warn" | "muted" }> = {
  high: { key: "voicemail.urgencyHigh", tone: "error" },
  normal: { key: "voicemail.urgencyNormal", tone: "muted" },
  low: { key: "voicemail.urgencyLow", tone: "muted" },
};

export function Voicemail() {
  const { t, locale } = useI18n();
  const { prepare } = usePhone();
  const vms = useAsync(() => api.voicemails(), []);
  const [summarizing, setSummarizing] = useState<string | null>(null);
  const [aiErrors, setAiErrors] = useState<Record<string, TKey>>({});

  /** POST /v1/voicemails/:id/summary: sends the transcript to the AI provider (needs consent). */
  const summarize = async (vm: VoicemailDto) => {
    setSummarizing(vm.id);
    setAiErrors(({ [vm.id]: _gone, ...rest }) => rest);
    try {
      const updated = await api.summarizeVoicemail(vm.id);
      vms.setData((d) => d && { voicemails: d.voicemails.map((v) => (v.id === vm.id ? updated : v)) });
    } catch (e) {
      setAiErrors((errs) => ({ ...errs, [vm.id]: aiErrorKey(e) }));
    } finally {
      setSummarizing(null);
    }
  };

  const remove = async (vm: VoicemailDto) => {
    if (!window.confirm(t("voicemail.deleteConfirm"))) return;
    await api.deleteVoicemail(vm.id).catch(() => undefined);
    vms.setData((d) => d && { voicemails: d.voicemails.filter((v) => v.id !== vm.id) });
  };

  return (
    <div className="page">
      <PageHeader title={t("voicemail.title")} />
      <ErrorNote error={vms.error} onRetry={vms.reload} />
      {vms.loading ? <Loading /> : null}
      {vms.data && vms.data.voicemails.length === 0 ? <Empty>{t("voicemail.empty")}</Empty> : null}
      <ul className="stack">
        {vms.data?.voicemails.map((vm) => {
          const urgency = vm.ai ? URGENCY[vm.ai.urgency] : null;
          return (
            <li key={vm.id} className={`card vm${vm.listened ? "" : " vm--new"}`}>
              <div className="vm__head">
                <div>
                  <p className="vm__from">
                    {vm.from ? formatPhone(vm.from) : t("voicemail.unknownCaller")}
                    {!vm.listened ? <Badge tone="info">{t("voicemail.new")}</Badge> : null}
                  </p>
                  <p className="muted small">
                    {formatWhen(vm.createdAt, locale, t("common.yesterday"))}
                    {vm.durationS ? ` · ${formatDuration(vm.durationS)}` : ""}
                  </p>
                </div>
                <div className="row">
                  {vm.from ? (
                    <button type="button" className="icon-btn" onClick={() => prepare(vm.from!)} aria-label={t("voicemail.callBack")}>
                      <Icon name="phone" />
                    </button>
                  ) : null}
                  <button type="button" className="icon-btn" onClick={() => void remove(vm)} aria-label={t("common.delete")}>
                    <Icon name="trash" />
                  </button>
                </div>
              </div>
              {vm.ai ? (
                <div className="vm__ai">
                  <p className="vm__ai-label">
                    <Icon name="sparkle" size={14} /> {t("voicemail.aiSummary")}
                    {urgency ? <Badge tone={urgency.tone}>{t(urgency.key)}</Badge> : null}
                    {vm.ai.callbackSuggested ? <Badge tone="info">{t("voicemail.callbackSuggested")}</Badge> : null}
                    {vm.ai.spamLikelihood >= 0.7 ? <span title={t("ai.spam.hint")}><Badge tone="warn">{t("spam.call")}</Badge></span> : null}
                  </p>
                  <p>{vm.ai.summary}</p>
                  {vm.ai.callerIntent ? <p className="muted small">{t("voicemail.intent", { intent: vm.ai.callerIntent })}</p> : null}
                </div>
              ) : vm.transcript ? (
                <div className="row row--wrap">
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => void summarize(vm)}
                    disabled={summarizing === vm.id}
                    aria-label={t("ai.vm.summarizeLabel")}
                  >
                    <Icon name="sparkle" size={14} /> {summarizing === vm.id ? t("ai.vm.summarizing") : t("ai.vm.summarize")}
                  </button>
                </div>
              ) : null}
              <AiErrorNote error={aiErrors[vm.id]} />
              {vm.audioUrl ? (
                <audio className="vm__audio" controls preload="none" src={vm.audioUrl} aria-label={t("voicemail.play")} />
              ) : (
                <p className="muted small">{t("voicemail.noAudio")}</p>
              )}
              <details className="vm__transcript">
                <summary>{t("voicemail.transcript")}</summary>
                <p>{vm.transcript ?? t("voicemail.noTranscript")}</p>
              </details>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
