// Tokenfactory denoms are always `factory/{creator_address}/{subdenom}`.
// Parsing this format is how the token-metadata contract enforces access
// control on-chain too -- see contracts/token-metadata in the chain repo.

export function parseCreatorFromDenom(denom: string): string | null {
  const parts = denom.split('/')
  if (parts.length < 3 || parts[0] !== 'factory' || !parts[1] || !parts[2]) return null
  return parts[1]
}
