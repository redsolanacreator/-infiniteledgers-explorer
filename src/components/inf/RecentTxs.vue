<script setup lang="ts">
interface Tx {
  hash: string
  height: string
  time: string
  type: string
  success: boolean
}

const props = defineProps<{ txs: Tx[]; chain: string }>()

function relTime(iso: string): string {
  if (!iso) return '—'
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  return `${Math.floor(diff / 3600)}h ago`
}

function truncHash(h: string): string {
  if (!h) return ''
  return h.slice(0, 10) + '…' + h.slice(-6)
}
</script>

<template>
  <div style="background: #141414; border: 1px solid #2d2d2d; border-radius: 8px; overflow: hidden; display: flex; flex-direction: column;">

    <div style="padding: 13px 16px; border-bottom: 1px solid #1e1e1e; display: flex; justify-content: space-between; align-items: center; flex-shrink: 0;">
      <h3 style="font-size: 12px; font-weight: 600; color: #666; text-transform: uppercase; letter-spacing: 0.07em; margin: 0;">
        Recent Transactions
      </h3>
      <a :href="`/${chain}/tx`" style="font-size: 12px; color: #e8a500; text-decoration: none;">View all →</a>
    </div>

    <div v-if="!txs.length"
      style="padding: 32px; text-align: center; color: #444; font-size: 13px; flex: 1; display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 6px;">
      <span>No transactions yet</span>
      <span style="font-size: 11px; color: #333;">Transaction feed will appear here once activity begins</span>
    </div>

    <div v-else>
      <!-- Column headers -->
      <div style="
        display: grid; grid-template-columns: 1fr 90px 64px 20px;
        gap: 10px; padding: 6px 16px;
        font-size: 10px; color: #444; text-transform: uppercase; letter-spacing: 0.06em;
        border-bottom: 1px solid #1a1a1a;
      ">
        <span>Tx Hash</span>
        <span>Type</span>
        <span style="text-align: right;">Age</span>
        <span></span>
      </div>

      <div v-for="(tx, i) in txs" :key="tx.hash">
        <a
          :href="`/${chain}/tx/${tx.hash}`"
          :style="`
            display: grid; grid-template-columns: 1fr 90px 64px 20px;
            gap: 10px; padding: 9px 16px;
            text-decoration: none;
            border-bottom: 1px solid #1a1a1a;
            align-items: center;
            background: ${i % 2 === 1 ? '#111' : 'transparent'};
          `"
          @mouseenter="($event.currentTarget as HTMLElement).style.background='#1e1e1e'"
          @mouseleave="($event.currentTarget as HTMLElement).style.background = i % 2 === 1 ? '#111' : 'transparent'"
        >
          <span style="font-size: 12px; color: #e8a500; font-family: 'SF Mono', monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
            {{ truncHash(tx.hash) }}
          </span>
          <span style="
            font-size: 11px; font-weight: 500;
            background: rgba(232,165,0,0.08); color: #c88c00;
            border-radius: 3px; padding: 2px 7px;
            text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
          ">
            {{ tx.type }}
          </span>
          <span style="font-size: 12px; color: #777; text-align: right; white-space: nowrap;">
            {{ relTime(tx.time) }}
          </span>
          <span :style="`font-size: 13px; text-align: right; color: ${tx.success ? '#4ade80' : '#f87171'};`">
            {{ tx.success ? '✓' : '✗' }}
          </span>
        </a>
      </div>
    </div>

  </div>
</template>
