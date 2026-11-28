import {
  fetchCatalogBundle,
  slugify,
  isSafeHttpUrl,
  uploadGameImage,
  saveGame,
  toggleGameStatus,
  deleteGame,
  saveProduct,
  toggleProductStatus,
  deleteProduct,
  saveCustomer
} from './catalog-api.js';
import { escapeHtml, formatIDR, formatWIB, showToast } from './utils.js';
import { fetchDigiflazzPrepaidCatalog, inquiryPlnCustomer } from './digiflazz-ppob-api.js';
import { submitDigiflazzPurchase } from './digiflazz-transaction-api.js';

const state = {
  subTab: 'ppob',
  gameFilter: 'all',
  ppobProducts: [],
  ppobCategory: 'all',
  ppobQuery: '',
  ppobLoadedAt: null,
  ppobLoading: false,
  customerQuery: '',
  games: [],
  products: [],
  suppliers: [],
  customers: [],
  loading: false
};

function getModalRoot() {
  let root = document.getElementById('catalog-modal-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'catalog-modal-root';
    document.body.appendChild(root);
  }
  return root;
}

function closeModal() {
  const root = getModalRoot();
  root.innerHTML = '';
}

function renderSubTabs() {
  const tabs = [
    { key: 'ppob', label: `PPOB (${state.ppobProducts.length})` },
    { key: 'games', label: `Game (${state.games.length})` },
    { key: 'products', label: `Produk (${state.products.length})` },
    { key: 'customers', label: `Pelanggan (${state.customers.length})` }
  ];
  return `
    <div class="grid grid-cols-4 gap-1 p-1 rounded-xl bg-slate-200/70">
      ${tabs
        .map(
          (t) => `
        <button type="button" data-subtab="${t.key}"
          class="cat-subtab-btn py-2 rounded-lg text-xs font-bold transition ${
            state.subTab === t.key ? 'bg-white text-primaryDark shadow-sm' : 'text-slate-600'
          }">
          ${t.label}
        </button>`
        )
        .join('')}
    </div>`;
}

function renderGamesTab() {
  const cards = state.games.length
    ? state.games
        .map((g) => {
          const prodCount = state.products.filter((p) => p.game_id === g.id).length;
          const logoHtml = isSafeHttpUrl(g.logo_url)
            ? `<img src="${escapeHtml(g.logo_url)}" alt="${escapeHtml(g.name)}" class="w-12 h-12 rounded-xl object-cover border border-slate-200 shrink-0" />`
            : `<div class="w-12 h-12 rounded-xl bg-primarySoft text-primaryDark font-extrabold text-base flex items-center justify-center shrink-0">${escapeHtml(g.name.slice(0, 2).toUpperCase())}</div>`;
          const statusBadge = g.is_active
            ? '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">Aktif</span>'
            : '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-200 text-slate-600">Nonaktif</span>';

          return `
            <div class="bg-white rounded-2xl border border-slate-200/80 p-3.5 space-y-2.5 shadow-sm">
              <div class="flex items-start gap-3">
                ${logoHtml}
                <div class="min-w-0 flex-1">
                  <div class="flex items-center justify-between gap-2">
                    <h4 class="text-sm font-extrabold text-slate-900 truncate">${escapeHtml(g.name)}</h4>
                    ${statusBadge}
                  </div>
                  <p class="text-[11px] text-slate-500 mt-0.5">
                    ${prodCount} Produk • ${g.requires_zone_id ? 'Butuh Zone ID' : 'User ID saja'} • Urutan #${g.sort_order}
                  </p>
                  <p class="text-[11px] text-slate-400 line-clamp-2 mt-1">${escapeHtml(g.id_instruction)}</p>
                </div>
              </div>
              <div class="grid grid-cols-4 gap-1.5 pt-2 border-t border-slate-100">
                <button type="button" data-action="edit-game" data-id="${g.id}"
                  class="py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-bold">Edit</button>
                <button type="button" data-action="view-game-products" data-id="${g.id}"
                  class="py-2 rounded-xl bg-primarySoft text-primaryDark text-[11px] font-bold">Produk</button>
                <button type="button" data-action="toggle-game" data-id="${g.id}" data-active="${g.is_active}"
                  class="py-2 rounded-xl bg-amber-50 text-amber-800 text-[11px] font-bold">${g.is_active ? 'Off' : 'On'}</button>
                <button type="button" data-action="delete-game" data-id="${g.id}" data-name="${escapeHtml(g.name)}"
                  class="py-2 rounded-xl bg-red-50 text-red-700 text-[11px] font-bold">Hapus</button>
              </div>
            </div>`;
        })
        .join('')
    : '<div class="bg-white rounded-2xl border border-slate-200 p-6 text-center text-xs text-slate-400">Belum ada game.</div>';

  return `
    <div class="space-y-3">
      <button type="button" id="btn-add-game"
        class="w-full h-11 rounded-xl bg-primary hover:bg-primaryDark text-white text-xs font-bold shadow-md shadow-primary/20 active:scale-[0.99] transition">
        + Tambah Game Baru
      </button>
      <div class="space-y-2.5">${cards}</div>
    </div>`;
}

