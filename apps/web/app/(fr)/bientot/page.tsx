import { SoonPage } from "@/components/pages/SoonPage";
import { metadataFor } from "@/lib/meta";

export const metadata = metadataFor("fr", "soon");

export default function Page() {
  return <SoonPage lang="fr" />;
}
