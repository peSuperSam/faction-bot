<template>
  <div>
    <div class="topbar">
      <h1>IA de regras</h1>
    </div>
    <p v-if="message" class="banner" :class="ok ? 'ok' : 'bad'">{{ message }}</p>
    <article class="card">
      <h2>Diagnóstico</h2>
      <form @submit.prevent="diagnose">
        <label class="field">
          <span>Pergunta</span>
          <input v-model="question" maxlength="500" />
        </label>
        <button class="btn" :disabled="busy">Inspecionar</button>
      </form>
      <pre v-if="info" class="muted" style="white-space: pre-wrap">{{ pretty }}</pre>
    </article>
    <article class="card" style="margin-top: 16px">
      <div class="actions">
        <button class="btn gold" :disabled="busy" @click="reloadRules">Recarregar regras</button>
      </div>
      <h2>Fontes</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>Documento</th><th>Trechos</th><th>Indexado</th></tr>
          </thead>
          <tbody>
            <tr v-for="doc in data?.documents || []" :key="doc.name">
              <td>{{ doc.name }}</td>
              <td>{{ doc.chunks }}</td>
              <td>{{ doc.indexedAt }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </article>
    <article class="card" style="margin-top: 16px">
      <h2>Sem resultado / recusas</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>Quando</th><th>Resultado</th><th>Tema</th><th>Pergunta</th></tr>
          </thead>
          <tbody>
            <tr v-for="row in data?.misses || []" :key="row.createdAt + row.question">
              <td>{{ row.createdAt }}</td>
              <td>{{ row.outcome }}</td>
              <td>{{ row.theme }}</td>
              <td>{{ row.question }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </article>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { api } from '../api';

const data = ref(null);
const question = ref('');
const info = ref(null);
const busy = ref(false);
const message = ref('');
const ok = ref(false);
const pretty = computed(() => (info.value ? JSON.stringify(info.value, null, 2) : ''));

async function load() {
  data.value = await api('/v1/ai');
}

async function diagnose() {
  busy.value = true;
  try {
    info.value = await api('/v1/ai/diagnose', {
      method: 'POST',
      body: { question: question.value },
    });
  } catch (err) {
    message.value = err.message;
    ok.value = false;
  } finally {
    busy.value = false;
  }
}

async function reloadRules() {
  busy.value = true;
  try {
    const result = await api('/v1/ai/reload', { method: 'POST' });
    message.value = result.aborted
      ? 'Recarga recusada; a base anterior foi mantida.'
      : `${result.indexed} documento(s) indexado(s).`;
    ok.value = !result.aborted;
    await load();
  } catch (err) {
    message.value = err.message;
    ok.value = false;
  } finally {
    busy.value = false;
  }
}

onMounted(async () => {
  try {
    await load();
  } catch (err) {
    message.value = err.message;
  }
});
</script>
