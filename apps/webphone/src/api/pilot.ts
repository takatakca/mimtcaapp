// « Pilote MIMT » endpoints (/v1/ai/command…). Shapes: packages/shared/src/pilot.ts; spec docs/MIMT-PILOTE.md.
import type { PilotCommandRequest, PilotCommandResponse, PilotConfirmRequest, PilotConfirmResponse } from "@mimt/shared";
import type { HttpClient } from "./http";

export function pilotEndpoints(request: HttpClient["request"]) {
  return {
    pilotCommand: (body: PilotCommandRequest) => request<PilotCommandResponse>("POST", "/v1/ai/command", { body }),
    pilotConfirm: (body: PilotConfirmRequest) => request<PilotConfirmResponse>("POST", "/v1/ai/command/confirm", { body }),
    pilotCancel: (body: PilotConfirmRequest) => request<void>("POST", "/v1/ai/command/cancel", { body }),
  };
}
