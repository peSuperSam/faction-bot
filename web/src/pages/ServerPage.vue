<template>
  <div>
    <div class="topbar">
      <h1>Servidor</h1>
      <div class="actions">
        <button class="btn ghost" :disabled="busy" @click="refresh">Sincronizar Discord</button>
        <button class="btn" :disabled="busy" @click="save">Salvar</button>
      </div>
    </div>
    <p v-if="message" class="banner" :class="ok ? 'ok' : 'bad'">{{ message }}</p>
    <article class="card">
      <h2>Identidade</h2>
      <p class="muted">O bot continua se chamando {{ data?.botName || 'Coroa' }} no Discord. Aqui você só personaliza textos deste servidor.</p>
      <label class="field">
        <span>Nome de exibição no painel</span>
        <input v-model="form.identity_name" />
      </label>
      <label class="field">
        <span>Presença / recado</span>
        <input v-model="form.presence_text" maxlength="80" />
      </label>
    </article>
    <article class="card" style="margin-top: 16px">
      <h2>Canais e cargos</h2>
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
        <label class="field">
          <span>Cargo de líder</span>
          <input v-model="form.leader_role_id" />
        </label>
        <label class="field">
          <span>Cargo de gerente</span>
          <input v-model="form.manager_role_id" />
        </label>
        <label class="field">
          <span>Cargo de membro</span>
          <input v-model="form.member_role_id" />
        </label>
      </form>
    </article>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import { api } from '../api';

const data = ref(null);
const busy = ref(false);
const message = ref('');
const ok = ref(false);
const form = reactive({
  identity_name: '',
  presence_text: '',
  log_channel_id: '',
  admin_channel_id: '',
  farm_channel_id: '',
  ai_channel_id: '',
  leader_role_id: '',
  manager_role_id: '',
  member_role_id: '',
});

function apply(settings) {
  form.identity_name = settings.identityName || '';
  form.presence_text = settings.presenceText || '';
  form.log_channel_id = settings.logChannelId || '';
  form.admin_channel_id = settings.adminChannelId || '';
  form.farm_channel_id = settings.farmChannelId || '';
  form.ai_channel_id = settings.aiChannelId || '';
  form.leader_role_id = settings.leaderRoleId || '';
  form.manager_role_id = settings.managerRoleId || '';
  form.member_role_id = settings.memberRoleId || '';
}

async function load() {
  data.value = await api('/v1/guild');
  apply(data.value.settings);
}

async function refresh() {
  busy.value = true;
  try {
    data.value = await api('/v1/guild/refresh', { method: 'POST' });
    apply(data.value.settings);
    message.value = 'Dados do Discord atualizados.';
    ok.value = true;
  } catch (err) {
    message.value = err.message;
    ok.value = false;
  } finally {
    busy.value = false;
  }
}

async function save() {
  busy.value = true;
  try {
    const result = await api('/v1/settings', { method: 'PATCH', body: { ...form } });
    apply(result.settings);
    message.value = 'Servidor atualizado.';
    ok.value = true;
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
