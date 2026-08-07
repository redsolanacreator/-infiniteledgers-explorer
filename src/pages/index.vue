<route lang="yaml">
meta:
  layout: blank
</route>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import InfSearchBar from '@/components/inf/SearchBar.vue'
import InfStatStrip from '@/components/inf/StatStrip.vue'
import InfHalvingCard from '@/components/inf/HalvingCard.vue'
import InfRecentBlocks from '@/components/inf/RecentBlocks.vue'
import InfRecentTxs from '@/components/inf/RecentTxs.vue'
import InfHoldersTable from '@/components/inf/HoldersTable.vue'

// RPC tunnel points at gRPC port — use REST API for all block/status queries
const API = 'https://api.infiniteledgers.com'
const CHAIN = 'infiniteledgers'
const DENOM = 'minf'
const BLOCKS_PER_ERA = 25_246_080
const ERA_0_REWARD_MINF = 1_980_000

interface Block  { height: string; time: string; proposer: string; numTxs: number }
interface Tx     { hash: string; height: string; time: string; type: string; success: boolean }
interface Holder { rank: number; address: string; balances: { denom: string; amount: string }[] }

// ── Reactive state ────────────────────────────────────────────────────────────
const connected    = ref(false)
const reconnecting = ref(false)
const blockHeight  = ref(0)
const blockTime    = ref('')
const chainId      = ref('infiniteledgers-1')
const totalSupply  = ref('0')
const validatorCount = ref(0)
const bondedTokens   = ref('0')
const recentBlocks   = ref<Block[]>([])
const recentTxs      = ref<Tx[]>([])
const holders        = ref<Holder[]>([])
const holdersMode    = ref<'chain-wide' | 'unavailable'>('unavailable')

// ── Derived values ─────────────────────────────────────────────────────────────
const currentEra    = computed(() => Math.floor(blockHeight.value / BLOCKS_PER_ERA))
const blocksInEra   = computed(() => blockHeight.value % BLOCKS_PER_ERA)
const eraProgress   = computed(() => blocksInEra.value / BLOCKS_PER_ERA)
const blocksRemain  = computed(() => BLOCKS_PER_ERA - blocksInEra.value)
const blockReward   = computed(() => ERA_0_REWARD_MINF >>> currentEra.value)

const avgBlockTime  = computed(() => {
  const bs = [...recentBlocks.value].sort((a, b) => Number(b.height) - Number(a.height))
  if (bs.length < 2) return null
  const diffs: number[] = []
  for (let i = 0; i < bs.length - 1; i++) {
    diffs.push(Math.abs(new Date(bs[i].time).getTime() - new Date(bs[i + 1].time).getTime()))
  }
  return diffs.reduce((a, b) => a + b, 0) / diffs.length / 1000
})

// ── Fetch helpers ──────────────────────────────────────────────────────────────
async function sfetch(url: string): Promise<any> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 6000)
  try {
    const r = await fetch(url, { signal: ctrl.signal })
    clearTimeout(t)
    if (!r.ok) throw new Error(String(r.status))
    return r.json()
  } catch (e) {
    clearTimeout(t)
    throw e
  }
}

async function fetchStatus() {
  try {
    const d = await sfetch(`${API}/cosmos/base/tendermint/v1beta1/blocks/latest`)
    const hdr = d.block?.header ?? {}
    blockHeight.value  = Number(hdr.height ?? 0)
    blockTime.value    = hdr.time ?? ''
    chainId.value      = hdr.chain_id ?? 'infiniteledgers-1'
    connected.value    = true
    reconnecting.value = false
  } catch {
    connected.value    = false
    reconnecting.value = true
  }
}

async function fetchSupply() {
  try {
    const d = await sfetch(`${API}/cosmos/bank/v1beta1/supply/by_denom?denom=${DENOM}`)
    totalSupply.value = d.amount?.amount ?? '0'
  } catch {}
}

async function fetchValidators() {
  try {
    const d = await sfetch(
      `${API}/cosmos/staking/v1beta1/validators?status=BOND_STATUS_BONDED&pagination.limit=200`
    )
    const vals: any[] = d.validators ?? []
    validatorCount.value = vals.length
    bondedTokens.value   = vals
      .reduce((acc: bigint, v: any) => acc + BigInt(v.tokens || 0), 0n)
      .toString()
  } catch {}
}