function renderProductsTab() {
  const gameMap = new Map(state.games.map((g) => [g.id, g]));
  const filtered = state.gameFilter === 'all'
    ? state.products
    : state.products.filter((p) => p.game_id === state.gameFilter);

  const optionsHtml = [
    '<option value="all">Semua Game</option>',
    ...state.games.map(
      (g) => `<option value="${g.id}" ${state.gameFilter === g.id ? 'selected' : ''}>${escapeHtml(g.name)}</option>`
    )
  ].join('');

  const cards = filtered.length
    ? filtered
        .map((p) => {
          const gameName = gameMap.get(p.game_id)?.name || 'Game';
          const profitNum = Number(p.profit ?? (p.sell_price - p.base_price));
          const profitColor = profitNum < 0 ? 'text-red-600' : 'text-emerald-700';
          const statusBadge = p.is_active
            ? '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">Aktif</span>'
            : '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-200 text-slate-600">Nonaktif</span>';

          return `
            <div class="bg-white rounded-2xl border border-slate-200/80 p-3.5 space-y-2 shadow-sm">
              <div class="flex items-start justify-between gap-2">
                <div class="min-w-0">
                  <span class="inline-block text-[10px] font-bold text-primaryDark bg-primarySoft px-2 py-0.5 rounded-md">${escapeHtml(gameName)}</span>
                  <h4 class="text-sm font-extrabold text-slate-900 mt-1">${escapeHtml(p.name)}</h4>
                  <p class="text-[11px] text-slate-500">Nominal: ${escapeHtml(p.nominal_label)} • Supplier: ${escapeHtml(p.default_supplier_code)}${p.supplier_sku ? ` (${escapeHtml(p.supplier_sku)})` : ''}</p>
                </div>
                ${statusBadge}
              </div>

              <div class="grid grid-cols-3 gap-2 bg-slate-50 rounded-xl p-2 text-center">
                <div>
                  <p class="text-[10px] text-slate-500">Modal</p>
                  <p class="text-xs font-bold tabular-nums text-slate-700">${formatIDR(p.base_price)}</p>
                </div>
                <div>
                  <p class="text-[10px] text-slate-500">Harga Jual</p>
                  <p class="text-xs font-extrabold tabular-nums text-slate-900">${formatIDR(p.sell_price)}</p>
                </div>
                <div>
                  <p class="text-[10px] text-slate-500">Untung</p>
                  <p class="text-xs font-extrabold tabular-nums ${profitColor}">${formatIDR(profitNum)}</p>
                </div>
              </div>

              <div class="grid grid-cols-3 gap-1.5 pt-1">
                <button type="button" data-action="edit-product" data-id="${p.id}"
                  class="py-2 rounded-xl bg-slate-100 text-slate-700 text-[11px] font-bold">Edit</button>
                <button type="button" data-action="toggle-product" data-id="${p.id}" data-active="${p.is_active}"
                  class="py-2 rounded-xl bg-amber-50 text-amber-800 text-[11px] font-bold">${p.is_active ? 'Nonaktifkan' : 'Aktifkan'}</button>
                <button type="button" data-action="delete-product" data-id="${p.id}" data-name="${escapeHtml(p.name)}"
                  class="py-2 rounded-xl bg-red-50 text-red-700 text-[11px] font-bold">Hapus</button>
              </div>
            </div>`;
        })
        .join('')
    : '<div class="bg-white rounded-2xl border border-slate-200 p-6 text-center text-xs text-slate-400">Belum ada produk untuk filter ini.</div>';

  return `
    <div class="space-y-3">
      <div class="flex items-center gap-2">
        <select id="cat-game-filter" class="flex-1 h-11 px-3 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-700">
          ${optionsHtml}
        </select>
        <button type="button" id="btn-add-product"
          class="h-11 px-4 rounded-xl bg-primary hover:bg-primaryDark text-white text-xs font-bold shrink-0 shadow-md shadow-primary/20">
          + Produk
        </button>
      </div>
      <div class="space-y-2.5">${cards}</div>
    </div>`;
}

function renderCustomersTab() {
  const q = state.customerQuery.trim().toLowerCase();
  const filtered = q
    ? state.customers.filter(
        (c) => c.name.toLowerCase().includes(q) || String(c.whatsapp).includes(q)
      )
    : state.customers;

  const cards = filtered.length
    ? filtered
        .map((c) => {
          const badge = c.is_active
            ? ''
            : '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-200 text-slate-600">Nonaktif</span>';
          return `
            <div class="bg-white rounded-2xl border border-slate-200/80 p-3.5 space-y-2 shadow-sm">
              <div class="flex items-start justify-between gap-2">
                <div class="min-w-0">
                  <div class="flex items-center gap-2">
                    <h4 class="text-sm font-extrabold text-slate-900 truncate">${escapeHtml(c.name)}</h4>
                    ${badge}
                  </div>
                  <p class="font-mono text-xs font-semibold text-primaryDark mt-0.5">${escapeHtml(c.whatsapp)}</p>
                  <p class="text-[11px] text-slate-500 mt-0.5">
                    ${c.total_orders}x Order • Terakhir: ${c.last_order_at ? formatWIB(c.last_order_at) : 'Belum ada'}
                  </p>
                  ${c.notes ? `<p class="text-[11px] text-slate-400 mt-1">${escapeHtml(c.notes)}</p>` : ''}
                </div>
              </div>
              <div class="grid grid-cols-3 gap-1.5 pt-2 border-t border-slate-100">
                <button type="button" data-action="edit-customer" data-id="${c.id}"
                  class="py-2 rounded-xl bg-slate-100 text-slate-700 text-[11px] font-bold">Edit</button>
                <a href="https://wa.me/${escapeHtml(c.whatsapp)}" target="_blank" rel="noopener"
                  class="py-2 rounded-xl bg-emerald-50 text-emerald-700 text-[11px] font-bold text-center">Chat WA</a>
                <button type="button" data-action="quick-order-customer" data-id="${c.id}"
                  class="py-2 rounded-xl bg-primarySoft text-primaryDark text-[11px] font-bold">+ Order</button>
              </div>
            </div>`;
        })
        .join('')
    : '<div class="bg-white rounded-2xl border border-slate-200 p-6 text-center text-xs text-slate-400">Belum ada data pelanggan.</div>';

  return `
    <div class="space-y-3">
      <div class="flex items-center gap-2">
        <input id="cat-cust-search" type="search" value="${escapeHtml(state.customerQuery)}"
          placeholder="Cari nama atau nomor WA..."
          class="flex-1 h-11 px-3.5 rounded-xl border border-slate-200 bg-white text-xs font-medium focus:outline-none focus:border-primary" />
        <button type="button" id="btn-add-customer"
          class="h-11 px-4 rounded-xl bg-primary hover:bg-primaryDark text-white text-xs font-bold shrink-0 shadow-md shadow-primary/20">
          + Pelanggan
        </button>
      </div>
      <div class="space-y-2.5">${cards}</div>
    </div>`;
}

