// Penanda "bagian ini harus bisa disalin". Formatter tidak tahu tujuan akhirnya, jadi
// tiap sink yang menerjemahkan: Telegram jadi <code> (ketuk untuk salin), Discord jadi
// backtick, stdout dilepas begitu saja. Karakter kontrol, jadi tidak bentrok dengan isi kartu.
export const COPY_START = "\u0001";
export const COPY_END = "\u0002";
export const copyable = (s) => `${COPY_START}${s}${COPY_END}`;

const TIER_HEADER = {
  PASS: "🟢 PASS — LOLOS SARINGAN DASAR",
  WATCH: "🟡 WATCH — PERLU PERHATIAN",
  SKIP: "🔴 SKIP — RISIKO TINGGI",
};

export function usd(n) {
  if (n === null || n === undefined) return "belum diketahui";
  const abs = Math.abs(n);
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(2)}K`;
  if (abs >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toPrecision(3)}`;
}

export function pct(ratio, digits = 1) {
  if (ratio === null || ratio === undefined) return "belum diketahui";
  return `${(ratio * 100).toFixed(digits)}%`;
}

export function age(seconds) {
  if (seconds === null || seconds === undefined) return "belum diketahui";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const core = d > 0 ? `${d}h ${h}j ${m}m` : `${h}j ${m}m`;
  if (seconds < 1800) return `${core} • sangat baru`;
  if (seconds < 86400) return `${core} • baru`;
  return core;
}

function feeTier(turnover) {
  if (turnover === null) return ["⚪", "belum diketahui"];
  if (turnover >= 3) return ["🟠", "Tinggi"];
  if (turnover >= 1) return ["🟡", "Sedang"];
  return ["⚪", "Rendah"];
}

function safetyLine(verdict) {
  if (verdict.tier === "SKIP") return "🔴 Indikator risiko berat terdeteksi — lihat alasan di bawah";
  if (verdict.warns.length) return "🟡 Ada indikator risiko • lihat alasan di bawah";
  if (verdict.missing.length) return "🟡 Belum ada indikator risiko, tapi data belum lengkap";
  return "🟢 Tidak ada indikator risiko dari data GMGN";
}

