<template>
  <div>
    <div class="topbar">
      <h1>Documentos</h1>
      <div class="actions">
        <select v-model="status">
          <option value="">Todos</option>
          <option value="draft">Rascunho</option>
          <option value="published">Publicado</option>
          <option value="archived">Arquivado</option>
        </select>
        <router-link v-if="canEdit" class="btn gold" to="/painel/documentos/novo">Novo</router-link>
        <button v-if="canEdit" class="btn" :disabled="busy" @click="publish">Publicar</button>
      </div>
    </div>
    <p v-if="message" class="banner" :class="ok ? 'ok' : 'bad'">{{ message }}</p>
    <article class="card">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Título</th>
              <th>Identificador</th>
              <th>Status</th>
              <th>Versão</th>
              <th>Atualizado</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="doc in filtered" :key="doc.id">
              <td>
                <router-link :to="`/painel/documentos/${doc.id}`">{{ doc.title }}</router-link>
              </td>
              <td>{{ doc.slug }}</td>
              <td>{{ doc.status }}</td>
              <td>{{ doc.publishedVersion || '—' }}</td>
              <td>{{ doc.updatedAt }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </article>
    <article class="card" style="margin-top: 16px">
      <h2>Releases</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>#</th><th>Mensagem</th><th>Quando</th><th></th></tr>
          </thead>
          <tbody>
            <tr v-for="row in releases" :key="row.id">
              <td>{{ row.releaseNumber }}</td>
              <td>{{ row.message || '—' }}</td>
              <td>{{ row.publishedAt }}</td>
              <td>
                <button v-if="canEdit" class="btn ghost" @click="rollback(row.id)">Restaurar</button>
              </td>
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

const props = defineProps({ me: Object });
const rank = { none: 0, member: 1, manager: 2, leader: 3, developer: 4 };
const canEdit = computed(() => (rank[props.me?.user?.role] || 0) >= rank.leader);

const documents = ref([]);
const releases = ref([]);
const status = ref('');
const busy = ref(false);
const message = ref('');
const ok = ref(false);

const filtered = computed(() =>
  documents.value.filter((doc) => !status.value || doc.status === status.value),
);

async function load() {
  const [docs, rel] = await Promise.all([
    api('/v1/documents'),
    api('/v1/releases'),
  ]);
  documents.value = docs.documents || [];
  releases.value = rel.releases || [];
}

async function publish() {
  busy.value = true;
  try {
    const result = await api('/v1/documents/publish', { method: 'POST', body: {} });
    if (!result.ok) {
      message.value = (result.rejected || []).join(' · ') || 'Validação recusada.';
      ok.value = false;
    } else {
      message.value = `Release ${result.releaseNumber} publicada.`;
      ok.value = true;
    }
    await load();
  } catch (err) {
    message.value = err.message;
    ok.value = false;
  } finally {
    busy.value = false;
  }
}

async function rollback(id) {
  busy.value = true;
  try {
    await api(`/v1/releases/${id}/rollback`, { method: 'POST' });
    message.value = 'Release restaurada como nova publicação.';
    ok.value = true;
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
