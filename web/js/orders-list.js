import {
  fetchTransactions,
  fetchFilterGames,
  fetchTransactionDetail,
  updateTransactionStatus,
  correctTransactionRefund,
  invokeDigiflazzOrder
} from './orders-api.js';
import {
  getPrinterConnectionState,
  printThermal58mm,
  saveReceiptAsPdfOrPrint,
  shareReceiptWhatsApp,
  openReceiptPreviewModal
} from './receipt.js';
import { downloadCsvFile } from './settings.js';
import { escapeHtml, formatIDR, formatWIB, getStatusBadge, showToast } from './utils.js';

const listState = {
  search: '',
  status: 'all',
  gameId: 'all',
  startDate: '',
  endDate: '',
  games: [],
  rows: [],
  loading: false,
  onChanged: null
};

let searchTimer = null;

function getDetailModalRoot() {
  let root = document.getElementById('trx-detail-modal-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'trx-detail-modal-root';
    document.body.appendChild(root);
  }
  return root;
}

function closeDetailModal() {
  getDetailModalRoot().innerHTML = '';
}

async function copyText(text, label = 'Teks') {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      showToast(`${label} disalin: ${text}`, 'success');
      return;
    }
  } catch {
    // fallback
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
    showToast(`${label} disalin: ${text}`, 'success');
  } catch {
    showToast('Gagal menyalin otomatis.', 'warning');
  }
  ta.remove();
}

function computeFilteredSummary(rows) {
  let berhasilCount = 0;
  let refundCount = 0;
  let netOmzet = 0;
  let netModal = 0;

  for (const t of rows) {
    if (t.status === 'Berhasil') {
      berhasilCount++;
      netOmzet += Number(t.sell_price_snapshot || 0);
      netModal += Number(t.base_price_snapshot || 0);
    } else if (t.status === 'Refund') {
      refundCount++;
      if (t.refund_modal_returned === false) {
        netModal += Number(t.base_price_snapshot || 0);
      }
    }
  }
  return {
    totalCount: rows.length,
    berhasilCount,
    refundCount,
    netOmzet,
    netModal,
    netProfit: netOmzet - netModal
  };
}

