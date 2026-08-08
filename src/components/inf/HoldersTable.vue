<script setup lang="ts">
import { ref } from 'vue'

interface CoinBalance {
  denom: string
  amount: string
}

interface Holder {
  rank: number
  address: string
  balances: CoinBalance[]
}

const props = defineProps<{
  holders: Holder[]
  totalSupply: string
  mode: 'chain-wide' | 'unavailable'
  chain: string
  denom: string
}>()

const copied = ref<string | null>(null)

function copyAddr(addr: string) {
  navigator.clipboard.writeText(addr).then(() => {
    copied.value = addr
    setTimeout(() => { copied.value = null }, 2000)
  }).catch(() => {})
}

function truncAddr(addr: string): string {
  if (addr.length <= 22) return addr
  return addr.slice(0, 10) + '...' + addr.slice(-8)
}

function fmtBalances(balances: CoinBalance[]): string {
  return balances.map(b => {
    const n = BigInt(b.amount || '0')
    const whole = n / 1_000_000n
    const frac = n % 1_000_000n
    const display = b.denom === 'minf' ? 'INF' : b.denom.toUpperCase()
    if (frac === 0n) return `${whole.toLocaleString()} ${display}`
    return `${whole.toLocaleString()}.${frac.toString().padStart(6, '0').replace(/0+$/, '')} ${display}`
  }).join(' · ')
}

function pctOfSupply(balances: CoinBalance[]): string {
  const supply = BigInt(props.totalSupply || '1')
  if (supply === 0n) return '—'
  const mainBal = balances.find(b => b.denom === props.denom)
  if (!mainBal) return '—'
  const bal = BigInt(mainBal.amount || '0')
  const pct = Number((bal * 100_000n) / supply) / 1000
  return `${pct.toFixed(3)}%`
}
</script>

<template>
  <div style="background: #1C1C1E; border: 1px solid #2C2C2E; border-radius: 8px; overflow: hidden;">

    <div style="padding: 13px 16px; border-bottom: 1px solid #2C2C2E; display: flex; justify-content: space-between; align-items: center;">
      <h3 style="font-size: 12px; font-weight: 600; color: #8E8E93; text-transform: uppercase; letter-spacing: 0.07em; margin: 0;">
        Top Holders
      </h3>
      <span v-if="mode === 'chain-wide'" style="font-size: 11px; color: #00C805; display: flex; align-items: center; gap: 5px;">
        <svg width="10" height="10" viewBox="0 0 10 10" fill="#00C805"><circle cx="5" cy="5" r="4"/></svg>
        Chain-wide · All accounts
      </span>
      <span v-else style="font-size: 11px; color: #8E8E93;">
        denom_owners endpoint unavailable
      </span>
    </div>

    <div v-if="mode === 'unavailable' && !holders.length"
      style="padding: 32px; text-align: center; color: #8E8E93; font-size: 13px; line-height: 1.7;">
      <div>The <code style="font-family: monospace; color: #8E8E93;">/cosmos/bank/v1beta1/denom_owners/{denom}</code> endpoint</div>
      <div>is not available on this node or returned no data.</div>
      <div style="margin-top: 8px; font-size: 11px; color: #8E8E93;">
        Standard Cosmos SDK does not expose a chain-wide holder index via REST.
        DenomOwners requires SDK v0.46+ with the query enabled.
      </div>
    </div>

    <div v-else-if="!holders.length"
      style="padding: 24px; text-align: center; color: #8E8E93; font-size: 13px;">
      Loading holders…
    </div>

    <table v-else style="width: 100%; border-collapse: collapse;">
      <thead>
        <tr style="border-bottom: 1px solid #2C2C2E;">
          <th style="padding: 8px 16px; font-size: 10px; color: #8E8E93; font-weight: 500; text-align: left; text-transform: uppercase; letter-spacing: 0.05em; width: 44px;">#</th>
          <th style="padding: 8px 16px; font-size: 10px; color: #8E8E93; font-weight: 500; text-align: left; text-transform: uppercase; letter-spacing: 0.05em;">Address</th>
          <th style="padding: 8px 16px; font-size: 10px; color: #8E8E93; font-weight: 500; text-align: right; text-transform: uppercase; letter-spacing: 0.05em;">Balance</th>
          <th style="padding: 8px 16px; font-size: 10px; color: #8E8E93; font-weight: 500; text-align: right; text-transform: uppercase; letter-spacing: 0.05em; width: 90px;">% Supply</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="(h, i) in holders"
          :key="h.address"
          :style="`border-bottom: 1px solid #2C2C2E; background: ${i % 2 === 1 ? '#000000' : 'transparent'};`"
          @mouseenter="($event.currentTarget as HTMLElement).style.background='#2C2C2E'"
          @mouseleave="($event.currentTarget as HTMLElement).style.background = i % 2 === 1 ? '#000000' : 'transparent'"
        >
          <td style="padding: 10px 16px; font-size: 13px; color: #8E8E93; font-family: monospace;">
            {{ h.rank }}
          </td>
          <td style="padding: 10px 16px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <a
                :href="`/${chain}/account/${h.address}`"
                style="font-size: 13px; color: #00C805; font-family: 'SF Mono', monospace; text-decoration: none;"
                @mouseenter="($event.target as HTMLElement).style.textDecoration='underline'"
                @mouseleave="($event.target as HTMLElement).style.textDecoration='none'"
              >{{ truncAddr(h.address) }}</a>
              <button
                @click.prevent="copyAddr(h.address)"
                style="background: none; border: none; cursor: pointer; padding: 0; line-height: 1; display: flex; align-items: center;"
                :title="copied === h.address ? 'Copied!' : 'Copy address'"
              >
                <span v-if="copied === h.address" style="font-size: 11px; color: #00C805;">✓</span>
                <svg v-else width="12" height="12" fill="none" stroke="#8E8E93" stroke-width="2" viewBox="0 0 24 24">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                </svg>
              </button>
            </div>
          </td>
          <td style="padding: 10px 16px; text-align: right; font-size: 13px; color: #FFFFFF; font-family: 'SF Mono', monospace; white-space: nowrap;">
            {{ fmtBalances(h.balances) }}
          </td>
          <td style="padding: 10px 16px; text-align: right; font-size: 13px; color: #8E8E93; font-family: 'SF Mono', monospace;">
            {{ pctOfSupply(h.balances) }}
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
