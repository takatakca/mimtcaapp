import { AccessibilityPage } from "@/components/pages/AccessibilityPage";
import { metadataFor } from "@/lib/meta";

export const metadata = metadataFor("fr", "accessibility");

export default function Page() {
  return <AccessibilityPage lang="fr" />;
}
