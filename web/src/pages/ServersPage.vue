<template>
  <div class="login">
    <section class="login-card servers-card">
      <div class="crest">C</div>
      <h1>Servidores</h1>
      <p>
        Escolha o servidor em que o Coroa está presente e você tem permissão de
        administrador.
      </p>
      <p v-if="error" class="banner bad">{{ error }}</p>
      <p v-else-if="loading" class="muted">Carregando servidores…</p>
      <div v-else-if="!guilds.length" class="banner">
        Nenhum servidor disponível. O Coroa precisa estar no servidor e você
        precisa ser dono, administrador ou ter permissão de gerenciar o servidor.
      </div>
      <div v-else class="grid cards server-grid">
        <button
          v-for="guild in guilds"
          :key="guild.id"
          class="card server-pick"
          type="button"
          :disabled="busyId != null"
          @click="choose(guild)"
        >
          <img v-if="guild.icon" class="server-icon" :src="guild.icon" :alt="guild.name" />
          <div v-else class="server-icon fallback">{{ initial(guild.name) }}</div>
          <strong>{{ guild.name }}</strong>
          <span class="muted">{{ busyId === guild.id ? 'Entrando…' : 'Abrir painel' }}</span>
        </button>
      </div>
      <p class="muted" style="margin-top: 22px">
        <a href="/api/auth/logout">Sair</a>
      </p>
    </section>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { clearMe, listGuilds, selectGuild } from '../api';

const router = useRouter();
const guilds = ref([]);
const loading = ref(true);
const error = ref('');
const busyId = ref(null);

function initial(name) {
  return String(name || '?').trim().slice(0, 1).toUpperCase();
}

async function choose(guild) {
  error.value = '';
  busyId.value = guild.id;
  try {
    await selectGuild(guild.id);
    clearMe();
    await router.replace('/painel');
  } catch (err) {
    error.value = err.message || 'Não foi possível abrir este servidor.';
    busyId.value = null;
  }
}

onMounted(async () => {
  try {
    const data = await listGuilds();
    guilds.value = data.guilds || [];
    const only = guilds.value.length === 1 ? guilds.value[0] : null;
    const autoKey = only ? `coroa-autoselect:${only.id}` : '';
    if (only && sessionStorage.getItem(autoKey) !== '1') {
      sessionStorage.setItem(autoKey, '1');
      await choose(only);
      return;
    }
  } catch (err) {
    error.value = err.message || 'Não foi possível listar os servidores.';
  }
  loading.value = false;
});
</script>
