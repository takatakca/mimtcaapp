import type { Config } from "./config.js";
import type { AiServices } from "./ai/service.js";
import type { SessionService } from "./auth/sessions.js";
import type { TakatakClient } from "./auth/takatak.js";
import type { DeviceVerifier } from "./devices/verify.js";
import type { BillingGateway } from "./gateways/billing.js";
import type { ProvisioningProvider } from "./catalog/providers/types.js";
import type { MediaStore } from "./gateways/media.js";
import type { TwilioGateway } from "./gateways/twilio.js";
import type { TwilioPortingGateway } from "./gateways/twilioPorting.js";
import type { MessageCipher } from "./lib/crypto.js";
import type { RateLimiter } from "./fraud/rateLimiter.js";
import type { Repository } from "./repo/types.js";
import type { Notifier } from "./services/notifier.js";
import type { EmailSender } from "./services/email.js";
import type { VideoGateway } from "./video/gateway.js";

export interface AppDeps {
  config: Config;
  repo: Repository;
  sessions: SessionService;
  takatak: TakatakClient;
  /** null when Twilio REST credentials are not configured (features answer 503). */
  twilio: TwilioGateway | null;
  /** null when Stripe is not configured. */
  billing: BillingGateway | null;
  /** null until Supabase Storage credentials are set. Voicemail then stays on Twilio. */
  media: MediaStore | null;
  deviceVerifier: DeviceVerifier;
  /** AdMob SSV public keys, keyed by key id. Tests inject a fixed map. */
  admobKeys: () => Promise<ReadonlyMap<string, string>>;
  cipher: MessageCipher;
  rateLimiter: RateLimiter;
  notifier: Notifier;
  now: () => Date;
  /** AI (Claude). Absent or with a null gateway when ANTHROPIC_API_KEY is unset: AI features answer 503. */
  ai?: AiServices;
  /** MMS media + voicemail greetings bucket. Absent or null: uploads answer 503, inbound MMS stays at Twilio. */
  mediaFiles?: MediaStore | null;
  /** Voicemail-to-email sender. Absent: log-only. */
  email?: EmailSender;
  /** Internet/mobile resale wholesaler (sandbox in dev). Absent or null: ordering answers 503. */
  provisioning?: ProvisioningProvider | null;
  /** Twilio Porting API (number port-in). Absent or null: requests are recorded and signed, then wait for ops. */
  porting?: TwilioPortingGateway | null;
  /** Réunions MIMT SFU (LiveKit). Absent or null: meeting routes answer 503 not_configured. */
  video?: VideoGateway | null;
}
