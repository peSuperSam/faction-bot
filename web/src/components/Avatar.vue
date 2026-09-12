<template>
  <img
    v-if="src && !failed"
    :src="src"
    :alt="name"
    class="avatar-img"
    :class="shape"
    @error="failed = true"
  />
  <div v-else class="avatar-fallback" :class="shape">{{ initial }}</div>
</template>

<script setup>
import { computed, ref, watch } from 'vue';

const props = defineProps({
  src: { type: String, default: '' },
  name: { type: String, default: '' },
  shape: { type: String, default: 'round' },
});

const failed = ref(false);
const initial = computed(() => String(props.name || '?').trim().slice(0, 1).toUpperCase());

watch(
  () => props.src,
  () => {
    failed.value = false;
  },
);
</script>
