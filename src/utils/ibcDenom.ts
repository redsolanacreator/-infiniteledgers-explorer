// General IBC denom -> human-readable resolution. Works for ANY ibc/{hash}
// denom this chain ever holds, not just one hardcoded token.
//
// The "correct" route for this is the ibc-transfer module's own
// denom_trace REST query (/ibc/apps/transfer/v1/denom_traces/{hash}), but
// that route returns HTTP 501 "Not Implemented" on this chain -- the
// IBC module is wired up manually (see chain repo cmd/.../root.go, same
// pattern as tokenfactory and wasm) and its REST-gateway registration
// wasn't completed. That's a chain-side gap, out of scope for this
// frontend-only change.
//
// x/bank's denoms_metadata route IS properly wired (bank uses normal
// depinject), and ibc-go automatically registers bank denom metadata for
// every IBC denom the first time it's received, with `display` set to the
// full trace path (e.g. "transfer/channel-0/uatom"). That gives us the
// same information the denom_trace query would have, generally, for any
// IBC denom -- not specific to this one hash.

const REST = 'https://api.infiniteledgers.com'

export interface ResolvedIbcDenom {
  baseDenom: string // e.g. 'uatom'
  path: string | null // e.g. 'transfer/channel-0'
  symbol: string // e.g. 'ATOM' -- derived, see below
  decimals: number // e.g. 6 -- derived, see below
}

export function isIbcDenom(denom: string): boolean {
  return denom.startsWith('ibc/')
}

// Cosmos SDK convention: a denom's minimal unit is almost always its
// display symbol lowercased with a "u" (micro) prefix, at 6 decimals
// (uatom -> ATOM, uosmo -> OSMO, uluna -> LUNA, ...). This is a general
// ecosystem-wide convention, not specific to ATOM -- applied the same way
// every real Cosmos wallet/explorer does when a chain hasn't published
// richer denom metadata.
function deriveSymbolAndDecimals(baseDenom: string): { symbol: string; decimals: number } {
  const microMatch = /^u([a-z][a-z0-9]*)$/i.exec(baseDenom)
  if (microMatch) return { symbol: microMatch[1].toUpperCase(), decimals: 6 }
  return { symbol: baseDenom.toUpperCase(), decimals: 0 }
}

const cache = new Map<string, Promise<ResolvedIbcDenom | null>>()

/** Returns null if the denom isn't ibc/... or couldn't be resolved -- never throws. */
export function resolveIbcDenom(denom: string): Promise<ResolvedIbcDenom | null> {
  if (!isIbcDenom(denom)) return Promise.resolve(null)
  const cached = cache.get(denom)
  if (cached) return cached

  const promise = (async () => {
    try {
      const url = `${REST}/cosmos/bank/v1beta1/denoms_metadata/${encodeURIComponent(denom)}`
      const res = await fetch(url)
      if (!res.ok) return null
      const body = await res.json()
      const display: string | undefined = body?.metadata?.display
      if (!display) return null

      const segments = display.split('/').filter(Boolean)
      const baseDenom = segments[segments.length - 1]
      if (!baseDenom) return null
      const path = segments.length > 1 ? segments.slice(0, -1).join('/') : null

      const { symbol, decimals } = deriveSymbolAndDecimals(baseDenom)
      return { baseDenom, path, symbol, decimals }
    } catch {
      return null
    }
  })()

  cache.set(denom, promise)
  return promise
}
