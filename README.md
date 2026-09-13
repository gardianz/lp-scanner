# lp-scanner

Scanner token berdasarkan volume interval pendek (default 5 menit) memakai GMGN OpenAPI.
Saringan dasar sesuai kebutuhan: **volume interval ≥ $300K** dan **market cap ≥ $500K**.
Keluarannya kartu teks siap kirim ke Telegram/Discord, atau JSON.

Tanpa dependensi npm — cukup Node.js ≥ 20 (pakai `fetch` bawaan).

## 1. API key

Lewat gmgn-cli (butuh public key Ed25519, dibuatkan otomatis):

```bash
gmgn-cli config                  # buat keypair di ~/.config/gmgn/keypair.pem + cetak link pembuatan API key
gmgn-cli config --apply <key>    # simpan key ke ~/.config/gmgn/.env
```

Tanpa gmgn-cli:

```bash
cp .env.example .env
# daftar di https://gmgn.ai/ai, salin API KEY, tempel ke .env
```

Tool membaca `.env` proyek dulu, lalu `~/.config/gmgn/.env` sebagai cadangan.
Alternatif: `export GMGN_API_KEY=<key>`.
Private key (`keypair.pem`) hanya dipakai gmgn-cli untuk request bertanda tangan (swap/order);
lp-scanner cuma baca, jadi tidak menyentuhnya.
Untuk coba cepat tanpa key: tambahkan `--demo` (demo key publik read-only dari repo
GMGNAI/gmgn-skills; dipakai ramai, sering kena rate limit).

## 2. Jalankan

```bash
node src/cli.js                          # sol, 5m, volume ≥300K, mcap ≥500K
node src/cli.js --chain sol,bsc,base     # beberapa chain sekaligus, discan berurutan
node src/cli.js --interval 1h            # 1m / 5m / 1h / 6h / 24h
node src/cli.js --config config.json     # semua pengaturan dari file
node src/cli.js --deep --top 3           # + /v1/token/info per kandidat
node src/cli.js --json                   # keluaran JSON
node src/cli.js --watch 60               # scan tiap 60 detik
```

Chain yang didukung: `sol` `bsc` `eth` `base` `arbitrum` `hyperevm` `robinhood` `arc` `stable`.
Default hanya `sol` — isi `--chain` atau `chains` di config untuk memantau lebih dari satu.
Tiap chain adalah satu request terpisah, discan berurutan dengan jeda 300 ms.

## 2a. Di mana filter diatur

Tiga tempat, yang bawah menimpa yang atas:

1. Default bawaan (`minVolume` 300000, `minMcap` 500000)
2. File config — **`config.json` di root proyek dipakai otomatis**; `--config <path>` untuk file
   lain, `--no-config` untuk mengabaikannya. Contoh: [config.example.json](config.example.json)
3. Flag CLI: `--min-volume 150000`

Baris pertama log menyebut config mana yang terpakai. Kalau tidak ada baris `config:`, berarti
tidak ada file yang dibaca dan yang jalan adalah default bawaan.

Nilai `off` pada flag mematikan filter yang datang dari config: `--min-turnover off`.

```jsonc
{
  "chains": ["sol", "bsc"],
  "interval": "5m",
  "filters": {
    "minVolume": 300000,
    "minMcap": 500000,
    "minHolder": 200,
    "maxTop10Rate": 0.35   // rasio 0–1, bukan persen
  }
}
```

Daftar lengkap filter — semuanya bisa dipakai sebagai flag `--min-volume` maupun kunci config
`minVolume`. Kolom "server" menandai filter yang ikut dikirim ke GMGN sebagai saringan awal;
sisanya dihitung lokal. Semuanya tetap dicek ulang di sisi klien.

| Filter | Kunci config | Satuan | Server |
|---|---|---|---|
| `--min-volume` / `--max-volume` | `minVolume` / `maxVolume` | USD | ya |
| `--min-mcap` / `--max-mcap` | `minMcap` / `maxMcap` | USD | ya |
| `--min-liquidity` / `--max-liquidity` | `minLiquidity` / `maxLiquidity` | USD | ya |
| `--min-holder` / `--max-holder` | `minHolder` / `maxHolder` | jumlah | ya |
| `--min-swaps` / `--max-swaps` | `minSwaps` / `maxSwaps` | jumlah | ya |
| `--min-smart-degen` | `minSmartDegen` | jumlah wallet | ya |
| `--min-renowned` | `minRenowned` | jumlah wallet | ya |
| `--max-bot-degen` | `maxBotDegen` | jumlah wallet | ya |
| `--min-turnover` / `--max-turnover` | `minTurnover` / `maxTurnover` | kali (volume ÷ likuiditas) | tidak |
| `--max-rug-ratio` | `maxRugRatio` | rasio 0–1 | tidak |
| `--max-top10-rate` | `maxTop10Rate` | rasio 0–1 | ya |
| `--max-insider-rate` | `maxInsiderRate` | rasio 0–1 | ya |
| `--max-bundler-rate` | `maxBundlerRate` | rasio 0–1 | ya |
| `--max-entrapment` | `maxEntrapment` | rasio 0–1 | ya |
| `--max-sniper-hold` | `maxSniperHold` | rasio 0–1 | ya |
| `--max-dev-hold` | `maxDevHold` | rasio 0–1 | ya |
| `--min-price-change` / `--max-price-change` | `minPriceChange` / `maxPriceChange` | persen | tidak |
| `--min-age` / `--max-age` | `minAge` / `maxAge` | durasi `30m` / `6h` / `7d` | ya |

