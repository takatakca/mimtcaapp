import { AiPage } from "@/components/pages/AiPage";
import { metadataFor } from "@/lib/meta";

export const metadata = metadataFor("fr", "ai");

export default function Page() {
  return <AiPage lang="fr" />;
}