async function fetchRecentBlocks() {
  try {
    if (!blockHeight.value) return
    const h = blockHeight.value
    // Fetch last 8 blocks in parallel via REST (RPC tunnel is gRPC-only)
    const heights = Array.from({ length: 8 }, (_, i) => Math.max(1, h - i))
    const results = await Promise.allSettled(
      heights.map(n => sfetch(`${API}/cosmos/base/tendermint/v1beta1/blocks/${n}`))
    )
    recentBlocks.value = results
      .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled')
      .map(r => {
        const hdr = r.value.block?.header ?? {}
        const txs: string[] = r.value.block?.data?.txs ?? []
        return {
          height:   hdr.height ?? '0',
          time:     hdr.time ?? '',
          proposer: hdr.proposer_address ?? '',
          numTxs:   txs.length,
        }
      })
  } catch {}
}

async function fetchRecentTxs() {
  try {
    // This SDK uses ?query= (not ?events=) for the tx search REST endpoint
    const q = encodeURIComponent('tx.height>=1')
    const d = await sfetch(
      `${API}/cosmos/tx/v1beta1/txs?query=${q}&order_by=ORDER_BY_DESC&pagination.limit=10`
    )
    const txrs: any[] = d.tx_responses ?? []
    const txs:  any[] = d.txs ?? []
    recentTxs.value = txrs.map((txr, i) => {
      const msgs: any[] = txs[i]?.body?.messages ?? []
      const typeUrl = msgs[0]?.['@type'] ?? ''
      const type = typeUrl.split('.').pop()?.replace(/^Msg/, '') ?? 'Unknown'
      return {
        hash:    txr.txhash,
        height:  txr.height,
        time:    txr.timestamp,
        type,
        success: txr.code === 0,
      }
    })
  } catch {}
}

async function fetchHolders() {
  // denom_owners is available in Cosmos SDK v0.46+ — provides a true chain-wide holder list.
  // Standard Cosmos REST does NOT have a generic "list all holders" endpoint; this specific
  // query was added to the bank module in v0.46. Falls back gracefully if unavailable.
  try {
    const d = await sfetch(
      `${API}/cosmos/bank/v1beta1/denom_owners/${DENOM}?pagination.limit=50`
    )
    const raw: any[] = d.denom_owners ?? []
    if (raw.length > 0) {
      const sorted = [...raw].sort(
        (a, b) => BigInt(b.balance.amount) > BigInt(a.balance.amount) ? 1 : -1
      )
      holders.value = sorted.map((o, i) => ({
        rank: i + 1,
        address:  o.address,
        balances: [{ denom: o.balance.denom, amount: o.balance.amount }],
      }))
      holdersMode.value = 'chain-wide'
      return
    }
  } catch {}
  holdersMode.value = 'unavailable'
}

// ── Polling ────────────────────────────────────────────────────────────────────
let fastTimer: ReturnType<typeof setInterval>
let slowTimer: ReturnType<typeof setInterval>

onMounted(async () => {
  await fetchStatus()
  await Promise.all([
    fetchSupply(), fetchValidators(),
    fetchRecentBlocks(), fetchRecentTxs(), fetchHolders(),
  ])

  // 5s: block height + recent activity
  fastTimer = setInterval(async () => {
    await fetchStatus()
    await Promise.all([fetchRecentBlocks(), fetchRecentTxs()])
  }, 5000)

  // 30s: slow-moving data
  slowTimer = setInterval(async () => {
    await Promise.all([fetchSupply(), fetchValidators(), fetchHolders()])
  }, 30000)
})

onUnmounted(() => {
  clearInterval(fastTimer)
  clearInterval(slowTimer)
})
</script>