function normalizePpobCategory(value) {
  const v = String(value || '').toLowerCase();
  if (v.includes('pln') || v.includes('token')) return 'pln';
  if (v.includes('data') || v.includes('internet')) return 'data';
  if (v.includes('pulsa') || v.includes('telepon')) return 'pulsa';
  if (v.includes('e-money') || v.includes('ewallet') || v.includes('e-wallet') || v.includes('uang elektronik')) return 'ewallet';
  if (v.includes('game')) return 'game';
  return 'lainnya';
}

function renderPpobTab() {
  const categories = [
    ['all', 'Semua'], ['pulsa', 'Pulsa'], ['data', 'Paket Data'],
    ['pln', 'Token PLN'], ['ewallet', 'E-Wallet'], ['game', 'Game'], ['lainnya', 'Lainnya']
  ];
  const q = state.ppobQuery.trim().toLowerCase();
  const rows = state.ppobProducts.filter(p => {
    const cat = normalizePpobCategory(p.category);
    const matchesCat = state.ppobCategory === 'all' || cat === state.ppobCategory;
    const haystack = `${p.product_name || ''} ${p.brand || ''} ${p.category || ''} ${p.buyer_sku_code || ''}`.toLowerCase();
    return matchesCat && (!q || haystack.includes(q));
  });
  const cards = rows.map(p => `
    <article class="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm">
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0">
          <p class="text-[10px] font-bold uppercase tracking-wide text-primaryDark">${escapeHtml(p.brand || p.category || 'Produk PPOB')}</p>
          <h4 class="mt-1 text-sm font-extrabold text-slate-900">${escapeHtml(p.product_name || 'Produk tanpa nama')}</h4>
          <p class="mt-1 text-[10px] text-slate-500">SKU: <span class="font-mono">${escapeHtml(p.buyer_sku_code || '-')}</span> · ${escapeHtml(p.type || '')}</p>
        </div>
        <span class="shrink-0 rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700">Tersedia</span>
      </div>
      <div class="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
        <span class="text-[10px] text-slate-500">Harga supplier</span>
        <strong class="text-sm font-extrabold tabular-nums text-slate-900">${formatIDR(Number(p.price || 0))}</strong>
      </div>
      <p class="mt-2 text-[10px] leading-relaxed text-slate-400">${escapeHtml(p.desc || 'Harga dan ketersediaan mengikuti data Digiflazz.')}</p>
      <button type="button" data-ppob-buy="${escapeHtml(p.buyer_sku_code || '')}"
        class="mt-3 w-full rounded-xl bg-primary px-3 py-2.5 text-xs font-extrabold text-white disabled:opacity-50"
        ${!p.buyer_sku_code ? 'disabled' : ''}>Pilih Nominal</button>
    </article>`).join('');
  return `<div class="space-y-3">
    <div class="flex gap-2">
      <input id="ppob-search" type="search" value="${escapeHtml(state.ppobQuery)}" placeholder="Cari produk, operator, atau SKU..." class="h-11 min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 text-xs" />
      <button id="ppob-refresh" type="button" class="h-11 shrink-0 rounded-xl bg-primary px-3 text-xs font-bold text-white" ${state.ppobLoading ? 'disabled' : ''}>${state.ppobLoading ? 'Memuat...' : '↻ Sinkron'}</button>
    </div>
    <div class="flex gap-2 overflow-x-auto pb-1">${categories.map(([key,label]) => `<button type="button" data-ppob-category="${key}" class="shrink-0 rounded-full px-3 py-2 text-[11px] font-bold ${state.ppobCategory === key ? 'bg-primary text-white' : 'bg-white text-slate-600 border border-slate-200'}">${label}</button>`).join('')}</div>
    <div class="flex items-center justify-between"><p class="text-[11px] font-semibold text-slate-500">${rows.length} produk ditemukan</p><p class="text-[10px] text-slate-400">${state.ppobLoadedAt ? `Sinkron ${formatWIB(state.ppobLoadedAt)}` : 'Belum disinkronkan'}</p></div>
    ${state.ppobLoading && !state.ppobProducts.length ? '<div class="rounded-2xl border bg-white p-6 text-center text-xs text-slate-500">Mengambil katalog Digiflazz...</div>' : ''}
    ${cards || (!state.ppobLoading ? '<div class="rounded-2xl border border-slate-200 bg-white p-6 text-center text-xs text-slate-500">Tidak ada produk. Tekan Sinkron untuk mengambil katalog Digiflazz.</div>' : '')}
    <p class="rounded-xl bg-amber-50 px-3 py-2 text-[10px] leading-relaxed text-amber-800">Katalog ini hanya menampilkan harga supplier. Tombol pembelian belum diaktifkan sampai alur transaksi, validasi tujuan, dan pengamanan saldo selesai.</p>
  </div>`;
}

async function syncPpobCatalog() {
  state.ppobLoading = true;
  renderCatalogPage();
  try {
    state.ppobProducts = await fetchDigiflazzPrepaidCatalog();
    state.ppobLoadedAt = new Date().toISOString();
    showToast(`Katalog Digiflazz diperbarui: ${state.ppobProducts.length} produk.`, 'success');
  } catch (err) {
    showToast(err?.message || 'Gagal sinkron katalog Digiflazz.', 'error');
  } finally {
    state.ppobLoading = false;
    renderCatalogPage();
  }
}


function closePpobPurchaseModal() {
  document.getElementById('ppob-purchase-modal')?.remove();
}

