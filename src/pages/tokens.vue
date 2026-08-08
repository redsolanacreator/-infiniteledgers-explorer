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
import { KNOWN_ASSETS, denomToSymbol } from '@/config/knownAssets'
import { isIbcDenom, resolveIbcDenom } from '@/utils/ibcDenom'
import { fetchPriceInInf } from '@/config/ammContract'

const API   = 'https://api.infiniteledgers.com'
const CHAIN = 'infiniteledgers'

const baseStore = useBaseStore()
const isLight   = computed(() => baseStore.theme === 'light')

interface TokenRow {
  denom: string
  symbol: string
  logo: string | null
  totalRaw: bigint
  decimals: number
  holders: number | null
  loading: boolean
  isIbc: boolean
  ibcResolved: boolean
  priceInInf: number | null
  priceLoading: boolean
}

const tokens  = ref<TokenRow[]>([])
const loading = ref(true)
const error   = ref(false)

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

function fmtSupply(tok: TokenRow): string {
  return fmtWithDecimals(tok.totalRaw, tok.decimals)
}

async function loadHolderCount(denom: string): Promise<number> {
  const d = await sfetch(`${API}/cosmos/bank/v1beta1/denom_owners/${denom}?pagination.limit=500`)
  return (d.denom_owners ?? []).length
}

async function fetchTokens() {
  try {
    const d = await sfetch(`${API}/cosmos/bank/v1beta1/supply?pagination.limit=200`)
    const supply: { denom: string; amount: string }[] = d.supply ?? []

    tokens.value = supply.map(({ denom, amount }) => {
      const asset = KNOWN_ASSETS[denom]
      const ibc   = isIbcDenom(denom)
      return {
        denom,
        // IBC denoms get a placeholder (never the raw hash) until the
        // general denom-trace resolution below fills in the real symbol.
        symbol:   asset?.symbol ?? (ibc ? 'IBC' : denomToSymbol(denom)),
        logo:     asset?.logo   ?? null,
        totalRaw: BigInt(amount),
        decimals: asset?.decimals ?? 0,
        holders:  null,
        loading:  true,
        isIbc:    ibc,
        ibcResolved: !ibc,
        priceInInf: null,
        priceLoading: denom !== 'minf',
      }
    })

    loading.value = false
    error.value   = false

    await Promise.allSettled(
      tokens.value.map(async (tok, i) => {
        try {
          tokens.value[i].holders = await loadHolderCount(tok.denom)
        } catch {
          tokens.value[i].holders = null
        } finally {
          tokens.value[i].loading = false
        }
      })
    )

    // General IBC denom resolution -- runs for every ibc/ denom, not just ATOM.
    await Promise.allSettled(
      tokens.value.map(async (tok, i) => {
        if (!tok.isIbc) return
        const resolved = await resolveIbcDenom(tok.denom)
        if (resolved) {
          tokens.value[i].symbol   = resolved.symbol
          tokens.value[i].decimals = resolved.decimals
        }
        tokens.value[i].ibcResolved = true
      })
    )

    // Real AMM prices -- only denoms with an actual pool against minf get one.
    await Promise.allSettled(
      tokens.value.map(async (tok, i) => {
        if (tok.denom === 'minf') return
        try {
          tokens.value[i].priceInInf = await fetchPriceInInf(tok.denom, tok.decimals)
        } catch {
          tokens.value[i].priceInInf = null
        } finally {
          tokens.value[i].priceLoading = false
        }
      })
    )
  } catch {
    loading.value = false
    error.value   = true
  }
}

function truncDenom(denom: string): string {
  if (denom.length <= 24) return denom
  return `${denom.slice(0, 14)}…${denom.slice(-6)}`
}

function fmtPrice(price: number): string {
  if (price === 0) return '0 INF'
  if (price >= 1) return `${price.toLocaleString(undefined, { maximumFractionDigits: 4 })} INF`
  // small prices: show enough significant digits to be meaningful
  return `${price.toPrecision(4)} INF`
}

let refreshTimer: ReturnType<typeof setInterval>

onMounted(async () => {
  await fetchTokens()
  refreshTimer = setInterval(fetchTokens, 30000)
})

onUnmounted(() => clearInterval(refreshTimer))
</script>

