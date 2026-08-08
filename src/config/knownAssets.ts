export interface KnownAsset {
  symbol: string
  name: string
  decimals: number
  logo: string
  vestingAddr?: string
  maxSupply?: string
  vestingNote?: string
}

export const KNOWN_ASSETS: Record<string, KnownAsset> = {
  minf: {
    symbol: 'INF',
    name: 'Infinite Ledgers',
    decimals: 6,
    logo: '/logos/infiniteledgers.png',
    vestingAddr: 'inf14h3h0n645e0zln9gn004un47mdn9yfg0nswtyv',
    maxSupply: '400,000,000',
    vestingNote: 'Locked = founder vesting · linear release Aug 2026 → 2046',
  },
}

export function denomToSymbol(d: string): string {
  if (KNOWN_ASSETS[d]) return KNOWN_ASSETS[d].symbol
  if (d.startsWith('factory/')) {
    const parts = d.split('/')
    return (parts[2] ?? d).toUpperCase()
  }
  return d.toUpperCase()
}
