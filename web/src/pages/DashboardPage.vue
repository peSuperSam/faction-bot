<template>
  <div>
    <div class="topbar">
      <div>
        <h1>Semana atual</h1>
        <p class="muted">{{ data?.period?.label }} · {{ data?.period?.startsAt }} → {{ data?.period?.endsAt }}</p>
      </div>
    </div>
    <p v-if="error" class="banner bad">{{ error }}</p>
    <div class="grid cards" v-if="data">
      <article class="card" v-for="item in summary" :key="item.label">
        <div class="muted">{{ item.label }}</div>
        <h3>{{ item.value }}</h3>
      </article>
    </div>
    <div class="grid" style="grid-template-columns: 1.2fr 0.8fr; margin-top: 18px">
      <article class="card">
        <h2>Metas</h2>
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>Material</th><th>Progresso</th></tr>
            </thead>
            <tbody>
              <tr v-for="goal in data?.goals || []" :key="goal.id">
                <td>{{ goal.displayName }}</td>
                <td>{{ goal.current }} / {{ goal.quantity }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </article>
      <article class="card">
        <h2>Ranking</h2>
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>#</th><th>Membro</th><th>Total</th></tr>
            </thead>
            <tbody>
              <tr v-for="row in data?.ranking || []" :key="row.userId">
                <td>{{ row.position }}</td>
                <td>{{ row.userTag }}</td>
                <td>{{ row.total }}</td>
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
  { label: 'Aprovados', value: data.value?.approvedCount ?? '—' },
  { label: 'Pendentes', value: data.value?.pendingCount ?? '—' },
  { label: 'Materiais', value: data.value?.materials?.length ?? '—' },
  { label: 'Metas', value: data.value?.goals?.length ?? '—' },
]);

onMounted(async () => {
  try {
    data.value = await api('/v1/dashboard');
  } catch (err) {
    error.value = err.message;
  }
});
</script>
