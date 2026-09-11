<template>
  <div>
    <div class="topbar">
      <h1>Configuração</h1>
    </div>
    <p v-if="message" class="banner" :class="ok ? 'ok' : 'bad'">{{ message }}</p>
    <article class="card">
      <form @submit.prevent="save">
        <label class="field">
          <span>Canal de log</span>
          <input v-model="form.log_channel_id" />
        </label>
        <label class="field">
          <span>Canal da administração</span>
          <input v-model="form.admin_channel_id" />
        </label>
        <label class="field">
          <span>Canal de farm</span>
          <input v-model="form.farm_channel_id" />
        </label>
        <label class="field">
          <span>Canal da IA</span>
          <input v-model="form.ai_channel_id" />
        </label>
        <label class="field" v-if="!formLocked.leader">
          <span>Cargo de líder</span>
          <input v-model="form.leader_role_id" />
        </label>
        <label class="field" v-if="!formLocked.manager">
          <span>Cargo de gerente</span>
          <input v-model="form.manager_role_id" />
        </label>
        <label class="field" v-if="!formLocked.member">
          <span>Cargo de membro</span>
          <input v-model="form.member_role_id" />
        </label>
        <label class="field">
          <span>Validação</span>
          <select v-model="form.auto_approve">
            <option :value="true">Auto-aprovar</option>
            <option :value="false">Pendente</option>
          </select>
        </label>
        <div class="actions">
          <button class="btn" :disabled="busy">Salvar</button>
        </div>
      </form>
    </article>
    <article class="card" style="margin-top: 16px">
      <h2>Materiais</h2>
      <form class="actions" @submit.prevent="addMaterial">
        <input v-model="newMaterial" placeholder="Nome do material" />
        <button class="btn gold">Adicionar</button>
      </form>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Nome</th><th></th></tr></thead>
          <tbody>
            <tr v-for="item in dashboard?.materials || []" :key="item.id">
              <td>{{ item.displayName }}</td>
              <td><button class="btn ghost" @click="removeMaterial(item.name)">Remover</button></td>
            </tr>
          </tbody>
        </table>
      </div>
    </article>
    <article class="card" style="margin-top: 16px">
      <h2>Publicar painel</h2>
      <form class="actions" @submit.prevent="publish">
        <input v-model="channelId" placeholder="ID do canal" />
        <button class="btn">Publicar</button>
      </form>
    </article>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import { api } from '../api';

const dashboard = ref(null);
const busy = ref(false);
const message = ref('');
const ok = ref(false);
const newMaterial = ref('');
const channelId = ref('');
const formLocked = reactive({ leader: true, manager: true, member: true });
const form = reactive({
  log_channel_id: '',
  admin_channel_id: '',
  farm_channel_id: '',
  ai_channel_id: '',
  leader_role_id: '',
  manager_role_id: '',
  member_role_id: '',
  auto_approve: true,
});

function applySettings(settings) {
  form.log_channel_id = settings.logChannelId || '';
  form.admin_channel_id = settings.adminChannelId || '';
  form.farm_channel_id = settings.farmChannelId || '';
  form.ai_channel_id = settings.aiChannelId || '';
  form.leader_role_id = settings.leaderRoleId || '';
  form.manager_role_id = settings.managerRoleId || '';
  form.member_role_id = settings.memberRoleId || '';
  form.auto_approve = settings.autoApprove;
  Object.assign(formLocked, settings.lockedRoles || {});
  channelId.value = settings.farmChannelId || '';
}

async function load() {
  dashboard.value = await api('/v1/dashboard');
  applySettings(dashboard.value.settings);
}

async function save() {
  busy.value = true;
  try {
    const result = await api('/v1/settings', { method: 'PATCH', body: { ...form } });
    applySettings(result.settings);
    message.value = 'Configuração salva.';
    ok.value = true;
  } catch (err) {
    message.value = err.message;
    ok.value = false;
  } finally {
    busy.value = false;
  }
}

async function addMaterial() {
  try {
    await api('/v1/farm/materials', { method: 'POST', body: { name: newMaterial.value } });
    newMaterial.value = '';
    message.value = 'Material adicionado.';
    ok.value = true;
    await load();
  } catch (err) {
    message.value = err.message;
    ok.value = false;
  }
}

async function removeMaterial(name) {
  try {
    await api(`/v1/farm/materials/${encodeURIComponent(name)}`, { method: 'DELETE' });
    message.value = 'Material removido.';
    ok.value = true;
    await load();
  } catch (err) {
    message.value = err.message;
    ok.value = false;
  }
}

async function publish() {
  try {
    await api('/v1/farm/panel/publish', { method: 'POST', body: { channelId: channelId.value } });
    message.value = 'Painel publicado no Discord.';
    ok.value = true;
  } catch (err) {
    message.value = err.message;
    ok.value = false;
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
