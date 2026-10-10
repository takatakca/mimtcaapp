import { PrivacyPage } from "@/components/pages/PrivacyPage";
import { metadataFor } from "@/lib/meta";

export const metadata = metadataFor("fr", "privacy");

export default function Page() {
  return <PrivacyPage lang="fr" />;
}
