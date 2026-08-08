<route lang="yaml">
meta:
  layout: blank
</route>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import InfSearchBar from '@/components/inf/SearchBar.vue'
import ThemeToggle from '@/components/inf/ThemeToggle.vue'
import AppFooter from '@/components/inf/AppFooter.vue'
import { useBaseStore } from '@/stores'
import { fetchPool } from '@/config/ammContract'
import { fetchAtomUsdPrice } from '@/config/coingecko'

// ── Theme ──────────────────────────────────────────────────────────────────────
const baseStore = useBaseStore()
const isLight   = computed(() => baseStore.theme === 'light')

// ── Constants ──────────────────────────────────────────────────────────────────
const API  = 'https://api.infiniteledgers.com'
const CHAIN = 'infiniteledgers'
const DENOM = 'minf'
const BLOCKS_PER_ERA    = 25_246_080
const ERA_0_REWARD_MINF = 1_980_000   // minf per block in era 0
const TOTAL_SUPPLY_INF  = 400_000_000 // fixed max supply, for FDV

// Founder vesting account — ContinuousVestingAccount found on-chain at genesis
const VESTING_ADDR = 'inf14h3h0n645e0zln9gn004un47mdn9yfg0nswtyv'

// ATOM's IBC denom on this chain (transfer/channel-0/uatom), confirmed via
// denoms_metadata -- used to find the minf/ATOM pool for the derived price
const ATOM_IBC_DENOM = 'ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2'
const LOW_LIQUIDITY_ATOM = 10 // below this much ATOM in the pool, flag it as thin

// ── State ──────────────────────────────────────────────────────────────────────
const connected    = ref(false)
const reconnecting = ref(false)
const blockHeight  = ref(0)
const blockTimeIso = ref('')
const chainId      = ref('infiniteledgers-1')

// Supply (BigInt, in minf)
const totalSupplyMinf  = ref(0n)
const unvestedMinf     = ref(0n)

// Vesting account raw data (to recompute unvested as time passes)
const vestingOrigMinf  = ref(0n)
const vestingStartSec  = ref(0)
const vestingEndSec    = ref(0)

const validatorCount   = ref(0)
const bondedMinf       = ref(0n)
const jailedCount      = ref(0)

const allDenoms    = ref<{ denom: string; amount: string }[]>([])
const totalTxCount = ref<number | null>(null)

// minf/ATOM pool reserves (raw minimal units) + ATOM/USD, for derived INF price
const poolAtomReserve = ref<bigint | null>(null)
const poolInfReserve  = ref<bigint | null>(null)
const atomUsdPrice    = ref<number | null>(null)

interface RBlock { height: string; time: string; proposer: string; numTxs: number }
interface RTx    { hash: string; height: string; time: string; msgType: string; success: boolean }
const recentBlocks = ref<RBlock[]>([])
const recentTxs    = ref<RTx[]>([])

// ── Derived ────────────────────────────────────────────────────────────────────
// Circulating = total - unvested (founder's locked portion)
const circulatingMinf = computed(() =>
  totalSupplyMinf.value > unvestedMinf.value
    ? totalSupplyMinf.value - unvestedMinf.value
    : totalSupplyMinf.value
)

const circulatingPct = computed(() => {
  if (totalSupplyMinf.value === 0n) return 100
  return Number(circulatingMinf.value * 10000n / totalSupplyMinf.value) / 100
})

// INF/USD = (ATOM reserve / INF reserve, decimal-adjusted) × ATOM/USD.
// Both denoms are 6 decimals so the raw-unit ratio equals the display-unit ratio.
const infPriceUsd = computed(() => {
  if (!poolAtomReserve.value || !poolInfReserve.value || atomUsdPrice.value == null) return null
  const infInAtom = Number(poolAtomReserve.value) / Number(poolInfReserve.value)
  return infInAtom * atomUsdPrice.value
})

const fdvUsd = computed(() => (infPriceUsd.value != null ? infPriceUsd.value * TOTAL_SUPPLY_INF : null))

const poolAtomDepth  = computed(() => (poolAtomReserve.value != null ? Number(poolAtomReserve.value) / 1e6 : null))
const isLowLiquidity = computed(() => poolAtomDepth.value != null && poolAtomDepth.value < LOW_LIQUIDITY_ATOM)

const nonCircPct = computed(() => +(100 - circulatingPct.value).toFixed(2))

const currentEra  = computed(() => Math.floor(blockHeight.value / BLOCKS_PER_ERA))
const blockRewardMinf = computed(() => ERA_0_REWARD_MINF >>> currentEra.value)  // number, in minf

const avgBlockTimeSec = computed(() => {
  const bs = [...recentBlocks.value].sort((a, b) => Number(b.height) - Number(a.height))
  if (bs.length < 2) return null
  const diffs: number[] = []
  for (let i = 0; i < bs.length - 1; i++)
    diffs.push(Math.abs(new Date(bs[i].time).getTime() - new Date(bs[i+1].time).getTime()))
  return diffs.reduce((a, b) => a + b, 0) / diffs.length / 1000
})

