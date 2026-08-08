// ATOM/USD spot price via CoinGecko's public API. This is the only USD
// price feed used anywhere on the site -- the chain itself has no USD
// oracle, so ATOM/USD is the external anchor everything else derives from
// (see homepage: INF/ATOM pool ratio × this = INF/USD).
//
// CoinGecko's free tier is rate-limited and shared across every visitor's
// browser, so this is cached (in-memory + localStorage, TTL below) rather
// than fetched on every poll tick or page load.

const COINGECKO_URL = 'https://api.coingecko.com/api/v3/simple/price?ids=cosmos&vs_currencies=usd'
const CACHE_KEY = 'inf_atom_usd_cache_v1'
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

interface CacheEntry {
  price: number
  fetchedAt: number
}

function readCache(): CacheEntry | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (typeof parsed?.price === 'number' && typeof parsed?.fetchedAt === 'number') return parsed
    return null
  } catch {
    return null
  }
}

function writeCache(entry: CacheEntry) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(entry))
  } catch {}
}

let memCache: CacheEntry | null = null
let inflight: Promise<number | null> | null = null

/**
 * Current ATOM/USD price, cached for CACHE_TTL_MS. Returns the last known
 * good price (even if stale) rather than null when a refresh fails, and
 * never throws.
 */
export async function fetchAtomUsdPrice(): Promise<number | null> {
  if (!memCache) memCache = readCache()

  const fresh = memCache && Date.now() - memCache.fetchedAt < CACHE_TTL_MS
  if (fresh) return memCache!.price
  if (inflight) return inflight

  inflight = (async () => {
    try {
      const res = await fetch(COINGECKO_URL)
      if (!res.ok) return memCache?.price ?? null
      const body = await res.json()
      const price = Number(body?.cosmos?.usd)
      if (!Number.isFinite(price)) return memCache?.price ?? null
      memCache = { price, fetchedAt: Date.now() }
      writeCache(memCache)
      return price
    } catch {
      return memCache?.price ?? null
    } finally {
      inflight = null
    }
  })()
  return inflight
}
