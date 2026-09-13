import { randomUUID } from "node:crypto";

const HOST = "https://openapi.gmgn.ai";
const USER_AGENT = "lp-scanner/0.1";

// Read-only demo key published in GMGNAI/gmgn-skills. Shared + heavily rate
// limited; use it to smoke-test only, get a personal key at https://gmgn.ai/ai.
export const DEMO_KEY = "gmgn_solbscbaseethmonadtron";

export const CHAINS = ["sol", "bsc", "eth", "base", "arbitrum", "hyperevm", "robinhood", "arc", "stable"];
export const INTERVALS = ["1m", "5m", "1h", "6h", "24h"];
export const EVM_CHAINS = new Set(["bsc", "eth", "base", "arbitrum", "hyperevm"]);

export class RateLimitError extends Error {
  constructor(resetAt) {
    const at = resetAt ? new Date(resetAt * 1000).toLocaleTimeString() : "tidak diketahui";
    super(`GMGN rate limit (RATE_LIMIT_BANNED). Limit reset jam ${at}. Jangan retry sebelum itu — tiap retry menambah ban 5 detik.`);
    this.name = "RateLimitError";
    this.resetAt = resetAt ?? null;
  }
}

export class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }

  // Kredensial salah tidak akan sembuh dengan menunggu — jangan di-backoff selamanya.
  get fatal() {
    if (this.status === 401 || this.status === 403) return true;
    const code = typeof this.body === "object" ? String(this.body?.error ?? "") : "";
    return /AUTH|KEY_INVALID|FORBIDDEN|SIGNATURE/i.test(code) || /AUTH_KEY_INVALID/i.test(this.message);
  }
}

export function resolveApiKey({ demo = false } = {}) {
  const fromEnv = process.env.GMGN_API_KEY?.trim();
  if (fromEnv) return { key: fromEnv, source: "env" };
  if (demo) return { key: DEMO_KEY, source: "demo" };
  return null;
}

// Responses come back double-wrapped: {code, data:{code, data:{...}}}
function unwrap(body) {
  let node = body;
  while (node && typeof node === "object" && "code" in node && "data" in node) {
    if (node.code !== 0 && node.code !== 200) {
      throw new ApiError(node.msg || node.error || `GMGN error code ${node.code}`, null, node);
    }
    node = node.data;
  }
  return node;
}

export class GmgnClient {
  // minIntervalMs memberi jarak antar request. Dokumen GMGN menyebut 20/detik, tapi
  // praktiknya ledakan request beruntun memicu ban "repeated violations" jauh sebelum
  // angka itu — dan ban memakan menit, sementara jeda ini hitungan detik. Satu siklus
  // 5 chain + --deep top 3 = 20 request; pada 1000 ms itu tersebar 20 detik, masih
  // muat di dalam --watch 60.
  constructor(apiKey, { timeoutMs = 20000, minIntervalMs = 1000 } = {}) {
    this.apiKey = apiKey;
    this.timeoutMs = timeoutMs;
    this.minIntervalMs = minIntervalMs;
    this.lastRequestAt = 0;
  }

  async throttle() {
    const wait = this.lastRequestAt + this.minIntervalMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastRequestAt = Date.now();
  }

  async get(path, query = {}) {
    await this.throttle();
    const url = new URL(HOST + path);
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === "") continue;
      if (Array.isArray(v)) for (const item of v) url.searchParams.append(k, String(item));
      else url.searchParams.set(k, String(v));
    }
    // Server validates timestamp within +/-5s and rejects replayed client_id within 7s.
    url.searchParams.set("timestamp", String(Math.floor(Date.now() / 1000)));
    url.searchParams.set("client_id", randomUUID());

    const res = await fetch(url, {
      headers: {
        "X-APIKEY": this.apiKey,
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
      },
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    const text = await res.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      throw new ApiError(`Respons bukan JSON (HTTP ${res.status}): ${text.slice(0, 200)}`, res.status, text);
    }

    if (res.status === 429 || body?.error === "RATE_LIMIT_BANNED") {
      const header = Number(res.headers.get("x-ratelimit-reset"));
      throw new RateLimitError(body?.reset_at ?? (Number.isFinite(header) ? header : null));
    }
    if (!res.ok) {
      throw new ApiError(body?.msg || body?.error || `HTTP ${res.status}`, res.status, body);
    }
    return unwrap(body);
  }

  // GET /v1/market/rank — token teratas per interval.
  // `extra` menerima min_*/max_* server-side (min_volume, min_marketcap, ...).
  async rank(chain, interval, extra = {}) {
    const data = await this.get("/v1/market/rank", { chain, interval, ...extra });
    return data?.rank ?? [];
  }

  // GET /v1/token/info — dipakai mode --deep untuk volume beli/jual USD & stat wallet.
  async tokenInfo(chain, address) {
    return this.get("/v1/token/info", { chain, address });
  }
}
