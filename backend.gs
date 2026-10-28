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
  'Adulto': 70,
  'Associado AsEFEx': 50,
  'Criança 9-14 anos': 40,
  'Criança até 8 anos': 0
};

/* Preços dos produtos da loja. Boné com 0 = ainda indisponível
   (a lógica do loja.html marca como "Em breve"). Nomes devem ser
   idênticos aos de PRODUTOS no loja.html. */
const PRECOS_PRODUTOS = {
  'Camiseta Masculina': 65,
  'Camiseta Feminina': 65,
  'Velame': 35,
  'Garrafa': 80,
  'Moeda': 60,
  'Boné': 35
};

/* Cabeçalhos das duas abas — usados por saveToSheet e por criarAbas(). */
const HEADERS_INSCRICOES = [
  'Data', 'Nome', 'Email', 'CPF', 'Telefone', 'Cidade', 'Ano Formação EsEFEx',
  'Categoria EsEFEx', 'Participantes', 'Itens (detalhe)', 'Qtd Total',
  'Total Bruto (R$)', 'Forma de Pagamento', 'Taxa Estimada (%)',
  'Taxa Estimada (R$)', 'Valor Líquido (R$)', 'Status Pagamento', 'ID Pagamento'
];
const HEADERS_PEDIDOS = [
  'Data', 'Nome', 'Email', 'CPF', 'Telefone', 'Observações', 'Itens (detalhe)',
  'Qtd Total', 'Total Bruto (R$)', 'Forma de Pagamento', 'Taxa Estimada (%)',
  'Taxa Estimada (R$)', 'Valor Líquido (R$)', 'Status Pagamento', 'ID Pagamento'
];

const EVENTO = {
  nome: 'Encontro Nacional dos Calções Pretos 2026',
  data: '31 de outubro de 2026 (sábado)',
  horario: '9h às 15h',
  local: 'Escola de Educação Física do Exército — Rio de Janeiro/RJ',
  emailContato: 'encontrocalcaopreto@gmail.com'
};

/* Prazo final das inscrições: 01/11/2026 23:59:59 no horário de Brasília
   (divulgado 24/10 → prorrogado 28/10 → aberto até o dia do evento, inscrição na hora pelo site).
   Fonte de verdade do corte — o frontend também fecha nessa data, mas é
   este check que impede inscrições atrasadas mesmo com a página aberta. */
const PRAZO_INSCRICAO_MS = new Date('2026-11-02T02:59:59Z').getTime();

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

/* SEGURANÇA — célula da planilha. O Sheets interpreta textos que começam com
   = + - @ como FÓRMULA (ex.: =IMPORTXML(...) poderia vazar dados da planilha
   para fora). Prefixar com apóstrofo força texto. Também corta o tamanho. */
function celula(v, max) {
  let s = String(v === undefined || v === null ? '' : v).slice(0, max || 200);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return s;
}

/* SEGURANÇA — limite por janela de tempo (CacheService). true = pode seguir. */
function dentroDoLimite(chave, maximo, segundos) {
  const cache = CacheService.getScriptCache();
  const atual = parseInt(cache.get(chave) || '0', 10);
  if (atual >= maximo) return false;
  cache.put(chave, String(atual + 1), segundos);
  return true;
}