function openPpobPurchaseModal(product) {
  closePpobPurchaseModal();
  const isPln = String(product.category || '').toLowerCase().includes('pln');
  const root = document.createElement('div');
  root.id = 'ppob-purchase-modal';
  root.className = 'fixed inset-0 z-[100] flex items-end justify-center bg-slate-950/60 p-0 sm:items-center sm:p-4';
  root.innerHTML = `
    <section class="w-full max-w-md rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl">
      <div class="mx-auto mb-4 h-1.5 w-12 rounded-full bg-slate-200"></div>
      <div class="flex items-start justify-between gap-3">
        <div><p class="text-[10px] font-bold uppercase tracking-wider text-primaryDark">PEMBELIAN PPOB</p>
        <h3 class="mt-1 text-lg font-extrabold text-slate-900">${escapeHtml(product.product_name || 'Produk PPOB')}</h3>
        <p class="mt-1 text-xs text-slate-500">SKU: ${escapeHtml(product.buyer_sku_code)}</p></div>
        <button type="button" id="ppob-modal-close" class="rounded-full bg-slate-100 px-3 py-1 text-lg">×</button>
      </div>
      <div class="mt-4 rounded-2xl bg-slate-50 p-3">
        <div class="flex justify-between text-xs"><span class="text-slate-500">Harga supplier</span><strong>${formatIDR(Number(product.price || 0))}</strong></div>
      </div>
      <label class="mt-4 block text-xs font-bold text-slate-700">${isPln ? 'ID Pelanggan PLN' : 'Nomor Tujuan'}</label>
      <input id="ppob-target-number" inputmode="numeric" autocomplete="off" maxlength="30"
        placeholder="${isPln ? 'Masukkan 10-13 digit ID pelanggan' : 'Masukkan nomor tujuan'}"
        class="mt-2 h-12 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-primary" />
      <p id="ppob-inquiry-note" class="mt-2 text-[11px] text-slate-500">${isPln ? 'Data nama dan daya akan dicek otomatis sebelum konfirmasi.' : 'Pastikan nomor tujuan sudah benar.'}</p>
      <div id="ppob-inquiry-result" class="mt-3 hidden rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs"></div>
      <div id="ppob-confirm-area" class="mt-4 hidden space-y-3">
        <div class="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] leading-relaxed text-amber-900">
          Transaksi akan dikirim ke Digiflazz dan dapat mengurangi saldo supplier. Periksa kembali data tujuan sebelum melanjutkan.
        </div>
        <button type="button" id="ppob-confirm-buy" class="w-full rounded-xl bg-primary px-4 py-3 text-sm font-extrabold text-white">BELI SEKARANG</button>
      </div>
      <button type="button" id="ppob-continue" class="mt-4 w-full rounded-xl bg-primary px-4 py-3 text-sm font-extrabold text-white">${isPln ? 'CEK PELANGGAN' : 'LANJUTKAN'}</button>
    </section>`;
  document.body.appendChild(root);
  let inquiry = null;
  let busy = false;
  const target = root.querySelector('#ppob-target-number');
  const note = root.querySelector('#ppob-inquiry-note');
  const result = root.querySelector('#ppob-inquiry-result');
  const confirmArea = root.querySelector('#ppob-confirm-area');
  const continueBtn = root.querySelector('#ppob-continue');
  root.querySelector('#ppob-modal-close').addEventListener('click', closePpobPurchaseModal);
  root.addEventListener('click', e => { if (e.target === root) closePpobPurchaseModal(); });
  continueBtn.addEventListener('click', async () => {
    const number = target.value.trim();
    if (!number) { note.textContent = 'Nomor tujuan wajib diisi.'; note.className = 'mt-2 text-[11px] text-red-600'; return; }
    if (busy) return;
    busy = true; continueBtn.disabled = true; continueBtn.textContent = isPln ? 'MENGECEK...' : 'MEMERIKSA...';
    try {
      if (isPln) {
        inquiry = await inquiryPlnCustomer(number);
        result.innerHTML = `<p class="font-extrabold text-emerald-900">Data pelanggan ditemukan</p>
          <p class="mt-2">Nama: <strong>${escapeHtml(inquiry.name || '-')}</strong></p>
          <p>ID Pelanggan: <strong>${escapeHtml(inquiry.customer_no || number)}</strong></p>
          <p>Nomor Meter: <strong>${escapeHtml(inquiry.meter_no || '-')}</strong></p>
          <p>Tarif / Daya: <strong>${escapeHtml(inquiry.segment_power || '-')}</strong></p>`;
        result.classList.remove('hidden');
      } else {
        result.innerHTML = `<p class="font-bold text-slate-800">Nomor tujuan</p><p class="mt-1 font-mono">${escapeHtml(number)}</p>`;
        result.classList.remove('hidden');
      }
      confirmArea.classList.remove('hidden');
      continueBtn.classList.add('hidden');
    } catch (err) {
      note.textContent = err?.message || 'Pemeriksaan gagal.';
      note.className = 'mt-2 text-[11px] text-red-600';
      continueBtn.disabled = false; continueBtn.textContent = isPln ? 'COBA CEK LAGI' : 'COBA LAGI';
    } finally { busy = false; }
  });
  root.querySelector('#ppob-confirm-buy').addEventListener('click', async () => {
    if (busy) return;
    if (!confirm('Kirim transaksi sungguhan ke Digiflazz? Pastikan SKU dan nomor tujuan benar.')) return;
    busy = true;
    const btn = root.querySelector('#ppob-confirm-buy');
    btn.disabled = true; btn.textContent = 'MENGIRIM TRANSAKSI...';
    try {
      const response = await submitDigiflazzPurchase({
        buyer_sku_code: product.buyer_sku_code,
        customer_no: target.value.trim(),
        customer_name: inquiry?.name || null
      });
      result.innerHTML = `<p class="font-extrabold">Status: ${escapeHtml(response.status || 'Pending')}</p>
        <p class="mt-1">Ref ID: <strong>${escapeHtml(response.ref_id || '-')}</strong></p>
        <p class="mt-1">${escapeHtml(response.message || '')}</p>
        ${response.serial_number ? `<p class="mt-2 break-all">SN / Token: <strong>${escapeHtml(response.serial_number)}</strong></p>` : ''}`;
      confirmArea.classList.add('hidden');
      note.textContent = 'Respons supplier sudah diterima. Jika Pending, jangan kirim ulang sebelum status diperiksa.';
      note.className = 'mt-3 text-[11px] text-amber-700';
      showToast(`Transaksi ${response.status || 'Pending'} · ${response.ref_id || ''}`, response.status === 'Sukses' ? 'success' : 'warning');
      btn.remove();
    } catch (err) {
      note.textContent = err?.message || 'Transaksi gagal dikirim. Periksa riwayat sebelum mencoba ulang.';
      note.className = 'mt-3 text-[11px] text-red-600';
      btn.disabled = false; btn.textContent = 'COBA LAGI (CEK STATUS DULU)';
    } finally { busy = false; }
  });
}