function renderOrdersPage() {
  const container = document.getElementById('page-orders');
  if (!container) return;

  const statuses = [
    { key: 'all', label: 'Semua' },
    { key: 'Menunggu', label: 'Menunggu' },
    { key: 'Diproses', label: 'Diproses' },
    { key: 'Berhasil', label: 'Berhasil' },
    { key: 'Gagal', label: 'Gagal' },
    { key: 'Refund', label: 'Refund' }
  ];

  const chipsHtml = statuses
    .map((s) => {
      const active = listState.status === s.key;
      return `<button type="button" data-ord-status="${s.key}"
        class="shrink-0 px-3 py-1.5 rounded-full text-xs font-bold border transition ${
          active ? 'bg-primary text-white border-primary' : 'bg-white text-slate-600 border-slate-200'
        }">${s.label}</button>`;
    })
    .join('');

  const gameOpts = [
    '<option value="all">Semua Game</option>',
    ...listState.games.map(
      (g) => `<option value="${g.id}" ${listState.gameId === g.id ? 'selected' : ''}>${escapeHtml(g.name)}</option>`
    )
  ].join('');

  const sum = computeFilteredSummary(listState.rows);

  let listHtml = '';
  if (listState.loading && listState.rows.length === 0) {
    listHtml = '<div class="bg-white rounded-2xl border border-slate-200 p-6 text-center text-xs text-slate-400">Memuat daftar transaksi...</div>';
  } else if (listState.rows.length === 0) {
    listHtml = '<div class="bg-white rounded-2xl border border-slate-200 p-6 text-center text-xs text-slate-400">Tidak ada transaksi sesuai filter.</div>';
  } else {
    listHtml = listState.rows
      .map((trx) => {
        const badge = getStatusBadge(trx.status);
        const zone = trx.target_zone_id ? ` (${escapeHtml(trx.target_zone_id)})` : '';
        return `
          <button type="button" data-open-trx="${trx.id}"
            class="w-full text-left bg-white rounded-2xl border border-slate-200/80 p-3.5 space-y-1.5 shadow-sm active:scale-[0.99] transition">
            <div class="flex items-center justify-between gap-2">
              <span class="font-mono text-[11px] font-bold text-slate-500">${escapeHtml(trx.invoice_code)}</span>
              <span class="px-2 py-0.5 rounded-full text-[10px] font-bold border ${badge}">${escapeHtml(trx.status)}</span>
            </div>
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <p class="text-xs font-extrabold text-slate-900 truncate">${escapeHtml(trx.game_name_snapshot)} • ${escapeHtml(trx.product_name_snapshot)}</p>
                <p class="text-[11px] text-slate-500 truncate">${escapeHtml(trx.customer_name_snapshot)} • ID: <span class="font-mono">${escapeHtml(trx.target_user_id)}${zone}</span></p>
              </div>
              <div class="text-right shrink-0">
                <p class="text-xs font-extrabold tabular-nums text-slate-900">${formatIDR(trx.sell_price_snapshot)}</p>
                <p class="text-[10px] font-bold tabular-nums text-emerald-700">+${formatIDR(trx.profit_snapshot)}</p>
              </div>
            </div>
            <div class="flex items-center justify-between text-[10px] text-slate-400 pt-0.5">
              <span>${formatWIB(trx.created_at)}${trx.print_count > 0 ? ` • Cetak ${trx.print_count}x` : ''}</span>
              <span class="font-semibold text-primaryDark">Detail / Struk →</span>
            </div>
          </button>`;
      })
      .join('');
  }

  container.innerHTML = `
    <div class="space-y-3">
      <div class="flex gap-2">
        <input id="ord-list-search" type="search" value="${escapeHtml(listState.search)}"
          placeholder="Cari Invoice, Nama, User ID, atau No WA..."
          class="flex-1 h-11 px-3.5 rounded-xl border border-slate-200 bg-white text-xs font-medium focus:outline-none focus:border-primary" />
        <button type="button" id="ord-export-csv"
          class="px-3 h-11 rounded-xl bg-slate-900 text-white text-xs font-bold shrink-0">
          CSV ↓
        </button>
      </div>

      <div class="flex gap-1.5 overflow-x-auto no-scrollbar pb-0.5">${chipsHtml}</div>

      <div class="bg-white rounded-2xl border border-slate-200/80 p-3 space-y-2">
        <div class="grid grid-cols-2 gap-2">
          <div>
            <label class="block text-[10px] font-bold text-slate-500 mb-0.5">Dari Tanggal</label>
            <input id="ord-date-start" type="date" value="${escapeHtml(listState.startDate)}"
              class="w-full h-9 px-2.5 rounded-lg border border-slate-200 text-xs" />
          </div>
          <div>
            <label class="block text-[10px] font-bold text-slate-500 mb-0.5">Sampai Tanggal</label>
            <input id="ord-date-end" type="date" value="${escapeHtml(listState.endDate)}"
              class="w-full h-9 px-2.5 rounded-lg border border-slate-200 text-xs" />
          </div>
        </div>
        <div class="flex items-center gap-2">
          <select id="ord-game-filter" class="flex-1 h-9 px-2.5 rounded-lg border border-slate-200 text-xs font-semibold bg-white">${gameOpts}</select>
          <button type="button" id="ord-reset-filter" class="px-3 h-9 rounded-lg bg-slate-100 text-slate-600 text-[11px] font-bold">Reset</button>
        </div>
      </div>

      <div class="rounded-2xl bg-primarySoft/70 border border-primary/20 p-3 grid grid-cols-3 gap-2 text-center">
        <div>
          <p class="text-[10px] text-primaryDark font-semibold">${sum.berhasilCount} Sukses / ${sum.totalCount} Trx</p>
          <p class="text-xs font-extrabold tabular-nums text-slate-900">${formatIDR(sum.netOmzet)}</p>
        </div>
        <div>
          <p class="text-[10px] text-primaryDark font-semibold">Modal Net</p>
          <p class="text-xs font-bold tabular-nums text-slate-700">${formatIDR(sum.netModal)}</p>
        </div>
        <div>
          <p class="text-[10px] text-primaryDark font-semibold">Untung Net</p>
          <p class="text-xs font-extrabold tabular-nums ${sum.netProfit < 0 ? 'text-red-600' : 'text-emerald-700'}">${formatIDR(sum.netProfit)}</p>
        </div>
      </div>

      <div class="space-y-2.5">${listHtml}</div>
    </div>`;

  bindOrdersPageEvents();
}

