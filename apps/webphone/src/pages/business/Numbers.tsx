// Business numbers (DIDs) and where their calls go.
import type { DidRoute, RouteTarget } from "@mimt/shared";
import { useState } from "react";
import { api } from "../../api/client";
import { toErrorKey } from "../../api/errors";
import { Empty, ErrorNote, Loading } from "../../components/ui";
import { useI18n } from "../../i18n/I18nProvider";
import type { TKey } from "../../i18n/core";
import { formatPhone } from "../../lib/dial";
import { validateTarget } from "../../lib/ivr";
import { useAsync } from "../../lib/useAsync";
import { TargetPicker, targetContext, useBusiness, useDescribeTarget, useDirectory, useIssueText, type Directory } from "./shared";

export function Numbers() {
  const { t } = useI18n();
  const { id, biz } = useBusiness();
  const dir = useDirectory(id);
  const routes = useAsync(() => api.dids(id), [id]);
  const describe = useDescribeTarget(dir.data);

  return (
    <section className="card" aria-labelledby="dids-h">
      <h2 id="dids-h" className="card__title">
        {t("biz.nav.numbers")}
      </h2>
      <p className="muted small">{t("biz.dids.intro")}</p>
      <ErrorNote error={routes.error ?? dir.error} onRetry={routes.reload} />
      {routes.loading || dir.loading ? <Loading /> : null}
      {routes.data && routes.data.routes.length === 0 ? <Empty>{t("biz.dids.empty")}</Empty> : null}
      <ul className="stack">
        {routes.data?.routes.map((r) => (
          <li key={r.id} className="did">
            <div className="did__head">
              <strong className="did__number">{formatPhone(r.e164)}</strong>
              {biz.business.mainNumber === r.e164 ? <span className="badge badge--info">{t("biz.dids.main")}</span> : null}
              <span className="muted small">{describe(r.target)}</span>
            </div>
            {dir.data ? (
              <DidEditor
                route={r}
                dir={dir.data}
                onSaved={(saved) => routes.setData((d) => d && { routes: d.routes.map((x) => (x.e164 === saved.e164 ? saved : x)) })}
              />
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function DidEditor({ route, dir, onSaved }: { route: DidRoute; dir: Directory; onSaved: (r: DidRoute) => void }) {
  const { t } = useI18n();
  const { id, canAdmin } = useBusiness();
  const [target, setTarget] = useState<RouteTarget | null>(route.target);
  const [msg, setMsg] = useState<TKey | null>(null);
  const issues = validateTarget(target, targetContext(dir), "target");
  const issue = useIssueText(issues);

  const save = async () => {
    if (!target || issues.length) return;
    try {
      onSaved(await api.putDid(id, { e164: route.e164, target }));
      setMsg("biz.dids.saved");
    } catch (err) {
      setMsg(toErrorKey(err));
    }
  };

  return (
    <div className="row row--wrap row--end">
      <TargetPicker id={`did-${route.id}`} label={t("biz.dids.routeTo")} value={target} onChange={setTarget} dir={dir} error={issue("target")} disabled={!canAdmin} />
      {canAdmin ? (
        <button type="button" className="btn btn--primary btn--sm" onClick={() => void save()} disabled={issues.length > 0}>
          {t("common.save")}
        </button>
      ) : null}
      {msg ? (
        <span className={msg === "biz.dids.saved" ? "ok-text" : "field__error"} role="status">
          {t(msg)}
        </span>
      ) : null}
    </div>
  );
}
