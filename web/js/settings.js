import { supabase } from './supabase.js';
import {
  getPrinterConfig,
  savePrinterConfig,
  isAndroidBridgeReady,
  getPrinterConnectionState,
  buildThermalText,
  getReceiptLogo,
  saveReceiptLogo,
  clearReceiptLogo,
  ensurePrinterConnected
} from './receipt.js';
import { escapeHtml, showToast } from './utils.js';

const settingsState = {
  business: null,
  suppliers: [],
  scannedDevices: [],
  logoFile: null,
  loading: false,
  onPrinterUpdated: null,
  onLogout: null
};

const LOGO_MAX_W = 320; // titik, kelipatan 8 (aman untuk kertas 58mm)
const LOGO_MAX_H = 160;

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('File gambar tidak bisa dibaca.'));
    };
    img.src = url;
  });
}

// gray: Float32Array berisi 0..255. Mengembalikan Uint8Array 0 (hitam) / 255 (putih).
function grayToMono(gray, w, h, mode) {
  const g = Float32Array.from(gray);
  const out = new Uint8Array(w * h);
  if (mode === 'logo') {
    for (let i = 0; i < g.length; i++) out[i] = g[i] < 160 ? 0 : 255;
    return out;
  }
  // Floyd-Steinberg dithering: hasil foto lebih halus di printer thermal
  for (let i = 0; i < g.length; i++) g[i] = Math.max(0, Math.min(255, (g[i] - 128) * 1.15 + 128));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const old = g[i];
      const nw = old < 128 ? 0 : 255;
      out[i] = nw;
      const err = old - nw;
      if (x + 1 < w) g[i + 1] += (err * 7) / 16;
      if (y + 1 < h) {
        if (x > 0) g[i + w - 1] += (err * 3) / 16;
        g[i + w] += (err * 5) / 16;
        if (x + 1 < w) g[i + w + 1] += err / 16;
      }
    }
  }
  return out;
}

function imageToMonoPng(img, mode) {
  const scale = Math.min(LOGO_MAX_W / img.naturalWidth, LOGO_MAX_H / img.naturalHeight, 4);
  const w = Math.min(LOGO_MAX_W, Math.max(8, Math.ceil(Math.round(img.naturalWidth * scale) / 8) * 8));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);

  const imgData = ctx.getImageData(0, 0, w, h);
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = imgData.data[i * 4];
    const gg = imgData.data[i * 4 + 1];
    const b = imgData.data[i * 4 + 2];
    gray[i] = 0.299 * r + 0.587 * gg + 0.114 * b;
  }
  const mono = grayToMono(gray, w, h, mode);
  for (let i = 0; i < w * h; i++) {
    const v = mono[i];
    imgData.data[i * 4] = v;
    imgData.data[i * 4 + 1] = v;
    imgData.data[i * 4 + 2] = v;
    imgData.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(imgData, 0, 0);
  return { dataUrl: canvas.toDataURL('image/png'), width: w, height: h };
}

async function applyLogoFile(file, mode) {
  const img = await loadImageFromFile(file);
  const res = imageToMonoPng(img, mode);
  saveReceiptLogo({ ...res, mode });
}

export function sanitizeCsvCell(val) {
  let s = String(val ?? '').replace(/\r?\n/g, ' ');
  if (/^[=+\-@\t\r]/.test(s)) {
    s = "'" + s;
  }
  return `"${s.replace(/"/g, '""')}"`;
}

export function downloadCsvFile(filename, headers, rows) {
  const lines = [
    headers.map(sanitizeCsvCell).join(','),
    ...rows.map((r) => r.map(sanitizeCsvCell).join(','))
  ];
  const csvContent = '\uFEFF' + lines.join('\n');

  if (isAndroidBridgeReady() && typeof window.SakaPayAndroid.saveCsvFile === 'function') {
    const resRaw = window.SakaPayAndroid.saveCsvFile(JSON.stringify({ filename, content: csvContent }));
    const res = typeof resRaw === 'string' ? JSON.parse(resRaw) : resRaw;
    if (!res?.ok) throw new Error(res?.error || 'Gagal menyimpan CSV di HP.');
    showToast(`File ${filename} disimpan ke folder Download.`, 'success');
    return;
  }

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 1000);
  showToast(`File ${filename} diunduh.`, 'success');
}

