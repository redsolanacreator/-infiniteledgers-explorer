<script setup lang="ts">
import { computed } from 'vue'
import { useBaseStore } from '@/stores'

const CHAIN = 'infiniteledgers'
const CHAIN_ID = 'infiniteledgers-1'

const baseStore = useBaseStore()
const isLight = computed(() => baseStore.theme === 'light')
</script>

<template>
  <footer class="app-footer" :class="{ 'theme-light': isLight }">
    <div class="af-inner">
      <RouterLink to="/" class="af-brand">
        <img src="/logos/infiniteledgers.png" alt="INF" class="af-logo" />
        <span class="af-name">Infinite Ledgers</span>
      </RouterLink>
      <span class="af-chain-id">{{ CHAIN_ID }}</span>

      <p class="af-desc">
        A sovereign Cosmos SDK blockchain with a fixed 400,000,000 INF supply and a
        Bitcoin-style halving emission schedule.
      </p>

      <nav class="af-nav">
        <RouterLink to="/" class="af-link">Home</RouterLink>
        <RouterLink :to="`/${CHAIN}/block`" class="af-link">Blocks</RouterLink>
        <RouterLink :to="`/${CHAIN}/tx`" class="af-link">Transactions</RouterLink>
        <RouterLink :to="`/${CHAIN}/staking`" class="af-link">Validators</RouterLink>
        <RouterLink to="/tokens" class="af-link">Tokens</RouterLink>
      </nav>

      <div class="af-copyright">&copy; 2026</div>
    </div>
  </footer>
</template>

<style scoped>
.app-footer {
  background: #000000;
  border-top: 1px solid #2C2C2E;
  padding: 20px 24px 18px;
  margin-top: 8px;
}
.af-inner {
  max-width: 1280px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  text-align: center;
}
.af-brand {
  display: flex;
  align-items: center;
  gap: 8px;
  text-decoration: none;
}
.af-logo { width: 20px; height: 20px; border-radius: 50%; }
.af-name { font-size: 14px; font-weight: 700; color: #FFFFFF; letter-spacing: -0.02em; }
.af-chain-id { font-size: 11px; color: #8E8E93; font-family: 'SF Mono', monospace; margin-top: -4px; }
.af-desc { font-size: 12px; color: #8E8E93; max-width: 520px; line-height: 1.5; margin: 4px 0 2px; }
.af-nav { display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 4px 14px; margin-top: 4px; }
.af-link { font-size: 12px; color: #8E8E93; text-decoration: none; transition: color .15s; }
.af-link:hover { color: #00C805; }
.af-copyright { font-size: 11px; color: #8E8E93; margin-top: 6px; }

/* Light theme */
.app-footer.theme-light { background: #f5f7fa; border-top-color: #e0e0e0; }
.app-footer.theme-light .af-name { color: #111111; }
.app-footer.theme-light .af-chain-id { color: #888; }
.app-footer.theme-light .af-desc { color: #777; }
.app-footer.theme-light .af-link { color: #666; }
.app-footer.theme-light .af-link:hover { color: #00C805; }
.app-footer.theme-light .af-copyright { color: #999; }
</style>
