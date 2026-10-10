import { TermsPage } from "@/components/pages/TermsPage";
import { metadataFor } from "@/lib/meta";

export const metadata = metadataFor("en", "terms");

export default function Page() {
  return <TermsPage lang="en" />;
}
