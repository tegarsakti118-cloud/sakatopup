import { supabase } from './supabase.js';

export function generateUUID() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function fetchOrderFormData() {
  if (!supabase) throw new Error('Supabase belum dikonfigurasi.');

  const [gamesRes, productsRes, suppliersRes, customersRes] = await Promise.all([
    supabase
      .from('games')
      .select('id, name, slug, logo_url, banner_url, id_instruction, requires_zone_id, sort_order')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true }),
    supabase
      .from('products')
      .select('id, game_id, name, nominal_label, base_price, sell_price, profit, default_supplier_code, supplier_sku, sort_order')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('sell_price', { ascending: true }),
    supabase
      .from('supplier_providers')
      .select('code, name, mode, is_active')
      .eq('is_active', true)
      .order('name', { ascending: true }),
    supabase
      .from('customers')
      .select('id, name, whatsapp, total_orders')
      .eq('is_active', true)
      .order('last_order_at', { ascending: false, nullsFirst: false })
      .limit(200)
  ]);

  if (gamesRes.error) throw gamesRes.error;
  if (productsRes.error) throw productsRes.error;
  if (suppliersRes.error) throw suppliersRes.error;
  if (customersRes.error) throw customersRes.error;

  return {
    games: gamesRes.data || [],
    products: productsRes.data || [],
    suppliers: suppliersRes.data || [],
    customers: customersRes.data || []
  };
}

export async function fetchFilterGames() {
  if (!supabase) return [];
  const { data } = await supabase
    .from('games')
    .select('id, name')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });
  return data || [];
}

export async function createOrder(params) {
  if (!supabase) throw new Error('Supabase belum siap.');

  const { data, error } = await supabase.rpc('create_order', {
    p_idempotency_key: params.idempotency_key,
    p_customer_name: params.customer_name,
    p_customer_wa: params.customer_wa || '',
    p_game_id: params.game_id,
    p_product_id: params.product_id,
    p_target_user_id: params.target_user_id,
    p_target_zone_id: params.target_zone_id || '',
    p_notes: params.notes || '',
    p_save_customer: Boolean(params.save_customer),
    p_allow_duplicate: Boolean(params.allow_duplicate),
    p_initial_status: params.initial_status || 'Menunggu',
    p_supplier_code: params.supplier_code || null
  });

  if (error) {
    const msg = error.message || '';
    if (msg.includes('DUPLICATE_ORDER:')) {
      const parts = msg.split('DUPLICATE_ORDER:')[1] || '';
      const inv = parts.split(':')[0]?.trim() || '';
      const err = new Error(parts.slice(inv.length + 1).trim() || 'Pesanan serupa terdeteksi.');
      err.code = 'DUPLICATE_ORDER';
      err.duplicateInvoice = inv;
      throw err;
    }
    throw error;
  }
  return data;
}

