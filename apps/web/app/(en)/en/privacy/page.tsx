import { PrivacyPage } from "@/components/pages/PrivacyPage";
import { metadataFor } from "@/lib/meta";

export const metadata = metadataFor("en", "privacy");

export default function Page() {
  return <PrivacyPage lang="en" />;
}
