<template>
  <div class="login">
    <section class="login-card">
      <div class="crest">O</div>
      <h1>{{ SITE_NAME }}</h1>
      <p>
        Painel da liderança Olympus. Entre com Discord. Só administradores dos
        servidores em que o Coroa está presente conseguem entrar.
      </p>
      <a class="btn" href="/api/auth/discord">Entrar com Discord</a>
    </section>
  </div>
</template>

<script setup>
import { SITE_NAME } from '../brand';
</script>
