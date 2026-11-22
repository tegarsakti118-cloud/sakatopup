import { supabase } from './supabase.js';
import { escapeHtml, formatIDR, showToast } from './utils.js';

const PRINTER_CFG_KEY = 'sakapay_printer_cfg_v1';

export function getPrinterConfig() {
  try {
    const raw = localStorage.getItem(PRINTER_CFG_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      macAddress: parsed.macAddress || '',
      printerName: parsed.printerName || '',
      paperWidth: parsed.paperWidth || '58mm',
      fontSize: parsed.fontSize || 'normal',
      feedLines: Number.isFinite(Number(parsed.feedLines)) ? Number(parsed.feedLines) : 3,
      printLogo: parsed.printLogo !== false,
      autoCut: Boolean(parsed.autoCut)
    };
  } catch {
    return {
      macAddress: '',
      printerName: '',
      paperWidth: '58mm',
      fontSize: 'normal',
      feedLines: 3,
      printLogo: true,
      autoCut: false
    };
  }
}

export function savePrinterConfig(cfg) {
  const current = getPrinterConfig();
  const next = { ...current, ...cfg };
  localStorage.setItem(PRINTER_CFG_KEY, JSON.stringify(next));
  return next;
}

export function isAndroidBridgeReady() {
  return typeof window !== 'undefined' && typeof window.SakaPayAndroid !== 'undefined';
}

export function getPrinterConnectionState() {
  const cfg = getPrinterConfig();
  if (isAndroidBridgeReady() && typeof window.SakaPayAndroid.getPrinterStatus === 'function') {
    try {
      const res = JSON.parse(window.SakaPayAndroid.getPrinterStatus());
      return {
        available: true,
        connected: Boolean(res.connected),
        printerName: res.printerName || cfg.printerName || '',
        macAddress: res.macAddress || cfg.macAddress || ''
      };
    } catch {
      return { available: true, connected: false, printerName: cfg.printerName, macAddress: cfg.macAddress };
    }
  }
  return { available: false, connected: false, printerName: cfg.printerName, macAddress: cfg.macAddress };
}

export async function fetchReceiptBundle(transactionId) {
  if (!supabase) throw new Error('Supabase belum siap.');

  const [rcpRes, bizRes] = await Promise.all([
    supabase.from('v_customer_receipts').select('*').eq('id', transactionId).single(),
    supabase.from('business_settings').select('*').eq('id', 1).maybeSingle()
  ]);

  if (rcpRes.error) throw rcpRes.error;
  if (bizRes.error) throw bizRes.error;

  return {
    receipt: rcpRes.data,
    business: bizRes.data || {
      business_name: 'SakaPay Top Up',
      whatsapp_number: '',
      business_address: '',
      receipt_footer: 'Terima kasih telah bertransaksi di SakaPay!',
      default_receipt_format: 'lengkap'
    }
  };
}

export async function recordPrintLog({ transactionId, format, method, printerName = '' }) {
  if (!supabase) throw new Error('Supabase belum siap.');
  const { data, error } = await supabase.rpc('log_receipt_print', {
    p_transaction_id: transactionId,
    p_receipt_format: format,
    p_print_method: method,
    p_printer_name: printerName || ''
  });
  if (error) throw error;
  return data;
}

function formatWibReceipt(iso, shortMode = false) {
  const d = new Date(iso || Date.now());
  if (Number.isNaN(d.getTime())) return '-';
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    day: '2-digit',
    month: '2-digit',
    year: shortMode ? '2-digit' : 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(d) + ' WIB';
}

function centerLine(text, cols) {
  const s = String(text || '').trim();
  if (s.length >= cols) return s.slice(0, cols);
  const pad = Math.floor((cols - s.length) / 2);
  return ' '.repeat(pad) + s;
}

