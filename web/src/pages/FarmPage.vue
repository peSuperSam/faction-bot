<template>
  <div class="farm-page">
    <div class="topbar">
      <div>
        <div class="eyebrow">OPERAÇÃO</div>
        <h1>Farm</h1>
        <p class="muted">{{ farm?.period?.label || 'Carregando semana…' }}</p>
      </div>
      <div class="actions" v-if="canManage">
        <button class="btn ghost" @click="refreshPanel" :disabled="busy">Atualizar painel</button>
      </div>
    </div>
    <p v-if="message" class="banner" :class="ok ? 'ok' : 'bad'">{{ message }}</p>
    <p v-if="error" class="banner bad">{{ error }}</p>

    <article class="card" v-if="canManage">
      <h2>Metas da semana</h2>
      <form class="goal-form" @submit.prevent="saveGoal">
        <label class="field">
          <span>Material</span>
          <select v-model="goal.material">
            <option value="">Selecione</option>
            <option v-for="item in farm?.materials || []" :key="item.name" :value="item.name">
              {{ item.displayName }}
            </option>
          </select>
        </label>
        <label class="field">
          <span>Quantidade</span>
          <input v-model="goal.quantity" inputmode="numeric" />
        </label>
        <button class="btn" :disabled="busy || !goal.material">Salvar meta</button>
      </form>
    </article>

    <article class="card" style="margin-top: 16px">
      <div class="panel-heading">
        <h2>Pendentes</h2>
        <span class="panel-count">{{ farm?.pending?.length || 0 }}</span>
      </div>
      <div class="table-wrap" v-if="farm">
        <table>
          <thead>
            <tr><th>ID</th><th>Membro</th><th>Item</th><th>Qtd</th><th v-if="canManage"></th></tr>
          </thead>
          <tbody>
            <tr v-for="row in farm.pending" :key="row.id">
              <td>{{ row.id }}</td>
              <td>{{ row.userTag }}</td>
              <td>{{ row.material }}</td>
              <td>{{ row.quantity }}</td>
              <td class="actions" v-if="canManage">
                <button class="btn gold" @click="review(row.id, 'approve')">Aprovar</button>
                <button class="btn ghost" @click="review(row.id, 'reject')">Rejeitar</button>
              </td>
            </tr>
            <tr v-if="!farm.pending?.length">
              <td :colspan="canManage ? 5 : 4" class="empty-cell">Nenhum registro aguardando revisão.</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-else class="skel-stack">
        <div class="skel skel-line" v-for="n in 3" :key="n"></div>
      </div>
    </article>

    <article class="card" style="margin-top: 16px">
      <div class="panel-heading">
        <h2>Registros</h2>
        <span class="panel-count">{{ farm?.total || farm?.entries?.length || 0 }}</span>
      </div>
      <div class="table-wrap" v-if="farm">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Quando</th>
              <th>Membro</th>
              <th>Item</th>
              <th>Qtd</th>
              <th>Status</th>
              <th v-if="canManage"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in farm.entries || []" :key="row.id">
              <td>{{ row.id }}</td>
              <td>{{ row.createdAt }}</td>
              <td>{{ row.userTag }}</td>
              <td>{{ row.displayName }}</td>
              <td>{{ row.quantity }}</td>
              <td><span class="status-pill" :class="row.status">{{ statusLabel(row.status) }}</span></td>
              <td v-if="canManage">
                <button class="btn ghost" @click="remove(row.id)">Apagar</button>
              </td>
            </tr>
            <tr v-if="!farm.entries?.length">
              <td :colspan="canManage ? 7 : 6" class="empty-cell">Ainda não há farm nesta semana.</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-else class="skel-stack">
        <div class="skel skel-line" v-for="n in 5" :key="n"></div>
      </div>
    </article>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';
import { api, invalidatePages } from '../api';
import { usePageData } from '../usePage';

const props = defineProps({ me: Object });
const { data: farm, error, reload } = usePageData('/v1/farm');
const busy = ref(false);
const message = ref('');
const ok = ref(false);
const goal = ref({ material: '', quantity: '' });
const rank = { member: 1, manager: 2, leader: 3, developer: 4 };
const canManage = computed(() => (rank[props.me?.user?.role] || 0) >= 2);

function statusLabel(status) {
  return (
    {
      pending: 'pendente',
      approved: 'aprovado',
      rejected: 'rejeitado',
    }[status] || status
  );
}

function flash(text, good) {
  message.value = text;
  ok.value = Boolean(good);
}

async function refresh() {
  invalidatePages('/v1/farm', '/v1/dashboard');
  await reload({ force: true });
}

async function saveGoal() {
  busy.value = true;
  try {
    await api('/v1/farm/goals', {
      method: 'POST',
      body: { goals: [{ material: goal.value.material, quantity: goal.value.quantity }] },
    });
    flash('Meta salva.', true);
    await refresh();
  } catch (err) {
    flash(err.message);
  } finally {
    busy.value = false;
  }
}

async function review(id, action) {
  busy.value = true;
  try {
    await api(`/v1/farm/entries/${id}/${action}`, { method: 'POST' });
    flash('Registro atualizado.', true);
    await refresh();
  } catch (err) {
    flash(err.message);
  } finally {
    busy.value = false;
  }
}

async function remove(id) {
  const reason = window.prompt('Motivo da exclusão?');
  if (!reason) return;
  busy.value = true;
  try {
    await api(`/v1/farm/entries/${id}`, { method: 'DELETE', body: { reason } });
    flash('Registro apagado.', true);
    await refresh();
  } catch (err) {
    flash(err.message);
  } finally {
    busy.value = false;
  }
}

async function refreshPanel() {
  busy.value = true;
  try {
    await api('/v1/farm/panel/refresh', { method: 'POST' });
    flash('Painel do Discord atualizado.', true);
  } catch (err) {
    flash(err.message);
  } finally {
    busy.value = false;
  }
}
</script>
