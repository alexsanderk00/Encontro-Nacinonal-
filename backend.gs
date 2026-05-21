/**
 * ═══════════════════════════════════════════════════════════════════
 * BACKEND — Encontro Nacional dos Calções Pretos 2026
 * Google Apps Script: processa pagamentos do Mercado Pago e registra
 * inscrições e pedidos de produtos em uma planilha Google Sheets.
 *
 * COMO CONFIGURAR:
 * 1. Crie uma planilha no Google Sheets e copie o ID dela (da URL).
 * 2. Acesse https://script.google.com → Novo projeto e cole este código.
 * 3. Em Configurações do projeto → Propriedades do script, adicione:
 *      MP_ACCESS_TOKEN  →  Access Token do Mercado Pago (SECRETO)
 *      SHEET_ID         →  ID da planilha do Google Sheets
 * 4. Implante como App da Web (Implantar → Nova implantação → App da Web):
 *      Executar como: Eu      |      Quem tem acesso: Qualquer pessoa
 * 5. Copie a URL gerada e cole em CONFIG.BACKEND_URL no inscricao.html
 *    e no loja.html.
 * 6. Rode a função instalarTriggerPix() UMA VEZ para ativar a verificação
 *    automática dos pagamentos via Pix.
 *
 * SEGURANÇA: as credenciais NUNCA ficam no código — só em Propriedades
 * do script. Os preços são sempre validados aqui no servidor.
 * ═══════════════════════════════════════════════════════════════════
 */

/* ── CONFIGURAÇÃO ────────────────────────────────────────────────── */
const ACCESS_TOKEN   = PropertiesService.getScriptProperties().getProperty('MP_ACCESS_TOKEN');
const SHEET_ID       = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
const ABA_INSCRICOES = 'Inscrições';
const ABA_PEDIDOS    = 'Pedidos';

/* Preços oficiais — fonte de verdade. NUNCA confiar no frontend. */
const PRECOS_INSCRICAO = {
  'Adulto': 1,  // TESTE R$1 - reverter para 60
  'Sócio AsEFEx': 40,
  'Criança 9-14 anos': 30,
  'Criança até 8 anos': 0
};

/* Loja desativada: preencha os preços reais quando for abrir a loja.
   Os nomes devem ser idênticos aos de PRODUTOS no loja.html. */
const PRECOS_PRODUTOS = {
  'Camiseta Masculina': 0,
  'Camiseta Feminina': 0,
  'Camiseta Infantil': 0,
  'Garrafa': 0,
  'Moeda': 0
};

const EVENTO = {
  nome: 'Encontro Nacional dos Calções Pretos 2026',
  data: '22 de agosto de 2026 (sábado)',
  local: 'Escola de Educação Física do Exército — Rio de Janeiro/RJ',
  emailContato: 'encontrocalcaopreto@gmail.com'
};

/* ── HELPERS ─────────────────────────────────────────────────────── */
function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function tryOrLog(fn, label) {
  try { fn(); } catch (e) { Logger.log('ERRO ' + label + ': ' + e); }
}

function fmtBRL(n) {
  return 'R$ ' + Number(n || 0).toFixed(2).replace('.', ',');
}