export async function fetchTransactions({
  search = '',
  status = 'all',
  gameId = 'all',
  startDate = '',
  endDate = '',
  limit = 200
} = {}) {
  if (!supabase) throw new Error('Supabase belum siap.');

  let query = supabase
    .from('transactions')
    .select(
      'id, invoice_code, customer_name_snapshot, customer_wa_snapshot, game_id, game_name_snapshot, product_name_snapshot, nominal_snapshot, target_user_id, target_zone_id, base_price_snapshot, sell_price_snapshot, profit_snapshot, status, status_reason, supplier_code, supplier_ref_id, notes, print_count, last_printed_at, created_at, completed_at, failed_at, refunded_at, refund_modal_returned'
    )
    .order('created_at', { ascending: false })
    .limit(limit);

  if (status && status !== 'all') {
    query = query.eq('status', status);
  }
  if (gameId && gameId !== 'all') {
    query = query.eq('game_id', gameId);
  }
  if (startDate) {
    query = query.gte('created_at', new Date(`${startDate}T00:00:00+07:00`).toISOString());
  }
  if (endDate) {
    query = query.lte('created_at', new Date(`${endDate}T23:59:59.999+07:00`).toISOString());
  }

  const cleanSearch = String(search || '').replace(/[,()%*]/g, '').trim();
  if (cleanSearch) {
    query = query.or(
      `invoice_code.ilike.%${cleanSearch}%,customer_name_snapshot.ilike.%${cleanSearch}%,target_user_id.ilike.%${cleanSearch}%,customer_wa_snapshot.ilike.%${cleanSearch}%`
    );
  }

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function fetchTransactionDetail(id) {
  if (!supabase) throw new Error('Supabase belum siap.');

  const [trxRes, logsRes, printRes, supRes, bizRes] = await Promise.all([
    supabase.from('transactions').select('*').eq('id', id).single(),
    supabase
      .from('transaction_logs')
      .select('id, action_type, previous_status, new_status, reason, metadata, provider_response, created_at')
      .eq('transaction_id', id)
      .order('created_at', { ascending: true }),
    supabase
      .from('print_logs')
      .select('id, print_sequence, receipt_format, print_method, printer_name, printed_at')
      .eq('transaction_id', id)
      .order('printed_at', { ascending: false }),
    supabase.from('supplier_providers').select('code, name, mode, is_active').eq('is_active', true),
    supabase.from('business_settings').select('default_receipt_format').eq('id', 1).maybeSingle()
  ]);

  if (trxRes.error) throw trxRes.error;
  if (logsRes.error) throw logsRes.error;
  if (printRes.error) throw printRes.error;

  return {
    transaction: trxRes.data,
    logs: logsRes.data || [],
    printLogs: printRes.data || [],
    suppliers: supRes.data || [],
    defaultFormat: bizRes.data?.default_receipt_format || 'lengkap'
  };
}

export async function updateTransactionStatus({
  id,
  newStatus,
  reason = '',
  supplierCode = null,
  supplierRefId = null
}) {
  if (!supabase) throw new Error('Supabase belum siap.');
  const { data, error } = await supabase.rpc('update_transaction_status', {
    p_transaction_id: id,
    p_new_status: newStatus,
    p_reason: reason || '',
    p_supplier_code: supplierCode || null,
    p_supplier_ref_id: supplierRefId || null,
    p_provider_response: null
  });
  if (error) throw error;
  return data;
}

export async function correctTransactionRefund({ id, reason, modalReturned }) {
  if (!supabase) throw new Error('Supabase belum siap.');
  const { data, error } = await supabase.rpc('correct_transaction_refund', {
    p_transaction_id: id,
    p_reason: reason,
    p_modal_returned: modalReturned
  });
  if (error) throw error;
  return data;
}

export async function invokeDigiflazzOrder(transactionId) {
  if (!supabase) throw new Error("Supabase belum siap.");
  const { data, error } = await supabase.functions.invoke("digiflazz-order", {
    body: { transaction_id: transactionId }
  });
  if (error) {
    let detail = error.message || "Gagal memanggil Edge Function.";
    try {
      if (error.context && typeof error.context.json === "function") {
        const j = await error.context.json();
        if (j?.error) detail = j.error;
      }
    } catch {}
    throw new Error(detail);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function deleteTransaction({ id, confirmInvoice, reason = '' }) {
  if (!supabase) throw new Error('Supabase belum siap.');
  const { data, error } = await supabase.rpc('delete_transaction', {
    p_transaction_id: id,
    p_confirm_invoice: confirmInvoice,
    p_reason: reason || ''
  });
  if (error) throw error;
  return data;
}

export async function fetchSupplierBalance() {
  if (!supabase) throw new Error('Supabase belum siap.');
  const { data, error } = await supabase.functions.invoke('digiflazz-balance', { body: {} });
  if (error) {
    let detail = error.message || 'Gagal memanggil Edge Function saldo.';
    try {
      if (error.context && typeof error.context.json === 'function') {
        const j = await error.context.json();
        if (j?.error) detail = j.error;
      }
    } catch {}
    throw new Error(detail);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}
