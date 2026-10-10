import { AiPage } from "@/components/pages/AiPage";
import { metadataFor } from "@/lib/meta";

export const metadata = metadataFor("en", "ai");

export default function Page() {
  return <AiPage lang="en" />;
}
