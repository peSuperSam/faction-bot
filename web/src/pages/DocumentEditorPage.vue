<template>
  <div>
    <div class="topbar">
      <div>
        <div class="eyebrow">REGRAS DA CIDADE</div>
        <h1>{{ isNew ? 'Novo documento' : form.title || 'Documento' }}</h1>
        <p class="muted">Rascunho fica só no painel. A IA só passa a usar o texto depois de publicar.</p>
      </div>
      <div class="actions">
        <router-link class="btn ghost" to="/painel/documentos">Voltar</router-link>
        <button v-if="canEdit" class="btn" :disabled="busy" @click="save">Salvar rascunho</button>
        <button v-if="canEdit" class="btn" :disabled="busy" @click="validate">Validar</button>
        <button v-if="canEdit && !isNew" class="btn gold" :disabled="busy" @click="publish">Publicar na IA</button>
      </div>
    </div>
    <p v-if="message" class="banner" :class="ok ? 'ok' : 'bad'">{{ message }}</p>
    <article class="card">
      <div class="actions" style="margin-bottom: 12px">
        <label class="field" style="flex: 1">
          <span>Título</span>
          <input v-model="form.title" :disabled="!canEdit" />
        </label>
        <label class="field" style="flex: 1">
          <span>Identificador</span>
          <input v-model="form.slug" :disabled="!isNew || !canEdit" />
        </label>
      </div>
      <div class="split-editor">
        <label class="field">
          <span>Rascunho</span>
          <textarea class="doc-editor" v-model="form.content" :disabled="!canEdit" />
        </label>
        <div class="field">
          <span>Preview</span>
          <pre class="doc-preview">{{ form.content }}</pre>
        </div>
      </div>
    </article>
    <article v-if="!isNew" class="card" style="margin-top: 16px">
      <h2>Histórico</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>Versão</th><th>Status</th><th>Mensagem</th><th>Quando</th><th></th></tr>
          </thead>
          <tbody>
            <tr v-for="row in versions" :key="row.id">
              <td>v{{ row.versionNumber }}</td>
              <td>{{ row.status }}</td>
              <td>{{ row.message || '—' }}</td>
              <td>{{ row.createdAt }}</td>
              <td>
                <button v-if="canEdit" class="btn ghost" @click="restore(row.versionNumber)">Restaurar</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </article>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, invalidatePages } from '../api';

defineOptions({ name: 'DocumentEditorPage' });

const props = defineProps({ me: Object });
const route = useRoute();
const router = useRouter();
const rank = { none: 0, member: 1, manager: 2, leader: 3, developer: 4 };
const canEdit = computed(() => (rank[props.me?.user?.role] || 0) >= rank.leader);
const isNew = computed(() => route.params.id === 'novo');
const busy = ref(false);
const message = ref('');
const ok = ref(false);
const versions = ref([]);
const form = reactive({
  title: '',
  slug: '',
  content: '',
});

async function load() {
  if (isNew.value) {
    form.title = '';
    form.slug = '';
    form.content = '';
    versions.value = [];
    return;
  }
  const data = await api(`/v1/documents/${route.params.id}`);
  form.title = data.document.title;
  form.slug = data.document.slug;
  form.content = data.draft?.content || data.published?.content || '';
  versions.value = data.versions || [];
}

async function save() {
  busy.value = true;
  try {
    if (isNew.value) {
      const created = await api('/v1/documents', {
        method: 'POST',
        body: { title: form.title, slug: form.slug, content: form.content },
      });
      message.value = 'Documento criado.';
      ok.value = true;
      invalidatePages('/v1/documents', '/v1/releases');
      await router.replace(`/painel/documentos/${created.document.id}`);
      return;
    }
    await api(`/v1/documents/${route.params.id}`, {
      method: 'PATCH',
      body: { title: form.title, content: form.content, message: 'edição pelo painel' },
    });
    message.value = 'Rascunho salvo.';
    ok.value = true;
    invalidatePages('/v1/documents');
    await load();
  } catch (err) {
    message.value = err.message;
    ok.value = false;
  } finally {
    busy.value = false;
  }
}

async function validate() {
  busy.value = true;
  try {
    const ids = isNew.value ? [] : [Number(route.params.id)];
    const result = await api('/v1/documents/validate', {
      method: 'POST',
      body: { documentIds: ids },
    });
    message.value = result.ok
      ? 'Documento válido para publicação.'
      : (result.rejected || []).join(' · ');
    ok.value = result.ok;
  } catch (err) {
    message.value = err.message;
    ok.value = false;
  } finally {
    busy.value = false;
  }
}

async function publish() {
  busy.value = true;
  try {
    await saveQuiet();
    const result = await api('/v1/documents/publish', {
      method: 'POST',
      body: { documentIds: [Number(route.params.id)] },
    });
    if (!result.ok) {
      message.value = (result.rejected || []).join(' · ') || 'Validação recusada.';
      ok.value = false;
    } else {
      message.value = `Release ${result.releaseNumber} publicada. A IA desta cidade já está usando este documento.`;
      ok.value = true;
      invalidatePages('/v1/documents', '/v1/releases', '/v1/ai');
      await load();
    }
  } catch (err) {
    message.value = err.message;
    ok.value = false;
  } finally {
    busy.value = false;
  }
}

async function saveQuiet() {
  if (isNew.value) {
    return;
  }
  await api(`/v1/documents/${route.params.id}`, {
    method: 'PATCH',
    body: { title: form.title, content: form.content, message: 'edição pelo painel' },
  });
}

async function restore(versionNumber) {
  busy.value = true;
  try {
    await api(`/v1/documents/${route.params.id}/restore`, {
      method: 'POST',
      body: { versionNumber },
    });
    message.value = `Versão ${versionNumber} restaurada no rascunho.`;
    ok.value = true;
    await load();
  } catch (err) {
    message.value = err.message;
    ok.value = false;
  } finally {
    busy.value = false;
  }
}

watch(() => route.params.id, load);
onMounted(async () => {
  try {
    await load();
  } catch (err) {
    message.value = err.message;
  }
});
</script>
