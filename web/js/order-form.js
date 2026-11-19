import { fetchOrderFormData, createOrder, generateUUID } from './orders-api.js';
import { isSafeHttpUrl } from './catalog-api.js';
import { escapeHtml, formatIDR, showToast } from './utils.js';

const formState = {
  games: [],
  products: [],
  suppliers: [],
  customers: [],
  selectedGameId: '',
  selectedProductId: '',
  customerName: '',
  customerWa: '',
  targetUserId: '',
  targetZoneId: '',
  supplierCode: '',
  notes: '',
  saveCustomer: true,
  allowDuplicate: false,
  duplicateInvoice: '',
  idempotencyKey: generateUUID(),
  loading: false,
  onOrderCreated: null,
  onGoCatalog: null
};

function getOrderModalRoot() {
  let root = document.getElementById('order-modal-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'order-modal-root';
    document.body.appendChild(root);
  }
  return root;
}

function closeConfirmModal() {
  getOrderModalRoot().innerHTML = '';
}

function resetFormValues() {
  formState.customerName = '';
  formState.customerWa = '';
  formState.targetUserId = '';
  formState.targetZoneId = '';
  formState.supplierCode = '';
  formState.notes = '';
  formState.saveCustomer = true;
  formState.allowDuplicate = false;
  formState.duplicateInvoice = '';
  formState.idempotencyKey = generateUUID();
}

function getSelectedGame() {
  return formState.games.find((g) => g.id === formState.selectedGameId) || null;
}

function getGameProducts() {
  return formState.products.filter((p) => p.game_id === formState.selectedGameId);
}

function getSelectedProduct() {
  return formState.products.find((p) => p.id === formState.selectedProductId) || null;
}

async function pasteToInput(inputEl, onDone) {
  try {
    if (!navigator.clipboard?.readText) {
      showToast('Tempel manual dengan tahan lama di kolom teks.', 'info');
      return;
    }
    const text = (await navigator.clipboard.readText()) || '';
    inputEl.value = text.trim();
    onDone(inputEl.value);
    showToast('Teks ditempel.', 'success');
  } catch {
    showToast('Izin tempel ditolak browser. Tempel manual di kolom.', 'warning');
  }
}

function renderCustomerSuggestions() {
  const box = document.getElementById('ord-cust-suggest');
  if (!box) return;
  const q = formState.customerName.trim().toLowerCase();
  const waQ = formState.customerWa.replace(/[^0-9]/g, '');
  if (!q && !waQ) {
    box.classList.add('hidden');
    box.innerHTML = '';
    return;
  }

  const matches = formState.customers
    .filter((c) => (q && c.name.toLowerCase().includes(q)) || (waQ && String(c.whatsapp).includes(waQ)))
    .slice(0, 5);

  if (matches.length === 0) {
    box.classList.add('hidden');
    box.innerHTML = '';
    return;
  }

  box.classList.remove('hidden');
  box.innerHTML = matches
    .map(
      (c) => `
      <button type="button" data-pick-cust="${c.id}"
        class="w-full text-left px-3 py-2 hover:bg-primarySoft/60 flex items-center justify-between border-b border-slate-100 last:border-0">
        <span class="text-xs font-bold text-slate-800">${escapeHtml(c.name)}</span>
        <span class="font-mono text-[11px] text-primaryDark">${escapeHtml(c.whatsapp)}</span>
      </button>`
    )
    .join('');

  box.querySelectorAll('[data-pick-cust]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const c = formState.customers.find((x) => x.id === btn.dataset.pickCust);
      if (!c) return;
      formState.customerName = c.name;
      formState.customerWa = c.whatsapp;
      document.getElementById('ord-cust-name').value = c.name;
      document.getElementById('ord-cust-wa').value = c.whatsapp;
      box.classList.add('hidden');
      updateSaveCustomerHint();
    });
  });
}

function updateSaveCustomerHint() {
  const chk = document.getElementById('ord-save-cust');
  const hint = document.getElementById('ord-save-hint');
  if (!chk || !hint) return;
  const digits = formState.customerWa.replace(/[^0-9]/g, '');
  if (digits.length === 0) {
    hint.textContent = 'Tanpa WA: hanya dicatat di transaksi (pembeli offline).';
  } else {
    hint.textContent = 'Simpan / perbarui ke database pelanggan.';
  }
}

