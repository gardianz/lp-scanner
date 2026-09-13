# Arsitektur

## Alur satu siklus scan

```
cli.js  runOnce()
  │
  ├─ untuk tiap chain di --chain / config:
  │    │
  │    ├─ gmgn.rank(chain, interval, toQuery(filters))
  │    │     GET /v1/market/rank  ← filter yang didukung server ikut dikirim
  │    │     throttle() memberi jeda --pace antar request
  │    │
  │    ├─ screen.normalize(raw, chain, interval)     mentah → bentuk token yang seragam
  │    ├─ filters.passesFilters(token, filters)      cek ulang SEMUA filter di sisi klien
  │    ├─ sort menurut --sort
  │    ├─ [--deep] gmgn.tokenInfo() per kandidat → screen.mergeDeep()
  │    ├─ screen.classify(token)                    → tier PASS / WATCH / SKIP
  │    ├─ state.record() + state.shouldAlert()       konfirmasi polling + cooldown
  │    ├─ format.formatCard(token, verdict, meta)
  │    └─ notify.deliver(sinks, card)
  │
  └─ state.persist()
```

Ringkasan tabel dicetak ke stdout tiap chain; kartu detail hanya dikirim untuk token yang
lolos konfirmasi polling dan tidak sedang cooldown.

## Kenapa dipecah begini

Setiap modul punya satu alasan untuk berubah:

- **gmgn.js** berubah kalau API GMGN berubah (endpoint, auth, bentuk respons, rate limit).
- **screen.js** berubah kalau arti field berubah atau ambang penilaian direvisi.
- **filters.js** berubah kalau ada filter baru — dan hanya di satu tempat, karena satu baris
  di `FILTER_SPEC` sekaligus menjadi flag CLI, kunci config, parameter query, dan aturan cek klien.
  Sebelumnya empat tempat itu terpisah dan mudah tidak sinkron.
- **format.js** berubah kalau tampilan kartu berubah. Tidak tahu apa-apa soal HTTP atau lolos/tidak.
- **notify.js** berubah kalau ada tujuan kirim baru. Tidak tahu apa-apa soal token.
- **state.js** berubah kalau aturan anti-spam berubah.
- **cli.js** merangkai semuanya dan mengurus daur hidup proses.

## Bentuk token hasil normalisasi

`normalize()` mengubah satu item `rank[]` GMGN jadi objek dengan nama camelCase dan satuan yang
konsisten. Yang penting diketahui:

| Field | Asal | Catatan |
|---|---|---|
| `volume` | `volume` | USD, untuk interval yang diminta — bukan 24 jam |
| `marketCap`, `liquidity` | `market_cap`, `liquidity` | `liquidity` = jumlah **dua sisi** cadangan pool |
| `turnover` | dihitung | `volume / liquidity`, `null` kalau likuiditas 0 |
| `ageSeconds` | `creation_timestamp` | `0` dari GMGN berarti tidak diketahui, bukan 1970 |
| `sellShare` | `buys` / `sells` | berbasis **jumlah swap**; `--deep` menggantinya dengan porsi USD |
| rasio risiko | `rug_ratio`, `bundler_rate`, … | skala 0–1, bukan persen |
| tri-state | `isHoneypot`, `renouncedMint`, … | `true` / `false` / `null`; `null` = belum diuji |
| `deep` | `/v1/token/info` | `null` kalau `--deep` mati |

Daftar lengkap ada di `normalize()` dan `mergeDeep()` ([src/screen.js](../src/screen.js)).

## Penilaian tier

`classify()` mengembalikan `{ tier, skips, warns, goods, missing }`.

- **SKIP** kalau ada indikator berat: `is_honeypot = 1`, `is_wash_trading = true`, atau
  `rug_ratio > 0.3`.
- **PASS** kalau semuanya terpenuhi: `smart_degen_count ≥ 3`, `rug_ratio < 0.1`, dev sudah
  clear posisi, dan `is_wash_trading` secara eksplisit `false`.
