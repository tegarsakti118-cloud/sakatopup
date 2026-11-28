import { supabase } from './supabase.js';

export async function checkDigiflazzTransactionStatus(ref_id) {
  if (!supabase) throw new Error('Supabase belum dikonfigurasi.');
  const { data, error } = await supabase.functions.invoke('digiflazz-status', {
    body: { ref_id }
  });
  if (error) throw new Error(error.message || 'Gagal mengecek status.');
  if (!data?.success) throw new Error(data?.error || 'Status belum berhasil diperbarui.');
  return data;
}
