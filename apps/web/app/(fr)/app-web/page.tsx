import { WebAppPage } from "@/components/pages/WebAppPage";
import { metadataFor } from "@/lib/meta";

export const metadata = metadataFor("fr", "webapp");

export default function Page() {
  return <WebAppPage lang="fr" />;
}