function renderOrderForm() {
  const container = document.getElementById('page-new-order');
  if (!container) return;

  if (formState.loading && formState.games.length === 0) {
    container.innerHTML = '<div class="bg-white rounded-2xl border border-slate-200 p-6 text-center text-xs text-slate-400">Memuat katalog pesanan...</div>';
    return;
  }

  if (formState.games.length === 0) {
    container.innerHTML = `
      <div class="bg-white rounded-2xl border border-slate-200 p-6 text-center space-y-2">
        <p class="text-sm font-bold text-slate-800">Belum ada game aktif</p>
        <p class="text-xs text-slate-500">Aktifkan atau tambah game di menu Katalog terlebih dahulu.</p>
      </div>`;
    return;
  }

  const selGame = getSelectedGame() || formState.games[0];
  formState.selectedGameId = selGame.id;
  const gameProducts = getGameProducts();
  if (!gameProducts.some((p) => p.id === formState.selectedProductId)) {
    formState.selectedProductId = gameProducts[0]?.id || '';
  }
  const selProduct = getSelectedProduct();

  const gamesHtml = formState.games
    .map((g) => {
      const isSel = g.id === selGame.id;
      const logo = isSafeHttpUrl(g.logo_url)
        ? `<img src="${escapeHtml(g.logo_url)}" alt="${escapeHtml(g.name)}" class="w-10 h-10 rounded-xl object-cover" />`
        : `<div class="w-10 h-10 rounded-xl bg-primarySoft text-primaryDark font-extrabold text-xs flex items-center justify-center">${escapeHtml(g.name.slice(0, 2).toUpperCase())}</div>`;
      return `
        <button type="button" data-pick-game="${g.id}"
          class="shrink-0 w-24 p-2 rounded-2xl border text-center flex flex-col items-center gap-1.5 transition ${
            isSel ? 'border-primary bg-primarySoft/60 ring-2 ring-primary/25' : 'border-slate-200 bg-white'
          }">
          ${logo}
          <span class="text-[11px] font-bold text-slate-800 line-clamp-1 w-full">${escapeHtml(g.name)}</span>
        </button>`;
    })
    .join('');

  const productsHtml = gameProducts.length
    ? gameProducts
        .map((p) => {
          const isSel = p.id === formState.selectedProductId;
          const profit = Number(p.profit ?? p.sell_price - p.base_price);
          return `
            <button type="button" data-pick-prod="${p.id}"
              class="w-full text-left p-3 rounded-2xl border flex items-center justify-between gap-2 transition ${
                isSel ? 'border-primary bg-primarySoft/50 ring-2 ring-primary/25' : 'border-slate-200 bg-white'
              }">
              <div class="min-w-0">
                <p class="text-xs font-extrabold text-slate-900 truncate">${escapeHtml(p.name)}</p>
                <p class="text-[10px] text-slate-500">Modal: ${formatIDR(p.base_price)} • Untung: <span class="font-bold text-emerald-700">${formatIDR(profit)}</span></p>
              </div>
              <div class="text-right shrink-0">
                <p class="text-xs font-extrabold tabular-nums text-primaryDark">${formatIDR(p.sell_price)}</p>
              </div>
            </button>`;
        })
        .join('')
    : `<div class="bg-amber-50 border border-amber-200 rounded-xl p-4 text-center space-y-2">
         <p class="text-xs font-bold text-amber-800">Belum ada produk aktif untuk ${escapeHtml(selGame.name)}</p>
         <button type="button" id="ord-go-catalog" class="px-3 py-1.5 rounded-lg bg-primary text-white text-[11px] font-bold">Tambah Produk di Katalog</button>
       </div>`;

  const supOpts = [
    '<option value="">Otomatis (Default Produk / Manual)</option>',
    ...formState.suppliers.map(
      (s) => `<option value="${escapeHtml(s.code)}" ${formState.supplierCode === s.code ? 'selected' : ''}>${escapeHtml(s.name)}</option>`
    )
  ].join('');

  const dupHtml = formState.duplicateInvoice
    ? `<div class="rounded-2xl bg-amber-50 border-2 border-amber-400 p-3.5 space-y-2">
         <p class="text-xs font-extrabold text-amber-900">Peringatan Pesanan Serupa (${escapeHtml(formState.duplicateInvoice)})</p>
         <p class="text-[11px] text-amber-800">Kombinasi Game, Produk, dan ID tujuan ini baru saja dicatat atau masih diproses.</p>
         <label class="flex items-center gap-2 text-xs font-bold text-amber-950 pt-1">
           <input id="ord-allow-dup" type="checkbox" ${formState.allowDuplicate ? 'checked' : ''} class="w-4 h-4 accent-amber-600" />
           Saya yakin ini bukan pesanan ganda, lanjutkan
         </label>
       </div>`
    : '';

  const sellVal = selProduct ? formatIDR(selProduct.sell_price) : 'Rp 0';
  const profitVal = selProduct ? formatIDR(selProduct.profit ?? selProduct.sell_price - selProduct.base_price) : 'Rp 0';

  container.innerHTML = `
    <div class="space-y-4">
      <div class="bg-white rounded-2xl border border-slate-200/80 p-4 space-y-3">
        <div class="flex items-center justify-between">
          <h3 class="text-xs font-extrabold uppercase tracking-wider text-slate-500">1. Data Pembeli</h3>
          <button type="button" id="ord-offline-preset" class="text-[11px] font-bold text-primaryDark bg-primarySoft px-2.5 py-1 rounded-lg">Isi "Pembeli Offline"</button>
        </div>

        <div class="relative">
          <label class="block text-xs font-bold text-slate-600 mb-1">Nama Pelanggan *</label>
          <input id="ord-cust-name" type="text" value="${escapeHtml(formState.customerName)}" placeholder="Ketik nama atau cari pelanggan lama..."
            class="w-full h-11 px-3.5 rounded-xl border border-slate-200 text-sm font-medium focus:outline-none focus:border-primary" />
          <div id="ord-cust-suggest" class="hidden absolute z-20 inset-x-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden"></div>
        </div>

        <div>
          <label class="block text-xs font-bold text-slate-600 mb-1">Nomor WhatsApp <span class="font-normal text-slate-400">(Opsional untuk offline)</span></label>
          <div class="flex gap-2">
            <input id="ord-cust-wa" type="tel" value="${escapeHtml(formState.customerWa)}" placeholder="08xx (kosongkan jika tidak ada)"
              class="flex-1 h-11 px-3.5 rounded-xl border border-slate-200 text-sm font-mono focus:outline-none focus:border-primary" />
            <button type="button" id="ord-paste-wa" class="px-3 h-11 rounded-xl bg-slate-100 text-slate-700 text-xs font-bold shrink-0">Tempel</button>
          </div>
        </div>

        <label class="flex items-center gap-2 text-xs text-slate-600">
          <input id="ord-save-cust" type="checkbox" ${formState.saveCustomer ? 'checked' : ''} class="w-4 h-4 accent-primary" />
          <span id="ord-save-hint" class="font-medium">Simpan / perbarui ke database pelanggan.</span>
        </label>
      </div>

      <div class="bg-white rounded-2xl border border-slate-200/80 p-4 space-y-3">
        <h3 class="text-xs font-extrabold uppercase tracking-wider text-slate-500">2. Pilih Game & ID Tujuan</h3>
        <div class="flex gap-2 overflow-x-auto no-scrollbar pb-1">${gamesHtml}</div>

        <div class="rounded-xl bg-primarySoft/70 border border-primary/20 px-3 py-2 text-[11px] text-primaryDark font-medium">
          ${escapeHtml(selGame.id_instruction)}
        </div>

        <div class="grid ${selGame.requires_zone_id ? 'grid-cols-3' : 'grid-cols-1'} gap-2">
          <div class="${selGame.requires_zone_id ? 'col-span-2' : ''}">
            <label class="block text-xs font-bold text-slate-600 mb-1">User ID *</label>
            <div class="flex gap-1.5">
              <input id="ord-uid" type="text" value="${escapeHtml(formState.targetUserId)}" placeholder="Masukkan ID akun"
                class="flex-1 min-w-0 h-11 px-3 rounded-xl border border-slate-200 text-sm font-mono focus:outline-none focus:border-primary" />
              <button type="button" id="ord-paste-uid" class="px-2.5 h-11 rounded-xl bg-slate-100 text-slate-700 text-[11px] font-bold shrink-0">Tempel</button>
            </div>
          </div>
          ${
            selGame.requires_zone_id
              ? `<div>
                   <label class="block text-xs font-bold text-slate-600 mb-1">Zone ID *</label>
                   <input id="ord-zid" type="text" value="${escapeHtml(formState.targetZoneId)}" placeholder="Server"
                     class="w-full h-11 px-3 rounded-xl border border-slate-200 text-sm font-mono focus:outline-none focus:border-primary" />
                 </div>`
              : ''
          }
        </div>
      </div>

      <div class="bg-white rounded-2xl border border-slate-200/80 p-4 space-y-3">
        <h3 class="text-xs font-extrabold uppercase tracking-wider text-slate-500">3. Pilih Produk Top Up</h3>
        <div class="space-y-2">${productsHtml}</div>
      </div>

      <div class="bg-white rounded-2xl border border-slate-200/80 p-4 space-y-3">
        <h3 class="text-xs font-extrabold uppercase tracking-wider text-slate-500">4. Supplier & Catatan</h3>
        <div>
          <label class="block text-xs font-bold text-slate-600 mb-1">Jalur Proses Supplier</label>
          <select id="ord-supplier" class="w-full h-11 px-3 rounded-xl border border-slate-200 text-xs font-semibold bg-white">${supOpts}</select>
        </div>
        <div>
          <label class="block text-xs font-bold text-slate-600 mb-1">Catatan (Opsional)</label>
          <input id="ord-notes" type="text" value="${escapeHtml(formState.notes)}" placeholder="Contoh: Tunai / QRIS / catatan"
            class="w-full h-11 px-3.5 rounded-xl border border-slate-200 text-xs" />
        </div>
      </div>

      ${dupHtml}

      <div class="bg-white rounded-2xl border border-slate-200 p-4 space-y-3 shadow-sm">
        <div class="flex items-center justify-between text-xs">
          <span class="font-semibold text-slate-500">Harga Jual</span>
          <span class="text-base font-extrabold tabular-nums text-slate-900">${sellVal}</span>
        </div>
        <div class="flex items-center justify-between text-xs">
          <span class="font-semibold text-slate-500">Estimasi Keuntungan</span>
          <span class="text-xs font-extrabold tabular-nums text-emerald-700">${profitVal}</span>
        </div>
        <button type="button" id="ord-review-btn" ${!selProduct ? 'disabled' : ''}
          class="w-full h-12 rounded-xl bg-primary hover:bg-primaryDark disabled:opacity-50 text-white text-sm font-bold shadow-md shadow-primary/25 transition">
          Periksa & Simpan Pesanan
        </button>
      </div>
    </div>`;

  bindOrderFormEvents();
  updateSaveCustomerHint();
}