function bindOrdersPageEvents() {
  const searchEl = document.getElementById('ord-list-search');
  if (searchEl) {
    searchEl.addEventListener('input', (e) => {
      listState.search = e.target.value;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => loadOrdersList(true), 350);
    });
  }

  document.getElementById('ord-date-start')?.addEventListener('change', (e) => {
    listState.startDate = e.target.value;
    loadOrdersList();
  });
  document.getElementById('ord-date-end')?.addEventListener('change', (e) => {
    listState.endDate = e.target.value;
    loadOrdersList();
  });
  document.getElementById('ord-game-filter')?.addEventListener('change', (e) => {
    listState.gameId = e.target.value;
    loadOrdersList();
  });
  document.getElementById('ord-reset-filter')?.addEventListener('click', () => {
    listState.search = '';
    listState.status = 'all';
    listState.gameId = 'all';
    listState.startDate = '';
    listState.endDate = '';
    loadOrdersList();
  });

  document.getElementById('ord-export-csv')?.addEventListener('click', () => {
    if (!listState.rows.length) {
      showToast('Tidak ada data transaksi untuk diekspor.', 'warning');
      return;
    }
    const headers = [
      'Invoice', 'Waktu_WIB', 'Status', 'Pelanggan', 'WhatsApp', 'Game', 'Produk',
      'User_ID', 'Zone_ID', 'Harga_Modal', 'Harga_Jual', 'Keuntungan',
      'Supplier', 'Ref_Supplier', 'Alasan_Status', 'Modal_Refund_Kembali', 'Catatan'
    ];
    const rows = listState.rows.map((t) => [
      t.invoice_code, formatWIB(t.created_at), t.status, t.customer_name_snapshot,
      t.customer_wa_snapshot, t.game_name_snapshot, t.product_name_snapshot,
      t.target_user_id, t.target_zone_id, t.base_price_snapshot, t.sell_price_snapshot,
      t.profit_snapshot, t.supplier_code, t.supplier_ref_id, t.status_reason,
      t.refund_modal_returned === null ? '' : String(t.refund_modal_returned), t.notes
    ]);
    const periodTag = listState.startDate || listState.endDate
      ? `${listState.startDate || 'awal'}_sd_${listState.endDate || 'akhir'}`
      : new Date().toISOString().slice(0, 10);
    downloadCsvFile(`sakapay-laporan-${periodTag}.csv`, headers, rows);
  });

  document.querySelectorAll('[data-ord-status]').forEach((btn) => {
    btn.addEventListener('click', () => {
      listState.status = btn.dataset.ordStatus;
      loadOrdersList();
    });
  });

  document.querySelectorAll('[data-open-trx]').forEach((btn) => {
    btn.addEventListener('click', () => openTransactionDetail(btn.dataset.openTrx));
  });
}

