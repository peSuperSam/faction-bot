<template>
  <div class="shell" v-if="me">
    <nav class="side">
      <div>
        <div class="brand" style="font-size: 28px; color: var(--gold)">Coroa</div>
        <div class="muted">{{ me.guild?.name || 'Servidor' }}</div>
        <div class="muted">{{ me.user.tag }} · {{ label(me.user.role) }}</div>
      </div>
      <div>
        <router-link to="/">Resumo</router-link>
        <router-link to="/farm">Farm</router-link>
        <router-link v-if="can('manager')" to="/membros">Membros</router-link>
        <router-link v-if="can('manager')" to="/auditoria">Auditoria</router-link>
        <router-link v-if="can('leader')" to="/ia">IA</router-link>
        <router-link v-if="can('leader')" to="/config">Configuração</router-link>
        <router-link to="/status">Status</router-link>
        <router-link to="/servidores">Trocar servidor</router-link>
      </div>
      <a class="muted" href="/api/auth/logout">Sair</a>
    </nav>
    <div class="main">
      <router-view :me="me" @refresh="reload" />
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { fetchMe } from '../api';

const rank = { none: 0, member: 1, manager: 2, leader: 3, developer: 4 };
const me = ref(null);

function label(role) {
  return (
    {
      developer: 'dev',
      leader: 'líder',
      manager: 'gerente',
      member: 'membro',
    }[role] || role
  );
}

function can(min) {
  return (rank[me.value?.user?.role] || 0) >= rank[min];
}

async function reload() {
  me.value = await fetchMe({ force: true });
}

onMounted(reload);
</script>
