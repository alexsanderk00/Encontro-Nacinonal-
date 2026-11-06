/* ===================================================================
   HOMEPAGE — Encontro Nacional dos Calções Pretos 2026
   Menu, cabeçalho, entrada na rolagem (com a faixa dourada), "Sua turma",
   galeria por ano e modal de imagem.
   =================================================================== */

'use strict';

document.documentElement.classList.add('js');
window.__rvOk = true;   // o fallback do <head> só revela tudo se este arquivo não carregar

const BACKEND_URL = 'https://script.google.com/macros/s/AKfycbyrVIrMX1EjB6DbDnCLBZ1B73IM3veQNFTWz8lhfQ3_9H-lvIUfNkCf07wsP41sRKPS/exec';
const REDUZIR_MOVIMENTO = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** rAF throttle — agrupa vários eventos de scroll em um único frame. */
function rafThrottle(fn) {
  let scheduled = false;
  return function () {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(function () {
      scheduled = false;
      fn();
    });
  };
}

/* ── MENU MOBILE ──────────────────────────────────────────────── */
(function initMenu() {
  const toggle = document.getElementById('mobile-menu-toggle');
  const navLinks = document.getElementById('nav-links');
  if (!toggle || !navLinks) return;

  function closeMenu() {
    navLinks.classList.remove('active');
    toggle.textContent = '☰';
    toggle.setAttribute('aria-expanded', 'false');
  }

  toggle.addEventListener('click', function (e) {
    e.stopPropagation();
    const open = navLinks.classList.toggle('active');
    toggle.textContent = open ? '✕' : '☰';
    toggle.setAttribute('aria-expanded', String(open));
  });

  navLinks.querySelectorAll('a').forEach(function (link) {
    link.addEventListener('click', closeMenu);
  });

  document.addEventListener('click', function (e) {
    if (!e.target.closest('.site-header')) closeMenu();
  });
})();

/* ── EFEITO DE SCROLL NO CABEÇALHO ────────────────────────────── */
(function initHeaderScroll() {
  const header = document.querySelector('.site-header');
  if (!header) return;
  window.addEventListener('scroll', rafThrottle(function () {
    header.classList.toggle('scrolled', window.scrollY > 40);
  }), { passive: true });
})();

/* ── ENTRADA NA ROLAGEM ───────────────────────────────────────── */
/* .rv sobe e aparece (80 ms entre irmãos); .sec-head desenha a faixa dourada. */
const observarEntrada = (function () {
  if (!('IntersectionObserver' in window)) {
    return function (el) { el.classList.add('in'); };
  }
  const observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('in');
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });
  return function (el) { observer.observe(el); };
})();

(function initReveal() {
  document.querySelectorAll('.rv').forEach(function (el) {
    const irmaos = Array.prototype.filter.call(el.parentElement.children, function (c) { return c.classList.contains('rv'); });
    el.style.transitionDelay = (irmaos.indexOf(el) * 80) + 'ms';
    observarEntrada(el);
  });
  document.querySelectorAll('.sec-head').forEach(observarEntrada);
})();

/* Numera as seções na ordem em que aparecem (01, 02…), pulando as ocultas. */
function numerarSecoes() {
  let n = 0;
  document.querySelectorAll('.section').forEach(function (sec) {
    const num = sec.querySelector('.sec-num');
    if (!num || sec.hidden) return;
    n++;
    num.textContent = String(n).padStart(2, '0');
  });
}
numerarSecoes();

/* ── SUA TURMA ────────────────────────────────────────────────── */
/* Números por ano de formação (inscrições pagas), vindos do backend:
   ?action=turmas → { turmas: [{ ano, formados, pessoas }] }. Sem nomes.
   Se não carregar, a seção e os números do topo continuam escondidos. */
