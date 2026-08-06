<script lang="ts" setup>
import { onMounted, ref } from 'vue';
import TxsElement from '@/components/dynamic/TxsElement.vue';
import Loading from '@/components/Loading.vue';
import { computed } from '@vue/reactivity';
import { onBeforeRouteUpdate } from 'vue-router';
import { useBaseStore, useFormatter } from '@/stores';
import type { Block } from '@/types';
import Countdown from '@/components/Countdown.vue';

const props = defineProps(['height', 'chain']);

const store = useBaseStore();
const format = useFormatter();
const current = ref({} as Block);
const target = ref(Number(props.height || 0));
const loading = ref(true);

const height = computed(() => {
  return Number(current.value.block?.header?.height || props.height || 0);
});

const isFutureBlock = computed(() => {
  const latest = store.latest?.block?.header.height;
  if (!latest) return false;
  return target.value > Number(latest);
});

const remainingBlocks = computed(() => {
  const latest = store.latest?.block?.header.height;
  return latest ? Number(target.value) - Number(latest) : 0;
});

const estimateTime = computed(() => {
  const seconds = Number((remainingBlocks.value * store.blocktime).toFixed(2));
  return seconds;
});

const estimateDate = computed(() => {
  return new Date(new Date().getTime() + estimateTime.value);
});

const edit = ref(false);
const newHeight = ref(props.height);
function updateTarget() {
  target.value = Number(newHeight.value);
  loadBlock(target.value);
}

async function loadBlock(h: number | string) {
  loading.value = true;
  try {
    if (!store.latest?.block?.header?.height) {
      await store.fetchLatest();
    }
    const latest = store.latest?.block?.header?.height;
    if (latest && Number(h) <= Number(latest)) {
      current.value = await store.fetchBlock(h);
    } else {
      current.value = {} as Block;
    }
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  loadBlock(target.value);
});

onBeforeRouteUpdate(async (to, from, next) => {
  if (from.path !== to.path) {
    target.value = Number(to.params.height);
    current.value = {} as Block;
    loadBlock(target.value);
  }
  next();
});
</script>