<template>
  <div style="min-height: 100vh; background: #0d0d0d; color: #f0f0f0; font-family: 'Inter', system-ui, -apple-system, sans-serif;">

    <!-- ── Reconnect banner ─────────────────────────────────────────────────── -->
    <div v-if="reconnecting" style="
      background: #160808; border-bottom: 1px solid #4a1515;
      padding: 7px 24px; font-size: 12px; color: #f87171;
      display: flex; align-items: center; gap: 8px;
    ">
      <span style="width: 7px; height: 7px; border-radius: 50%; background: #f87171; display: inline-block; animation: inf-pulse 1.4s ease-in-out infinite;"></span>
      Reconnecting to {{ chainId }}… Cloudflare tunnel may be temporarily unreachable.
    </div>

    <!-- ── Header ──────────────────────────────────────────────────────────── -->
    <header style="border-bottom: 1px solid #1e1e1e; background: #0d0d0d;">
      <div style="max-width: 1280px; margin: 0 auto; padding: 0 24px; height: 64px; display: flex; align-items: center; gap: 20px;">

        <!-- Logo + name -->
        <a href="/" style="display: flex; align-items: center; gap: 10px; text-decoration: none; flex-shrink: 0;">
          <img src="/logos/infiniteledgers.svg" alt="INF"
            style="width: 34px; height: 34px; border-radius: 50%;" />
          <span style="font-size: 17px; font-weight: 700; color: #f0f0f0; letter-spacing: -0.02em; white-space: nowrap;">
            Infinite Ledgers
          </span>
        </a>

        <!-- Search (grows to fill) -->
        <div style="flex: 1; max-width: 560px; margin: 0 auto;">
          <InfSearchBar :chain="CHAIN" />
        </div>

        <!-- Network badge -->
        <div style="display: flex; align-items: center; gap: 8px; flex-shrink: 0;">
          <span :style="`
            width: 7px; height: 7px; border-radius: 50%; display: inline-block;
            background: ${connected ? '#4ade80' : '#f87171'};
            ${connected ? 'animation: inf-pulse 2.5s ease-in-out infinite;' : ''}
          `"></span>
          <span style="font-size: 12px; color: #666; font-family: 'SF Mono', monospace;">{{ chainId }}</span>
          <a
            :href="`/${CHAIN}`"
            style="
              margin-left: 8px; font-size: 11px; color: #888;
              border: 1px solid #2d2d2d; border-radius: 4px;
              padding: 3px 8px; text-decoration: none;
            "
            @mouseenter="($event.target as HTMLElement).style.borderColor='#e8a500'"
            @mouseleave="($event.target as HTMLElement).style.borderColor='#2d2d2d'"
          >Explorer</a>
        </div>

      </div>
    </header>

    <!-- ── Stat strip ──────────────────────────────────────────────────────── -->
    <InfStatStrip
      :block-height="blockHeight"
      :total-supply="totalSupply"
      :validator-count="validatorCount"
      :bonded-tokens="bondedTokens"
      :block-reward-minf="blockReward"
      :avg-block-time="avgBlockTime"
    />

    <!-- ── Main content ────────────────────────────────────────────────────── -->
    <main style="max-width: 1280px; margin: 0 auto; padding: 24px; display: flex; flex-direction: column; gap: 20px;">

      <!-- Halving emission card -->
      <InfHalvingCard
        :block-height="blockHeight"
        :current-era="currentEra"
        :blocks-in-era="blocksInEra"
        :blocks-remaining="blocksRemain"
        :era-progress="eraProgress"
        :block-reward-minf="blockReward"
        :blocks-per-era="BLOCKS_PER_ERA"
      />

      <!-- Two-column: blocks + txs -->
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
        <InfRecentBlocks :blocks="recentBlocks" :chain="CHAIN" />
        <InfRecentTxs   :txs="recentTxs"       :chain="CHAIN" />
      </div>

      <!-- Holders table -->
      <InfHoldersTable
        :holders="holders"
        :total-supply="totalSupply"
        :mode="holdersMode"
        :chain="CHAIN"
        :denom="DENOM"
      />

    </main>

    <!-- ── Footer ─────────────────────────────────────────────────────────── -->
    <footer style="
      border-top: 1px solid #161616; margin-top: 20px;
      padding: 16px 24px; text-align: center;
      font-size: 12px; color: #444;
    ">
      <RouterLink :to="`/${CHAIN}`"       style="color: #e8a500; text-decoration: none; margin: 0 12px;">Full Explorer</RouterLink>
      <RouterLink :to="`/${CHAIN}/block`"   style="color: #666; text-decoration: none; margin: 0 12px;">Blocks</RouterLink>
      <RouterLink :to="`/${CHAIN}/tx`"      style="color: #666; text-decoration: none; margin: 0 12px;">Transactions</RouterLink>
      <RouterLink :to="`/${CHAIN}/staking`" style="color: #666; text-decoration: none; margin: 0 12px;">Validators</RouterLink>
    </footer>

  </div>
</template>

<style>
@keyframes inf-pulse {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.35; }
}
</style>