function pairLine(left, right, cols) {
  const l = String(left || '');
  const r = String(right || '');
  const space = cols - l.length - r.length;
  if (space >= 1) return l + ' '.repeat(space) + r;
  return `${l}\n${' '.repeat(Math.max(0, cols - r.length))}${r}`;
}

function wrapLines(text, cols) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  const out = [];
  let line = '';
  for (const w of words) {
    if (!line) line = w;
    else if (line.length + 1 + w.length <= cols) line += ' ' + w;
    else {
      out.push(line);
      line = w;
    }
  }
  if (line) out.push(line);
  return out;
}

export function buildThermalText(receipt, business, format = 'lengkap', fontSize = 'normal') {
  const cols = fontSize === 'small' ? 42 : 32;
  const eq = '='.repeat(cols);
  const dash = '-'.repeat(cols);
  const bizName = (business.business_name || 'SAKAPAY TOP UP').toUpperCase();
  const targetId = receipt.target_zone_id
    ? `${receipt.target_user_id} (${receipt.target_zone_id})`
    : receipt.target_user_id;

  const lines = [];
  lines.push(eq);
  lines.push(centerLine(bizName, cols));
  if (format === 'lengkap' && business.business_address) {
    wrapLines(business.business_address, cols).forEach((l) => lines.push(centerLine(l, cols)));
  }
  if (business.whatsapp_number) {
    lines.push(centerLine(`WA: ${business.whatsapp_number}`, cols));
  }
  lines.push(dash);

  if (format === 'ringkas') {
    lines.push(pairLine('ID', receipt.invoice_code, cols));
    lines.push(pairLine('Tgl', formatWibReceipt(receipt.completed_at || receipt.created_at, true), cols));
    lines.push(pairLine('Pembeli', receipt.customer_name.slice(0, cols - 9), cols));
    lines.push(pairLine('Game', receipt.game_name.slice(0, cols - 6), cols));
    lines.push(pairLine('Tujuan', targetId.slice(0, cols - 8), cols));
    lines.push(pairLine('Item', (receipt.nominal_label || receipt.product_name).slice(0, cols - 6), cols));
    lines.push(dash);
    lines.push(pairLine('TOTAL', formatIDR(receipt.sell_price), cols));
    lines.push(pairLine('STATUS', String(receipt.status || '').toUpperCase(), cols));
    lines.push(dash);
    if (business.receipt_footer) {
      wrapLines(business.receipt_footer, cols).slice(0, 2).forEach((l) => lines.push(centerLine(l, cols)));
    }
    lines.push(eq);
    return lines.join('\n');
  }

  lines.push(`ID Trx : ${receipt.invoice_code}`);
  lines.push(`Tgl    : ${formatWibReceipt(receipt.completed_at || receipt.created_at, false)}`);
  lines.push(dash);
  lines.push(`Pelanggan : ${receipt.customer_name}`);
  lines.push(`Game      : ${receipt.game_name}`);
  lines.push(`ID Tujuan : ${targetId}`);
  lines.push(`Produk    : ${receipt.product_name}`);
  lines.push(`Nominal   : ${receipt.nominal_label}`);
  lines.push(dash);
  lines.push(pairLine('HARGA JUAL', formatIDR(receipt.sell_price), cols));
  lines.push(pairLine('STATUS', String(receipt.status || '').toUpperCase(), cols));
  lines.push(dash);
  wrapLines(business.receipt_footer || 'Terima kasih telah bertransaksi!', cols).forEach((l) =>
    lines.push(centerLine(l, cols))
  );
  lines.push(eq);
  return lines.join('\n');
}

