<template>
  <div>
    <div class="topbar">
      <h1>Status</h1>
    </div>
    <p v-if="error" class="banner bad">{{ error }}</p>
    <div class="grid cards" v-if="data">
      <article class="card">
        <div class="muted">API</div>
        <h3>{{ data.api }}</h3>
      </article>
      <article class="card">
        <div class="muted">Bot</div>
        <h3>{{ data.bot?.connected ? 'conectado' : 'sem heartbeat' }}</h3>
      </article>
      <article class="card">
        <div class="muted">Circuit breaker</div>
        <h3>{{ data.circuit?.open ? 'aberto' : 'fechado' }}</h3>
      </article>
    </div>
    <article class="card" style="margin-top: 16px" v-if="canBackup">
      <div class="actions">
        <button class="btn" :disabled="busy" @click="backup">Gerar backup agora</button>
      </div>
      <h2>Backups</h2>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Arquivo</th><th>Quando</th><th>Tamanho</th></tr></thead>
          <tbody>
            <tr v-for="row in data?.backups || []" :key="row.name">
              <td>{{ row.name }}</td>
              <td>{{ row.mtime }}</td>
              <td>{{ row.size }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </article>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';
import { api } from '../api';
import { usePageData } from '../usePage';

const props = defineProps({ me: Object });
const { data, error, reload } = usePageData('/v1/status');
const busy = ref(false);
const canBackup = computed(() => ['leader', 'developer'].includes(props.me?.user?.role));

async function backup() {
  busy.value = true;
  try {
    await api('/v1/backup', { method: 'POST' });
    await reload({ force: true });
  } catch (err) {
    error.value = err.message;
  } finally {
    busy.value = false;
  }
}
</script>