function renderActionSection(trx, suppliers) {
  if (trx.status === 'Menunggu') {
    const supOpts = suppliers
      .map((s) => `<option value="${escapeHtml(s.code)}" ${s.code === trx.supplier_code ? 'selected' : ''}>${escapeHtml(s.name)}</option>`)
      .join('');

    return `
      <div class="bg-amber-50/70 border border-amber-200 rounded-2xl p-3.5 space-y-3">
        <p class="text-xs font-extrabold text-amber-900">Proses Pesanan (Menunggu)</p>
        <div class="space-y-2">
          <label class="block text-[11px] font-bold text-slate-600">Pilih Supplier</label>
          <select id="det-sup-select" class="w-full h-10 px-3 rounded-xl border border-slate-200 bg-white text-xs font-semibold">${supOpts}</select>
          <input id="det-ref-input" type="text" placeholder="Ref/ID Supplier awal (opsional)"
            class="w-full h-10 px-3 rounded-xl border border-slate-200 bg-white text-xs font-mono" />
          <button type="button" id="det-btn-process"
            class="w-full h-11 rounded-xl bg-primary hover:bg-primaryDark text-white text-xs font-bold shadow-sm">
            Mulai Proses (Ubah ke Diproses)
          </button>
        </div>
        <div class="pt-2 border-t border-amber-200/80 space-y-2">
          <input id="det-fail-reason" type="text" placeholder="Alasan pembatalan (min. 5 karakter)"
            class="w-full h-10 px-3 rounded-xl border border-red-200 bg-white text-xs" />
          <button type="button" id="det-btn-fail"
            class="w-full h-10 rounded-xl bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 text-xs font-bold">
            Batalkan Pesanan (Gagal)
          </button>
        </div>
      </div>`;
  }

  if (trx.status === 'Diproses') {
    const digiBtn = trx.supplier_code === 'digiflazz'
      ? `<button type="button" id="det-btn-digiflazz" class="w-full h-11 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold">Kirim Otomatis via Digiflazz API</button>`
      : '';

    return `
      <div class="bg-blue-50/70 border border-blue-200 rounded-2xl p-3.5 space-y-3">
        <p class="text-xs font-extrabold text-blue-900">Konfirmasi Hasil Top Up (Diproses)</p>
        ${digiBtn}
        <div class="space-y-2">
          <label class="block text-[11px] font-bold text-slate-600">No. SN / Ref Supplier (Opsional)</label>
          <input id="det-ref-input" type="text" value="${escapeHtml(trx.supplier_ref_id || '')}" placeholder="Contoh: SN12345678"
            class="w-full h-10 px-3 rounded-xl border border-slate-200 bg-white text-xs font-mono" />
          <button type="button" id="det-btn-success"
            class="w-full h-11 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-sm">
            Konfirmasi Top Up BERHASIL
          </button>
        </div>
        <div class="pt-2 border-t border-blue-200/80 space-y-2">
          <input id="det-fail-reason" type="text" placeholder="Alasan gagal dari supplier (min. 5 karakter)"
            class="w-full h-10 px-3 rounded-xl border border-red-200 bg-white text-xs" />
          <button type="button" id="det-btn-fail"
            class="w-full h-10 rounded-xl bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 text-xs font-bold">
            Tandai GAGAL
          </button>
        </div>
      </div>`;
  }

  if (trx.status === 'Berhasil') {
    return `
      <div class="bg-emerald-50/70 border border-emerald-200 rounded-2xl p-3.5 space-y-3">
        <p class="text-[11px] font-bold text-emerald-900">Transaksi Berhasil terkunci permanen (edit/hapus dinonaktifkan).</p>
        <button type="button" id="det-toggle-refund"
          class="w-full h-10 rounded-xl bg-purple-50 hover:bg-purple-100 text-purple-800 border border-purple-200 text-xs font-bold">
          Ajukan Koreksi / Refund
        </button>
        <div id="det-refund-box" class="hidden space-y-2.5 pt-2 border-t border-emerald-200">
          <textarea id="det-refund-reason" rows="2" placeholder="Alasan wajib koreksi/refund (min. 5 karakter)..."
            class="w-full p-2.5 rounded-xl border border-purple-200 bg-white text-xs"></textarea>
          <div class="space-y-1.5 text-xs font-semibold text-slate-700 bg-white rounded-xl p-2.5 border border-purple-100">
            <p class="text-[11px] font-bold text-purple-900">Status Modal dari Supplier:</p>
            <label class="flex items-center gap-2"><input type="radio" name="det-modal-ret" value="true" class="accent-purple-700" /><span>Modal Kembali (saldo supplier balik)</span></label>
            <label class="flex items-center gap-2"><input type="radio" name="det-modal-ret" value="false" class="accent-red-600" /><span class="text-red-700">Modal Hangus (saldo tidak kembali)</span></label>
          </div>
          <button type="button" id="det-btn-refund" class="w-full h-11 rounded-xl bg-purple-700 hover:bg-purple-800 text-white text-xs font-bold">Simpan Koreksi Refund</button>
        </div>
      </div>`;
  }

  return `
    <div class="bg-slate-100 border border-slate-200 rounded-2xl p-3.5 text-xs text-slate-600 space-y-1">
      <p class="font-bold text-slate-800">Status Final: ${escapeHtml(trx.status)}</p>
      ${trx.status_reason ? `<p>Alasan: ${escapeHtml(trx.status_reason)}</p>` : ''}
      ${
        trx.status === 'Refund'
          ? `<p class="font-bold ${trx.refund_modal_returned ? 'text-emerald-700' : 'text-red-600'}">
               ${trx.refund_modal_returned ? 'Modal Kembali dari Supplier' : 'Modal Hangus (Kerugian Riil)'}
             </p>`
          : ''
      }
    </div>`;
}

