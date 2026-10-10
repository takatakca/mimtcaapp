// Live AI and MIMT Affaires endpoints, bound to the real API client (definitions in ai.ts).
import { makeAiApi, makeBusinessApi } from "./ai";
import { request } from "./client";

export const aiApi = makeAiApi(request);
export const businessApi = makeBusinessApi(request);
