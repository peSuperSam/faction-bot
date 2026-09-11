<template>
  <div>
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
        <table>
          <thead>
            <tr><th>Membro</th><th>Cargos</th><th>Farm</th><th>Entrou</th></tr>
          </thead>
          <tbody>
            <tr v-for="row in data?.members || []" :key="row.userId">
              <td>{{ row.tag }}</td>
              <td><span class="role" v-for="role in row.roles" :key="role">{{ role }}</span></td>
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

const data = ref(null);
const error = ref('');

onMounted(async () => {
  try {
    data.value = await api('/v1/members');
  } catch (err) {
    error.value = err.message;
  }
});
</script>
