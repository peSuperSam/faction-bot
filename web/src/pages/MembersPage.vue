<template>
  <div class="members-page">
    <div class="topbar">
      <h1>Membros</h1>
    </div>
    <p v-if="data?.warning" class="banner bad">{{ data.warning }}</p>
    <p v-if="error" class="banner bad">{{ error }}</p>
    <div class="grid cards">
      <article class="card">
        <div class="muted">Na facção</div>
        <h3>{{ data?.members?.length ?? '—' }}</h3>
      </article>
      <article class="card">
        <div class="muted">Sem farm na semana</div>
        <h3>{{ data?.absentees?.length ?? '—' }}</h3>
      </article>
    </div>
    <article class="card" style="margin-top: 16px">
      <h2>Lista</h2>
      <div class="table-wrap">
        <table class="members-table">
          <thead>
            <tr><th>Membro</th><th>Cargos</th><th>Farm</th><th>Entrou</th></tr>
          </thead>
          <tbody>
            <tr v-for="row in data?.members || []" :key="row.userId">
              <td>
                <div class="member-cell">
                  <Avatar :src="row.avatar" :name="row.tag" />
                  <span>{{ row.tag }}</span>
                </div>
              </td>
              <td class="roles-cell">
                <span
                  class="role"
                  v-for="role in row.roles"
                  :key="role.id"
                  :style="roleStyle(role)"
                >{{ role.name }}</span>
                <span v-if="!row.roles?.length" class="muted">—</span>
              </td>
              <td>{{ row.farmTotal }}</td>
              <td>{{ row.joinedAt }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </article>
    <article class="card" style="margin-top: 16px">
      <h2>Entradas e saídas</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>Quando</th><th>Tipo</th><th>Membro</th><th>Detalhe</th></tr>
          </thead>
          <tbody>
            <tr v-for="row in data?.events || []" :key="row.id">
              <td>{{ row.createdAt }}</td>
              <td>{{ row.type }}{{ row.certainty === 'uncertain' ? ' *' : '' }}</td>
              <td>{{ row.userTag }}</td>
              <td>{{ row.detail }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </article>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue';
import { api } from '../api';
import Avatar from '../components/Avatar.vue';

const data = ref(null);
const error = ref('');

function roleStyle(role) {
  const color = Number(role?.color || 0);
  if (!color) {
    return {};
  }
  const hex = `#${color.toString(16).padStart(6, '0')}`;
  return {
    color: hex,
    borderColor: hex,
    background: `${hex}22`,
  };
}

onMounted(async () => {
  try {
    data.value = await api('/v1/members');
  } catch (err) {
    error.value = err.message;
  }
});
</script>
