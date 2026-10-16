// Réunions MIMT (read-only on mobile). Contract: packages/shared/src/meetings.ts.
import type { MeetingsResponse } from "@mimt/shared";
import { request } from "./client";

export const meetingsApi = {
  list: () => request<MeetingsResponse>("GET", "/v1/meetings"),
};
