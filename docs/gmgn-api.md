# Catatan GMGN OpenAPI

Yang terpakai di proyek ini, beserta jebakan yang sudah ditemui. Sumber: kode `gmgn-cli`
([GMGNAI/gmgn-skills](https://github.com/GMGNAI/gmgn-skills)) dan pengamatan langsung respons API.

## Dasar

| | |
|---|---|
| Base URL | `https://openapi.gmgn.ai` |
| Auth | header `X-APIKEY: <key>` |
| Wajib di query | `timestamp` (detik Unix, toleransi ±5 detik) dan `client_id` (UUID, replay ditolak dalam 7 detik) |
| Key | https://gmgn.ai/ai, atau `gmgn-cli config` → `gmgn-cli config --apply <key>` |
| Demo key | `gmgn_solbscbaseethmonadtron` — publik, read-only, rate limit ketat |

Tanda tangan (`X-Signature` + `GMGN_PRIVATE_KEY`) hanya untuk endpoint swap/order. Endpoint
baca yang dipakai di sini tidak memerlukannya.

Chain: `sol` `bsc` `eth` `base` `arbitrum` `hyperevm` `robinhood` `arc` `stable`.
Interval: `1m` `5m` `1h` `6h` `24h`.

## Bentuk respons

Terbungkus dua lapis:

```json
{ "code": 0, "data": { "code": 0, "data": { "rank": [ ... ] } } }
```

`unwrap()` di [src/gmgn.js](../src/gmgn.js) mengupas selama node punya `code` dan `data`
sekaligus, dan melempar `ApiError` kalau ada `code` bukan 0/200.

## `GET /v1/market/rank`

Ranking token per chain dan interval. Balikannya `data.rank[]`.

Parameter: `chain`, `interval`, `limit` (maks 100), `order_by`, `direction`, `filters[]`,
`platforms[]`, ditambah pasangan `min_*`/`max_*`.

Filter server yang dipakai proyek ini: `min_volume` `max_volume` `min_liquidity` `max_liquidity`
`min_marketcap` `max_marketcap` `min_holder_count` `max_holder_count` `min_swaps` `max_swaps`
`min_smart_degen_count` `min_renowned_count` `max_bot_degen_count` `max_top10_holder_rate`
`max_insider_rate` `max_bundler_rate` `max_entrapment_ratio` `max_top70_sniper_hold_rate`
`max_dev_team_hold_rate` `min_created` `max_created`.

`min_created`/`max_created` adalah **durasi** bersatuan (`30m`, `6h`, `7d`), bukan timestamp.
`max_created` = umur maksimum.

Field per item yang dibaca proyek ini:

```
address symbol name price price_change_percent{,1m,5m,1h}
volume liquidity market_cap total_supply swaps buys sells holder_count
creation_timestamp open_timestamp launchpad_platform exchange
top_10_holder_rate rug_ratio bundler_rate bot_degen_rate bot_degen_count
entrapment_ratio sniper_count top70_sniper_hold_rate dev_team_hold_rate
smart_degen_count renowned_count is_wash_trading is_honeypot
renounced_mint renounced_freeze_account is_renounced is_open_source
buy_tax sell_tax lock_percent burn_ratio creator_token_status creator_close
twitter_rename_count cto_flag twitter_username website telegram
```

`volume` di sini adalah volume **untuk interval yang diminta**, bukan 24 jam.

## `GET /v1/token/info`

Dipakai mode `--deep`, satu panggilan per kandidat. Blok yang dibaca: `price`, `stat`,
`wallet_tags_stat`, `pool`.

- `price.buy_volume_5m` / `sell_volume_5m` → porsi jual dalam USD (lebih akurat daripada
  rasio jumlah swap)
- `price.price_5m` dan sejenisnya adalah **harga awal jendela**, bukan persentase perubahan.
  Perubahan dihitung sendiri: `price / price_5m − 1`.
- `stat.fresh_wallet_rate`, `stat.top_entrapment_trader_percentage`, dan seterusnya = persentase
- `wallet_tags_stat.*` = **jumlah wallet**, bukan persentase. Jangan dicampur dengan `stat.*`.
  `fresh_wallets` terlihat terpotong di 1000, jadi untuk rasio wallet baru pakai
  `stat.fresh_wallet_rate`.
- `pool.liquidity` = jumlah dua sisi cadangan. Perkiraan kedalaman satu sisi = `liquidity / 2`.
  Sisi mana yang menjadi acuan tidak bisa ditebak, jadi jangan mencoba memilih salah satu.

## Field yang tidak bisa dipercaya

**`pool.fee_ratio`.** Diamati bernilai `0.1`, sementara pada token yang sama
`trade_fee / volume_24h` menghasilkan 0,0074%. Beda sekitar 13 kali dan unitnya tidak
didokumentasikan. Proyek ini **tidak** memakainya untuk estimasi fee; pengguna memberi
`--fee-bps` sendiri.

**`creation_timestamp = 0`** berarti tidak diketahui, bukan 1 Januari 1970. Menghitung umur
dari nilai itu menghasilkan "token berumur 56 tahun".

**Field keamanan bersifat per chain.** Di Solana `is_renounced` dan `is_open_source` selalu
`null`; di EVM `renounced_mint` dan `renounced_freeze_account` selalu `false` karena konsepnya
memang tidak ada di sana. Membaca silang menghasilkan vonis palsu.

**`honeypot = -1`** artinya belum diuji, bukan aman.

**Pajak `""`** artinya belum diuji, bukan 0%.

## Rate limit

Dokumen resmi menyebut leaky bucket `rate=20`, `capacity=20`.

Praktiknya lebih ketat: ledakan request beruntun memicu ban jauh sebelum angka itu. Respons:

```json
{ "code": 429, "error": "RATE_LIMIT_BANNED", "reset_at": 1775184222 }
```

- Bannya **per alamat IP**, bukan per API key.
- **Tiap retry menambah ban 5 detik**, maksimum 5 menit. Retry cepat memperburuk keadaan.
- `reset_at` (atau header `X-RateLimit-Reset`) menyebut kapan boleh mencoba lagi.

Penanganan di proyek ini: `GmgnClient.throttle()` memberi jeda `--pace` (default 1000 ms)
antar request, dan loop watch menunggu sampai `reset_at` tanpa retry di antaranya.

Menghitung beban satu siklus: `jumlah_chain × (1 + min(top, 20) jika --deep)`. Contoh 5 chain
dengan `--deep --top 3` = 20 request; pada jeda 1 detik itu tersebar 20 detik, muat di dalam
`--watch 60`. Menambah chain atau menaikkan `top` berarti `--watch` harus ikut naik.

## Error yang perlu dibedakan

| Kondisi | Sikap yang benar |
|---|---|
| 429 / `RATE_LIMIT_BANNED` | tunggu sampai `reset_at`, jangan retry |
| `AUTH_KEY_INVALID`, 401, 403 | keluar dari proses — menunggu tidak menyembuhkan |
| jaringan, timeout, 5xx | backoff eksponensial |

`ApiError.fatal` di [src/gmgn.js](../src/gmgn.js) yang membedakan kategori kedua.
