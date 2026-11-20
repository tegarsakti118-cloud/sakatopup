import { supabase } from './supabase.js';
import { checkInitialSession, initAuthUI, logoutAdmin } from './auth.js';
import { initDashboardUI, loadDashboard } from './dashboard.js';
import { initCatalogUI, loadCatalog } from './catalog.js';
import { initOrderFormUI, loadOrderForm } from './order-form.js';
import { initOrdersListUI, loadOrdersList, openTransactionDetail } from './orders-list.js';
import { initSettingsUI, loadSettings } from './settings.js';
import { getPrinterConnectionState } from './receipt.js';
import { showToast } from './utils.js';

const PAGE_TITLES = {
  dashboard: 'Dashboard Admin',
  orders: 'Riwayat & Laporan',
  'new-order': 'Buat Pesanan',
  catalog: 'Katalog & Pelanggan',
  settings: 'Pengaturan & Printer'
};

function updatePrinterPill() {
  const pill = document.getElementById('printer-status-pill');
  if (!pill) return;
  const conn = getPrinterConnectionState();
  if (conn.connected) {
    pill.className = 'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-emerald-50 border border-emerald-200 text-[11px] font-bold text-emerald-800 active:scale-95 transition';
    pill.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-500"></span><span>${(conn.printerName || 'Printer OK').slice(0, 14)}</span>`;
  } else {
    pill.className = 'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-slate-100 border border-slate-200 text-[11px] font-semibold text-slate-600 active:scale-95 transition';
    pill.innerHTML = '<span class="w-2 h-2 rounded-full bg-slate-400"></span><span>Printer 58mm</span>';
  }
}

function showScreen(screenName) {
  document.getElementById('loading-screen').classList.add('hidden');
  document.getElementById('login-view').classList.toggle('hidden', screenName !== 'login');
  document.getElementById('app-shell').classList.toggle('hidden', screenName !== 'app');
}

function navigateTo(pageKey) {
  Object.keys(PAGE_TITLES).forEach((key) => {
    const sec = document.getElementById(`page-${key}`);
    if (sec) sec.classList.toggle('hidden', key !== pageKey);
  });
  document.getElementById('topbar-title').textContent = PAGE_TITLES[pageKey] || 'SakaPay Admin';
  document.querySelectorAll('.nav-btn').forEach((btn) => {
    if (btn.dataset.page === 'new-order') return;
    const isActive = btn.dataset.page === pageKey;
    btn.classList.toggle('text-primary', isActive);
    btn.classList.toggle('text-slate-400', !isActive);
  });

  if (pageKey === 'dashboard') loadDashboard();
  else if (pageKey === 'orders') loadOrdersList();
  else if (pageKey === 'new-order') loadOrderForm();
  else if (pageKey === 'catalog') loadCatalog();
  else if (pageKey === 'settings') loadSettings();
}

function enterApp(admin) {
  window.__sakapayAdminUsername = admin?.username || 'adminsakapay';
  updatePrinterPill();
  showScreen('app');
  navigateTo('dashboard');
}

async function handleLogout() {
  if (!confirm('Keluar dari aplikasi SakaPay Admin?')) return;
  await logoutAdmin();
  showScreen('login');
  showToast('Anda telah keluar.', 'info');
}

async function bootstrap() {
  initAuthUI(enterApp);
  initDashboardUI({ onOpenTransaction: (id) => openTransactionDetail(id) });
  initCatalogUI();
  initOrderFormUI({
    onOrderCreated: (trx) => {
      navigateTo('orders');
      openTransactionDetail(trx.id);
    },
    onGoCatalog: () => navigateTo('catalog')
  });
  initOrdersListUI({ onChanged: () => loadDashboard() });
  initSettingsUI({
    onPrinterUpdated: updatePrinterPill,
    onLogout: handleLogout
  });

  document.getElementById('page-catalog')?.addEventListener('click', (e) => {
    if (e.target.closest('[data-action="quick-order-customer"]')) {
      setTimeout(() => navigateTo('new-order'), 30);
    }
  });

  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => navigateTo(btn.dataset.page));
  });
  document.getElementById('logout-btn')?.addEventListener('click', handleLogout);
  document.getElementById('printer-status-pill')?.addEventListener('click', () => navigateTo('settings'));

  const sessionCheck = await checkInitialSession();
  if (sessionCheck.ok) {
    enterApp(sessionCheck.admin);
  } else {
    showScreen('login');
    if (sessionCheck.configMissing) {
      const errBox = document.getElementById('login-error');
      if (errBox) {
        errBox.textContent = 'Isi SUPABASE_URL dan SUPABASE_ANON_KEY di file web/js/config.js terlebih dahulu.';
        errBox.classList.remove('hidden');
      }
    } else if (sessionCheck.error) {
      showToast(sessionCheck.error, 'error');
    }
  }

  if (supabase) {
    supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') showScreen('login');
    });
  }
}

bootstrap();