function renderCatalogPage() {
  const container = document.getElementById('page-catalog');
  if (!container) return;

  let bodyHtml = '';
  if (state.loading && state.games.length === 0) {
    bodyHtml = '<div class="bg-white rounded-2xl border border-slate-200 p-6 text-center text-xs text-slate-400">Memuat data katalog...</div>';
  } else if (state.subTab === 'ppob') {
    bodyHtml = renderPpobTab();
  } else if (state.subTab === 'games') {
    bodyHtml = renderGamesTab();
  } else if (state.subTab === 'products') {
    bodyHtml = renderProductsTab();
  } else {
    bodyHtml = renderCustomersTab();
  }

  container.innerHTML = `
    <div class="space-y-3.5">
      ${renderSubTabs()}
      ${bodyHtml}
    </div>`;

  bindPageEvents();
}

function openGameModal(game = null) {
  const isEdit = Boolean(game);
  const root = getModalRoot();
  root.innerHTML = `
    <div class="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-end sm:items-center justify-center">
      <div class="w-full max-w-lg bg-white rounded-t-3xl sm:rounded-3xl p-5 max-h-[90vh] overflow-y-auto space-y-4">
        <div class="flex items-center justify-between">
          <h3 class="text-base font-extrabold text-slate-900">${isEdit ? 'Edit Game' : 'Tambah Game Baru'}</h3>
          <button type="button" id="modal-close-btn" class="w-8 h-8 rounded-full bg-slate-100 text-slate-600 font-bold text-sm">✕</button>
        </div>

        <form id="game-form" class="space-y-3">
          <div>
            <label class="block text-xs font-bold text-slate-600 mb-1">Nama Game *</label>
            <input id="gm-name" type="text" required value="${escapeHtml(game?.name || '')}"
              class="w-full h-11 px-3.5 rounded-xl border border-slate-200 text-sm font-medium" />
          </div>

          <div class="grid grid-cols-3 gap-2">
            <div class="col-span-2">
              <label class="block text-xs font-bold text-slate-600 mb-1">Slug URL *</label>
              <input id="gm-slug" type="text" required value="${escapeHtml(game?.slug || '')}"
                class="w-full h-11 px-3.5 rounded-xl border border-slate-200 text-xs font-mono" />
            </div>
            <div>
              <label class="block text-xs font-bold text-slate-600 mb-1">Urutan</label>
              <input id="gm-sort" type="number" value="${game?.sort_order ?? state.games.length + 1}"
                class="w-full h-11 px-3 rounded-xl border border-slate-200 text-sm font-medium" />
            </div>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div class="bg-slate-50 rounded-xl p-2.5 space-y-1.5">
              <label class="block text-[11px] font-bold text-slate-600">Logo Game (Opsional)</label>
              <input id="gm-logo-file" type="file" accept="image/png,image/jpeg,image/webp" class="w-full text-[11px]" />
              <input id="gm-logo-url" type="hidden" value="${escapeHtml(game?.logo_url || '')}" />
              ${isSafeHttpUrl(game?.logo_url) ? `<img src="${escapeHtml(game.logo_url)}" class="w-12 h-12 rounded-lg object-cover border" />` : ''}
            </div>
            <div class="bg-slate-50 rounded-xl p-2.5 space-y-1.5">
              <label class="block text-[11px] font-bold text-slate-600">Banner Game (Opsional)</label>
              <input id="gm-banner-file" type="file" accept="image/png,image/jpeg,image/webp" class="w-full text-[11px]" />
              <input id="gm-banner-url" type="hidden" value="${escapeHtml(game?.banner_url || '')}" />
              ${isSafeHttpUrl(game?.banner_url) ? `<img src="${escapeHtml(game.banner_url)}" class="w-full h-12 rounded-lg object-cover border" />` : ''}
            </div>
          </div>

          <div>
            <label class="block text-xs font-bold text-slate-600 mb-1">Petunjuk Pengisian ID</label>
            <textarea id="gm-instruction" rows="2" class="w-full p-3 rounded-xl border border-slate-200 text-xs">${escapeHtml(game?.id_instruction || 'Masukkan User ID Anda dengan benar.')}</textarea>
          </div>

          <div class="flex items-center justify-between bg-slate-50 rounded-xl p-3">
            <label class="flex items-center gap-2 text-xs font-bold text-slate-700">
              <input id="gm-zone" type="checkbox" ${game?.requires_zone_id ? 'checked' : ''} class="w-4 h-4 accent-primary" />
              Wajib Zone / Server ID
            </label>
            <label class="flex items-center gap-2 text-xs font-bold text-slate-700">
              <input id="gm-active" type="checkbox" ${game?.is_active !== false ? 'checked' : ''} class="w-4 h-4 accent-primary" />
              Game Aktif
            </label>
          </div>

          <button id="gm-submit" type="submit"
            class="w-full h-12 rounded-xl bg-primary hover:bg-primaryDark text-white text-sm font-bold shadow-md shadow-primary/25">
            ${isEdit ? 'Simpan Perubahan' : 'Tambah Game'}
          </button>
        </form>
      </div>
    </div>`;

  document.getElementById('modal-close-btn').addEventListener('click', closeModal);
  const nameIn = document.getElementById('gm-name');
  const slugIn = document.getElementById('gm-slug');
  if (!isEdit) {
    nameIn.addEventListener('input', () => {
      slugIn.value = slugify(nameIn.value);
    });
  }

  document.getElementById('game-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('gm-submit');
    btn.disabled = true;
    btn.textContent = 'Menyimpan...';

    try {
      const slugVal = slugify(slugIn.value || nameIn.value);
      let logoUrl = document.getElementById('gm-logo-url').value;
      let bannerUrl = document.getElementById('gm-banner-url').value;

      const logoFile = document.getElementById('gm-logo-file').files?.[0];
      if (logoFile) {
        btn.textContent = 'Mengunggah logo...';
        logoUrl = await uploadGameImage(logoFile, 'logos', slugVal);
      }
      const bannerFile = document.getElementById('gm-banner-file').files?.[0];
      if (bannerFile) {
        btn.textContent = 'Mengunggah banner...';
        bannerUrl = await uploadGameImage(bannerFile, 'banners', slugVal);
      }

      await saveGame(game?.id || null, {
        name: nameIn.value,
        slug: slugVal,
        logo_url: logoUrl,
        banner_url: bannerUrl,
        id_instruction: document.getElementById('gm-instruction').value,
        requires_zone_id: document.getElementById('gm-zone').checked,
        is_active: document.getElementById('gm-active').checked,
        sort_order: document.getElementById('gm-sort').value
      });

      closeModal();
      showToast(isEdit ? 'Game diperbarui.' : 'Game berhasil ditambahkan.', 'success');
      await loadCatalog();
    } catch (err) {
      showToast(err?.message || 'Gagal menyimpan game.', 'error');
      btn.disabled = false;
      btn.textContent = isEdit ? 'Simpan Perubahan' : 'Tambah Game';
    }
  });
}

