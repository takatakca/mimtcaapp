// Coarse client information for the session inventory (Law 25 minimisation, docs/MIMT-SECURITY.md).
// We keep what a person needs to recognise a device ("Chrome · Windows", "203.0.113.0/24") and nothing more:
// never the full user agent string, never the full IP address.
import { isIPv4, isIPv6 } from "node:net";

const BROWSERS: Array<[RegExp, string]> = [
  [/\bMIMT\/|okhttp\/|Expo\/|CFNetwork\//i, "App MIMT"],
  [/\bEdg(e|A|iOS)?\//, "Edge"],
  [/\bOPR\/|\bOpera\b/, "Opera"],
  [/\bSamsungBrowser\//, "Samsung Internet"],
  [/\bFirefox\/|\bFxiOS\//, "Firefox"],
  [/\bCriOS\/|\bChrome\/|\bChromium\//, "Chrome"],
  [/\bSafari\//, "Safari"],
];

const SYSTEMS: Array<[RegExp, string]> = [
  [/\biPhone|\biPad|\biPod|\biOS\b|Darwin\/.*CFNetwork|CFNetwork\/.*Darwin/, "iOS"],
  [/\bAndroid\b|okhttp\//i, "Android"],
  [/\bCrOS\b/, "ChromeOS"],
  [/\bWindows\b/, "Windows"],
  [/\bMac OS X\b|\bMacintosh\b/, "macOS"],
  [/\bLinux\b/, "Linux"],
];

/** "Mozilla/5.0 (Windows NT 10.0; …) Chrome/131…" → "Chrome · Windows". Unknown parts read "Unknown". */
export function coarseUserAgent(raw: unknown): string {
  const ua = typeof raw === "string" ? raw.slice(0, 512) : "";
  const browser = BROWSERS.find(([re]) => re.test(ua))?.[1] ?? "Unknown";
  const os = SYSTEMS.find(([re]) => re.test(ua))?.[1] ?? "Unknown";
  return `${browser} · ${os}`;
}

/** Expands an IPv6 address to 8 groups of 4 hex digits; null when it is not one. */
function ipv6Groups(ip: string): string[] | null {
  if (!isIPv6(ip)) return null;
  let addr = ip.split("%")[0]!;
  // Embedded IPv4 (::ffff:1.2.3.4): turn the dotted tail into two groups.
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(addr);
  if (v4) {
    const [a, b, c, d] = v4[1]!.split(".").map(Number) as [number, number, number, number];
    addr = addr.slice(0, -v4[1]!.length) + `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, tail] = addr.includes("::") ? (addr.split("::") as [string, string]) : [addr, null];
  const h = head ? head.split(":") : [];
  const t = tail === null ? [] : tail ? tail.split(":") : [];
  const fill = tail === null ? [] : Array<string>(8 - h.length - t.length).fill("0");
  const groups = [...h, ...fill, ...t];
  return groups.length === 8 ? groups.map((g) => g.padStart(4, "0").toLowerCase()) : null;
}

/**
 * The network a request came from, never the address itself: IPv4 → "a.b.c.0/24", IPv6 → "xxxx:xxxx:xxxx::/48"
 * (IPv4-mapped IPv6 is treated as IPv4). Anything else → null.
 */
export function coarseIp(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw) return null;
  let ip = raw.trim();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) ip = mapped[1]!;
  if (isIPv4(ip)) {
    const [a, b, c] = ip.split(".");
    return `${a}.${b}.${c}.0/24`;
  }
  const groups = ipv6Groups(ip);
  if (!groups) return null;
  return `${groups.slice(0, 3).map((g) => g.replace(/^0+(?=.)/, "")).join(":")}::/48`;
}

/** What a sign-in records about the client. */
export interface ClientInfo {
  userAgent: string;
  ipPrefix: string | null;
}

export function clientInfo(req: { headers: Record<string, unknown>; ip: string }): ClientInfo {
  return { userAgent: coarseUserAgent(req.headers["user-agent"]), ipPrefix: coarseIp(req.ip) };
}