/* SEGURANÇA — formato mínimo dos dados pessoais (tudo vem da internet). */
function validarInscrito(ins, ehProduto) {
  const nome = String(ins.nome || '').trim();
  const email = String(ins.email || '').trim();
  const tel = String(ins.telefone || '').replace(/\D/g, '');
  if (nome.length < 3 || nome.length > 120) return 'Nome inválido.';
  if (email.length > 120 || !/^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']{2,}$/.test(email)) return 'E-mail inválido.';
  if (tel && (tel.length < 10 || tel.length > 11)) return 'Telefone inválido.';
  if (!ehProduto && String(ins.participantes || '').length > 3000) return 'Lista de participantes muito longa.';
  if (ehProduto && String(ins.observacoes || '').length > 500) return 'Observações muito longas.';
  return '';
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
    if (!qtd || qtd < 1 || qtd > 20) return { ok: false, message: 'Quantidade inválida.' };
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
  // evento_data permite conferir de fora qual versão do script está publicada.
  return jsonOut({
    status: 'ok',
    message: 'Backend do ' + EVENTO.nome + ' ativo.',
    evento_data: EVENTO.data,
    evento_horario: EVENTO.horario,
    versao: '2026-10-28-email-recusado'
  });
}

function validatePayload(data, tabela) {
  const inscrito = data.inscrito;
  const items = data.items;
  if (data.tipo !== 'produto' && Date.now() > PRAZO_INSCRICAO_MS)
    return { ok: false, message: 'As inscrições foram encerradas.' };
  if (!inscrito || !items || !items.length || items.length > 20)
    return { ok: false, message: 'Dados incompletos. Preencha tudo e tente novamente.' };
  // Armadilha para robôs: campo invisível no formulário que humano não preenche.
  if (data.site_url) return { ok: false, message: 'Não foi possível processar. Tente novamente.' };
  // Limite geral (protege cota de e-mail/planilha contra enxurrada de pedidos).
  if (!dentroDoLimite('rl_global', 40, 60))
    return { ok: false, message: 'Sistema muito movimentado. Aguarde um minuto e tente novamente.' };
  if (!data.gratuito && !data.paymentData)
    return { ok: false, message: 'Dados de pagamento ausentes.' };
  const erroDados = validarInscrito(inscrito, data.tipo === 'produto');
  if (erroDados) return { ok: false, message: erroDados };
  if (!checkRateLimit(inscrito.cpf) ||
      !dentroDoLimite('rl_em_' + String(inscrito.email).trim().toLowerCase(), 5, 60))
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
  // Inscrição grátis não passa pelo Mercado Pago: limita volume por hora
  // (evita encher a planilha/lista do almoço com inscrições falsas).
  if (!dentroDoLimite('rl_gratis', 25, 3600))
    return jsonOut({ status: 'rejected', message: 'Limite de inscrições gratuitas atingido. Tente mais tarde ou escreva para ' + EVENTO.emailContato });
  const idInterno = 'GRATIS-' + Utilities.getUuid().slice(0, 8).toUpperCase();
  const fakeResult = { id: idInterno, payment_type_id: 'gratuito' };
  tryOrLog(function () { saveToSheet(inscrito, items, 0, fakeResult, ehProduto, 'Confirmado (Gratuito)'); }, 'saveToSheet gratuito');
  tryOrLog(function () { sendConfirmationEmail(inscrito, items, 0, idInterno, ehProduto); }, 'email gratuito');
  return jsonOut({ status: 'approved', payment_id: idInterno, message: 'Inscrição gratuita confirmada!' });
}

/* ── ROTEAMENTO DO RESULTADO DO PAGAMENTO ────────────────────────── */
function routePaymentResult(result, inscrito, items, total, ehProduto) {
  // Sem ID = o Mercado Pago nem criou o pagamento (token falso/expirado, dados
  // inválidos). Não grava na planilha nem manda e-mail — era um atalho para
  // robôs gerarem linhas e e-mails para qualquer endereço sem pagar nada.
  if (!result || !result.id) {
    return jsonOut({ status: 'rejected', status_detail: '',
      message: 'Pagamento não processado. Confira os dados do cartão ou use Pix.' });
  }
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
  tryOrLog(function () { sendRejectedEmail(inscrito, ehProduto); }, 'email recusado');
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
  // Na mesma rotina: cartões "Em Análise" que o Mercado Pago já decidiu.
  tryOrLog(function () { processarEmAnalise_(true); }, 'reverificar em análise');
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

/**
 * UTILITARIO — cria as abas "Inscrições" e "Pedidos" na planilha,
 * com os cabeçalhos certos, se ainda não existirem. Útil para deixar
 * as duas abas visíveis logo no início (antes da primeira venda da loja).
 * Rode UMA VEZ no editor do Apps Script.
 */
function criarAbas() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const abas = [
    { nome: ABA_INSCRICOES, headers: HEADERS_INSCRICOES },
    { nome: ABA_PEDIDOS,    headers: HEADERS_PEDIDOS    }
  ];
  abas.forEach(function (a) {
    if (ss.getSheetByName(a.nome)) {
      Logger.log('Aba "' + a.nome + '" já existe.');
      return;
    }
    const sheet = ss.insertSheet(a.nome);
    sheet.appendRow(a.headers);
    sheet.getRange(1, 1, 1, a.headers.length)
      .setFontWeight('bold').setBackground('#e1ad01').setFontColor('#111111');
    sheet.setFrozenRows(1);
    Logger.log('✓ Aba "' + a.nome + '" criada.');
  });
}

/* ── GRAVAÇÃO NA PLANILHA ────────────────────────────────────────── */
function saveToSheet(inscrito, items, total, paymentResult, ehProduto, statusOverride) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const nomeAba = ehProduto ? ABA_PEDIDOS : ABA_INSCRICOES;
  let sheet = ss.getSheetByName(nomeAba);

  if (!sheet) {
    sheet = ss.insertSheet(nomeAba);
    const headers = ehProduto ? HEADERS_PEDIDOS : HEADERS_INSCRICOES;
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

  // Tudo que vem do formulário passa por celula() (anti-fórmula + tamanho).
  const comuns = [
    new Date(), celula(inscrito.nome, 120), celula(inscrito.email, 120),
    celula(inscrito.cpf, 20), celula(inscrito.telefone, 20)
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
    ? [celula(inscrito.observacoes, 500)]
    : [celula(inscrito.cidade, 80), celula(inscrito.anoFormacao, 10),
       celula(inscrito.categoria, 60), celula(inscrito.participantes, 3000)];

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
      '<strong>Horário:</strong> ' + escapeHtml(EVENTO.horario) + '<br>' +
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

function sendRejectedEmail(inscrito, ehProduto) {
  if (!inscrito || !inscrito.email) return;
  const pagina = ehProduto ? 'loja.html' : 'inscricao.html';
  const link = 'https://www.encontrocalcaopreto.com.br/' + pagina + '?utm_source=email-recusado';
  const oQue = ehProduto ? 'seu pedido na Loja Oficial' : 'sua inscrição';
  let corpo = '<p>Olá, <strong>' + escapeHtml(String(inscrito.nome || '').split(' ')[0]) + '</strong>!</p>';
  corpo += '<p>O pagamento de ' + oQue + ' no <strong>' + escapeHtml(EVENTO.nome) + '</strong> ' +
           '<strong>não foi aprovado</strong> pelo Mercado Pago, por isso ' +
           (ehProduto ? 'o pedido não foi concluído' : 'a inscrição não foi concluída') + '. ' +
           '<strong>Nenhum valor foi cobrado.</strong></p>';
  corpo += '<p>Ainda dá tempo! Você pode tentar de novo agora mesmo — de preferência com ' +
           '<strong>Pix</strong>, que é aprovado na hora, ou com outro cartão:</p>';
  corpo += '<p style="text-align:center;margin:24px 0;">' +
           '<a href="' + link + '" style="background:#e1ad01;color:#111111;text-decoration:none;' +
           'font-weight:bold;padding:14px 28px;border-radius:999px;display:inline-block;">' +
           (ehProduto ? 'Voltar à Loja Oficial' : 'Fazer minha inscrição') + '</a></p>';
  corpo += '<p style="font-size:13px;color:#666666;">Se o botão não funcionar, copie este endereço no navegador: ' +
           link.split('?')[0] + '</p>';
  corpo += '<p>Dúvidas? Responda este e-mail ou escreva para ' + escapeHtml(EVENTO.emailContato) + '.</p>';
  MailApp.sendEmail({
    to: inscrito.email,
    subject: (ehProduto ? 'Pedido não concluído' : 'Inscrição não concluída') + ' — pagamento não aprovado — ' + EVENTO.nome,
    htmlBody: emailShell('Pagamento não aprovado', corpo),
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

/* ── RESUMO ──────────────────────────────────────────────────────── */

/**
 * Lê as abas Inscrições e Pedidos e gera/atualiza a aba "Resumo"
 * com contagem de vendas por categoria/produto vs estoque inicial.
 *
 * Rode manualmente ou instale o trigger com instalarTriggerResumo().
 */
function gerarResumo() {
  const ss = SpreadsheetApp.openById(SHEET_ID);

  // Estoque inicial de referência (atualizar aqui se o estoque mudar).
  const ESTOQUE_INICIAL = {
    'Camiseta Masculina P': 20, 'Camiseta Masculina M': 45,
    'Camiseta Masculina G': 55, 'Camiseta Masculina GG': 45,
    'Camiseta Feminina P': 10,  'Camiseta Feminina M': 20,
    'Camiseta Feminina G': 5,
    'Velame': 100, 'Garrafa': 236, 'Boné': 100, 'Moeda': 120
  };

  // Extrai pares {chave → quantidade} de uma string "Itens (detalhe)".
  // Formato: "Produto [Tam] ×N (R$ X,XX), Produto ×N (R$ X,XX)"
  function parseItens(str) {
    const resultado = {};
    String(str || '').split(', ').forEach(function (parte) {
      const m = parte.match(/^(.+?)(?:\s*\[([^\]]+)\])?\s*×(\d+)/);
      if (!m) return;
      const chave = m[2] ? m[1].trim() + ' ' + m[2].trim() : m[1].trim();
      resultado[chave] = (resultado[chave] || 0) + parseInt(m[3], 10);
    });
    return resultado;
  }

  // Lê uma aba e soma itens somente das linhas com status "Confirmado" ou "Aprovado".
  function somarAba(nomeAba) {
    const totais = {};
    const aba = ss.getSheetByName(nomeAba);
    if (!aba || aba.getLastRow() < 2) return totais;
    const dados = aba.getDataRange().getValues();
    const hdrs  = dados[0];
    const cDet  = hdrs.indexOf('Itens (detalhe)');
    const cStt  = hdrs.indexOf('Status Pagamento');
    if (cDet < 0 || cStt < 0) return totais;
    for (let i = 1; i < dados.length; i++) {
      const st = String(dados[i][cStt] || '');
      if (st.indexOf('Aprovado') < 0 && st.indexOf('Confirmado') < 0) continue;
      const itens = parseItens(dados[i][cDet]);
      Object.keys(itens).forEach(function (k) {
        totais[k] = (totais[k] || 0) + itens[k];
      });
    }
    return totais;
  }

  const vendasInsc = somarAba(ABA_INSCRICOES);
  const vendasProd = somarAba(ABA_PEDIDOS);

  // Criar ou limpar a aba Resumo.
  let resumo = ss.getSheetByName('Resumo');
  if (!resumo) {
    resumo = ss.insertSheet('Resumo');
  } else {
    resumo.clearContents();
    resumo.clearFormats();
  }

  const agora = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'dd/MM/yyyy HH:mm');
  const linhas = [];

  // Título + data
  linhas.push(['RESUMO — Encontro Nacional dos Calções Pretos 2026', '', '', '', '']);
  linhas.push(['Atualizado em: ' + agora, '', '', '', '']);
  linhas.push(['', '', '', '', '']);

  // ── INSCRIÇÕES ──
  linhas.push(['INSCRIÇÕES', '', '', '', '']);
  linhas.push(['Categoria', 'Confirmadas', '', 'Arrecadado (R$)', '']);
  const catOrdem = ['Adulto', 'Associado AsEFEx', 'Criança 9-14 anos', 'Criança até 8 anos'];
  var totalInscQtd = 0, totalInscVal = 0;
  catOrdem.forEach(function (cat) {
    const qtd  = vendasInsc[cat] || 0;
    const val  = qtd * (PRECOS_INSCRICAO[cat] || 0);
    totalInscQtd += qtd;
    totalInscVal += val;
    linhas.push([cat, qtd, '', val, '']);
  });
  linhas.push(['TOTAL INSCRIÇÕES', totalInscQtd, '', totalInscVal, '']);
  linhas.push(['', '', '', '', '']);

  // ── PRODUTOS ──
  linhas.push(['PRODUTOS', '', '', '', '']);
  linhas.push(['Produto / Tamanho', 'Vendidos', 'Estoque inicial', 'Restante', 'Arrecadado (R$)']);
  const prodOrdem = [
    { nome: 'Camiseta Masculina', tams: ['P', 'M', 'G', 'GG'] },
    { nome: 'Camiseta Feminina',  tams: ['P', 'M', 'G'] },
    { nome: 'Velame',  tams: null },
    { nome: 'Garrafa', tams: null },
    { nome: 'Boné',    tams: null },
    { nome: 'Moeda',   tams: null }
  ];
  var totalProdVal = 0;
  prodOrdem.forEach(function (p) {
    const preco = PRECOS_PRODUTOS[p.nome] || 0;
    if (p.tams) {
      p.tams.forEach(function (tam) {
        const chave   = p.nome + ' ' + tam;
        const vendido = vendasProd[chave] || 0;
        const inicial = ESTOQUE_INICIAL[chave] || 0;
        const arrecad = vendido * preco;
        totalProdVal += arrecad;
        linhas.push([chave, vendido, inicial, inicial - vendido, arrecad]);
      });
    } else {
      const vendido = vendasProd[p.nome] || 0;
      const inicial = ESTOQUE_INICIAL[p.nome] || 0;
      const arrecad = vendido * preco;
      totalProdVal += arrecad;
      linhas.push([p.nome, vendido, inicial, inicial - vendido, arrecad]);
    }
  });
  linhas.push(['TOTAL PRODUTOS', '', '', '', totalProdVal]);
  linhas.push(['', '', '', '', '']);
  linhas.push(['TOTAL GERAL (inscrições + produtos)', '', '', '', totalInscVal + totalProdVal]);

  // Gravar tudo de uma vez.
  resumo.getRange(1, 1, linhas.length, 5).setValues(linhas);

  // ── Formatação ──
  // Título (linha 1)
  resumo.getRange(1, 1, 1, 5).merge()
    .setBackground('#1a1a1a').setFontColor('#e1ad01')
    .setFontWeight('bold').setFontSize(13).setHorizontalAlignment('center');
  // Data (linha 2)
  resumo.getRange(2, 1, 1, 5).merge()
    .setFontStyle('italic').setFontColor('#666666').setHorizontalAlignment('center');

  // Cabeçalho INSCRIÇÕES (linha 4)
  var linhaInsc = 4;
  resumo.getRange(linhaInsc, 1, 1, 5).merge()
    .setBackground('#333333').setFontColor('#ffffff').setFontWeight('bold');
  // Cabeçalho colunas inscrições (linha 5)
  resumo.getRange(linhaInsc + 1, 1, 1, 5)
    .setBackground('#555555').setFontColor('#ffffff').setFontWeight('bold');
  // Linha TOTAL INSCRIÇÕES
  var linhaTotalInsc = linhaInsc + 2 + catOrdem.length;
  resumo.getRange(linhaTotalInsc, 1, 1, 5)
    .setBackground('#fff0b3').setFontWeight('bold');

  // Cabeçalho PRODUTOS
  var linhaProd = linhaTotalInsc + 2;
  resumo.getRange(linhaProd, 1, 1, 5).merge()
    .setBackground('#333333').setFontColor('#ffffff').setFontWeight('bold');
  resumo.getRange(linhaProd + 1, 1, 1, 5)
    .setBackground('#555555').setFontColor('#ffffff').setFontWeight('bold');

  // Linha TOTAL GERAL (última linha)
  var ultimaLinha = linhas.length;
  resumo.getRange(ultimaLinha, 1, 1, 5)
    .setBackground('#e1ad01').setFontWeight('bold').setFontSize(12);

  // Linha TOTAL PRODUTOS (penúltima antes do espaço)
  resumo.getRange(ultimaLinha - 2, 1, 1, 5)
    .setBackground('#fff0b3').setFontWeight('bold');

  resumo.autoResizeColumns(1, 5);

  Logger.log('✓ Resumo atualizado em ' + agora +
    ' — ' + totalInscQtd + ' inscrições, R$' + (totalInscVal + totalProdVal).toFixed(2) + ' total.');
}

/**
 * Instala trigger que roda gerarResumo() a cada hora.
 * Rode UMA VEZ no editor do Apps Script.
 */
function instalarTriggerResumo() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'gerarResumo') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('gerarResumo').timeBased().everyHours(1).create();
  Logger.log('✓ Trigger instalado: gerarResumo a cada hora.');
}


/* ═══════════════════════════════════════════════════════════════════
 * AVISO DE CORREÇÃO EM MASSA (data/horário do evento)
 *
 * Para quem recebeu e-mail de confirmação com data ou horário antigos.
 * Roda SÓ quando você executa — nada é enviado automaticamente.
 *
 * ORDEM RECOMENDADA (menu "Executar" do editor do Apps Script):
 *   1. simularAvisoCorrecao()       → só mostra no Registro quem receberia
 *   2. enviarAvisoCorrecaoTeste()   → manda UM e-mail de teste para você
 *   3. enviarAvisoCorrecao()        → envio real
 *
 * Regras do envio real:
 *   - Só aba "Inscrições", só status Aprovado / Confirmado (não envia para
 *     Pix pendente, recusado, expirado).
 *   - 1 e-mail por endereço, mesmo que tenha mais de uma inscrição.
 *   - Marca "Sim — data" na coluna "Aviso correção enviado" da planilha.
 *     Pode rodar de novo sem duplicar (só envia para quem ainda não tem "Sim").
 *   - Respeita a cota diária de e-mails do Google (conta Gmail comum: ~100/dia;
 *     Workspace: ~1500/dia). Se acabar, o restante fica para o dia seguinte:
 *     basta rodar enviarAvisoCorrecao() de novo.
 * ═══════════════════════════════════════════════════════════════════ */
const COL_AVISO = 'Aviso correção enviado';
const SITE_URL  = 'https://www.encontrocalcaopreto.com.br';

function emailAvisoCorrecao_(nome) {
  const primeiro = escapeHtml(String(nome || '').trim().split(' ')[0]);
  let corpo = '<p>Olá' + (primeiro ? ', <strong>' + primeiro + '</strong>' : '') + '!</p>';
  corpo += '<p>Sua inscrição no <strong>' + escapeHtml(EVENTO.nome) +
           '</strong> <strong>continua confirmada</strong> — você não precisa fazer nada.</p>';
  corpo += '<p>Estamos escrevendo porque o e-mail de confirmação que você recebeu antes pode ter ' +
           'trazido <strong>data ou horário desatualizados</strong>. Pedimos desculpas pela confusão. ' +
           'As informações corretas são:</p>';
  corpo += '<div style="background:#fff6e0;border:1px solid #e1ad01;border-radius:8px;' +
           'padding:12px 16px;margin:16px 0;">' +
           '<strong>Data:</strong> ' + escapeHtml(EVENTO.data) + '<br>' +
           '<strong>Horário:</strong> ' + escapeHtml(EVENTO.horario) + '<br>' +
           '<strong>Local:</strong> ' + escapeHtml(EVENTO.local) + '</div>';
  corpo += '<p>A programação completa está em <a href="' + SITE_URL + '">' +
           SITE_URL.replace('https://', '') + '</a>.</p>';
  corpo += '<p>Qualquer dúvida, responda este e-mail ou escreva para ' +
           escapeHtml(EVENTO.emailContato) + '.</p>';
  corpo += '<p>Nos vemos lá!</p>';
  return emailShell('Informações atualizadas do evento', corpo);
}

/* Lê a aba Inscrições e agrupa os destinatários por e-mail. */
function listarDestinatariosAviso_(criarColuna) {
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(ABA_INSCRICOES);
  if (!sheet || sheet.getLastRow() < 2) return { sheet: sheet, colAviso: 0, grupos: [], ignorados: 0 };

  const colEmail  = acharColuna(sheet, 'Email');
  const colNome   = acharColuna(sheet, 'Nome');
  const colStatus = acharColuna(sheet, 'Status Pagamento');
  if (!colEmail || !colStatus)
    throw new Error('Não achei as colunas "Email" e "Status Pagamento" na aba ' + ABA_INSCRICOES);

  let colAviso = acharColuna(sheet, COL_AVISO);
  if (!colAviso && criarColuna) {
    colAviso = sheet.getLastColumn() + 1;
    sheet.getRange(1, colAviso).setValue(COL_AVISO).setFontWeight('bold');
  }

  const dados = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
  const porEmail = {};
  let ignorados = 0;
  dados.forEach(function (r, i) {
    const status = String(r[colStatus - 1] || '');
    const email  = String(r[colEmail - 1] || '').trim().toLowerCase();
    if ((status.indexOf('Aprovado') < 0 && status.indexOf('Confirmado') < 0) || email.indexOf('@') < 1) {
      ignorados++;
      return;
    }
    const g = porEmail[email] ||
      (porEmail[email] = { email: email, nome: String(r[colNome - 1] || ''), linhas: [], enviado: false });
    g.linhas.push(i + 2);
    if (colAviso && String(r[colAviso - 1] || '').indexOf('Sim') === 0) g.enviado = true;
  });
  return {
    sheet: sheet,
    colAviso: colAviso,
    grupos: Object.keys(porEmail).map(function (k) { return porEmail[k]; }),
    ignorados: ignorados
  };
}

/* 1) SIMULAÇÃO — não envia nada nem altera a planilha. */
function simularAvisoCorrecao() {
  const info = listarDestinatariosAviso_(false);
  const pendentes = info.grupos.filter(function (g) { return !g.enviado; });
  Logger.log('SIMULAÇÃO — nada foi enviado.');
  Logger.log('Receberiam o aviso: ' + pendentes.length + ' e-mail(s). Já marcados como enviados: ' +
             (info.grupos.length - pendentes.length) + '. Linhas ignoradas (Pix pendente/recusado etc.): ' + info.ignorados + '.');
  Logger.log('Cota diária de e-mails restante: ' + MailApp.getRemainingDailyQuota());
  pendentes.forEach(function (g) { Logger.log(' • ' + g.nome + ' <' + g.email + '>'); });
}

/* 2) TESTE — manda um único e-mail, para a conta que está rodando o script. */
function enviarAvisoCorrecaoTeste() {
  const para = Session.getEffectiveUser().getEmail() || EVENTO.emailContato;
  MailApp.sendEmail({
    to: para,
    subject: '[TESTE] Informações atualizadas — ' + EVENTO.nome,
    htmlBody: emailAvisoCorrecao_('Participante Teste'),
    name: EVENTO.nome,
    replyTo: EVENTO.emailContato
  });
  Logger.log('E-mail de teste enviado para ' + para + '. Confira a caixa de entrada (e o spam).');
}

/* 3) ENVIO REAL. */
function enviarAvisoCorrecao() {
  const info = listarDestinatariosAviso_(true);
  const pendentes = info.grupos.filter(function (g) { return !g.enviado; });
  Logger.log('Para enviar agora: ' + pendentes.length + ' e-mail(s). Cota restante hoje: ' + MailApp.getRemainingDailyQuota());

  let enviados = 0, falhas = 0, parouPorCota = false;
  const carimbo = 'Sim — ' + Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'dd/MM/yyyy HH:mm');
  for (let i = 0; i < pendentes.length; i++) {
    const g = pendentes[i];
    if (MailApp.getRemainingDailyQuota() < 1) { parouPorCota = true; break; }
    try {
      MailApp.sendEmail({
        to: g.email,
        subject: 'Informações atualizadas do evento — ' + EVENTO.nome,
        htmlBody: emailAvisoCorrecao_(g.nome),
        name: EVENTO.nome,
        replyTo: EVENTO.emailContato
      });
      g.linhas.forEach(function (n) { info.sheet.getRange(n, info.colAviso).setValue(carimbo); });
      enviados++;
    } catch (e) {
      falhas++;
      Logger.log('FALHA ' + g.email + ': ' + e);
    }
  }
  Logger.log('Enviados: ' + enviados + ' | Falhas: ' + falhas +
             (parouPorCota ? ' | PAROU: cota diária esgotada — rode enviarAvisoCorrecao() de novo amanhã.' : ''));
}


/* ═══════════════════════════════════════════════════════════════════
 * CANCELAMENTOS MANUAIS (reembolsos feitos por fora do site)
 *
 * Marca como "Cancelado (reembolsado)" as inscrições de quem foi
 * reembolsado. Assim elas saem dos totais do resumo e do aviso em massa.
 *
 * COMO USAR (editor do Apps Script → Executar; não precisa de nova implantação):
 *   1. simularCancelamentos()  → só mostra no Registro o que seria alterado
 *   2. aplicarCancelamentos()  → altera a planilha
 *
 * SEGURANÇA: uma linha só é cancelada se bater o CPF (6 dígitos do meio)
 * ou o ID do pagamento E a soma dos totais das inscrições ativas da pessoa
 * for igual ao valor reembolsado. Qualquer dúvida (valor diferente, só o
 * nome bate, nada encontrado) → NÃO altera nada e explica no Registro.
 * Pode rodar mais de uma vez: linhas já canceladas são ignoradas.
 *
 * Para um novo cancelamento, acrescente um item na lista abaixo.
 * ═══════════════════════════════════════════════════════════════════ */
const STATUS_CANCELADO = 'Cancelado (reembolsado)';
const COL_OBS_CANCEL   = 'Obs. cancelamento';
const CANCELAMENTOS = [
  { nome: 'Robesio da Costa Vaz',     cpfMeio: '603607', valor: 70,  idPagamento: '174438535160',
    obs: 'Devolução aprovada pelo Mercado Pago em 20/10/2026 (R$ 70,00)' },
  { nome: 'Marcio Cesar Lass',        cpfMeio: '206409', valor: 70,
    obs: 'Reembolso por Pix em 20/10/2026 (R$ 70,00)' },
  { nome: 'Otavio Sustenei da Silva', cpfMeio: '246289', valor: 140,
    obs: 'Reembolso por Pix em 20/10/2026 (R$ 140,00)' }
];

function normTxt_(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

function simularCancelamentos() { processarCancelamentos_(false); }
function aplicarCancelamentos() { processarCancelamentos_(true); }

function processarCancelamentos_(aplicar) {
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(ABA_INSCRICOES);
  if (!sheet || sheet.getLastRow() < 2) { Logger.log('Aba ' + ABA_INSCRICOES + ' vazia ou inexistente.'); return; }

  const c = {
    nome:   acharColuna(sheet, 'Nome'),
    cpf:    acharColuna(sheet, 'CPF'),
    total:  acharColuna(sheet, 'Total Bruto (R$)'),
    status: acharColuna(sheet, 'Status Pagamento'),
    pid:    acharColuna(sheet, 'ID Pagamento')
  };
  Object.keys(c).forEach(function (k) {
    if (!c[k]) throw new Error('Coluna não encontrada na aba ' + ABA_INSCRICOES + ': ' + k);
  });
  let colObs = acharColuna(sheet, COL_OBS_CANCEL);
  if (!colObs && aplicar) {
    colObs = sheet.getLastColumn() + 1;
    sheet.getRange(1, colObs).setValue(COL_OBS_CANCEL).setFontWeight('bold');
  }

  Logger.log(aplicar ? '=== APLICANDO CANCELAMENTOS ===' : '=== SIMULAÇÃO (nada será alterado) ===');
  const dados = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();

  CANCELAMENTOS.forEach(function (cn) {
    const nomeN = normTxt_(cn.nome);
    const fortes = [], fracos = [];
    dados.forEach(function (r, i) {
      const cpfD = String(r[c.cpf - 1] || '').replace(/\D/g, '');
      const porCpf  = cpfD.length === 11 && cpfD.substr(3, 6) === cn.cpfMeio;
      const porId   = !!cn.idPagamento && String(r[c.pid - 1]).trim() === cn.idPagamento;
      const porNome = normTxt_(r[c.nome - 1]) === nomeN;
      const item = { linha: i + 2, nome: r[c.nome - 1], total: parseFloat(String(r[c.total - 1]).replace(',', '.')) || 0,
                     status: String(r[c.status - 1] || '') };
      if (porCpf || porId) fortes.push(item);
      else if (porNome) fracos.push(item);
    });

    Logger.log('--- ' + cn.nome + ' (reembolso R$ ' + cn.valor + ') ---');
    fracos.forEach(function (f) {
      Logger.log('  ⚠ linha ' + f.linha + ' tem o mesmo NOME mas CPF/ID diferentes (' + f.status + ', R$ ' + f.total +
                 ') — NÃO alterada; confira manualmente se for a mesma pessoa.');
    });
    if (!fortes.length) { Logger.log('  ✗ Nenhuma linha encontrada por CPF/ID. Nada alterado.'); return; }

    const ativas = fortes.filter(function (f) { return f.status.indexOf('Aprovado') >= 0 || f.status.indexOf('Confirmado') >= 0; });
    fortes.forEach(function (f) {
      if (ativas.indexOf(f) < 0) Logger.log('  • linha ' + f.linha + ' (' + f.nome + ') já está com status "' + f.status + '" — ignorada.');
    });
    if (!ativas.length) { Logger.log('  ✓ Nenhuma inscrição ativa (provavelmente já cancelada). Nada a fazer.'); return; }

    const soma = ativas.reduce(function (s, f) { return s + f.total; }, 0);
    ativas.forEach(function (f) {
      Logger.log('  → linha ' + f.linha + ': ' + f.nome + ' | R$ ' + f.total + ' | status atual: ' + f.status);
    });
    if (Math.abs(soma - cn.valor) > 0.009) {
      Logger.log('  ✗ VALOR DIFERENTE: planilha soma R$ ' + soma + ' mas o reembolso foi R$ ' + cn.valor +
                 '. NÃO alterado — confira (pode ser cancelamento parcial).');
      return;
    }
    if (!aplicar) { Logger.log('  ✓ Seria marcado como "' + STATUS_CANCELADO + '" (' + ativas.length + ' linha(s)).'); return; }
    ativas.forEach(function (f) {
      sheet.getRange(f.linha, c.status).setValue(STATUS_CANCELADO);
      sheet.getRange(f.linha, colObs).setValue(cn.obs);
    });
    Logger.log('  ✓ ' + ativas.length + ' linha(s) marcada(s) como "' + STATUS_CANCELADO + '".');
  });
}


/* ═══════════════════════════════════════════════════════════════════
 * PAGAMENTOS DE CARTÃO "EM ANÁLISE" (antifraude do Mercado Pago)
 *
 * Antes ninguém reconsultava essas linhas: ficavam "Em Análise" para
 * sempre, mesmo depois de o Mercado Pago aprovar ou recusar.
 *
 *   consultarEmAnalise()  → SÓ CONSULTA: mostra no Registro a situação real
 *                            de cada um no Mercado Pago. Não altera nada.
 *   atualizarEmAnalise()  → atualiza a planilha e manda o e-mail certo
 *                            (confirmação se aprovou; "não aprovado" se recusou).
 *
 * Depois de publicada, a rotina automática de 10 em 10 minutos
 * (reverificarPixPendentes) também atualiza essas linhas sozinha.
 * ═══════════════════════════════════════════════════════════════════ */
function consultarEmAnalise() { processarEmAnalise_(false); }
function atualizarEmAnalise() { processarEmAnalise_(true); }

function processarEmAnalise_(aplicar) {
  const resumo = { aprovado: 0, recusado: 0, aguardando: 0, outro: 0 };
  if (!aplicar) Logger.log('=== CONSULTA (nada será alterado) ===');
  getAbasPagamento().forEach(function (aba) {
    const sheet = aba.sheet;
    const c = {
      status: acharColuna(sheet, 'Status Pagamento'), id: acharColuna(sheet, 'ID Pagamento'),
      nome: acharColuna(sheet, 'Nome'), email: acharColuna(sheet, 'Email'),
      itens: acharColuna(sheet, 'Itens (detalhe)'), total: acharColuna(sheet, 'Total Bruto (R$)')
    };
    if (!c.status || !c.id) return;
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][c.status - 1]) !== 'Em Análise') continue;
      const pid = String(data[i][c.id - 1] || '').trim();
      const nome = data[i][c.nome - 1], total = data[i][c.total - 1];
      const rotulo = '[' + (aba.ehProduto ? 'Pedido' : 'Inscrição') + ' linha ' + (i + 1) + '] ' + nome + ' — R$ ' + total + ' — ID ' + pid;
      const mp = pid ? fetchPaymentStatus(pid) : null;
      if (!mp || !mp.status) { resumo.outro++; Logger.log('? ' + rotulo + ' → não consegui consultar no Mercado Pago'); continue; }

      const inscrito = { nome: nome, email: data[i][c.email - 1] };
      let novo = null;
      if (mp.status === 'approved') { novo = 'Aprovado'; resumo.aprovado++; }
      else if (mp.status === 'rejected' || mp.status === 'cancelled') { novo = mp.status === 'cancelled' ? 'Cancelado' : 'Recusado'; resumo.recusado++; }
      else if (mp.status === 'refunded' || mp.status === 'charged_back') { novo = 'Estornado'; resumo.outro++; }
      else { resumo.aguardando++; }

      Logger.log((novo === 'Aprovado' ? '✓ PAGOU  ' : novo ? '✗ NÃO PAGOU ' : '… AINDA EM ANÁLISE ') + rotulo +
                 ' → Mercado Pago: ' + mp.status + (mp.status_detail ? ' (' + mp.status_detail + ')' : ''));
      if (!aplicar || !novo) continue;

      sheet.getRange(i + 1, c.status).setValue(novo);
      if (novo === 'Aprovado') {
        const items = parseIngressosStr(data[i][c.itens - 1]);
        tryOrLog(function () { sendConfirmationEmail(inscrito, items, total, pid, aba.ehProduto); }, 'email análise aprovado');
      } else if (novo === 'Recusado' || novo === 'Cancelado') {
        tryOrLog(function () { sendRejectedEmail(inscrito, aba.ehProduto); }, 'email análise recusado');
      }
    }
  });
  Logger.log('RESUMO — pagaram: ' + resumo.aprovado + ' | não pagaram (recusado/cancelado): ' + resumo.recusado +
             ' | ainda em análise: ' + resumo.aguardando + ' | outros: ' + resumo.outro +
             (aplicar ? '' : '   (rode atualizarEmAnalise() para gravar na planilha)'));
}