function drawDigitalReceiptCanvas(receipt, business, format = 'lengkap') {
  const w = 720;
  const h = format === 'ringkas' ? 760 : 940;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#F8FAFC';
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = '#17A897';
  ctx.fillRect(0, 0, w, 190);

  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 34px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(business.business_name || 'SakaPay Top Up', w / 2, 78);

  ctx.font = '500 20px sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  if (business.whatsapp_number) {
    ctx.fillText(`WhatsApp: ${business.whatsapp_number}`, w / 2, 114);
  }
  if (format === 'lengkap' && business.business_address) {
    ctx.font = '400 18px sans-serif';
    ctx.fillText(business.business_address.slice(0, 52), w / 2, 146);
  }

  ctx.fillStyle = '#FFFFFF';
  ctx.strokeStyle = '#E2E8F0';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(36, 165, w - 72, h - 220, 24);
  ctx.fill();
  ctx.stroke();

  const targetId = receipt.target_zone_id
    ? `${receipt.target_user_id} (${receipt.target_zone_id})`
    : receipt.target_user_id;

  const rows = format === 'ringkas'
    ? [
        ['ID Transaksi', receipt.invoice_code],
        ['Tanggal', formatWibReceipt(receipt.completed_at || receipt.created_at, true)],
        ['Pelanggan', receipt.customer_name],
        ['Game', receipt.game_name],
        ['ID Tujuan', targetId],
        ['Produk', receipt.product_name]
      ]
    : [
        ['ID Transaksi', receipt.invoice_code],
        ['Tanggal', formatWibReceipt(receipt.completed_at || receipt.created_at, false)],
        ['Pelanggan', receipt.customer_name],
        ['Game', receipt.game_name],
        ['ID Tujuan', targetId],
        ['Produk', receipt.product_name],
        ['Nominal', receipt.nominal_label]
      ];

  let y = 235;
  ctx.textAlign = 'center';
  ctx.fillStyle = '#0F172A';
  ctx.font = 'bold 24px sans-serif';
  ctx.fillText('BUKTI TRANSAKSI', w / 2, y);
  y += 45;

  rows.forEach(([k, v]) => {
    ctx.textAlign = 'left';
    ctx.fillStyle = '#64748B';
    ctx.font = '500 21px sans-serif';
    ctx.fillText(k, 70, y);

    ctx.textAlign = 'right';
    ctx.fillStyle = '#0F172A';
    ctx.font = 'bold 21px sans-serif';
    ctx.fillText(String(v || '-').slice(0, 34), w - 70, y);
    y += 48;
  });

  ctx.strokeStyle = '#CBD5E1';
  ctx.setLineDash([8, 8]);
  ctx.beginPath();
  ctx.moveTo(70, y);
  ctx.lineTo(w - 70, y);
  ctx.stroke();
  ctx.setLineDash([]);
  y += 52;

  ctx.textAlign = 'left';
  ctx.fillStyle = '#475569';
  ctx.font = 'bold 24px sans-serif';
  ctx.fillText('TOTAL BAYAR', 70, y);

  ctx.textAlign = 'right';
  ctx.fillStyle = '#17A897';
  ctx.font = 'bold 34px sans-serif';
  ctx.fillText(formatIDR(receipt.sell_price), w - 70, y);
  y += 48;

  ctx.textAlign = 'left';
  ctx.fillStyle = '#475569';
  ctx.font = 'bold 22px sans-serif';
  ctx.fillText('STATUS', 70, y);

  ctx.textAlign = 'right';
  ctx.fillStyle = receipt.status === 'Berhasil' ? '#047857' : receipt.status === 'Gagal' ? '#B91C1C' : '#0F172A';
  ctx.font = 'bold 26px sans-serif';
  ctx.fillText(String(receipt.status || '').toUpperCase(), w - 70, y);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#64748B';
  ctx.font = '500 19px sans-serif';
  ctx.fillText((business.receipt_footer || 'Terima kasih!').slice(0, 56), w / 2, h - 76);

  return canvas;
}

