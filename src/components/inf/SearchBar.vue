<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'

const props = defineProps<{ chain: string }>()
const router = useRouter()
const query = ref('')
const focused = ref(false)

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
  <form @submit.prevent="handleSearch" style="position:relative;width:100%;">
    <input
      v-model="query"
      type="text"
      placeholder="Search block height, tx hash, or address..."
      @focus="focused = true"
      @blur="focused = false"
      :style="`
        width: 100%;
        background: #1a1a1a;
        border: 1px solid ${focused ? '#e8a500' : '#2d2d2d'};
        border-radius: 8px;
        padding: 10px 44px 10px 16px;
        font-size: 14px;
        color: #f0f0f0;
        outline: none;
        box-sizing: border-box;
        font-family: 'SF Mono', 'Fira Code', monospace;
        transition: border-color 0.15s;
      `"
    />
    <button
      type="submit"
      style="
        position: absolute; right: 12px; top: 50%; transform: translateY(-50%);
        background: none; border: none; cursor: pointer; color: #888;
        padding: 0; display: flex; align-items: center;
      "
    >
      <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <circle cx="11" cy="11" r="8"/>
        <path d="m21 21-4.35-4.35"/>
      </svg>
    </button>
  </form>
</template>