function openConfirmOrderModal() {
  const game = getSelectedGame();
  const product = getSelectedProduct();
  if (!game || !product) {
    showToast('Pilih game dan produk terlebih dahulu.', 'warning');
    return;
  }
  if (!formState.customerName.trim()) {
    showToast('Nama pelanggan wajib diisi.', 'warning');
    return;
  }
  const waDigits = formState.customerWa.replace(/[^0-9]/g, '');
  if (waDigits.length > 0 && (waDigits.length < 8 || waDigits.length > 16)) {
    showToast('Nomor WhatsApp harus 8-16 digit atau dikosongkan.', 'warning');
    return;
  }
  if (!formState.targetUserId.trim()) {
    showToast('User ID tujuan wajib diisi.', 'warning');
    return;
  }
  if (game.requires_zone_id && !formState.targetZoneId.trim()) {
    showToast(`Game ${game.name} wajib mengisi Zone/Server ID.`, 'warning');
    return;
  }

  const profit = Number(product.profit ?? product.sell_price - product.base_price);
  const targetDisplay = formState.targetZoneId.trim()
    ? `${formState.targetUserId.trim()} (${formState.targetZoneId.trim()})`
    : formState.targetUserId.trim();

  const root = getOrderModalRoot();
  root.innerHTML = `
    <div class="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-end sm:items-center justify-center">
      <div class="w-full max-w-lg bg-white rounded-t-3xl sm:rounded-3xl p-5 space-y-4">
        <div class="flex items-center justify-between">
          <h3 class="text-base font-extrabold text-slate-900">Periksa Ulang Pesanan</h3>
          <button type="button" id="ord-modal-close" class="w-8 h-8 rounded-full bg-slate-100 text-slate-600 font-bold text-sm">✕</button>
        </div>

        <div class="bg-slate-50 rounded-2xl p-4 space-y-2 text-xs">
          <div class="flex justify-between gap-2"><span class="text-slate-500">Pembeli</span><span class="font-bold text-slate-900">${escapeHtml(formState.customerName.trim())}</span></div>
          <div class="flex justify-between gap-2"><span class="text-slate-500">WhatsApp</span><span class="font-mono font-semibold text-slate-800">${waDigits ? escapeHtml(waDigits) : 'Pembeli Offline (Tanpa WA)'}</span></div>
          <div class="flex justify-between gap-2"><span class="text-slate-500">Game</span><span class="font-bold text-slate-900">${escapeHtml(game.name)}</span></div>
          <div class="flex justify-between gap-2"><span class="text-slate-500">ID Tujuan</span><span class="font-mono font-extrabold text-primaryDark">${escapeHtml(targetDisplay)}</span></div>
          <div class="flex justify-between gap-2"><span class="text-slate-500">Produk</span><span class="font-bold text-slate-900">${escapeHtml(product.name)}</span></div>
          <div class="border-t border-slate-200 my-1 pt-2 flex justify-between"><span class="text-slate-500">Harga Jual</span><span class="font-extrabold text-slate-900">${formatIDR(product.sell_price)}</span></div>
          <div class="flex justify-between"><span class="text-slate-500">Harga Modal</span><span class="font-bold text-slate-700">${formatIDR(product.base_price)}</span></div>
          <div class="flex justify-between"><span class="text-slate-500">Keuntungan</span><span class="font-extrabold text-emerald-700">${formatIDR(profit)}</span></div>
        </div>

        <div class="grid grid-cols-2 gap-2.5">
          <button type="button" data-submit-status="Menunggu"
            class="ord-submit-btn h-12 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold shadow-md">
            Simpan (Menunggu)
          </button>
          <button type="button" data-submit-status="Diproses"
            class="ord-submit-btn h-12 rounded-xl bg-primary hover:bg-primaryDark text-white text-xs font-bold shadow-md shadow-primary/25">
            Simpan & Mulai Proses
          </button>
        </div>
      </div>
    </div>`;

  document.getElementById('ord-modal-close').addEventListener('click', closeConfirmModal);

  root.querySelectorAll('.ord-submit-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const initStatus = btn.dataset.submitStatus;
      root.querySelectorAll('.ord-submit-btn').forEach((b) => (b.disabled = true));
      btn.textContent = 'Menyimpan...';

      try {
        const trx = await createOrder({
          idempotency_key: formState.idempotencyKey,
          customer_name: formState.customerName,
          customer_wa: formState.customerWa,
          game_id: game.id,
          product_id: product.id,
          target_user_id: formState.targetUserId,
          target_zone_id: formState.targetZoneId,
          notes: formState.notes,
          save_customer: formState.saveCustomer,
          allow_duplicate: formState.allowDuplicate,
          initial_status: initStatus,
          supplier_code: formState.supplierCode || null
        });

        closeConfirmModal();
        resetFormValues();
        showToast(`Pesanan ${trx.invoice_code} tersimpan!`, 'success');
        if (typeof formState.onOrderCreated === 'function') {
          formState.onOrderCreated(trx);
        }
      } catch (err) {
        closeConfirmModal();
        if (err.code === 'DUPLICATE_ORDER') {
          formState.duplicateInvoice = err.duplicateInvoice || 'Sebelumnya';
          formState.allowDuplicate = false;
          renderOrderForm();
          showToast('Terdeteksi pesanan serupa! Periksa kotak peringatan.', 'warning');
        } else {
          showToast(err?.message || 'Gagal menyimpan pesanan.', 'error');
        }
      }
    });
  });
}

