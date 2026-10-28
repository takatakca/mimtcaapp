// Sends the pending affiliate link (lib/affiliate.ts) to the API once the user is signed in. Renders nothing; failures
// are silent (the code keeps riding along with Stripe Checkout until it expires).
import { useEffect } from "react";
import { api } from "../api/client";
import { markAffiliateSent, readPendingAffiliate } from "../lib/affiliate";

export function AffiliateAttribution() {
  useEffect(() => {
    const pending = readPendingAffiliate();
    if (!pending || pending.sentAt) return;
    api.affiliateAttribution(pending.code, pending.touchedAt).then(
      () => markAffiliateSent(),
      () => undefined,
    );
  }, []);
  return null;
}
