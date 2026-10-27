/* ===================================================================
   HOMEPAGE — Encontro Nacional dos Calções Pretos 2026
   Menu mobile, efeito de scroll, animações, galeria e modal de imagem.
   =================================================================== */

'use strict';

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

/* ── ANIMAÇÃO DE ENTRADA AO ROLAR ─────────────────────────────── */
(function initReveal() {
  const targets = document.querySelectorAll(
    '.info-card, .program-day, .produto, .galeria-carrossel-box, .contact-card, .about-content'
  );
  if (!targets.length || !('IntersectionObserver' in window)) return;

  targets.forEach(function (el) { el.classList.add('reveal'); });

  const observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('visible');
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });

  targets.forEach(function (el) { observer.observe(el); });
})();

/* ── CONTAGEM REGRESSIVA (prazo de inscrição) ─────────────────── */
/* Fases (trocam sozinhas, inclusive com a página aberta):
     0 — até 24/10 23:59 → prazo divulgado, contagem até 24/10
     1 — até 28/10 23:59 → "prorrogado": data-prorroga / data-prorroga-aviso, contagem até 28/10
     2 — até 31/10 09:00 → "na hora": data-na-hora / data-na-hora-aviso, contagem até o início do Encontro
     3 — até 01/11 23:59 → Encontro acontecendo, inscrição na hora pelo site
     4 — depois          → inscrições encerradas
   O corte real fica no backend.gs (PRAZO_INSCRICAO_MS) e no inscricao.html.
   Pré-visualizar: ?previa-prorrogacao, ?previa-na-hora ou ?previa-dia-evento. */
const PRAZO_DIVULGADO  = new Date('2026-10-24T23:59:59-03:00').getTime();
const PRAZO_PRORROGADO = new Date('2026-10-28T23:59:59-03:00').getTime();
const INICIO_EVENTO    = new Date('2026-10-31T09:00:00-03:00').getTime();
const PRAZO_FINAL      = new Date('2026-11-01T23:59:59-03:00').getTime();

const PREVIA = (function () {
  const q = location.search;
  if (/[?&]previa-dia-evento\b/.test(q)) return new Date('2026-10-31T10:00:00-03:00').getTime();
  if (/[?&]previa-na-hora\b/.test(q))    return new Date('2026-10-29T10:00:00-03:00').getTime();
  if (/[?&]previa-prorrogacao\b/.test(q)) return new Date('2026-10-25T10:00:00-03:00').getTime();
  return 0;
})();

function faseDoPrazo(agora) {
  if (agora <= PRAZO_DIVULGADO) return 0;
  if (agora <= PRAZO_PRORROGADO) return 1;
  if (agora <= INICIO_EVENTO) return 2;
  if (agora <= PRAZO_FINAL) return 3;
  return 4;
}

function aplicarFase(fase) {
  document.querySelectorAll('[data-prorroga],[data-na-hora]').forEach(function (e) {
    const t = fase >= 2 && e.hasAttribute('data-na-hora') ? e.getAttribute('data-na-hora')
      : fase >= 1 && e.hasAttribute('data-prorroga') ? e.getAttribute('data-prorroga') : null;
    if (t !== null) e.textContent = t;
  });
  document.querySelectorAll('[data-prorroga-aviso]').forEach(function (e) { e.hidden = fase !== 1; });
  document.querySelectorAll('[data-na-hora-aviso]').forEach(function (e) { e.hidden = !(fase === 2 || fase === 3); });
}

