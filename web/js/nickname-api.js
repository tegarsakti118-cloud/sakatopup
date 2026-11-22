import { SAKAPAY_CONFIG } from './config.js';

// Endpoint cek username. Bisa diganti lewat config.js:
//   NICKNAME_API_URL: 'https://domain-kamu/nickname'
// Format yang diharapkan: GET {base}/{kode}?id=USER_ID[&server=ZONE_ID]
// Respons JSON: { success: true, name: 'Username' } atau { success: false }
const DEFAULT_BASE_URL = 'https://api.isan.eu.org/nickname';
const TIMEOUT_MS = 8000;

// Daftar game yang didukung cek otomatis. Dicocokkan lewat nama / slug game di katalog.
const GAME_RULES = [
  { test: /mobile\s*legends|\bmlbb\b|\bml\b/i, exclude: /adventure/i, path: 'ml', zone: true },
  { test: /free\s*fire|\bff\b/i, path: 'ff', zone: false },
  { test: /arena\s*of\s*valor|\baov\b/i, path: 'aov', zone: false },
  { test: /call\s*of\s*duty|\bcodm?\b/i, path: 'cod', zone: false },
  { test: /genshin/i, path: 'gi', zone: false },
  { test: /aether\s*gazer/i, path: 'ag', zone: false }
];

function getRule(game) {
  if (!game) return null;
  const hay = `${game.name || ''} ${game.slug || ''}`;
  return GAME_RULES.find((r) => r.test.test(hay) && !(r.exclude && r.exclude.test(hay))) || null;
}

// Didukung hanya jika game punya aturan DAN (bila butuh zone) form memang menyediakan Zone ID.
export function isNicknameLookupSupported(game) {
  const rule = getRule(game);
  if (!rule) return false;
  return !rule.zone || Boolean(game.requires_zone_id);
}

export function nicknameNeedsZone(game) {
  return Boolean(getRule(game)?.zone);
}

function cleanName(raw) {
  let s = String(raw ?? '');
  if (/%[0-9A-F]{2}/i.test(s)) {
    try {
      s = decodeURIComponent(s);
    } catch {
      // biarkan apa adanya
    }
  }
  return s.replace(/\s+/g, ' ').trim().slice(0, 60);
}

/**
 * Mengembalikan string username, atau null bila ID tidak ditemukan.
 * Melempar Error bila layanan tidak bisa dihubungi (jaringan / timeout / error server).
 */
export async function lookupGameNickname(game, userId, zoneId = '') {
  const rule = getRule(game);
  if (!rule) return null;

  const base = String(SAKAPAY_CONFIG.NICKNAME_API_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const params = new URLSearchParams({ id: String(userId).trim() });
  if (rule.zone) params.set('server', String(zoneId).trim());

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${base}/${rule.path}?${params.toString()}`, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' }
    });

    let json = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }

    if (json && json.success && json.name) {
      const name = cleanName(json.name);
      return name || null;
    }
    if (json && json.success === false) return null;
    if (!res.ok) throw new Error(`Layanan cek username error (${res.status}).`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