function escapeHtml(text) {
  if (text === undefined || text === null) return '';
  return String(text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function maskCpf(cpf) {
  const d = String(cpf || '').replace(/\D/g, '');
  if (d.length !== 11) return '—';
  return d.substr(0, 3) + '.***.***-' + d.substr(9);
}

function validarCPF(cpf) {
  cpf = String(cpf || '').replace(/\D/g, '');
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  for (let t = 9; t < 11; t++) {
    let d = 0;
    for (let c = 0; c < t; c++) d += parseInt(cpf.charAt(c)) * ((t + 1) - c);
    d = ((10 * d) % 11) % 10;
    if (parseInt(cpf.charAt(t)) !== d) return false;
  }
  return true;
}

/**
 * Valida os preços contra a tabela do servidor.
 * IMPORTANTE: usa `precoReal === undefined` (e não `!precoReal`), senão
 * uma categoria gratuita (preço 0) seria rejeitada por engano.
 */
function validarPrecos(items, tabela) {
  let total = 0;
  for (const item of items) {
    const precoReal = tabela[item.tipo];
    if (precoReal === undefined) return { ok: false, message: 'Item inválido: ' + item.tipo };
    const qtd = parseInt(item.quantidade, 10);
    if (!qtd || qtd < 1 || qtd > 10) return { ok: false, message: 'Quantidade inválida.' };
    total += precoReal * qtd;
  }
  return { ok: true, total: total };
}

/* Rate limiting — máximo 5 requisições por minuto por CPF. */
function checkRateLimit(cpf) {
  const cache = CacheService.getScriptCache();
  const key = 'rl_' + String(cpf).replace(/\D/g, '');
  const atual = parseInt(cache.get(key) || '0', 10);
  if (atual >= 5) return false;
  cache.put(key, String(atual + 1), 60);
  return true;
}

/* Encontra a coluna (1-indexed) pelo nome do cabeçalho. 0 se não achar. */
function acharColuna(sheet, nomeHeader) {
  const ultima = sheet.getLastColumn();
  if (ultima < 1) return 0;
  const headers = sheet.getRange(1, 1, 1, ultima).getValues()[0];
  return headers.indexOf(nomeHeader) + 1;
}

/* Reconstrói os itens a partir da string "Adulto ×2 (R$ 120,00), ...". */
function parseIngressosStr(str) {
  const items = [];
  String(str || '').split(', ').forEach(function (parte) {
    const m = parte.match(/(.+?) ×(\d+)(?: \(R\$ ([\d.,]+)\))?/);
    if (!m) return;
    const qtd = parseInt(m[2], 10);
    let preco = 0;
    if (m[3]) {
      const subtotal = parseFloat(m[3].replace(/\./g, '').replace(',', '.'));
      preco = qtd > 0 ? subtotal / qtd : 0;
    }
    items.push({ tipo: m[1], quantidade: qtd, preco: preco });
  });
  return items;
}

/* ── ENDPOINTS ───────────────────────────────────────────────────── */
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    if (data.action === 'check_payment' && data.payment_id) {
      return checkPixPayment(data.payment_id);
    }

    const ehProduto = data.tipo === 'produto';
    const tabela = ehProduto ? PRECOS_PRODUTOS : PRECOS_INSCRICAO;

    Logger.log('doPost — tipo=' + (data.tipo || 'inscricao') +
               ' cpf=' + maskCpf(data.inscrito && data.inscrito.cpf) +
               ' itens=' + ((data.items && data.items.length) || 0));

    const v = validatePayload(data, tabela);
    if (!v.ok) return jsonOut({ status: 'rejected', message: v.message });

    // Pedido gratuito (total 0) — não passa pelo Mercado Pago.
    if (data.gratuito === true || v.total === 0) {
      return handleGratuito(v.inscrito, v.items, ehProduto, tabela);
    }

    const paymentResult = processPayment(v.paymentData, v.inscrito, v.total, ehProduto);
    return routePaymentResult(paymentResult, v.inscrito, v.items, v.total, ehProduto);

  } catch (err) {
    Logger.log('Erro doPost: ' + err);
    return jsonOut({
      status: 400,
      message: 'Erro ao processar. Tente novamente ou escreva para ' + EVENTO.emailContato
    });
  }
}

function doGet(e) {
  if (e && e.parameter && e.parameter.action === 'check_payment' && e.parameter.id) {
    return checkPixPayment(e.parameter.id);
  }
  return jsonOut({ status: 'ok', message: 'Backend do ' + EVENTO.nome + ' ativo.' });
}