<template>
  <div class="inf-detail">

    <!-- ── Loading ──────────────────────────────────────────────────────── -->
    <div v-if="loading" style="display:flex;align-items:center;justify-content:center;padding:80px;color:#555;font-size:14px;">
      Loading block #{{ target.toLocaleString() }}…
    </div>

    <!-- ── Future block countdown ────────────────────────────────────────── -->
    <div v-else-if="isFutureBlock">
      <div v-if="remainingBlocks > 0">
        <div class="inf-card" style="text-align:center;padding:48px 24px;">
          <div style="font-size:32px;font-weight:700;color:#e8a500;margin-bottom:12px;">
            Block #{{ target.toLocaleString() }}
          </div>
          <div style="font-size:13px;color:#666;margin-bottom:28px;">This block has not been produced yet</div>
          <Countdown :time="estimateTime" css="md:!text-5xl font-sans md:mx-5" />
          <div style="font-size:13px;color:#888;margin-top:20px;">
            Estimated arrival:
            <span style="color:#f0f0f0;font-weight:600;margin-left:6px;">{{ format.toLocaleDate(estimateDate) }}</span>
          </div>
        </div>

        <div class="inf-card" style="padding:0;margin-top:16px;overflow:hidden;">
          <table class="inf-table">
            <tbody>
              <tr @click="edit = !edit" style="cursor:pointer;">
                <td class="label-cell">Target Block</td>
                <td style="color:#e8a500;font-family:monospace;">{{ target.toLocaleString() }}</td>
              </tr>
              <tr v-if="edit">
                <td colspan="2" style="padding:16px 20px;text-align:center;">
                  <div style="display:flex;gap:8px;justify-content:center;">
                    <input
                      v-model="newHeight" type="number"
                      style="background:#1a1a1a;border:1px solid #2d2d2d;border-radius:6px;padding:8px 12px;color:#f0f0f0;font-size:13px;outline:none;width:160px;"
                    />
                    <button @click="updateTarget()"
                      style="background:#e8a500;color:#000;border:none;border-radius:6px;padding:8px 16px;font-size:13px;font-weight:600;cursor:pointer;">
                      Go
                    </button>
                  </div>
                </td>
              </tr>
              <tr>
                <td class="label-cell">Current Height</td>
                <td style="font-family:monospace;color:#f0f0f0;">#{{ store.latest?.block?.header.height }}</td>
              </tr>
              <tr>
                <td class="label-cell">Blocks Remaining</td>
                <td style="font-family:monospace;color:#f0f0f0;">{{ remainingBlocks.toLocaleString() }}</td>
              </tr>
              <tr>
                <td class="label-cell">Avg Block Time</td>
                <td style="font-family:monospace;color:#f0f0f0;">{{ (store.blocktime / 1000).toFixed(1) }}s</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- ── Block data ────────────────────────────────────────────────────── -->
    <div v-else>

      <!-- Header: height + prev/next + time -->
      <div class="inf-card" style="margin-bottom:16px;">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;">
          <div style="display:flex;align-items:center;gap:14px;">
            <RouterLink
              :to="`/${store.blockchain.chainName}/block/${height - 1}`"
              class="inf-nav-btn"
              title="Previous block"
            >←</RouterLink>
            <h1 style="font-size:26px;font-weight:700;color:#e8a500;font-variant-numeric:tabular-nums;margin:0;">
              Block #{{ height.toLocaleString() }}
            </h1>
            <RouterLink
              :to="`/${store.blockchain.chainName}/block/${height + 1}`"
              class="inf-nav-btn"
              title="Next block"
            >→</RouterLink>
          </div>
          <div style="text-align:right;">
            <div style="font-size:13px;color:#d0d0d0;">{{ format.toLocaleDate(current.block?.header?.time) }}</div>
            <div style="font-size:12px;color:#555;margin-top:3px;">{{ format.toDay(current.block?.header?.time, 'from') }}</div>
          </div>
        </div>
        <!-- Block hash -->
        <div v-if="current.block_id?.hash"
          style="margin-top:14px;padding-top:14px;border-top:1px solid #1e1e1e;display:flex;align-items:flex-start;gap:10px;">
          <span style="font-size:10px;color:#444;text-transform:uppercase;letter-spacing:0.06em;padding-top:2px;flex-shrink:0;">Hash</span>
          <span style="font-size:12px;color:#666;font-family:'SF Mono',monospace;word-break:break-all;">{{ current.block_id.hash }}</span>
        </div>
      </div>

      <!-- Details table -->
      <div class="inf-card" style="padding:0;margin-bottom:16px;overflow:hidden;">
        <table class="inf-table">
          <tbody>
            <tr>
              <td class="label-cell">Chain ID</td>
              <td style="font-family:'SF Mono',monospace;color:#f0f0f0;">{{ current.block?.header?.chain_id }}</td>
            </tr>
            <tr>
              <td class="label-cell">Proposer</td>
              <td>
                <span style="color:#e8a500;font-family:'SF Mono',monospace;font-size:13px;">
                  {{ format.validator(current.block?.header?.proposer_address) || current.block?.header?.proposer_address || '—' }}
                </span>
              </td>
            </tr>
            <tr>
              <td class="label-cell">Transactions</td>
              <td>
                <span :style="`color:${(current.block?.data?.txs?.length || 0) > 0 ? '#4ade80' : '#888'};font-family:monospace;`">
                  {{ current.block?.data?.txs?.length || 0 }}
                </span>
              </td>
            </tr>
            <tr>
              <td class="label-cell">App Hash</td>
              <td style="font-family:'SF Mono',monospace;font-size:12px;color:#555;word-break:break-all;">
                {{ current.block?.header?.app_hash || '—' }}
              </td>
            </tr>
            <tr>
              <td class="label-cell">Validators Hash</td>
              <td style="font-family:'SF Mono',monospace;font-size:12px;color:#555;word-break:break-all;">
                {{ current.block?.header?.validators_hash || '—' }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Transactions in this block -->
      <div class="inf-card">
        <h3 class="inf-section-title" style="margin-bottom:14px;">
          Transactions
          <span style="font-weight:400;color:#444;margin-left:8px;">({{ current.block?.data?.txs?.length || 0 }})</span>
        </h3>
        <TxsElement :value="current.block?.data?.txs" />
      </div>

    </div>
  </div>
</template>

<style scoped>
.inf-detail {
  color: #f0f0f0;
  font-family: 'Inter', system-ui, sans-serif;
}

.inf-card {
  background: #141414;
  border: 1px solid #2d2d2d;
  border-radius: 8px;
  padding: 20px 24px;
  margin-bottom: 16px;
}

.inf-table {
  width: 100%;
  border-collapse: collapse;
}
.inf-table td {
  padding: 11px 20px;
  font-size: 13px;
  border-bottom: 1px solid #1a1a1a;
  vertical-align: middle;
}
.inf-table tr:last-child td { border-bottom: none; }
.inf-table tr:nth-child(even) td { background: rgba(0,0,0,0.18); }
.label-cell {
  width: 160px !important;
  font-size: 12px !important;
  color: #555 !important;
  font-weight: 500;
  white-space: nowrap;
}

.inf-nav-btn {
  display: flex; align-items: center; justify-content: center;
  width: 32px; height: 32px;
  background: #1a1a1a; border: 1px solid #2d2d2d; border-radius: 6px;
  color: #e8a500; text-decoration: none; font-size: 16px; font-weight: 600;
  transition: border-color 0.15s, background 0.15s;
}
.inf-nav-btn:hover { border-color: #e8a500; background: rgba(232,165,0,0.08); }

.inf-section-title {
  font-size: 12px; font-weight: 600; color: #666;
  text-transform: uppercase; letter-spacing: 0.07em; margin: 0;
}

/* ── Override TxsElement's internal DaisyUI table ─────────────────────── */
:deep(.table) {
  width: 100% !important;
  border-collapse: collapse !important;
  background: transparent !important;
  color: #d0d0d0 !important;
}
:deep(.table thead tr) { background: #1a1a1a !important; }
:deep(.table thead th) {
  padding: 8px 12px !important;
  font-size: 10px !important; font-weight: 500 !important;
  color: #555 !important; text-transform: uppercase; letter-spacing: 0.06em;
  background: #1a1a1a !important; border: none !important; border-bottom: 1px solid #2d2d2d !important;
}
:deep(.table tbody tr) { border-bottom: 1px solid #1a1a1a !important; background: transparent !important; }
:deep(.table tbody tr:hover) { background: #1e1e1e !important; }
:deep(.table tbody td) {
  padding: 9px 12px !important; font-size: 12px !important;
  color: #d0d0d0 !important; background: transparent !important;
  border: none !important; font-family: 'SF Mono', monospace;
}
:deep(.text-primary) { color: #e8a500 !important; }
:deep(.dark\:invert) { filter: none !important; }
:deep(.text-center) { color: #555; font-size: 13px; padding: 20px; }
:deep(.overflow-x-auto) { overflow-x: auto; }
</style>
