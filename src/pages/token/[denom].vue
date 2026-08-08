<route lang="yaml">
meta:
  layout: blank
</route>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue'
import InfSearchBar from '@/components/inf/SearchBar.vue'
import ThemeToggle from '@/components/inf/ThemeToggle.vue'
import AppFooter from '@/components/inf/AppFooter.vue'
import { useBaseStore } from '@/stores'
import { KNOWN_ASSETS } from '@/config/knownAssets'
import type { KnownAsset } from '@/config/knownAssets'
import { parseCreatorFromDenom } from '@/utils/tokenfactory'
import { detectWallets, connectWallet, type WalletId } from '@/utils/multiWallet'
import { executeSetMetadata } from '@/utils/executeSetMetadata'
import { fetchTokenMetadata, CHAIN_ID, CHAIN_SUGGEST_CONFIG } from '@/config/tokenMetadataContract'
import type { TokenMetadata } from '@/config/tokenMetadataContract'
import { isIbcDenom, resolveIbcDenom } from '@/utils/ibcDenom'
import { fetchPriceInInf, fetchImpliedInfPrice } from '@/config/ammContract'

// ── Theme ──────────────────────────────────────────────────────────────────────
const baseStore = useBaseStore()
const isLight   = computed(() => baseStore.theme === 'light')

// ── Route / asset metadata ─────────────────────────────────────────────────────
const props    = defineProps(['denom'])
const API      = 'https://api.infiniteledgers.com'
const CHAIN    = 'infiniteledgers'

const denom    = computed(() => (props.denom as string) || 'minf')
const asset    = computed<KnownAsset | null>(() => KNOWN_ASSETS[denom.value] ?? null)
const isIbc    = computed(() => isIbcDenom(denom.value))

// General IBC denom-trace resolution (see src/utils/ibcDenom.ts) -- not
// specific to any one token. Starts as a clear placeholder, not the raw
// hash, and is filled in once the lookup resolves.
const ibcSymbol    = ref<string | null>(null)
const ibcDecimals  = ref<number | null>(null)
const ibcPath      = ref<string | null>(null)
const ibcResolved  = ref(false)

async function loadIbcInfo() {
  if (!isIbc.value) { ibcResolved.value = true; return }
  const resolved = await resolveIbcDenom(denom.value)
  if (resolved) {
    ibcSymbol.value   = resolved.symbol
    ibcDecimals.value = resolved.decimals
    ibcPath.value      = resolved.path
  }
  ibcResolved.value = true
}

const symbol   = computed(() => asset.value?.symbol ?? ibcSymbol.value ?? (isIbc.value ? 'IBC Token' : denom.value.toUpperCase()))
const decimals = computed(() => asset.value?.decimals ?? ibcDecimals.value ?? 0)
const logo     = computed(() => asset.value?.logo ?? null)

// ── Real AMM price (in INF) -- only for denoms with an actual pool ──────────────
const priceInInf    = ref<number | null>(null)
const priceLoading  = ref(denom.value !== 'minf')

async function loadPrice() {
  if (denom.value === 'minf') return
  priceLoading.value = true
  try {
    priceInInf.value = await fetchPriceInInf(denom.value, decimals.value)
  } catch {
    priceInInf.value = null
  } finally {
    priceLoading.value = false
  }
}

// INF's own row has no self-price. The minf/ATOM pool is the closest thing
// to a real external reference point for INF, so its detail page shows an
// implied ATOM price as a clearly-labeled supplementary figure -- this one
// pool pairing is a deliberate, disclosed exception, not the general
// resolver above (there's no "list pools for a denom" query on the AMM
// contract to discover this dynamically).
const ATOM_IBC_DENOM = 'ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2'
const impliedAtomPrice  = ref<number | null>(null)
const impliedAtomSymbol = ref('ATOM')

async function loadImpliedAtomPrice() {
  if (denom.value !== 'minf') return
  const resolved = await resolveIbcDenom(ATOM_IBC_DENOM)
  const dec = resolved?.decimals ?? 6
  impliedAtomSymbol.value = resolved?.symbol ?? 'ATOM'
  impliedAtomPrice.value = await fetchImpliedInfPrice(ATOM_IBC_DENOM, dec)
}

// ── Creator / tokenfactory vs native ─────────────────────────────────────────────
const isNativeDenom  = computed(() => denom.value === 'minf')
const creatorAddress = computed(() => (isNativeDenom.value ? null : parseCreatorFromDenom(denom.value)))

// ── Token metadata (from the token-metadata CosmWasm contract) ──────────────────
const metadata       = ref<TokenMetadata | null>(null)
const metadataLoaded = ref(false)

async function loadMetadata() {
  metadataLoaded.value = false
  try {
    metadata.value = await fetchTokenMetadata(denom.value)
  } catch {
    metadata.value = null
  } finally {
    metadataLoaded.value = true
  }
}

// ── Edit flow (wallet connect -> creator check -> form -> submit) ───────────────
type EditState =
  | 'idle' | 'choosing-wallet' | 'connecting' | 'no-wallet'
  | 'not-creator' | 'editing' | 'submitting' | 'success' | 'error'

const editState          = ref<EditState>('idle')
const editError          = ref('')
const availableWallets   = ref<{ id: WalletId; name: string }[]>([])
const connectedAddress   = ref<string | null>(null)
const connectedWalletName = ref<string | null>(null)
const activeOfflineSigner = ref<any>(null)

const form = reactive({
  description: '',
  logo_url: '',
  website: '',
  twitter: '',
  discord: '',
})

function openEditFlow() {
  editError.value = ''
  const wallets = detectWallets()
  if (wallets.length === 0) {
    editState.value = 'no-wallet'
    return
  }
  if (wallets.length === 1) {
    startConnect(wallets[0].id)
    return
  }
  availableWallets.value = wallets
  editState.value = 'choosing-wallet'
}

async function startConnect(walletId: WalletId) {
  editState.value = 'connecting'
  const result = await connectWallet(walletId, CHAIN_ID, CHAIN_SUGGEST_CONFIG)

  if (!result.success) {
    if (result.reason === 'not-installed') {
      editState.value = 'no-wallet'
    } else if (result.reason === 'rejected') {
      editError.value = 'Connection cancelled.'
      editState.value = 'error'
    } else {
      editError.value = result.message || 'Could not connect wallet.'
      editState.value = 'error'
    }
    return
  }

  connectedAddress.value    = result.address!
  connectedWalletName.value = result.walletName!
  activeOfflineSigner.value = result.offlineSigner

  if (!creatorAddress.value || result.address !== creatorAddress.value) {
    editState.value = 'not-creator'
    return
  }

  form.description = metadata.value?.description ?? ''
  form.logo_url    = metadata.value?.logo_url ?? ''
  form.website      = metadata.value?.website ?? ''
  form.twitter        = metadata.value?.twitter ?? ''
  form.discord          = metadata.value?.discord ?? ''
  editState.value = 'editing'
}