function validatePayload(data, tabela) {
  const inscrito = data.inscrito;
  const items = data.items;
  if (!inscrito || !items || !items.length)
    return { ok: false, message: 'Dados incompletos. Preencha tudo e tente novamente.' };
  if (!data.gratuito && !data.paymentData)
    return { ok: false, message: 'Dados de pagamento ausentes.' };
  if (!checkRateLimit(inscrito.cpf))
    return { ok: false, message: 'Muitas tentativas. Aguarde um minuto e tente novamente.' };
  if (!validarCPF(inscrito.cpf))
    return { ok: false, message: 'CPF inválido.' };
  const p = validarPrecos(items, tabela);
  if (!p.ok) return { ok: false, message: p.message };
  return { ok: true, paymentData: data.paymentData, inscrito: inscrito, items: items, total: p.total };
}

/* ── PEDIDO GRATUITO (somente itens de preço 0) ──────────────────── */
function handleGratuito(inscrito, items, ehProduto, tabela) {
  for (const it of items) {
    if ((tabela[it.tipo] || 0) > 0)
      return jsonOut({ status: 'rejected', message: 'Pedido gratuito inválido — contém itens pagos.' });
  }
  const idInterno = 'GRATIS-' + Utilities.getUuid().slice(0, 8).toUpperCase();
  const fakeResult = { id: idInterno, payment_type_id: 'gratuito' };
  tryOrLog(function () { saveToSheet(inscrito, items, 0, fakeResult, ehProduto, 'Confirmado (Gratuito)'); }, 'saveToSheet gratuito');
  tryOrLog(function () { sendConfirmationEmail(inscrito, items, 0, idInterno, ehProduto); }, 'email gratuito');
  return jsonOut({ status: 'approved', payment_id: idInterno, message: 'Inscrição gratuita confirmada!' });
}

/* ── ROTEAMENTO DO RESULTADO DO PAGAMENTO ────────────────────────── */
function routePaymentResult(result, inscrito, items, total, ehProduto) {
  if (result.status === 'approved') return handleApproved(result, inscrito, items, total, ehProduto);
  if (result.status === 'pending' && result.payment_method_id === 'pix')
    return handlePixPending(result, inscrito, items, total, ehProduto);
  if (result.status === 'in_process' || result.status === 'pending')
    return handleInProcess(result, inscrito, items, total, ehProduto);
  return handleRejected(result, inscrito, items, total, ehProduto);
}

function handleApproved(result, inscrito, items, total, ehProduto) {
  tryOrLog(function () { saveToSheet(inscrito, items, total, result, ehProduto); }, 'saveToSheet aprovado');
  tryOrLog(function () { sendConfirmationEmail(inscrito, items, total, result.id, ehProduto); }, 'email aprovado');
  return jsonOut({ status: 'approved', payment_id: result.id, message: 'Pagamento aprovado!' });
}

function handlePixPending(result, inscrito, items, total, ehProduto) {
  tryOrLog(function () { saveToSheet(inscrito, items, total, result, ehProduto, 'Aguardando Pix'); }, 'saveToSheet pix');
  const tx = (result.point_of_interaction || {}).transaction_data || {};
  return jsonOut({
    status: 'pending_pix',
    payment_id: result.id,
    qr_code: tx.qr_code || '',
    qr_code_base64: tx.qr_code_base64 || '',
    message: 'Pix gerado! Escaneie o QR Code para pagar.'
  });
}

function handleInProcess(result, inscrito, items, total, ehProduto) {
  tryOrLog(function () { saveToSheet(inscrito, items, total, result, ehProduto, 'Em Análise'); }, 'saveToSheet análise');
  tryOrLog(function () { sendReviewEmail(inscrito, total, result.id); }, 'email análise');
  return jsonOut({
    status: 'in_process',
    payment_id: result.id,
    status_detail: result.status_detail || '',
    message: 'Pagamento em análise pelo Mercado Pago. Você receberá um email assim que for aprovado.'
  });
}

