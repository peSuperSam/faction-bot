<template>
  <div class="dashboard-page">
    <div class="topbar">
      <div>
        <div class="eyebrow">VISÃO GERAL</div>
        <h1>Semana atual</h1>
        <p class="muted">{{ data?.period?.label }} · {{ data?.period?.startsAt }} → {{ data?.period?.endsAt }}</p>
      </div>
      <div class="period-chip">
        <span class="status-dot"></span>
        Operação ativa
      </div>
    </div>
    <p v-if="error" class="banner bad">{{ error }}</p>
    <div class="grid metric-grid" v-if="data">
      <article class="card metric-card" v-for="item in summary" :key="item.label">
        <div class="metric-icon" :class="item.tone">{{ item.icon }}</div>
        <div class="metric-copy">
          <div class="muted">{{ item.label }}</div>
          <h3>{{ item.value }}</h3>
        </div>
        <div class="metric-accent" :class="item.tone"></div>
      </article>
    </div>
    <div class="grid dashboard-columns">
      <article class="card dashboard-panel goals-panel">
        <div class="panel-heading">
          <div>
            <div class="eyebrow">ACOMPANHAMENTO</div>
            <h2>Metas da facção</h2>
          </div>
          <span class="panel-count">{{ data?.goals?.length || 0 }} metas</span>
        </div>
        <div class="table-wrap">
          <table class="goals-table">
            <thead>
              <tr><th>Material</th><th>Progresso semanal</th></tr>
            </thead>
            <tbody>
              <tr v-for="goal in data?.goals || []" :key="goal.id">
                <td class="goal-name">{{ goal.displayName }}</td>
                <td>
                  <div class="progress-meta">
                    <span>{{ goal.current }} / {{ goal.quantity }}</span>
                    <strong>{{ progress(goal) }}%</strong>
                  </div>
                  <div class="progress-track">
                    <span :style="{ width: `${progress(goal)}%` }"></span>
                  </div>
                </td>
              </tr>
              <tr v-if="!data?.goals?.length">
                <td colspan="2" class="empty-cell">Nenhuma meta cadastrada nesta semana.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </article>
      <article class="card dashboard-panel ranking-panel">
        <div class="panel-heading">
          <div>
            <div class="eyebrow">DESEMPENHO</div>
            <h2>Ranking semanal</h2>
          </div>
          <span class="trophy">♛</span>
        </div>
        <div class="table-wrap">
          <table class="ranking-table">
            <thead>
              <tr><th>#</th><th>Membro</th><th>Total</th></tr>
            </thead>
            <tbody>
              <tr v-for="row in data?.ranking || []" :key="row.userId">
                <td><span class="rank-badge" :class="`rank-${row.position}`">{{ row.position }}</span></td>
                <td class="member-name">{{ row.userTag }}</td>
                <td class="total-value">{{ row.total }}</td>
              </tr>
              <tr v-if="!data?.ranking?.length">
                <td colspan="3" class="empty-cell">Ainda não há registros nesta semana.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </article>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { api } from '../api';

const data = ref(null);
const error = ref('');

const summary = computed(() => [
  { label: 'Aprovados', value: data.value?.approvedCount ?? '—', icon: '✓', tone: 'green' },
  { label: 'Pendentes', value: data.value?.pendingCount ?? '—', icon: '◷', tone: 'gold' },
  { label: 'Materiais', value: data.value?.materials?.length ?? '—', icon: '✦', tone: 'purple' },
  { label: 'Metas ativas', value: data.value?.goals?.length ?? '—', icon: '↗', tone: 'wine' },
]);

function progress(goal) {
  const current = Number(goal?.current || 0);
  const quantity = Number(goal?.quantity || 0);
  if (!quantity) return 0;
  return Math.min(100, Math.round((current / quantity) * 100));
}

onMounted(async () => {
  try {
    data.value = await api('/v1/dashboard');
  } catch (err) {
    error.value = err.message;
  }
});
</script>