async function submitMetadata() {
  editState.value = 'submitting'
  editError.value = ''
  try {
    await executeSetMetadata(activeOfflineSigner.value, connectedAddress.value!, {
      denom: denom.value,
      description: form.description.trim() || null,
      logo_url: form.logo_url.trim() || null,
      website: form.website.trim() || null,
      twitter: form.twitter.trim() || null,
      discord: form.discord.trim() || null,
    })
    editState.value = 'success'
    await loadMetadata()
  } catch (err: any) {
    editError.value = err?.message || 'Transaction failed.'
    editState.value = 'editing'
  }
}

function cancelEdit() {
  editState.value = 'idle'
  editError.value = ''
}

// ── State ──────────────────────────────────────────────────────────────────────
const connected       = ref(false)
const totalSupply = ref(0n)
const unvested    = ref(0n)
const vestingOrig = ref(0n)
const vestingStartSec = ref(0)
const vestingEndSec   = ref(0)

const activeTab   = ref<'transfers' | 'activities' | 'holders'>('transfers')

// Holders
const holders     = ref<HolderRow[]>([])
const holderPage  = ref(0)
const HOLDER_PAGE = 20

// Transactions (all fetched, paginated client-side)
const allTxs      = ref<TxRow[]>([])
const txPage      = ref(0)
const TX_PAGE     = 20

// copy state
const copiedAddr  = ref<string | null>(null)

// ── Interfaces ─────────────────────────────────────────────────────────────────
interface TxRow {
  hash: string; height: string; time: string
  msgType: string; success: boolean
  from: string; to: string; amount: string
}
interface HolderRow {
  rank: number; address: string; balance: bigint
}

// ── Derived ────────────────────────────────────────────────────────────────────
const circulating = computed(() =>
  totalSupply.value > unvested.value
    ? totalSupply.value - unvested.value
    : totalSupply.value
)

// Paginated tx slices
const txPageSlice = computed(() =>
  allTxs.value.slice(txPage.value * TX_PAGE, (txPage.value + 1) * TX_PAGE)
)
const txPageCount = computed(() => Math.ceil(allTxs.value.length / TX_PAGE))

// Paginated holder slices
const holderPageSlice = computed(() =>
  holders.value.slice(holderPage.value * HOLDER_PAGE, (holderPage.value + 1) * HOLDER_PAGE)
)
const holderPageCount = computed(() => Math.ceil(holders.value.length / HOLDER_PAGE))

// Daily tx chart — last 14 days
const chartDays = computed(() => {
  const today = new Date()
  const out: { label: string; count: number }[] = []
  for (let i = 13; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const dayStr = d.toISOString().slice(0, 10)
    const label  = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    const count  = allTxs.value.filter(tx => tx.time.startsWith(dayStr)).length
    out.push({ label, count })
  }
  return out
})
const chartMax = computed(() => Math.max(1, ...chartDays.value.map(d => d.count)))

// Chart SVG geometry (14 bars in 420-unit viewBox)
const BAR_SLOT = 420 / 14
const chartBars = computed(() =>
  chartDays.value.map((d, i) => {
    const barH = (d.count / chartMax.value) * 55
    return {
      x:     i * BAR_SLOT + BAR_SLOT * 0.15,
      y:     5 + (55 - barH),
      w:     BAR_SLOT * 0.7,
      h:     Math.max(d.count > 0 ? 2 : 0, barH),
      label: d.label,
      count: d.count,
      lx:    i * BAR_SLOT + BAR_SLOT / 2,
    }
  })
)

// ── Helpers ────────────────────────────────────────────────────────────────────
async function sfetch(url: string): Promise<any> {
  const ctrl = new AbortController()
  const t    = setTimeout(() => ctrl.abort(), 8000)
  try {
    const r = await fetch(url, { signal: ctrl.signal })
    clearTimeout(t)
    if (!r.ok) throw new Error(String(r.status))
    return r.json()
  } catch (e) { clearTimeout(t); throw e }
}

function fmtWithDecimals(amount: bigint, dec: number): string {
  if (dec === 0) return amount.toLocaleString()
  const div   = BigInt(10 ** dec)
  const whole = amount / div
  const frac  = amount % div
  if (frac === 0n) return whole.toLocaleString()
  return `${whole.toLocaleString()}.${frac.toString().padStart(dec, '0').replace(/0+$/, '')}`
}

function fmtAmt(amount: bigint): string {
  return fmtWithDecimals(amount, decimals.value)
}

function fmtCoins(coins: any): string {
  if (!coins) return '—'
  const arr = Array.isArray(coins) ? coins : [coins]
  const parts = arr.map((c: any) => {
    if (!c?.denom) return ''
    const a = KNOWN_ASSETS[c.denom]
    if (a) return `${fmtWithDecimals(BigInt(c.amount || '0'), a.decimals)} ${a.symbol}`
    return `${c.amount} ${c.denom}`
  }).filter(Boolean)
  return parts.length ? parts.join(', ') : '—'
}

function relTime(iso: string): string {
  if (!iso) return '—'
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (diff < 0)     return 'just now'
  if (diff < 60)    return `${diff}s ago`
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return new Date(iso).toLocaleDateString()
}

function fmtPriceValue(price: number): string {
  if (price === 0) return '0'
  if (price >= 1) return price.toLocaleString(undefined, { maximumFractionDigits: 4 })
  return price.toPrecision(4)
}

function truncAddr(a: string): string {
  if (!a || a.length <= 20) return a
  return a.slice(0, 10) + '…' + a.slice(-6)
}
function truncHash(h: string): string {
  if (!h || h.length < 14) return h
  return h.slice(0, 8) + '…' + h.slice(-6)
}

function copyAddr(addr: string) {
  navigator.clipboard.writeText(addr).then(() => {
    copiedAddr.value = addr
    setTimeout(() => { copiedAddr.value = null }, 2000)
  }).catch(() => {})
}

interface PillInfo { label: string; color: string }
function msgPill(msgType: string): PillInfo {
  const map: Record<string, PillInfo> = {
    'Send':                        { label: 'Transfer',    color: '#3b82f6' },
    'Delegate':                    { label: 'Delegate',    color: '#8b5cf6' },
    'Undelegate':                  { label: 'Undelegate',  color: '#f97316' },
    'BeginRedelegate':             { label: 'Redelegate',  color: '#ec4899' },
    'WithdrawDelegatorReward':     { label: 'Claim',       color: '#22c55e' },
    'Vote':                        { label: 'Vote',        color: '#14b8a6' },
    'VoteWeighted':                { label: 'Vote',        color: '#14b8a6' },
    'CreateValidator':             { label: 'Create Val.', color: '#00C805' },
    'EditValidator':               { label: 'Edit Val.',   color: '#00C805' },
    'WithdrawValidatorCommission': { label: 'Commission',  color: '#22c55e' },
  }
  return map[msgType] ?? { label: msgType || 'Unknown', color: '#6b7280' }
}