function handleRejected(result, inscrito, items, total, ehProduto) {
  const statusPlanilha = result.status === 'cancelled' ? 'Cancelado' : 'Recusado';
  tryOrLog(function () { saveToSheet(inscrito, items, total, result, ehProduto, statusPlanilha); }, 'saveToSheet recusado');
  tryOrLog(function () { sendRejectedEmail(inscrito); }, 'email recusado');
  return jsonOut({
    status: result.status || 'rejected',
    status_detail: result.status_detail || '',
    message: result.status_detail || 'Pagamento não aprovado. Tente novamente.'
  });
}

/* ── MERCADO PAGO — CRIAR PAGAMENTO ──────────────────────────────── */
function processPayment(paymentData, inscrito, total, ehProduto) {
  const fd = paymentData.formData || paymentData;
  const cpfLimpo = String(inscrito.cpf).replace(/\D/g, '');

  Logger.log('processPayment — metodo=' + (fd.payment_method_id || 'N/A') + ' total=' + total);

  const body = {
    transaction_amount: total,
    token: fd.token,
    installments: fd.installments || 1,
    payment_method_id: fd.payment_method_id,
    issuer_id: fd.issuer_id,
    description: (ehProduto ? 'Produtos — ' : 'Inscrição — ') + EVENTO.nome,
    external_reference: cpfLimpo,
    payer: {
      email: (fd.payer && fd.payer.email) || inscrito.email,
      identification: { type: 'CPF', number: cpfLimpo },
      first_name: String(inscrito.nome).split(' ')[0],
      last_name: String(inscrito.nome).split(' ').slice(1).join(' ')
    }
  };

  if (paymentData.paymentType === 'bank_transfer' || fd.payment_method_id === 'pix') {
    delete body.token;
    delete body.installments;
    delete body.issuer_id;
  }

  const response = UrlFetchApp.fetch('https://api.mercadopago.com/v1/payments', {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'Authorization': 'Bearer ' + ACCESS_TOKEN,
      'X-Idempotency-Key': Utilities.getUuid()
    },
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });

  const result = JSON.parse(response.getContentText());
  Logger.log('MP resposta — id=' + result.id + ' status=' + result.status +
             ' detalhe=' + (result.status_detail || 'N/A'));

  return {
    status: result.status,
    id: result.id,
    status_detail: result.status_detail,
    message: result.message,
    payment_method_id: result.payment_method_id,
    payment_type_id: result.payment_type_id,
    point_of_interaction: result.point_of_interaction
  };
}

function fetchPaymentStatus(paymentId) {
  try {
    const r = UrlFetchApp.fetch('https://api.mercadopago.com/v1/payments/' + paymentId, {
      method: 'get',
      headers: { 'Authorization': 'Bearer ' + ACCESS_TOKEN },
      muteHttpExceptions: true
    });
    return JSON.parse(r.getContentText());
  } catch (e) {
    Logger.log('fetchPaymentStatus ' + paymentId + ': ' + e);
    return null;
  }
}

/* ── VERIFICAÇÃO DE PIX ──────────────────────────────────────────── */
function getAbasPagamento() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const abas = [];
  [ABA_INSCRICOES, ABA_PEDIDOS].forEach(function (nome) {
    const s = ss.getSheetByName(nome);
    if (s && s.getLastRow() > 1) abas.push({ sheet: s, ehProduto: nome === ABA_PEDIDOS });
  });
  return abas;
}

function paymentIdExisteNaPlanilha(paymentId) {
  try {
    const cache = CacheService.getScriptCache();
    const key = 'pid_' + paymentId;
    const cached = cache.get(key);
    if (cached === '1') return true;
    if (cached === '0') return false;

    let achou = false;
    getAbasPagamento().forEach(function (aba) {
      if (achou) return;
      const col = acharColuna(aba.sheet, 'ID Pagamento');
      if (!col) return;
      const valores = aba.sheet.getRange(2, col, aba.sheet.getLastRow() - 1, 1).getValues();
      if (valores.some(function (r) { return String(r[0]) === String(paymentId); })) achou = true;
    });
    cache.put(key, achou ? '1' : '0', 300);
    return achou;
  } catch (e) {
    Logger.log('paymentIdExisteNaPlanilha: ' + e);
    return false;
  }
}

