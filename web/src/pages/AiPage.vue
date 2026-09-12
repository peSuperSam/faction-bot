<template>
  <div class="ai-page">
    <div class="topbar">
      <div>
        <div class="eyebrow">INTELIGÊNCIA</div>
        <h1>IA da cidade</h1>
        <p class="muted">A Coroa combina regras globais com o que esta facção publicar.</p>
      </div>
      <div class="actions">
        <router-link class="btn gold" to="/painel/documentos">Editar regras da cidade</router-link>
      </div>
    </div>
    <p v-if="message" class="banner" :class="ok ? 'ok' : 'bad'">{{ message }}</p>
    <p v-if="error" class="banner bad">{{ error }}</p>

    <div class="grid ai-intro">
      <article class="card">
        <div class="eyebrow">CAMADA 1</div>
        <h2>Regras globais</h2>
        <p class="muted">Leis e termos comuns, carregados dos arquivos da Coroa. Valem para todas as cidades.</p>
        <p class="stat-line"><strong>{{ globalSources.length }}</strong> fonte(s) indexada(s)</p>
      </article>
      <article class="card city-rules-card">
        <div class="eyebrow">CAMADA 2</div>
        <h2>Regras desta cidade</h2>
        <p class="muted">
          Cada servidor publica os próprios documentos. Só o que estiver publicado entra na IA daqui — outras cidades não veem.
        </p>
        <p class="stat-line">
          <strong>{{ publishedCityDocs.length }}</strong> publicado(s)
          · {{ cityDocs.length }} no acervo
        </p>
      </article>
    </div>

    <article class="card" style="margin-top: 16px">
      <div class="panel-heading">
        <div>
          <div class="eyebrow">DESTA CIDADE</div>
          <h2>Documentos da facção</h2>
        </div>
        <router-link class="btn" to="/painel/documentos/novo">Novo documento</router-link>
      </div>
      <div v-if="!data" class="skel-stack">
        <div class="skel skel-line" v-for="n in 3" :key="n"></div>
      </div>
      <div v-else-if="!cityDocs.length" class="empty-state">
        <strong>Esta cidade ainda não publicou regras próprias.</strong>
        <p>
          Crie um documento em markdown, valide e publique. A partir daí a IA responde com as regras específicas da sua cidade, sem misturar com as das outras.
        </p>
        <router-link class="btn gold" to="/painel/documentos">Abrir regras da cidade</router-link>
      </div>
      <div class="table-wrap" v-else>
        <table>
          <thead>
            <tr><th>Título</th><th>Identificador</th><th>Status</th><th>Versão</th></tr>
          </thead>
          <tbody>
            <tr v-for="doc in cityDocs" :key="doc.id">
              <td>
                <router-link :to="`/painel/documentos/${doc.id}`">{{ doc.title }}</router-link>
              </td>
              <td>{{ doc.slug }}</td>
              <td><span class="status-pill" :class="doc.status">{{ statusLabel(doc.status) }}</span></td>
              <td>{{ doc.publishedVersion || '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </article>

    <article class="card" style="margin-top: 16px">
      <h2>Plano e cota</h2>
      <div class="quota-grid">
        <div class="quota-card">
          <span>Plano</span>
          <strong>{{ data?.entitlement?.plan || '—' }}</strong>
        </div>
        <div class="quota-card">
          <span>Status</span>
          <strong>{{ data?.entitlement?.status || '—' }}</strong>
        </div>
        <div class="quota-card">
          <span>Uso no mês</span>
          <strong>{{ data?.entitlement?.used ?? 0 }}</strong>
        </div>
        <div class="quota-card">
          <span>Limite</span>
          <strong>{{ data?.entitlement?.unlimited ? 'Ilimitado' : (data?.entitlement?.monthlyLimit ?? '—') }}</strong>
        </div>
      </div>
      <p class="muted" style="margin-top: 12px">
        Circuito da IA: {{ data?.circuit?.open ? 'aberto' : 'fechado' }}.
      </p>
    </article>

    <article class="card" style="margin-top: 16px">
      <h2>Diagnóstico</h2>
      <form class="diagnose-form" @submit.prevent="diagnose">
        <label class="field">
          <span>Pergunta</span>
          <input v-model="question" maxlength="500" placeholder="Ex.: pode farmar no horário de peak?" />
        </label>
        <button class="btn" :disabled="busy">Inspecionar</button>
      </form>
      <pre v-if="info" class="muted diagnose-out">{{ pretty }}</pre>
    </article>

    <article class="card" style="margin-top: 16px">
      <div class="panel-heading">
        <div>
          <h2>Índice ativo</h2>
          <p class="muted">O que a IA está usando agora neste servidor.</p>
        </div>
        <button class="btn ghost" :disabled="busy" @click="reloadRules">Reindexar</button>
      </div>
      <p class="muted" style="margin-bottom: 12px">
        Reindexar recarrega as regras globais e republica a base desta cidade. Não apaga os documentos que vocês escreveram.
      </p>
      <div class="table-wrap" v-if="data">
        <table>
          <thead>
            <tr><th>Documento</th><th>Escopo</th><th>Trechos</th><th>Indexado</th></tr>
          </thead>
          <tbody>
            <tr v-for="doc in data.documents || []" :key="(doc.scope || 'global') + doc.name">
              <td>{{ doc.name }}</td>
              <td>{{ scopeLabel(doc.scope) }}</td>
              <td>{{ doc.chunks }}</td>
              <td>{{ doc.indexedAt }}</td>
            </tr>
            <tr v-if="!data.documents?.length">
              <td colspan="4" class="empty-cell">Nenhuma fonte indexada ainda.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </article>

    <article class="card" style="margin-top: 16px">
      <h2>Consumo diário</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>Dia</th><th>Pedidos</th><th>Tokens in</th><th>Tokens out</th><th>Custo est.</th></tr>
          </thead>
          <tbody>
            <tr v-for="row in data?.usage || []" :key="row.day">
              <td>{{ row.day }}</td>
              <td>{{ row.requests }}</td>
              <td>{{ row.input_tokens }}</td>
              <td>{{ row.output_tokens }}</td>
              <td>{{ row.estimated_cost }}</td>
            </tr>
            <tr v-if="data && !data.usage?.length">
              <td colspan="5" class="empty-cell">Sem consumo neste período.</td>
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
            <tr v-if="data && !data.misses?.length">
              <td colspan="4" class="empty-cell">Nenhuma recusa recente.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </article>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';
import { api, invalidatePages } from '../api';
import { usePageData } from '../usePage';

const { data, error, reload } = usePageData('/v1/ai');
const question = ref('');
const info = ref(null);
const busy = ref(false);
const message = ref('');
const ok = ref(false);
const pretty = computed(() => (info.value ? JSON.stringify(info.value, null, 2) : ''));
const cityDocs = computed(() => data.value?.guildDocuments || []);
const publishedCityDocs = computed(() => cityDocs.value.filter((doc) => doc.status === 'published'));
const globalSources = computed(() =>
  (data.value?.documents || []).filter((doc) => (doc.scope || 'global') !== 'guild'),
);

function scopeLabel(scope) {
  if (scope === 'guild') return 'cidade';
  return 'global';
}

function statusLabel(status) {
  return (
    {
      draft: 'rascunho',
      published: 'publicado',
      archived: 'arquivado',
    }[status] || status
  );
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
      : `${result.indexed} documento(s) global(is) reindexado(s). As regras da cidade foram republicadas no índice.`;
    ok.value = !result.aborted;
    invalidatePages('/v1/ai');
    await reload({ force: true });
  } catch (err) {
    message.value = err.message;
    ok.value = false;
  } finally {
    busy.value = false;
  }
}
</script>
