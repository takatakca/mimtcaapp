import { LandingPage } from "@/components/pages/LandingPage";
import { metadataFor } from "@/lib/meta";

export const metadata = metadataFor("fr", "cityLaval");

export default function Page() {
  return <LandingPage lang="fr" page="cityLaval" />;
}
