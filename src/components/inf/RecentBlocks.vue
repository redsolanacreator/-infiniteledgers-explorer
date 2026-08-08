<script setup lang="ts">
import { computed } from 'vue'

interface Block {
  height: string
  time: string
  proposer: string
  numTxs: number
}

const props = defineProps<{ blocks: Block[]; chain: string }>()

const sorted = computed(() =>
  [...props.blocks].sort((a, b) => Number(b.height) - Number(a.height))
)

function relTime(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  return `${Math.floor(diff / 3600)}h ago`
}

function truncProposer(s: string): string {
  // REST API returns proposer_address as base64 consensus key bytes
  if (!s) return '—'
  return s.slice(0, 10) + '…'
}
</script>

<template>
  <div style="background: #1C1C1E; border: 1px solid #2C2C2E; border-radius: 8px; overflow: hidden; display: flex; flex-direction: column;">

    <div style="padding: 13px 16px; border-bottom: 1px solid #2C2C2E; display: flex; justify-content: space-between; align-items: center; flex-shrink: 0;">
      <h3 style="font-size: 12px; font-weight: 600; color: #8E8E93; text-transform: uppercase; letter-spacing: 0.07em; margin: 0;">
        Recent Blocks
      </h3>
      <a :href="`/${chain}/block`" style="font-size: 12px; color: #00C805; text-decoration: none;">View all →</a>
    </div>

    <div v-if="!sorted.length"
      style="padding: 32px; text-align: center; color: #8E8E93; font-size: 13px; flex: 1; display: flex; align-items: center; justify-content: center;">
      Waiting for blocks…
    </div>

    <div v-else>
      <!-- Column headers -->
      <div style="
        display: grid; grid-template-columns: 88px 1fr 68px 46px;
        gap: 10px; padding: 6px 16px;
        font-size: 10px; color: #8E8E93; text-transform: uppercase; letter-spacing: 0.06em;
        border-bottom: 1px solid #2C2C2E;
      ">
        <span>Height</span>
        <span>Proposer</span>
        <span style="text-align: right;">Age</span>
        <span style="text-align: right;">Txs</span>
      </div>

      <div v-for="(block, i) in sorted" :key="block.height">
        <a
          :href="`/${chain}/block/${block.height}`"
          :style="`
            display: grid; grid-template-columns: 88px 1fr 68px 46px;
            gap: 10px; padding: 9px 16px;
            text-decoration: none;
            border-bottom: 1px solid #2C2C2E;
            align-items: center;
            background: ${i % 2 === 1 ? '#000000' : 'transparent'};
          `"
          @mouseenter="($event.currentTarget as HTMLElement).style.background='#2C2C2E'"
          @mouseleave="($event.currentTarget as HTMLElement).style.background = i % 2 === 1 ? '#000000' : 'transparent'"
        >
          <span style="font-size: 13px; font-weight: 600; color: #00C805; font-family: 'SF Mono', monospace;">
            {{ Number(block.height).toLocaleString() }}
          </span>
          <span style="font-size: 12px; color: #8E8E93; font-family: 'SF Mono', monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
            {{ truncProposer(block.proposer) }}
          </span>
          <span style="font-size: 12px; color: #8E8E93; text-align: right; white-space: nowrap;">
            {{ relTime(block.time) }}
          </span>
          <span :style="`font-size: 12px; text-align: right; font-family: monospace; color: ${block.numTxs > 0 ? '#00C805' : '#8E8E93'};`">
            {{ block.numTxs }}
          </span>
        </a>
      </div>
    </div>

  </div>
</template>
