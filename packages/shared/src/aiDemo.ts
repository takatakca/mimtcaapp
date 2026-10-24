// Public AI phone demo on mimt.ca (POST /v1/public/ai-demo): a visitor "calls" a fictional business in the
// browser and talks to the AI receptionist. Nothing is stored; the businesses and their data are invented.

export type AiDemoScenario = "restaurant" | "support" | "booking";

export const AI_DEMO_SCENARIOS: readonly AiDemoScenario[] = ["restaurant", "support", "booking"];

/** Turns per call (visitor + AI), characters per visitor message. */
export const AI_DEMO_LIMITS = { turns: 24, messageChars: 400 } as const;

export interface AiDemoMessage {
  role: "caller" | "agent";
  text: string;
}

export interface AiDemoRequest {
  scenario: AiDemoScenario;
  locale: "fr-CA" | "en-CA";
  /** The call so far, oldest first; empty to get the greeting. */
  messages: AiDemoMessage[];
}

/** What the business would receive at the end of the call (order ticket, support note, booking). */
export interface AiDemoTicket {
  title: string;
  lines: string[];
}

export interface AiDemoResponse {
  /** What the AI says next (spoken by the browser). */
  reply: string;
  /** True when the AI ends the call; `ticket` is then filled when there is something to hand over. */
  done: boolean;
  ticket: AiDemoTicket | null;
}