export function openPrinterScanModal({ onConnected = null } = {}) {
  let root = document.getElementById('printer-scan-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'printer-scan-root';
    document.body.appendChild(root);
  }

  const st = { devices: [], loading: false, error: '', connectingMac: '' };
  const close = () => {
    root.innerHTML = '';
  };

  const bridgeHas = (fn) => isAndroidBridgeReady() && typeof window.SakaPayAndroid[fn] === 'function';

  const render = () => {
    const cfg = getPrinterConfig();
    const canScan = bridgeHas('scanBluetoothPrinters');
    const canOpenBtSettings = bridgeHas('openBluetoothSettings');

    let body = '';
    if (!canScan) {
      body = `<div class="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2.5 text-[11px] text-amber-800">Scan printer Bluetooth hanya tersedia di aplikasi Android SakaPay Admin (APK).</div>`;
    } else if (st.loading) {
      body = `<div class="py-6 text-center text-xs font-semibold text-slate-500">Memindai printer...</div>`;
    } else if (st.error) {
      body = `<div class="rounded-xl bg-red-50 border border-red-200 px-3 py-2.5 text-[11px] text-red-700">${escapeHtml(st.error)}</div>`;
    } else if (st.devices.length === 0) {
      body = `<div class="rounded-xl bg-slate-50 border border-slate-200 px-3 py-3 text-[11px] text-slate-600">Belum ada printer yang terpasang (paired). Nyalakan printer, pasangkan dulu lewat Pengaturan Bluetooth HP, lalu tekan Scan Ulang.</div>`;
    } else {
      body = `<div class="space-y-1.5">${st.devices
        .map((d) => {
          const isSaved = cfg.macAddress === d.address;
          const isBusy = st.connectingMac === d.address;
          return `
            <button type="button" data-psc-mac="${escapeHtml(d.address)}" data-psc-name="${escapeHtml(d.name || 'Printer 58mm')}" ${st.connectingMac ? 'disabled' : ''}
              class="w-full text-left px-3 py-2.5 rounded-xl border ${isSaved ? 'border-primary bg-primarySoft/40' : 'border-slate-200 bg-white'} flex items-center justify-between gap-2 disabled:opacity-60">
              <div class="min-w-0">
                <p class="text-xs font-bold text-slate-900 truncate">${escapeHtml(d.name || 'Bluetooth Printer')}</p>
                <p class="font-mono text-[10px] text-slate-500">${escapeHtml(d.address)}</p>
              </div>
              <span class="text-[11px] font-bold text-primaryDark shrink-0">${isBusy ? 'Menghubungkan...' : 'Hubungkan'}</span>
            </button>`;
        })
        .join('')}</div>`;
    }

    root.innerHTML = `
      <div class="fixed inset-0 z-[70] bg-slate-900/60 backdrop-blur-xs flex items-end sm:items-center justify-center">
        <div class="w-full max-w-lg bg-white rounded-t-3xl sm:rounded-3xl p-5 max-h-[85vh] overflow-y-auto space-y-3">
          <div class="flex items-center justify-between">
            <div>
              <h3 class="text-base font-extrabold text-slate-900">Scan Printer Bluetooth</h3>
              <p class="text-[10px] text-slate-400">Pilih printer thermal 58mm untuk mencetak struk</p>
            </div>
            <button type="button" id="psc-close" class="w-8 h-8 rounded-full bg-slate-100 text-slate-600 font-bold text-sm">\u2715</button>
          </div>
          ${body}
          <div class="grid ${canOpenBtSettings ? 'grid-cols-2' : 'grid-cols-1'} gap-2 pt-1">
            <button type="button" id="psc-rescan" ${st.loading || st.connectingMac ? 'disabled' : ''}
              class="h-11 rounded-xl bg-primary hover:bg-primaryDark disabled:opacity-60 text-white text-xs font-bold shadow-sm">Scan Ulang</button>
            ${
              canOpenBtSettings
                ? `<button type="button" id="psc-bt-settings" class="h-11 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold">Buka Pengaturan Bluetooth</button>`
                : ''
            }
          </div>
        </div>
      </div>`;

    document.getElementById('psc-close')?.addEventListener('click', close);
    document.getElementById('psc-rescan')?.addEventListener('click', scan);
    document.getElementById('psc-bt-settings')?.addEventListener('click', () => {
      try {
        window.SakaPayAndroid.openBluetoothSettings();
      } catch {
        showToast('Tidak bisa membuka pengaturan Bluetooth.', 'warning');
      }
    });
    root.querySelectorAll('[data-psc-mac]').forEach((btn) => {
      btn.addEventListener('click', () => connect(btn.dataset.pscMac, btn.dataset.pscName));
    });
  };

  const scan = () => {
    if (!bridgeHas('scanBluetoothPrinters')) {
      render();
      return;
    }
    st.loading = true;
    st.error = '';
    render();
    setTimeout(() => {
      try {
        const raw = window.SakaPayAndroid.scanBluetoothPrinters();
        const res = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (!res?.ok) throw new Error(res?.error || 'Gagal memindai Bluetooth.');
        st.devices = res.devices || [];
      } catch (err) {
        st.devices = [];
        st.error = err?.message || 'Gagal memindai printer.';
      }
      st.loading = false;
      render();
    }, 30);
  };

  const connect = (mac, name) => {
    if (!bridgeHas('connectPrinter')) return;
    st.connectingMac = mac;
    render();
    setTimeout(() => {
      try {
        const raw = window.SakaPayAndroid.connectPrinter(mac);
        const res = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (!res?.ok) throw new Error(res?.error || 'Gagal menghubungkan printer.');
        savePrinterConfig({ macAddress: mac, printerName: name });
        window.dispatchEvent(new CustomEvent('sakapay:printer-updated'));
        showToast(`Terhubung ke ${name}!`, 'success');
        close();
        if (typeof onConnected === 'function') onConnected();
      } catch (err) {
        showToast(err?.message || 'Gagal menghubungkan printer.', 'error');
        st.connectingMac = '';
        render();
      }
    }, 30);
  };

  render();
  scan();
}

