import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SAKAPAY_CONFIG } from './config.js';

export function isConfigReady() {
  const url = (SAKAPAY_CONFIG.SUPABASE_URL || '').trim();
  const key = (SAKAPAY_CONFIG.SUPABASE_ANON_KEY || '').trim();
  return (
    url.startsWith('https://') &&
    !url.includes('PASTE_') &&
    key.length > 20 &&
    !key.includes('PASTE_')
  );
}

export const supabase = isConfigReady()
  ? createClient(SAKAPAY_CONFIG.SUPABASE_URL.trim(), SAKAPAY_CONFIG.SUPABASE_ANON_KEY.trim(), {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false
      }
    })
  : null;

export async function verifyAdminWhitelist(userId) {
  if (!supabase || !userId) return null;
  const { data, error } = await supabase
    .from('admin_whitelist')
    .select('user_id, username')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}