function parseTxRow(txr: any, tx: any): TxRow {
  const msgs: any[] = tx?.body?.messages ?? []
  const msg  = msgs[0] ?? {}
  const typeUrl = msg['@type'] ?? ''
  const msgType = typeUrl.split('.').pop()?.replace(/^Msg/, '') ?? 'Unknown'
  let from = '', to = '', amount = '—'

  if (typeUrl.endsWith('MsgSend')) {
    from = msg.from_address ?? ''; to = msg.to_address ?? ''
    amount = fmtCoins(msg.amount)
  } else if (typeUrl.endsWith('MsgDelegate') || typeUrl.endsWith('MsgUndelegate')) {
    from = msg.delegator_address ?? ''; to = msg.validator_address ?? ''
    amount = fmtCoins(msg.amount ? [msg.amount] : null)
  } else if (typeUrl.endsWith('MsgBeginRedelegate')) {
    from = msg.validator_src_address ?? ''; to = msg.validator_dst_address ?? ''
    amount = fmtCoins(msg.amount ? [msg.amount] : null)
  } else if (typeUrl.endsWith('MsgWithdrawDelegatorReward')) {
    from = msg.delegator_address ?? ''; to = msg.validator_address ?? ''
  } else if (typeUrl.endsWith('MsgCreateValidator')) {
    from = msg.delegator_address ?? ''; to = msg.validator_address ?? ''
    amount = fmtCoins(msg.value ? [msg.value] : null)
  } else if (typeUrl.endsWith('MsgWithdrawValidatorCommission')) {
    from = msg.validator_address ?? ''
  } else {
    from = msg.delegator_address ?? msg.voter ?? msg.from_address ?? ''
  }

  return { hash: txr.txhash ?? '', height: txr.height ?? '', time: txr.timestamp ?? '',
           msgType, success: txr.code === 0, from, to, amount }
}

function recomputeUnvested() {
  if (!asset.value?.vestingAddr) { unvested.value = 0n; return }
  const ov = vestingOrig.value
  const st = vestingStartSec.value
  const et = vestingEndSec.value
  if (ov === 0n || et === 0) { unvested.value = 0n; return }
  const now = Math.floor(Date.now() / 1000)
  if (st === 0 || now <= st) { unvested.value = ov; return }
  if (now >= et)              { unvested.value = 0n; return }
  const vested = ov * BigInt(now - st) / BigInt(et - st)
  unvested.value = ov - vested
}

// ── Fetch functions ────────────────────────────────────────────────────────────
async function fetchSupply() {
  try {
    const d = await sfetch(`${API}/cosmos/bank/v1beta1/supply/by_denom?denom=${denom.value}`)
    totalSupply.value = BigInt(d.amount?.amount ?? '0')
  } catch {}
}

async function fetchVesting() {
  const vestAddr = asset.value?.vestingAddr
  if (!vestAddr) { unvested.value = 0n; vestingOrig.value = 0n; return }
  try {
    const d   = await sfetch(`${API}/cosmos/auth/v1beta1/accounts/${vestAddr}`)
    const acc = d.account ?? {}
    const bva = acc.base_vesting_account ?? {}
    vestingOrig.value     = BigInt(bva.original_vesting?.[0]?.amount ?? '0')
    vestingStartSec.value = Number(acc.start_time ?? '0')
    vestingEndSec.value   = Number(bva.end_time   ?? '0')
    recomputeUnvested()
  } catch {}
}

async function fetchHolders() {
  try {
    const d = await sfetch(`${API}/cosmos/bank/v1beta1/denom_owners/${denom.value}?pagination.limit=200`)
    const raw: any[] = d.denom_owners ?? []
    const sorted = [...raw].sort(
      (a, b) => (BigInt(b.balance.amount) > BigInt(a.balance.amount) ? 1 : -1)
    )
    holders.value = sorted.map((o, i) => ({
      rank: i + 1,
      address: o.address,
      balance: BigInt(o.balance.amount),
    }))
    connected.value = true
  } catch { connected.value = false }
}

async function fetchAllTxs() {
  try {
    const q = encodeURIComponent('tx.height>=1')
    const d = await sfetch(
      `${API}/cosmos/tx/v1beta1/txs?query=${q}&order_by=ORDER_BY_DESC&pagination.limit=200`
    )
    const txrs: any[] = d.tx_responses ?? []
    const txs:  any[] = d.txs          ?? []
    allTxs.value = txrs.map((txr, i) => parseTxRow(txr, txs[i]))
    connected.value = true
  } catch { connected.value = false }
}

// ── Polling ────────────────────────────────────────────────────────────────────
let fastTimer: ReturnType<typeof setInterval>
let slowTimer: ReturnType<typeof setInterval>
let vestTimer: ReturnType<typeof setInterval>

onMounted(async () => {
  await loadIbcInfo() // must resolve first: price calc needs the real decimals
  await Promise.all([
    fetchSupply(), fetchVesting(), fetchHolders(), fetchAllTxs(), loadMetadata(),
    loadPrice(), loadImpliedAtomPrice(),
  ])
  fastTimer = setInterval(fetchAllTxs, 10000)
  slowTimer = setInterval(async () => {
    await Promise.all([fetchSupply(), fetchVesting(), fetchHolders()])
  }, 30000)
  vestTimer = setInterval(recomputeUnvested, 60000)
})

onUnmounted(() => {
  clearInterval(fastTimer)
  clearInterval(slowTimer)
  clearInterval(vestTimer)
})
</script>