export async function openTransactionDetail(transactionId) {
  const root = getDetailModalRoot();
  root.innerHTML = `
    <div class="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-end sm:items-center justify-center">
      <div class="w-full max-w-lg bg-white rounded-t-3xl sm:rounded-3xl p-6 text-center text-xs text-slate-500">Memuat detail transaksi...</div>
    </div>`;

  try {
    const { transaction: trx, logs, printLogs, suppliers, defaultFormat } = await fetchTransactionDetail(transactionId);
    const badge = getStatusBadge(trx.status);
    const targetFull = trx.target_zone_id ? `${trx.target_user_id} (${trx.target_zone_id})` : trx.target_user_id;
    const copyIdPayload = trx.target_zone_id ? `${trx.target_user_id}${trx.target_zone_id}` : trx.target_user_id;
    const printerConn = getPrinterConnectionState();
    const printBtnLabel = trx.print_count > 0 ? `Cetak Ulang (${trx.print_count}x)` : 'Cetak Struk 58mm';

    const logsHtml = logs.length
      ? logs.map((l) => `
          <div class="text-[11px] border-l-2 border-primary/40 pl-2.5 py-0.5 space-y-0.5">
            <p class="font-bold text-slate-800">${escapeHtml(l.action_type)}${l.new_status ? ` → ${escapeHtml(l.new_status)}` : ''}</p>
            ${l.reason ? `<p class="text-slate-600">${escapeHtml(l.reason)}</p>` : ''}
            <p class="text-[10px] text-slate-400">${formatWIB(l.created_at)}</p>
          </div>`).join('')
      : '<p class="text-[11px] text-slate-400">Belum ada log.</p>';

    const printLogsHtml = printLogs.length
      ? printLogs.map((p) => `
          <div class="flex items-center justify-between text-[11px] bg-slate-50 rounded-lg px-2.5 py-1.5">
            <span><strong>#${p.print_sequence}</strong> ${p.print_sequence === 1 ? 'Cetak' : 'Cetak Ulang'} (${escapeHtml(p.receipt_format)} • ${escapeHtml(p.print_method)})</span>
            <span class="text-[10px] text-slate-400">${formatWIB(p.printed_at)}</span>
          </div>`).join('')
      : '<p class="text-[11px] text-slate-400">Belum pernah dicetak/dibagikan.</p>';

    root.innerHTML = `
      <div class="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-end sm:items-center justify-center">
        <div class="w-full max-w-lg bg-white rounded-t-3xl sm:rounded-3xl p-5 max-h-[92vh] overflow-y-auto space-y-4">
          <div class="flex items-center justify-between gap-2">
            <div>
              <p class="font-mono text-xs font-extrabold text-slate-500">${escapeHtml(trx.invoice_code)}</p>
              <span class="mt-1 inline-block px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${badge}">${escapeHtml(trx.status)}</span>
            </div>
            <button type="button" id="det-close-btn" class="w-9 h-9 rounded-full bg-slate-100 text-slate-600 font-bold text-sm">✕</button>
          </div>

          <div class="bg-slate-50 rounded-2xl p-3.5 space-y-2 text-xs">
            <div class="flex justify-between gap-2"><span class="text-slate-500">Game / Produk</span><span class="font-bold text-right text-slate-900">${escapeHtml(trx.game_name_snapshot)} • ${escapeHtml(trx.product_name_snapshot)}</span></div>
            <div class="flex items-center justify-between gap-2">
              <span class="text-slate-500">ID Tujuan</span>
              <div class="flex items-center gap-1.5">
                <span class="font-mono font-extrabold text-primaryDark">${escapeHtml(targetFull)}</span>
                <button type="button" id="det-copy-uid" class="px-2 py-1 rounded-lg bg-primarySoft text-primaryDark text-[10px] font-bold">Salin ID</button>
              </div>
            </div>
            <div class="flex justify-between gap-2"><span class="text-slate-500">Pembeli</span><span class="font-bold text-slate-900">${escapeHtml(trx.customer_name_snapshot)}</span></div>
            <div class="flex justify-between gap-2"><span class="text-slate-500">WhatsApp</span><span class="font-mono text-slate-700">${trx.customer_wa_snapshot ? escapeHtml(trx.customer_wa_snapshot) : 'Offline (Tanpa WA)'}</span></div>
            <div class="flex justify-between gap-2"><span class="text-slate-500">Supplier</span><span class="font-mono font-semibold text-slate-700">${escapeHtml(trx.supplier_code)}${trx.supplier_ref_id ? ` • ${escapeHtml(trx.supplier_ref_id)}` : ''}</span></div>
            ${trx.notes ? `<div class="flex justify-between gap-2"><span class="text-slate-500">Catatan</span><span class="text-slate-700">${escapeHtml(trx.notes)}</span></div>` : ''}
            <div class="border-t border-slate-200 pt-2 grid grid-cols-3 gap-2 text-center">
              <div><p class="text-[10px] text-slate-500">Jual</p><p class="font-extrabold text-slate-900">${formatIDR(trx.sell_price_snapshot)}</p></div>
              <div><p class="text-[10px] text-slate-500">Modal</p><p class="font-bold text-slate-700">${formatIDR(trx.base_price_snapshot)}</p></div>
              <div><p class="text-[10px] text-slate-500">Untung</p><p class="font-extrabold text-emerald-700">${formatIDR(trx.profit_snapshot)}</p></div>
            </div>
          </div>

          ${renderActionSection(trx, suppliers)}

          <!-- BUKTI TRANSAKSI & CETAK THERMAL 58MM -->
          <div class="bg-white border border-slate-200 rounded-2xl p-3.5 space-y-3">
            <div class="flex items-center justify-between gap-2">
              <h4 class="text-xs font-extrabold uppercase tracking-wider text-slate-500">Bukti & Struk 58mm</h4>
              <span class="text-[10px] font-bold ${printerConn.connected ? 'text-emerald-700' : 'text-slate-400'}">
                ${printerConn.connected ? `● ${escapeHtml(printerConn.printerName || 'Siap')}` : '● Printer Offline'}
              </span>
            </div>

            <div class="flex items-center justify-between gap-2 bg-slate-50 rounded-xl px-3 py-2">
              <span class="text-[11px] font-bold text-slate-600">Format Struk:</span>
              <select id="det-rcp-fmt" class="text-xs font-bold text-primaryDark bg-transparent focus:outline-none">
                <option value="lengkap" ${defaultFormat === 'lengkap' ? 'selected' : ''}>Lengkap (Detail)</option>
                <option value="ringkas" ${defaultFormat === 'ringkas' ? 'selected' : ''}>Ringkas (Hemat Kertas)</option>
              </select>
            </div>

            <div class="grid grid-cols-2 gap-2">
              <button type="button" id="det-btn-print" class="h-11 rounded-xl bg-primary hover:bg-primaryDark text-white text-xs font-bold shadow-sm">${printBtnLabel}</button>
              <button type="button" id="det-btn-preview" class="h-11 rounded-xl bg-primarySoft text-primaryDark text-xs font-bold">Preview Struk</button>
              <button type="button" id="det-btn-pdf" class="h-10 rounded-xl bg-slate-100 text-slate-800 text-xs font-bold">Simpan PDF</button>
              <button type="button" id="det-btn-wa" class="h-10 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold">Bagikan WA</button>
            </div>
          </div>

          <div class="space-y-2">
            <h4 class="text-xs font-extrabold uppercase tracking-wider text-slate-500">Riwayat Aktivitas Cetak</h4>
            <div class="space-y-1.5">${printLogsHtml}</div>
          </div>

          <div class="space-y-2">
            <h4 class="text-xs font-extrabold uppercase tracking-wider text-slate-500">Audit Log Transaksi</h4>
            <div class="space-y-2">${logsHtml}</div>
          </div>
        </div>
      </div>`;

    document.getElementById('det-close-btn').addEventListener('click', closeDetailModal);
    document.getElementById('det-copy-uid').addEventListener('click', () => copyText(copyIdPayload, 'ID Tujuan'));

    const notifyChange = async () => {
      await loadOrdersList();
      if (typeof listState.onChanged === 'function') listState.onChanged();
      await openTransactionDetail(trx.id);
    };
    const getChosenFmt = () => document.getElementById('det-rcp-fmt')?.value || 'lengkap';

    document.getElementById('det-btn-print')?.addEventListener('click', async () => {
      try { await printThermal58mm(trx.id, getChosenFmt(), notifyChange); }
      catch (err) { showToast(err?.message || 'Gagal mencetak.', 'error'); }
    });
    document.getElementById('det-btn-preview')?.addEventListener('click', () => {
      openReceiptPreviewModal(trx.id, notifyChange);
    });
    document.getElementById('det-btn-pdf')?.addEventListener('click', async () => {
      try { await saveReceiptAsPdfOrPrint(trx.id, getChosenFmt(), notifyChange); }
      catch (err) { showToast(err?.message || 'Gagal simpan PDF.', 'error'); }
    });
    document.getElementById('det-btn-wa')?.addEventListener('click', async () => {
      try { await shareReceiptWhatsApp(trx.id, getChosenFmt(), notifyChange); }
      catch (err) { showToast(err?.message || 'Gagal share WA.', 'error'); }
    });

    document.getElementById('det-btn-process')?.addEventListener('click', async () => {
      try {
        await updateTransactionStatus({
          id: trx.id, newStatus: 'Diproses', reason: 'Mulai diproses oleh admin',
          supplierCode: document.getElementById('det-sup-select')?.value || null,
          supplierRefId: document.getElementById('det-ref-input')?.value || null
        });
        showToast('Status diubah ke Diproses.', 'success');
        await notifyChange();
      } catch (err) { showToast(err?.message || 'Gagal memproses.', 'error'); }
    });

    document.getElementById('det-btn-digiflazz')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = 'Menghubungi Digiflazz...';
      try {
        await invokeDigiflazzOrder(trx.id);
        showToast('Permintaan dikirim ke Digiflazz.', 'success');
        await notifyChange();
      } catch (err) {
        showToast(err?.message || 'Gagal kirim ke Digiflazz.', 'error');
        btn.disabled = false;
        btn.textContent = 'Kirim Otomatis via Digiflazz API';
      }
    });

    document.getElementById('det-btn-success')?.addEventListener('click', async () => {
      if (!confirm('Pastikan top up di supplier BENAR-BENAR SUDAH MASUK ke akun pelanggan sebelum konfirmasi Berhasil!')) return;
      try {
        await updateTransactionStatus({
          id: trx.id, newStatus: 'Berhasil', reason: 'Top up dikonfirmasi berhasil oleh admin',
          supplierRefId: document.getElementById('det-ref-input')?.value || null
        });
        showToast('Transaksi dikonfirmasi BERHASIL!', 'success');
        await notifyChange();
      } catch (err) { showToast(err?.message || 'Gagal konfirmasi.', 'error'); }
    });

    document.getElementById('det-btn-fail')?.addEventListener('click', async () => {
      const reason = (document.getElementById('det-fail-reason')?.value || '').trim();
      if (reason.length < 5) { showToast('Isi alasan kegagalan minimal 5 karakter.', 'warning'); return; }
      try {
        await updateTransactionStatus({
          id: trx.id, newStatus: 'Gagal', reason,
          supplierRefId: document.getElementById('det-ref-input')?.value || null
        });
        showToast('Transaksi ditandai Gagal.', 'info');
        await notifyChange();
      } catch (err) { showToast(err?.message || 'Gagal memperbarui status.', 'error'); }
    });

    document.getElementById('det-toggle-refund')?.addEventListener('click', () => {
      document.getElementById('det-refund-box')?.classList.toggle('hidden');
    });

    document.getElementById('det-btn-refund')?.addEventListener('click', async () => {
      const reason = (document.getElementById('det-refund-reason')?.value || '').trim();
      const radio = root.querySelector('input[name="det-modal-ret"]:checked');
      if (reason.length < 5) { showToast('Alasan refund wajib minimal 5 karakter.', 'warning'); return; }
      if (!radio) { showToast('Pilih apakah modal supplier kembali atau hangus.', 'warning'); return; }
      if (!confirm('Konfirmasi ubah transaksi Berhasil ini menjadi REFUND?')) return;
      try {
        await correctTransactionRefund({ id: trx.id, reason, modalReturned: radio.value === 'true' });
        showToast('Koreksi Refund dicatat ke audit log.', 'success');
        await notifyChange();
      } catch (err) { showToast(err?.message || 'Gagal koreksi refund.', 'error'); }
    });
  } catch (err) {
    closeDetailModal();
    showToast(err?.message || 'Gagal membuka detail transaksi.', 'error');
  }
}

export async function loadOrdersList(keepFocus = false) {
  listState.loading = true;
  if (!keepFocus) renderOrdersPage();

  try {
    const [rows, games] = await Promise.all([
      fetchTransactions({
        search: listState.search,
        status: listState.status,
        gameId: listState.gameId,
        startDate: listState.startDate,
        endDate: listState.endDate,
        limit: 300
      }),
      listState.games.length ? Promise.resolve(listState.games) : fetchFilterGames()
    ]);
    listState.rows = rows;
    listState.games = games;
  } catch (err) {
    showToast(err?.message || 'Gagal memuat daftar pesanan.', 'error');
  } finally {
    listState.loading = false;
    renderOrdersPage();
    if (keepFocus) {
      const el = document.getElementById('ord-list-search');
      if (el) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
    }
  }
}

export function initOrdersListUI({ onChanged } = {}) {
  listState.onChanged = onChanged;
  renderOrdersPage();
}