function openProductModal(product = null) {
  if (state.games.length === 0) {
    showToast('Tambahkan minimal 1 game terlebih dahulu.', 'warning');
    return;
  }
  const isEdit = Boolean(product);
  const selectedGameId = product?.game_id || (state.gameFilter !== 'all' ? state.gameFilter : state.games[0].id);

  const gameOpts = state.games
    .map((g) => `<option value="${g.id}" ${g.id === selectedGameId ? 'selected' : ''}>${escapeHtml(g.name)}</option>`)
    .join('');

  const supOpts = state.suppliers
    .map(
      (s) =>
        `<option value="${escapeHtml(s.code)}" ${
          (product?.default_supplier_code || 'manual') === s.code ? 'selected' : ''
        }>${escapeHtml(s.name)}${s.is_active ? '' : ' (Nonaktif)'}</option>`
    )
    .join('');

  const root = getModalRoot();
  root.innerHTML = `
    <div class="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-end sm:items-center justify-center">
      <div class="w-full max-w-lg bg-white rounded-t-3xl sm:rounded-3xl p-5 max-h-[90vh] overflow-y-auto space-y-4">
        <div class="flex items-center justify-between">
          <h3 class="text-base font-extrabold text-slate-900">${isEdit ? 'Edit Produk' : 'Tambah Produk Baru'}</h3>
          <button type="button" id="modal-close-btn" class="w-8 h-8 rounded-full bg-slate-100 text-slate-600 font-bold text-sm">✕</button>
        </div>

        <form id="product-form" class="space-y-3">
          <div>
            <label class="block text-xs font-bold text-slate-600 mb-1">Game *</label>
            <select id="pr-game" class="w-full h-11 px-3 rounded-xl border border-slate-200 text-sm font-semibold">${gameOpts}</select>
          </div>

          <div class="grid grid-cols-2 gap-2.5">
            <div>
              <label class="block text-xs font-bold text-slate-600 mb-1">Nama Produk *</label>
              <input id="pr-name" type="text" required placeholder="86 Diamonds" value="${escapeHtml(product?.name || '')}"
                class="w-full h-11 px-3 rounded-xl border border-slate-200 text-sm" />
            </div>
            <div>
              <label class="block text-xs font-bold text-slate-600 mb-1">Nominal *</label>
              <input id="pr-nominal" type="text" required placeholder="86 DM" value="${escapeHtml(product?.nominal_label || '')}"
                class="w-full h-11 px-3 rounded-xl border border-slate-200 text-sm" />
            </div>
          </div>

          <div class="grid grid-cols-2 gap-2.5">
            <div>
              <label class="block text-xs font-bold text-slate-600 mb-1">Harga Modal (Rp) *</label>
              <input id="pr-base" type="number" min="0" required value="${product?.base_price ?? ''}"
                class="w-full h-11 px-3 rounded-xl border border-slate-200 text-sm font-bold tabular-nums" />
            </div>
            <div>
              <label class="block text-xs font-bold text-slate-600 mb-1">Harga Jual (Rp) *</label>
              <input id="pr-sell" type="number" min="0" required value="${product?.sell_price ?? ''}"
                class="w-full h-11 px-3 rounded-xl border border-slate-200 text-sm font-bold tabular-nums" />
            </div>
          </div>

          <div id="pr-profit-box" class="rounded-xl bg-emerald-50 border border-emerald-200 px-3.5 py-2.5 flex items-center justify-between">
            <span class="text-xs font-bold text-emerald-800">Estimasi Keuntungan</span>
            <span id="pr-profit-val" class="text-sm font-extrabold tabular-nums text-emerald-900">Rp 0</span>
          </div>

          <div class="grid grid-cols-2 gap-2.5">
            <div>
              <label class="block text-xs font-bold text-slate-600 mb-1">Default Supplier</label>
              <select id="pr-supplier" class="w-full h-11 px-3 rounded-xl border border-slate-200 text-xs font-semibold">${supOpts}</select>
            </div>
            <div>
              <label class="block text-xs font-bold text-slate-600 mb-1">SKU Supplier (Opsional)</label>
              <input id="pr-sku" type="text" placeholder="ML86" value="${escapeHtml(product?.supplier_sku || '')}"
                class="w-full h-11 px-3 rounded-xl border border-slate-200 text-xs font-mono" />
            </div>
          </div>

          <div class="flex items-center justify-between bg-slate-50 rounded-xl p-3">
            <label class="flex items-center gap-2 text-xs font-bold text-slate-700">
              <input id="pr-active" type="checkbox" ${product?.is_active !== false ? 'checked' : ''} class="w-4 h-4 accent-primary" />
              Produk Aktif
            </label>
            <div class="flex items-center gap-2">
              <span class="text-xs font-bold text-slate-600">Urutan</span>
              <input id="pr-sort" type="number" value="${product?.sort_order ?? 0}" class="w-16 h-9 px-2 rounded-lg border border-slate-200 text-xs text-center" />
            </div>
          </div>

          <button id="pr-submit" type="submit"
            class="w-full h-12 rounded-xl bg-primary hover:bg-primaryDark text-white text-sm font-bold shadow-md shadow-primary/25">
            ${isEdit ? 'Simpan Produk' : 'Tambah Produk'}
          </button>
        </form>
      </div>
    </div>`;

  document.getElementById('modal-close-btn').addEventListener('click', closeModal);
  const baseIn = document.getElementById('pr-base');
  const sellIn = document.getElementById('pr-sell');
  const profitBox = document.getElementById('pr-profit-box');
  const profitVal = document.getElementById('pr-profit-val');

  const updateProfitPreview = () => {
    const b = parseInt(baseIn.value || '0', 10);
    const s = parseInt(sellIn.value || '0', 10);
    const diff = (Number.isNaN(s) ? 0 : s) - (Number.isNaN(b) ? 0 : b);
    profitVal.textContent = formatIDR(diff);
    profitBox.className =
      diff < 0
        ? 'rounded-xl bg-red-50 border border-red-200 px-3.5 py-2.5 flex items-center justify-between'
        : 'rounded-xl bg-emerald-50 border border-emerald-200 px-3.5 py-2.5 flex items-center justify-between';
    profitVal.className = diff < 0 ? 'text-sm font-extrabold tabular-nums text-red-700' : 'text-sm font-extrabold tabular-nums text-emerald-900';
  };
  baseIn.addEventListener('input', updateProfitPreview);
  sellIn.addEventListener('input', updateProfitPreview);
  updateProfitPreview();

  document.getElementById('product-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('pr-submit');
    btn.disabled = true;
    btn.textContent = 'Menyimpan...';

    try {
      await saveProduct(product?.id || null, {
        game_id: document.getElementById('pr-game').value,
        name: document.getElementById('pr-name').value,
        nominal_label: document.getElementById('pr-nominal').value,
        base_price: baseIn.value,
        sell_price: sellIn.value,
        default_supplier_code: document.getElementById('pr-supplier').value,
        supplier_sku: document.getElementById('pr-sku').value,
        is_active: document.getElementById('pr-active').checked,
        sort_order: document.getElementById('pr-sort').value
      });
      closeModal();
      showToast(isEdit ? 'Produk diperbarui.' : 'Produk ditambahkan.', 'success');
      await loadCatalog();
    } catch (err) {
      showToast(err?.message || 'Gagal menyimpan produk.', 'error');
      btn.disabled = false;
      btn.textContent = isEdit ? 'Simpan Produk' : 'Tambah Produk';
    }
  });
}

