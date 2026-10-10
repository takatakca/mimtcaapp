import { E911Page } from "@/components/pages/E911Page";
import { metadataFor } from "@/lib/meta";

export const metadata = metadataFor("fr", "e911");

export default function Page() {
  return <E911Page lang="fr" />;
}
