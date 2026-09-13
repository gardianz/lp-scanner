#!/usr/bin/env node
import { homedir } from "node:os";
import { join, isAbsolute, resolve } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { GmgnClient, RateLimitError, ApiError, resolveApiKey, CHAINS, INTERVALS } from "./gmgn.js";
import { normalize, mergeDeep, classify } from "./screen.js";
import { FILTER_SPEC, FILTER_BY_CLI, toQuery, passesFilters, describeFilters } from "./filters.js";
import { formatCard, formatSummary, usd } from "./format.js";
import { buildSinks, deliver, log } from "./notify.js";
import { createPollState } from "./state.js";

const DEEP_CAP = 20; // batas panggilan /v1/token/info per scan, jaga jatah rate limit

const FILTER_HELP = FILTER_SPEC
  .map((f) => `  --${f.cli} <${f.unit === "duration" ? "30m|6h|7d" : f.unit === "ratio" ? "0–1" : f.unit}>`.padEnd(34) + `${f.desc}${f.api ? "" : " (lokal)"}`)
  .join("\n");

const HELP = `lp-scanner — scanner token volume interval pendek via GMGN OpenAPI

Pakai:
  node src/cli.js [opsi]

Sumber pengaturan, urutan menang: flag CLI > file config > default bawaan.
config.json di root proyek dipakai otomatis kalau ada.
  --config <path>          pakai file config lain
  --no-config              abaikan config.json, pakai default + flag saja

Pasar:
  --chain <daftar>         satu atau banyak chain dipisah koma (default sol)
                           pilihan: ${CHAINS.join(" / ")}
  --interval <${INTERVALS.join("|")}>        default 5m

Filter (kosong = mati):
${FILTER_HELP}

Keluaran:
  --sort <volume|turnover|mcap|holder>   urutan hasil (default volume)
  --limit <n>              token diambil per chain, maks 100 (default 100)
  --top <n>                kartu detail dikirim per chain (default 5)
  --include-skip           ikut kirim token bertier SKIP
  --lp-size <usd>          ukuran posisi LP-mu, untuk hitung porsi pool
  --fee-bps <bps>          fee pool dalam basis poin (100 = 1%), perlu --lp-size
  --json                   keluarkan JSON, bukan kartu teks
  --stdout                 tetap cetak kartu ke stdout walau sink lain aktif

Jalan:
  --deep                   ambil /v1/token/info per kandidat (porsi jual USD + stat wallet)
  --watch <detik>          scan berulang tiap N detik (minimum 10)
  --confirm <n>            kirim hanya jika token muncul di n scan terakhir (default 1)
  --window <n>             panjang jendela polling (default 3)
  --cooldown <menit>       jangan kirim ulang token sama dalam N menit (default 30)
  --pace <ms>              jeda minimum antar request GMGN (default 1000)
  --state-file <path>      simpan state polling/cooldown (default ./state.json)
  --no-state               jangan simpan state ke disk
  --demo                   pakai demo key publik GMGN (read-only, rate limit ketat)
  --help

Env:
  GMGN_API_KEY             wajib (atau pakai gmgn-cli config --apply <key>)
  TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID   kirim kartu ke Telegram
  DISCORD_WEBHOOK_URL      kirim kartu ke Discord
`;

const DEFAULTS = {
  chains: ["sol"],
  interval: "5m",
  sort: "volume",
  limit: 100,
  top: 5,
  includeSkip: false,
  deep: false,
  watch: null,
  confirm: 1,
  window: 3,
  cooldown: 30,
  stdout: false,
  json: false,
  demo: false,
  lpSize: null,
  feeBps: null,
  stateFile: null, // diisi default di parseArgs kalau config/CLI tidak menyebutnya
  paceMs: 1000,    // jeda minimum antar request GMGN
  filters: { minVolume: 300000, minMcap: 500000 },
};

const SORT_KEY = {
  volume: (t) => t.volume ?? 0,
  turnover: (t) => t.turnover ?? 0,
  mcap: (t) => t.marketCap ?? 0,
  holder: (t) => t.holderCount ?? 0,
};

function die(msg) {
  console.error(`[lp-scanner] ${msg}`);
  process.exit(1);
}

function readConfig(path) {
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    die(`Config ${path} tidak terbaca: ${err.message}`);
  }
  const o = {};
  const known = new Set([...Object.keys(DEFAULTS), "chain"]);
  for (const [k, v] of Object.keys(raw).length ? Object.entries(raw) : []) {
    if (k === "filters") {
      for (const fk of Object.keys(v ?? {})) {
        if (![...FILTER_SPEC].some((f) => f.key === fk)) die(`Config: filter "${fk}" tidak dikenal`);
      }
      o.filters = { ...v };
    } else if (k === "chain" || k === "chains") {
      o.chains = Array.isArray(v) ? v : String(v).split(",").map((s) => s.trim()).filter(Boolean);
    } else if (known.has(k)) {
      o[k] = v;
    } else {
      die(`Config: kunci "${k}" tidak dikenal`);
    }
  }
  return o;
}

