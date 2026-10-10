/** Second carrier for Cuba. Twilio's outbound list has no +53 destination. */

const SIP_HOST = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

export function isSipHost(host: string): boolean {
  return SIP_HOST.test(host);
}

/**
 * SIP URI for a Cuba number. The host is a trunk hostname only: no user, password or port,
 * so credentials never land in TwiML or logs. Returns null when the number or host is unusable.
 */
export function cubaSipUri(e164: string, host: string | undefined): string | null {
  if (!host || !isSipHost(host) || !/^\+53\d{6,12}$/.test(e164)) return null;
  return `sip:${e164.slice(1)}@${host}`;
}
