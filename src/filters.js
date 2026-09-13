// Satu tabel untuk semua filter: dipakai bersamaan oleh parser CLI, pembaca config,
// pembangun query GMGN, dan pengecekan ulang di sisi klien. Menambah filter = tambah satu baris.
//
// - `api`   : nama parameter server GMGN (null = hanya bisa dicek di sisi klien)
// - `field` : nama field pada token hasil normalisasi
// - `cmp`   : "gte" untuk ambang minimum, "lte" untuk ambang maksimum
// - `unit`  : "usd" | "count" | "ratio" (0–1) | "percent" | "duration"
export const FILTER_SPEC = [
  { key: "minVolume",       cli: "min-volume",        api: "min_volume",              field: "volume",              cmp: "gte", unit: "usd",   desc: "volume pada interval" },
  { key: "maxVolume",       cli: "max-volume",        api: "max_volume",              field: "volume",              cmp: "lte", unit: "usd",   desc: "volume pada interval" },
  { key: "minMcap",         cli: "min-mcap",          api: "min_marketcap",           field: "marketCap",           cmp: "gte", unit: "usd",   desc: "market cap" },
  { key: "maxMcap",         cli: "max-mcap",          api: "max_marketcap",           field: "marketCap",           cmp: "lte", unit: "usd",   desc: "market cap" },
  { key: "minLiquidity",    cli: "min-liquidity",     api: "min_liquidity",           field: "liquidity",           cmp: "gte", unit: "usd",   desc: "likuiditas" },
  { key: "maxLiquidity",    cli: "max-liquidity",     api: "max_liquidity",           field: "liquidity",           cmp: "lte", unit: "usd",   desc: "likuiditas" },
  { key: "minHolder",       cli: "min-holder",        api: "min_holder_count",        field: "holderCount",         cmp: "gte", unit: "count", desc: "jumlah holder" },
  { key: "maxHolder",       cli: "max-holder",        api: "max_holder_count",        field: "holderCount",         cmp: "lte", unit: "count", desc: "jumlah holder" },
  { key: "minSwaps",        cli: "min-swaps",         api: "min_swaps",               field: "swaps",               cmp: "gte", unit: "count", desc: "jumlah swap pada interval" },
  { key: "maxSwaps",        cli: "max-swaps",         api: "max_swaps",               field: "swaps",               cmp: "lte", unit: "count", desc: "jumlah swap pada interval" },
  { key: "minSmartDegen",   cli: "min-smart-degen",   api: "min_smart_degen_count",   field: "smartDegenCount",     cmp: "gte", unit: "count", desc: "wallet smart-money" },
  { key: "minRenowned",     cli: "min-renowned",      api: "min_renowned_count",      field: "renownedCount",       cmp: "gte", unit: "count", desc: "wallet KOL/ternama" },
  { key: "maxBotDegen",     cli: "max-bot-degen",     api: "max_bot_degen_count",     field: "botDegenCount",       cmp: "lte", unit: "count", desc: "wallet bot/degen" },
  { key: "minTurnover",     cli: "min-turnover",      api: null,                      field: "turnover",            cmp: "gte", unit: "count", desc: "volume ÷ likuiditas (dihitung lokal)" },
  { key: "maxTurnover",     cli: "max-turnover",      api: null,                      field: "turnover",            cmp: "lte", unit: "count", desc: "volume ÷ likuiditas (dihitung lokal)" },
  { key: "maxRugRatio",     cli: "max-rug-ratio",     api: null,                      field: "rugRatio",            cmp: "lte", unit: "ratio", desc: "skor indikasi rug GMGN" },
  { key: "maxTop10Rate",    cli: "max-top10-rate",    api: "max_top10_holder_rate",   field: "top10HolderRate",     cmp: "lte", unit: "ratio", desc: "porsi 10 holder terbesar" },
  { key: "maxInsiderRate",  cli: "max-insider-rate",  api: "max_insider_rate",        field: "insiderRate",         cmp: "lte", unit: "ratio", desc: "aktivitas berlabel insider" },
  { key: "maxBundlerRate",  cli: "max-bundler-rate",  api: "max_bundler_rate",        field: "bundlerRate",         cmp: "lte", unit: "ratio", desc: "aktivitas berlabel bundler" },
  { key: "maxEntrapment",   cli: "max-entrapment",    api: "max_entrapment_ratio",    field: "entrapmentRatio",     cmp: "lte", unit: "ratio", desc: "rasio entrapment/phishing" },
  { key: "maxSniperHold",   cli: "max-sniper-hold",   api: "max_top70_sniper_hold_rate", field: "top70SniperHoldRate", cmp: "lte", unit: "ratio", desc: "porsi sniper top-70" },
  { key: "maxDevHold",      cli: "max-dev-hold",      api: "max_dev_team_hold_rate",  field: "devTeamHoldRate",     cmp: "lte", unit: "ratio", desc: "porsi tim dev" },
  { key: "minPriceChange",  cli: "min-price-change",  api: null,                      field: "priceChangePercent",  cmp: "gte", unit: "percent", desc: "perubahan harga pada interval" },
  { key: "maxPriceChange",  cli: "max-price-change",  api: null,                      field: "priceChangePercent",  cmp: "lte", unit: "percent", desc: "perubahan harga pada interval" },
  { key: "minAge",          cli: "min-age",           api: "min_created",             field: "ageSeconds",          cmp: "gte", unit: "duration", desc: "umur token minimum" },
  { key: "maxAge",          cli: "max-age",           api: "max_created",             field: "ageSeconds",          cmp: "lte", unit: "duration", desc: "umur token maksimum" },
];

