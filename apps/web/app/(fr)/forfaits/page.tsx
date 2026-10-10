import { PlansPage } from "@/components/pages/PlansPage";
import { metadataFor } from "@/lib/meta";

export const metadata = metadataFor("fr", "plans");

export default function Page() {
  return <PlansPage lang="fr" />;
}
