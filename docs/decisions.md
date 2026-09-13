# Catatan keputusan

Kenapa proyek ini begini, supaya tidak ada yang "memperbaiki" hal yang sebenarnya disengaja.
Tiap keputusan menyebutkan bukti yang mendasarinya.

## 1. Nilai yang belum diketahui tidak pernah dijadikan nol

**Masalah.** GMGN mengembalikan `null`, `""`, `0`, dan `-1` dengan arti berbeda-beda.
Menyamakannya membuat "belum diuji" tampil sebagai "pajak 0% • bukan honeypot • wewenang
sudah dilepas" — kekosongan dibungkus jadi kabar baik.

**Keputusan.** `num()` mengembalikan `null` untuk nilai kosong; `tri()` mengembalikan
`true`/`false`/`null` dengan `-1` sebagai `null`. Kartu menulis "belum diketahui", dan
`classify()` mencatat field yang hilang di daftar `missing`.

**Akibat.** Ambang risiko menolak token yang datanya tidak diketahui. Itu memang disengaja
dan sejalan dengan perilaku server GMGN.

## 2. Estimasi fee LP tidak dihitung dari data GMGN

**Bukti.** Pada satu token yang sama: `pool.fee_ratio` = `0.1`, sedangkan
`trade_fee / volume_24h` = 0,0074%. Selisihnya ~13 kali, dan tidak ada dokumentasi yang
menjelaskan unit `fee_ratio`.

**Keputusan.** Estimasi fee hanya muncul kalau pengguna memberi `--fee-bps` sendiri, dan
kartu menyebut bahwa angkanya berasal dari input pengguna. Porsi pool tetap dihitung
(`lpSize / (liquidity + lpSize)`) dengan catatan bahwa `liquidity` adalah jumlah dua sisi.

**Alternatif yang ditolak.** Menebak unitnya, atau memakai `trade_fee` seolah-olah itu fee
24 jam. Dua-duanya menghasilkan angka rupiah yang terlihat meyakinkan tapi salah.

## 3. Label GMGN diteruskan apa adanya

`insider`, `bundler`, `entrapment`, `sniper`, `bot/degen` adalah klasifikasi milik GMGN dengan
metode yang tidak dipublikasi. Kartu menampilkan angkanya, menyebut "(GMGN)", dan untuk
entrapment menambahkan bahwa metodenya tidak jelas. Tool tidak mengubahnya jadi vonis
"aman"/"scam" karena tidak punya dasar untuk itu.

## 4. Tier memakai ambang GMGN, bukan karangan sendiri

SKIP di `rug_ratio > 0.3`, PASS di `smart_degen_count ≥ 3` + `rug_ratio < 0.1` + dev clear
posisi — semuanya mengikuti panduan screening GMGN. Angka karangan sendiri akan terlihat
berwibawa tanpa dasar apa pun. Kalau diubah, catat alasannya di sini.

## 5. Filter hidup di satu tabel

Awalnya filter tersebar: parser CLI, pembangun query, dan pengecekan klien masing-masing punya
daftar sendiri, sehingga menambah satu filter berarti menyentuh empat tempat dan gampang
tidak sinkron. Sekarang `FILTER_SPEC` jadi sumber tunggal. Menambah filter = satu baris.

Filter server tetap dianggap saringan kasar dan **selalu dicek ulang** di sisi klien, karena
tidak semua filter punya padanan di server dan perilaku server bisa berubah.

## 6. Jeda antar request 1 detik, bukan tanpa jeda

**Bukti.** Tanpa jeda, dan bahkan dengan jeda 300 ms, memindai 3–5 chain berturut-turut
langsung memicu `RATE_LIMIT_BANNED` — padahal dokumen menyebut batas 20 request/detik.
Bannya per-IP dan memanjang 5 detik tiap kali diretry.

**Keputusan.** Default `--pace` 1000 ms, bisa diatur. Satu siklus 20 request jadi tersebar
20 detik; masih muat di `--watch 60`, dan jauh lebih murah daripada kena ban bermenit-menit.

## 7. Kredensial salah membuat proses keluar, bukan backoff

Backoff untuk error jaringan masuk akal — gangguan sementara akan pulih. `AUTH_KEY_INVALID`
tidak akan pulih dengan menunggu; proses yang terus mencoba hanya menyembunyikan masalah di
dalam log. Sekarang prosesnya keluar dengan pesan jelas, dan systemd yang menyuarakannya.

## 8. State polling disimpan ke disk

Tanpa ini, tiap `systemctl restart` mengirim ulang semua kartu yang baru saja dikirim, karena
jendela polling dan cooldown ikut hilang. Ditulis dengan tmp + `rename()` supaya tidak pernah
setengah tertulis kalau proses mati di tengah penulisan.

Kunci memakai `chain:address`, bukan alamat saja, karena alamat yang sama bisa muncul di
beberapa chain EVM.

## 9. Penanda salin, bukan format khusus Telegram di formatter

`formatCard()` tidak boleh tahu tujuan akhir kartunya. Kalau formatter langsung menulis
`<code>`, keluaran stdout jadi kotor dan Discord tidak ikut mendapat manfaatnya. Penanda
netral (U+0001/U+0002) diterjemahkan tiap sink sesuai formatnya sendiri.

Pernah ada bug di sini: pemotong pesan memotong baris yang melebihi limit dan **membuang
sisanya** — 9000 karakter menjadi 4000 tanpa jejak. Sekarang baris panjang dipecah, bukan
dipangkas, dan penanda yang terbelah antar potongan ditutup lalu dibuka lagi.

## 10. Tanpa dependensi npm

Node ≥ 20 sudah punya `fetch`, `process.loadEnvFile`, dan `AbortSignal.timeout`. Untuk proses
yang jalan 24 jam di VPS, nol dependensi berarti nol audit keamanan pihak ketiga dan nol
kejutan saat `npm install`. Pertahankan kecuali ada alasan kuat.

## 11. `GMGN_PRIVATE_KEY` tidak ikut dimuat

`~/.config/gmgn/.env` berisi API key **dan** private key untuk request bertanda tangan
(swap/order). Tool ini hanya membaca data, jadi hanya `GMGN_API_KEY` yang diambil dari file
itu — private key tidak perlu ada di dalam proses ini sama sekali.