const tps = computed(() => {
  const bs = [...recentBlocks.value].sort((a, b) => Number(b.height) - Number(a.height))
  if (bs.length < 2) return null
  const txCount = bs.slice(0, -1).reduce((s, b) => s + b.numTxs, 0)
  const spanMs  = Math.abs(new Date(bs[0].time).getTime() - new Date(bs[bs.length-1].time).getTime())
  if (spanMs < 1000) return null
  return txCount / (spanMs / 1000)
})

// ── Helpers ────────────────────────────────────────────────────────────────────
async function sfetch(url: string): Promise<any> {
  const ctrl = new AbortController()
  const t    = setTimeout(() => ctrl.abort(), 6000)
  try {
    const r = await fetch(url, { signal: ctrl.signal })
    clearTimeout(t)
    if (!r.ok) throw new Error(String(r.status))
    return r.json()
  } catch (e) { clearTimeout(t); throw e }
}

// Convert minf (BigInt) to INF string with optional fraction
function fmtINF(minf: bigint): string {
  const whole = minf / 1_000_000n
  const frac  = minf % 1_000_000n
  if (frac === 0n) return whole.toLocaleString()
  const fracStr = frac.toString().padStart(6, '0').replace(/0+$/, '')
  return `${whole.toLocaleString()}.${fracStr}`
}

// minf number → INF string (for blockReward which is a JS number)
function fmtRewardINF(minf: number): string {
  const whole = Math.floor(minf / 1_000_000)
  const frac  = minf % 1_000_000
  if (frac === 0) return whole.toLocaleString()
  return `${whole.toLocaleString()}.${frac.toString().padStart(6, '0').replace(/0+$/, '')}`
}

// Sub-cent prices need more decimals to not just show "$0.00"
function fmtUsdPrice(n: number): string {
  const decimals = n >= 1 ? 2 : n >= 0.01 ? 4 : 6
  return `$${n.toFixed(decimals)}`
}

function fmtUsdCompact(n: number): string {
  return `$${Math.round(n).toLocaleString()}`
}

function relTime(iso: string): string {
  if (!iso) return '—'
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (diff < 0)    return 'just now'
  if (diff < 60)   return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

function truncHash(h: string): string {
  if (!h || h.length < 14) return h
  return h.slice(0, 8) + '…' + h.slice(-6)
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
    'CreateValidator':             { label: 'Create Val.', color: '#e8a500' },
    'EditValidator':               { label: 'Edit Val.',   color: '#e8a500' },
    'WithdrawValidatorCommission': { label: 'Commission',  color: '#22c55e' },
  }
  return map[msgType] ?? { label: msgType || 'Unknown', color: '#6b7280' }
}

// Recompute unvested amount from vesting parameters + current time
function recomputeUnvested() {
  const ov  = vestingOrigMinf.value
  const st  = vestingStartSec.value
  const et  = vestingEndSec.value
  if (ov === 0n || et === 0) { unvestedMinf.value = 0n; return }
  const now = Math.floor(Date.now() / 1000)
  if (st === 0 || now <= st) {
    unvestedMinf.value = ov         // vesting not started → all locked
  } else if (now >= et) {
    unvestedMinf.value = 0n         // fully vested → nothing locked
  } else {
    const elapsed  = BigInt(now - st)
    const duration = BigInt(et - st)
    const vested   = ov * elapsed / duration
    unvestedMinf.value = ov - vested
  }
}

// ── Fetch functions ────────────────────────────────────────────────────────────
async function fetchStatus() {
  try {
    const d = await sfetch(`${API}/cosmos/base/tendermint/v1beta1/blocks/latest`)
    const hdr       = d.block?.header ?? {}
    blockHeight.value  = Number(hdr.height  ?? 0)
    blockTimeIso.value = hdr.time           ?? ''
    chainId.value      = hdr.chain_id       ?? 'infiniteledgers-1'
    connected.value    = true
    reconnecting.value = false
  } catch {
    connected.value    = false
    reconnecting.value = true
  }
}

async function fetchSupply() {
  try {
    const d = await sfetch(`${API}/cosmos/bank/v1beta1/supply?pagination.limit=50`)
    const supply: any[] = d.supply ?? []
    allDenoms.value = supply
    const inf = supply.find((x: any) => x.denom === DENOM)
    if (inf) totalSupplyMinf.value = BigInt(inf.amount)
  } catch {}
}

async function fetchVesting() {
  try {
    const d   = await sfetch(`${API}/cosmos/auth/v1beta1/accounts/${VESTING_ADDR}`)
    const acc = d.account ?? {}
    const bva = acc.base_vesting_account ?? {}
    vestingOrigMinf.value = BigInt(bva.original_vesting?.[0]?.amount ?? '0')
    vestingStartSec.value = Number(acc.start_time ?? '0')
    vestingEndSec.value   = Number(bva.end_time   ?? '0')
    recomputeUnvested()
  } catch {}
}

