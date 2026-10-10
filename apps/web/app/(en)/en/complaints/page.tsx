import { ComplaintsPage } from "@/components/pages/ComplaintsPage";
import { metadataFor } from "@/lib/meta";

export const metadata = metadataFor("en", "complaints");

export default function Page() {
  return <ComplaintsPage lang="en" />;
}
