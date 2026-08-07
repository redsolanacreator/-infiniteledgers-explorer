// Shared connection module for any browser wallet that speaks the Keplr
// wallet-injection standard (experimentalSuggestChain / enable /
// getOfflineSigner). Keplr and Leap both expose this directly on
// window.keplr / window.leap. Cosmostation ships a Keplr-compatible shim
// at window.cosmostation.providers.keplr specifically so dApps that only
// know how to talk to "Keplr-shaped" wallets can support it too -- that's
// what we target here, rather than Cosmostation's separate native API.
//
// This is intentionally ONE implementation parameterized by wallet id,
// not three copy-pasted integrations.

export type WalletId = 'keplr' | 'leap' | 'cosmostation'

interface WalletDef {
  id: WalletId
  name: string
  installUrl: string
  getProvider: (win: any) => any
}

const WALLET_DEFS: WalletDef[] = [
  { id: 'keplr', name: 'Keplr', installUrl: 'https://www.keplr.app', getProvider: (w) => w.keplr },
  { id: 'leap', name: 'Leap', installUrl: 'https://www.leapwallet.io', getProvider: (w) => w.leap },
  {
    id: 'cosmostation',
    name: 'Cosmostation',
    installUrl: 'https://www.cosmostation.io/wallet',
    getProvider: (w) => w.cosmostation?.providers?.keplr,
  },
]

export function allWallets(): { id: WalletId; name: string; installUrl: string }[] {
  return WALLET_DEFS.map(({ id, name, installUrl }) => ({ id, name, installUrl }))
}

export function detectWallets(win: any = window): { id: WalletId; name: string }[] {
  return WALLET_DEFS.filter((d) => !!d.getProvider(win)).map(({ id, name }) => ({ id, name }))
}

function isUserRejection(err: any): boolean {
  const msg = (err?.message ? err.message : String(err)).toLowerCase()
  return msg.includes('reject') || msg.includes('declin') || msg.includes('cancel')
}

export interface ConnectResult {
  success: boolean
  address?: string
  walletName?: string
  offlineSigner?: any
  reason?: 'not-installed' | 'rejected' | 'error'
  message?: string
}

export async function connectWallet(
  walletId: WalletId,
  chainId: string,
  chainSuggestConfig: unknown,
  win: any = window
): Promise<ConnectResult> {
  const def = WALLET_DEFS.find((d) => d.id === walletId)
  const provider = def?.getProvider(win)
  if (!def || !provider) return { success: false, reason: 'not-installed' }

  try {
    if (typeof provider.experimentalSuggestChain === 'function') {
      await provider.experimentalSuggestChain(chainSuggestConfig)
    }
    await provider.enable(chainId)

    const offlineSigner = provider.getOfflineSigner(chainId)
    const accounts = await offlineSigner.getAccounts()
    const address = accounts?.[0]?.address
    if (!address) return { success: false, reason: 'error', message: 'Wallet returned no account.' }

    return { success: true, address, walletName: def.name, offlineSigner }
  } catch (err: any) {
    if (isUserRejection(err)) return { success: false, reason: 'rejected' }
    return { success: false, reason: 'error', message: err?.message || String(err) }
  }
}