function parseArgs(argv) {
  // --config dibaca lebih dulu supaya flag CLI bisa menimpanya. Tanpa --config,
  // config.json di root proyek dipakai otomatis kalau ada — file config yang tergeletak
  // di sana tapi diam-diam diabaikan hanya bikin bingung. --no-config melewatinya.
  const configIndex = argv.indexOf("--config");
  const autoPath = new URL("../config.json", import.meta.url).pathname;
  const configPath = configIndex !== -1 ? argv[configIndex + 1]
    : argv.includes("--no-config") ? null
    : existsSync(autoPath) ? autoPath
    : null;
  const fromConfig = configPath ? readConfig(configPath) : {};
  const o = {
    ...DEFAULTS,
    ...fromConfig,
    filters: { ...DEFAULTS.filters, ...(fromConfig.filters ?? {}) },
    stateFile: fromConfig.stateFile === undefined ? "state.json" : fromConfig.stateFile,
    configPath,
  };

  const flagNum = (v, name) => {
    const n = Number(v);
    if (!Number.isFinite(n)) die(`Nilai --${name} tidak valid: ${v}`);
    return n;
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];

    if (a.startsWith("--")) {
      const spec = FILTER_BY_CLI.get(a.slice(2));
      if (spec) {
        const v = next();
        // "off" mematikan filter yang diwarisi dari file config — tanpa ini,
        // filter di config tidak bisa dibatalkan dari baris perintah.
        if (v === "off" || v === "none") delete o.filters[spec.key];
        else o.filters[spec.key] = spec.unit === "duration" ? v : flagNum(v, spec.cli);
        continue;
      }
    }

    switch (a) {
      case "--help": case "-h": console.log(HELP); process.exit(0); break;
      case "--config": next(); break;   // sudah diproses di atas
      case "--no-config": break;        // idem
      case "--chain": o.chains = next().split(",").map((s) => s.trim()).filter(Boolean); break;
      case "--interval": o.interval = next(); break;
      case "--sort": o.sort = next(); break;
      case "--limit": o.limit = flagNum(next(), "limit"); break;
      case "--top": o.top = flagNum(next(), "top"); break;
      case "--include-skip": o.includeSkip = true; break;
      case "--lp-size": o.lpSize = flagNum(next(), "lp-size"); break;
      case "--fee-bps": o.feeBps = flagNum(next(), "fee-bps"); break;
      case "--deep": o.deep = true; break;
      case "--watch": o.watch = flagNum(next(), "watch"); break;
      case "--confirm": o.confirm = flagNum(next(), "confirm"); break;
      case "--window": o.window = flagNum(next(), "window"); break;
      case "--cooldown": o.cooldown = flagNum(next(), "cooldown"); break;
      case "--pace": o.paceMs = flagNum(next(), "pace"); break;
      case "--state-file": o.stateFile = next(); break;
      case "--no-state": o.stateFile = null; break;
      case "--stdout": o.stdout = true; break;
      case "--json": o.json = true; break;
      case "--demo": o.demo = true; break;
      default: die(`Opsi tidak dikenal: ${a}\n\n${HELP}`);
    }
  }

  for (const chain of o.chains) {
    if (!CHAINS.includes(chain)) die(`Chain "${chain}" tidak didukung. Pilihan: ${CHAINS.join(", ")}`);
  }
  if (!o.chains.length) die("--chain kosong");
  if (!INTERVALS.includes(o.interval)) die(`--interval harus salah satu dari: ${INTERVALS.join(", ")}`);
  if (!SORT_KEY[o.sort]) die(`--sort harus salah satu dari: ${Object.keys(SORT_KEY).join(", ")}`);
  if (o.limit < 1 || o.limit > 100) die("--limit harus 1–100 (batas GMGN)");
  if (o.window < 1) die("--window minimal 1");
  if (o.confirm > o.window) die("--confirm tidak boleh lebih besar dari --window");
  // --watch 0 mematikan mode watch, satu-satunya cara membatalkan `watch` dari file config.
  if (o.watch === 0) o.watch = null;
  if (o.watch !== null && o.watch < 10) die("--watch minimal 10 detik (hormati rate limit GMGN), atau 0 untuk sekali jalan");
  if (o.feeBps !== null && o.lpSize === null) die("--fee-bps perlu --lp-size");
  for (const spec of FILTER_SPEC) {
    const v = o.filters[spec.key];
    if (v === null || v === undefined) continue;
    if (spec.unit === "duration" && !/^\d+[mhd]$/.test(String(v))) {
      die(`--${spec.cli} harus durasi bersatuan, contoh 30m / 6h / 7d`);
    }
    if (spec.unit === "ratio" && (Number(v) < 0 || Number(v) > 1)) {
      die(`--${spec.cli} memakai rasio 0–1 (mis. 0.3 untuk 30%), bukan ${v}`);
    }
  }
  // Path relatif menempel ke root proyek, bukan direktori kerja: jalan dari mana pun
  // (systemd, cron, folder lain) tetap membaca dan menulis state yang sama.
  if (o.stateFile && !isAbsolute(o.stateFile)) {
    o.stateFile = resolve(new URL("..", import.meta.url).pathname, o.stateFile);
  }
  if (o.lpSize !== null && o.feeBps === null) {
    log("warn", "--lp-size tanpa --fee-bps: hanya porsi pool yang dihitung, estimasi fee dilewati (fee_ratio GMGN unitnya tidak terdokumentasi)");
  }
  return o;
}

