import { GuidesPage } from "@/components/pages/GuidesPage";
import { metadataFor } from "@/lib/meta";

export const metadata = metadataFor("fr", "guides");

export default function Page() {
  return <GuidesPage lang="fr" />;
}
