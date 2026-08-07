<script lang="ts" setup>
import { useBaseStore, useBlockchain, useFormatter } from '@/stores';
import DynamicComponent from '@/components/dynamic/DynamicComponent.vue';
import { computed, ref } from '@vue/reactivity';
import type { Tx, TxResponse } from '@/types';

import { JsonViewer } from 'vue3-json-viewer';
// if you used v1.0.5 or latster ,you should add import "vue3-json-viewer/dist/index.css"
import 'vue3-json-viewer/dist/index.css';

const props = defineProps(['hash', 'chain']);

const blockchain = useBlockchain();
const baseStore = useBaseStore();
const format = useFormatter();

// ── Theme ──────────────────────────────────────────────────────────────────────
const isLight = computed(() => baseStore.theme === 'light')
const t0      = computed(() => isLight.value ? '#111111' : '#f0f0f0')
const t1      = computed(() => isLight.value ? '#444444' : '#d0d0d0')
const cardBg  = computed(() => isLight.value ? '#ffffff' : '#141414')
const cardBd  = computed(() => isLight.value ? '#e0e0e0' : '#2d2d2d')
const msgBg   = computed(() => isLight.value ? '#f8f8f8' : '#111111')
const msgBd   = computed(() => isLight.value ? '#e8e8e8' : '#222222')
const rowAlt  = computed(() => isLight.value ? 'rgba(0,0,0,0.03)' : 'rgba(0,0,0,0.18)')
const rowBd   = computed(() => isLight.value ? '#f0f0f0' : '#1a1a1a')
const tx = ref(
  {} as {
    tx: Tx;
    tx_response: TxResponse;
  }
);
if (props.hash) {
  blockchain.rpc.getTx(props.hash).then((x) => (tx.value = x));
}
const messages = computed(() => {
  return (
    tx.value.tx?.body?.messages.map((x) => {
      if (x.packet?.data) {
        // @ts-ignore
        x.message = format.base64ToString(x.packet.data);
      }
      return x;
    }) || []
  );
});

// ── copy hash ─────────────────────────────────────────────────────────────────
const copied = ref(false);
function copyHash() {
  const h = tx.value.tx_response?.txhash;
  if (!h) return;
  navigator.clipboard.writeText(h).then(() => {
    copied.value = true;
    setTimeout(() => { copied.value = false; }, 2000);
  }).catch(() => {});
}

// ── coin formatting ────────────────────────────────────────────────────────────
function fmtCoins(coins: any): string {
  if (!coins) return '—';
  const arr = Array.isArray(coins) ? coins : [coins];
  return arr.map((c: any) => {
    if (!c || !c.denom) return '';
    const denom: string = c.denom;
    const amount: string = c.amount || '0';
    if (denom === 'minf') {
      const n = BigInt(amount);
      const whole = n / 1_000_000n;
      const frac  = n % 1_000_000n;
      return frac > 0n
        ? `${whole.toLocaleString()}.${frac.toString().padStart(6, '0').replace(/0+$/, '')} INF`
        : `${whole.toLocaleString()} INF`;
    }
    return `${Number(amount).toLocaleString()} ${denom.toUpperCase()}`;
  }).filter(Boolean).join(' + ');
}

// ── message metadata for known Cosmos message types ───────────────────────────
interface MsgRow { key: string; val: string; isAddr?: boolean }
interface MsgDisplay { icon: string; label: string; rows: MsgRow[]; raw?: any }

