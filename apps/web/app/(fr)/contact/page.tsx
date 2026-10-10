import { ContactPage } from "@/components/pages/ContactPage";
import { metadataFor } from "@/lib/meta";

export const metadata = metadataFor("fr", "contact");

export default function Page() {
  return <ContactPage lang="fr" />;
}