function renderPrinterDevicesBox() {
  if (!settingsState.scannedDevices.length) return '';
  const cfg = getPrinterConfig();
  return `
    <div class="bg-slate-50 rounded-xl p-2.5 space-y-1.5 border border-slate-200">
      <p class="text-[11px] font-bold text-slate-600">Perangkat Bluetooth Ditemukan:</p>
      ${settingsState.scannedDevices
        .map(
          (d) => `
        <button type="button" data-connect-mac="${escapeHtml(d.address)}" data-connect-name="${escapeHtml(d.name || 'Printer 58mm')}"
          class="w-full text-left px-3 py-2 rounded-lg bg-white border ${
            cfg.macAddress === d.address ? 'border-primary bg-primarySoft/40' : 'border-slate-200'
          } flex items-center justify-between">
          <div>
            <p class="text-xs font-bold text-slate-900">${escapeHtml(d.name || 'Bluetooth Printer')}</p>
            <p class="font-mono text-[10px] text-slate-500">${escapeHtml(d.address)}</p>
          </div>
          <span class="text-[11px] font-bold text-primaryDark">Hubungkan</span>
        </button>`
        )
        .join('')}
    </div>`;
}

function renderSettingsPage() {
  const container = document.getElementById('page-settings');
  if (!container) return;

  const biz = settingsState.business || {
    business_name: 'SakaPay Top Up',
    whatsapp_number: '',
    business_address: '',
    receipt_footer: 'Terima kasih telah bertransaksi di SakaPay!',
    default_receipt_format: 'lengkap'
  };
  const cfg = getPrinterConfig();
  const receiptLogo = getReceiptLogo();
  const conn = getPrinterConnectionState();
  const adminUser = document.getElementById('settings-admin-username')?.dataset.user || window.__sakapayAdminUsername || 'adminsakapay';

  const statusBadge = conn.connected
    ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">Terhubung: ${escapeHtml(conn.printerName || conn.macAddress)}</span>`
    : `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-200 text-slate-600">Tidak Terhubung</span>`;

  const supHtml = settingsState.suppliers
    .map((s) => {
      const isManual = s.code === 'manual';
      return `
        <div class="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
          <div>
            <p class="text-xs font-bold text-slate-800">${escapeHtml(s.name)}</p>
            <p class="font-mono text-[10px] text-slate-400">Kode: ${escapeHtml(s.code)} • Mode: ${escapeHtml(s.mode)}</p>
          </div>
          ${
            isManual
              ? '<span class="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-1 rounded-lg">Wajib Aktif</span>'
              : `<button type="button" data-toggle-sup="${escapeHtml(s.code)}" data-sup-active="${s.is_active}"
                   class="px-3 py-1.5 rounded-lg text-[11px] font-bold ${
                     s.is_active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'
                   }">${s.is_active ? 'Aktif' : 'Nonaktif'}</button>`
          }
        </div>`;
    })
    .join('');

  container.innerHTML = `
    <div class="space-y-4">
      <!-- 1. PRINTER THERMAL 58MM -->
      <div class="bg-white rounded-2xl border border-slate-200/80 p-4 space-y-3 shadow-sm">
        <div class="flex items-center justify-between gap-2">
          <h3 class="text-xs font-extrabold uppercase tracking-wider text-slate-500">Printer Thermal 58mm</h3>
          ${statusBadge}
        </div>

        ${
          cfg.macAddress
            ? `<p class="text-[11px] text-slate-500">Tersimpan: <strong class="text-slate-800">${escapeHtml(cfg.printerName || 'Printer')}</strong> (<span class="font-mono">${escapeHtml(cfg.macAddress)}</span>)</p>`
            : '<p class="text-[11px] text-slate-400">Belum ada printer Bluetooth dipasangkan.</p>'
        }

        ${
          !isAndroidBridgeReady()
            ? '<div class="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-[11px] text-amber-800">Anda sedang membuka versi browser web. Koneksi Bluetooth ESC/POS fisik aktif otomatis saat dijalankan lewat <strong>Android APK (Fase 8)</strong>.</div>'
            : ''
        }

        <div class="grid grid-cols-2 gap-2">
          <button type="button" id="set-scan-printer"
            class="h-11 rounded-xl bg-primary hover:bg-primaryDark text-white text-xs font-bold shadow-sm">
            Scan & Pilih Printer
          </button>
          <button type="button" id="set-test-print"
            class="h-11 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold">
            Tes Cetak 58mm
          </button>
        </div>

        ${renderPrinterDevicesBox()}

        <div class="grid grid-cols-2 gap-2.5 pt-2 border-t border-slate-100">
          <div>
            <label class="block text-[11px] font-bold text-slate-600 mb-1">Ukuran Font 58mm</label>
            <select id="set-pr-font" class="w-full h-10 px-2.5 rounded-xl border border-slate-200 text-xs font-semibold bg-white">
              <option value="normal" ${cfg.fontSize === 'normal' ? 'selected' : ''}>Normal (32 kolom)</option>
              <option value="small" ${cfg.fontSize === 'small' ? 'selected' : ''}>Kecil Padat (42 kolom)</option>
            </select>
          </div>
          <div>
            <label class="block text-[11px] font-bold text-slate-600 mb-1">Spasi Kertas Akhir</label>
            <input id="set-pr-feed" type="number" min="0" max="8" value="${cfg.feedLines}"
              class="w-full h-10 px-3 rounded-xl border border-slate-200 text-xs font-bold" />
          </div>
        </div>

        <div class="flex items-center justify-between bg-slate-50 rounded-xl p-3">
          <label class="flex items-center gap-2 text-xs font-bold text-slate-700">
            <input id="set-pr-logo" type="checkbox" ${cfg.printLogo ? 'checked' : ''} class="w-4 h-4 accent-primary" />
            Cetak Logo SakaPay
          </label>
          <label class="flex items-center gap-2 text-xs font-bold text-slate-700">
            <input id="set-pr-cut" type="checkbox" ${cfg.autoCut ? 'checked' : ''} class="w-4 h-4 accent-primary" />
            Auto-Cut (jika didukung)
          </label>
        </div>
      </div>

      <!-- 1b. LOGO STRUK THERMAL -->
      <div class="bg-white rounded-2xl border border-slate-200/80 p-4 space-y-3 shadow-sm">
        <div class="flex items-center justify-between gap-2">
          <h3 class="text-xs font-extrabold uppercase tracking-wider text-slate-500">Logo Struk Thermal</h3>
          <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${receiptLogo ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'}">${receiptLogo ? 'Logo Kustom' : 'Logo Bawaan'}</span>
        </div>

        <div class="rounded-xl bg-slate-100 p-3 flex justify-center">
          <div class="bg-white border border-slate-300 px-4 py-3 rounded-sm flex items-center justify-center">
            ${
              receiptLogo
                ? `<img src="${escapeHtml(receiptLogo.dataUrl)}" alt="Logo struk" class="max-w-[240px] h-auto" style="image-rendering:pixelated" />`
                : `<div class="flex items-center gap-2">
                     <svg class="w-10 h-10" viewBox="0 0 108 108" aria-hidden="true">
                       <circle cx="54" cy="54" r="38" fill="none" stroke="#0f172a" stroke-width="9" />
                       <path d="M58,34 L42,57 L52,57 L48,75 L67,50 L57,50 Z" fill="#0f172a" transform="translate(54 54) scale(1.15) translate(-54.5 -54.5)" />
                     </svg>
                     <span class="font-extrabold text-lg tracking-wide text-slate-900">SAKAPAY</span>
                   </div>`
            }
          </div>
        </div>

        <div class="grid grid-cols-2 gap-2">
          <button type="button" id="set-logo-pick" class="h-11 rounded-xl bg-primary hover:bg-primaryDark text-white text-xs font-bold shadow-sm">Upload Foto Logo</button>
          <button type="button" id="set-logo-clear" ${receiptLogo ? '' : 'disabled'} class="h-11 rounded-xl bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-800 text-xs font-bold">Pakai Logo Bawaan</button>
        </div>
        <input id="set-logo-file" type="file" accept="image/*" class="hidden" />

        <div>
          <label class="block text-[11px] font-bold text-slate-600 mb-1">Gaya Cetak</label>
          <select id="set-logo-mode" class="w-full h-10 px-2.5 rounded-xl border border-slate-200 text-xs font-semibold bg-white">
            <option value="foto" ${(receiptLogo?.mode || 'foto') === 'foto' ? 'selected' : ''}>Foto (halus, bertitik)</option>
            <option value="logo" ${receiptLogo?.mode === 'logo' ? 'selected' : ''}>Logo (tegas, hitam-putih)</option>
          </select>
        </div>
        <p class="text-[10px] text-slate-400">Foto otomatis diubah jadi hitam-putih agar bagus di printer thermal. Logo disimpan di HP ini dan tampil di struk bila "Cetak Logo SakaPay" aktif.</p>
      </div>

      <!-- 2. IDENTITAS USAHA DI STRUK -->
      <form id="set-biz-form" class="bg-white rounded-2xl border border-slate-200/80 p-4 space-y-3 shadow-sm">
        <h3 class="text-xs font-extrabold uppercase tracking-wider text-slate-500">Identitas Usaha (Untuk Struk)</h3>
        <div>
          <label class="block text-xs font-bold text-slate-600 mb-1">Nama Usaha *</label>
          <input id="set-biz-name" type="text" required value="${escapeHtml(biz.business_name || '')}"
            class="w-full h-11 px-3.5 rounded-xl border border-slate-200 text-sm font-semibold" />
        </div>
        <div>
          <label class="block text-xs font-bold text-slate-600 mb-1">Nomor WhatsApp Resmi</label>
          <input id="set-biz-wa" type="tel" placeholder="0812xxxxxxxx" value="${escapeHtml(biz.whatsapp_number || '')}"
            class="w-full h-11 px-3.5 rounded-xl border border-slate-200 text-sm font-mono" />
        </div>
        <div>
          <label class="block text-xs font-bold text-slate-600 mb-1">Alamat Usaha</label>
          <input id="set-biz-addr" type="text" placeholder="Contoh: Jl. Merdeka No. 10, Lampung" value="${escapeHtml(biz.business_address || '')}"
            class="w-full h-11 px-3.5 rounded-xl border border-slate-200 text-xs" />
        </div>
        <div>
          <label class="block text-xs font-bold text-slate-600 mb-1">Pesan Footer Struk</label>
          <textarea id="set-biz-footer" rows="2" class="w-full p-3 rounded-xl border border-slate-200 text-xs">${escapeHtml(biz.receipt_footer || '')}</textarea>
        </div>
        <div>
          <label class="block text-xs font-bold text-slate-600 mb-1">Format Struk Default</label>
          <select id="set-biz-fmt" class="w-full h-11 px-3 rounded-xl border border-slate-200 text-xs font-bold bg-white">
            <option value="lengkap" ${biz.default_receipt_format === 'lengkap' ? 'selected' : ''}>Struk Lengkap (Detail Penuh)</option>
            <option value="ringkas" ${biz.default_receipt_format === 'ringkas' ? 'selected' : ''}>Struk Ringkas (Hemat Kertas)</option>
          </select>
        </div>
        <button id="set-biz-submit" type="submit"
          class="w-full h-11 rounded-xl bg-primary hover:bg-primaryDark text-white text-xs font-bold shadow-md shadow-primary/20">
          Simpan Identitas Usaha
        </button>
      </form>

      <!-- 3. SUPPLIER TOP UP -->
      <div class="bg-white rounded-2xl border border-slate-200/80 p-4 space-y-2 shadow-sm">
        <h3 class="text-xs font-extrabold uppercase tracking-wider text-slate-500">Jalur Supplier Top Up</h3>
        ${supHtml}
      </div>

      <!-- 4. BACKUP DATA CSV -->
      <div class="bg-white rounded-2xl border border-slate-200/80 p-4 space-y-2.5 shadow-sm">
        <h3 class="text-xs font-extrabold uppercase tracking-wider text-slate-500">Backup Data CSV (Langsung ke HP)</h3>
        <div class="grid grid-cols-2 gap-2">
          <button type="button" id="set-backup-trx" class="h-11 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold">
            Backup Transaksi
          </button>
          <button type="button" id="set-backup-cust" class="h-11 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold">
            Backup Pelanggan
          </button>
        </div>
      </div>

      <!-- 5. AKUN ADMIN -->
      <div class="bg-white rounded-2xl border border-slate-200/80 p-4 flex items-center justify-between shadow-sm">
        <div>
          <p class="text-[11px] font-bold text-slate-400 uppercase">Akun Admin Aktif</p>
          <p id="settings-admin-username" class="text-sm font-extrabold text-slate-900">${escapeHtml(adminUser)}</p>
        </div>
        <button type="button" id="set-btn-logout"
          class="px-4 py-2.5 rounded-xl bg-red-50 hover:bg-red-100 text-red-700 text-xs font-bold">
          Keluar
        </button>
      </div>
    </div>`;

  bindSettingsEvents();
}

function bindSettingsEvents() {
  const logoFileEl = document.getElementById('set-logo-file');
  document.getElementById('set-logo-pick')?.addEventListener('click', () => logoFileEl?.click());
  logoFileEl?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showToast('Pilih file gambar (JPG/PNG).', 'warning');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      showToast('Ukuran foto maksimal 8 MB.', 'warning');
      return;
    }
    try {
      const mode = document.getElementById('set-logo-mode')?.value || 'foto';
      await applyLogoFile(file, mode);
      settingsState.logoFile = file;
      showToast('Logo struk disimpan.', 'success');
      renderSettingsPage();
    } catch (err) {
      showToast(err?.message || 'Gagal memproses logo (penyimpanan HP mungkin penuh).', 'error');
    }
  });
  document.getElementById('set-logo-mode')?.addEventListener('change', async (e) => {
    if (!settingsState.logoFile) {
      showToast('Upload ulang foto untuk memakai gaya cetak ini.', 'info');
      renderSettingsPage();
      return;
    }
    try {
      await applyLogoFile(settingsState.logoFile, e.target.value);
      renderSettingsPage();
    } catch (err) {
      showToast(err?.message || 'Gagal memproses logo.', 'error');
    }
  });
  document.getElementById('set-logo-clear')?.addEventListener('click', () => {
    clearReceiptLogo();
    settingsState.logoFile = null;
    showToast('Kembali memakai logo bawaan.', 'info');
    renderSettingsPage();
  });

  document.getElementById('set-pr-font')?.addEventListener('change', (e) => {
    savePrinterConfig({ fontSize: e.target.value });
    showToast('Ukuran font printer disimpan.', 'success');
  });
  document.getElementById('set-pr-feed')?.addEventListener('change', (e) => {
    const val = Math.min(8, Math.max(0, parseInt(e.target.value || '3', 10)));
    savePrinterConfig({ feedLines: val });
  });
  document.getElementById('set-pr-logo')?.addEventListener('change', (e) => {
    savePrinterConfig({ printLogo: e.target.checked });
  });
  document.getElementById('set-pr-cut')?.addEventListener('change', (e) => {
    savePrinterConfig({ autoCut: e.target.checked });
  });

  document.getElementById('set-scan-printer')?.addEventListener('click', () => {
    if (!isAndroidBridgeReady() || typeof window.SakaPayAndroid.scanBluetoothPrinters !== 'function') {
      showToast('Scan Bluetooth membutuhkan Android APK (dibangun di Fase 8).', 'warning');
      return;
    }
    try {
      const raw = window.SakaPayAndroid.scanBluetoothPrinters();
      const res = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!res?.ok) throw new Error(res?.error || 'Gagal memindai Bluetooth.');
      settingsState.scannedDevices = res.devices || [];
      if (settingsState.scannedDevices.length === 0) {
        showToast('Tidak ada printer Bluetooth yang ditemukan/paired di HP.', 'warning');
      }
      renderSettingsPage();
    } catch (err) {
      showToast(err?.message || 'Gagal memindai printer.', 'error');
    }
  });

  document.querySelectorAll('[data-connect-mac]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mac = btn.dataset.connectMac;
      const name = btn.dataset.connectName;
      if (!isAndroidBridgeReady() || typeof window.SakaPayAndroid.connectPrinter !== 'function') return;
      try {
        const raw = window.SakaPayAndroid.connectPrinter(mac);
        const res = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (!res?.ok) throw new Error(res?.error || 'Gagal menghubungkan printer.');
        savePrinterConfig({ macAddress: mac, printerName: name });
        showToast(`Terhubung ke ${name}!`, 'success');
        if (typeof settingsState.onPrinterUpdated === 'function') settingsState.onPrinterUpdated();
        renderSettingsPage();
      } catch (err) {
        showToast(err?.message || 'Gagal menghubungkan printer.', 'error');
      }
    });
  });

  document.getElementById('set-test-print')?.addEventListener('click', async () => {
    if (!isAndroidBridgeReady() || typeof window.SakaPayAndroid.printThermal !== 'function') {
      showToast('Tes cetak fisik ESC/POS aktif setelah APK Android dibuat (Fase 8).', 'warning');
      return;
    }
    const conn = getPrinterConnectionState();
    if (!conn.connected && !(await ensurePrinterConnected())) {
      showToast('Printer belum terhubung. Pilih & hubungkan printer dulu.', 'warning');
      return;
    }
    const cfg = getPrinterConfig();
    const biz = settingsState.business || { business_name: 'SakaPay Top Up', whatsapp_number: '', receipt_footer: 'Tes cetak OK!' };
    const sampleText = buildThermalText(
      {
        invoice_code: 'SKP-TEST-0001',
        customer_name: 'Tes Cetak Printer',
        game_name: 'Mobile Legends',
        target_user_id: '12345678',
        target_zone_id: '2145',
        product_name: '86 Diamonds',
        nominal_label: '86 DM',
        sell_price: 22000,
        status: 'BERHASIL',
        created_at: new Date().toISOString()
      },
      biz,
      'ringkas',
      cfg.fontSize
    );
    try {
      const raw = window.SakaPayAndroid.printThermal(
        JSON.stringify({
          text: sampleText,
          fontSize: cfg.fontSize,
          feedLines: cfg.feedLines,
          printLogo: cfg.printLogo,
          logoImageBase64: getReceiptLogo()?.dataUrl || '',
          autoCut: cfg.autoCut
        })
      );
      const res = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!res?.ok) throw new Error(res?.error || 'Tes cetak gagal.');
      showToast('Tes cetak dikirim ke printer!', 'success');
    } catch (err) {
      showToast(err?.message || 'Tes cetak gagal.', 'error');
    }
  });

  document.getElementById('set-biz-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('set-biz-submit');
    btn.disabled = true;
    btn.textContent = 'Menyimpan...';
    try {
      const payload = {
        id: 1,
        business_name: document.getElementById('set-biz-name').value.trim() || 'SakaPay Top Up',
        whatsapp_number: document.getElementById('set-biz-wa').value.trim(),
        business_address: document.getElementById('set-biz-addr').value.trim(),
        receipt_footer: document.getElementById('set-biz-footer').value.trim(),
        default_receipt_format: document.getElementById('set-biz-fmt').value
      };
      const { data, error } = await supabase
        .from('business_settings')
        .upsert(payload)
        .select()
        .single();
      if (error) throw error;
      settingsState.business = data;
      showToast('Identitas usaha disimpan!', 'success');
    } catch (err) {
      showToast(err?.message || 'Gagal menyimpan identitas usaha.', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Simpan Identitas Usaha';
    }
  });

  document.querySelectorAll('[data-toggle-sup]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const code = btn.dataset.toggleSup;
      const next = btn.dataset.supActive !== 'true';
      try {
        const { error } = await supabase
          .from('supplier_providers')
          .update({ is_active: next })
          .eq('code', code);
        if (error) throw error;
        showToast(`Supplier ${code} ${next ? 'diaktifkan' : 'dinonaktifkan'}.`, 'info');
        await loadSettings();
      } catch (err) {
        showToast(err?.message || 'Gagal mengubah status supplier.', 'error');
      }
    });
  });

  document.getElementById('set-backup-trx')?.addEventListener('click', async () => {
    try {
      showToast('Menyiapkan backup transaksi...', 'info');
      const { data, error } = await supabase
        .from('transactions')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      const headers = [
        'Invoice', 'Tanggal_Buat', 'Status', 'Pelanggan', 'WhatsApp', 'Game', 'Produk',
        'User_ID', 'Zone_ID', 'Harga_Modal', 'Harga_Jual', 'Keuntungan',
        'Supplier', 'Ref_Supplier', 'Alasan_Status', 'Modal_Refund_Kembali', 'Catatan'
      ];
      const rows = (data || []).map((t) => [
        t.invoice_code, t.created_at, t.status, t.customer_name_snapshot, t.customer_wa_snapshot,
        t.game_name_snapshot, t.product_name_snapshot, t.target_user_id, t.target_zone_id,
        t.base_price_snapshot, t.sell_price_snapshot, t.profit_snapshot,
        t.supplier_code, t.supplier_ref_id, t.status_reason,
        t.refund_modal_returned === null ? '' : String(t.refund_modal_returned), t.notes
      ]);
      downloadCsvFile(`sakapay-backup-transaksi-${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
    } catch (err) {
      showToast(err?.message || 'Gagal backup transaksi.', 'error');
    }
  });

  document.getElementById('set-backup-cust')?.addEventListener('click', async () => {
    try {
      showToast('Menyiapkan backup pelanggan...', 'info');
      const { data, error } = await supabase
        .from('customers')
        .select('*')
        .order('name', { ascending: true });
      if (error) throw error;
      const headers = ['Nama', 'WhatsApp', 'Total_Order', 'Order_Terakhir', 'Status_Aktif', 'Catatan'];
      const rows = (data || []).map((c) => [
        c.name, c.whatsapp, c.total_orders, c.last_order_at || '', c.is_active ? 'Aktif' : 'Nonaktif', c.notes
      ]);
      downloadCsvFile(`sakapay-backup-pelanggan-${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
    } catch (err) {
      showToast(err?.message || 'Gagal backup pelanggan.', 'error');
    }
  });

  document.getElementById('set-btn-logout')?.addEventListener('click', () => {
    if (typeof settingsState.onLogout === 'function') settingsState.onLogout();
  });
}

export async function loadSettings() {
  if (!supabase) return;
  settingsState.loading = true;
  try {
    const [bizRes, supRes] = await Promise.all([
      supabase.from('business_settings').select('*').eq('id', 1).maybeSingle(),
      supabase.from('supplier_providers').select('code, name, mode, is_active').order('name')
    ]);
    if (bizRes.error) throw bizRes.error;
    if (supRes.error) throw supRes.error;
    settingsState.business = bizRes.data;
    settingsState.suppliers = supRes.data || [];
  } catch (err) {
    showToast(err?.message || 'Gagal memuat pengaturan.', 'error');
  } finally {
    settingsState.loading = false;
    renderSettingsPage();
  }
}

export function initSettingsUI({ onPrinterUpdated, onLogout } = {}) {
  settingsState.onPrinterUpdated = onPrinterUpdated;
  settingsState.onLogout = onLogout;
  renderSettingsPage();
}
