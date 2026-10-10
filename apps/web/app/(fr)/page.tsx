import { HomePage } from "@/components/pages/HomePage";
import { metadataFor } from "@/lib/meta";

export const metadata = metadataFor("fr", "home");

export default function Page() {
  return <HomePage lang="fr" />;
}
