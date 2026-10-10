import { SoonPage } from "@/components/pages/SoonPage";
import { metadataFor } from "@/lib/meta";

export const metadata = metadataFor("en", "soon");

export default function Page() {
  return <SoonPage lang="en" />;
}