function msgMeta(msg: any): MsgDisplay {
  const type: string = msg['@type'] || '';
  const label = type.split('.').pop()?.replace(/^Msg/, '') ?? 'Unknown';

  if (type.endsWith('MsgSend')) return { icon: '↑', label: 'Send', rows: [
    { key: 'From',   val: msg.from_address ?? '', isAddr: true },
    { key: 'To',     val: msg.to_address   ?? '', isAddr: true },
    { key: 'Amount', val: fmtCoins(msg.amount) },
  ]};
  if (type.endsWith('MsgDelegate')) return { icon: '⤵', label: 'Delegate', rows: [
    { key: 'Delegator', val: msg.delegator_address ?? '', isAddr: true },
    { key: 'Validator', val: msg.validator_address ?? '', isAddr: true },
    { key: 'Amount',    val: fmtCoins(msg.amount ? [msg.amount] : []) },
  ]};
  if (type.endsWith('MsgUndelegate')) return { icon: '⤴', label: 'Undelegate', rows: [
    { key: 'Delegator', val: msg.delegator_address ?? '', isAddr: true },
    { key: 'Validator', val: msg.validator_address ?? '', isAddr: true },
    { key: 'Amount',    val: fmtCoins(msg.amount ? [msg.amount] : []) },
  ]};
  if (type.endsWith('MsgBeginRedelegate')) return { icon: '↔', label: 'Redelegate', rows: [
    { key: 'Delegator',      val: msg.delegator_address     ?? '', isAddr: true },
    { key: 'From Validator', val: msg.validator_src_address ?? '', isAddr: true },
    { key: 'To Validator',   val: msg.validator_dst_address ?? '', isAddr: true },
    { key: 'Amount',         val: fmtCoins(msg.amount ? [msg.amount] : []) },
  ]};
  if (type.endsWith('MsgWithdrawDelegatorReward')) return { icon: '↓', label: 'Claim Rewards', rows: [
    { key: 'Delegator', val: msg.delegator_address ?? '', isAddr: true },
    { key: 'Validator', val: msg.validator_address ?? '', isAddr: true },
  ]};
  if (type.endsWith('MsgVote') || type.endsWith('MsgVoteWeighted')) return { icon: '✓', label: 'Vote', rows: [
    { key: 'Voter',    val: msg.voter ?? '', isAddr: true },
    { key: 'Proposal', val: `#${msg.proposal_id}` },
    { key: 'Option',   val: msg.option ?? '' },
  ]};
  if (type.endsWith('MsgCreateValidator')) return { icon: '⬡', label: 'Create Validator', rows: [
    { key: 'Moniker',   val: msg.description?.moniker ?? '' },
    { key: 'Delegator', val: msg.delegator_address ?? '', isAddr: true },
    { key: 'Validator', val: msg.validator_address ?? '', isAddr: true },
    { key: 'Value',     val: fmtCoins(msg.value ? [msg.value] : []) },
  ]};
  if (type.endsWith('MsgEditValidator')) return { icon: '✎', label: 'Edit Validator', rows: [
    { key: 'Validator', val: msg.validator_address ?? '', isAddr: true },
    { key: 'Moniker',   val: msg.description?.moniker ?? '' },
  ]};
  if (type.endsWith('MsgWithdrawValidatorCommission')) return { icon: '↓', label: 'Withdraw Commission', rows: [
    { key: 'Validator', val: msg.validator_address ?? '', isAddr: true },
  ]};

  // Unknown — fall through to DynamicComponent
  return { icon: '◆', label, rows: [], raw: msg };
}
</script>

