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
  const produtoImgs = Array.prototype.slice.call(document.querySelectorAll('.produto__img'));
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