async function fetchValidators() {
  try {
    const [bonded, all] = await Promise.all([
      sfetch(`${API}/cosmos/staking/v1beta1/validators?status=BOND_STATUS_BONDED&pagination.limit=200`),
      sfetch(`${API}/cosmos/staking/v1beta1/validators?pagination.limit=200`),
    ])
    const bondedVals: any[] = bonded.validators ?? []
    const allVals: any[]    = all.validators    ?? []
    validatorCount.value = bondedVals.length
    bondedMinf.value     = bondedVals.reduce((a: bigint, v: any) => a + BigInt(v.tokens || 0), 0n)
    jailedCount.value    = allVals.filter((v: any) => v.jailed).length
  } catch {}
}

async function fetchRecentBlocks() {
  if (!blockHeight.value) return
  try {
    const h       = blockHeight.value
    const heights = Array.from({ length: 8 }, (_, i) => Math.max(1, h - i))
    const results = await Promise.allSettled(
      heights.map(n => sfetch(`${API}/cosmos/base/tendermint/v1beta1/blocks/${n}`))
    )
    recentBlocks.value = results
      .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled')
      .map(r => {
        const hdr = r.value.block?.header ?? {}
        const txs: string[] = r.value.block?.data?.txs ?? []
        return { height: hdr.height ?? '0', time: hdr.time ?? '', proposer: hdr.proposer_address ?? '', numTxs: txs.length }
      })
  } catch {}
}

async function fetchInfPrice() {
  const [pool, atomUsd] = await Promise.all([
    fetchPool(ATOM_IBC_DENOM, 'minf'),
    fetchAtomUsdPrice(),
  ])
  if (pool) {
    // match by denom rather than a/b position -- the contract's ordering
    // convention isn't part of its documented contract
    if (pool.denomB === 'minf') {
      poolAtomReserve.value = pool.reserveA
      poolInfReserve.value  = pool.reserveB
    } else if (pool.denomA === 'minf') {
      poolAtomReserve.value = pool.reserveB
      poolInfReserve.value  = pool.reserveA
    }
  }
  if (atomUsd != null) atomUsdPrice.value = atomUsd
}

async function fetchRecentTxs() {
  try {
    const q = encodeURIComponent('tx.height>=1')
    const d = await sfetch(
      `${API}/cosmos/tx/v1beta1/txs?query=${q}&order_by=ORDER_BY_DESC&pagination.limit=8&pagination.count_total=true`
    )
    const txrs: any[] = d.tx_responses ?? []
    const txs:  any[] = d.txs          ?? []
    const total = Number(d.pagination?.total ?? 0)
    if (total > 0) totalTxCount.value = total
    else if (txrs.length > 0) totalTxCount.value = txrs.length
    recentTxs.value = txrs.map((txr, i) => {
      const msgs: any[] = txs[i]?.body?.messages ?? []
      const typeUrl     = msgs[0]?.['@type'] ?? ''
      const msgType     = typeUrl.split('.').pop()?.replace(/^Msg/, '') ?? 'Unknown'
      return { hash: txr.txhash, height: txr.height, time: txr.timestamp, msgType, success: txr.code === 0 }
    })
  } catch {}
}

// ── Polling ────────────────────────────────────────────────────────────────────
let fastTimer: ReturnType<typeof setInterval>
let slowTimer: ReturnType<typeof setInterval>
let vestingTimer: ReturnType<typeof setInterval>

onMounted(async () => {
  await fetchStatus()
  await Promise.all([fetchSupply(), fetchVesting(), fetchValidators(), fetchRecentBlocks(), fetchRecentTxs(), fetchInfPrice()])

  fastTimer = setInterval(async () => {
    await fetchStatus()
    await Promise.all([fetchRecentBlocks(), fetchRecentTxs()])
  }, 5000)

  slowTimer = setInterval(async () => {
    await Promise.all([fetchSupply(), fetchVesting(), fetchValidators(), fetchInfPrice()])
  }, 30000)

  // recompute unvested every minute (changes linearly over decades, but stay accurate)
  vestingTimer = setInterval(recomputeUnvested, 60000)
})

onUnmounted(() => {
  clearInterval(fastTimer)
  clearInterval(slowTimer)
  clearInterval(vestingTimer)
})
</script>