/**
 * Consulta o status de um pagamento Pix.
 * Protege contra enumeração: só consulta IDs que estão na planilha.
 * Cache de 10s alinhado ao polling do frontend.
 */
function checkPixPayment(paymentId) {
  if (!paymentId || paymentId === 'undefined' || paymentId === 'null') {
    return jsonOut({ status: 'error', message: 'ID de pagamento inválido.' });
  }
  if (!paymentIdExisteNaPlanilha(paymentId)) {
    return jsonOut({ status: 'error', message: 'ID não encontrado.' });
  }

  const cache = CacheService.getScriptCache();
  const cacheKey = 'pix_' + paymentId;
  const cached = cache.get(cacheKey);
  if (cached) return jsonOut(JSON.parse(cached));

  try {
    const result = fetchPaymentStatus(paymentId);
    if (!result) return jsonOut({ status: 'error', message: 'Falha ao consultar o Mercado Pago.' });

    if (result.status === 'approved') {
      tryOrLog(function () { atualizarPixNaPlanilha(paymentId, 'approved'); }, 'aprovar pix');
    } else if (['cancelled', 'rejected', 'expired'].indexOf(result.status) >= 0) {
      tryOrLog(function () { atualizarPixNaPlanilha(paymentId, result.status); }, 'expirar pix');
    }

    const out = { status: result.status, payment_id: paymentId };
    cache.put(cacheKey, JSON.stringify(out), 10);
    return jsonOut(out);
  } catch (err) {
    Logger.log('Erro checkPixPayment ' + paymentId + ': ' + err);
    return jsonOut({ status: 'error', message: 'Erro ao verificar o pagamento.' });
  }
}

/**
 * Atualiza uma linha "Aguardando Pix" nas abas de pagamento.
 * statusMp: 'approved' | 'cancelled' | 'rejected' | 'expired'
 */
function atualizarPixNaPlanilha(paymentId, statusMp) {
  getAbasPagamento().forEach(function (aba) {
    const sheet = aba.sheet;
    const colStatus = acharColuna(sheet, 'Status Pagamento');
    const colId     = acharColuna(sheet, 'ID Pagamento');
    const colNome   = acharColuna(sheet, 'Nome');
    const colEmail  = acharColuna(sheet, 'Email');
    const colItens  = acharColuna(sheet, 'Itens (detalhe)');
    const colTotal  = acharColuna(sheet, 'Total Bruto (R$)');
    if (!colStatus || !colId) return;

    const data = sheet.getDataRange().getValues();
    for (let i = data.length - 1; i >= 1; i--) {
      if (String(data[i][colId - 1]) !== String(paymentId)) continue;
      if (data[i][colStatus - 1] !== 'Aguardando Pix') continue;

      const inscrito = { nome: data[i][colNome - 1], email: data[i][colEmail - 1] };

      if (statusMp === 'approved') {
        sheet.getRange(i + 1, colStatus).setValue('Aprovado');
        const items = parseIngressosStr(data[i][colItens - 1]);
        tryOrLog(function () {
          sendConfirmationEmail(inscrito, items, data[i][colTotal - 1], paymentId, aba.ehProduto);
        }, 'email pix aprovado');
      } else {
        sheet.getRange(i + 1, colStatus).setValue(statusMp === 'expired' ? 'Pix Expirado' : 'Pix Cancelado');
        tryOrLog(function () { sendPixExpiredEmail(inscrito); }, 'email pix expirado');
      }
      return;
    }
  });
}

/**
 * UTILITÁRIO/TRIGGER — re-verifica todos os Pix pendentes nas duas abas.
 * É chamada automaticamente a cada 10 min (ver instalarTriggerPix).
 */
