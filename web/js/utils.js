export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatIDR(amount) {
  const num = Number(amount || 0);
  const absFormatted = new Intl.NumberFormat('id-ID').format(Math.abs(num));
  return num < 0 ? `-Rp ${absFormatted}` : `Rp ${absFormatted}`;
}

export function formatWIB(isoString) {
  if (!isoString) return '-';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '-';
  return (
    new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta',
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(date) + ' WIB'
  );
}

export function getStatusBadge(status) {
  const map = {
    Menunggu: 'bg-amber-100 text-amber-800 border-amber-200',
    Diproses: 'bg-blue-100 text-blue-800 border-blue-200',
    Berhasil: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    Gagal: 'bg-red-100 text-red-800 border-red-200',
    Refund: 'bg-purple-100 text-purple-800 border-purple-200'
  };
  return map[status] || 'bg-slate-100 text-slate-700 border-slate-200';
}

export function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const colors = {
    info: 'bg-slate-900 text-white',
    success: 'bg-emerald-700 text-white',
    error: 'bg-red-600 text-white',
    warning: 'bg-amber-600 text-white'
  };
  const el = document.createElement('div');
  el.className = `${colors[type] || colors.info} px-4 py-3 rounded-2xl shadow-lg text-xs font-semibold flex items-center justify-between gap-2 pointer-events-auto transition-opacity duration-300`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => {
    el.classList.add('opacity-0');
    setTimeout(() => el.remove(), 300);
  }, 3000);
}