<template>
  <div class="pg" :class="{ 'theme-light': isLight }">

    <!-- ── Reconnect banner ──────────────────────────────────────────────── -->
    <div v-if="reconnecting" class="reconnect-banner">
      <span style="width:7px;height:7px;border-radius:50%;background:#f87171;display:inline-block;animation:inf-pulse 1.4s ease-in-out infinite;flex-shrink:0;"></span>
      Reconnecting to {{ chainId }}… API may be temporarily unreachable.
    </div>

    <!-- ── Navbar ────────────────────────────────────────────────────────── -->
    <nav class="navbar">
      <div class="nav-inner">
        <a href="/" class="brand">
          <img src="/logos/infiniteledgers.svg" alt="INF" class="brand-logo" />
          <span class="brand-name">Infinite Ledgers</span>
        </a>
        <div class="nav-right">
          <span class="live-dot" :class="connected ? 'dot-ok' : 'dot-err'"></span>
          <span class="chain-id-label">{{ chainId }}</span>
          <ThemeToggle />
          <RouterLink :to="`/${CHAIN}`" class="explorer-btn">Explorer →</RouterLink>
        </div>
      </div>
    </nav>

    <!-- ── Hero ──────────────────────────────────────────────────────────── -->
    <section class="hero">
      <div class="hero-inner">
        <h1 class="hero-title">Infinite Ledgers Explorer</h1>
        <p class="hero-sub">Proof-of-Stake · Halving Emission · Genesis Aug 6 2026</p>
        <div class="hero-search-wrap">
          <InfSearchBar :chain="CHAIN" />
        </div>
        <!-- Ticker: honest chain facts — no fake trading pairs -->
        <div class="ticker">
          <span class="tick">⛓&nbsp;Chain: {{ chainId }}</span>
          <span class="tick-sep">·</span>
          <span class="tick">Era {{ currentEra }} · {{ fmtRewardINF(blockRewardMinf) }} INF / block</span>
          <span class="tick-sep">·</span>
          <span class="tick">Halving every {{ BLOCKS_PER_ERA.toLocaleString() }} blocks</span>
          <span class="tick-sep">·</span>
          <span class="tick">Next halving: block #{{ ((currentEra + 1) * BLOCKS_PER_ERA).toLocaleString() }}</span>
          <span class="tick-sep">·</span>
          <span class="tick">Vesting start: ~Aug 20 2026</span>
        </div>
      </div>
    </section>

    <!-- ── Main content ──────────────────────────────────────────────────── -->
    <div class="content">

      <!-- Row 1: Token card + Network card ──────────────────────────────── -->
      <div class="two-col">

        <!-- Token / supply card -->
        <div class="card">
          <RouterLink to="/token/minf" class="chead chead-link">
            <img src="/logos/infiniteledgers.svg" alt="INF" style="width:22px;height:22px;border-radius:50%;margin-right:8px;" />
            <span class="ctitle">INF Token</span>
            <span class="badge-native">Native</span>
          </RouterLink>

          <!-- Price — derived from the minf/ATOM AMM pool × ATOM/USD, shown honestly -->
          <div class="mkt-row">
            <div>
              <div class="slabel">Price</div>
              <div v-if="infPriceUsd != null" class="mkt-price">{{ fmtUsdPrice(infPriceUsd) }}</div>
              <div v-else class="no-data">No market data</div>
              <div v-if="isLowLiquidity" class="liq-warn">
                ⚠ Low liquidity ({{ poolAtomDepth?.toFixed(2) }} ATOM pool)
              </div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
              <div>
                <div class="slabel">24h Change</div>
                <div class="no-data-sm">—</div>
              </div>
              <div>
                <div class="slabel">24h Volume</div>
                <div class="no-data-sm">—</div>
              </div>
            </div>
          </div>

          <div class="divider"></div>

          <!-- Supply split -->
          <div class="slabel" style="margin-bottom:6px;">Total Supply</div>
          <div class="supply-total">{{ fmtINF(totalSupplyMinf) }} INF</div>

          <!-- Visual bar -->
          <div class="bar-track" style="margin-top:10px;margin-bottom:8px;">
            <div class="bar-fill" :style="`width:${circulatingPct.toFixed(2)}%`"></div>
          </div>
          <div class="legend-row">
            <span class="leg-dot leg-circ"></span>
            <span class="slabel">Circulating</span>
            <span class="leg-val">{{ fmtINF(circulatingMinf) }} INF&nbsp;({{ circulatingPct.toFixed(1) }}%)</span>
            <span class="leg-dot leg-lock" style="margin-left:10px;"></span>
            <span class="slabel">Locked</span>
            <span class="leg-val">{{ fmtINF(unvestedMinf) }} INF&nbsp;({{ nonCircPct }}%)</span>
          </div>
          <div style="font-size:11px;color:#444;margin-top:4px;">
            Locked = founder vesting · linear release Aug 2026 → 2046
          </div>

          <div class="divider"></div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">
            <div>
              <div class="slabel">Market Cap</div>
              <div class="no-data-sm">No market data</div>
            </div>
            <div>
              <div class="slabel">FDV</div>
              <div v-if="fdvUsd != null" class="mkt-fdv">{{ fmtUsdCompact(fdvUsd) }}</div>
              <div v-else class="no-data-sm">—</div>
            </div>
          </div>

          <div class="divider"></div>

          <!-- Other tokens section -->
          <div class="slabel" style="margin-bottom:8px;">Tokens on this chain</div>
          <div v-if="allDenoms.length <= 1" style="font-size:13px;color:#666;">
            1 native token (INF / minf) · No additional tokens issued
          </div>
          <div v-else>
            <div v-for="d in allDenoms.filter(d => d.denom !== DENOM)" :key="d.denom"
              class="denom-item">
              {{ d.denom }}: {{ d.amount }}
            </div>
          </div>

          <div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap;">
            <RouterLink to="/token/minf" class="token-detail-link">
              View INF token details →
            </RouterLink>
            <RouterLink to="/tokens" class="token-detail-link">
              View all tokens →
            </RouterLink>
          </div>
        </div><!-- /token card -->

        <!-- Network stats card -->
        <div class="card">
          <div class="chead" style="margin-bottom:18px;">
            <span class="ctitle">Network</span>
            <span :class="`live-badge ${connected ? 'lb-ok' : 'lb-err'}`">
              {{ connected ? 'LIVE' : 'OFFLINE' }}
            </span>
          </div>

          <div class="stat4">
            <div class="sitem">
              <div class="slabel">Block Height</div>
              <RouterLink :to="`/${CHAIN}/block/${blockHeight}`" class="sval-link">
                {{ blockHeight.toLocaleString() }}
              </RouterLink>
            </div>
            <div class="sitem">
              <div class="slabel">Block Time</div>
              <div class="sval">{{ avgBlockTimeSec != null ? avgBlockTimeSec.toFixed(2) + 's' : '—' }}</div>
            </div>
            <div class="sitem">
              <div class="slabel">TPS</div>
              <div class="sval">
                <span v-if="tps === null">—</span>
                <span v-else-if="tps === 0">0.00</span>
                <span v-else-if="tps < 0.01">&lt;&nbsp;0.01</span>
                <span v-else>{{ tps.toFixed(3) }}</span>
              </div>
            </div>
            <div class="sitem">
              <div class="slabel">Total Txs</div>
              <div class="sval">
                <span v-if="totalTxCount !== null">{{ totalTxCount.toLocaleString() }}</span>
                <span v-else-if="recentTxs.length > 0">≥ {{ recentTxs.length }}</span>
                <span v-else>0</span>
              </div>
            </div>
          </div>

          <div class="divider"></div>

          <div class="chead" style="margin-bottom:14px;"><span class="ctitle">Stake</span></div>
          <div class="stat4">
            <div class="sitem">
              <div class="slabel">Validators</div>
              <RouterLink :to="`/${CHAIN}/staking`" class="sval-link">{{ validatorCount }}</RouterLink>
            </div>
            <div class="sitem">
              <div class="slabel">Jailed</div>
              <div class="sval" :style="jailedCount > 0 ? 'color:#f87171' : ''">{{ jailedCount }}</div>
            </div>
            <div class="sitem">
              <div class="slabel">Total Stake</div>
              <div class="sval" style="font-size:15px;">{{ fmtINF(bondedMinf) }} INF</div>
            </div>
            <div class="sitem">
              <div class="slabel">Staked %</div>
              <div class="sval">
                {{ totalSupplyMinf > 0n ? (Number(bondedMinf * 10000n / totalSupplyMinf) / 100).toFixed(1) + '%' : '—' }}
              </div>
            </div>
          </div>

          <div class="divider"></div>

          <!-- Emission progress mini -->
          <div class="chead" style="margin-bottom:10px;"><span class="ctitle">Emission · Era {{ currentEra }}</span></div>
          <div style="font-size:12px;color:#888;margin-bottom:6px;">
            {{ fmtRewardINF(blockRewardMinf) }} INF/block →
            {{ fmtRewardINF(blockRewardMinf >>> 1) }} INF after next halving
          </div>
          <div class="bar-track">
            <div class="bar-fill"
              :style="`width:${((blockHeight % BLOCKS_PER_ERA) / BLOCKS_PER_ERA * 100).toFixed(3)}%`">
            </div>
          </div>
          <div class="era-labels">
            <span>Block {{ blockHeight.toLocaleString() }}</span>
            <span>Next halving: #{{ ((currentEra + 1) * BLOCKS_PER_ERA).toLocaleString() }}</span>
          </div>
        </div><!-- /network card -->

      </div><!-- /two-col -->

      <!-- ── Recent Transactions ──────────────────────────────────────────── -->
      <div class="card">
        <div class="card-section-head">
          <h3 class="section-label">Latest Transactions</h3>
          <RouterLink :to="`/${CHAIN}/tx`" class="view-all">View All →</RouterLink>
        </div>

        <div v-if="!recentTxs.length" class="empty">
          No transactions yet — feed will populate once activity begins
        </div>

        <div v-else>
          <div class="tx-head">
            <span>Signature</span>
            <span>Block</span>
            <span>Age</span>
            <span>Action</span>
            <span></span>
          </div>
          <div v-for="tx in recentTxs" :key="tx.hash" class="tx-row">
            <span class="tx-hash-wrap">
              <RouterLink :to="`/${CHAIN}/tx/${tx.hash}`" class="hash-link" :title="tx.hash">
                {{ truncHash(tx.hash) }}
              </RouterLink>
            </span>
            <span>
              <RouterLink :to="`/${CHAIN}/block/${tx.height}`" class="blk-link">
                #{{ Number(tx.height).toLocaleString() }}
              </RouterLink>
            </span>
            <span class="age">{{ relTime(tx.time) }}</span>
            <span>
              <span class="pill"
                :style="`background:${msgPill(tx.msgType).color}1a;color:${msgPill(tx.msgType).color};border:1px solid ${msgPill(tx.msgType).color}40`">
                {{ msgPill(tx.msgType).label }}
              </span>
            </span>
            <span :style="`font-size:14px;text-align:right;color:${tx.success ? '#4ade80' : '#f87171'}`">
              {{ tx.success ? '✓' : '✗' }}
            </span>
          </div>
        </div>
      </div><!-- /txs -->

      <!-- ── Recent Blocks ────────────────────────────────────────────────── -->
      <div class="card">
        <div class="card-section-head">
          <h3 class="section-label">Latest Blocks</h3>
          <RouterLink :to="`/${CHAIN}/block`" class="view-all">View All →</RouterLink>
        </div>

        <div v-if="!recentBlocks.length" class="empty">Fetching blocks…</div>

        <div v-else>
          <div class="blk-head">
            <span>Block</span>
            <span>Age</span>
            <span>Txs</span>
            <span>Proposer</span>
          </div>
          <div v-for="(bl, i) in [...recentBlocks].sort((a, b) => Number(b.height) - Number(a.height))"
            :key="bl.height"
            class="blk-row"
            :class="i % 2 === 1 ? 'blk-row-alt' : ''">
            <RouterLink :to="`/${CHAIN}/block/${bl.height}`" class="height-link">
              #{{ Number(bl.height).toLocaleString() }}
            </RouterLink>
            <span class="age">{{ relTime(bl.time) }}</span>
            <span :style="`font-family:monospace;font-size:12px;color:${bl.numTxs > 0 ? '#4ade80' : '#444'}`">
              {{ bl.numTxs }}
            </span>
            <span class="proposer-cell">
              {{ bl.proposer ? bl.proposer.slice(0, 10) + '…' : '—' }}
            </span>
          </div>
        </div>
      </div><!-- /blocks -->

    </div><!-- /content -->

    <AppFooter />

  </div><!-- /pg -->