function reverificarPixPendentes() {
  getAbasPagamento().forEach(function (aba) {
    const sheet = aba.sheet;
    const colStatus = acharColuna(sheet, 'Status Pagamento');
    const colId     = acharColuna(sheet, 'ID Pagamento');
    const colNome   = acharColuna(sheet, 'Nome');
    const colEmail  = acharColuna(sheet, 'Email');
    const colItens  = acharColuna(sheet, 'Itens (detalhe)');
    const colTotal  = acharColuna(sheet, 'Total Bruto (R$)');
    if (!colStatus || !colId) return;

    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      const status = data[i][colStatus - 1];
      const pid = data[i][colId - 1];
      if (status !== 'Aguardando Pix' || !pid) continue;

      const mp = fetchPaymentStatus(pid);
      if (!mp) continue;
      const inscrito = { nome: data[i][colNome - 1], email: data[i][colEmail - 1] };

      if (mp.status === 'approved') {
        sheet.getRange(i + 1, colStatus).setValue('Aprovado');
        const items = parseIngressosStr(data[i][colItens - 1]);
        tryOrLog(function () {
          sendConfirmationEmail(inscrito, items, data[i][colTotal - 1], pid, aba.ehProduto);
        }, 'email pix aprovado (trigger)');
      } else if (['cancelled', 'rejected', 'expired'].indexOf(mp.status) >= 0) {
        sheet.getRange(i + 1, colStatus).setValue(mp.status === 'expired' ? 'Pix Expirado' : 'Pix Cancelado');
        tryOrLog(function () { sendPixExpiredEmail(inscrito); }, 'email pix expirado (trigger)');
      }
    }
  });
}

/**
 * Instala o gatilho que roda reverificarPixPendentes a cada 10 minutos.
 * Rode esta função UMA VEZ no editor do Apps Script.
 */
function instalarTriggerPix() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'reverificarPixPendentes') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('reverificarPixPendentes').timeBased().everyMinutes(10).create();
  Logger.log('✓ Trigger instalado: reverificarPixPendentes a cada 10 minutos.');
}

/* ── GRAVAÇÃO NA PLANILHA ────────────────────────────────────────── */
function saveToSheet(inscrito, items, total, paymentResult, ehProduto, statusOverride) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const nomeAba = ehProduto ? ABA_PEDIDOS : ABA_INSCRICOES;
  let sheet = ss.getSheetByName(nomeAba);

  if (!sheet) {
    sheet = ss.insertSheet(nomeAba);
    const headers = ehProduto
      ? ['Data', 'Nome', 'Email', 'CPF', 'Telefone', 'Observações', 'Itens (detalhe)',
         'Qtd Total', 'Total Bruto (R$)', 'Forma de Pagamento', 'Taxa Estimada (%)',
         'Taxa Estimada (R$)', 'Valor Líquido (R$)', 'Status Pagamento', 'ID Pagamento']
      : ['Data', 'Nome', 'Email', 'CPF', 'Telefone', 'Cidade', 'Ano Formação EsEFEx',
         'Categoria EsEFEx', 'Participantes', 'Itens (detalhe)', 'Qtd Total',
         'Total Bruto (R$)', 'Forma de Pagamento', 'Taxa Estimada (%)',
         'Taxa Estimada (R$)', 'Valor Líquido (R$)', 'Status Pagamento', 'ID Pagamento'];
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length)
      .setFontWeight('bold').setBackground('#e1ad01').setFontColor('#111111');
    sheet.setFrozenRows(1);
  }

  const detalhe = items.map(function (i) {
    const tam = i.tamanho ? ' [' + i.tamanho + ']' : '';
    return i.tipo + tam + ' ×' + i.quantidade + ' (R$ ' + (i.preco * i.quantidade).toFixed(2).replace('.', ',') + ')';
  }).join(', ');
  const qtdTotal = items.reduce(function (s, i) { return s + i.quantidade; }, 0);

  const metodo = paymentResult.payment_type_id || paymentResult.payment_method_id || '';
  let formaPgto = 'Outro';
  if (metodo === 'gratuito') formaPgto = 'Gratuito';
  else if (metodo === 'credit_card') formaPgto = 'Cartão de Crédito';
  else if (metodo === 'debit_card') formaPgto = 'Cartão de Débito';
  else if (metodo === 'bank_transfer' || paymentResult.payment_method_id === 'pix') formaPgto = 'Pix';
  else if (metodo === 'account_money') formaPgto = 'Saldo Mercado Pago';

  let taxaPct = 0;
  if (formaPgto === 'Cartão de Crédito') taxaPct = 4.98;
  else if (formaPgto === 'Cartão de Débito') taxaPct = 1.99;
  else if (formaPgto === 'Pix') taxaPct = 0.99;
  const taxaReais = total * (taxaPct / 100);
  const valorLiquido = total - taxaReais;

  const comuns = [
    new Date(), inscrito.nome, inscrito.email, inscrito.cpf, inscrito.telefone || ''
  ];
  const finais = [
    detalhe, qtdTotal, total, formaPgto,
    Math.round(taxaPct * 100) / 100,
    Math.round(taxaReais * 100) / 100,
    Math.round(valorLiquido * 100) / 100,
    statusOverride || 'Aprovado',
    String(paymentResult.id)
  ];
  const meio = ehProduto
    ? [inscrito.observacoes || '']
    : [inscrito.cidade || '', inscrito.anoFormacao || '', inscrito.categoria || '', inscrito.participantes || ''];

  sheet.appendRow(comuns.concat(meio).concat(finais));
}

