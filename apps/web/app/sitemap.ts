import type { MetadataRoute } from "next";
import { GUIDES, guidePath } from "@/lib/guides";
import { ROUTES, SITE_URL, type RouteKey } from "@/lib/site";

export const dynamic = "force-static";

const PRIORITY: Partial<Record<RouteKey, number>> = { home: 1, plans: 0.9, business: 0.9, ai: 0.8, webapp: 0.7, compare: 0.7, help: 0.7 };

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  const pages = (Object.keys(ROUTES) as RouteKey[]).flatMap((key) =>
    (["fr", "en"] as const).map((lang) => ({
      url: SITE_URL + ROUTES[key][lang],
      lastModified,
      changeFrequency: "monthly" as const,
      priority: PRIORITY[key] ?? 0.5,
      alternates: {
        languages: {
          "fr-CA": SITE_URL + ROUTES[key].fr,
          "en-CA": SITE_URL + ROUTES[key].en,
          "x-default": SITE_URL + ROUTES[key].fr,
        },
      },
    })),
  );
  const guides = GUIDES.flatMap((g) =>
    (["fr", "en"] as const).map((lang) => ({
      url: SITE_URL + guidePath(g, lang),
      lastModified: new Date(`${g.updated}T12:00:00Z`),
      changeFrequency: "yearly" as const,
      priority: 0.6,
      alternates: {
        languages: {
          "fr-CA": SITE_URL + guidePath(g, "fr"),
          "en-CA": SITE_URL + guidePath(g, "en"),
          "x-default": SITE_URL + guidePath(g, "fr"),
        },
      },
    })),
  );
  return [...pages, ...guides];
}
