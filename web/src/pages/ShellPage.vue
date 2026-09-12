<template>
  <div class="shell" v-if="me">
    <nav class="side">
      <div class="side-brand">
        <div class="brand-mark">O</div>
        <div>
          <div class="brand">{{ SITE_NAME }}</div>
          <div class="brand-subtitle">{{ SITE_TAGLINE }}</div>
        </div>
      </div>
      <div class="guild-card">
        <Avatar :src="me.guild?.icon" :name="me.guild?.name" shape="square" />
        <div class="guild-copy">
          <span class="eyebrow">SERVIDOR ATUAL</span>
          <strong>{{ me.guild?.name || 'Servidor' }}</strong>
        </div>
        <span class="guild-status"></span>
      </div>
      <div class="user-card">
        <Avatar :src="me.user?.avatar" :name="me.user?.tag" />
        <div>
          <strong>{{ me.user.tag }}</strong>
          <div class="muted">{{ label(me.user.role) }}</div>
        </div>
      </div>
      <div class="nav-section">
        <div class="nav-label">Navegação</div>
        <router-link class="nav-link" to="/painel">Resumo</router-link>
        <router-link class="nav-link" to="/painel/farm">Farm</router-link>
        <router-link v-if="can('manager')" class="nav-link" to="/painel/membros">Membros</router-link>
        <router-link v-if="can('manager')" class="nav-link" to="/painel/auditoria">Auditoria</router-link>
        <router-link v-if="can('manager')" class="nav-link" to="/painel/documentos">Documentos</router-link>
        <router-link v-if="can('leader')" class="nav-link" to="/painel/ia">IA</router-link>
        <router-link v-if="can('leader')" class="nav-link" to="/painel/servidor">Servidor</router-link>
        <router-link v-if="can('leader')" class="nav-link" to="/painel/config">Farm e canais</router-link>
        <router-link class="nav-link" to="/painel/status">Status</router-link>
      </div>
      <div class="side-footer">
        <router-link to="/servidores">⇄ <span>Trocar servidor</span></router-link>
        <a class="muted" href="/api/auth/logout">↪ <span>Sair</span></a>
      </div>
    </nav>
    <div class="main">
      <router-view v-slot="{ Component }">
        <transition name="page" mode="out-in">
          <component :is="Component" :me="me" @refresh="reload" />
        </transition>
      </router-view>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { fetchMe } from '../api';
import Avatar from '../components/Avatar.vue';
import { SITE_NAME, SITE_TAGLINE } from '../brand';

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
