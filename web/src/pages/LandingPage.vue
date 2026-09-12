<template>
  <main class="landing" :class="{ 'is-ready': ready }">
    <nav class="landing-nav reveal">
      <router-link class="landing-brand" to="/">
        <span class="brand-mark">O</span>
        <span>
          <strong>{{ SITE_NAME }}</strong>
          <small>{{ SITE_TAGLINE }}</small>
        </span>
      </router-link>
      <a class="landing-login-link" :href="panelHref">Entrar com Discord <span>↗</span></a>
    </nav>

    <section class="landing-hero">
      <div class="hero-copy">
        <div class="eyebrow">CONTROLE. CLAREZA. RESULTADO.</div>
        <h1>A operação da sua facção, <em>no controle.</em></h1>
        <p class="hero-lead">
          Centralize metas, registros, aprovações e desempenho em um painel
          feito para quem lidera.
        </p>
        <div class="hero-actions">
          <a class="btn landing-cta" :href="panelHref">Acessar painel <span>→</span></a>
          <a class="text-link" href="#recursos">Conhecer recursos <span>↓</span></a>
        </div>
        <div class="trust-line">
          <span class="status-dot"></span>
          Acesso seguro via Discord
          <span class="trust-divider"></span>
          Permissões verificadas em cada ação
        </div>
      </div>
      <div class="hero-visual reveal" aria-label="Prévia do dashboard">
        <div class="visual-glow"></div>
        <div class="mock-window">
          <div class="mock-topbar">
            <div class="mock-dots"><i></i><i></i><i></i></div>
            <span>olympus / resumo</span>
            <span class="mock-live"><b></b> AO VIVO</span>
          </div>
          <div class="mock-content">
            <div class="mock-sidebar">
              <div class="mock-logo">O</div>
              <span class="mock-active"></span><span></span><span></span><span></span>
            </div>
            <div class="mock-dashboard">
              <div class="mock-heading">
                <div><small>VISÃO GERAL</small><strong>Semana atual</strong></div>
                <label>OPERAÇÃO ATIVA</label>
              </div>
              <div class="mock-metrics">
                <div><small>APROVADOS</small><strong>24</strong><b class="green">+18%</b></div>
                <div><small>PENDENTES</small><strong>03</strong><b class="gold">atenção</b></div>
                <div><small>METAS</small><strong>08</strong><b class="purple">semana</b></div>
              </div>
              <div class="mock-panels">
                <div class="mock-panel">
                  <small>PROGRESSO DAS METAS</small>
                  <div class="mock-progress-row"><span>Alumínio Leve</span><b>82%</b></div>
                  <div class="mock-progress"><i style="width:82%"></i></div>
                  <div class="mock-progress-row"><span>Baldes de Tinta</span><b>64%</b></div>
                  <div class="mock-progress"><i style="width:64%"></i></div>
                  <div class="mock-progress-row"><span>Ferro Pesado</span><b>38%</b></div>
                  <div class="mock-progress"><i style="width:38%"></i></div>
                </div>
                <div class="mock-panel mock-ranking">
                  <small>RANKING SEMANAL</small>
                  <p><b>01</b><span>peSuperSam</span><strong>1.240</strong></p>
                  <p><b>02</b><span>membro_02</span><strong>980</strong></p>
                  <p><b>03</b><span>membro_03</span><strong>740</strong></p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section id="recursos" class="landing-section reveal-on-scroll">
      <div class="section-heading reveal-on-scroll">
        <div class="eyebrow">TUDO EM UM SÓ LUGAR</div>
        <h2>Feito para transformar<br /><em>rotina em resultado.</em></h2>
      </div>
      <div class="feature-grid">
        <article
          class="feature-card feature-primary reveal-on-scroll"
          style="--delay: 0ms"
        >
          <span class="feature-number">01</span>
          <div class="feature-icon">↗</div>
          <h3>Metas que movem<br />a operação</h3>
          <p>Defina objetivos semanais e acompanhe o progresso da equipe em tempo real.</p>
          <div class="feature-line"></div>
        </article>
        <article class="feature-card reveal-on-scroll" style="--delay: 90ms">
          <span class="feature-number">02</span>
          <div class="feature-icon">✓</div>
          <h3>Registros sem<br />perder o controle</h3>
          <p>Revise, aprove e audite cada lançamento com clareza e segurança.</p>
          <div class="feature-line"></div>
        </article>
        <article class="feature-card reveal-on-scroll" style="--delay: 180ms">
          <span class="feature-number">03</span>
          <div class="feature-icon">♛</div>
          <h3>Desempenho que<br />você consegue ver</h3>
          <p>Rankings e indicadores para reconhecer quem faz a diferença.</p>
          <div class="feature-line"></div>
        </article>
      </div>
    </section>

    <section class="landing-security reveal-on-scroll">
      <div class="reveal-on-scroll">
        <div class="eyebrow">ACESSO SOB CONTROLE</div>
        <h2>Sua operação.<br /><em>Suas regras.</em></h2>
      </div>
      <div class="security-items">
        <div class="reveal-on-scroll" style="--delay: 0ms"><span>✓</span><p><strong>Permissões do Discord</strong><br />Apenas administradores autorizados entram.</p></div>
        <div class="reveal-on-scroll" style="--delay: 90ms"><span>↻</span><p><strong>Validação contínua</strong><br />Cada ação é revalidada no servidor.</p></div>
        <div class="reveal-on-scroll" style="--delay: 180ms"><span>⌁</span><p><strong>Servidor certo</strong><br />Sessão vinculada ao servidor escolhido.</p></div>
      </div>
    </section>

    <footer class="landing-footer">
      <span class="landing-brand"><span class="brand-mark">O</span><strong>{{ SITE_NAME }}</strong></span>
      <span>Gestão de operações com clareza.</span>
      <a :href="panelHref">Entrar com Discord ↗</a>
    </footer>
  </main>
</template>

<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { fetchMe } from '../api';
import { SITE_NAME, SITE_TAGLINE } from '../brand';

const panelHref = ref('/api/auth/discord');
const ready = ref(false);
let observer;

onMounted(async () => {
  ready.value = true;
  await nextTick();
  const elements = document.querySelectorAll('.reveal-on-scroll');
  if ('IntersectionObserver' in window) {
    observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('in-view');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12 },
    );
    elements.forEach((element) => observer.observe(element));
  } else {
    elements.forEach((element) => element.classList.add('in-view'));
  }
  const me = await fetchMe();
  if (!me) {
    return;
  }
  panelHref.value = me.needsGuild || !me.guild?.id ? '/servidores' : '/painel';
});

onBeforeUnmount(() => observer?.disconnect());
</script>
