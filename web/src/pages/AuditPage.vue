<template>
  <div>
    <div class="topbar">
      <h1>Auditoria</h1>
    </div>
    <p v-if="error" class="banner bad">{{ error }}</p>
    <article class="card">
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>Quando</th><th>Ação</th><th>Autor</th><th>Alvo</th><th>Detalhe</th></tr>
          </thead>
          <tbody>
            <tr v-for="row in data?.events || []" :key="row.id">
              <td>{{ row.createdAt }}</td>
              <td>{{ row.action }}</td>
              <td>{{ row.actorId }}</td>
              <td>{{ row.targetId }}</td>
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
    data.value = await api('/v1/audit');
  } catch (err) {
    error.value = err.message;
  }
});
</script>
