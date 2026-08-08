<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useBaseStore } from '@/stores'

const base = useBaseStore()
const isDark = computed(() => base.theme === 'dark')

function applyTheme(t: 'dark' | 'light') {
  if (t === 'light') {
    document.documentElement.classList.add('light')
    document.documentElement.classList.remove('dark')
  } else {
    document.documentElement.classList.add('dark')
    document.documentElement.classList.remove('light')
  }
  document.documentElement.setAttribute('data-theme', t)
  window.localStorage.setItem('theme', t)
  base.theme = t
}

function toggle() {
  applyTheme(base.theme === 'dark' ? 'light' : 'dark')
}

onMounted(() => {
  applyTheme(base.theme)
})
</script>

<template>
  <button @click="toggle" class="tt-btn" :title="isDark ? 'Switch to light mode' : 'Switch to dark mode'">
    <!-- Sun: shown in dark mode (switch to light) -->
    <svg v-if="isDark" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"
      stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="5"/>
      <line x1="12" y1="1" x2="12" y2="3"/>
      <line x1="12" y1="21" x2="12" y2="23"/>
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
      <line x1="1" y1="12" x2="3" y2="12"/>
      <line x1="21" y1="12" x2="23" y2="12"/>
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
    </svg>
    <!-- Moon: shown in light mode (switch to dark) -->
    <svg v-else width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"
      stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
    </svg>
  </button>
</template>

<style scoped>
.tt-btn {
  background: none;
  border: 1px solid rgba(128,128,128,0.35);
  border-radius: 6px;
  padding: 5px 8px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: inherit;
  opacity: 0.7;
  flex-shrink: 0;
  transition: opacity .15s, border-color .15s;
}
.tt-btn:hover { opacity: 1; border-color: #00C805; }
</style>
