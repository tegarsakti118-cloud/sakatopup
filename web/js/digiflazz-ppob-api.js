import { supabase } from './supabase.js';

export async function fetchDigiflazzPrepaidCatalog() {
  if (!supabase) throw new Error('Supabase belum dikonfigurasi.');
  const { data, error } = await supabase.functions.invoke('digiflazz-pricelist', { body: {} });
  if (error) throw new Error(error.message || 'Gagal mengambil katalog Digiflazz.');
  if (!data?.success) throw new Error(data?.error || 'Katalog Digiflazz tidak tersedia.');
  return (data.products || []).filter(p => p.buyer_product_status && p.seller_product_status);
}

export async function inquiryPlnCustomer(customerNo) {
  if (!supabase) throw new Error('Supabase belum dikonfigurasi.');
  const clean = String(customerNo || '').replace(/\D/g, '');
  if (!/^\d{10,13}$/.test(clean)) throw new Error('ID pelanggan PLN harus 10-13 digit.');
  const { data, error } = await supabase.functions.invoke('digiflazz-inquiry-pln', { body: { customer_no: clean } });
  if (error) throw new Error(error.message || 'Inquiry PLN gagal.');
  if (!data?.success) throw new Error(data?.error || 'Data pelanggan PLN tidak ditemukan.');
  return data;
}
