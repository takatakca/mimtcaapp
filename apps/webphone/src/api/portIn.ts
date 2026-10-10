// Number port-in endpoints (/v1/port-ins). Shapes come from packages/shared/src/portIn.ts.
import type { CreatePortInRequest, NumberPortIn, PortInLoaResponse, PortInsResponse, SignPortInRequest } from "@mimt/shared";
import type { HttpClient } from "./http";

const p = (id: string) => `/v1/port-ins/${encodeURIComponent(id)}`;

export function portInEndpoints(request: HttpClient["request"]) {
  return {
    portIns: () => request<PortInsResponse>("GET", "/v1/port-ins"),
    createPortIn: (body: CreatePortInRequest) => request<NumberPortIn>("POST", "/v1/port-ins", { body }),
    portInLoa: (id: string) => request<PortInLoaResponse>("GET", `${p(id)}/loa`, { query: { format: "json" } }),
    signPortIn: (id: string, body: SignPortInRequest) => request<NumberPortIn>("POST", `${p(id)}/sign`, { body }),
    cancelPortIn: (id: string) => request<NumberPortIn>("POST", `${p(id)}/cancel`, { body: {} }),
  };
}
