// Web Speech API (dictation) where the browser has it: Chrome, Edge, Safari. French (Canada) by default.
// Audio is handled by the browser's own speech service; MIMT receives only the resulting text.

interface RecognitionResultEvent {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
}
interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((e: RecognitionResultEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => Recognition;

function ctor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const speechSupported = () => ctor() !== null;

export interface Dictation {
  stop(): void;
}

/** Starts dictation. onText gets the running transcript; onDone the final text ("" when nothing was heard). */
export function startDictation(lang: "fr-CA" | "en-CA", handlers: { onText: (t: string) => void; onDone: (t: string) => void; onError: (code: string) => void }): Dictation | null {
  const C = ctor();
  if (!C) return null;
  const r = new C();
  r.lang = lang;
  r.interimResults = true;
  r.continuous = false;
  r.maxAlternatives = 1;
  let finalText = "";
  let interim = "";
  r.onresult = (e) => {
    interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i]!;
      if (res.isFinal) finalText += res[0].transcript;
      else interim += res[0].transcript;
    }
    handlers.onText((finalText + interim).trim());
  };
  r.onerror = (e) => handlers.onError(e.error);
  r.onend = () => handlers.onDone((finalText || interim).trim());
  try {
    r.start();
  } catch {
    return null;
  }
  return { stop: () => r.stop() };
}
