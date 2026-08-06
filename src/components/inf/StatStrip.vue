<script setup lang="ts">
defineProps<{
  blockHeight: number
  totalSupply: string
  validatorCount: number
  bondedTokens: string
  blockRewardMinf: number
  avgBlockTime: number | null
}>()

function fmtMinf(minf: string | number): string {
  const n = BigInt(typeof minf === 'number' ? Math.floor(minf) : (minf || '0'))
  const whole = n / 1_000_000n
  return `${whole.toLocaleString()} INF`
}

function fmtTime(s: number | null): string {
  if (s === null || s === 0) return '—'
  return `${s.toFixed(1)}s`
}
</script>

<template>
  <div style="border-bottom: 1px solid #1e1e1e; background: #0f0f0f;">
    <div style="max-width: 1280px; margin: 0 auto; padding: 0 24px; display: flex; overflow-x: auto; gap: 0;">

      <div v-for="(stat, i) in [
        { label: 'Total Supply',    val: fmtMinf(totalSupply) },
        { label: 'Block Height',    val: blockHeight.toLocaleString() },
        { label: 'Avg Block Time',  val: fmtTime(avgBlockTime) },
        { label: 'Validators',      val: String(validatorCount) },
        { label: 'Block Reward',    val: fmtMinf(blockRewardMinf) },
      ]" :key="i"
        style="
          display: flex; flex-direction: column;
          padding: 10px 28px 10px 0;
          margin-right: 28px;
          border-right: 1px solid #1e1e1e;
          white-space: nowrap; flex-shrink: 0;
        "
        :style="i === 4 ? 'border-right: none;' : ''"
      >
        <span style="font-size: 11px; color: #555; text-transform: uppercase; letter-spacing: 0.06em; font-weight: 500;">
          {{ stat.label }}
        </span>
        <span style="font-size: 16px; font-weight: 600; color: #f0f0f0; margin-top: 2px;">
          {{ stat.val }}
        </span>
      </div>

    </div>
  </div>
</template>