</template>

<style>
@keyframes inf-pulse {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.35; }
}
</style>

<style scoped>
/* ── Page shell ─────────────────────────────────────────────────────────────── */
.pg {
  min-height: 100vh;
  background: #0d0d0d;
  color: #f0f0f0;
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
}

/* ── Reconnect banner ────────────────────────────────────────────────────────── */
.reconnect-banner {
  background: #160808; border-bottom: 1px solid #4a1515;
  padding: 7px 24px; font-size: 12px; color: #f87171;
  display: flex; align-items: center; gap: 8px;
}

/* ── Navbar ──────────────────────────────────────────────────────────────────── */
.navbar {
  background: rgba(13,13,13,0.97); border-bottom: 1px solid #1a1a1a;
  backdrop-filter: blur(8px); position: sticky; top: 0; z-index: 50;
}
.nav-inner {
  max-width: 1280px; margin: 0 auto; padding: 0 24px;
  height: 54px; display: flex; align-items: center; justify-content: space-between;
}
.brand { display: flex; align-items: center; gap: 10px; text-decoration: none; }
.brand-logo { width: 30px; height: 30px; border-radius: 50%; }
.brand-name { font-size: 16px; font-weight: 700; color: #f0f0f0; letter-spacing: -0.02em; }
.nav-right { display: flex; align-items: center; gap: 10px; }
.live-dot { width: 7px; height: 7px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
.dot-ok  { background: #4ade80; animation: inf-pulse 2.5s ease-in-out infinite; }
.dot-err { background: #f87171; }
.chain-id-label { font-size: 12px; color: #555; font-family: 'SF Mono', monospace; }
.explorer-btn {
  font-size: 12px; color: #e8a500;
  border: 1px solid rgba(232,165,0,0.3); border-radius: 4px;
  padding: 4px 10px; text-decoration: none; transition: border-color .15s;
}
.explorer-btn:hover { border-color: #e8a500; }

/* ── Hero ────────────────────────────────────────────────────────────────────── */
.hero {
  background:
    radial-gradient(ellipse 90% 70% at 50% -5%, rgba(232,165,0,0.14) 0%, transparent 65%),
    radial-gradient(ellipse 50% 50% at 85% 120%, rgba(232,165,0,0.05) 0%, transparent 60%),
    #0d0d0d;
  border-bottom: 1px solid #1e1e1e;
  padding: 52px 24px 36px;
}
.hero-inner    { max-width: 680px; margin: 0 auto; text-align: center; }
.hero-title    { font-size: 34px; font-weight: 800; color: #f0f0f0; letter-spacing: -0.03em; margin: 0 0 8px; }
.hero-sub      { font-size: 13px; color: #555; margin: 0 0 24px; }
.hero-search-wrap { margin-bottom: 20px; }

.ticker {
  display: flex; align-items: center; justify-content: center;
  flex-wrap: wrap; gap: 5px; font-size: 12px;
}
.tick     { color: #666; }
.tick-sep { color: #2d2d2d; }

/* ── Layout ──────────────────────────────────────────────────────────────────── */
.content  { max-width: 1280px; margin: 0 auto; padding: 24px 24px; display: flex; flex-direction: column; gap: 18px; }
.two-col  { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }

/* ── Card ────────────────────────────────────────────────────────────────────── */
.card {
  background: #141414; border: 1px solid #2d2d2d; border-radius: 10px;
  padding: 20px 24px;
}
.chead { display: flex; align-items: center; margin-bottom: 14px; }
.chead-link {
  text-decoration: none;
  border-radius: 6px;
  padding: 2px 6px;
  margin: -2px -6px;
  transition: background .15s;
  cursor: pointer;
}
.chead-link:hover { background: rgba(232,165,0,0.07); }
.chead-link:hover .ctitle { color: #e8a500; }
.pg.theme-light .chead-link:hover { background: rgba(232,165,0,0.08); }
.ctitle { font-size: 14px; font-weight: 700; color: #f0f0f0; }
.badge-native {
  margin-left: 8px; font-size: 10px; font-weight: 600;
  color: #e8a500; background: rgba(232,165,0,0.10);
  border: 1px solid rgba(232,165,0,0.3); border-radius: 4px;
  padding: 1px 6px; text-transform: uppercase; letter-spacing: 0.05em;
}
.live-badge { margin-left: auto; font-size: 10px; font-weight: 700; border-radius: 4px; padding: 2px 7px; letter-spacing: 0.06em; }
.lb-ok  { color: #4ade80; background: rgba(74,222,128,0.1); border: 1px solid rgba(74,222,128,0.3); }
.lb-err { color: #f87171; background: rgba(248,113,113,0.1); border: 1px solid rgba(248,113,113,0.3); }
.divider { height: 1px; background: #1e1e1e; margin: 14px 0; }

/* ── Labels / values ─────────────────────────────────────────────────────────── */
.slabel { font-size: 11px; color: #555; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 3px; }
.sval   { font-size: 20px; font-weight: 600; color: #f0f0f0; }
.sval-link { font-size: 20px; font-weight: 600; color: #e8a500; text-decoration: none; }
.sval-link:hover { text-decoration: underline; }
.no-data    { font-size: 15px; color: #555; font-style: italic; }
.no-data-sm { font-size: 13px; color: #555; font-style: italic; }
.mkt-price  { font-size: 20px; font-weight: 700; color: #f0f0f0; }
.mkt-fdv    { font-size: 15px; font-weight: 600; color: #f0f0f0; }
.liq-warn   { font-size: 11px; color: #e8a500; margin-top: 3px; }

/* Market row */
.mkt-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 4px; }

/* Supply */
.supply-total { font-size: 24px; font-weight: 700; color: #f0f0f0; }
.bar-track { height: 7px; background: rgba(232,165,0,0.10); border: 1px solid rgba(232,165,0,0.15); border-radius: 4px; overflow: hidden; }
.bar-fill  { height: 100%; background: linear-gradient(90deg, #9a6d00, #e8a500); border-radius: 4px; transition: width .6s ease; }
.legend-row { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; font-size: 11px; margin-top: 7px; }
.leg-dot    { width: 8px; height: 8px; border-radius: 2px; flex-shrink: 0; }
.leg-circ   { background: #e8a500; }
.leg-lock   { background: rgba(232,165,0,0.15); border: 1px solid rgba(232,165,0,0.35); }
.leg-val    { color: #c0c0c0; font-weight: 500; margin-right: 4px; }
.token-detail-link {
  display: inline-block; font-size: 12px; color: #e8a500;
  text-decoration: none; border: 1px solid rgba(232,165,0,0.3);
  border-radius: 4px; padding: 5px 12px;
  transition: border-color .15s, background .15s;
}
.token-detail-link:hover { border-color: #e8a500; background: rgba(232,165,0,0.06); }

/* Stat grid */
.stat4  { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.sitem  { }

/* Emission labels */
.era-labels { display: flex; justify-content: space-between; font-size: 11px; color: #444; margin-top: 5px; }

/* ── Section heads ───────────────────────────────────────────────────────────── */
.card-section-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.section-label { font-size: 11px; font-weight: 700; color: #555; text-transform: uppercase; letter-spacing: 0.08em; margin: 0; }
.view-all { font-size: 12px; color: #e8a500; text-decoration: none; }
.view-all:hover { text-decoration: underline; }
.empty { padding: 28px; text-align: center; color: #444; font-size: 13px; }

/* ── Tx table ────────────────────────────────────────────────────────────────── */
.tx-head, .tx-row {
  display: grid;
  grid-template-columns: 150px 90px 80px 1fr 24px;
  gap: 10px; align-items: center; padding: 7px 0;
}
.tx-head { border-bottom: 1px solid #1e1e1e; padding-bottom: 6px; }
.tx-head > span { font-size: 10px; color: #444; text-transform: uppercase; letter-spacing: 0.06em; }
.tx-row  { border-bottom: 1px solid #111; }
.tx-row:last-child { border-bottom: none; }
.tx-row:hover { background: rgba(255,255,255,0.02); border-radius: 4px; }
.tx-hash-wrap { overflow: hidden; }
.hash-link { font-family: 'SF Mono', monospace; font-size: 12px; color: #e8a500; text-decoration: none; }
.hash-link:hover { text-decoration: underline; }
.blk-link { font-family: 'SF Mono', monospace; font-size: 12px; color: #888; text-decoration: none; }
.blk-link:hover { color: #e8a500; }
.age { font-size: 12px; color: #555; white-space: nowrap; }
.pill { font-size: 10px; font-weight: 600; border-radius: 4px; padding: 2px 7px; white-space: nowrap; }

/* ── Block table ─────────────────────────────────────────────────────────────── */
.blk-head, .blk-row {
  display: grid;
  grid-template-columns: 110px 80px 48px 1fr;
  gap: 10px; align-items: center; padding: 7px 0;
}
.blk-head { border-bottom: 1px solid #1e1e1e; padding-bottom: 6px; }
.blk-head > span { font-size: 10px; color: #444; text-transform: uppercase; letter-spacing: 0.06em; }
.blk-row { border-bottom: 1px solid #111; }
.blk-row-alt { background: rgba(0,0,0,0.15); }
.blk-row:last-child { border-bottom: none; }
.height-link { font-family: 'SF Mono', monospace; font-size: 13px; font-weight: 600; color: #e8a500; text-decoration: none; }
.height-link:hover { text-decoration: underline; }
.proposer-cell { font-family: 'SF Mono', monospace; font-size: 11px; color: #444; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.denom-item { font-size: 13px; color: #d0d0d0; font-family: monospace; padding: 3px 0; }

/* ── Responsive ──────────────────────────────────────────────────────────────── */
@media (max-width: 800px) {
  .two-col { grid-template-columns: 1fr; }
  .hero-title { font-size: 26px; }
}
@media (max-width: 560px) {
  .tx-head, .tx-row { grid-template-columns: 130px 1fr 60px 20px; }
  .tx-head > :nth-child(2), .tx-row > :nth-child(2) { display: none; }
}

/* ── Light theme ─────────────────────────────────────────────────────────────── */
.pg.theme-light { background: #f5f7fa; color: #111111; }
.pg.theme-light .navbar { background: rgba(255,255,255,0.97); border-bottom-color: #e0e0e0; }
.pg.theme-light .brand-name { color: #111111; }
.pg.theme-light .chain-id-label { color: #888; }
.pg.theme-light .hero {
  background:
    radial-gradient(ellipse 90% 70% at 50% -5%, rgba(232,165,0,0.10) 0%, transparent 65%),
    radial-gradient(ellipse 50% 50% at 85% 120%, rgba(232,165,0,0.04) 0%, transparent 60%),
    #f5f7fa;
  border-bottom-color: #e0e0e0;
}
.pg.theme-light .hero-title { color: #111111; }
.pg.theme-light .hero-sub { color: #888; }
.pg.theme-light .tick { color: #777; }
.pg.theme-light .tick-sep { color: #ccc; }
.pg.theme-light .card { background: #ffffff; border-color: #e0e0e0; }
.pg.theme-light .ctitle { color: #111111; }
.pg.theme-light .divider { background: #ebebeb; }
.pg.theme-light .slabel { color: #888; }
.pg.theme-light .sval { color: #111111; }
.pg.theme-light .no-data,
.pg.theme-light .no-data-sm { color: #aaa; font-style: italic; }
.pg.theme-light .mkt-price,
.pg.theme-light .mkt-fdv { color: #111111; }
.pg.theme-light .supply-total { color: #111111; }
.pg.theme-light .leg-val { color: #444; }
.pg.theme-light .era-labels { color: #999; }
.pg.theme-light .section-label { color: #888; }
.pg.theme-light .empty { color: #999; }
.pg.theme-light .tx-head { border-bottom-color: #e0e0e0; }
.pg.theme-light .tx-head > span { color: #aaa; }
.pg.theme-light .tx-row { border-bottom-color: #f0f0f0; }
.pg.theme-light .tx-row:hover { background: rgba(0,0,0,0.025); }
.pg.theme-light .blk-link { color: #777; }
.pg.theme-light .age { color: #888; }
.pg.theme-light .blk-head { border-bottom-color: #e0e0e0; }
.pg.theme-light .blk-head > span { color: #aaa; }
.pg.theme-light .blk-row { border-bottom-color: #f0f0f0; }
.pg.theme-light .blk-row-alt { background: rgba(0,0,0,0.04); }
.pg.theme-light .proposer-cell { color: #999; }
.pg.theme-light .denom-item { color: #444; }
.pg.theme-light .reconnect-banner { background: #fff0f0; border-bottom-color: #fcc; }
</style>