function bindOrderFormEvents() {
  const nameIn = document.getElementById('ord-cust-name');
  const waIn = document.getElementById('ord-cust-wa');
  const uidIn = document.getElementById('ord-uid');
  const zidIn = document.getElementById('ord-zid');

  nameIn?.addEventListener('input', (e) => {
    formState.customerName = e.target.value;
    renderCustomerSuggestions();
  });

  waIn?.addEventListener('input', (e) => {
    formState.customerWa = e.target.value;
    updateSaveCustomerHint();
    renderCustomerSuggestions();
  });

  document.getElementById('ord-offline-preset')?.addEventListener('click', () => {
    formState.customerName = 'Pembeli Offline';
    formState.customerWa = '';
    if (nameIn) nameIn.value = 'Pembeli Offline';
    if (waIn) waIn.value = '';
    document.getElementById('ord-cust-suggest')?.classList.add('hidden');
    updateSaveCustomerHint();
  });

  document.getElementById('ord-paste-wa')?.addEventListener('click', () => {
    pasteToInput(waIn, (val) => {
      formState.customerWa = val;
      updateSaveCustomerHint();
    });
  });

  document.getElementById('ord-paste-uid')?.addEventListener('click', () => {
    pasteToInput(uidIn, (val) => {
      formState.targetUserId = val;
      formState.duplicateInvoice = '';
      formState.allowDuplicate = false;
    });
  });

  document.getElementById('ord-save-cust')?.addEventListener('change', (e) => {
    formState.saveCustomer = e.target.checked;
  });

  uidIn?.addEventListener('input', (e) => {
    formState.targetUserId = e.target.value;
    formState.duplicateInvoice = '';
    formState.allowDuplicate = false;
  });

  zidIn?.addEventListener('input', (e) => {
    formState.targetZoneId = e.target.value;
    formState.duplicateInvoice = '';
    formState.allowDuplicate = false;
  });

  document.querySelectorAll('[data-pick-game]').forEach((btn) => {
    btn.addEventListener('click', () => {
      formState.selectedGameId = btn.dataset.pickGame;
      formState.targetZoneId = '';
      formState.duplicateInvoice = '';
      formState.allowDuplicate = false;
      renderOrderForm();
    });
  });

  document.querySelectorAll('[data-pick-prod]').forEach((btn) => {
    btn.addEventListener('click', () => {
      formState.selectedProductId = btn.dataset.pickProd;
      formState.duplicateInvoice = '';
      formState.allowDuplicate = false;
      renderOrderForm();
    });
  });

  document.getElementById('ord-supplier')?.addEventListener('change', (e) => {
    formState.supplierCode = e.target.value;
  });

  document.getElementById('ord-notes')?.addEventListener('input', (e) => {
    formState.notes = e.target.value;
  });

  document.getElementById('ord-allow-dup')?.addEventListener('change', (e) => {
    formState.allowDuplicate = e.target.checked;
  });

  document.getElementById('ord-go-catalog')?.addEventListener('click', () => {
    if (typeof formState.onGoCatalog === 'function') formState.onGoCatalog();
  });

  document.getElementById('ord-review-btn')?.addEventListener('click', openConfirmOrderModal);
}

export async function loadOrderForm() {
  if (window.__sakapayPreselectCustomer) {
    const c = window.__sakapayPreselectCustomer;
    formState.customerName = c.name || '';
    formState.customerWa = c.whatsapp || '';
    window.__sakapayPreselectCustomer = null;
  }

  formState.loading = true;
  renderOrderForm();

  try {
    const data = await fetchOrderFormData();
    formState.games = data.games;
    formState.products = data.products;
    formState.suppliers = data.suppliers;
    formState.customers = data.customers;
    if (!formState.selectedGameId && formState.games.length > 0) {
      formState.selectedGameId = formState.games[0].id;
    }
  } catch (err) {
    showToast(err?.message || 'Gagal memuat form pesanan.', 'error');
  } finally {
    formState.loading = false;
    renderOrderForm();
  }
}

export function initOrderFormUI({ onOrderCreated, onGoCatalog } = {}) {
  formState.onOrderCreated = onOrderCreated;
  formState.onGoCatalog = onGoCatalog;
  renderOrderForm();
}
