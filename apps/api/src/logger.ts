import type { FastifyServerOptions } from "fastify";
import type { Config } from "./config.js";

/** Never log tokens, auth headers, signatures or message bodies. */
export const REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "req.headers['x-twilio-signature']",
  "req.headers['stripe-signature']",
  "req.headers['x-mimt-api-key']",
  "req.headers['x-docusign-signature-1']",
  "req.headers['x-docusign-signature-2']",
  "headers.authorization",
  "body.Body",
  "body.body",
  "*.token",
  "*.accessToken",
  "*.refreshToken",
  "*.idToken",
  "*.code",
  "*.codeVerifier",
  "*.password",
  "*.secret",
  "*.assertion",
  "*.private_key",
  "*.privateKey",
  "*.serviceAccountJson",
  // Number port-in: losing-carrier account number and PIN.
  "*.accountNumber",
  "*.pin",
];

export function loggerOptions(config: Config): FastifyServerOptions["logger"] {
  return {
    level: config.NODE_ENV === "test" ? "silent" : config.LOG_LEVEL,
    redact: { paths: REDACT_PATHS, censor: "[redacted]" },
    serializers: {
      // Query strings can carry identifiers; keep only the path in request logs.
      req: (req: { method: string; url: string; id: string }) => ({ id: req.id, method: req.method, path: req.url.split("?")[0] }),
    },
  };
}
