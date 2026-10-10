import { BusinessPage } from "@/components/pages/BusinessPage";
import { metadataFor } from "@/lib/meta";

export const metadata = metadataFor("en", "business");

export default function Page() {
  return <BusinessPage lang="en" />;
}
