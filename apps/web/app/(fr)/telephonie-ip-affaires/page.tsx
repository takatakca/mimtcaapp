import { LandingPage } from "@/components/pages/LandingPage";
import { metadataFor } from "@/lib/meta";

export const metadata = metadataFor("fr", "useVoip");

export default function Page() {
  return <LandingPage lang="fr" page="useVoip" />;
}