(function initTurma() {
  const secao = document.getElementById('turma');
  const select = document.getElementById('turma-ano');
  const resultado = document.getElementById('turma-resultado');
  const formacao = document.getElementById('turma-formacao');
  const ranking = document.getElementById('turma-ranking');
  if (!secao || !select || !window.fetch) return;

  function fmt(n) { return Number(n).toLocaleString('pt-BR'); }

  function mostrar(turmas) {
    const lista = turmas.filter(function (t) { return t && t.ano && t.formados > 0; });
    if (!lista.length) return;
    const ordem = lista.slice().sort(function (a, b) { return b.formados - a.formados || b.pessoas - a.pessoas || a.ano - b.ano; });
    const posicao = {};
    ordem.forEach(function (t, i) {
      // mesma posição para turmas empatadas no número de formados
      posicao[t.ano] = i > 0 && t.formados === ordem[i - 1].formados ? posicao[ordem[i - 1].ano] : i + 1;
    });
    const total = lista.reduce(function (s, t) { return { formados: s.formados + t.formados, pessoas: s.pessoas + t.pessoas }; }, { formados: 0, pessoas: 0 });

    // Números do topo
    const numeros = document.getElementById('hero-numeros');
    if (numeros) {
      numeros.querySelector('[data-num="formados"]').textContent = fmt(total.formados);
      numeros.querySelector('[data-num="turmas"]').textContent = fmt(lista.length);
      numeros.querySelector('[data-num="pessoas"]').textContent = fmt(total.pessoas);
      numeros.hidden = false;
    }

    // Seletor (anos mais recentes primeiro)
    lista.slice().sort(function (a, b) { return b.ano - a.ano; }).forEach(function (t) {
      const op = document.createElement('option');
      op.value = String(t.ano);
      op.textContent = 'Turma de ' + t.ano;
      select.appendChild(op);
    });

    // Ranking: as 6 turmas mais presentes
    const maior = ordem[0].formados;
    ordem.slice(0, 6).forEach(function (t) {
      const li = document.createElement('li');
      li.dataset.ano = String(t.ano);
      const bt = document.createElement('button');
      bt.type = 'button';
      bt.className = 'ranking__item';
      bt.setAttribute('aria-label', 'Ver a turma de ' + t.ano + ': ' + t.formados + ' formados');
      const ano = document.createElement('span');
      ano.className = 'ranking__ano';
      ano.textContent = t.ano;
      const barra = document.createElement('span');
      barra.className = 'ranking__barra';
      const i = document.createElement('i');
      i.style.setProperty('--v', String(t.formados / maior));
      barra.appendChild(i);
      const n = document.createElement('span');
      n.className = 'ranking__n';
      n.textContent = t.formados;
      bt.append(ano, barra, n);
      bt.addEventListener('click', function () { select.value = String(t.ano); escolher(); });
      li.appendChild(bt);
      ranking.appendChild(li);
    });

    function escolher() {
      const t = lista.find(function (x) { return String(x.ano) === select.value; });
      ranking.querySelectorAll('li').forEach(function (li) { li.classList.toggle('atual', li.dataset.ano === select.value); });
      resultado.textContent = '';
      formacao.textContent = '';
      if (!t) {
        const p = document.createElement('p');
        p.className = 'turma__dica';
        p.textContent = 'Escolha o ano para ver quantos da sua turma estiveram no Encontro.';
        resultado.appendChild(p);
        return;
      }
      const num = document.createElement('p');
      num.className = 'turma__numero';
      num.textContent = fmt(t.formados);
      const txt = document.createElement('p');
      txt.className = 'turma__texto';
      const forte = document.createElement('strong');
      forte.textContent = 'formado' + (t.formados === 1 ? '' : 's') + ' da turma de ' + t.ano;
      txt.append(forte, document.createTextNode(
        (t.formados === 1 ? ' se inscreveu' : ' se inscreveram') + ' no Encontro 2026' +
        (t.pessoas > t.formados ? ' — ' + fmt(t.pessoas) + ' pessoas contando a família.' : '.')));
      const pos = document.createElement('p');
      pos.className = 'turma__posicao';
      pos.textContent = posicao[t.ano] === 1 ? 'A turma mais presente do Encontro.'
        : posicao[t.ano] + 'ª turma mais presente, entre ' + lista.length + '.';
      resultado.append(num, txt, pos);
      // Formação: um quadrado por formado (até 60), entrando em fila
      for (let k = 0; k < Math.min(t.formados, 60); k++) {
        const q = document.createElement('span');
        if (!REDUZIR_MOVIMENTO) q.style.animationDelay = (k * 40) + 'ms';
        formacao.appendChild(q);
      }
    }
    select.addEventListener('change', escolher);

    secao.hidden = false;
    document.querySelectorAll('[data-turma-link]').forEach(function (el) { el.hidden = false; });
    numerarSecoes();
    observarEntrada(ranking);
  }

  fetch(BACKEND_URL + '?action=turmas')
    .then(function (r) { return r.json(); })
    .then(function (d) { if (d && Array.isArray(d.turmas)) mostrar(d.turmas); })
    .catch(function () { /* sem dados: a seção fica escondida */ });
})();