<template>
  <div class="pg" :class="{ 'theme-light': isLight }">

    <!-- ── Navbar ─────────────────────────────────────────────────────────── -->
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
          <RouterLink to="/"             class="nav-btn">Home</RouterLink>
          <RouterLink :to="`/${CHAIN}`"  class="nav-btn">Explorer →</RouterLink>
        </div>
      </div>
    </nav>

    <!-- ── Page header ───────────────────────────────────────────────────── -->
    <div class="page-header">
      <div class="ph-inner">
        <h1 class="ph-title">All Tokens</h1>
        <p class="ph-sub">Every denom on Infinite Ledgers · live from chain</p>
      </div>
    </div>

    <!-- ── Content ───────────────────────────────────────────────────────── -->
    <div class="content">

      <!-- Loading -->
      <div v-if="loading" class="state-msg">Loading tokens…</div>

      <!-- Error -->
      <div v-else-if="error" class="state-msg err">
        Failed to load token list — check API connection
      </div>

      <!-- Table -->
      <div v-else class="card">
        <div class="t-wrap">
          <table class="tok-table">
            <thead>
              <tr>
                <th class="th-num">#</th>
                <th>Token</th>
                <th class="th-r">Total Supply</th>
                <th class="th-r">Holders</th>
                <th class="th-r">Price (in INF)</th>
                <th class="th-r">Market Cap</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(tok, i) in tokens" :key="tok.denom" class="tok-row" @click="$router.push(`/token/${encodeURIComponent(tok.denom)}`)">
                <td class="td-num">{{ i + 1 }}</td>
                <td>
                  <div class="tok-cell">
                    <img v-if="tok.logo" :src="tok.logo" :alt="tok.symbol" class="tok-icon" />
                    <div v-else class="tok-icon tok-icon-generic">{{ tok.symbol[0] }}</div>
                    <div>
                      <div class="tok-sym">
                        {{ tok.symbol }}
                        <span v-if="tok.isIbc" class="ibc-tag">via IBC</span>
                      </div>
                      <div class="tok-denom" :title="tok.denom">{{ tok.isIbc ? truncDenom(tok.denom) : tok.denom }}</div>
                    </div>
                  </div>
                </td>
                <td class="td-r mono">{{ fmtSupply(tok) }}</td>
                <td class="td-r">
                  <span v-if="tok.loading" class="loading-dot">…</span>
                  <span v-else-if="tok.holders !== null" class="mono">{{ tok.holders.toLocaleString() }}</span>
                  <span v-else class="muted">—</span>
                </td>
                <td class="td-r">
                  <span v-if="tok.denom === 'minf'" class="no-mkt">No market data</span>
                  <span v-else-if="tok.priceLoading || (tok.isIbc && !tok.ibcResolved)" class="loading-dot">…</span>
                  <span v-else-if="tok.priceInInf !== null" class="mono price-val">{{ fmtPrice(tok.priceInInf) }}</span>
                  <span v-else class="no-mkt">No market data</span>
                </td>
                <td class="td-r no-mkt">No market data</td>
              </tr>
              <tr v-if="tokens.length === 0">
                <td colspan="6" class="state-msg">No tokens found</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="table-footer">
          {{ tokens.length }} token{{ tokens.length === 1 ? '' : 's' }} on Infinite Ledgers
        </div>
      </div>

    </div><!-- /content -->

    <AppFooter />

  </div>
</template>

<style scoped>
/* ── Page ───────────────────────────────────────────────────────────────────── */
.pg {
  min-height: 100vh;
  background: #0d0d0d;
  color: #f0f0f0;
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
}

