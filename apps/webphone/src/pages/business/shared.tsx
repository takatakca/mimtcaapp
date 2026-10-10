// Shared pieces of the MIMT Affaires admin portal: the business context from the layout, the PBX
// directory (extensions, ring groups, IVR menus) and the call-routing target picker.
import type { BusinessResponse, Extension, IvrMenu, RingGroup, RouteTarget, RouteTargetType } from "@mimt/shared";
import { useState } from "react";
import { useOutletContext } from "react-router";
import { api } from "../../api/client";
import { useI18n } from "../../i18n/I18nProvider";
import type { TKey } from "../../i18n/core";
import { formatPhone } from "../../lib/dial";
import { normalizeExternal, type TargetContext, type ValidationCode, type ValidationIssue } from "../../lib/ivr";
import { useAsync } from "../../lib/useAsync";

export interface BusinessCtx {
  id: string;
  biz: BusinessResponse;
  /** Owners and admins edit; members only read. The API enforces the same rule. */
  canAdmin: boolean;
}

export function useBusiness(): BusinessCtx {
  return useOutletContext<BusinessCtx>();
}

export interface Directory {
  extensions: Extension[];
  ringGroups: RingGroup[];
  menus: IvrMenu[];
}

export function useDirectory(id: string) {
  return useAsync<Directory>(
    () =>
      Promise.all([api.extensions(id), api.ringGroups(id), api.ivrMenus(id)]).then(([e, r, m]) => ({
        extensions: e.extensions,
        ringGroups: r.ringGroups,
        menus: m.menus,
      })),
    [id],
  );
}

export function targetContext(dir: Directory | undefined, selfIvrId?: string | null): TargetContext {
  return {
    extensionIds: dir?.extensions.map((e) => e.id) ?? [],
    ringGroupIds: dir?.ringGroups.map((r) => r.id) ?? [],
    ivrMenuIds: dir?.menus.map((m) => m.id) ?? [],
    selfIvrId,
  };
}

export const VALIDATION_KEY: Record<ValidationCode, TKey> = {
  required: "validation.required",
  greeting_fr_required: "validation.greetingFr",
  no_options: "validation.noOptions",
  invalid_digit: "validation.invalidDigit",
  duplicate_digit: "validation.duplicateDigit",
  external_not_nanp: "validation.externalNotNanp",
  external_emergency: "validation.externalEmergency",
  unknown_target: "validation.unknownTarget",
  self_reference: "validation.selfReference",
  timeout_range: "validation.timeoutRange",
  retries_range: "validation.retriesRange",
  time_format: "validation.timeFormat",
  time_order: "validation.timeOrder",
  time_overlap: "validation.timeOverlap",
};

/** Translated message for the first issue on `field`, or null. */
export function useIssueText(issues: readonly ValidationIssue[]) {
  const { t } = useI18n();
  return (field: string): string | null => {
    const i = issues.find((x) => x.field === field);
    return i ? t(VALIDATION_KEY[i.code]) : null;
  };
}

export const TARGET_TYPES: readonly RouteTargetType[] = [
  "extension",
  "ring_group",
  "ivr",
  "voicemail",
  "external",
  "ai_receptionist",
  "directory",
  "schedule",
  "hangup",
];

const TYPE_KEY: Record<RouteTargetType, TKey> = {
  extension: "target.extension",
  ring_group: "target.ringGroup",
  ivr: "target.ivr",
  voicemail: "target.voicemail",
  external: "target.external",
  ai_receptionist: "target.aiReceptionist",
  directory: "target.directory",
  schedule: "target.schedule",
  hangup: "target.hangup",
};

/** One-line description of a routing target ("Poste 101 · Réception"). */
export function useDescribeTarget(dir: Directory | undefined) {
  const { t } = useI18n();
  return (target: RouteTarget | null | undefined): string => {
    if (!target) return t("target.none");
    const label = t(TYPE_KEY[target.type]);
    switch (target.type) {
      case "extension": {
        const e = dir?.extensions.find((x) => x.id === target.extensionId);
        return e ? `${label} ${e.number} · ${e.displayName}` : label;
      }
      case "ring_group":
        return `${label} · ${dir?.ringGroups.find((x) => x.id === target.ringGroupId)?.name ?? "?"}`;
      case "ivr":
        return `${label} · ${dir?.menus.find((x) => x.id === target.ivrMenuId)?.name ?? "?"}`;
      case "voicemail": {
        const e = target.extensionId ? dir?.extensions.find((x) => x.id === target.extensionId) : undefined;
        const g = target.ringGroupId ? dir?.ringGroups.find((x) => x.id === target.ringGroupId) : undefined;
        return e ? `${label} · ${e.number}` : g ? `${label} · ${g.name}` : `${label} · ${t("target.generalBox")}`;
      }
      case "external":
        return `${label} · ${formatPhone(target.number)}`;
      default:
        return label;
    }
  };
}