export async function printThermal58mm(transactionId, format = 'lengkap', onLogged = null) {
  const conn = getPrinterConnectionState();
  const cfg = getPrinterConfig();

  if (!isAndroidBridgeReady()) {
    showToast('Cetak Bluetooth 58mm membutuhkan Android APK (dibangun di Fase 8). Gunakan Preview / Simpan PDF sementara.', 'warning');
    return false;
  }
  if (!conn.connected) {
    showToast('Printer Bluetooth belum terhubung. Pilih printer dulu.', 'warning');
    openPrinterScanModal({
      onConnected: async () => {
        try {
          const ok = await printThermal58mm(transactionId, format, onLogged);
          if (ok) {
            const prev = document.getElementById('receipt-preview-root');
            if (prev) prev.innerHTML = '';
          }
        } catch (err) {
          showToast(err?.message || 'Gagal mencetak struk.', 'error');
        }
      }
    });
    return false;
  }

  const { receipt, business } = await fetchReceiptBundle(transactionId);
  const textReceipt = buildThermalText(receipt, business, format, cfg.fontSize);

  const payload = {
    text: textReceipt,
    format,
    businessName: business.business_name || 'SakaPay Top Up',
    whatsappNumber: business.whatsapp_number || '',
    businessAddress: business.business_address || '',
    receiptFooter: business.receipt_footer || '',
    fontSize: cfg.fontSize,
    feedLines: cfg.feedLines,
    printLogo: cfg.printLogo,
    autoCut: cfg.autoCut,
    receipt
  };

  const resRaw = window.SakaPayAndroid.printThermal(JSON.stringify(payload));
  const res = typeof resRaw === 'string' ? JSON.parse(resRaw) : resRaw;
  if (!res?.ok) {
    throw new Error(res?.error || 'Gagal mencetak ke printer thermal.');
  }

  await recordPrintLog({
    transactionId,
    format,
    method: 'thermal_58mm',
    printerName: conn.printerName || cfg.printerName || 'Bluetooth 58mm'
  });

  showToast(receipt.print_count > 0 ? 'Cetak ulang struk berhasil!' : 'Struk berhasil dicetak!', 'success');
  if (typeof onLogged === 'function') await onLogged();
  return true;
}

