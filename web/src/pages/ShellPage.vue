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
        <div class="nav-label">Operação</div>
        <router-link
          v-for="item in operationLinks"
          :key="item.to"
          class="nav-link"
          :class="{ 'is-active': isNav(item.to) }"
          :to="item.to"
          @mouseenter="prefetchNav(item.to)"
          @focus="prefetchNav(item.to)"
        >{{ item.label }}</router-link>

        <template v-if="can('manager')">
          <div class="nav-label">Gestão</div>
          <router-link
            v-for="item in managementLinks"
            :key="item.to"
            class="nav-link"
            :class="{ 'is-active': isNav(item.to) }"
            :to="item.to"
            @mouseenter="prefetchNav(item.to)"
            @focus="prefetchNav(item.to)"
          >{{ item.label }}</router-link>
        </template>

        <div class="nav-label">Sistema</div>
        <router-link
          v-for="item in systemLinks"
          :key="item.to"
          class="nav-link"
          :class="{ 'is-active': isNav(item.to) }"
          :to="item.to"
          @mouseenter="prefetchNav(item.to)"
          @focus="prefetchNav(item.to)"
        >{{ item.label }}</router-link>
      </div>
      <div class="side-footer">
        <router-link to="/servidores">⇄ <span>Trocar servidor</span></router-link>
        <a class="muted" href="/api/auth/logout">↪ <span>Sair</span></a>
      </div>
    </nav>
    <div class="main">
      <div class="nav-progress" aria-hidden="true"></div>
      <router-view v-slot="{ Component }">
        <keep-alive :max="8" :exclude="['DocumentEditorPage']">
          <component :is="Component" :me="me" @refresh="reload" />
        </keep-alive>
      </router-view>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { fetchMe, peekMe, prefetchNav } from '../api';
import Avatar from '../components/Avatar.vue';
import { SITE_NAME, SITE_TAGLINE } from '../brand';

const rank = { none: 0, member: 1, manager: 2, leader: 3, developer: 4 };
const route = useRoute();
const me = ref(route.meta.me || peekMe());

const operationLinks = [
  { to: '/painel', label: 'Resumo' },
  { to: '/painel/farm', label: 'Farm' },
];

const managementLinks = [
  { to: '/painel/membros', label: 'Membros' },
  { to: '/painel/auditoria', label: 'Auditoria' },
  { to: '/painel/documentos', label: 'Regras da cidade' },
];

const systemLinks = computed(() => {
  const links = [];
  if (can('leader')) {
    links.push(
      { to: '/painel/ia', label: 'IA' },
      { to: '/painel/servidor', label: 'Servidor' },
      { to: '/painel/config', label: 'Farm e canais' },
    );
  }
  links.push({ to: '/painel/status', label: 'Status' });
  return links;
});

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

function isNav(path) {
  if (path === '/painel') {
    return route.path === '/painel';
  }
  return route.path === path || route.path.startsWith(`${path}/`);
}

async function reload() {
  const next = await fetchMe({ force: true });
  if (next) {
    me.value = next;
  }
}

onMounted(async () => {
  if (!me.value) {
    me.value = await fetchMe({ force: true });
    return;
  }
  const next = await fetchMe({ maxAge: 60_000 });
  if (next) {
    me.value = next;
  }
});
</script>
