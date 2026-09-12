import { createRouter, createWebHistory } from 'vue-router';
import { fetchMe, peekMe, ME_SESSION_TTL_MS } from './api';
import LoginPage from './pages/LoginPage.vue';
import ServersPage from './pages/ServersPage.vue';
import ShellPage from './pages/ShellPage.vue';
import DashboardPage from './pages/DashboardPage.vue';
import FarmPage from './pages/FarmPage.vue';
import MembersPage from './pages/MembersPage.vue';
import AuditPage from './pages/AuditPage.vue';
import AiPage from './pages/AiPage.vue';
import SettingsPage from './pages/SettingsPage.vue';
import StatusPage from './pages/StatusPage.vue';
import LandingPage from './pages/LandingPage.vue';
import DocumentsPage from './pages/DocumentsPage.vue';
import DocumentEditorPage from './pages/DocumentEditorPage.vue';
import ServerPage from './pages/ServerPage.vue';

const router = createRouter({
  history: createWebHistory(),
  scrollBehavior() {
    return { top: 0 };
  },
  routes: [
    { path: '/', component: LandingPage, meta: { public: true, landing: true } },
    { path: '/login', component: LoginPage, meta: { public: true } },
    { path: '/servidores', component: ServersPage, meta: { servers: true } },
    {
      path: '/painel',
      component: ShellPage,
      children: [
        { path: '', component: DashboardPage },
        { path: 'farm', component: FarmPage },
        { path: 'membros', component: MembersPage, meta: { min: 'manager' } },
        { path: 'auditoria', component: AuditPage, meta: { min: 'manager' } },
        { path: 'documentos', component: DocumentsPage, meta: { min: 'manager' } },
        { path: 'documentos/:id', component: DocumentEditorPage, meta: { min: 'manager' } },
        { path: 'ia', component: AiPage, meta: { min: 'leader' } },
        { path: 'servidor', component: ServerPage, meta: { min: 'leader' } },
        { path: 'config', component: SettingsPage, meta: { min: 'leader' } },
        { path: 'status', component: StatusPage },
      ],
    },
  ],
});

const rank = { none: 0, member: 1, manager: 2, leader: 3, developer: 4 };

function isPanel(route) {
  return route.matched.some((record) => record.path === '/painel');
}

function applySession(to, me) {
  if (!me) {
    return { path: '/login', query: { next: to.fullPath } };
  }
  const needsGuild = Boolean(me.needsGuild || !me.guild?.id);
  if (to.meta.servers) {
    to.meta.me = me;
    return true;
  }
  if (needsGuild) {
    return { path: '/servidores' };
  }
  const need = rank[to.meta.min] || 0;
  if ((rank[me.user?.role] || 0) < need) {
    return { path: '/painel' };
  }
  to.meta.me = me;
  return true;
}

router.beforeEach(async (to, from) => {
  if (to.meta.public) {
    if (to.path === '/login') {
      const me = await fetchMe();
      if (me) {
        return me.needsGuild || !me.guild?.id
          ? { path: '/servidores' }
          : { path: '/painel' };
      }
    }
    return true;
  }

  const cached = peekMe();
  if (cached && isPanel(from) && isPanel(to)) {
    fetchMe({ maxAge: ME_SESSION_TTL_MS }).catch(() => {});
    return applySession(to, cached);
  }

  const me = await fetchMe({
    maxAge: isPanel(to) ? ME_SESSION_TTL_MS : 15_000,
  });
  return applySession(to, me);
});

let navTimer = 0;
router.beforeEach((to, from) => {
  if (to.fullPath === from.fullPath) {
    return true;
  }
  window.clearTimeout(navTimer);
  navTimer = window.setTimeout(() => {
    document.body.classList.add('is-navigating');
  }, 90);
  return true;
});

router.afterEach(() => {
  window.clearTimeout(navTimer);
  document.body.classList.remove('is-navigating');
});

export default router;
