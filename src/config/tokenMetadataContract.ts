// Client for the token-metadata CosmWasm contract deployed on
// infiniteledgers-1. The contract is the single source of truth for
// off-chain-style token metadata (description/logo/links); this file only
// reads/writes it through its query and execute messages -- see
// contracts/token-metadata in the chain repo for the contract itself.

export const CHAIN_ID = 'infiniteledgers-1'
export const RPC_ENDPOINT = 'https://rpc.infiniteledgers.com'
export const REST_ENDPOINT = 'https://api.infiniteledgers.com'
export const TOKEN_METADATA_CONTRACT_ADDRESS =
  'inf14hj2tavq8fpesdwxxcu44rty3hh90vhujrvcmstl4zr3txmfvw9s8rktmp'

// Passed to a wallet's experimentalSuggestChain() so it can add the chain
// if the user doesn't already have it configured.
export const CHAIN_SUGGEST_CONFIG = {
  chainId: CHAIN_ID,
  chainName: 'Infinite Ledgers',
  rpc: RPC_ENDPOINT,
  rest: REST_ENDPOINT,
  bip44: { coinType: 118 },
  bech32Config: {
    bech32PrefixAccAddr: 'inf',
    bech32PrefixAccPub: 'infpub',
    bech32PrefixValAddr: 'infvaloper',
    bech32PrefixValPub: 'infvaloperpub',
    bech32PrefixConsAddr: 'infvalcons',
    bech32PrefixConsPub: 'infvalconspub',
  },
  currencies: [{ coinDenom: 'INF', coinMinimalDenom: 'minf', coinDecimals: 6 }],
  feeCurrencies: [
    { coinDenom: 'INF', coinMinimalDenom: 'minf', coinDecimals: 6, gasPriceStep: { low: 0, average: 0, high: 0.01 } },
  ],
  stakeCurrency: { coinDenom: 'INF', coinMinimalDenom: 'minf', coinDecimals: 6 },
}

export interface TokenMetadata {
  description: string | null
  logo_url: string | null
  website: string | null
  twitter: string | null
  discord: string | null
  updated_at: number
}

export interface SetMetadataInput {
  denom: string
  description: string | null
  logo_url: string | null
  website: string | null
  twitter: string | null
  discord: string | null
}

/** Returns null if no metadata has been set for this denom -- not an error. */
export async function fetchTokenMetadata(denom: string): Promise<TokenMetadata | null> {
  const query = { get_metadata: { denom } }
  const encoded = btoa(JSON.stringify(query))
  const url = `${REST_ENDPOINT}/cosmwasm/wasm/v1/contract/${TOKEN_METADATA_CONTRACT_ADDRESS}/smart/${encoded}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Metadata query failed (${res.status})`)
  const body = await res.json()
  return body?.data?.metadata ?? null
}

export function buildSetMetadataMsg(input: SetMetadataInput) {
  return { set_metadata: input }
}
