<template>
  <div>
    <div class="topbar">
      <h1>Farm</h1>
    </div>
    <p v-if="message" class="banner" :class="ok ? 'ok' : 'bad'">{{ message }}</p>
    <div class="actions" v-if="canManage">
      <button class="btn ghost" @click="refreshPanel" :disabled="busy">Atualizar painel</button>
    </div>
    <article class="card" v-if="canManage">
      <h2>Metas da semana</h2>
      <form class="grid" style="grid-template-columns: 1fr 140px auto; align-items: end" @submit.prevent="saveGoal">
        <label class="field">
          <span>Material</span>
          <select v-model="goal.material">
            <option value="">Selecione</option>
            <option v-for="item in dashboard?.materials || []" :key="item.name" :value="item.name">
              {{ item.displayName }}
            </option>
          </select>
        </label>
        <label class="field">
          <span>Quantidade</span>
          <input v-model="goal.quantity" inputmode="numeric" />
        </label>
        <button class="btn" :disabled="busy">Salvar meta</button>
      </form>
    </article>
    <article class="card" style="margin-top: 16px">
      <h2>Pendentes</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>ID</th><th>Membro</th><th>Item</th><th>Qtd</th><th></th></tr>
          </thead>
          <tbody>
            <tr v-for="row in farm?.pending || []" :key="row.id">
              <td>{{ row.id }}</td>
              <td>{{ row.userTag }}</td>
              <td>{{ row.material }}</td>
              <td>{{ row.quantity }}</td>
              <td class="actions" v-if="canManage">
                <button class="btn gold" @click="review(row.id, 'approve')">Aprovar</button>
                <button class="btn ghost" @click="review(row.id, 'reject')">Rejeitar</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </article>
    <article class="card" style="margin-top: 16px">
      <h2>Registros</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>ID</th><th>Quando</th><th>Membro</th><th>Item</th><th>Qtd</th><th>Status</th><th v-if="canManage"></th></tr>
          </thead>
          <tbody>
            <tr v-for="row in farm?.entries || []" :key="row.id">
              <td>{{ row.id }}</td>
              <td>{{ row.createdAt }}</td>
              <td>{{ row.userTag }}</td>
              <td>{{ row.displayName }}</td>
              <td>{{ row.quantity }}</td>
              <td>{{ row.status }}</td>
              <td v-if="canManage">
                <button class="btn ghost" @click="remove(row.id)">Apagar</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </article>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { api, fetchMe } from '../api';

const farm = ref(null);
const dashboard = ref(null);
const me = ref(null);
const busy = ref(false);
const message = ref('');
const ok = ref(false);
const goal = ref({ material: '', quantity: '' });
const rank = { member: 1, manager: 2, leader: 3, developer: 4 };
const canManage = computed(() => (rank[me.value?.user?.role] || 0) >= 2);

async function load() {
  const [meData, dash, page] = await Promise.all([
    fetchMe(),
    api('/v1/dashboard'),
    api('/v1/farm'),
  ]);
  me.value = meData;
  dashboard.value = dash;
  farm.value = page;
}

function flash(text, good) {
  message.value = text;
  ok.value = Boolean(good);
}

async function saveGoal() {
  busy.value = true;
  try {
    await api('/v1/farm/goals', {
      method: 'POST',
      body: { goals: [{ material: goal.value.material, quantity: goal.value.quantity }] },
    });
    flash('Meta salva.', true);
    await load();
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
    await load();
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
    await load();
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

onMounted(async () => {
  try {
    await load();
  } catch (err) {
    flash(err.message);
  }
});
</script>
