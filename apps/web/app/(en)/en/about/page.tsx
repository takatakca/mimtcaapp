import { AboutPage } from "@/components/pages/AboutPage";
import { metadataFor } from "@/lib/meta";

export const metadata = metadataFor("en", "about");

export default function Page() {
  return <AboutPage lang="en" />;
}