(function initCountdown() {
  const el = document.getElementById('countdown');
  const compacto = document.getElementById('countdown-inscricao');
  const legenda = document.querySelector('.hero__countdown-caption');
  if (!el && !compacto) return;

  const desvio = PREVIA ? PREVIA - Date.now() : 0;   // só ≠ 0 na prévia
  let fase = -1;
  const campos = el ? {
    dias:  el.querySelector('[data-cd="dias"]'),
    horas: el.querySelector('[data-cd="horas"]'),
    min:   el.querySelector('[data-cd="min"]'),
    seg:   el.querySelector('[data-cd="seg"]')
  } : null;

  function pad(n) { return String(n).padStart(2, '0'); }

  let intervalo = null;

  function mensagemFinal(htmlHero, textoCompacto) {
    if (el) el.innerHTML = htmlHero;
    if (legenda) legenda.hidden = true;
    if (compacto) compacto.textContent = textoCompacto;
  }

  function tick() {
    const agora = Date.now() + desvio;
    const f = faseDoPrazo(agora);
    if (f !== fase) { fase = f; aplicarFase(fase); }

    if (fase === 3) {
      mensagemFinal('<p class="hero__countdown-encerrado">O Encontro está acontecendo! Inscreva-se na hora, pelo site.</p>',
        '📍 O Encontro está acontecendo — inscreva-se na hora, pelo site!');
      return;
    }
    if (fase === 4) {
      mensagemFinal('<p class="hero__countdown-encerrado">Inscrições encerradas</p>', 'Inscrições encerradas.');
      if (intervalo) clearInterval(intervalo);
      return;
    }

    const alvo = fase === 0 ? PRAZO_DIVULGADO : fase === 1 ? PRAZO_PRORROGADO : INICIO_EVENTO;
    const diff = alvo - agora;
    const dias  = Math.floor(diff / 86400000);
    const horas = Math.floor((diff % 86400000) / 3600000);
    const min   = Math.floor((diff % 3600000) / 60000);
    const seg   = Math.floor((diff % 60000) / 1000);
    if (campos) {
      campos.dias.textContent  = pad(dias);
      campos.horas.textContent = pad(horas);
      campos.min.textContent   = pad(min);
      campos.seg.textContent   = pad(seg);
    }
    if (compacto) {
      compacto.textContent = fase === 2
        ? (dias > 0 ? (dias === 1 ? '⏳ Falta 1 dia' : '⏳ Faltam ' + dias + ' dias') + ' para o Encontro — inscreva-se pelo site, até na hora!'
                    : '⏳ Falta pouco para o Encontro! Inscreva-se pelo site, inclusive na hora.')
        : (dias > 0 ? (dias === 1 ? '⏳ Resta 1 dia' : '⏳ Restam ' + dias + ' dias') + ' para o fim das inscrições'
                    : '⏳ Últimas horas para se inscrever!');
    }
  }

  tick();
  intervalo = setInterval(tick, 1000);
})();

/* ── GALERIA (carrosséis por ano) + MODAL DE IMAGEM ───────────── */
(function initGaleriaModal() {
  const galerias = {
    '2023': [
      'images/galeria/2023/Imagem1.jpg',
      'images/galeria/2023/Imagem2.jpg',
      'images/galeria/2023/Imagem3.jpg',
      'images/galeria/2023/Imagem4.jpg',
      'images/galeria/2023/Imagem5.jpg',
      'images/galeria/2023/Imagem6.jpg'
    ],
    '2024': [
      'images/galeria/2024/Imagem1.jpg',
      'images/galeria/2024/Imagem2.jpg',
      'images/galeria/2024/Imagem3.jpg',
      'images/galeria/2024/Imagem4.jpg',
      'images/galeria/2024/Imagem5.jpg'
    ],
    '2025': [
      'images/galeria/2025/Imagem1.JPG',
      'images/galeria/2025/Imagem2.JPG',
      'images/galeria/2025/Imagem3.JPG',
      'images/galeria/2025/Imagem4.JPG',
      'images/galeria/2025/Imagem5.JPG',
      'images/galeria/2025/Imagem6.JPG'
    ]
  };
  const galeriaIdx = { '2023': 0, '2024': 0, '2025': 0 };

  function mostrarGaleria(ano) {
    const img = document.getElementById('img-galeria-' + ano);
    if (img) img.src = galerias[ano][galeriaIdx[ano]];
  }

  function mudarGaleria(ano, direcao) {
    const imgs = galerias[ano];
    if (!imgs) return;
    galeriaIdx[ano] = (galeriaIdx[ano] + direcao + imgs.length) % imgs.length;
    mostrarGaleria(ano);
  }

  document.querySelectorAll('.carousel-btn[data-galeria]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      mudarGaleria(btn.dataset.galeria, parseInt(btn.dataset.dir, 10));
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
  let idx = 0;
  let lastFocus = null;

  function abrir(lista, posicao, origem) {
    arr = lista;
    idx = posicao;
    lastFocus = origem || null;
    modalImg.src = arr[idx];
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
    idx = (idx + direcao + arr.length) % arr.length;
    modalImg.src = arr[idx];
  }

  /* Torna uma imagem clicável e acessível por teclado. */
  function tornarZoomavel(img, getLista, getPos) {
    img.setAttribute('role', 'button');
    img.setAttribute('tabindex', '0');
    function ativar() { abrir(getLista(), getPos(), img); }
    img.addEventListener('click', ativar);
    img.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        ativar();
      }
    });
  }

  // Imagens da galeria
  Object.keys(galerias).forEach(function (ano) {
    const img = document.getElementById('img-galeria-' + ano);
    if (img) tornarZoomavel(img, function () { return galerias[ano]; }, function () { return galeriaIdx[ano]; });
  });

  // Imagens dos produtos
  const produtoImgs = Array.prototype.slice.call(document.querySelectorAll('.produto__img'))
    .filter(function (el) { return el.tagName === 'IMG'; });
  const produtoSrcs = produtoImgs.map(function (img) { return img.getAttribute('src'); });
  produtoImgs.forEach(function (img, i) {
    tornarZoomavel(img, function () { return produtoSrcs; }, function () { return i; });
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
