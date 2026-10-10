import { ContactPage } from "@/components/pages/ContactPage";
import { metadataFor } from "@/lib/meta";

export const metadata = metadataFor("en", "contact");

export default function Page() {
  return <ContactPage lang="en" />;
}
