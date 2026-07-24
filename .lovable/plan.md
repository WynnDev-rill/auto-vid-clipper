## 1. Watermark "By Wynn" di samping judul

`src/components/logo.tsx`: tambahkan span kecil di samping "ClipForge" — teks `by Wynn` dengan style muted, ukuran kecil, italic/tracking-wide sehingga tampak seperti watermark tanda tangan. Otomatis muncul di semua tempat yang memakai `<Logo />` (header + bottom area).

## 2. Clip duration lebih fleksibel (slider custom)

`src/routes/_authenticated/create.tsx`:

- Pertahankan 4 preset (15/30/45/60s) sebagai tombol cepat.
- Tambahkan **slider "Custom duration"** (range 5–120 detik, step 1) + numeric input di sampingnya yang menampilkan nilai aktif.
- State `duration` bebas berupa angka apa pun; preset hanya set nilai slider. Preset yang aktif di-highlight bila nilainya sama.

`src/types/domain.ts`: longgarkan validasi — biarkan `CLIP_DURATIONS` sebagai preset UI, tapi ekspor konstanta `CLIP_DURATION_MIN = 5` dan `CLIP_DURATION_MAX = 120`.

`src/lib/jobs.functions.ts`: ganti validator `clipDuration` dari `.refine(...preset)` menjadi `z.number().int().min(5).max(120)` supaya backend menerima nilai bebas.

## 3. Perbaikan setelah klik "Generate clips"

Masalah yang ditemukan saat menelusuri alur:

- `create.tsx` mengirim `sourceType: "upload"` tanpa file/`uploadKey`, sehingga backend Render akan gagal. Perbaikan: nonaktifkan tab Upload (tampilkan "Coming soon") atau paksa user mengisi URL sebelum Generate diaktifkan. Tombol Generate disabled kalau `tab==='upload'` atau URL kosong.
- `pollJob` mem-polling terus-menerus dan clip editor menjalankan `setInterval` **tambahan** di `useEffect` — jadinya double-poll setiap 2s dan 2.5s. Perbaikan: hapus `setInterval` manual di `clips.$jobId.tsx`; cukup andalkan `refetchInterval` di `queryOptions`. Panggilan `pollFn` (yang memicu backend sync) dipindah ke `queryFn` (`getJob` dulu, atau ganti queryFn ke `pollFn` supaya setiap refetch sekaligus sync backend).
- Kalau backend Render mengembalikan error, saat ini tidak ada UI. Perbaikan: bila `job.status === "failed"`, tampilkan card error dengan `error_message` + tombol "Retry" (memanggil `startJob` ulang dengan input sama) dan "Back to create".
- Toast sukses "Job queued" tetap muncul walau nanti gagal — biarkan, tapi tambahkan validasi URL YouTube sederhana (regex) sebelum submit untuk mengurangi kegagalan.

## 4. Menu Jobs baru

Tambahkan route `src/routes/_authenticated/jobs.tsx`:

- Daftar semua job (`listJobs`) dengan status badge (queued/transcribing/analyzing/rendering/done/failed), progress bar mini, thumbnail sumber, dan waktu mulai.
- Setiap baris → link ke `/clips/$jobId` (halaman editor sudah ada + akan jadi "job detail" saat processing).
- Aksi per baris: **Cancel** (untuk job non-final; set status `failed` dengan pesan "Cancelled by user") dan **Retry** (untuk `failed`).

Tambahkan ke `src/components/app-shell.tsx` NAV: entry "Jobs" (icon `ListChecks`) di posisi setelah Create. Susun ulang: Home · Create · **Jobs** · History · Stats · Settings (bottom nav mobile perlu tetap ringkas — 6 item masih muat karena `min-w-14`; jika terlalu penuh, ganti label Stats jadi ikon-only).

## 5. Perkiraan waktu selesai (ETA) di detail job

Di clips.$jobId.tsx bagian `isProcessing`:

- Simpan tabel bobot per-stage (queued 5%, transcribing 35%, analyzing 10%, rendering 45%, done 5%).
- Hitung ETA sederhana: `elapsed = now - job.created_at`; `remaining = elapsed * (100 - progress) / max(progress, 5)`. Format `mm:ss`.
- Tampilkan: elapsed time, ETA, dan langkah aktif yang di-highlight (checklist dengan ikon centang untuk stage yang sudah lewat, spinner untuk stage aktif).
- Tambahkan tombol "Cancel job" (memanggil endpoint cancel yang sama dengan #4).

## 6. Saran tambahan (opsional, tidak dieksekusi kecuali kamu setuju)

- Notifikasi browser (Web Notifications API) saat job selesai kalau tab tidak aktif.
- Estimasi biaya kredit / durasi processing sebelum submit di halaman Create.
- Preset "durasi acak antara X–Y detik per klip" agar output tidak terasa monoton.

Beritahu kalau ada bagian yang mau ditambah/dihilangkan sebelum aku eksekusi.

## Technical details

- **Cancel job**: server function baru `cancelJob` di `src/lib/jobs.functions.ts` yang set status `failed` + `error_message='Cancelled by user'` bila status ∈ {queued,transcribing,analyzing,rendering}. Tidak memanggil backend Render (Render worker akan selesai sendiri — clip hasilnya diabaikan karena status sudah final di DB). Catatan: `pollJob` sudah `return { job }` lebih awal kalau status `done`/`failed`, jadi tidak akan menimpa status yang di-cancel.
- **Retry**: memanggil `startJob` dengan payload dari job lama (butuh menyertakan `source_url`, `source_title`, `clip_duration`, `clip_count` dari row jobs).
- **Watermark**: pakai className `text-[10px] font-medium uppercase tracking-widest text-muted-foreground/70 ml-1` supaya tidak mengganggu logo utama.
- **Slider**: pakai `<input type="range">` dengan style `accent-[oklch(0.68_0.22_295)]` yang sudah dipakai di file yang sama.
- **Files edited**: `src/components/logo.tsx`, `src/components/app-shell.tsx`, `src/routes/_authenticated/create.tsx`, `src/routes/_authenticated/clips.$jobId.tsx`, `src/lib/jobs.functions.ts`, `src/types/domain.ts`.
- **Files created**: `src/routes/_authenticated/jobs.tsx`.

&nbsp;

Sebagai tambahan : mung ada error atau bug atau ada yang kurang yang menyebabkan aplikasi belum bisa bekerja, aku ingin kamu mengetesnya dan laporkan jika ada yang salah atau kurang