// Read-only client for the AMM DEX contract's GetPrice query. No USD
// anywhere -- there is no USD price feed on this chain, so every price
// here is expressed in INF (or, for INF's own implied price, in whatever
// denom it's paired against). See contracts/amm-dex in the chain repo.

const REST = 'https://api.infiniteledgers.com'
export const AMM_CONTRACT_ADDRESS = 'inf1nc5tatafv6eyq7llkr2gv50ff9e22mnf70qgjlv737ktmt4eswrqtknfe8'

/**
 * Raw spot price: minimal units of denomOut per 1 minimal unit of denomIn.
 * Returns null if no pool exists for the pair -- never throws, and never
 * fabricates a number when the AMM genuinely has no market for it.
 */
export async function fetchAmmSpotPrice(denomIn: string, denomOut: string): Promise<number | null> {
  try {
    const query = { get_price: { denom_in: denomIn, denom_out: denomOut } }
    const encoded = btoa(JSON.stringify(query))
    const url = `${REST}/cosmwasm/wasm/v1/contract/${AMM_CONTRACT_ADDRESS}/smart/${encoded}`
    const res = await fetch(url)
    if (!res.ok) return null
    const body = await res.json()
    const raw = body?.data?.spot_price
    if (raw == null) return null
    const n = Number(raw)
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}

/**
 * Price of 1 display-unit of `denom` in INF, via its real pool against
 * minf if one exists. Adjusts for both denoms' decimals, since the
 * contract's spot price is a raw minimal-unit ratio. Returns null if
 * there's no pool for this denom (including minf itself).
 */
export async function fetchPriceInInf(denom: string, denomDecimals: number): Promise<number | null> {
  if (denom === 'minf') return null
  const raw = await fetchAmmSpotPrice(denom, 'minf')
  if (raw == null) return null
  return raw * 10 ** (denomDecimals - 6)
}

/**
 * Implied price of 1 INF expressed in `otherDenom`, via the minf pool
 * paired against it. Used only for the one INF-detail-page callout, not
 * the shared token list -- see the explorer's report on this decision.
 */
export async function fetchImpliedInfPrice(otherDenom: string, otherDecimals: number): Promise<number | null> {
  const raw = await fetchAmmSpotPrice('minf', otherDenom)
  if (raw == null) return null
  return raw * 10 ** (6 - otherDecimals)
}

export interface PoolReserves {
  denomA: string
  denomB: string
  reserveA: bigint // raw minimal units of denomA
  reserveB: bigint // raw minimal units of denomB
}

/**
 * Raw reserves of a pool, in minimal units, as reported by the contract's
 * own get_pool query -- not derived from spot_price. The contract returns
 * denom_a/denom_b in its own internal ordering regardless of the order
 * queried in, so callers must match against the returned denoms rather
 * than assuming a/b position. Returns null if the pool doesn't exist.
 */
export async function fetchPool(denomA: string, denomB: string): Promise<PoolReserves | null> {
  try {
    const query = { get_pool: { denom_a: denomA, denom_b: denomB } }
    const encoded = btoa(JSON.stringify(query))
    const url = `${REST}/cosmwasm/wasm/v1/contract/${AMM_CONTRACT_ADDRESS}/smart/${encoded}`
    const res = await fetch(url)
    if (!res.ok) return null
    const body = await res.json()
    const d = body?.data
    if (d?.reserve_a == null || d?.reserve_b == null) return null
    return {
      denomA: d.denom_a,
      denomB: d.denom_b,
      reserveA: BigInt(d.reserve_a),
      reserveB: BigInt(d.reserve_b),
    }
  } catch {
    return null
  }
}
