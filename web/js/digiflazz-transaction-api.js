import { supabase } from './supabase.js';
import { generateUUID } from './orders-api.js';

export async function submitDigiflazzPurchase({ buyer_sku_code, customer_no, customer_name = null }) {
  if (!supabase) throw new Error('Supabase belum dikonfigurasi.');
  const sku = String(buyer_sku_code || '').trim();
  const target = String(customer_no || '').trim();
  if (!sku || !target) throw new Error('Produk dan nomor tujuan wajib diisi.');
  const ref_id = generateUUID().replaceAll('-', '');
  const { data, error } = await supabase.functions.invoke('digiflazz-transaction', {
    body: { buyer_sku_code: sku, customer_no: target, customer_name, ref_id, confirm: true }
  });
  if (error) throw new Error(error.message || 'Permintaan transaksi gagal.');
  if (!data?.success) throw new Error(data?.error || 'Transaksi tidak dapat diproses.');
  return data;
}