function defaultTarget(type: RouteTargetType, dir: Directory | undefined): RouteTarget {
  switch (type) {
    case "extension":
      return { type, extensionId: dir?.extensions[0]?.id ?? "" };
    case "ring_group":
      return { type, ringGroupId: dir?.ringGroups[0]?.id ?? "" };
    case "ivr":
      return { type, ivrMenuId: dir?.menus[0]?.id ?? "" };
    case "external":
      return { type, number: "" };
    case "voicemail":
      return { type };
    default:
      return { type } as RouteTarget;
  }
}

/**
 * Picks where a call goes. `allowNone` adds a "none" choice that maps to null (for optional targets
 * such as an IVR timeout or a ring-group overflow). External numbers are Canada/US only: 9-1-1 and
 * other N11 codes are refused by validateTarget (lib/ivr.ts), and again by the API.
 */
export function TargetPicker({
  id,
  label,
  value,
  onChange,
  dir,
  types = TARGET_TYPES,
  allowNone = false,
  error,
  disabled,
}: {
  id: string;
  label: string;
  value: RouteTarget | null;
  onChange: (target: RouteTarget | null) => void;
  dir: Directory | undefined;
  types?: readonly RouteTargetType[];
  allowNone?: boolean;
  error?: string | null;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  // What the admin typed; the target stores the normalised E.164. Callers key the picker by the
  // edited item so this resets when another item is opened.
  const [externalRaw, setExternalRaw] = useState(value?.type === "external" ? formatPhone(value.number) : "");

  return (
    <div className={`field target${error ? " field--error" : ""}`}>
      <label htmlFor={`${id}-type`}>{label}</label>
      <div className="row row--wrap">
        <select
          id={`${id}-type`}
          className="input"
          disabled={disabled}
          value={value?.type ?? ""}
          onChange={(e) => {
            const v = e.target.value as RouteTargetType | "";
            if (!v) return onChange(null);
            setExternalRaw("");
            onChange(defaultTarget(v, dir));
          }}
        >
          {allowNone || !value ? <option value="">{t("target.none")}</option> : null}
          {types.map((type) => (
            <option key={type} value={type}>
              {t(TYPE_KEY[type])}
            </option>
          ))}
        </select>
        {value?.type === "extension" ? (
          <select
            aria-label={t("target.extension")}
            className="input"
            disabled={disabled}
            value={value.extensionId}
            onChange={(e) => onChange({ type: "extension", extensionId: e.target.value })}
          >
            {dir?.extensions.map((x) => (
              <option key={x.id} value={x.id}>
                {x.number} · {x.displayName}
              </option>
            ))}
          </select>
        ) : null}
        {value?.type === "ring_group" ? (
          <select
            aria-label={t("target.ringGroup")}
            className="input"
            disabled={disabled}
            value={value.ringGroupId}
            onChange={(e) => onChange({ type: "ring_group", ringGroupId: e.target.value })}
          >
            {dir?.ringGroups.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        ) : null}
        {value?.type === "ivr" ? (
          <select
            aria-label={t("target.ivr")}
            className="input"
            disabled={disabled}
            value={value.ivrMenuId}
            onChange={(e) => onChange({ type: "ivr", ivrMenuId: e.target.value })}
          >
            {dir?.menus.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        ) : null}
        {value?.type === "voicemail" ? (
          <select
            aria-label={t("target.voicemail")}
            className="input"
            disabled={disabled}
            value={value.extensionId ? `e:${value.extensionId}` : value.ringGroupId ? `g:${value.ringGroupId}` : ""}
            onChange={(e) => {
              const v = e.target.value;
              if (v.startsWith("e:")) onChange({ type: "voicemail", extensionId: v.slice(2) });
              else if (v.startsWith("g:")) onChange({ type: "voicemail", ringGroupId: v.slice(2) });
              else onChange({ type: "voicemail" });
            }}
          >
            <option value="">{t("target.generalBox")}</option>
            {dir?.extensions.map((x) => (
              <option key={x.id} value={`e:${x.id}`}>
                {x.number} · {x.displayName}
              </option>
            ))}
            {dir?.ringGroups.map((x) => (
              <option key={x.id} value={`g:${x.id}`}>
                {x.name}
              </option>
            ))}
          </select>
        ) : null}
        {value?.type === "external" ? (
          <input
            aria-label={t("target.externalNumber")}
            className="input"
            type="tel"
            inputMode="tel"
            disabled={disabled}
            placeholder={t("otp.phonePlaceholder")}
            value={externalRaw}
            onChange={(e) => {
              setExternalRaw(e.target.value);
              onChange({ type: "external", number: normalizeExternal(e.target.value) ?? e.target.value.trim() });
            }}
          />
        ) : null}
      </div>
      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
