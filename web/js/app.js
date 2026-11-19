import { supabase } from './supabase.js';
import { checkInitialSession, initAuthUI, logoutAdmin } from './auth.js';
import { initDashboardUI, loadDashboard } from './dashboard.js';
import { initCatalogUI, loadCatalog } from './catalog.js';
import { showToast } from './utils.js';

const PAGE_TITLES = {
  dashboard: 'Dashboard Admin',
  orders: 'Riwayat Transaksi',
  'new-order': 'Buat Pesanan',
  catalog: 'Katalog & Pelanggan',
  settings: 'Pengaturan'
};

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

  if (pageKey === 'catalog') {
    loadCatalog();
  }
}

function enterApp(admin) {
  const usernameEl = document.getElementById('settings-admin-username');
  if (usernameEl) usernameEl.textContent = admin?.username || 'adminsakapay';
  showScreen('app');
  navigateTo('dashboard');
  loadDashboard('daily');
}

async function handleLogout() {
  if (!confirm('Keluar dari aplikasi SakaPay Admin?')) return;
  await logoutAdmin();
  showScreen('login');
  showToast('Anda telah keluar.', 'info');
}

async function bootstrap() {
  initAuthUI(enterApp);
  initDashboardUI();
  initCatalogUI();

  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => navigateTo(btn.dataset.page));
  });
  document.getElementById('logout-btn')?.addEventListener('click', handleLogout);
  document.getElementById('settings-logout-btn')?.addEventListener('click', handleLogout);
  document.getElementById('printer-status-pill')?.addEventListener('click', () => {
    showToast('Koneksi Printer 58mm akan aktif di Fase 7 & 8.', 'info');
  });

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
