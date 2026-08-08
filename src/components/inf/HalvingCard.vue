<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  blockHeight: number
  currentEra: number
  blocksInEra: number
  blocksRemaining: number
  eraProgress: number
  blockRewardMinf: number
  blocksPerEra: number
}>()

function fmtINF(minf: number): string {
  if (!minf) return '0 INF'
  const whole = Math.floor(minf / 1_000_000)
  const frac = minf % 1_000_000
  const fracStr = frac > 0 ? `.${frac.toString().padStart(6, '0').replace(/0+$/, '')}` : ''
  return `${whole.toLocaleString()}${fracStr} INF`
}

const pct = computed(() => (Math.min(1, props.eraProgress) * 100).toFixed(3))
const nextEraReward = computed(() => props.blockRewardMinf >>> 1)
const nextHalvingBlock = computed(() => (props.currentEra + 1) * props.blocksPerEra)
const eraStartBlock = computed(() => props.currentEra * props.blocksPerEra)
</script>

<template>
  <div style="background: #1C1C1E; border: 1px solid #2C2C2E; border-radius: 8px; padding: 20px 24px;">
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 18px;">
      <h3 style="font-size: 12px; font-weight: 600; color: #8E8E93; text-transform: uppercase; letter-spacing: 0.07em; margin: 0;">
        Halving Emission
      </h3>
      <span style="
        font-size: 12px; font-weight: 700; color: #00C805;
        background: rgba(0,200,5,0.08); border: 1px solid rgba(0,200,5,0.3);
        border-radius: 4px; padding: 2px 10px;
      ">Era {{ currentEra }}</span>
    </div>

    <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; margin-bottom: 20px;">
      <div>
        <div style="font-size: 11px; color: #8E8E93; margin-bottom: 5px;">Block Reward</div>
        <div style="font-size: 22px; font-weight: 700; color: #00C805; font-variant-numeric: tabular-nums;">
          {{ fmtINF(blockRewardMinf) }}
        </div>
      </div>
      <div>
        <div style="font-size: 11px; color: #8E8E93; margin-bottom: 5px;">Next Era Reward</div>
        <div style="font-size: 22px; font-weight: 700; color: #8E8E93; font-variant-numeric: tabular-nums;">
          {{ fmtINF(nextEraReward) }}
        </div>
      </div>
      <div>
        <div style="font-size: 11px; color: #8E8E93; margin-bottom: 5px;">Blocks Remaining</div>
        <div style="font-size: 22px; font-weight: 700; color: #FFFFFF; font-variant-numeric: tabular-nums;">
          {{ blocksRemaining.toLocaleString() }}
        </div>
      </div>
      <div>
        <div style="font-size: 11px; color: #8E8E93; margin-bottom: 5px;">Next Halving Block</div>
        <div style="font-size: 22px; font-weight: 700; color: #FFFFFF; font-variant-numeric: tabular-nums;">
          {{ nextHalvingBlock.toLocaleString() }}
        </div>
      </div>
    </div>

    <div>
      <div style="display: flex; justify-content: space-between; font-size: 11px; color: #8E8E93; margin-bottom: 7px;">
        <span>Block {{ eraStartBlock.toLocaleString() }}</span>
        <span style="color: #8E8E93;">{{ pct }}% of Era {{ currentEra }} complete</span>
        <span>Block {{ nextHalvingBlock.toLocaleString() }}</span>
      </div>
      <div style="background: #2C2C2E; border-radius: 4px; height: 6px; overflow: hidden;">
        <div :style="`
          width: ${pct}%;
          height: 100%;
          background: linear-gradient(90deg, #007A03, #00C805);
          border-radius: 4px;
          transition: width 1s ease;
          min-width: ${pct > '0' ? '4px' : '0'};
        `"></div>
      </div>
      <div style="font-size: 11px; color: #8E8E93; margin-top: 6px; text-align: center;">
        {{ blocksInEra.toLocaleString() }} / {{ blocksPerEra.toLocaleString() }} blocks
      </div>
    </div>
  </div>
</template>
