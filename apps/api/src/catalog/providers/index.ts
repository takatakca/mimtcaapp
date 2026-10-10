import type { Config } from "../../config.js";
import { SandboxProvisioningProvider } from "./sandbox.js";
import type { ProvisioningProvider } from "./types.js";
import { VideotronProvisioningProvider } from "./videotron.js";

export * from "./types.js";

/**
 * PROVISIONING_PROVIDER=sandbox|videotron. Unset: sandbox outside production, none in production
 * (orders then answer 503 instead of creating fake services).
 */
export function createProvisioningProvider(config: Config, now: () => Date = () => new Date()): ProvisioningProvider | null {
  const choice = config.PROVISIONING_PROVIDER ?? (config.NODE_ENV === "production" ? null : "sandbox");
  if (choice === "sandbox") return new SandboxProvisioningProvider(now);
  if (choice === "videotron") return new VideotronProvisioningProvider(config);
  return null;
}