/* ── GALERIA (um ano por vez) + MODAL DE IMAGEM ───────────────── */
(function initGaleriaModal() {
  const galerias = {
    '2025': ['images/web/2025-imagem1.webp', 'images/web/2025-imagem2.webp', 'images/web/2025-imagem3.webp',
             'images/web/2025-imagem4.webp', 'images/web/2025-imagem5.webp', 'images/web/2025-imagem6.webp'],
    '2024': ['images/web/2024-imagem1.webp', 'images/web/2024-imagem2.webp', 'images/web/2024-imagem3.webp',
             'images/web/2024-imagem4.webp', 'images/web/2024-imagem5.webp'],
    '2023': ['images/web/2023-imagem1.webp', 'images/web/2023-imagem2.webp', 'images/web/2023-imagem3.webp',
             'images/web/2023-imagem4.webp', 'images/web/2023-imagem5.webp', 'images/web/2023-imagem6.webp']
  };
  const img = document.getElementById('galeria-img');
  const contador = document.getElementById('galeria-contador');
  let ano = '2025';
  let idx = 0;

  function mostrar() {
    if (!img) return;
    img.src = galerias[ano][idx];
    img.alt = 'Foto ' + (idx + 1) + ' do Encontro de ' + ano;
    if (contador) contador.textContent = (idx + 1) + ' / ' + galerias[ano].length;
  }

  document.querySelectorAll('.galeria__ano').forEach(function (btn) {
    btn.addEventListener('click', function () {
      ano = btn.dataset.ano;
      idx = 0;
      document.querySelectorAll('.galeria__ano').forEach(function (b) { b.setAttribute('aria-pressed', String(b === btn)); });
      mostrar();
    });
  });
  document.querySelectorAll('.galeria__btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      const n = galerias[ano].length;
      idx = (idx + parseInt(btn.dataset.dir, 10) + n) % n;
      mostrar();
    });
  });

  /* ── Modal ──────────────────────────────────────────────────── */
  const modal = document.getElementById('modal-img-bg');
  const modalImg = document.getElementById('modal-img');
  const btnClose = document.getElementById('modal-close');
  const btnPrev = document.getElementById('modal-prev');
  const btnNext = document.getElementById('modal-next');
  if (!modal || !modalImg) return;

  let arr = [];
  let pos = 0;
  let lastFocus = null;

  function abrir(lista, posicao, origem) {
    arr = lista;
    pos = posicao;
    lastFocus = origem || null;
    modalImg.src = arr[pos];
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
    const multi = arr.length > 1;
    btnPrev.classList.toggle('show', multi);
    btnNext.classList.toggle('show', multi);
    btnClose.focus();
  }

  function fechar() {
    modal.classList.remove('active');
    document.body.style.overflow = '';
    if (lastFocus) lastFocus.focus();
  }

  function navegar(direcao) {
    if (arr.length < 2) return;
    pos = (pos + direcao + arr.length) % arr.length;
    modalImg.src = arr[pos];
  }

  /* Torna uma imagem clicável e acessível por teclado. */
  function tornarZoomavel(el, getLista, getPos) {
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    function ativar() { abrir(getLista(), getPos(), el); }
    el.addEventListener('click', ativar);
    el.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        ativar();
      }
    });
  }

  if (img) tornarZoomavel(img, function () { return galerias[ano]; }, function () { return idx; });

  const produtoImgs = Array.prototype.slice.call(document.querySelectorAll('.produto__img'));
  const produtoSrcs = produtoImgs.map(function (el) { return el.getAttribute('src'); });
  produtoImgs.forEach(function (el, i) {
    tornarZoomavel(el, function () { return produtoSrcs; }, function () { return i; });
  });

  btnClose.addEventListener('click', fechar);
  btnPrev.addEventListener('click', function () { navegar(-1); });
  btnNext.addEventListener('click', function () { navegar(1); });
  modal.addEventListener('click', function (e) {
    if (e.target === modal) fechar();
  });
  document.addEventListener('keydown', function (e) {
    if (!modal.classList.contains('active')) return;
    if (e.key === 'Escape') fechar();
    else if (e.key === 'ArrowLeft') navegar(-1);
    else if (e.key === 'ArrowRight') navegar(1);
  });
})();
