import { supabase } from './supabase.js';
import { escapeHtml, formatIDR, formatWIB, getStatusBadge, showToast } from './utils.js';

let activePeriod = 'daily';

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function updatePeriodButtons(period) {
  document.querySelectorAll('.period-btn').forEach((btn) => {
    const isActive = btn.dataset.period === period;
    btn.className = isActive
      ? 'period-btn flex-1 py-2 rounded-lg text-xs font-bold transition bg-white text-primaryDark shadow-sm'
      : 'period-btn flex-1 py-2 rounded-lg text-xs font-bold transition text-slate-600';
  });
}

function renderSummary(summary) {
  const labels = { daily: 'Hari Ini', weekly: 'Minggu Ini', monthly: 'Bulan Ini' };
  setText('dash-period-label', `Periode ${labels[summary.period] || 'Hari Ini'} • Mulai ${formatWIB(summary.period_start)}`);
  setText('net-omzet', formatIDR(summary.net_omzet));
  setText('net-modal', formatIDR(summary.net_modal));

  const profitEl = document.getElementById('net-profit');
  if (profitEl) {
    profitEl.textContent = formatIDR(summary.net_profit);
    profitEl.className = Number(summary.net_profit || 0) < 0
      ? 'text-base font-extrabold tabular-nums text-red-200'
      : 'text-base font-extrabold tabular-nums text-white';
  }

  setText('gross-count', `${summary.count_completed_gross || 0} Selesai`);
  setText('gross-omzet', formatIDR(summary.gross_omzet));
  setText('gross-modal', formatIDR(summary.gross_modal));
  setText('gross-profit', formatIDR(summary.gross_profit));

  const retCount = summary.count_refund_modal_returned || 0;
  const lostCount = summary.count_refund_modal_lost || 0;
  setText('refund-count-detail', `${summary.count_refund_in_period || 0} (${retCount} kembali, ${lostCount} hangus)`);
  setText('refund-omzet', formatIDR(summary.refund_omzet));
  setText('refund-modal-recovered', formatIDR(summary.refund_modal_recovered));
  setText('refund-modal-lost', formatIDR(summary.refund_modal_lost));

  setText('stat-active-menunggu', String(summary.active_menunggu ?? 0));
  setText('stat-active-diproses', String(summary.active_diproses ?? 0));
  setText('stat-created', String(summary.count_created_in_period ?? 0));
  setText('stat-berhasil', String(summary.count_currently_berhasil ?? 0));
  setText('stat-gagal', String(summary.count_gagal_in_period ?? 0));
  setText('stat-refund', String(summary.count_refund_in_period ?? 0));
}

function renderRecentTransactions(rows) {
  const list = document.getElementById('recent-transactions-list');
  if (!list) return;
  if (!rows || rows.length === 0) {
    list.innerHTML = `
      <div class="bg-white rounded-2xl border border-slate-200/80 p-5 text-center space-y-1">
        <p class="text-xs font-bold text-slate-600">Belum ada transaksi tercatat</p>
        <p class="text-[11px] text-slate-400">Siap menerima input pesanan di Fase 6 nanti.</p>
      </div>`;
    return;
  }

  list.innerHTML = rows.map((trx) => {
    const badgeClass = getStatusBadge(trx.status);
    const zoneText = trx.target_zone_id ? ` (${escapeHtml(trx.target_zone_id)})` : '';
    return `
      <div class="bg-white rounded-2xl border border-slate-200/80 p-3.5 space-y-1.5 shadow-sm">
        <div class="flex items-center justify-between gap-2">
          <span class="font-mono text-[11px] font-bold text-slate-500">${escapeHtml(trx.invoice_code)}</span>
          <span class="px-2 py-0.5 rounded-full text-[10px] font-bold border ${badgeClass}">${escapeHtml(trx.status)}</span>
        </div>
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <p class="text-xs font-bold text-slate-900 truncate">${escapeHtml(trx.game_name_snapshot)} • ${escapeHtml(trx.product_name_snapshot)}</p>
            <p class="text-[11px] text-slate-500 truncate">${escapeHtml(trx.customer_name_snapshot)} • ID: <span class="font-mono">${escapeHtml(trx.target_user_id)}${zoneText}</span></p>
          </div>
          <div class="text-right shrink-0">
            <p class="text-xs font-extrabold tabular-nums text-slate-900">${formatIDR(trx.sell_price_snapshot)}</p>
            <p class="text-[10px] font-bold tabular-nums text-emerald-700">+${formatIDR(trx.profit_snapshot)}</p>
          </div>
        </div>
        <p class="text-[10px] text-slate-400">${formatWIB(trx.created_at)}</p>
      </div>`;
  }).join('');
}

export async function loadDashboard(period = activePeriod) {
  if (!supabase) return;
  activePeriod = period;
  updatePeriodButtons(period);
  const refreshIcon = document.querySelector('#dash-refresh-btn svg');
  if (refreshIcon) refreshIcon.classList.add('animate-spin-fast');

  try {
    const [summaryRes, recentRes] = await Promise.all([
      supabase.rpc('get_dashboard_summary', { p_period: period }),
      supabase
        .from('transactions')
        .select('id, invoice_code, customer_name_snapshot, game_name_snapshot, product_name_snapshot, target_user_id, target_zone_id, sell_price_snapshot, profit_snapshot, status, created_at')
        .order('created_at', { ascending: false })
        .limit(10)
    ]);
    if (summaryRes.error) throw summaryRes.error;
    if (recentRes.error) throw recentRes.error;
    renderSummary(summaryRes.data);
    renderRecentTransactions(recentRes.data);
  } catch (err) {
    showToast(err?.message || 'Gagal memuat ringkasan dashboard.', 'error');
  } finally {
    if (refreshIcon) refreshIcon.classList.remove('animate-spin-fast');
  }
}

export function initDashboardUI() {
  document.querySelectorAll('.period-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const p = btn.dataset.period || 'daily';
      if (p !== activePeriod) loadDashboard(p);
    });
  });
  document.getElementById('dash-refresh-btn')?.addEventListener('click', () => loadDashboard(activePeriod));
}
