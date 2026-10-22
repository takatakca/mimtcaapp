import { LandingPage } from "@/components/pages/LandingPage";
import { metadataFor } from "@/lib/meta";

export const metadata = metadataFor("en", "cityQuebec");

export default function Page() {
  return <LandingPage lang="en" page="cityQuebec" />;
}
