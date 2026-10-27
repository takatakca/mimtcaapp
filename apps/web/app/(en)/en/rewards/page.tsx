import { RewardsPage } from "@/components/pages/RewardsPage";
import { metadataFor } from "@/lib/meta";

export const metadata = metadataFor("en", "rewards");

export default function Page() {
  return <RewardsPage lang="en" />;
}
