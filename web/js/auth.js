import { SAKAPAY_CONFIG } from './config.js';
import { supabase, isConfigReady, verifyAdminWhitelist } from './supabase.js';
import { showToast } from './utils.js';

function showLoginError(msg) {
  const box = document.getElementById('login-error');
  if (!box) return;
  if (!msg) {
    box.classList.add('hidden');
    box.textContent = '';
    return;
  }
  box.textContent = msg;
  box.classList.remove('hidden');
}

export async function checkInitialSession() {
  if (!isConfigReady() || !supabase) return { ok: false, configMissing: true };
  const { data: sessionData, error } = await supabase.auth.getSession();
  if (error || !sessionData?.session?.user) return { ok: false };
  try {
    const admin = await verifyAdminWhitelist(sessionData.session.user.id);
    if (!admin) {
      await supabase.auth.signOut();
      return { ok: false, error: 'Akses ditolak: Akun tidak terdaftar sebagai admin SakaPay.' };
    }
    return { ok: true, admin };
  } catch (err) {
    return { ok: false, error: 'Gagal memverifikasi otorisasi admin.' };
  }
}

export function initAuthUI(onLoginSuccess) {
  const form = document.getElementById('login-form');
  const usernameInput = document.getElementById('login-username');
  const passwordInput = document.getElementById('login-password');
  const toggleBtn = document.getElementById('toggle-password');
  const submitBtn = document.getElementById('login-submit-btn');

  if (toggleBtn && passwordInput) {
    toggleBtn.addEventListener('click', () => {
      passwordInput.type = passwordInput.type === 'password' ? 'text' : 'password';
    });
  }
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    showLoginError('');
    if (!isConfigReady() || !supabase) {
      showLoginError('Konfigurasi SUPABASE_URL dan ANON_KEY di js/config.js belum diisi.');
      return;
    }

    const rawUser = (usernameInput.value || '').trim().toLowerCase();
    const password = passwordInput.value || '';
    if (!rawUser || !password) {
      showLoginError('Username dan password wajib diisi.');
      return;
    }

    const email = rawUser.includes('@') ? rawUser : `${rawUser}@${SAKAPAY_CONFIG.INTERNAL_EMAIL_DOMAIN}`;
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span>Memeriksa akses...</span>';

    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error || !data?.user) {
        showLoginError('Username atau password salah.');
        return;
      }
      const admin = await verifyAdminWhitelist(data.user.id);
      if (!admin) {
        await supabase.auth.signOut();
        showLoginError('Akses ditolak: Akun ini bukan admin resmi SakaPay.');
        return;
      }
      passwordInput.value = '';
      showToast(`Selamat datang, ${admin.username}`, 'success');
      onLoginSuccess(admin);
    } catch (err) {
      showLoginError(err?.message || 'Terjadi gangguan koneksi ke server.');
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<span>Masuk ke Dashboard</span>';
    }
  });
}

export async function logoutAdmin() {
  if (!supabase) return;
  await supabase.auth.signOut();
}