<template>
  <div class="pg" :class="{ 'theme-light': isLight }">

    <!-- ── Navbar ──────────────────────────────────────────────────────────── -->
    <nav class="navbar">
      <div class="nav-inner">
        <a href="/" class="brand">
          <img src="/logos/infiniteledgers.svg" alt="INF" class="brand-logo" />
          <span class="brand-name">Infinite Ledgers</span>
        </a>
        <div class="search-wrap">
          <InfSearchBar :chain="CHAIN" />
        </div>
        <div class="nav-right">
          <ThemeToggle />
          <RouterLink to="/"              class="nav-btn">Home</RouterLink>
          <RouterLink :to="`/${CHAIN}`"  class="nav-btn">Explorer →</RouterLink>
        </div>
      </div>
    </nav>

    <!-- ── Token header ────────────────────────────────────────────────────── -->
    <div class="token-header">
      <div class="th-inner">
        <div class="th-title-row">
          <img v-if="logo" :src="logo" :alt="symbol" class="tok-logo" />
          <div v-else class="tok-logo tok-logo-generic">{{ symbol[0] }}</div>
          <div>
            <h1 class="tok-name">{{ symbol }}</h1>
            <div class="tok-sub">
              {{ asset?.name ?? (isIbc ? 'IBC-bridged token' : 'Token') }} ·
              <span class="mono" :title="denom">{{ isIbc && denom.length > 28 ? denom.slice(0, 18) + '…' + denom.slice(-6) : denom }}</span>
              <span v-if="isIbc && ibcPath" class="mono" style="color:#8E8E93;"> · via {{ ibcPath }}</span>
            </div>
          </div>
          <div class="tok-badges">
            <span v-if="isNativeDenom" class="badge-green">Native</span>
            <span v-else-if="isIbc" class="badge-blue">IBC</span>
            <span v-else class="badge-gold">Tokenfactory</span>
            <span class="badge-gold">Mainnet</span>
          </div>
        </div>
      </div>
    </div>

    <!-- ── Main content ────────────────────────────────────────────────────── -->
    <div class="content">

      <!-- Row 1: Market overview card + Activity chart card -->
      <div class="two-col">

        <!-- Market Overview -->
        <div class="card">
          <h3 class="ctitle" style="margin-bottom:18px;">Market Overview</h3>

          <div class="mkt-grid">
            <div class="mkt-cell">
              <div class="slabel">{{ isNativeDenom ? 'Price' : 'Price (in INF)' }}</div>
              <template v-if="isNativeDenom">
                <div v-if="impliedAtomPrice !== null" class="mkt-val" style="font-size:16px;">
                  ≈ {{ fmtPriceValue(impliedAtomPrice) }} {{ impliedAtomSymbol }}
                </div>
                <div v-else class="no-data">No market data</div>
                <div class="no-data-note">
                  {{ impliedAtomPrice !== null ? `implied via the minf/${impliedAtomSymbol} AMM pool — not a direct feed` : 'No USD or external price feed exists on this chain' }}
                </div>
              </template>
              <template v-else>
                <div v-if="priceLoading || (isIbc && !ibcResolved)" class="no-data">Loading…</div>
                <div v-else-if="priceInInf !== null" class="mkt-val" style="font-size:16px;">
                  {{ fmtPriceValue(priceInInf) }} INF
                </div>
                <div v-else class="no-data">No market data</div>
                <div class="no-data-note">{{ priceInInf !== null ? 'via the on-chain AMM pool' : `${symbol} has no AMM pool against minf` }}</div>
              </template>
            </div>
            <div class="mkt-cell">
              <div class="slabel">Market Cap</div>
              <div class="no-data">No market data</div>
              <div class="no-data-note">Requires a market price</div>
            </div>
            <div class="mkt-cell">
              <div class="slabel">Current Supply</div>
              <div class="mkt-val">{{ fmtAmt(totalSupply) }}</div>
              <div class="mkt-val-sub">{{ asset?.maxSupply ? `${symbol} · ${asset.maxSupply} fixed` : symbol }}</div>
            </div>
            <div class="mkt-cell">
              <div class="slabel">Holders</div>
              <div class="mkt-val">{{ holders.length > 0 ? holders.length.toLocaleString() : '—' }}</div>
              <div class="mkt-val-sub">unique addresses</div>
            </div>
          </div>

          <div class="divider"></div>

          <div class="mkt-grid" style="grid-template-columns:1fr 1fr 1fr;">
            <div class="mkt-cell">
              <div class="slabel">24h Change</div>
              <div class="no-data-sm">—</div>
            </div>
            <div class="mkt-cell">
              <div class="slabel">24h Volume</div>
              <div class="no-data-sm">—</div>
            </div>
            <div class="mkt-cell">
              <div class="slabel">FDV</div>
              <div class="no-data-sm">—</div>
            </div>
          </div>

          <div class="divider"></div>

          <!-- Supply split -->
          <div class="slabel" style="margin-bottom:6px;">Supply Split</div>
          <div class="bar-track">
            <div class="bar-fill" :style="`width:${totalSupply > 0n ? Number(circulating * 10000n / totalSupply)/100 : 100}%`"></div>
          </div>
          <div class="legend-row">
            <span class="leg-dot leg-circ"></span>
            <span class="slabel">Circulating</span>
            <span class="leg-val">{{ fmtAmt(circulating) }} {{ symbol }}</span>
            <template v-if="asset?.vestingAddr && unvested > 0n">
              <span class="leg-dot leg-lock" style="margin-left:8px;"></span>
              <span class="slabel">Locked</span>
              <span class="leg-val">{{ fmtAmt(unvested) }} {{ symbol }}</span>
            </template>
          </div>
          <div v-if="asset?.vestingAddr && asset?.vestingNote" style="font-size:11px;color:#8E8E93;margin-top:4px;">
            {{ asset.vestingNote }}
          </div>
        </div><!-- /market overview -->

        <!-- Transaction Activity chart (real) instead of price chart -->
        <div class="card">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
            <h3 class="ctitle">Transaction Activity</h3>
            <span style="font-size:11px;color:#8E8E93;">Last 14 days</span>
          </div>
          <div style="font-size:11px;color:#8E8E93;margin-bottom:16px;">
            Price chart unavailable — no market exists for {{ symbol }}.
            Showing on-chain transaction count instead.
          </div>

          <!-- SVG bar chart: 14-day daily tx count -->
          <div style="position:relative;">
            <svg viewBox="0 0 420 80" preserveAspectRatio="none" style="width:100%;height:80px;overflow:visible;">
              <!-- Grid lines -->
              <line x1="0" y1="60" x2="420" y2="60" stroke="#2C2C2E" stroke-width="1"/>
              <line x1="0" y1="35" x2="420" y2="35" stroke="#2C2C2E" stroke-width="1" stroke-dasharray="3,3"/>

              <!-- Bars -->
              <g v-for="(bar, i) in chartBars" :key="i">
                <rect
                  :x="bar.x" :y="bar.h > 0 ? bar.y : 59"
                  :width="bar.w" :height="bar.h > 0 ? bar.h : 1"
                  :fill="bar.count > 0 ? '#00C805' : '#2C2C2E'"
                  rx="2"
                />
                <!-- Label on every 3rd bar to avoid crowding -->
                <text v-if="i % 2 === 0 || i === 13"
                  :x="bar.lx" y="76"
                  text-anchor="middle"
                  font-size="7.5"
                  fill="#8E8E93">{{ bar.label }}</text>
              </g>

              <!-- No activity message -->
              <text v-if="allTxs.length === 0"
                x="210" y="35"
                text-anchor="middle"
                font-size="11"
                fill="#8E8E93">No transaction activity yet</text>
            </svg>
          </div>

          <!-- Peak info -->
          <div v-if="allTxs.length > 0" style="display:flex;justify-content:space-between;margin-top:6px;font-size:11px;color:#8E8E93;">
            <span>Total txs: <span class="chart-stat-val">{{ allTxs.length.toLocaleString() }}</span></span>
            <span>Peak day: <span class="chart-stat-val">{{ Math.max(...chartDays.map(d=>d.count)) }} txs</span></span>
          </div>
        </div><!-- /chart card -->

      </div><!-- /two-col -->

      <!-- ── Token Info: creator + metadata (tokenfactory creator-managed) ──── -->
      <div class="card">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
          <h3 class="ctitle">Token Info</h3>
          <button v-if="editState === 'idle'" class="page-btn" @click="openEditFlow">Edit</button>
        </div>

        <!-- Creator -->
        <div class="slabel" style="margin-bottom:4px;">Creator</div>
        <div v-if="isNativeDenom" class="no-data-sm" style="margin-bottom:14px;">
          Native token — no tokenfactory creator
        </div>
        <div v-else-if="creatorAddress" class="addr-cell" style="margin-bottom:14px;">
          <RouterLink :to="`/${CHAIN}/account/${creatorAddress}`" class="addr-link mono" :title="creatorAddress">
            {{ truncAddr(creatorAddress) }}
          </RouterLink>
          <button
            @click="copyAddr(creatorAddress)"
            style="background:none;border:none;cursor:pointer;padding:0 0 0 6px;color:#8E8E93;vertical-align:middle;"
            :title="copiedAddr === creatorAddress ? 'Copied!' : 'Copy'"
          >
            <span v-if="copiedAddr === creatorAddress" style="color:#00C805;font-size:12px;">✓</span>
            <svg v-else width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          </button>
        </div>
        <div v-else-if="isIbc" class="no-data-sm" style="margin-bottom:14px;">
          IBC-bridged token{{ ibcPath ? ` (${ibcPath})` : '' }} — no tokenfactory creator
        </div>
        <div v-else class="no-data-sm" style="margin-bottom:14px;">Unrecognized denom format</div>

        <div class="divider"></div>

        <!-- Metadata display (hidden once the edit form is open) -->
        <template v-if="editState !== 'editing' && editState !== 'submitting'">
          <div v-if="!metadataLoaded" class="no-data-sm">Loading metadata…</div>
          <div v-else-if="!metadata" class="empty" style="padding:16px;">
            No metadata has been set for this token yet.
          </div>
          <div v-else class="meta-grid">
            <img v-if="metadata.logo_url" :src="metadata.logo_url" class="meta-logo" alt="" />
            <div style="flex:1;min-width:0;">
              <p v-if="metadata.description" style="font-size:13px;color:#ccc;margin:0 0 10px;">
                {{ metadata.description }}
              </p>
              <div style="display:flex;gap:10px;flex-wrap:wrap;font-size:12px;">
                <a v-if="metadata.website" :href="metadata.website" target="_blank" rel="noopener noreferrer" class="meta-link">🌐 Website</a>
                <a v-if="metadata.twitter" :href="metadata.twitter" target="_blank" rel="noopener noreferrer" class="meta-link">🐦 Twitter</a>
                <a v-if="metadata.discord" :href="metadata.discord" target="_blank" rel="noopener noreferrer" class="meta-link">💬 Discord</a>
              </div>
            </div>
          </div>
        </template>

        <!-- Wallet picker (multiple wallets installed) -->
        <div v-if="editState === 'choosing-wallet'" style="margin-top:14px;">
          <div class="slabel" style="margin-bottom:8px;">Choose a wallet</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button v-for="w in availableWallets" :key="w.id" class="page-btn" @click="startConnect(w.id)">{{ w.name }}</button>
          </div>
          <button class="meta-link" style="margin-top:10px;background:none;border:none;cursor:pointer;padding:0;" @click="cancelEdit">Cancel</button>
        </div>

        <div v-if="editState === 'connecting'" class="no-data-sm" style="margin-top:14px;">Connecting wallet…</div>

        <div v-if="editState === 'no-wallet'" class="status-box" style="margin-top:14px;">
          No compatible wallet found — install
          <a href="https://www.keplr.app" target="_blank" rel="noopener noreferrer">Keplr</a>,
          <a href="https://www.leapwallet.io" target="_blank" rel="noopener noreferrer">Leap</a>, or
          <a href="https://www.cosmostation.io/wallet" target="_blank" rel="noopener noreferrer">Cosmostation</a>.
          <div><button class="page-btn" style="margin-top:8px;" @click="cancelEdit">Close</button></div>
        </div>

        <div v-if="editState === 'not-creator'" class="status-box" style="margin-top:14px;">
          Connected as <span class="mono">{{ truncAddr(connectedAddress || '') }}</span> via {{ connectedWalletName }}.
          Only the token creator can edit this.
          <div><button class="page-btn" style="margin-top:8px;" @click="cancelEdit">Close</button></div>
        </div>

        <!-- Edit form -->
        <form v-if="editState === 'editing' || editState === 'submitting'" @submit.prevent="submitMetadata" style="margin-top:14px;">
          <div class="edit-field">
            <label class="slabel">Description</label>
            <textarea v-model="form.description" rows="2" maxlength="280" class="edit-input"></textarea>
          </div>
          <div class="edit-field">
            <label class="slabel">Logo URL</label>
            <input v-model="form.logo_url" type="url" class="edit-input" placeholder="https://…" />
          </div>
          <div class="edit-field">
            <label class="slabel">Website</label>
            <input v-model="form.website" type="url" class="edit-input" placeholder="https://…" />
          </div>
          <div class="edit-field">
            <label class="slabel">Twitter</label>
            <input v-model="form.twitter" type="url" class="edit-input" placeholder="https://twitter.com/…" />
          </div>
          <div class="edit-field">
            <label class="slabel">Discord</label>
            <input v-model="form.discord" type="url" class="edit-input" placeholder="https://discord.gg/…" />
          </div>
          <div v-if="editError" class="status-box status-error" style="margin-bottom:10px;">{{ editError }}</div>
          <div style="display:flex;gap:8px;">
            <button type="submit" class="page-btn" :disabled="editState === 'submitting'">
              {{ editState === 'submitting' ? 'Submitting…' : 'Save' }}
            </button>
            <button type="button" class="page-btn" :disabled="editState === 'submitting'" @click="cancelEdit">Cancel</button>
          </div>
        </form>

        <div v-if="editState === 'success'" class="status-box status-success" style="margin-top:14px;">
          Metadata updated.
          <div><button class="page-btn" style="margin-top:8px;" @click="cancelEdit">Close</button></div>
        </div>

        <div v-if="editState === 'error'" class="status-box status-error" style="margin-top:14px;">
          {{ editError }}
          <div><button class="page-btn" style="margin-top:8px;" @click="cancelEdit">Close</button></div>
        </div>
      </div><!-- /token info card -->

      <!-- ── Tabs ──────────────────────────────────────────────────────────── -->
      <div class="card tab-card">

        <!-- Tab bar -->
        <div class="tab-bar">
          <button class="tab-btn" :class="activeTab === 'transfers'  ? 'tab-active' : ''" @click="activeTab='transfers';txPage=0">
            Transfers <span class="tab-count">{{ allTxs.filter(t => t.msgType === 'Send').length || allTxs.length }}</span>
          </button>
          <button class="tab-btn" :class="activeTab === 'activities' ? 'tab-active' : ''" @click="activeTab='activities';txPage=0">
            Activities <span class="tab-count">{{ allTxs.length }}</span>
          </button>
          <button class="tab-btn" :class="activeTab === 'holders'    ? 'tab-active' : ''" @click="activeTab='holders';holderPage=0">
            Holders <span class="tab-count">{{ holders.length }}</span>
          </button>
        </div>

        <!-- ── Transfers tab ────────────────────────────────────────────────── -->
        <div v-if="activeTab === 'transfers'">

          <div v-if="!allTxs.length" class="empty">
            No transfers yet — this feed will populate once token activity begins
          </div>
          <div v-else>
            <div class="tx-head">
              <span>Signature</span>
              <span>Time</span>
              <span>Action</span>
              <span>From</span>
              <span>To</span>
              <span>Amount</span>
              <span></span>
            </div>
            <div v-for="tx in txPageSlice" :key="tx.hash" class="tx-row">
              <span class="tx-hash-wrap">
                <RouterLink :to="`/${CHAIN}/tx/${tx.hash}`" class="hash-link" :title="tx.hash">
                  {{ truncHash(tx.hash) }}
                </RouterLink>
              </span>
              <span class="age">{{ relTime(tx.time) }}</span>
              <span>
                <span class="pill"
                  :style="`background:${msgPill(tx.msgType).color}1a;color:${msgPill(tx.msgType).color};border:1px solid ${msgPill(tx.msgType).color}40`">
                  {{ msgPill(tx.msgType).label }}
                </span>
              </span>
              <span class="addr-cell">
                <RouterLink v-if="tx.from" :to="`/${CHAIN}/account/${tx.from}`" class="addr-link" :title="tx.from">
                  {{ truncAddr(tx.from) }}
                </RouterLink>
                <span v-else class="muted">—</span>
              </span>
              <span class="addr-cell">
                <RouterLink v-if="tx.to" :to="`/${CHAIN}/account/${tx.to}`" class="addr-link" :title="tx.to">
                  {{ truncAddr(tx.to) }}
                </RouterLink>
                <span v-else class="muted">—</span>
              </span>
              <span class="amount-cell">{{ tx.amount }}</span>
              <span :style="`font-size:13px;text-align:right;color:${tx.success ? '#00C805' : '#FF5000'}`">
                {{ tx.success ? '✓' : '✗' }}
              </span>
            </div>

            <!-- Pagination -->
            <div v-if="txPageCount > 1" class="pagination">
              <button class="page-btn" :disabled="txPage === 0" @click="txPage--">← Prev</button>
              <span class="page-info">{{ txPage + 1 }} / {{ txPageCount }}</span>
              <button class="page-btn" :disabled="txPage >= txPageCount - 1" @click="txPage++">Next →</button>
            </div>
          </div>
        </div><!-- /transfers -->

        <!-- ── Activities tab ───────────────────────────────────────────────── -->
        <div v-if="activeTab === 'activities'">
          <!-- Activities = all message types. On this chain, all txs are MsgSend,
               so this tab shows the same data as Transfers. If other message types
               appear (delegate, vote, etc.) they will show here but not in Transfers. -->
          <div style="font-size:11px;color:#8E8E93;padding:6px 0 10px;border-bottom:1px solid #2C2C2E;margin-bottom:10px;">
            All on-chain message types · Currently identical to Transfers (all activity is MsgSend)
          </div>

          <div v-if="!allTxs.length" class="empty">No activity yet</div>
          <div v-else>
            <div class="tx-head">
              <span>Signature</span>
              <span>Time</span>
              <span>Action</span>
              <span>From</span>
              <span>To</span>
              <span>Amount</span>
              <span></span>
            </div>
            <div v-for="tx in txPageSlice" :key="tx.hash" class="tx-row">
              <span class="tx-hash-wrap">
                <RouterLink :to="`/${CHAIN}/tx/${tx.hash}`" class="hash-link" :title="tx.hash">
                  {{ truncHash(tx.hash) }}
                </RouterLink>
              </span>
              <span class="age">{{ relTime(tx.time) }}</span>
              <span>
                <span class="pill"
                  :style="`background:${msgPill(tx.msgType).color}1a;color:${msgPill(tx.msgType).color};border:1px solid ${msgPill(tx.msgType).color}40`">
                  {{ msgPill(tx.msgType).label }}
                </span>
              </span>
              <span class="addr-cell">
                <RouterLink v-if="tx.from" :to="`/${CHAIN}/account/${tx.from}`" class="addr-link" :title="tx.from">
                  {{ truncAddr(tx.from) }}
                </RouterLink>
                <span v-else class="muted">—</span>
              </span>
              <span class="addr-cell">
                <RouterLink v-if="tx.to" :to="`/${CHAIN}/account/${tx.to}`" class="addr-link" :title="tx.to">
                  {{ truncAddr(tx.to) }}
                </RouterLink>
                <span v-else class="muted">—</span>
              </span>
              <span class="amount-cell">{{ tx.amount }}</span>
              <span :style="`font-size:13px;text-align:right;color:${tx.success ? '#00C805' : '#FF5000'}`">
                {{ tx.success ? '✓' : '✗' }}
              </span>
            </div>

            <div v-if="txPageCount > 1" class="pagination">
              <button class="page-btn" :disabled="txPage === 0" @click="txPage--">← Prev</button>
              <span class="page-info">{{ txPage + 1 }} / {{ txPageCount }}</span>
              <button class="page-btn" :disabled="txPage >= txPageCount - 1" @click="txPage++">Next →</button>
            </div>
          </div>
        </div><!-- /activities -->

        <!-- ── Holders tab ─────────────────────────────────────────────────── -->
        <div v-if="activeTab === 'holders'">
          <div v-if="!holders.length" class="empty">Loading holders…</div>
          <div v-else>
            <div class="h-head">
              <span>#</span>
              <span>Address</span>
              <span>Balance</span>
              <span style="text-align:right;">% Supply</span>
            </div>
            <div v-for="h in holderPageSlice" :key="h.address" class="h-row">
              <span class="muted mono" style="font-size:13px;">{{ h.rank }}</span>
              <span class="addr-cell">
                <RouterLink :to="`/${CHAIN}/account/${h.address}`" class="addr-link mono" :title="h.address">
                  {{ truncAddr(h.address) }}
                </RouterLink>
                <button @click="copyAddr(h.address)"
                  style="background:none;border:none;cursor:pointer;padding:0 0 0 6px;color:#8E8E93;vertical-align:middle;"
                  :title="copiedAddr === h.address ? 'Copied!' : 'Copy'">
                  <span v-if="copiedAddr === h.address" style="color:#00C805;font-size:12px;">✓</span>
                  <svg v-else width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                  </svg>
                </button>
              </span>
              <span class="h-balance">
                {{ fmtAmt(h.balance) }} {{ symbol }}
              </span>
              <span style="font-family:'SF Mono',monospace;font-size:13px;color:#8E8E93;text-align:right;">
                {{ totalSupply > 0n ? (Number(h.balance * 10000n / totalSupply) / 100).toFixed(3) + '%' : '—' }}
              </span>
            </div>

            <div v-if="holderPageCount > 1" class="pagination">
              <button class="page-btn" :disabled="holderPage === 0" @click="holderPage--">← Prev</button>
              <span class="page-info">{{ holderPage + 1 }} / {{ holderPageCount }}</span>
              <button class="page-btn" :disabled="holderPage >= holderPageCount - 1" @click="holderPage++">Next →</button>
            </div>
          </div>
        </div><!-- /holders -->

      </div><!-- /tab-card -->

    </div><!-- /content -->

    <AppFooter />

  </div>
