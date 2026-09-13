import { EVM_CHAINS } from "./gmgn.js";

// Angka yang hilang / null / string kosong TIDAK boleh jadi 0 — itu "belum diketahui".
export function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

// 1 = ya, 0 = tidak, -1 / null / hilang = belum diuji.
export function tri(v) {
  if (v === true) return true;
  if (v === false) return false;
  const n = num(v);
  if (n === null || n === -1) return null;
  return n === 1;
}

export function normalize(raw, chain, interval) {
  const created = num(raw.creation_timestamp) || num(raw.open_timestamp) || 0;
  const buys = num(raw.buys);
  const sells = num(raw.sells);
  const totalSwaps = buys !== null && sells !== null ? buys + sells : null;
  const volume = num(raw.volume);
  const liquidity = num(raw.liquidity);
  const intervalKey = { "1m": "price_change_percent1m", "5m": "price_change_percent5m", "1h": "price_change_percent1h" }[interval];

  return {
    chain,
    interval,
    address: raw.address,
    symbol: raw.symbol || raw.name || "?",
    name: raw.name || "",
    volume,
    marketCap: num(raw.market_cap),
    liquidity,
    // Turnover kasar: berapa kali likuiditas terlaporkan berputar dalam interval ini.
    turnover: volume !== null && liquidity ? volume / liquidity : null,
    ageSeconds: created > 0 ? Math.max(0, Math.floor(Date.now() / 1000) - created) : null,
    priceChangePercent: num(raw[intervalKey]) ?? num(raw.price_change_percent),
    price: num(raw.price),
    swaps: num(raw.swaps) ?? totalSwaps,
    buys,
    sells,
    // Berbasis JUMLAH swap, bukan nilai USD. Mode --deep menimpanya dengan porsi USD.
    sellShare: totalSwaps ? sells / totalSwaps : null,
    sellShareSource: "jumlah swap",
    holderCount: num(raw.holder_count),
    top10HolderRate: num(raw.top_10_holder_rate),
    rugRatio: num(raw.rug_ratio),
    insiderRate: num(raw.insider_rate),
    bundlerRate: num(raw.bundler_rate),
    botDegenRate: num(raw.bot_degen_rate),
    entrapmentRatio: num(raw.entrapment_ratio),
    sniperCount: num(raw.sniper_count),
    top70SniperHoldRate: num(raw.top70_sniper_hold_rate),
    devTeamHoldRate: num(raw.dev_team_hold_rate),
    smartDegenCount: num(raw.smart_degen_count),
    renownedCount: num(raw.renowned_count),
    botDegenCount: num(raw.bot_degen_count),
    isWashTrading: raw.is_wash_trading === true ? true : raw.is_wash_trading === false ? false : null,
    isHoneypot: tri(raw.is_honeypot),
    // Solana: renounced_mint / renounced_freeze_account. EVM: is_renounced / is_open_source.
    renouncedMint: EVM_CHAINS.has(chain) ? null : tri(raw.renounced_mint),
    renouncedFreeze: EVM_CHAINS.has(chain) ? null : tri(raw.renounced_freeze_account),
    isRenounced: EVM_CHAINS.has(chain) ? tri(raw.is_renounced) : null,
    isOpenSource: EVM_CHAINS.has(chain) ? tri(raw.is_open_source) : null,
    buyTax: num(raw.buy_tax),
    sellTax: num(raw.sell_tax),
    lockPercent: num(raw.lock_percent),
    burnRatio: num(raw.burn_ratio),
    creatorTokenStatus: raw.creator_token_status || null,
    creatorClose: raw.creator_close === true || raw.creator_token_status === "creator_close",
    launchpad: raw.launchpad_platform || raw.launchpad || null,
    exchange: raw.exchange || null,
    twitterRenameCount: num(raw.twitter_rename_count),
    ctoFlag: num(raw.cto_flag),
    links: { twitter: raw.twitter_username || null, website: raw.website || null, telegram: raw.telegram || null },
    deep: null,
  };
}

// Tambahan dari /v1/token/info (mode --deep): porsi jual dalam USD + stat trader.
export function mergeDeep(token, info, interval) {
  const p = info?.price ?? {};
  const s = info?.stat ?? {};
  const w = info?.wallet_tags_stat ?? {};
  const suffix = interval === "24h" || interval === "6h" ? interval : interval;
  const buyVol = num(p[`buy_volume_${suffix}`]);
  const sellVol = num(p[`sell_volume_${suffix}`]);

  token.deep = {
    buyVolume: buyVol,
    sellVolume: sellVol,
    volume: num(p[`volume_${suffix}`]),
    freshWalletRate: num(s.fresh_wallet_rate),
    entrapmentPercentage: num(s.top_entrapment_trader_percentage),
    botDegenPercentage: num(s.top_bot_degen_percentage),
    bundlerPercentage: num(s.top_bundler_trader_percentage),
    ratTraderPercentage: num(s.top_rat_trader_percentage),
    creatorHoldRate: num(s.creator_hold_rate),
    smartWallets: num(w.smart_wallets),
    sniperWallets: num(w.sniper_wallets),
    bundlerWallets: num(w.bundler_wallets),
    whaleWallets: num(w.whale_wallets),
    poolExchange: info?.pool?.exchange || null,
    // pool.liquidity = jumlah dua sisi cadangan; bagi 2 untuk perkiraan kedalaman satu sisi.
    oneSidedDepth: num(info?.pool?.liquidity) !== null ? num(info.pool.liquidity) / 2 : null,
  };
  if (buyVol !== null && sellVol !== null && buyVol + sellVol > 0) {
    token.sellShare = sellVol / (buyVol + sellVol);
    token.sellShareSource = "nilai USD";
  }
  if (token.top10HolderRate === null) token.top10HolderRate = num(s.top_10_holder_rate);
  return token;
}