// .env proyek selalu dimuat — isinya bukan cuma key GMGN, ada kredensial notifikasi juga.
// Nilai yang sudah ada di environment tetap menang (perilaku process.loadEnvFile).
function loadEnvFile() {
  try { process.loadEnvFile(new URL("../.env", import.meta.url).pathname); } catch { /* opsional */ }
  if (process.env.GMGN_API_KEY?.trim()) return;
  // Cadangan: config gmgn-cli. Hanya GMGN_API_KEY yang diambil — GMGN_PRIVATE_KEY di sana
  // milik jalur swap bertanda tangan dan tidak pernah dibutuhkan tool baca-saja ini.
  try {
    const text = readFileSync(join(homedir(), ".config", "gmgn", ".env"), "utf8");
    const hit = text.match(/^\s*GMGN_API_KEY\s*=\s*(.+?)\s*$/m);
    if (hit) process.env.GMGN_API_KEY = hit[1].replace(/^["']|["']$/g, "");
  } catch { /* opsional */ }
}

// Porsi pool = berapa bagian fee yang jatuh ke posisimu. `liquidity` GMGN adalah jumlah
// dua sisi cadangan, jadi ini perkiraan kasar — bukan angka pasti dari pool.
function lpProjection(token, o) {
  if (o.lpSize === null || !token.liquidity) return null;
  const share = o.lpSize / (token.liquidity + o.lpSize);
  const fee = o.feeBps === null || token.volume === null
    ? null
    : token.volume * (o.feeBps / 10000) * share;
  return { size: o.lpSize, share, feeBps: o.feeBps, fee };
}

async function scanChain(client, chain, o) {
  const raw = await client.rank(chain, o.interval, {
    limit: o.limit,
    order_by: "volume",
    direction: "desc",
    ...toQuery(o.filters),
  });

  // Filter server GMGN diperlakukan sebagai saringan kasar; nilainya dicek ulang di sini.
  const tokens = raw
    .map((r) => normalize(r, chain, o.interval))
    .filter((t) => passesFilters(t, o.filters));
  tokens.sort((a, b) => SORT_KEY[o.sort](b) - SORT_KEY[o.sort](a));

  if (o.deep) {
    for (const t of tokens.slice(0, Math.min(o.top || tokens.length, DEEP_CAP))) {
      try {
        mergeDeep(t, await client.tokenInfo(chain, t.address), o.interval);
      } catch (err) {
        if (err instanceof RateLimitError) throw err;
        t.deepError = err.message;
      }
    }
  }
  return { chain, scanned: raw.length, tokens };
}

function buildOutput(chain, result, o, pollState) {
  const rows = result.tokens.map((token) => ({ token, verdict: classify(token) }));
  const visible = rows.filter((r) => o.includeSkip || r.verdict.tier !== "SKIP");
  // State dikunci per chain: alamat yang sama bisa muncul di beberapa chain EVM.
  const stateKey = (t) => `${chain}:${t.address}`;

  if (o.json) {
    return {
      visible,
      json: {
        chain,
        returned_by_gmgn: result.scanned,
        passed: visible.length,
        tokens: visible.map((r) => ({
          ...r.token,
          tier: r.verdict.tier,
          verdict: r.verdict,
          poll_hits: pollState.hits(stateKey(r.token)),
          lp: lpProjection(r.token, o),
        })),
      },
      cards: [],
    };
  }

  const cards = visible
    .slice(0, o.top)
    .filter((r) => pollState.shouldAlert(stateKey(r.token), o))
    .map((r) => {
      const card = formatCard(r.token, r.verdict, {
        pollHits: pollState.hits(stateKey(r.token)),
        pollWindow: o.window,
        lp: lpProjection(r.token, o),
      });
      return r.token.deepError ? `${card}\n⚠ Detail --deep gagal diambil: ${r.token.deepError}` : card;
    });

  return { visible, json: null, summary: formatSummary(visible, { ...o, chain }), cards };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  loadEnvFile();
  const o = parseArgs(process.argv.slice(2));
  const auth = resolveApiKey({ demo: o.demo });
  if (!auth) {
    console.error(`[lp-scanner] GMGN_API_KEY belum ada.

Ambil API key gratis:
  1. gmgn-cli config          # buat keypair Ed25519 + link pembuatan API key
  2. Buka link itu, salin API KEY
  3. gmgn-cli config --apply <key>   # tersimpan di ~/.config/gmgn/.env, dibaca otomatis di sini

Tanpa gmgn-cli: daftar di https://gmgn.ai/ai lalu
  echo 'GMGN_API_KEY=<key-mu>' > ${new URL("../.env", import.meta.url).pathname}

Mau coba dulu tanpa key: tambahkan --demo (demo key publik, read-only, rate limit ketat).`);
    process.exit(1);
  }
  if (auth.source === "demo") log("warn", "pakai demo key publik GMGN — read-only, dipakai ramai, rate limit ketat");

  const client = new GmgnClient(auth.key, { minIntervalMs: o.paceMs });
  const pollState = createPollState(o.stateFile);
  const sinks = o.json ? [] : buildSinks({ forceStdout: o.stdout });
  if (!o.json) {
    if (o.configPath) log("info", `config: ${o.configPath}`);
    log("info", `chain: ${o.chains.join(", ")} • interval ${o.interval} • sink: ${sinks.map((s) => s.name).join(", ")}`);
    log("info", `filter: ${describeFilters(o.filters)}`);
  }

  let stopping = false;
  const shutdown = (sig) => {
    if (stopping) process.exit(1);
    stopping = true;
    log("info", `${sig} diterima — menyimpan state lalu keluar`);
    pollState.persist(o.cooldown);
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("unhandledRejection", (err) => log("error", `unhandled rejection: ${err?.message ?? err}`));

  const runOnce = async () => {
    const jsonChains = [];
    for (const chain of o.chains) {
      const result = await scanChain(client, chain, o);
      pollState.record(result.tokens.map((t) => `${chain}:${t.address}`), o.window, chain);
      const out = buildOutput(chain, result, o, pollState);

      if (out.json) {
        jsonChains.push(out.json);
      } else {
        console.log(out.summary);
        for (const card of out.cards) {
          if (await deliver(sinks, card) === 0) log("error", "kartu gagal terkirim ke semua sink");
        }
        log("info", `${chain}: GMGN kirim ${result.scanned} token, ${out.visible.length} lolos filter, ${out.cards.length} kartu dikirim`);
      }
    }
    pollState.persist(o.cooldown);
    if (o.json) {
      console.log(JSON.stringify({
        scanned_at: new Date().toISOString(),
        interval: o.interval,
        filters: o.filters,
        chains: jsonChains,
      }, null, 2));
    }
  };

  if (o.watch === null) {
    await runOnce();
    return;
  }

  log("info", `mode watch: scan tiap ${o.watch}s, konfirmasi ${o.confirm}/${o.window} polling, cooldown ${o.cooldown} menit`);
  let failures = 0;
  for (;;) {
    try {
      await runOnce();
      failures = 0;
    } catch (err) {
      if (err instanceof RateLimitError) {
        // Retry cepat justru memperpanjang ban, jadi tunggu sampai reset_at.
        const waitMs = err.resetAt ? Math.max(0, err.resetAt * 1000 - Date.now()) + 1000 : o.watch * 1000;
        log("warn", `${err.message} Menunggu ${Math.ceil(waitMs / 1000)} detik.`);
        await sleep(waitMs);
        continue;
      }
      if (err instanceof ApiError && err.fatal) {
        pollState.persist(o.cooldown);
        die(`Kredensial ditolak GMGN: ${err.message}. Perbaiki GMGN_API_KEY lalu start ulang — menunggu tidak akan menyembuhkannya.`);
      }
      failures += 1;
      // Backoff eksponensial supaya gangguan jaringan panjang tidak jadi banjir request.
      const backoff = Math.min(o.watch * 2 ** Math.min(failures, 5), 900) * 1000;
      log("error", `scan gagal (${failures}x): ${err.message} — coba lagi dalam ${Math.ceil(backoff / 1000)}s`);
      await sleep(backoff);
      continue;
    }
    await sleep(o.watch * 1000);
  }
}

main().catch((err) => {
  if (err instanceof RateLimitError) die(err.message);
  if (err instanceof ApiError) die(`GMGN API error: ${err.message}`);
  die(err.stack || err.message);
});
