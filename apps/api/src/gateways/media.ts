const SAFE_PATH = /^[A-Za-z0-9][A-Za-z0-9/_.-]{0,180}$/;

export interface MediaStore {
  put(path: string, body: Buffer, contentType: string): Promise<void>;
  get(path: string): Promise<{ contentType: string; body: Buffer } | null>;
  delete(path: string): Promise<void>;
}

export function assertMediaPath(path: string): string {
  if (!SAFE_PATH.test(path) || path.includes("..")) throw new Error("invalid media path");
  return path;
}

/** Private Supabase Storage bucket. The service role key stays on the server. */
export class SupabaseMediaStore implements MediaStore {
  constructor(
    private readonly supabaseUrl: string,
    private readonly serviceKey: string,
    private readonly bucket = "voicemail",
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private endpoint(path: string) {
    return `${this.supabaseUrl.replace(/\/$/, "")}/storage/v1/object/${this.bucket}/${assertMediaPath(path)}`;
  }

  private headers(contentType?: string): Record<string, string> {
    return {
      authorization: `Bearer ${this.serviceKey}`,
      apikey: this.serviceKey,
      ...(contentType ? { "content-type": contentType, "x-upsert": "true" } : {}),
    };
  }

  async put(path: string, body: Buffer, contentType: string) {
    const res = await this.fetchImpl(this.endpoint(path), { method: "POST", headers: this.headers(contentType), body: new Uint8Array(body) });
    if (!res.ok) throw new Error(`storage put failed: HTTP ${res.status}`);
  }

  async get(path: string) {
    const res = await this.fetchImpl(this.endpoint(path), { headers: this.headers() });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`storage get failed: HTTP ${res.status}`);
    return { contentType: res.headers.get("content-type") ?? "audio/mpeg", body: Buffer.from(await res.arrayBuffer()) };
  }

  async delete(path: string) {
    const res = await this.fetchImpl(this.endpoint(path), { method: "DELETE", headers: this.headers() });
    if (!res.ok && res.status !== 404) throw new Error(`storage delete failed: HTTP ${res.status}`);
  }
}

export class MemoryMediaStore implements MediaStore {
  readonly objects = new Map<string, { contentType: string; body: Buffer }>();

  async put(path: string, body: Buffer, contentType: string) {
    this.objects.set(assertMediaPath(path), { contentType, body });
  }
  async get(path: string) {
    return this.objects.get(assertMediaPath(path)) ?? null;
  }
  async delete(path: string) {
    this.objects.delete(assertMediaPath(path));
  }
}
