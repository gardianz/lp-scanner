// Jembatan ke bot LP (unipool): menulis kandidat yang LOLOS ke sebuah file JSONL
// yang dibaca bot itu. Sengaja file, bukan HTTP:
//
// - dua proses terpisah dan bisa restart sendiri-sendiri; file tidak butuh port,
//   tidak butuh token, dan tidak gagal kalau salah satunya sedang mati;
// - bot LP yang mengirim kartu Telegram-nya sendiri, jadi tool ini tidak perlu
//   tahu apa pun soal chain, pool, atau wallet.
//
// Yang dikirim hanya ANGKA MENTAH dari GMGN apa adanya plus hasil klasifikasi.
// Tidak ada turunan baru yang dikarang di sini — saran posisi dihitung bot LP
// dari data on-chain miliknya sendiri.
import { appendFileSync } from "node:fs";
import { log } from "./notify.js";

// Chain yang benar-benar bisa di-LP oleh bot tujuan. Slug GMGN di kiri.
// sol/eth/arbitrum/arc/stable sengaja TIDAK ada: bot LP tidak mendukungnya, dan
// mengirimnya ke sana cuma menghasilkan notifikasi yang tidak bisa ditindaklanjuti.
export const LP_CHAINS = new Set(["bsc", "base", "hyperevm", "robinhood"]);

export function emitLpCandidate(token, verdict, meta, path) {
  if (!path) return false;
  if (!LP_CHAINS.has(token.chain)) return false;
  const entry = {
    v: 1,
    ts: Math.floor(Date.now() / 1000),
    chain: token.chain,
    address: token.address,
    symbol: token.symbol,
    name: token.name || null,
    interval: token.interval,
    tier: verdict.tier,
    // angka GMGN apa adanya — null berarti BELUM DIKETAHUI, jangan dijadikan 0
    volume: token.volume,
    marketCap: token.marketCap,
    liquidity: token.liquidity,            // jumlah DUA sisi cadangan
    turnover: token.turnover,
    ageSeconds: token.ageSeconds,
    priceChangePercent: token.priceChangePercent,
    price: token.price,
    swaps: token.swaps,
    buys: token.buys,
    sells: token.sells,
    sellShare: token.sellShare,
    sellShareSource: token.sellShareSource,
    holderCount: token.holderCount,
    smartDegenCount: token.smartDegenCount,
    renownedCount: token.renownedCount,
    rugRatio: token.rugRatio,
    top10HolderRate: token.top10HolderRate,
    launchpad: token.launchpad,
    exchange: token.exchange,
    warns: verdict.warns,
    skips: verdict.skips,
    goods: verdict.goods,
    missing: verdict.missing,
    pollHits: meta.pollHits ?? null,
    pollWindow: meta.pollWindow ?? null,
  };
  try {
    // Satu baris JSON < 4 KB ditulis sekali jalan dengan O_APPEND: penulisan
    // seperti itu tidak akan terpotong oleh penulis lain di file biasa Linux.
    appendFileSync(path, JSON.stringify(entry) + "\n");
    return true;
  } catch (err) {
    log("error", `gagal menulis kandidat LP ke ${path}: ${err.message}`);
    return false;
  }
}
