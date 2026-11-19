import { supabase } from './supabase.js';

export function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function isSafeHttpUrl(url) {
  const s = String(url || '').trim();
  return s.startsWith('https://');
}

export async function fetchCatalogBundle() {
  if (!supabase) throw new Error('Supabase belum dikonfigurasi.');

  const [gamesRes, productsRes, suppliersRes, customersRes] = await Promise.all([
    supabase
      .from('games')
      .select('id, name, slug, logo_url, banner_url, id_instruction, requires_zone_id, is_active, sort_order, created_at')
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true }),
    supabase
      .from('products')
      .select('id, game_id, name, nominal_label, base_price, sell_price, profit, default_supplier_code, supplier_sku, is_active, sort_order')
      .order('sort_order', { ascending: true })
      .order('sell_price', { ascending: true }),
    supabase
      .from('supplier_providers')
      .select('code, name, mode, is_active')
      .order('name', { ascending: true }),
    supabase
      .from('customers')
      .select('id, name, whatsapp, notes, total_orders, last_order_at, is_active, created_at')
      .order('last_order_at', { ascending: false, nullsFirst: false })
      .order('name', { ascending: true })
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

export async function uploadGameImage(file, folder, slugBase) {
  if (!supabase) throw new Error('Supabase belum siap.');
  if (!file) throw new Error('Pilih file gambar terlebih dahulu.');

  const maxBytes = 2 * 1024 * 1024;
  if (file.size > maxBytes) {
    throw new Error('Ukuran gambar maksimal 2 MB.');
  }

  const allowedTypes = ['image/png', 'image/jpeg', 'image/webp'];
  const extRaw = (file.name.split('.').pop() || '').toLowerCase();
  const extMap = { png: 'png', jpg: 'jpg', jpeg: 'jpeg', webp: 'webp' };
  const ext = extMap[extRaw];

  if (!ext || (file.type && !allowedTypes.includes(file.type))) {
    throw new Error('Format gambar wajib PNG, JPG, atau WEBP.');
  }

  const safeSlug = slugify(slugBase) || 'game';
  const filePath = `${folder}/${safeSlug}-${Date.now()}.${ext}`;

  const { error: uploadErr } = await supabase.storage
    .from('game-assets')
    .upload(filePath, file, {
      cacheControl: '3600',
      upsert: true,
      contentType: file.type || `image/${ext === 'jpg' ? 'jpeg' : ext}`
    });

  if (uploadErr) throw uploadErr;

  const { data } = supabase.storage.from('game-assets').getPublicUrl(filePath);
  if (!data?.publicUrl) throw new Error('Gagal mendapatkan URL publik gambar.');
  return data.publicUrl;
}

export async function saveGame(id, payload) {
  const clean = {
    name: String(payload.name || '').trim(),
    slug: slugify(payload.slug || payload.name),
    logo_url: String(payload.logo_url || '').trim(),
    banner_url: String(payload.banner_url || '').trim(),
    id_instruction: String(payload.id_instruction || '').trim() || 'Masukkan User ID Anda dengan benar.',
    requires_zone_id: Boolean(payload.requires_zone_id),
    is_active: Boolean(payload.is_active),
    sort_order: Number.isFinite(Number(payload.sort_order)) ? parseInt(payload.sort_order, 10) : 0
  };

  if (!clean.name) throw new Error('Nama game wajib diisi.');
  if (!clean.slug || !/^[a-z0-9-]+$/.test(clean.slug)) {
    throw new Error('Slug hanya boleh huruf kecil, angka, dan tanda hubung (-).');
  }

  const query = id
    ? supabase.from('games').update(clean).eq('id', id).select().single()
    : supabase.from('games').insert(clean).select().single();

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function toggleGameStatus(id, isActive) {
  const { error } = await supabase.from('games').update({ is_active: isActive }).eq('id', id);
  if (error) throw error;
}

export async function deleteGame(id) {
  const { error } = await supabase.from('games').delete().eq('id', id);
  if (error) {
    if (error.code === '23503') {
      throw new Error('Game sudah punya produk atau riwayat transaksi. Gunakan Nonaktifkan saja.');
    }
    throw error;
  }
}

export async function saveProduct(id, payload) {
  const basePrice = parseInt(payload.base_price, 10);
  const sellPrice = parseInt(payload.sell_price, 10);

  if (Number.isNaN(basePrice) || basePrice < 0) throw new Error('Harga modal tidak valid.');
  if (Number.isNaN(sellPrice) || sellPrice < 0) throw new Error('Harga jual tidak valid.');

  const clean = {
    game_id: payload.game_id,
    name: String(payload.name || '').trim(),
    nominal_label: String(payload.nominal_label || '').trim(),
    base_price: basePrice,
    sell_price: sellPrice,
    default_supplier_code: String(payload.default_supplier_code || 'manual').trim() || 'manual',
    supplier_sku: String(payload.supplier_sku || '').trim(),
    is_active: Boolean(payload.is_active),
    sort_order: Number.isFinite(Number(payload.sort_order)) ? parseInt(payload.sort_order, 10) : 0
  };

  if (!clean.game_id) throw new Error('Pilih game terlebih dahulu.');
  if (!clean.name) throw new Error('Nama produk wajib diisi.');
  if (!clean.nominal_label) throw new Error('Nominal top up wajib diisi.');

  const query = id
    ? supabase.from('products').update(clean).eq('id', id).select().single()
    : supabase.from('products').insert(clean).select().single();

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function toggleProductStatus(id, isActive) {
  const { error } = await supabase.from('products').update({ is_active: isActive }).eq('id', id);
  if (error) throw error;
}

export async function deleteProduct(id) {
  const { error } = await supabase.from('products').delete().eq('id', id);
  if (error) {
    if (error.code === '23503') {
      throw new Error('Produk sudah pernah dipakai transaksi. Gunakan Nonaktifkan saja.');
    }
    throw error;
  }
}

export async function saveCustomer(id, payload) {
  const clean = {
    name: String(payload.name || '').trim(),
    whatsapp: String(payload.whatsapp || '').replace(/[^0-9]/g, ''),
    notes: String(payload.notes || '').trim(),
    is_active: Boolean(payload.is_active)
  };

  if (!clean.name) throw new Error('Nama pelanggan wajib diisi.');
  if (clean.whatsapp.length < 8 || clean.whatsapp.length > 16) {
    throw new Error('Nomor WhatsApp wajib 8-16 digit angka.');
  }

  const query = id
    ? supabase.from('customers').update(clean).eq('id', id).select().single()
    : supabase.from('customers').insert(clean).select().single();

  const { data, error } = await query;
  if (error) {
    if (error.code === '23505') {
      throw new Error('Nomor WhatsApp ini sudah terdaftar di database pelanggan.');
    }
    throw error;
  }
  return data;
}
