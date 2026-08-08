<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useBaseStore } from '@/stores'

const props   = defineProps<{ chain: string }>()
const router  = useRouter()
const base    = useBaseStore()
const query   = ref('')
const focused = ref(false)

const isLight = computed(() => base.theme === 'light')
const bg      = computed(() => isLight.value ? '#ffffff' : '#1C1C1E')
const bdColor = computed(() => focused.value ? '#00C805' : (isLight.value ? '#d0d0d0' : '#2C2C2E'))
const txtColor = computed(() => isLight.value ? '#111111' : '#FFFFFF')

function handleSearch() {
  const q = query.value.trim()
  if (!q) return
  if (/^\d+$/.test(q)) {
    router.push(`/${props.chain}/block/${q}`)
  } else if (/^[0-9A-Fa-f]{64}$/.test(q)) {
    router.push(`/${props.chain}/tx/${q.toUpperCase()}`)
  } else if (q.toLowerCase().startsWith('inf')) {
    router.push(`/${props.chain}/account/${q}`)
  } else {
    router.push(`/${props.chain}/tx/${q}`)
  }
  query.value = ''
}
</script>

<template>
  <form @submit.prevent="handleSearch" class="sb-wrap">
    <input
      v-model="query"
      type="text"
      placeholder="Search block height, tx hash, or address..."
      class="sb-input"
      :style="{ background: bg, borderColor: bdColor, color: txtColor }"
      @focus="focused = true"
      @blur="focused = false"
    />
    <button type="submit" class="sb-btn">
      <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <circle cx="11" cy="11" r="8"/>
        <path d="m21 21-4.35-4.35"/>
      </svg>
    </button>
  </form>
</template>

<style scoped>
.sb-wrap { position: relative; width: 100%; }
.sb-input {
  width: 100%;
  border: 1px solid;
  border-radius: 8px;
  padding: 10px 44px 10px 16px;
  font-size: 14px;
  outline: none;
  box-sizing: border-box;
  font-family: 'SF Mono', 'Fira Code', monospace;
  transition: border-color 0.15s, background 0.15s;
}
.sb-input::placeholder { color: #8E8E93; }
.sb-btn {
  position: absolute; right: 12px; top: 50%; transform: translateY(-50%);
  background: none; border: none; cursor: pointer; color: #8E8E93;
  padding: 0; display: flex; align-items: center;
}
</style>
