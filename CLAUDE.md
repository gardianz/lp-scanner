# Panduan agen — lp-scanner

Baca ini sebelum mengubah apa pun. Ringkas sengaja; detail ada di [docs/](docs/).

## Proyek ini apa

CLI Node.js tanpa dependensi npm. Membaca ranking token GMGN per chain dan interval,
menyaringnya, lalu mengirim kartu ringkasan ke Telegram/Discord/stdout. Dipakai jalan
24 jam di VPS untuk memantau token dengan perputaran likuiditas tinggi.

Butuh Node ≥ 20 (`fetch`, `process.loadEnvFile`, `AbortSignal.timeout` semuanya bawaan).
Dikembangkan di Node 24.

## Aturan yang tidak boleh dilanggar

Lima hal ini bukan preferensi gaya. Melanggarnya membuat tool memberi jawaban yang salah
soal uang orang.

1. **Nilai kosong bukan nol.** `null`, `undefined`, `""`, dan `-1` berarti "belum diketahui",
   bukan "0" dan bukan "aman". Pakai `num()` dan `tri()` dari [src/screen.js](src/screen.js).
   Field yang belum diketahui ditampilkan "belum diketahui", tidak pernah disulap jadi angka.
2. **Field keamanan berbeda per chain.** Solana: `renounced_mint` / `renounced_freeze_account`.
   EVM: `is_renounced` / `is_open_source`. Membaca silang membuat token normal terlihat
   berisiko, atau sebaliknya. `EVM_CHAINS` di [src/gmgn.js](src/gmgn.js) yang memisahkannya.
3. **Jangan mengarang angka yang tidak diberikan GMGN.** Contoh nyata: estimasi fee LP hanya
   dihitung kalau pengguna memberi `--fee-bps`, karena `pool.fee_ratio` dari GMGN tidak jelas
   unitnya. Lihat [docs/decisions.md](docs/decisions.md). Kalau data tidak ada, katakan tidak ada.
4. **Label GMGN diteruskan apa adanya, bukan jadi vonis.** `insider`, `bundler`, `entrapment`,
   `sniper` adalah klasifikasi GMGN yang metodenya tidak dipublikasi. Kartu menyebut sumbernya
   dan tidak mengubahnya jadi kesimpulan "aman"/"scam".
5. **Rate limit itu nyata dan bannya per-IP.** Jangan menambah request tanpa menghitung
   bebannya, jangan retry cepat saat kena 429. Lihat bagian Menguji di bawah.

## Peta file

| File | Tanggung jawab | Jangan taruh di sini |
|---|---|---|
| [src/gmgn.js](src/gmgn.js) | HTTP ke GMGN: auth, throttle, unwrap, error | logika filter atau format |
| [src/screen.js](src/screen.js) | normalisasi field mentah, penilaian tier | pemanggilan jaringan |
| [src/filters.js](src/filters.js) | satu tabel filter untuk CLI + config + query + cek klien | |
| [src/format.js](src/format.js) | teks kartu dan ringkasan | keputusan lolos/tidak |
| [src/notify.js](src/notify.js) | sink Telegram/Discord/stdout, potong pesan | pengambilan data |
| [src/state.js](src/state.js) | state polling + cooldown yang tahan restart | |
| [src/unipool.js](src/unipool.js) | jembatan ke bot LP: JSONL + daftar chain yang didukung | apa pun soal pool/wallet |
| [src/cli.js](src/cli.js) | argumen, config, loop watch, backoff, shutdown | detail format/HTTP |

Alur satu siklus: `cli` → `gmgn.rank()` → `screen.normalize()` → `filters.passesFilters()` →
`screen.classify()` → `format.formatCard()` → `notify.deliver()`, dengan `state` memutuskan
kartu mana yang benar-benar dikirim. Rinciannya di [docs/architecture.md](docs/architecture.md).

## Resep perubahan yang sering diminta

**Menambah filter** — tambah satu baris di `FILTER_SPEC` ([src/filters.js](src/filters.js)).
Flag CLI, kunci config, query server, validasi, dan pengecekan klien ikut otomatis. Kalau
fieldnya belum ada di token hasil normalisasi, tambahkan dulu di `normalize()`.

