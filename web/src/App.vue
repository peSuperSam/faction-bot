<template>
  <router-view v-slot="{ Component }">
    <transition name="app-page">
      <component :is="Component" />
    </transition>
  </router-view>
</template>
