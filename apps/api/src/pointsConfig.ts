// « MIMT Points » switches and catalog, overridable from the environment, never past the economics rule
// (docs/MIMT-POINTS.md, docs/MIMT-UNIT-ECONOMICS.md « Points »). Same model as plansConfig.ts: a catalog price that
// breaks the rule stops the API at startup with the numbers.
//
//   POINTS=on|off                          kill switch (off: nothing earned, nothing redeemed; balances kept)
//   POINTS_DAILY_EARN_CAP / _MONTHLY_      most points one account earns per UTC day / month (default 5 000 / 20 000)
//   POINTS_EXPIRY=on|off, _EXPIRY_MONTHS   inactivity expiry job (default off, 12 months)
//   POINTS_INVOICE_CREDIT_MAX_CENTS_PER_MONTH  invoice credits bought with points, per account and month (default 500)
//   POINTS_CATALOG_JSON                    [{"id":"texts_50","points":300,"monthlyLimit":2,"enabled":true,"quantity":50}, …]
import { POINTS_CATALOG, isPointsRewardId, pointsCatalogViolations, DEFAULT_ASSUMPTIONS, type PointsReward } from "@mimt/shared";
import { z } from "zod";
import { carrierRatesFromEnv } from "./plansConfig.js";

export interface PointsConfig {
  enabled: boolean;
  dailyEarnCap: number;
  monthlyEarnCap: number;
  expiry: { enabled: boolean; months: number };
  invoiceCreditMaxCentsPerMonth: number;
  catalog: PointsReward[];
}

const Override = z
  .object({
    id: z.string(),
    points: z.number().int().min(1).max(1_000_000).optional(),
    quantity: z.number().int().min(1).max(100_000).optional(),
    monthlyLimit: z.number().int().min(0).max(100).optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

function int(env: Record<string, string | undefined>, key: string, fallback: number, min: number, max: number): number {
  const raw = env[key]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`Invalid configuration: ${key} must be a whole number from ${min} to ${max}`);
  return n;
}

function onOff(env: Record<string, string | undefined>, key: string, fallback: "on" | "off"): boolean {
  const v = env[key]?.trim() || fallback;
  if (v !== "on" && v !== "off") throw new Error(`Invalid configuration: ${key} must be on or off`);
  return v === "on";
}

export function pointsFromEnv(env: Record<string, string | undefined>, usdToCad = DEFAULT_ASSUMPTIONS.usdToCad): PointsConfig {
  const catalog = structuredClone(POINTS_CATALOG) as PointsReward[];
  if (env.POINTS_CATALOG_JSON) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(env.POINTS_CATALOG_JSON);
    } catch {
      throw new Error("Invalid configuration: POINTS_CATALOG_JSON is not JSON");
    }
    const list = z.array(Override).safeParse(parsed);
    if (!list.success) throw new Error(`Invalid configuration: POINTS_CATALOG_JSON: ${list.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
    for (const o of list.data) {
      if (!isPointsRewardId(o.id)) throw new Error(`Invalid configuration: POINTS_CATALOG_JSON: unknown reward ${o.id}`);
      const r = catalog.find((x) => x.id === o.id)!;
      Object.assign(r, Object.fromEntries(Object.entries(o).filter(([k, v]) => k !== "id" && v !== undefined)));
    }
  }
  const broken = pointsCatalogViolations(catalog, carrierRatesFromEnv(env), { ...DEFAULT_ASSUMPTIONS, usdToCad });
  if (broken.length) {
    const detail = broken
      .map((e) => `${e.id}: worst case ${e.costCad} $ = ${Math.round(e.shareAtMaxCampaign * 1000) / 10} % of the revenue behind its points at x3${e.pointsPerMinute !== null ? `, ${e.pointsPerMinute} points/min` : ""}`)
      .join("; ");
    throw new Error(`Invalid configuration: points reward priced below the rule (docs/MIMT-UNIT-ECONOMICS.md « Points »): ${detail}`);
  }
  const daily = int(env, "POINTS_DAILY_EARN_CAP", 5000, 0, 1_000_000);
  return {
    enabled: onOff(env, "POINTS", "on"),
    dailyEarnCap: daily,
    monthlyEarnCap: Math.max(daily, int(env, "POINTS_MONTHLY_EARN_CAP", 20_000, 0, 10_000_000)),
    expiry: { enabled: onOff(env, "POINTS_EXPIRY", "off"), months: int(env, "POINTS_EXPIRY_MONTHS", 12, 6, 60) },
    invoiceCreditMaxCentsPerMonth: int(env, "POINTS_INVOICE_CREDIT_MAX_CENTS_PER_MONTH", 500, 0, 5000),
    catalog,
  };
}
