import { notFound } from "next/navigation";
import { GuidePage } from "@/components/pages/GuidePage";
import { GUIDES, guideBySlug } from "@/lib/guides";
import { guideMetadata } from "@/lib/meta";

export const dynamicParams = false;

export function generateStaticParams() {
  return GUIDES.map((g) => ({ slug: g.slug.fr }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const guide = guideBySlug("fr", (await params).slug);
  return guide ? guideMetadata("fr", guide) : {};
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const guide = guideBySlug("fr", (await params).slug);
  if (!guide) notFound();
  return <GuidePage lang="fr" guide={guide} />;
}