⚠ **Ambang risiko menolak token yang datanya belum diketahui.** Kalau kamu pasang
`--max-bundler-rate 0.2` dan GMGN tidak memberi `bundler_rate` untuk token itu, token tersebut
tidak lolos — sama seperti perilaku server GMGN sendiri, dan supaya "belum diuji" tidak
diperlakukan seperti "aman". Kalau justru ingin token berdata tipis tetap muncul, jangan pasang
ambang itu.

Opsi lain: `--sort volume|turnover|mcap|holder`, `--limit` (token diambil per chain, maks 100),
`--top` (kartu dikirim per chain), `--include-skip`, `--deep`, `--watch N` (`0` = sekali jalan),
`--confirm n --window w`, `--cooldown menit`, `--state-file path`, `--no-state`, `--stdout`,
`--json`, `--pace ms`, `--demo`. Semua lengkap di `node src/cli.js --help`.

`stateFile` relatif diselesaikan terhadap **root proyek**, bukan direktori kerja — dijalankan
dari mana pun (systemd, cron, folder lain), state yang dibaca dan ditulis tetap sama. Di VPS,
isi path absolut (`/var/lib/lp-scanner/state.json`). Kalau state gagal ditulis, tool tetap jalan
dan memberi tahu sekali: cooldown-nya jadi tidak bertahan melewati restart.

## 2b. Notifikasi

Tanpa konfigurasi, kartu keluar ke stdout. Isi env berikut untuk push keluar:

```bash
TELEGRAM_BOT_TOKEN=...   # dari @BotFather
TELEGRAM_CHAT_ID=...     # dari @userinfobot
DISCORD_WEBHOOK_URL=...  # opsional, boleh dipakai bersamaan
```

Kartu dipotong otomatis (4000 karakter Telegram, 1900 Discord). Sink yang gagal dicatat
sebagai error dan tidak menjatuhkan loop atau memblokir sink lain; 429 dari Telegram/Discord
dihormati lewat `retry_after`.

**Contract address bisa disalin.** Baris `📋 CA:` dikirim sebagai `<code>` di Telegram (ketuk
untuk menyalin) dan backtick di Discord; di stdout tampil polos. Penandanya dipasang formatter
dan diterjemahkan tiap sink, termasuk kalau kartu terbelah jadi beberapa pesan.

## 2c. Estimasi LP

```bash
node src/cli.js --sort turnover --min-turnover 2 --lp-size 2000 --fee-bps 100
```

- **Porsi pool** = `lpSize ÷ (liquidity + lpSize)`. `liquidity` GMGN adalah jumlah dua sisi
  cadangan, jadi angka ini perkiraan kasar, bukan angka pasti dari pool.
- **Fee rate datang dari `--fee-bps` milikmu, bukan dari GMGN.** Field `pool.fee_ratio` bernilai
  `0.1`, sementara `trade_fee ÷ volume_24h` pada token yang sama keluar 0.0074% — beda ~13×, dan
  unitnya tidak didokumentasikan. Tanpa `--fee-bps`, estimasi fee dilewati, bukan ditebak.
- Turnover tinggi berarti perputaran ramai, **bukan** berarti fee itu jatuh ke posisimu:
  belum diketahui berapa transaksi yang lewat pool yang kamu masuki, dan impermanent loss
  tidak dihitung sama sekali di sini.

## 3. Cara kerjanya

1. `GET /v1/market/rank?chain=…&interval=…` per chain, dengan filter yang didukung server
   (`min_volume`, `min_marketcap`, `min_holder_count`, dan seterusnya) sebagai saringan awal.
2. Nilai yang kembali **dicek ulang di sisi klien** — filter server diperlakukan sebagai saringan kasar saja.
3. Tiap token dinilai jadi tier:
   - **SKIP** — `is_honeypot=1`, `is_wash_trading=true`, atau `rug_ratio > 0.3`
   - **PASS** — `smart_degen_count ≥ 3`, `rug_ratio < 0.1`, dev sudah clear posisi, bukan wash trading
   - **WATCH** — sisanya
4. `--deep` menambah satu panggilan `/v1/token/info` per kandidat untuk porsi beli/jual dalam USD
   (`buy_volume_5m` / `sell_volume_5m`), rasio wallet baru, jumlah wallet bundler/whale, dan
   perkiraan kedalaman satu sisi pool (`pool.liquidity / 2`).