export async function saveReceiptAsPdfOrPrint(transactionId, format = 'lengkap', onLogged = null) {
  const { receipt, business } = await fetchReceiptBundle(transactionId);
  const thermalText = buildThermalText(receipt, business, format, 'normal');

  if (isAndroidBridgeReady() && typeof window.SakaPayAndroid.saveReceiptPdf === 'function') {
    const canvas = drawDigitalReceiptCanvas(receipt, business, format);
    const dataUrl = canvas.toDataURL('image/png');
    const resRaw = window.SakaPayAndroid.saveReceiptPdf(
      JSON.stringify({
        invoiceCode: receipt.invoice_code,
        imageBase64: dataUrl,
        text: thermalText
      })
    );
    const res = typeof resRaw === 'string' ? JSON.parse(resRaw) : resRaw;
    if (!res?.ok) throw new Error(res?.error || 'Gagal menyimpan PDF.');
    await recordPrintLog({ transactionId, format, method: 'pdf', printerName: 'Android PDF' });
    showToast('PDF bukti transaksi disimpan.', 'success');
    if (typeof onLogged === 'function') await onLogged();
    return;
  }

  const win = window.open('', '_blank', 'width=420,height=700');
  if (!win) {
    const canvas = drawDigitalReceiptCanvas(receipt, business, format);
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = `${receipt.invoice_code}.png`;
    a.click();
    await recordPrintLog({ transactionId, format, method: 'pdf', printerName: 'Image Fallback' });
    showToast('Bukti transaksi diunduh sebagai gambar PNG.', 'success');
    if (typeof onLogged === 'function') await onLogged();
    return;
  }

  win.document.write(`
    <!DOCTYPE html><html><head><title>${escapeHtml(receipt.invoice_code)}</title>
    <style>
      body { font-family: monospace; padding: 16px; display: flex; justify-content: center; background: #fff; }
      pre { font-size: 13px; line-height: 1.45; white-space: pre-wrap; margin: 0; border: 1px dashed #ccc; padding: 14px; }
      @media print { pre { border: none; padding: 0; } }
    </style></head>
    <body><pre>${escapeHtml(thermalText)}</pre>
    <script>window.onload = () => { window.print(); };<\/script></body></html>
  `);
  win.document.close();

  await recordPrintLog({ transactionId, format, method: 'pdf', printerName: 'Browser Print/PDF' });
  if (typeof onLogged === 'function') await onLogged();
}