<template>
  <div class="inf-detail" :class="{ 'inf-light': isLight }">

    <!-- ── Loading ──────────────────────────────────────────────────────────── -->
    <div v-if="!tx.tx_response"
      style="display:flex;align-items:center;justify-content:center;padding:80px;color:#555;font-size:14px;">
      Loading transaction…
    </div>

    <div v-else>

      <!-- ── Status + hash header ─────────────────────────────────────────────── -->
      <div class="inf-card" style="margin-bottom:16px;">
        <!-- Status pill -->
        <div style="margin-bottom:16px;display:flex;align-items:center;gap:14px;flex-wrap:wrap;">
          <span :style="`
            display:inline-flex;align-items:center;gap:7px;
            padding:5px 14px;border-radius:20px;font-size:13px;font-weight:600;
            background:${tx.tx_response.code === 0 ? 'rgba(74,222,128,0.12)' : 'rgba(248,113,113,0.12)'};
            border:1px solid ${tx.tx_response.code === 0 ? 'rgba(74,222,128,0.35)' : 'rgba(248,113,113,0.35)'};
            color:${tx.tx_response.code === 0 ? '#4ade80' : '#f87171'};
          `">
            <span :style="`width:7px;height:7px;border-radius:50%;background:${tx.tx_response.code === 0 ? '#4ade80' : '#f87171'};display:inline-block;`"></span>
            {{ tx.tx_response.code === 0 ? 'Success' : 'Failed' }}
          </span>
          <span v-if="tx.tx_response.code !== 0"
            style="font-size:12px;color:#f87171;font-family:'SF Mono',monospace;word-break:break-all;">
            {{ tx.tx_response.raw_log }}
          </span>
        </div>
        <!-- Hash + copy -->
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
          <span style="font-size:10px;color:#444;text-transform:uppercase;letter-spacing:0.06em;flex-shrink:0;">Tx Hash</span>
          <span :style="{ fontFamily: '\'SF Mono\',monospace', fontSize: '13px', color: t1, wordBreak: 'break-all', flex: '1' }">
            {{ tx.tx_response.txhash }}
          </span>
          <button @click="copyHash()"
            style="background:none;border:none;cursor:pointer;padding:3px;color:#555;display:flex;align-items:center;flex-shrink:0;"
            :title="copied ? 'Copied!' : 'Copy hash'">
            <span v-if="copied" style="font-size:13px;color:#4ade80;">✓</span>
            <svg v-else width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
          </button>
        </div>
      </div>

      <!-- ── Details table ─────────────────────────────────────────────────────── -->
      <div class="inf-card" style="padding:0;margin-bottom:16px;overflow:hidden;">
        <table class="inf-table">
          <tbody>
            <tr>
              <td class="label-cell">Height</td>
              <td>
                <RouterLink :to="`/${props.chain}/block/${tx.tx_response.height}`" class="inf-link"
                  style="font-family:'SF Mono',monospace;">
                  #{{ Number(tx.tx_response.height).toLocaleString() }}
                </RouterLink>
              </td>
            </tr>
            <tr>
              <td class="label-cell">Timestamp</td>
              <td :style="{ color: t1 }">
                {{ format.toLocaleDate(tx.tx_response.timestamp) }}
                <span style="color:#555;margin-left:8px;font-size:12px;">
                  ({{ format.toDay(tx.tx_response.timestamp, 'from') }})
                </span>
              </td>
            </tr>
            <tr>
              <td class="label-cell">Fee</td>
              <td :style="{ fontFamily: '\'SF Mono\',monospace', color: t1 }">
                {{ format.formatTokens(tx.tx?.auth_info?.fee?.amount, true, '0,0.[00]') || '—' }}
              </td>
            </tr>
            <tr>
              <td class="label-cell">Gas Used / Wanted</td>
              <td style="font-family:'SF Mono',monospace;color:#888;">
                {{ Number(tx.tx_response.gas_used).toLocaleString() }}
                /
                {{ Number(tx.tx_response.gas_wanted).toLocaleString() }}
                <span v-if="Number(tx.tx_response.gas_wanted) > 0"
                  style="margin-left:8px;font-size:12px;color:#555;">
                  ({{ ((Number(tx.tx_response.gas_used) / Number(tx.tx_response.gas_wanted)) * 100).toFixed(1) }}%)
                </span>
              </td>
            </tr>
            <tr v-if="tx.tx?.body?.memo">
              <td class="label-cell">Memo</td>
              <td style="color:#888;font-size:13px;">{{ tx.tx.body.memo }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- ── Messages ──────────────────────────────────────────────────────────── -->
      <div class="inf-card" style="margin-bottom:16px;">
        <h3 class="inf-section-title" style="margin-bottom:16px;">
          Messages
          <span style="font-weight:400;color:#444;margin-left:8px;">({{ messages.length }})</span>
        </h3>

        <div v-if="!messages.length" style="color:#444;font-size:13px;text-align:center;padding:20px 0;">
          No messages
        </div>

        <div v-for="(msg, i) in messages" :key="i" style="margin-bottom:10px;">

          <!-- Known message type: structured table -->
          <div v-if="msgMeta(msg).rows.length > 0" class="msg-card">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
              <span style="font-size:20px;line-height:1;">{{ msgMeta(msg).icon }}</span>
              <span :style="{ fontSize: '15px', fontWeight: '600', color: t0 }">{{ msgMeta(msg).label }}</span>
              <span style="font-size:11px;color:#888;font-family:'SF Mono',monospace;margin-left:auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
                {{ msg['@type'] }}
              </span>
            </div>
            <table style="width:100%;border-collapse:collapse;">
              <tbody>
                <tr v-for="row in msgMeta(msg).rows" :key="row.key">
                  <td style="padding:7px 0;font-size:12px;color:#888;width:140px;vertical-align:middle;white-space:nowrap;">
                    {{ row.key }}
                  </td>
                  <td style="padding:7px 0 7px 8px;font-size:13px;vertical-align:middle;word-break:break-all;">
                    <RouterLink v-if="row.isAddr && row.val"
                      :to="`/${props.chain}/account/${row.val}`"
                      class="inf-link"
                      style="font-family:'SF Mono',monospace;">
                      {{ row.val }}
                    </RouterLink>
                    <span v-else :style="{ fontFamily: '\'SF Mono\',monospace', color: t1 }">
                      {{ row.val || '—' }}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Unknown/fallback: DynamicComponent -->
          <div v-else class="msg-card msg-raw">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
              <span style="font-size:20px;line-height:1;">{{ msgMeta(msg).icon }}</span>
              <span :style="{ fontSize: '15px', fontWeight: '600', color: t0 }">{{ msgMeta(msg).label }}</span>
              <span style="font-size:11px;color:#888;font-family:'SF Mono',monospace;margin-left:auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
                {{ msg['@type'] }}
              </span>
            </div>
            <DynamicComponent :value="msg" />
          </div>

        </div>
      </div>

      <!-- ── Raw JSON ──────────────────────────────────────────────────────────── -->
      <div class="inf-card">
        <h3 class="inf-section-title" style="margin-bottom:14px;">Raw JSON</h3>
        <JsonViewer
          :value="tx"
          :theme="baseStore.theme"
          style="background:transparent"
          copyable
          boxed
          sort
          expand-depth="5"
        />
      </div>

    </div>
  </div>
</template>

<style scoped>
.inf-detail {
  color: v-bind(t0);
  font-family: 'Inter', system-ui, sans-serif;
}

.inf-card {
  background: v-bind(cardBg);
  border: 1px solid v-bind(cardBd);
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
  border-bottom: 1px solid v-bind(rowBd);
  vertical-align: middle;
}
.inf-table tr:last-child td { border-bottom: none; }
.inf-table tr:nth-child(even) td { background: v-bind(rowAlt); }
.label-cell {
  width: 180px !important;
  font-size: 12px !important;
  color: #888 !important;
  font-weight: 500;
  white-space: nowrap;
}

.inf-section-title {
  font-size: 12px; font-weight: 600; color: #888;
  text-transform: uppercase; letter-spacing: 0.07em; margin: 0;
}

.inf-link {
  color: #e8a500;
  text-decoration: none;
}
.inf-link:hover { text-decoration: underline; }

.msg-card {
  background: v-bind(msgBg);
  border: 1px solid v-bind(msgBd);
  border-radius: 6px;
  padding: 16px 20px;
}
.msg-raw :deep(.grid) { color: #888; }
.msg-raw :deep(.font-semibold) { color: #888; font-size: 12px; }
.msg-raw :deep(a) { color: #e8a500 !important; }
.msg-raw :deep(.text-primary) { color: #e8a500 !important; }
.msg-raw :deep(.dark\:invert) { filter: none !important; }
</style>