**Menambah sink notifikasi** — buat class dengan `name` dan `async send(text)` di
[src/notify.js](src/notify.js), daftarkan di `buildSinks()`. Terjemahkan penanda salin
(`COPY_START`/`COPY_END`) sesuai format tujuan; jangan biarkan penandanya bocor ke keluaran.

**Menambah data baru ke kartu** — ambil fieldnya di `normalize()` atau `mergeDeep()`, lalu
tampilkan di `formatCard()`. Sebutkan sumber dan satuannya di teks kartu.

**Mengubah ambang tier** — `classify()` di [src/screen.js](src/screen.js). Ambang yang ada
sekarang berasal dari panduan screening GMGN sendiri, bukan karangan; catat alasannya kalau
mengubah.

## Menguji tanpa merusak

Jangan menjalankan scan berulang-ulang dengan cepat. GMGN membalas 429 `RATE_LIMIT_BANNED`,
bannya per alamat IP, dan **tiap retry menambah ban 5 detik sampai 5 menit**. Ban itu ikut
menghantam pemakaian normalmu, bukan cuma tesnya.

```bash
node --check src/cli.js                      # cek sintaks, gratis
node src/cli.js --watch 0 --chain sol --top 0 # satu chain, satu request, tanpa kartu
node src/cli.js --demo ...                   # demo key publik, rate limit lebih ketat lagi
```

Fungsi murni bisa diuji tanpa jaringan sama sekali — `chunk()`, `toTelegramHtml()`,
`passesFilters()`, `usd()`, `age()`, `classify()` semuanya tidak menyentuh HTTP.
Utamakan menguji lewat pintu itu.

Belum ada test runner. Kalau menambahkannya, pakai `node --test` bawaan supaya proyek tetap
tanpa dependensi.

## Jembatan ke bot LP

`--lp-inbox <path>` (atau env `LP_ALERT_INBOX`) menulis kandidat yang **sudah lolos
gating kartu** — filter, konfirmasi polling, dan cooldown — ke file JSONL. Bot LP
(unipool) membacanya, mencari pool, dan menghitung saran posisi sendiri.

Empat aturan:

1. **Gating dipakai bersama.** `buildOutput()` memilih `picked` sekali, lalu kartu DAN
   jembatan memakai daftar yang sama. Kalau dipisah, bot LP akan menerima token yang
   di sini sendiri dianggap belum layak dikirim.
2. **Hanya `LP_CHAINS`** (`bsc` `base` `hyperevm` `robinhood`). Chain lain tetap dapat
   kartu biasa; meneruskannya cuma menghasilkan notifikasi yang tidak bisa
   ditindaklanjuti.
3. **Angka GMGN diteruskan apa adanya**, `null` tetap `null`. Tidak ada turunan baru
   yang dihitung di sini — aturan "jangan mengarang angka" berlaku sama di jembatan.
4. **Satu baris JSON per kandidat**, ditulis `appendFileSync`. Di bawah 4 KB dan
   dengan `O_APPEND`, satu `write()` tidak terpotong penulis lain di file biasa Linux.
   Bot LP mengambilnya dengan `rename()` lalu mengosongkan.

## Kredensial

`GMGN_API_KEY` dibaca dari `.env` proyek, lalu `~/.config/gmgn/.env` sebagai cadangan.
Dari file gmgn-cli itu **hanya** `GMGN_API_KEY` yang diambil — `GMGN_PRIVATE_KEY` di sana
milik jalur swap bertanda tangan dan tidak boleh masuk ke proses tool baca-saja ini.

`.env`, `config.json`, dan `state.json` ada di `.gitignore`. Jangan commit nilai kredensial,
jangan cetak isinya ke log, jangan kirim ke sink mana pun.

## Gaya

- Bahasa Indonesia untuk komentar, dokumen, dan teks yang dilihat pengguna.
- Nama API, field GMGN, flag CLI, dan pesan error tetap verbatim.
- Komentar menjelaskan **kenapa**, bukan mengulang isi kode. Yang sudah ada dipakai untuk
  menandai jebakan nyata yang pernah ditemui — pertahankan pola itu.
