import { ComparePage } from "@/components/pages/ComparePage";
import { metadataFor } from "@/lib/meta";

export const metadata = metadataFor("en", "compare");

export default function Page() {
  return <ComparePage lang="en" />;
}