export async function shareReceiptWhatsApp(transactionId, format = 'lengkap', onLogged = null) {
  const { receipt, business } = await fetchReceiptBundle(transactionId);
  const canvas = drawDigitalReceiptCanvas(receipt, business, format);
  const targetId = receipt.target_zone_id
    ? `${receipt.target_user_id} (${receipt.target_zone_id})`
    : receipt.target_user_id;

  const waMessage = [
    `*${business.business_name || 'SakaPay Top Up'}*`,
    `ID Trx: ${receipt.invoice_code}`,
    `Pelanggan: ${receipt.customer_name}`,
    `Game: ${receipt.game_name}`,
    `ID Tujuan: ${targetId}`,
    `Produk: ${receipt.product_name}`,
    `Harga: ${formatIDR(receipt.sell_price)}`,
    `Status: *${String(receipt.status || '').toUpperCase()}*`,
    '',
    business.receipt_footer || 'Terima kasih!'
  ].join('\n');

  if (isAndroidBridgeReady() && typeof window.SakaPayAndroid.shareReceiptWhatsApp === 'function') {
    const resRaw = window.SakaPayAndroid.shareReceiptWhatsApp(
      JSON.stringify({
        invoiceCode: receipt.invoice_code,
        phone: receipt.customer_wa || '',
        text: waMessage,
        imageBase64: canvas.toDataURL('image/png')
      })
    );
    const res = typeof resRaw === 'string' ? JSON.parse(resRaw) : resRaw;
    if (!res?.ok) throw new Error(res?.error || 'Gagal membagikan ke WhatsApp.');
    await recordPrintLog({ transactionId, format, method: 'whatsapp_share', printerName: 'WhatsApp Intent' });
    if (typeof onLogged === 'function') await onLogged();
    return;
  }

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (blob && navigator.canShare) {
    const file = new File([blob], `${receipt.invoice_code}.png`, { type: 'image/png' });
    if (navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: receipt.invoice_code, text: waMessage });
      await recordPrintLog({ transactionId, format, method: 'whatsapp_share', printerName: 'Web Share API' });
      if (typeof onLogged === 'function') await onLogged();
      return;
    }
  }

  const waUrl = receipt.customer_wa
    ? `https://wa.me/${encodeURIComponent(receipt.customer_wa)}?text=${encodeURIComponent(waMessage)}`
    : `https://wa.me/?text=${encodeURIComponent(waMessage)}`;
  window.open(waUrl, '_blank', 'noopener');
  await recordPrintLog({ transactionId, format, method: 'whatsapp_share', printerName: 'WhatsApp Link' });
  if (typeof onLogged === 'function') await onLogged();
}