## 4. Yang perlu diingat soal datanya

- **Angka kosong bukan angka nol.** Field yang `null` / `""` ditampilkan "belum diketahui", tidak
  pernah dianggap 0 — supaya "belum diuji" tidak terbaca sebagai "aman".
- **Field keamanan beda per chain.** Solana pakai `renounced_mint` / `renounced_freeze_account`;
  EVM pakai `is_renounced` / `is_open_source`. Tool sudah memisahkannya; membaca silang membuat
  token bluechip terlihat berisiko.
- **Porsi jual default berbasis jumlah swap**, bukan USD. Pakai `--deep` untuk porsi USD.
- **Turnover (volume ÷ likuiditas) itu perkiraan kasar**, bukan estimasi fee LP-mu dan bukan
  tanda token aman. `liquidity` dari GMGN adalah jumlah dua sisi cadangan pool.
- **Label insider / bundler / entrapment / sniper adalah klasifikasi GMGN** yang metodenya tidak
  dipublikasi. Tool meneruskannya apa adanya beserta sumbernya, tidak mengubahnya jadi vonis.
- **Rate limit** leaky bucket 20 request/detik. Kena 429 → tool baca `reset_at` dan menunggu;
  jangan retry manual, tiap retry menambah ban 5 detik (maksimum 5 menit).

## 5. Jalan 24 jam di VPS

```bash
sudo mkdir -p /opt/lp-scanner /etc/lp-scanner /var/lib/lp-scanner
sudo rsync -a --exclude node_modules --exclude .env --exclude state.json ./ /opt/lp-scanner/
sudo cp .env.example /etc/lp-scanner/env       # isi GMGN_API_KEY + kredensial notifikasi
sudo cp config.example.json /etc/lp-scanner/config.json   # chain, interval, filter
# di file itu, set "stateFile": "/var/lib/lp-scanner/state.json"
sudo chmod 600 /etc/lp-scanner/env
sudo chown -R $USER /var/lib/lp-scanner /etc/lp-scanner

sudo cp deploy/lp-scanner.service /etc/systemd/system/lp-scanner@.service
sudo systemctl daemon-reload
sudo systemctl enable --now lp-scanner@$USER
journalctl -u lp-scanner@$USER -f
```

Unit-nya template (`@user`), jadi `%i` jadi nama user yang menjalankan. Sesuaikan flag di
`ExecStart` sesuai strategi. Yang sudah disiapkan untuk operasi panjang:

- **State tahan restart.** Jendela polling dan cooldown disimpan ke `--state-file` dengan
  tulis-lalu-rename (atomik), dimuat lagi saat start. Tanpa ini tiap restart membanjiri
  Telegram dengan kartu yang baru saja dikirim. Entri lama dipangkas otomatis.
- **Mati bersih.** SIGTERM/SIGINT menyimpan state sebelum keluar, jadi `systemctl restart` aman.
- **Backoff.** Scan gagal → tunggu `watch × 2ⁿ` (maksimum 15 menit), bukan retry beruntun.
  429 dari GMGN ditunggu sampai `reset_at`. `StartLimitBurst` menahan crash-loop cepat.
- **Jatah request.** Satu chain = 1 request, plus 1 request per kandidat kalau `--deep`
  (dibatasi 20 per chain). Contoh: 5 chain + `deep` + `top 3` = 20 request per siklus.
  Klien memberi jeda `--pace` (default 1000 ms) antar request, jadi 20 request itu tersebar
  ~20 detik — muat di dalam `--watch 60`. Dokumen GMGN menyebut batas 20 request/detik, tapi
  praktiknya ledakan beruntun memicu ban "repeated violations" jauh sebelum angka itu, dan
  bannya per-IP serta memanjang tiap kali dilanggar. Kalau menambah chain atau menaikkan
  `top`, naikkan juga `--watch` supaya satu siklus selesai sebelum siklus berikutnya mulai.
- **Log.** Baris ringkasan + status masuk journald; kartu detail pergi ke Telegram/Discord.

## 6. Struktur

| File | Isi |
|---|---|
| [src/gmgn.js](src/gmgn.js) | klien HTTP GMGN: auth `X-APIKEY` + `timestamp`/`client_id`, unwrap respons, rate limit |
| [src/screen.js](src/screen.js) | normalisasi field, penilaian tier, filter sisi klien |
| [src/filters.js](src/filters.js) | satu tabel filter: flag CLI, kunci config, query server, cek klien |
| [src/format.js](src/format.js) | kartu teks + ringkasan tabel + penanda salin |
| [src/notify.js](src/notify.js) | sink stdout / Telegram / Discord, pemotongan pesan, retry 429 |
| [src/state.js](src/state.js) | state polling + cooldown yang tahan restart |
| [src/cli.js](src/cli.js) | parsing argumen, mode watch, backoff, shutdown bersih |
| [deploy/lp-scanner.service](deploy/lp-scanner.service) | unit systemd template |
