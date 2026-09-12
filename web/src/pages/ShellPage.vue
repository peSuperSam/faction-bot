<template>
  <div class="shell" v-if="me">
    <nav class="side">
      <div class="side-brand">
        <div class="brand-mark">C</div>
        <div>
          <div class="brand">Coroa</div>
          <div class="brand-subtitle">Painel de gestão</div>
        </div>
      </div>
      <div class="guild-card">
        <div class="guild-avatar">{{ initial(me.guild?.name) }}</div>
        <div class="guild-copy">
          <span class="eyebrow">SERVIDOR ATUAL</span>
          <strong>{{ me.guild?.name || 'Servidor' }}</strong>
        </div>
        <span class="guild-status"></span>
      </div>
      <div class="user-card">
        <div class="user-avatar">{{ initial(me.user.tag) }}</div>
        <div>
          <strong>{{ me.user.tag }}</strong>
          <div class="muted">{{ label(me.user.role) }}</div>
        </div>
      </div>
      <div class="nav-section">
        <div class="nav-label">Navegação</div>
        <router-link to="/painel">Resumo</router-link>
        <router-link to="/painel/farm">Farm</router-link>
        <router-link v-if="can('manager')" to="/painel/membros">Membros</router-link>
        <router-link v-if="can('manager')" to="/painel/auditoria">Auditoria</router-link>
        <router-link v-if="can('manager')" to="/painel/documentos">Documentos</router-link>
        <router-link v-if="can('leader')" to="/painel/ia">IA</router-link>
        <router-link v-if="can('leader')" to="/painel/servidor">Servidor</router-link>
        <router-link v-if="can('leader')" to="/painel/config">Farm e canais</router-link>
        <router-link to="/painel/status">Status</router-link>
        <router-link to="/servidores">Trocar servidor</router-link>
      </div>
      <div class="side-footer">
        <router-link to="/servidores">⇄ <span>Trocar servidor</span></router-link>
        <a class="muted" href="/api/auth/logout">↪ <span>Sair</span></a>
      </div>
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

function initial(value) {
  return String(value || '?').trim().slice(0, 1).toUpperCase();
}

async function reload() {
  me.value = await fetchMe({ force: true });
}

onMounted(reload);
</script>