export function formatCard(token, verdict, meta = {}) {
  const L = [];
  const iv = token.interval;
  L.push(TIER_HEADER[verdict.tier]);
  L.push("");
  L.push(`🌑 ${token.symbol}${token.name && token.name !== token.symbol ? ` (${token.name})` : ""}`);
  L.push(`🔗 ${token.chain}`);
  L.push(`📋 CA: ${copyable(token.address)}`);
  if (token.launchpad || token.exchange) L.push(`🏷 ${[token.launchpad, token.exchange].filter(Boolean).join(" • ")}`);
  L.push(`💸 Volume ${iv} ${usd(token.volume)}`);
  L.push(`📦 MCAP ${usd(token.marketCap)}`);
  L.push(`💧 Likuiditas ${usd(token.liquidity)}`);
  L.push(`🕐 Umur token ${age(token.ageSeconds)}`);
  if (token.priceChangePercent !== null) L.push(`📈 Perubahan harga ${iv}: ${token.priceChangePercent >= 0 ? "+" : ""}${token.priceChangePercent.toFixed(2)}%`);

  L.push("");
  L.push("🛡 SAFETY");
  L.push(safetyLine(verdict));
  L.push(`📦 Data wajib filter: ${verdict.missing.length ? `belum lengkap (${verdict.missing.join(", ")})` : "lengkap"}`);

  const [icon, label] = feeTier(token.turnover);
  L.push("");
  L.push("⚡ POTENSI FEE LP CEPAT");
  L.push(`${icon} ${label} — volume token ${iv} ÷ likuiditas yang dilaporkan GMGN = ${token.turnover === null ? "belum diketahui" : `${token.turnover.toFixed(2)}×`}`);
  L.push("🧭 Perkiraan kasar • belum diketahui berapa transaksi yang benar-benar masuk ke pool-mu dan berapa posisi LP-mu • bukan tanda token aman");

  if (meta.lp) {
    const lp = meta.lp;
    L.push(`💼 LP ${usd(lp.size)} → porsi pool ≈ ${pct(lp.share, 2)} (dasar: likuiditas GMGN dua sisi, perkiraan kasar)`);
    if (lp.fee !== null) {
      L.push(`🧾 Estimasi fee ${iv} ≈ ${usd(lp.fee)} @ ${lp.feeBps} bps — fee rate dari inputmu, bukan dari GMGN`);
    } else {
      L.push("🧾 Estimasi fee dilewati — isi --fee-bps sesuai fee pool yang kamu masuki (GMGN tidak memberi unit fee yang jelas)");
    }
  }

  L.push("");
  if (token.sellShare !== null) L.push(`⚖ Porsi jual ${pct(token.sellShare, 0)} (dasar: ${token.sellShareSource})`);
  if (token.swaps !== null) L.push(`🔁 Swap ${iv}: ${token.swaps} (beli ${token.buys ?? "?"} / jual ${token.sells ?? "?"})`);
  if (meta.pollHits) L.push(`🕐 Pengecekan berulang: ${meta.pollHits}/${meta.pollWindow} polling`);
  if (token.holderCount !== null) L.push(`👥 Jumlah holder: ${token.holderCount}`);

  L.push("");
  L.push("👥 10 holder terbesar: " + (token.top10HolderRate === null ? "belum diketahui" : `${pct(token.top10HolderRate, 0)} supply • angka GMGN, wallet belum dicek satu per satu`));
  L.push(`🛡 Skor indikasi rug GMGN: ${pct(token.rugRatio)}`);
  L.push(`🕵 Aktivitas berlabel insider: ${pct(token.insiderRate)} (GMGN)`);
  L.push(`📦 Aktivitas berlabel bundler: ${pct(token.bundlerRate)} (GMGN)`);
  L.push(`🤖 Wallet berlabel bot/degen: ${pct(token.botDegenRate, 0)} (GMGN)`);
  L.push(`🎯 Wallet berlabel sniper (pembeli sangat awal menurut GMGN): ${token.sniperCount ?? "belum diketahui"}`);
  L.push(`🧪 GMGN Entrapment/Phishing: ${pct(token.entrapmentRatio, 0)} • definisi/metode persentase tidak dipublikasi`);
  if (token.top70SniperHoldRate !== null) L.push(`🔒 Sniper top-70 masih pegang: ${pct(token.top70SniperHoldRate)}`);
  if (token.devTeamHoldRate !== null) L.push(`👷 Tim dev pegang: ${pct(token.devTeamHoldRate)}`);
  L.push(`🧑‍💻 Status dev: ${token.creatorTokenStatus ?? "belum diketahui"}`);
  if (token.chain === "sol") {
    L.push(`🔑 Mint dilepas: ${fmtTri(token.renouncedMint)} • Freeze dilepas: ${fmtTri(token.renouncedFreeze)}`);
  } else {
    L.push(`🔑 Ownership renounce: ${fmtTri(token.isRenounced)} • Open source: ${fmtTri(token.isOpenSource)} • Pajak beli/jual: ${token.buyTax === null ? "belum diuji" : pct(token.buyTax)}/${token.sellTax === null ? "belum diuji" : pct(token.sellTax)}`);
  }

  L.push("");
  L.push("🧠 KONTEKS SMART-MONEY");
  L.push(`📡 Sumber: GMGN rank ${iv} (bukan Nansen, bukan pemeriksaan seluruh wallet)`);
  L.push(`👥 Wallet berlabel smart-money: ${token.smartDegenCount ?? "belum diketahui"} • KOL/ternama: ${token.renownedCount ?? "belum diketahui"}`);
  if (token.deep) {
    const d = token.deep;
    L.push(`🟢 Beli ${usd(d.buyVolume)} • 🔴 Jual ${usd(d.sellVolume)}`);
    if (d.buyVolume !== null && d.sellVolume !== null) L.push(`💸 Selisih beli−jual: ${d.buyVolume - d.sellVolume >= 0 ? "+" : "−"}${usd(Math.abs(d.buyVolume - d.sellVolume)).slice(1)}`);
    L.push(`🪪 Wallet baru: ${pct(d.freshWalletRate, 0)} • Bundler: ${d.bundlerWallets ?? "?"} wallet • Whale: ${d.whaleWallets ?? "?"} wallet`);
    if (d.oneSidedDepth !== null) L.push(`🌊 Perkiraan kedalaman satu sisi pool utama: ${usd(d.oneSidedDepth)}${d.poolExchange ? ` (${d.poolExchange})` : ""}`);
  }
  L.push("⚠ Bukan tanda aman dan bukan bukti wallet masih pegang — hanya snapshot label GMGN saat scan.");

  if (verdict.skips.length) {
    L.push("");
    L.push("🔴 ALASAN SKIP");
    for (const r of verdict.skips) L.push(`• ${r}`);
  }
  if (verdict.warns.length) {
    L.push("");
    L.push("🟡 ALASAN WATCH");
    for (const r of verdict.warns) L.push(`• ${r}`);
  }
  if (verdict.goods.length) {
    L.push("");
    L.push("🟢 SINYAL POSITIF");
    for (const r of verdict.goods) L.push(`• ${r}`);
  }

  L.push("");
  L.push(`🔍 Cakupan scan: GMGN /v1/market/rank chain=${token.chain} interval=${iv}, filter dikirim ke server lalu dicek ulang di sisi klien.`);
  L.push(`🕒 Waktu scan: ${new Date().toLocaleString("id-ID", { hour12: false })}`);
  L.push(`🔗 https://gmgn.ai/${token.chain}/token/${token.address}`);
  return L.join("\n");
}

function fmtTri(v) {
  if (v === true) return "ya";
  if (v === false) return "belum";
  return "belum diketahui";
}

export function formatSummary(rows, opts) {
  const head = `SCAN ${opts.chain.toUpperCase()} ${opts.interval} • urut: ${opts.sort}`;
  if (!rows.length) return `${head}\nTidak ada token yang lolos filter pada scan ini.`;
  const lines = rows.map((r, i) => {
    const t = r.token;
    return `${String(i + 1).padStart(2)}. ${TIER_HEADER[r.verdict.tier].slice(0, 2)} ${t.symbol.padEnd(12).slice(0, 12)} vol ${usd(t.volume).padStart(9)} • mcap ${usd(t.marketCap).padStart(9)} • liq ${usd(t.liquidity).padStart(9)} • turnover ${t.turnover === null ? "  n/a" : `${t.turnover.toFixed(2)}×`} • umur ${age(t.ageSeconds)}`;
  });
  return `${head}\n${lines.join("\n")}`;
}