function openCustomerModal(customer = null) {
  const isEdit = Boolean(customer);
  const root = getModalRoot();
  root.innerHTML = `
    <div class="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-end sm:items-center justify-center">
      <div class="w-full max-w-lg bg-white rounded-t-3xl sm:rounded-3xl p-5 max-h-[90vh] overflow-y-auto space-y-4">
        <div class="flex items-center justify-between">
          <h3 class="text-base font-extrabold text-slate-900">${isEdit ? 'Edit Pelanggan' : 'Tambah Pelanggan'}</h3>
          <button type="button" id="modal-close-btn" class="w-8 h-8 rounded-full bg-slate-100 text-slate-600 font-bold text-sm">✕</button>
        </div>

        <form id="customer-form" class="space-y-3">
          <div>
            <label class="block text-xs font-bold text-slate-600 mb-1">Nama Pelanggan *</label>
            <input id="cu-name" type="text" required value="${escapeHtml(customer?.name || '')}"
              class="w-full h-11 px-3.5 rounded-xl border border-slate-200 text-sm" />
          </div>
          <div>
            <label class="block text-xs font-bold text-slate-600 mb-1">Nomor WhatsApp *</label>
            <input id="cu-wa" type="tel" required placeholder="081234567890" value="${escapeHtml(customer?.whatsapp || '')}"
              class="w-full h-11 px-3.5 rounded-xl border border-slate-200 text-sm font-mono" />
            <p class="text-[10px] text-slate-400 mt-1">Otomatis dinormalisasi ke format 628xx oleh database.</p>
          </div>
          <div>
            <label class="block text-xs font-bold text-slate-600 mb-1">Catatan (Opsional)</label>
            <textarea id="cu-notes" rows="2" class="w-full p-3 rounded-xl border border-slate-200 text-xs">${escapeHtml(customer?.notes || '')}</textarea>
          </div>
          <label class="flex items-center gap-2 text-xs font-bold text-slate-700 bg-slate-50 rounded-xl p-3">
            <input id="cu-active" type="checkbox" ${customer?.is_active !== false ? 'checked' : ''} class="w-4 h-4 accent-primary" />
            Pelanggan Aktif
          </label>
          <button id="cu-submit" type="submit"
            class="w-full h-12 rounded-xl bg-primary hover:bg-primaryDark text-white text-sm font-bold shadow-md shadow-primary/25">
            ${isEdit ? 'Simpan Pelanggan' : 'Tambah Pelanggan'}
          </button>
        </form>
      </div>
    </div>`;

  document.getElementById('modal-close-btn').addEventListener('click', closeModal);
  document.getElementById('customer-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('cu-submit');
    btn.disabled = true;
    btn.textContent = 'Menyimpan...';
    try {
      await saveCustomer(customer?.id || null, {
        name: document.getElementById('cu-name').value,
        whatsapp: document.getElementById('cu-wa').value,
        notes: document.getElementById('cu-notes').value,
        is_active: document.getElementById('cu-active').checked
      });
      closeModal();
      showToast(isEdit ? 'Pelanggan diperbarui.' : 'Pelanggan ditambahkan.', 'success');
      await loadCatalog();
    } catch (err) {
      showToast(err?.message || 'Gagal menyimpan pelanggan.', 'error');
      btn.disabled = false;
      btn.textContent = isEdit ? 'Simpan Pelanggan' : 'Tambah Pelanggan';
    }
  });
}