/* ═══════════════════════════════════════════════════════════════════
 * CONVITE PARA TENTAR DE NOVO (quem teve pagamento recusado)
 *
 *   simularConviteRecusados() → só lista no Registro quem receberia
 *   enviarConviteRecusados()  → manda o e-mail "não foi concluída — tente de
 *                               novo" (com botão para a página certa)
 *
 * Só envia para quem tem linha Recusado/Cancelado E NÃO tem nenhuma linha
 * Aprovado/Confirmado na mesma aba (ou seja: ainda não conseguiu pagar).
 * 1 e-mail por pessoa; marca a coluna "Convite reenvio" para não repetir.
 * ═══════════════════════════════════════════════════════════════════ */
const COL_CONVITE = 'Convite reenvio';

function simularConviteRecusados() { conviteRecusados_(false); }
function enviarConviteRecusados() { conviteRecusados_(true); }

function conviteRecusados_(enviar) {
  Logger.log(enviar ? '=== ENVIANDO CONVITES ===' : '=== SIMULAÇÃO (nada será enviado) ===');
  let total = 0;
  getAbasPagamento().forEach(function (aba) {
    const sheet = aba.sheet;
    const cSt = acharColuna(sheet, 'Status Pagamento'), cEm = acharColuna(sheet, 'Email'), cNo = acharColuna(sheet, 'Nome');
    if (!cSt || !cEm) return;
    let cCv = acharColuna(sheet, COL_CONVITE);
    if (!cCv && enviar) { cCv = sheet.getLastColumn() + 1; sheet.getRange(1, cCv).setValue(COL_CONVITE).setFontWeight('bold'); }
    const data = sheet.getDataRange().getValues();
    const pagou = {}, recusados = {};
    for (let i = 1; i < data.length; i++) {
      const st = String(data[i][cSt - 1] || ''), em = String(data[i][cEm - 1] || '').trim().toLowerCase();
      if (!em) continue;
      if (st.indexOf('Aprovado') >= 0 || st.indexOf('Confirmado') >= 0) pagou[em] = true;
      if (st === 'Recusado' || st === 'Cancelado') {
        const r = recusados[em] || (recusados[em] = { nome: data[i][cNo - 1], linhas: [], jaConvidado: false });
        r.linhas.push(i + 1);
        if (cCv && String(data[i][cCv - 1] || '').indexOf('Sim') === 0) r.jaConvidado = true;
      }
    }
    Object.keys(recusados).forEach(function (em) {
      const r = recusados[em];
      if (pagou[em]) { Logger.log('  • ' + r.nome + ' <' + em + '> já pagou depois — não envia'); return; }
      if (r.jaConvidado) { Logger.log('  • ' + r.nome + ' <' + em + '> já recebeu o convite — não repete'); return; }
      total++;
      Logger.log('  → ' + (enviar ? 'ENVIADO: ' : 'receberia: ') + r.nome + ' <' + em + '> [' + (aba.ehProduto ? 'Loja' : 'Inscrição') + ']');
      if (!enviar) return;
      try {
        sendRejectedEmail({ nome: r.nome, email: em }, aba.ehProduto);
        const carimbo = 'Sim — ' + Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'dd/MM HH:mm');
        r.linhas.forEach(function (n) { sheet.getRange(n, cCv).setValue(carimbo); });
      } catch (e) { Logger.log('    FALHA: ' + e); }
    });
  });
  Logger.log((enviar ? 'Convites enviados: ' : 'Receberiam o convite: ') + total);
}
