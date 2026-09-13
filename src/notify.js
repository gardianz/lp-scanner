// Sink notifikasi. Terminal tidak berguna di VPS 24 jam, jadi kartu dikirim keluar.
// Konfigurasi lewat env: TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID, dan/atau DISCORD_WEBHOOK_URL.

const TELEGRAM_LIMIT = 4000;  // batas keras 4096, sisakan ruang
const DISCORD_LIMIT = 1900;   // batas keras 2000

export function log(level, msg) {
  const line = `${new Date().toISOString()} [${level}] ${msg}`;
  if (level === "error" || level === "warn") console.error(line);
  else console.error(line);
}

const COPY_START = "\u0001";
const COPY_END = "\u0002";

// Potongan pesan bisa jatuh di tengah penanda salin. Tutup di ujung potongan dan
// buka lagi di potongan berikutnya, supaya tag tidak pernah menggantung.
function balanceCopyMarks(part) {
  let out = part;
  const first = out.indexOf(COPY_START);
  const firstEnd = out.indexOf(COPY_END);
  if (firstEnd !== -1 && (first === -1 || firstEnd < first)) out = COPY_START + out;
  const opens = (out.match(/\u0001/g) ?? []).length;
  const closes = (out.match(/\u0002/g) ?? []).length;
  if (opens > closes) out += COPY_END;
  return out;
}

const escapeHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Telegram: <code> bisa diketuk untuk menyalin — itu gunanya penanda ini untuk CA.
export function toTelegramHtml(part) {
  return escapeHtml(balanceCopyMarks(part))
    .split(COPY_START).join("<code>")
    .split(COPY_END).join("</code>");
}

export function toDiscordMarkdown(part) {
  return balanceCopyMarks(part)
    .split(COPY_START).join("`")
    .split(COPY_END).join("`");
}

export const stripCopyMarks = (s) => s.split(COPY_START).join("").split(COPY_END).join("");

// Potong per baris supaya kartu tidak terbelah di tengah baris. Baris yang sendirian
// sudah melebihi limit dipecah paksa — dipotong begitu saja berarti isinya hilang diam-diam.
export function chunk(text, limit) {
  const out = [];
  let buf = "";
  const flush = () => { if (buf) { out.push(buf); buf = ""; } };

  for (const line of text.split("\n")) {
    const pieces = [];
    for (let i = 0; i < line.length || line.length === 0; i += limit) {
      pieces.push(line.slice(i, i + limit));
      if (line.length === 0) break;
    }
    for (const piece of pieces) {
      if (buf && buf.length + piece.length + 1 > limit) flush();
      buf = buf ? `${buf}\n${piece}` : piece;
    }
  }
  flush();
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class TelegramSink {
  constructor(token, chatId) {
    this.name = "telegram";
    this.token = token;
    this.chatId = chatId;
  }

  async send(text) {
    for (const part of chunk(text, TELEGRAM_LIMIT)) {
      await this.post(toTelegramHtml(part));
    }
  }

  async post(text, attempt = 1) {
    const res = await fetch(`https://api.telegram.org/bot${this.token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: this.chatId,
        text,
        parse_mode: "HTML", // <code> di sekitar CA = ketuk untuk salin
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (res.status === 429 && attempt <= 3) {
      const body = await res.json().catch(() => null);
      const waitS = body?.parameters?.retry_after ?? 5;
      log("warn", `telegram rate limit, tunggu ${waitS}s`);
      await sleep(waitS * 1000);
      return this.post(text, attempt + 1);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`telegram HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
  }
}

class DiscordSink {
  constructor(url) {
    this.name = "discord";
    this.url = url;
  }

  async send(text) {
    for (const part of chunk(text, DISCORD_LIMIT)) {
      const res = await fetch(this.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: toDiscordMarkdown(part) }),
        signal: AbortSignal.timeout(15000),
      });
      if (res.status === 429) {
        const body = await res.json().catch(() => null);
        const waitMs = (body?.retry_after ?? 2) * 1000;
        log("warn", `discord rate limit, tunggu ${Math.ceil(waitMs / 1000)}s`);
        await sleep(waitMs);
        continue;
      }
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`discord HTTP ${res.status}: ${body.slice(0, 200)}`);
      }
    }
  }
}

class StdoutSink {
  constructor() {
    this.name = "stdout";
  }

  async send(text) {
    console.log(stripCopyMarks(text));
  }
}

export function buildSinks({ forceStdout = false } = {}) {
  const sinks = [];
  const tgToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const tgChat = process.env.TELEGRAM_CHAT_ID?.trim();
  const discord = process.env.DISCORD_WEBHOOK_URL?.trim();

  if (tgToken && tgChat) sinks.push(new TelegramSink(tgToken, tgChat));
  else if (tgToken || tgChat) log("warn", "TELEGRAM_BOT_TOKEN dan TELEGRAM_CHAT_ID harus diisi berdua — sink telegram dilewati");
  if (discord) sinks.push(new DiscordSink(discord));
  if (forceStdout || sinks.length === 0) sinks.push(new StdoutSink());
  return sinks;
}

// Satu sink gagal tidak boleh menjatuhkan loop atau memblokir sink lain.
export async function deliver(sinks, text) {
  const results = await Promise.allSettled(sinks.map((s) => s.send(text)));
  results.forEach((r, i) => {
    if (r.status === "rejected") log("error", `sink ${sinks[i].name} gagal: ${r.reason?.message ?? r.reason}`);
  });
  return results.filter((r) => r.status === "fulfilled").length;
}