/* ── EMAILS ──────────────────────────────────────────────────────── */
function emailShell(titulo, corpoHtml) {
  return '<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;' +
    'background:#ffffff;border:1px solid #eee;">' +
    '<div style="background:linear-gradient(135deg,#e1ad01,#ffd700);padding:24px;text-align:center;">' +
      '<h1 style="margin:0;color:#111111;font-size:20px;">' + escapeHtml(titulo) + '</h1>' +
    '</div>' +
    '<div style="padding:24px;color:#333333;font-size:15px;line-height:1.6;">' + corpoHtml + '</div>' +
    '<div style="background:#f8f9fa;padding:16px 24px;text-align:center;color:#888888;font-size:12px;">' +
      escapeHtml(EVENTO.nome) + '<br>' + escapeHtml(EVENTO.emailContato) +
    '</div></div>';
}

function itemsTabelaHtml(items) {
  if (!items || !items.length) return '';
  let linhas = '';
  items.forEach(function (i) {
    const sub = (i.preco || 0) * (i.quantidade || 0);
    linhas += '<tr>' +
      '<td style="padding:6px 0;border-bottom:1px solid #eeeeee;">' +
        escapeHtml(i.tipo) + ' × ' + i.quantidade + '</td>' +
      '<td style="padding:6px 0;border-bottom:1px solid #eeeeee;text-align:right;">' +
        (sub === 0 ? 'Isento' : fmtBRL(sub)) + '</td></tr>';
  });
  return '<table style="width:100%;border-collapse:collapse;font-size:14px;">' + linhas + '</table>';
}