function bindPageEvents() {
  document.querySelectorAll('.cat-subtab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.subTab = btn.dataset.subtab;
      renderCatalogPage();
    });
  });
  document.querySelectorAll('[data-ppob-category]').forEach(btn => btn.addEventListener('click', () => {
    state.ppobCategory = btn.dataset.ppobCategory;
    renderCatalogPage();
  }));
  document.getElementById('ppob-refresh')?.addEventListener('click', syncPpobCatalog);
  document.querySelectorAll('[data-ppob-buy]').forEach(btn => btn.addEventListener('click', () => {
    const product = state.ppobProducts.find(p => p.buyer_sku_code === btn.dataset.ppobBuy);
    if (product) openPpobPurchaseModal(product);
  }));
  document.getElementById('ppob-search')?.addEventListener('input', e => {
    state.ppobQuery = e.target.value;
    const pos = e.target.selectionStart;
    renderCatalogPage();
    const input = document.getElementById('ppob-search');
    input?.focus(); input?.setSelectionRange(pos, pos);
  });

  document.getElementById('btn-add-game')?.addEventListener('click', () => openGameModal(null));
  document.getElementById('btn-add-product')?.addEventListener('click', () => openProductModal(null));
  document.getElementById('btn-add-customer')?.addEventListener('click', () => openCustomerModal(null));

  document.getElementById('cat-game-filter')?.addEventListener('change', (e) => {
    state.gameFilter = e.target.value;
    renderCatalogPage();
  });

  const searchIn = document.getElementById('cat-cust-search');
  if (searchIn) {
    searchIn.addEventListener('input', (e) => {
      state.customerQuery = e.target.value;
      renderCatalogPage();
      const restored = document.getElementById('cat-cust-search');
      if (restored) {
        restored.focus();
        restored.setSelectionRange(restored.value.length, restored.value.length);
      }
    });
  }

  document.querySelectorAll('[data-action]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const action = btn.dataset.action;
      const id = btn.dataset.id;

      try {
        if (action === 'edit-game') {
          openGameModal(state.games.find((g) => g.id === id));
        } else if (action === 'view-game-products') {
          state.gameFilter = id;
          state.subTab = 'products';
          renderCatalogPage();
        } else if (action === 'toggle-game') {
          const next = btn.dataset.active !== 'true';
          await toggleGameStatus(id, next);
          showToast(next ? 'Game diaktifkan.' : 'Game dinonaktifkan.', 'info');
          await loadCatalog();
        } else if (action === 'delete-game') {
          if (!confirm(`Hapus game "${btn.dataset.name}"?`)) return;
          await deleteGame(id);
          showToast('Game dihapus.', 'success');
          await loadCatalog();
        } else if (action === 'edit-product') {
          openProductModal(state.products.find((p) => p.id === id));
        } else if (action === 'toggle-product') {
          const next = btn.dataset.active !== 'true';
          await toggleProductStatus(id, next);
          showToast(next ? 'Produk diaktifkan.' : 'Produk dinonaktifkan.', 'info');
          await loadCatalog();
        } else if (action === 'delete-product') {
          if (!confirm(`Hapus produk "${btn.dataset.name}"?`)) return;
          await deleteProduct(id);
          showToast('Produk dihapus.', 'success');
          await loadCatalog();
        } else if (action === 'edit-customer') {
          openCustomerModal(state.customers.find((c) => c.id === id));
        } else if (action === 'quick-order-customer') {
          const cust = state.customers.find((c) => c.id === id);
          if (cust) {
            window.__sakapayPreselectCustomer = cust;
            showToast(`Pelanggan ${cust.name} siap untuk Buat Pesanan (Fase 6).`, 'info');
          }
        }
      } catch (err) {
        showToast(err?.message || 'Aksi gagal dijalankan.', 'error');
      }
    });
  });
}

export async function loadCatalog() {
  state.loading = true;
  renderCatalogPage();
  try {
    const data = await fetchCatalogBundle();
    state.games = data.games;
    state.products = data.products;
    state.suppliers = data.suppliers;
    state.customers = data.customers;
    if (state.subTab === 'ppob' && !state.ppobProducts.length) {
      try { state.ppobProducts = await fetchDigiflazzPrepaidCatalog(); state.ppobLoadedAt = new Date().toISOString(); }
      catch (ppobErr) { showToast(ppobErr?.message || 'Katalog Digiflazz belum tersedia.', 'error'); }
    }
  } catch (err) {
    showToast(err?.message || 'Gagal memuat data katalog.', 'error');
  } finally {
    state.loading = false;
    renderCatalogPage();
  }
}

export function initCatalogUI() {
  renderCatalogPage();
}