export const FILTER_BY_KEY = new Map(FILTER_SPEC.map((f) => [f.key, f]));
export const FILTER_BY_CLI = new Map(FILTER_SPEC.map((f) => [f.cli, f]));

const AGE_UNIT = { m: 60, h: 3600, d: 86400 };

export function durationToSeconds(s) {
  if (typeof s !== "string" || !/^\d+[mhd]$/.test(s)) return null;
  return Number(s.slice(0, -1)) * AGE_UNIT[s.slice(-1)];
}

// Parameter min_*/max_* yang dimengerti server GMGN. Sisanya dicek lokal.
export function toQuery(values) {
  const query = {};
  for (const [key, value] of Object.entries(values)) {
    const spec = FILTER_BY_KEY.get(key);
    if (!spec || !spec.api || value === null || value === undefined) continue;
    query[spec.api] = value;
  }
  return query;
}

// Ambang risiko (cmp "lte" pada rasio) memperlakukan nilai yang belum diketahui sebagai
// TIDAK lolos — sama seperti perilaku server GMGN, dan supaya "belum diuji" tidak
// diperlakukan seperti "aman". Ambang minimum juga menolak nilai yang belum diketahui.
export function passesFilters(token, values) {
  for (const [key, value] of Object.entries(values)) {
    if (value === null || value === undefined) continue;
    const spec = FILTER_BY_KEY.get(key);
    if (!spec) continue;

    const threshold = spec.unit === "duration" ? durationToSeconds(value) : Number(value);
    if (threshold === null || !Number.isFinite(threshold)) continue;

    const actual = token[spec.field];
    if (actual === null || actual === undefined) return false;
    if (spec.cmp === "gte" && actual < threshold) return false;
    if (spec.cmp === "lte" && actual > threshold) return false;
  }
  return true;
}

export function describeFilters(values) {
  const parts = [];
  for (const spec of FILTER_SPEC) {
    const v = values[spec.key];
    if (v === null || v === undefined) continue;
    const sign = spec.cmp === "gte" ? "≥" : "≤";
    const shown = spec.unit === "ratio" ? `${(Number(v) * 100).toFixed(1)}%`
      : spec.unit === "usd" ? `$${Number(v).toLocaleString("en-US")}`
      : spec.unit === "percent" ? `${v}%`
      : String(v);
    parts.push(`${spec.desc} ${sign} ${shown}`);
  }
  return parts.length ? parts.join(" • ") : "tanpa filter";
}