</template>

<style>
@keyframes inf-pulse {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.35; }
}
</style>

<style scoped>
/* ── Page ────────────────────────────────────────────────────────────────────── */
.pg {
  min-height: 100vh;
  background: #000000;
  color: #FFFFFF;
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
}

/* ── Navbar ──────────────────────────────────────────────────────────────────── */
.navbar {
  background: rgba(0,0,0,0.97); border-bottom: 1px solid #2C2C2E;
  backdrop-filter: blur(8px); position: sticky; top: 0; z-index: 50;
}
.nav-inner {
  max-width: 1280px; margin: 0 auto; padding: 0 24px;
  height: 54px; display: flex; align-items: center; gap: 16px;
}
.brand { display: flex; align-items: center; gap: 10px; text-decoration: none; flex-shrink: 0; }
.brand-logo { width: 28px; height: 28px; border-radius: 50%; }
.brand-name { font-size: 15px; font-weight: 700; color: #FFFFFF; letter-spacing: -0.02em; }
.search-wrap { flex: 1; max-width: 420px; }
.nav-right { display: flex; align-items: center; gap: 8px; margin-left: auto; flex-shrink: 0; }
.nav-btn { font-size: 12px; color: #8E8E93; border: 1px solid #2C2C2E; border-radius: 4px; padding: 4px 10px; text-decoration: none; transition: border-color .15s, color .15s; }
.nav-btn:hover { color: #00C805; border-color: rgba(0,200,5,0.4); }

/* ── Token header ────────────────────────────────────────────────────────────── */
.token-header {
  border-bottom: 1px solid #2C2C2E;
  background: radial-gradient(ellipse 70% 80% at 50% -20%, rgba(0,200,5,0.10) 0%, transparent 60%), #000000;
  padding: 28px 0 20px;
}
.th-inner { max-width: 1280px; margin: 0 auto; padding: 0 24px; }
.th-title-row { display: flex; align-items: center; gap: 16px; }
.tok-logo { width: 48px; height: 48px; border-radius: 50%; border: 1px solid #2C2C2E; }
.tok-logo-generic { display:flex;align-items:center;justify-content:center;background:#2C2C2E;color:#00C805;font-size:18px;font-weight:700;flex-shrink:0; }
.tok-name { font-size: 28px; font-weight: 800; color: #FFFFFF; margin: 0; letter-spacing: -0.02em; }
.tok-sub { font-size: 13px; color: #8E8E93; margin-top: 2px; }
.mono { font-family: 'SF Mono', monospace; font-size: 12px; color: #8E8E93; }
.tok-badges { display: flex; gap: 6px; margin-left: auto; }
.badge-green { font-size: 11px; font-weight: 600; color: #00C805; background: rgba(0,200,5,0.10); border: 1px solid rgba(0,200,5,0.3); border-radius: 4px; padding: 2px 8px; }
.badge-gold  { font-size: 11px; font-weight: 600; color: #00C805; background: rgba(0,200,5,0.10); border: 1px solid rgba(0,200,5,0.3); border-radius: 4px; padding: 2px 8px; }
.badge-blue  { font-size: 11px; font-weight: 600; color: #7dd3fc; background: rgba(125,211,252,0.10); border: 1px solid rgba(125,211,252,0.3); border-radius: 4px; padding: 2px 8px; }

/* ── Content ─────────────────────────────────────────────────────────────────── */
.content { max-width: 1280px; margin: 0 auto; padding: 22px 24px; display: flex; flex-direction: column; gap: 18px; }
.two-col  { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }

/* ── Card ────────────────────────────────────────────────────────────────────── */
.card {
  background: #1C1C1E; border: 1px solid #2C2C2E; border-radius: 10px;
  padding: 20px 24px;
}
.ctitle { font-size: 14px; font-weight: 700; color: #FFFFFF; margin: 0; }
.slabel { font-size: 11px; color: #8E8E93; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 3px; }
.divider { height: 1px; background: #2C2C2E; margin: 14px 0; }

/* ── Market grid ─────────────────────────────────────────────────────────────── */
.mkt-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.mkt-cell { }
.mkt-val { font-size: 20px; font-weight: 700; color: #FFFFFF; }
.mkt-val-sub { font-size: 11px; color: #8E8E93; margin-top: 2px; }
.no-data { font-size: 15px; color: #8E8E93; font-style: italic; }
.no-data-note { font-size: 11px; color: #8E8E93; margin-top: 2px; }
.no-data-sm { font-size: 13px; color: #8E8E93; font-style: italic; }

/* Token Info: metadata + edit flow */
.meta-grid { display: flex; gap: 14px; align-items: flex-start; }
.meta-logo { width: 40px; height: 40px; border-radius: 50%; flex-shrink: 0; }
.meta-link { color: #00C805; text-decoration: none; }
.meta-link:hover { text-decoration: underline; }
.status-box {
  font-size: 12px; color: #8E8E93; background: #1C1C1E; border: 1px solid #2C2C2E;
  border-radius: 8px; padding: 12px 14px; line-height: 1.6;
}
.status-box a { color: #00C805; text-decoration: none; }
.status-box a:hover { text-decoration: underline; }
.status-error { border-color: rgba(255,80,0,0.35); color: #FF5000; }
.status-success { border-color: rgba(0,200,5,0.35); color: #00C805; }
.edit-field { margin-bottom: 10px; }
.edit-field .slabel { margin-bottom: 4px; }
.edit-input {
  width: 100%; background: #000000; border: 1px solid #2C2C2E; border-radius: 6px;
  padding: 8px 10px; font-size: 13px; color: #FFFFFF; font-family: inherit;
}
.edit-input:focus { outline: none; border-color: #00C805; }

/* Supply bar */
.bar-track { height: 7px; background: rgba(0,200,5,0.08); border: 1px solid rgba(0,200,5,0.12); border-radius: 4px; overflow: hidden; }
.bar-fill  { height: 100%; background: linear-gradient(90deg, #007A03, #00C805); border-radius: 4px; transition: width .6s; }
.legend-row { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; font-size: 11px; margin-top: 7px; }
.leg-dot { width: 8px; height: 8px; border-radius: 2px; flex-shrink: 0; }
.leg-circ { background: #00C805; }
.leg-lock { background: rgba(0,200,5,0.12); border: 1px solid rgba(0,200,5,0.35); }
.leg-val { color: #8E8E93; font-weight: 500; margin-right: 6px; }

/* ── Tabs ────────────────────────────────────────────────────────────────────── */
.tab-card { padding: 0; }
.tab-bar {
  display: flex; gap: 0;
  border-bottom: 1px solid #2C2C2E;
  padding: 0 24px;
  overflow-x: auto;
}
.tab-btn {
  background: none; border: none; cursor: pointer;
  padding: 14px 18px;
  font-size: 13px; font-weight: 500; color: #8E8E93;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  white-space: nowrap;
  transition: color .15s, border-color .15s;
}
.tab-btn:hover { color: #FFFFFF; }
.tab-active { color: #00C805 !important; border-bottom-color: #00C805 !important; }
.tab-count {
  display: inline-block; margin-left: 5px;
  font-size: 10px; font-weight: 600;
  background: #2C2C2E; color: #8E8E93;
  border-radius: 10px; padding: 1px 6px;
}

/* Tab content padding */
.tab-card > div[v-if] { padding: 16px 24px 20px; }
/* fix: these are rendered divs, not real v-if runtime selectors */
.tab-card > div:not(.tab-bar) { padding: 16px 24px 20px; }

/* ── Tx table ────────────────────────────────────────────────────────────────── */
.tx-head, .tx-row {
  display: grid;
  grid-template-columns: 120px 80px 100px 130px 130px 1fr 20px;
  gap: 8px; align-items: center; padding: 7px 0;
}
.tx-head { border-bottom: 1px solid #2C2C2E; padding-bottom: 6px; }
.tx-head > span { font-size: 10px; color: #8E8E93; text-transform: uppercase; letter-spacing: 0.06em; }
.tx-row  { border-bottom: 1px solid #2C2C2E; }
.tx-row:last-child { border-bottom: none; }
.tx-row:hover { background: rgba(255,255,255,0.02); border-radius: 4px; }
.tx-hash-wrap { overflow: hidden; }
.hash-link { font-family: 'SF Mono', monospace; font-size: 12px; color: #00C805; text-decoration: none; }
.hash-link:hover { text-decoration: underline; }
.age  { font-size: 12px; color: #8E8E93; white-space: nowrap; }
.pill { font-size: 10px; font-weight: 600; border-radius: 4px; padding: 2px 7px; white-space: nowrap; }
.addr-cell { overflow: hidden; display: flex; align-items: center; }
.addr-link { font-family: 'SF Mono', monospace; font-size: 12px; color: #8E8E93; text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.addr-link:hover { color: #00C805; }
.amount-cell { font-family: 'SF Mono', monospace; font-size: 12px; color: #FFFFFF; white-space: nowrap; }
.muted { color: #8E8E93; }
.chart-stat-val { color: #FFFFFF; }
.h-balance { font-family: 'SF Mono', monospace; font-size: 13px; color: #FFFFFF; }

/* ── Holders table ───────────────────────────────────────────────────────────── */
.h-head, .h-row {
  display: grid;
  grid-template-columns: 48px 1fr 180px 100px;
  gap: 10px; align-items: center; padding: 8px 0;
}
.h-head { border-bottom: 1px solid #2C2C2E; padding-bottom: 6px; }
.h-head > span { font-size: 10px; color: #8E8E93; text-transform: uppercase; letter-spacing: 0.06em; }
.h-row { border-bottom: 1px solid #2C2C2E; }
.h-row:last-child { border-bottom: none; }
.h-row:hover { background: rgba(255,255,255,0.02); border-radius: 4px; }

/* ── Pagination ──────────────────────────────────────────────────────────────── */
.pagination { display: flex; align-items: center; justify-content: center; gap: 12px; padding-top: 16px; border-top: 1px solid #2C2C2E; margin-top: 8px; }
.page-btn { background: #2C2C2E; border: 1px solid #2C2C2E; border-radius: 6px; padding: 6px 14px; font-size: 12px; color: #8E8E93; cursor: pointer; transition: border-color .15s, color .15s; }
.page-btn:hover:not(:disabled) { border-color: #00C805; color: #00C805; }
.page-btn:disabled { opacity: 0.4; cursor: default; }
.page-info { font-size: 12px; color: #8E8E93; }

/* ── Empty state ─────────────────────────────────────────────────────────────── */
.empty { padding: 32px; text-align: center; color: #8E8E93; font-size: 13px; }

/* ── Responsive ──────────────────────────────────────────────────────────────── */
@media (max-width: 900px) {
  .two-col { grid-template-columns: 1fr; }
  .tx-head, .tx-row { grid-template-columns: 100px 70px 90px 1fr 1fr 20px; }
  .tx-head > :nth-child(4), .tx-row > :nth-child(4) { display: none; }
}
@media (max-width: 600px) {
  .tx-head, .tx-row { grid-template-columns: 100px 70px 90px 1fr 20px; }
  .tx-head > :nth-child(5), .tx-row > :nth-child(5) { display: none; }
  .th-title-row { flex-wrap: wrap; }
  .tok-badges { margin-left: 0; }
}

/* ── Light theme ─────────────────────────────────────────────────────────────── */
.pg.theme-light { background: #f5f7fa; color: #111111; }
.pg.theme-light .navbar { background: rgba(255,255,255,0.97); border-bottom-color: #e0e0e0; }
.pg.theme-light .brand-name { color: #111111; }
.pg.theme-light .token-header {
  background: radial-gradient(ellipse 70% 80% at 50% -20%, rgba(0,200,5,0.08) 0%, transparent 60%), #f5f7fa;
  border-bottom-color: #e0e0e0;
}
.pg.theme-light .tok-name { color: #111111; }
.pg.theme-light .tok-sub { color: #888; }
.pg.theme-light .mono { color: #888; }
.pg.theme-light .nav-btn { color: #666; border-color: #e0e0e0; }
.pg.theme-light .card { background: #ffffff; border-color: #e0e0e0; }
.pg.theme-light .ctitle { color: #111111; }
.pg.theme-light .slabel { color: #888; }
.pg.theme-light .divider { background: #ebebeb; }
.pg.theme-light .mkt-val { color: #111111; }
.pg.theme-light .mkt-val-sub { color: #888; }
.pg.theme-light .no-data { color: #aaa; }
.pg.theme-light .no-data-note { color: #bbb; }
.pg.theme-light .no-data-sm { color: #aaa; }
.pg.theme-light .leg-val { color: #444; }
.pg.theme-light .tab-bar { border-bottom-color: #e0e0e0; }
.pg.theme-light .tab-btn { color: #888; }
.pg.theme-light .tab-btn:hover { color: #111111; }
.pg.theme-light .tab-count { background: #f0f0f0; color: #888; }
.pg.theme-light .tx-head { border-bottom-color: #e0e0e0; }
.pg.theme-light .tx-head > span { color: #aaa; }
.pg.theme-light .tx-row { border-bottom-color: #f0f0f0; }
.pg.theme-light .tx-row:hover { background: rgba(0,0,0,0.025); }
.pg.theme-light .addr-link { color: #666; }
.pg.theme-light .amount-cell { color: #333; }
.pg.theme-light .age { color: #888; }
.pg.theme-light .empty { color: #999; }
.pg.theme-light .h-head { border-bottom-color: #e0e0e0; }
.pg.theme-light .h-head > span { color: #aaa; }
.pg.theme-light .h-row { border-bottom-color: #f0f0f0; }
.pg.theme-light .h-row:hover { background: rgba(0,0,0,0.025); }
.pg.theme-light .h-balance { color: #333; }
.pg.theme-light .muted { color: #999; }
.pg.theme-light .pagination { border-top-color: #e0e0e0; }
.pg.theme-light .page-btn { background: #f5f5f5; border-color: #e0e0e0; color: #666; }
.pg.theme-light .page-info { color: #888; }
.pg.theme-light .chart-stat-val { color: #333; }
</style>