- **WATCH** untuk sisanya — termasuk token yang datanya belum lengkap.

`missing` mencatat field wajib yang belum ada, dihitung menurut chain (EVM punya pajak
beli/jual, Solana tidak). Kartu menampilkannya supaya "tidak ada indikator risiko" tidak
disalahartikan sebagai "sudah diperiksa dan bersih".

## Filter: satu tabel, empat pemakai

`FILTER_SPEC` ([src/filters.js](../src/filters.js)) berisi 26 baris. Tiap baris:

```js
{ key: "minHolder", cli: "min-holder", api: "min_holder_count",
  field: "holderCount", cmp: "gte", unit: "count", desc: "jumlah holder" }
```

- `cli` → flag `--min-holder`, otomatis dikenali parser
- `key` → kunci di `config.json` (`"minHolder": 200`)
- `api` → dikirim ke GMGN sebagai saringan awal; `null` berarti hanya bisa dihitung lokal
- `field` + `cmp` → aturan cek ulang di sisi klien
- `unit` → validasi (rasio harus 0–1, durasi harus `30m`/`6h`/`7d`) dan cara menampilkannya

Prioritas nilai: flag CLI > file config > default bawaan. Flag bernilai `off` menghapus filter
yang diwarisi dari config.

**Ambang risiko menolak token yang datanya tidak diketahui.** Kalau `maxBundlerRate` dipasang
dan token tidak punya `bundler_rate`, token itu tidak lolos — sama seperti perilaku server
GMGN, dan supaya "belum diuji" tidak lolos seolah-olah "aman".

## State polling

`state.json` menyimpan dua hal:

```json
{ "version": 1,
  "seen":      { "sol:<address>": [true, false, true] },
  "lastAlert": { "sol:<address>": 1789254279000 } }
```

- `seen` = jendela `--window` scan terakhir per token. Token dikirim hanya kalau muncul di
  minimal `--confirm` dari jendela itu — menyaring lonjakan satu-tick.
- `lastAlert` = waktu kartu terakhir dikirim, untuk `--cooldown`.
- Kunci selalu `chain:address`, karena alamat yang sama bisa ada di beberapa chain EVM.
- `record()` menerima `scope` chain: scan chain A tidak boleh dihitung sebagai "tidak muncul"
  bagi token chain B yang belum discan pada siklus itu.
- Ditulis dengan tmp + `rename()` supaya tidak pernah setengah tertulis, dan entri lama
  dipangkas supaya file tidak tumbuh terus di proses 24 jam.

Tanpa state yang bertahan, tiap restart akan mengirim ulang semua kartu yang baru dikirim.

## Penanda salin

`formatCard()` membungkus contract address dengan `COPY_START`/`COPY_END` (U+0001/U+0002).
Formatter tidak tahu tujuan akhirnya; tiap sink menerjemahkan: Telegram jadi `<code>` (bisa
diketuk untuk menyalin), Discord jadi backtick, stdout dilepas. `balanceCopyMarks()` menutup
dan membuka lagi penanda kalau kartu terbelah jadi beberapa pesan, dan isi kartu di-escape
sebelum dijadikan HTML.

## Daur hidup proses

- `--watch N` mengulang siklus tiap N detik; `--watch 0` sekali jalan.
- 429 → tunggu sampai `reset_at`, jangan retry cepat.
- Error lain → backoff `watch × 2ⁿ`, maksimum 15 menit.
- Error kredensial (`AUTH_KEY_INVALID`, 401, 403) → **keluar**, bukan backoff. Menunggu tidak
  menyembuhkan key yang salah; biar systemd yang menyuarakan.
- SIGTERM/SIGINT → simpan state lalu keluar dengan kode 0.

## Batas yang diketahui

- Satu proses = satu interval. Memantau 5m dan 1h sekaligus perlu dua proses.
- Tidak ada test otomatis.
- `--deep` dibatasi 20 token per chain per siklus.
- Impermanent loss tidak dihitung di mana pun.