export async function openReceiptPreviewModal(transactionId, onLogged = null) {
  let root = document.getElementById('receipt-preview-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'receipt-preview-root';
    document.body.appendChild(root);
  }

  root.innerHTML = `
    <div class="fixed inset-0 z-[60] bg-slate-900/60 backdrop-blur-xs flex items-end sm:items-center justify-center">
      <div class="w-full max-w-lg bg-white rounded-t-3xl sm:rounded-3xl p-5 text-center text-xs text-slate-500">
        Menyiapkan preview struk...
      </div>
    </div>`;

  try {
    const { receipt, business } = await fetchReceiptBundle(transactionId);
    const cfg = getPrinterConfig();
    let format = business.default_receipt_format || 'lengkap';
    let viewMode = 'thermal';

    const renderModal = () => {
      const thermalText = buildThermalText(receipt, business, format, cfg.fontSize);
      const printLabel = receipt.print_count > 0 ? 'Cetak Ulang 58mm' : 'Cetak Struk 58mm';

      let bodyPreview = '';
      if (viewMode === 'thermal') {
        bodyPreview = `
          <div class="bg-slate-200/80 rounded-2xl p-4 flex justify-center overflow-x-auto">
            <div class="bg-white shadow-md px-3.5 py-4 rounded-sm border border-slate-300 text-slate-900">
              ${
                cfg.printLogo
                  ? `<div class="text-center mb-1"><span class="inline-block px-2 py-0.5 border-2 border-slate-900 font-mono text-[11px] font-extrabold tracking-widest">SAKAPAY</span></div>`
                  : ''
              }
              <pre class="font-mono ${cfg.fontSize === 'small' ? 'text-[10px]' : 'text-[11px]'} leading-snug whitespace-pre">${escapeHtml(thermalText)}</pre>
            </div>
          </div>`;
      } else {
        const canvas = drawDigitalReceiptCanvas(receipt, business, format);
        bodyPreview = `
          <div class="bg-slate-100 rounded-2xl p-3 flex justify-center">
            <img src="${canvas.toDataURL('image/png')}" alt="Struk Digital" class="w-full max-w-[300px] rounded-xl shadow border border-slate-200" />
          </div>`;
      }

      root.innerHTML = `
        <div class="fixed inset-0 z-[60] bg-slate-900/60 backdrop-blur-xs flex items-end sm:items-center justify-center">
          <div class="w-full max-w-lg bg-white rounded-t-3xl sm:rounded-3xl p-5 max-h-[92vh] overflow-y-auto space-y-3.5">
            <div class="flex items-center justify-between">
              <div>
                <h3 class="text-base font-extrabold text-slate-900">Preview Bukti Transaksi</h3>
                <p class="text-[10px] text-slate-400">Tanpa harga modal & profit • Cetak ke-${receipt.print_count + 1}</p>
              </div>
              <button type="button" id="rcp-close" class="w-8 h-8 rounded-full bg-slate-100 text-slate-600 font-bold text-sm">✕</button>
            </div>

            <div class="grid grid-cols-2 gap-2">
              <div class="grid grid-cols-2 p-1 rounded-xl bg-slate-100">
                <button type="button" data-fmt="lengkap" class="rcp-fmt-btn py-1.5 rounded-lg text-[11px] font-bold ${format === 'lengkap' ? 'bg-white text-primaryDark shadow-xs' : 'text-slate-600'}">Lengkap</button>
                <button type="button" data-fmt="ringkas" class="rcp-fmt-btn py-1.5 rounded-lg text-[11px] font-bold ${format === 'ringkas' ? 'bg-white text-primaryDark shadow-xs' : 'text-slate-600'}">Ringkas</button>
              </div>
              <div class="grid grid-cols-2 p-1 rounded-xl bg-slate-100">
                <button type="button" data-mode="thermal" class="rcp-mode-btn py-1.5 rounded-lg text-[11px] font-bold ${viewMode === 'thermal' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'}">Thermal 58mm</button>
                <button type="button" data-mode="digital" class="rcp-mode-btn py-1.5 rounded-lg text-[11px] font-bold ${viewMode === 'digital' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'}">Digital PNG</button>
              </div>
            </div>

            ${bodyPreview}

            <div class="grid grid-cols-2 gap-2 pt-1">
              <button type="button" id="rcp-btn-print" class="h-11 rounded-xl bg-primary hover:bg-primaryDark text-white text-xs font-bold shadow-sm">${printLabel}</button>
              <button type="button" id="rcp-btn-wa" class="h-11 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-sm">Bagikan ke WA</button>
              <button type="button" id="rcp-btn-pdf" class="col-span-2 h-10 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold">Simpan PDF / Gambar</button>
              <button type="button" id="rcp-btn-scan" class="col-span-2 h-10 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold">Scan Printer Bluetooth</button>
            </div>
          </div>
        </div>`;

      document.getElementById('rcp-close').addEventListener('click', () => (root.innerHTML = ''));
      root.querySelectorAll('.rcp-fmt-btn').forEach((b) =>
        b.addEventListener('click', () => {
          format = b.dataset.fmt;
          renderModal();
        })
      );
      root.querySelectorAll('.rcp-mode-btn').forEach((b) =>
        b.addEventListener('click', () => {
          viewMode = b.dataset.mode;
          renderModal();
        })
      );

      document.getElementById('rcp-btn-print').addEventListener('click', async () => {
        try {
          const ok = await printThermal58mm(transactionId, format, onLogged);
          if (ok) root.innerHTML = '';
        } catch (err) {
          showToast(err?.message || 'Gagal mencetak struk.', 'error');
        }
      });
      document.getElementById('rcp-btn-scan').addEventListener('click', () => {
        openPrinterScanModal();
      });
      document.getElementById('rcp-btn-wa').addEventListener('click', async () => {
        try {
          await shareReceiptWhatsApp(transactionId, format, onLogged);
        } catch (err) {
          showToast(err?.message || 'Gagal membagikan struk.', 'error');
        }
      });
      document.getElementById('rcp-btn-pdf').addEventListener('click', async () => {
        try {
          await saveReceiptAsPdfOrPrint(transactionId, format, onLogged);
        } catch (err) {
          showToast(err?.message || 'Gagal menyimpan PDF.', 'error');
        }
      });
    };

    renderModal();
  } catch (err) {
    root.innerHTML = '';
    showToast(err?.message || 'Gagal membuka preview struk.', 'error');
  }
}
