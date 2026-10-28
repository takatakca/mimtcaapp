import { AffiliatesPage } from "@/components/pages/AffiliatesPage";
import { metadataFor } from "@/lib/meta";

export const metadata = metadataFor("en", "affiliates");

export default function Page() {
  return <AffiliatesPage lang="en" />;
}