/* ── Navbar ─────────────────────────────────────────────────────────────────── */
.navbar {
  background: rgba(13,13,13,0.97); border-bottom: 1px solid #1a1a1a;
  backdrop-filter: blur(8px); position: sticky; top: 0; z-index: 50;
}
.nav-inner {
  max-width: 1280px; margin: 0 auto; padding: 0 24px;
  height: 54px; display: flex; align-items: center; gap: 16px;
}
.brand { display: flex; align-items: center; gap: 10px; text-decoration: none; flex-shrink: 0; }
.brand-logo { width: 28px; height: 28px; border-radius: 50%; }
.brand-name { font-size: 15px; font-weight: 700; color: #f0f0f0; letter-spacing: -0.02em; }
.search-wrap { flex: 1; max-width: 420px; }
.nav-right { display: flex; align-items: center; gap: 8px; margin-left: auto; flex-shrink: 0; }
.nav-btn { font-size: 12px; color: #888; border: 1px solid #2d2d2d; border-radius: 4px; padding: 4px 10px; text-decoration: none; transition: border-color .15s, color .15s; }
.nav-btn:hover { color: #e8a500; border-color: rgba(232,165,0,0.4); }

/* ── Page header ────────────────────────────────────────────────────────────── */
.page-header {
  border-bottom: 1px solid #1e1e1e;
  background: radial-gradient(ellipse 60% 60% at 50% -10%, rgba(232,165,0,0.08) 0%, transparent 60%), #0d0d0d;
  padding: 28px 0 20px;
}
.ph-inner { max-width: 1280px; margin: 0 auto; padding: 0 24px; }
.ph-title { font-size: 26px; font-weight: 800; color: #f0f0f0; margin: 0 0 4px; letter-spacing: -0.02em; }
.ph-sub { font-size: 13px; color: #555; margin: 0; }

/* ── Content ────────────────────────────────────────────────────────────────── */
.content { max-width: 1280px; margin: 0 auto; padding: 22px 24px; }

/* ── Card ───────────────────────────────────────────────────────────────────── */
.card { background: #141414; border: 1px solid #2d2d2d; border-radius: 10px; overflow: hidden; }

/* ── Table ──────────────────────────────────────────────────────────────────── */
.t-wrap { overflow-x: auto; }
.tok-table { width: 100%; border-collapse: collapse; }
.tok-table th {
  padding: 10px 16px; font-size: 10px; font-weight: 600; color: #555;
  text-transform: uppercase; letter-spacing: 0.07em;
  border-bottom: 1px solid #1e1e1e; white-space: nowrap;
  background: #111;
}
.tok-table td { padding: 13px 16px; border-bottom: 1px solid #111111; vertical-align: middle; }
.tok-row { cursor: pointer; transition: background .12s; }
.tok-row:hover { background: rgba(255,255,255,0.02); }
.tok-row:last-child td { border-bottom: none; }

.th-num, .td-num { width: 48px; text-align: center; }
.th-r, .td-r { text-align: right; }

/* ── Token cell ─────────────────────────────────────────────────────────────── */
.tok-cell { display: flex; align-items: center; gap: 12px; }
.tok-icon { width: 36px; height: 36px; border-radius: 50%; border: 1px solid #2d2d2d; flex-shrink: 0; }
.tok-icon-generic {
  display: flex; align-items: center; justify-content: center;
  background: #1e1e1e; color: #e8a500; font-size: 15px; font-weight: 700;
}
.tok-sym  { font-size: 14px; font-weight: 600; color: #f0f0f0; display: flex; align-items: center; gap: 6px; }
.tok-denom { font-size: 11px; color: #555; font-family: 'SF Mono', monospace; margin-top: 1px; }
.ibc-tag {
  font-size: 9px; font-weight: 600; color: #7dd3fc; background: rgba(125,211,252,0.10);
  border: 1px solid rgba(125,211,252,0.3); border-radius: 4px; padding: 1px 6px;
  text-transform: uppercase; letter-spacing: 0.04em;
}
.price-val { color: #e8a500; font-weight: 600; }

/* ── Cells ──────────────────────────────────────────────────────────────────── */
.mono     { font-family: 'SF Mono', monospace; font-size: 13px; color: #d0d0d0; }
.muted    { color: #444; font-size: 13px; }
.no-mkt   { font-size: 12px; color: #333; font-style: italic; }
.loading-dot { color: #444; font-size: 13px; }
.td-num   { font-size: 12px; color: #555; font-family: 'SF Mono', monospace; }

.table-footer {
  padding: 10px 16px; font-size: 11px; color: #333;
  border-top: 1px solid #111; text-align: right;
}

/* ── States ─────────────────────────────────────────────────────────────────── */
.state-msg { padding: 48px; text-align: center; color: #444; font-size: 14px; }
.state-msg.err { color: #f87171; }

/* ── Light theme ────────────────────────────────────────────────────────────── */
.pg.theme-light { background: #f5f7fa; color: #111111; }
.pg.theme-light .navbar { background: rgba(255,255,255,0.97); border-bottom-color: #e0e0e0; }
.pg.theme-light .brand-name { color: #111111; }
.pg.theme-light .nav-btn { color: #666; border-color: #e0e0e0; }
.pg.theme-light .page-header {
  background: radial-gradient(ellipse 60% 60% at 50% -10%, rgba(232,165,0,0.06) 0%, transparent 60%), #f5f7fa;
  border-bottom-color: #e0e0e0;
}
.pg.theme-light .ph-title { color: #111111; }
.pg.theme-light .ph-sub { color: #888; }
.pg.theme-light .card { background: #ffffff; border-color: #e0e0e0; }
.pg.theme-light .tok-table th { background: #f8f8f8; color: #aaa; border-bottom-color: #ebebeb; }
.pg.theme-light .tok-table td { border-bottom-color: #f0f0f0; }
.pg.theme-light .tok-row:hover { background: rgba(0,0,0,0.02); }
.pg.theme-light .tok-sym { color: #111111; }
.pg.theme-light .tok-denom { color: #aaa; }
.pg.theme-light .tok-icon { border-color: #e0e0e0; }
.pg.theme-light .tok-icon-generic { background: #f0f0f0; }
.pg.theme-light .mono { color: #333; }
.pg.theme-light .muted { color: #bbb; }
.pg.theme-light .no-mkt { color: #ccc; }
.pg.theme-light .loading-dot { color: #bbb; }
.pg.theme-light .td-num { color: #aaa; }
.pg.theme-light .table-footer { color: #bbb; border-top-color: #ebebeb; }
.pg.theme-light .state-msg { color: #aaa; }
</style>