function sendConfirmationEmail(inscrito, items, total, paymentId, ehProduto) {
  if (!inscrito || !inscrito.email) return;
  const primeiroNome = escapeHtml(String(inscrito.nome || '').split(' ')[0]);
  const oQue = ehProduto ? 'pedido de produtos' : 'inscrição';
  const titulo = ehProduto ? 'Pedido Confirmado' : 'Inscrição Confirmada';

  let corpo = '<p>Olá, <strong>' + primeiroNome + '</strong>!</p>';
  corpo += '<p>Seu ' + oQue + (Number(total) === 0 ? ' gratuito' : '') +
           ' no <strong>' + escapeHtml(EVENTO.nome) + '</strong> foi confirmado com sucesso.</p>';
  corpo += '<h3 style="color:#111111;margin:18px 0 8px;">Resumo</h3>';
  corpo += itemsTabelaHtml(items);
  corpo += '<p style="font-size:16px;margin-top:10px;"><strong>Total: ' +
           (Number(total) === 0 ? 'Isento' : fmtBRL(total)) + '</strong></p>';
  if (paymentId) corpo += '<p style="color:#888888;font-size:13px;">Código: #' + escapeHtml(paymentId) + '</p>';
  if (!ehProduto) {
    corpo += '<div style="background:#fff6e0;border:1px solid #e1ad01;border-radius:8px;' +
      'padding:12px 16px;margin-top:16px;">' +
      '<strong>Data:</strong> ' + escapeHtml(EVENTO.data) + '<br>' +
      '<strong>Local:</strong> ' + escapeHtml(EVENTO.local) + '</div>';
  }
  corpo += '<p style="margin-top:16px;">Qualquer dúvida, responda este email ou escreva para ' +
           escapeHtml(EVENTO.emailContato) + '.</p>';
  corpo += '<p>Nos vemos lá!</p>';

  MailApp.sendEmail({
    to: inscrito.email,
    subject: titulo + ' — ' + EVENTO.nome,
    htmlBody: emailShell(titulo, corpo),
    name: EVENTO.nome,
    replyTo: EVENTO.emailContato
  });
}

function sendReviewEmail(inscrito, total, paymentId) {
  if (!inscrito || !inscrito.email) return;
  let corpo = '<p>Olá, <strong>' + escapeHtml(String(inscrito.nome || '').split(' ')[0]) + '</strong>!</p>';
  corpo += '<p>Recebemos o seu pagamento, mas ele está em <strong>análise</strong> pelo Mercado Pago. ' +
           'É um procedimento padrão de segurança e pode levar até <strong>2 dias úteis</strong>.</p>';
  corpo += '<p>Você receberá um novo email assim que o pagamento for aprovado. ' +
           '<strong>Não tente pagar novamente</strong> para evitar cobranças duplicadas.</p>';
  if (paymentId) corpo += '<p style="color:#888888;font-size:13px;">Código: #' + escapeHtml(paymentId) + '</p>';
  MailApp.sendEmail({
    to: inscrito.email,
    subject: 'Pagamento em análise — ' + EVENTO.nome,
    htmlBody: emailShell('Pagamento em Análise', corpo),
    name: EVENTO.nome,
    replyTo: EVENTO.emailContato
  });
}

function sendRejectedEmail(inscrito) {
  if (!inscrito || !inscrito.email) return;
  let corpo = '<p>Olá, <strong>' + escapeHtml(String(inscrito.nome || '').split(' ')[0]) + '</strong>!</p>';
  corpo += '<p>Infelizmente o seu pagamento <strong>não foi aprovado</strong> pelo Mercado Pago. ' +
           'Nenhum valor foi cobrado.</p>';
  corpo += '<p>Você pode tentar novamente com outro cartão ou usar o <strong>Pix</strong> ' +
           '(aprovação imediata) na página de inscrição.</p>';
  MailApp.sendEmail({
    to: inscrito.email,
    subject: 'Pagamento não aprovado — ' + EVENTO.nome,
    htmlBody: emailShell('Pagamento Não Aprovado', corpo),
    name: EVENTO.nome,
    replyTo: EVENTO.emailContato
  });
}

function sendPixExpiredEmail(inscrito) {
  if (!inscrito || !inscrito.email) return;
  let corpo = '<p>Olá, <strong>' + escapeHtml(String(inscrito.nome || '').split(' ')[0]) + '</strong>!</p>';
  corpo += '<p>O prazo do seu Pix expirou e o pagamento não foi concluído. Nenhum valor foi cobrado.</p>';
  corpo += '<p>Se ainda quiser participar, é só refazer o processo no site.</p>';
  MailApp.sendEmail({
    to: inscrito.email,
    subject: 'Pix expirado — ' + EVENTO.nome,
    htmlBody: emailShell('Pix Expirado', corpo),
    name: EVENTO.nome,
    replyTo: EVENTO.emailContato
  });
}