// Ambang hard-skip / pass mengikuti panduan screening GMGN.
export function classify(token) {
  const skips = [];
  const warns = [];
  const goods = [];

  if (token.isHoneypot === true) skips.push("terdeteksi honeypot (is_honeypot=1)");
  if (token.isWashTrading === true) skips.push("ditandai wash trading oleh GMGN");
  if (token.rugRatio !== null && token.rugRatio > 0.3) skips.push(`skor indikasi rug ${(token.rugRatio * 100).toFixed(1)}% di atas 30%`);

  if (token.rugRatio !== null && token.rugRatio >= 0.1 && token.rugRatio <= 0.3) warns.push(`skor indikasi rug ${(token.rugRatio * 100).toFixed(1)}% (zona 10–30%)`);
  if (token.botDegenRate !== null && token.botDegenRate > 0.3) warns.push(`wallet berlabel bot/degen ${(token.botDegenRate * 100).toFixed(0)}%`);
  if (token.bundlerRate !== null && token.bundlerRate > 0.2) warns.push(`aktivitas berlabel bundler ${(token.bundlerRate * 100).toFixed(1)}%`);
  if (token.entrapmentRatio !== null && token.entrapmentRatio > 0.2) warns.push(`entrapment/phishing ${(token.entrapmentRatio * 100).toFixed(0)}% — definisi metode GMGN tidak dipublikasi`);
  if (token.top10HolderRate !== null && token.top10HolderRate > 0.3) warns.push(`10 holder terbesar pegang ${(token.top10HolderRate * 100).toFixed(0)}% supply`);
  if (token.top70SniperHoldRate !== null && token.top70SniperHoldRate > 0.1) warns.push(`sniper top-70 masih pegang ${(token.top70SniperHoldRate * 100).toFixed(1)}%`);
  if (token.devTeamHoldRate !== null && token.devTeamHoldRate > 0.1) warns.push(`tim dev pegang ${(token.devTeamHoldRate * 100).toFixed(1)}%`);
  if (token.ageSeconds !== null && token.ageSeconds < 3600) warns.push("umur token di bawah 1 jam — data on-chain masih tipis");
  if (token.ageSeconds === null) warns.push("umur token tidak diketahui (creation_timestamp = 0)");
  if (token.twitterRenameCount !== null && token.twitterRenameCount > 0) warns.push(`akun X pernah ganti nama ${token.twitterRenameCount}x`);
  if (token.chain === "sol") {
    if (token.renouncedMint === false) warns.push("wewenang mint belum dilepas");
    if (token.renouncedFreeze === false) warns.push("wewenang freeze account belum dilepas");
  } else {
    if (token.isRenounced === false) warns.push("ownership kontrak belum di-renounce");
    if (token.isOpenSource === false) warns.push("kontrak tidak open source");
  }

  if (token.smartDegenCount !== null && token.smartDegenCount >= 3) goods.push(`${token.smartDegenCount} wallet smart-money terdeteksi`);
  if (token.renownedCount) goods.push(`${token.renownedCount} wallet KOL/ternama`);
  if (token.creatorClose) goods.push("dev sudah clear posisi (creator_close)");
  if (token.rugRatio !== null && token.rugRatio < 0.1) goods.push(`skor indikasi rug rendah ${(token.rugRatio * 100).toFixed(1)}%`);

  // Cek kelengkapan data per chain — kosong bukan berarti aman.
  const missing = [];
  if (token.rugRatio === null) missing.push("rug_ratio");
  if (token.top10HolderRate === null) missing.push("top_10_holder_rate");
  if (token.isHoneypot === null) missing.push("is_honeypot belum diuji");
  if (EVM_CHAINS.has(token.chain)) {
    if (token.buyTax === null || token.sellTax === null) missing.push("pajak beli/jual belum diuji");
  }

  let tier = "WATCH";
  if (skips.length) tier = "SKIP";
  else if (
    token.smartDegenCount !== null && token.smartDegenCount >= 3 &&
    token.rugRatio !== null && token.rugRatio < 0.1 &&
    token.creatorClose &&
    token.isWashTrading === false
  ) tier = "PASS";

  return { tier, skips, warns, goods, missing };
}

// Pengecekan filter pindah ke filters.js supaya satu tabel dipakai bersama
// oleh parser CLI, config, query server, dan pengecekan ulang di sisi klien.
