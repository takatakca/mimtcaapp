import { HomePage } from "@/components/pages/HomePage";
import { metadataFor } from "@/lib/meta";

export const metadata = metadataFor("en", "home");

export default function Page() {
  return <HomePage lang="en" />;
}
