/* ===================================================================
   AJUDA NO CHECKOUT — usado por inscricao.html e loja.html
   1) Mostra embaixo de cada campo o que está errado (antes, um CPF com
      dígito trocado só fazia o pagamento não aparecer, sem explicação).
   2) Corrige o preenchimento automático do celular nos campos do Mercado
      Pago (nome/CPF do titular): o texto aparecia, mas o Brick não
      registrava e acusava "Dado obrigatório" / "Formato inválido".
   =================================================================== */
'use strict';

(function () {
  function validarCPF(d) {
    if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
    for (let t = 9; t < 11; t++) {
      let s = 0;
      for (let c = 0; c < t; c++) s += parseInt(d.charAt(c), 10) * ((t + 1) - c);
      if (parseInt(d.charAt(t), 10) !== ((10 * s) % 11) % 10) return false;
    }
    return true;
  }

  const REGRAS = {
    nome: function (v) {
      return v.trim().length < 3 ? 'Informe seu nome completo.' : '';
    },
    email: function (v) {
      return /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']{2,}$/.test(v.trim())
        ? '' : 'E-mail inválido — confira (ex.: nome@gmail.com).';
    },
    cpf: function (v) {
      const d = v.replace(/\D/g, '');
      if (!d) return 'Informe o CPF.';
      if (d.length < 11) return 'CPF incompleto — faltam ' + (11 - d.length) + ' número(s).';
      return validarCPF(d) ? '' : 'CPF inválido — confira os números digitados.';
    },
    telefone: function (v) {
      const d = v.replace(/\D/g, '');
      return d.length >= 10 && d.length <= 11 ? '' : 'Telefone com DDD, ex.: (21) 99999-9999.';
    }
  };

  function caixaDeErro(input) {
    let m = input.parentElement.querySelector('.campo-erro');
    if (!m) {
      m = document.createElement('p');
      m.className = 'campo-erro';
      m.setAttribute('aria-live', 'polite');
      input.insertAdjacentElement('afterend', m);
    }
    return m;
  }

  /* Valida um campo, mostra/limpa a mensagem. Retorna a mensagem ('' = ok). */
  function checar(input) {
    const regra = REGRAS[input.id];
    if (!regra) return '';
    const erro = regra(input.value);
    caixaDeErro(input).textContent = erro;
    input.classList.toggle('campo-invalido', !!erro);
    input.setAttribute('aria-invalid', erro ? 'true' : 'false');
    return erro;
  }

  window.ajudaCheckout = {
    /* true se nome/e-mail/CPF/telefone estão ok (mesmas regras do servidor). */
    camposOk: function (form) {
      return Object.keys(REGRAS).every(function (id) {
        const el = form.querySelector('#' + id);
        return !el || !REGRAS[id](el.value);
      });
    },

    /* Liga a validação "ao sair do campo" (e limpa assim que corrigir). */
    ligarFormulario: function (form) {
      Object.keys(REGRAS).forEach(function (id) {
        const el = form.querySelector('#' + id);
        if (!el) return;
        el.addEventListener('blur', function () { if (el.value.trim()) checar(el); });
        el.addEventListener('input', function () { if (el.classList.contains('campo-invalido')) checar(el); });
      });
    },

    /* Explica por que o pagamento ainda não apareceu. Só fala quando a pessoa
       já preencheu todos os campos obrigatórios (para não incomodar digitando). */
    explicarPendencias: function (form, caixa) {
      const obrig = Array.prototype.filter.call(form.querySelectorAll('[required]'),
        function (e) { return e.type !== 'checkbox'; });
      const tudoPreenchido = obrig.every(function (e) { return e.value.trim(); });
      if (!tudoPreenchido) { caixa.textContent = ''; caixa.classList.remove('visible'); return; }
      const msgs = [];
      Object.keys(REGRAS).forEach(function (id) {
        const el = form.querySelector('#' + id);
        const erro = el ? checar(el) : '';
        if (erro) msgs.push(erro);
      });
      const lgpd = form.querySelector('input[type="checkbox"][required]');
      if (lgpd && !lgpd.checked) msgs.push('Marque a concordância com a Política de Privacidade.');
      if (!msgs.length && !form.checkValidity()) msgs.push('Confira os campos obrigatórios (*).');
      caixa.textContent = msgs.length ? 'Para liberar o pagamento, confira: ' + msgs.join(' ') : '';
      caixa.classList.toggle('visible', msgs.length > 0);
    },

    /* Corrige o autopreenchimento nos campos do Mercado Pago: quando o valor
       entra sem digitação, dispara o evento que o Brick escuta. */
    sincronizarBrick: function (container) {
      if (!container || container.dataset.sincronizado === '1') return;
      container.dataset.sincronizado = '1';
      function avisar(el) {
        if (el && el.tagName === 'INPUT' && el.type !== 'radio' && el.type !== 'checkbox' && el.value)
          el.dispatchEvent(new Event('input', { bubbles: true }));
      }
      ['focusout', 'change'].forEach(function (ev) {
        container.addEventListener(ev, function (e) { avisar(e.target); }, true);
      });
      // Antes do toque em "Pagar", sincroniza todos os campos preenchidos.
      ['pointerdown', 'touchstart'].forEach(function (ev) {
        container.addEventListener(ev, function () {
          container.querySelectorAll('input').forEach(avisar);
        }, { capture: true, passive: true });
      });
    }
  };
})();
