import { createRouter, createWebHistory } from 'vue-router';
import { fetchMe } from './api';
import LoginPage from './pages/LoginPage.vue';
import ShellPage from './pages/ShellPage.vue';
import DashboardPage from './pages/DashboardPage.vue';
import FarmPage from './pages/FarmPage.vue';
import MembersPage from './pages/MembersPage.vue';
import AuditPage from './pages/AuditPage.vue';
import AiPage from './pages/AiPage.vue';
import SettingsPage from './pages/SettingsPage.vue';
import StatusPage from './pages/StatusPage.vue';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', component: LoginPage, meta: { public: true } },
    {
      path: '/',
      component: ShellPage,
      children: [
        { path: '', component: DashboardPage },
        { path: 'farm', component: FarmPage },
        { path: 'membros', component: MembersPage, meta: { min: 'manager' } },
        { path: 'auditoria', component: AuditPage, meta: { min: 'manager' } },
        { path: 'ia', component: AiPage, meta: { min: 'leader' } },
        { path: 'config', component: SettingsPage, meta: { min: 'leader' } },
        { path: 'status', component: StatusPage },
      ],
    },
  ],
});

const rank = { none: 0, member: 1, manager: 2, leader: 3, developer: 4 };

router.beforeEach(async (to) => {
  if (to.meta.public) {
    return true;
  }
  const me = await fetchMe();
  if (!me) {
    return { path: '/login', query: { next: to.fullPath } };
  }
  const need = rank[to.meta.min] || 0;
  if ((rank[me.user.role] || 0) < need) {
    return { path: '/' };
  }
  to.meta.me = me;
  return true;
});

export default router;
