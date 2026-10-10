import { HelpPage } from "@/components/pages/HelpPage";
import { metadataFor } from "@/lib/meta";

export const metadata = metadataFor("fr", "help");

export default function Page() {
  return <HelpPage lang="fr" />;
}
