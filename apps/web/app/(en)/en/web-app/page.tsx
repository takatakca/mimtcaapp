import { WebAppPage } from "@/components/pages/WebAppPage";
import { metadataFor } from "@/lib/meta";

export const metadata = metadataFor("en", "webapp");

export default function Page() {
  return <WebAppPage lang="en" />;
}
