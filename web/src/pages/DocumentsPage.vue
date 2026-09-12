<template>
  <div class="docs-page">
    <div class="topbar">
      <div>
        <div class="eyebrow">GESTÃO</div>
        <h1>Regras da cidade</h1>
        <p class="muted">O que vocês publicarem aqui vira a base da IA neste servidor, sem vazar para outras cidades.</p>
      </div>
      <div class="actions">
        <select v-model="status">
          <option value="">Todos</option>
          <option value="draft">Rascunho</option>
          <option value="published">Publicado</option>
          <option value="archived">Arquivado</option>
        </select>
        <router-link v-if="canEdit" class="btn gold" to="/painel/documentos/novo">Novo</router-link>
        <button v-if="canEdit" class="btn" :disabled="busy || !documents.length" @click="publish">Publicar na IA</button>
      </div>
    </div>
    <p v-if="message" class="banner" :class="ok ? 'ok' : 'bad'">{{ message }}</p>
    <p v-if="error" class="banner bad">{{ error }}</p>

    <div class="grid steps-grid">
      <article class="card step-card">
        <span>1</span>
        <strong>Escrever</strong>
        <p>Crie um documento com as regras específicas desta cidade (horários, territórios, farm, hierarquia).</p>
      </article>
      <article class="card step-card">
        <span>2</span>
        <strong>Validar</strong>
        <p>O painel confere se o texto dá para indexar. Rascunho ainda não entra na IA.</p>
      </article>
      <article class="card step-card">
        <span>3</span>
        <strong>Publicar</strong>
        <p>A publicação gera uma release e substitui o índice desta cidade. Dá para restaurar depois.</p>
      </article>
    </div>

    <article class="card" style="margin-top: 16px">
      <div class="panel-heading">
        <h2>Acervo</h2>
        <span class="panel-count">{{ filtered.length }} documento(s)</span>
      </div>
      <div v-if="!ready" class="skel-stack">
        <div class="skel skel-line" v-for="n in 4" :key="n"></div>
      </div>
      <div v-else-if="!documents.length" class="empty-state">
        <strong>Nenhuma regra da cidade ainda.</strong>
        <p>
          As regras globais da Coroa já valem para todo mundo. Use este acervo só para o que é específico desta facção — a IA junta as duas camadas na hora de responder.
        </p>
        <router-link v-if="canEdit" class="btn gold" to="/painel/documentos/novo">Criar primeiro documento</router-link>
      </div>
      <div class="table-wrap" v-else>
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
              <td><span class="status-pill" :class="doc.status">{{ statusLabel(doc.status) }}</span></td>
              <td>{{ doc.publishedVersion || '—' }}</td>
              <td>{{ doc.updatedAt }}</td>
            </tr>
            <tr v-if="!filtered.length">
              <td colspan="5" class="empty-cell">Nenhum documento neste filtro.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </article>

    <article class="card" style="margin-top: 16px">
      <div class="panel-heading">
        <h2>Releases</h2>
        <router-link class="btn ghost" to="/painel/ia">Ver índice da IA</router-link>
      </div>
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
            <tr v-if="ready && !releases.length">
              <td colspan="4" class="empty-cell">Nenhuma publicação ainda. Enquanto isso, a IA usa só as regras globais.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </article>
  </div>
</template>

<script setup>
import { computed, onActivated, onMounted, ref } from 'vue';
import { api, invalidatePages, peekPage, prefetch } from '../api';

const props = defineProps({ me: Object });
const rank = { none: 0, member: 1, manager: 2, leader: 3, developer: 4 };
const canEdit = computed(() => (rank[props.me?.user?.role] || 0) >= rank.leader);

const documents = ref(peekPage('/v1/documents')?.documents || []);
const releases = ref(peekPage('/v1/releases')?.releases || []);
const status = ref('');
const busy = ref(false);
const message = ref('');
const ok = ref(false);
const error = ref('');
const ready = ref(Boolean(peekPage('/v1/documents')));
let skipActivate = true;

const filtered = computed(() =>
  documents.value.filter((doc) => !status.value || doc.status === status.value),
);

function statusLabel(value) {
  return (
    {
      draft: 'rascunho',
      published: 'publicado',
      archived: 'arquivado',
    }[value] || value
  );
}

async function load({ force = false } = {}) {
  try {
    const [docs, rel] = await Promise.all([
      prefetch('/v1/documents', { force }),
      prefetch('/v1/releases', { force }),
    ]);
    documents.value = docs.documents || [];
    releases.value = rel.releases || [];
    error.value = '';
    ready.value = true;
  } catch (err) {
    ready.value = true;
    if (!documents.value.length) {
      error.value = err.message;
    }
  }
}

async function publish() {
  busy.value = true;
  try {
    const result = await api('/v1/documents/publish', { method: 'POST', body: {} });
    if (!result.ok) {
      message.value = (result.rejected || []).join(' · ') || 'Validação recusada.';
      ok.value = false;
    } else {
      message.value = `Release ${result.releaseNumber} publicada. A IA deste servidor já está usando as regras da cidade.`;
      ok.value = true;
    }
    invalidatePages('/v1/documents', '/v1/releases', '/v1/ai');
    await load({ force: true });
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
    invalidatePages('/v1/documents', '/v1/releases', '/v1/ai');
    await load({ force: true });
  } catch (err) {
    message.value = err.message;
    ok.value = false;
  } finally {
    busy.value = false;
  }
}

onMounted(() => load());
onActivated(() => {
  if (skipActivate) {
    skipActivate = false;
    return;
  }
  load();
});
</script>
