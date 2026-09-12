import { onActivated, onMounted, ref } from 'vue';
import { peekPage, prefetch } from './api';

export function usePageData(path) {
  const data = ref(peekPage(path));
  const error = ref('');
  const loading = ref(!data.value);
  let skipActivate = true;

  async function reload({ force = false } = {}) {
    try {
      data.value = await prefetch(path, { force });
      error.value = '';
    } catch (err) {
      if (!data.value) {
        error.value = err.message;
      }
    } finally {
      loading.value = false;
    }
  }

  onMounted(() => {
    reload();
  });
  onActivated(() => {
    if (skipActivate) {
      skipActivate = false;
      return;
    }
    reload();
  });

  return { data, error, loading, reload };
}

