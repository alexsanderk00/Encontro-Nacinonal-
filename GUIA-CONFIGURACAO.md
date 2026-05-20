# Guia de Configuração — Encontro Nacional dos Calções Pretos 2026

Este guia ensina, passo a passo, a colocar o sistema de inscrições no ar:
pagamento pelo Mercado Pago, registro automático numa planilha do Google e
envio de email de confirmação.

**Tempo estimado:** 30 a 40 minutos.

## Como as peças se encaixam

```
Site (inscricao.html / loja.html)
        │  envia os dados do pagamento
        ▼
Google Apps Script (backend.gs)  ◄── suas credenciais ficam aqui, em segurança
        │
        ├──► Mercado Pago  (cobra o pagamento)
        ├──► Google Sheets (salva a inscrição na planilha)
        └──► Gmail         (envia o email de confirmação)
```

Você vai precisar de:
- Uma conta no **Mercado Pago** (a mesma do fórum).
- Uma conta **Google** (para a planilha e o Apps Script — pode ser a mesma do fórum).

---

## PARTE 1 — Pegar as credenciais do Mercado Pago

As credenciais são duas chaves: a **Public Key** (pode ficar no site) e o
**Access Token** (secreto, fica só no backend).

1. Acesse **https://www.mercadopago.com.br/developers** e clique em **Entrar**.
   Use a **mesma conta do fórum**.
2. No menu, clique em **Suas integrações**.
3. Você pode **reaproveitar a aplicação do fórum** ou clicar em **Criar aplicação**
   (recomendado, para separar do fórum — o dinheiro cai na mesma conta de qualquer jeito).
   - Se criar: nome `Encontro Calcoes Pretos 2026`, produto **Pagamentos online** /
     modelo **CheckoutAPI**.
4. Abra a aplicação e vá em **Credenciais de teste**. Anote:
   - **Public Key de teste** (começa com `TEST-`)
   - **Access Token de teste** (começa com `TEST-`)
5. Vá também em **Credenciais de produção** e anote:
   - **Public Key de produção** (começa com `APP_USR-`)
   - **Access Token de produção** (começa com `APP_USR-`)

> **Comece sempre pelas credenciais de TESTE.** Elas simulam pagamentos sem
> cobrar dinheiro de verdade. Só troque para produção depois de testar tudo.

> **Nunca** compartilhe nem coloque o **Access Token** em arquivo do site ou no
> GitHub. Ele só vai na "caixa-forte" do Apps Script (Parte 3).

---

## PARTE 2 — Criar a planilha no Google Sheets

1. Acesse **https://sheets.google.com** e crie uma **planilha em branco**.
2. Dê um nome, por exemplo: `Inscrições Encontro Calções Pretos 2026`.
3. Copie o **ID da planilha** da barra de endereços. A URL é assim:
   ```
   https://docs.google.com/spreadsheets/d/AQUI_FICA_O_ID/edit
   ```
   O ID é o trecho longo entre `/d/` e `/edit`.
4. Guarde esse ID — você vai usá-lo na Parte 3.

> Não precisa criar abas nem cabeçalhos. O backend cria as abas
> **Inscrições** e **Pedidos** sozinho, na primeira vez que alguém se inscrever.

---

## PARTE 3 — Criar o backend no Google Apps Script

1. Acesse **https://script.google.com** (logado na **mesma conta Google** da planilha)
   e clique em **Novo projeto**.
2. Renomeie o projeto (canto superior esquerdo) para `Backend Encontro Calções Pretos`.
3. Apague todo o código que aparece no editor.
4. Abra o arquivo **`backend.gs`** (na pasta do site), copie **todo** o conteúdo e
   **cole** no editor do Apps Script.
5. Cadastre as credenciais (a "caixa-forte"):
   - Clique na engrenagem **⚙ Configurações do projeto** (menu da esquerda).
   - Em **Propriedades do script**, clique em **Adicionar propriedade do script** e
     crie estas duas:

     | Propriedade        | Valor                                            |
     |--------------------|--------------------------------------------------|
     | `MP_ACCESS_TOKEN`  | o **Access Token de teste** do Mercado Pago      |
     | `SHEET_ID`         | o **ID da planilha** (Parte 2)                   |

   - Clique em **Salvar propriedades do script**.
6. Volte ao editor, pressione **Ctrl + S** para salvar.
7. **Implantar como App da Web:**
   - Clique em **Implantar → Nova implantação**.
   - Em "Selecione o tipo", clique na engrenagem ⚙ e escolha **App da Web**.
   - Preencha:
     - **Executar como:** Eu
     - **Quem tem acesso:** Qualquer pessoa
   - Clique em **Implantar** e em **Autorizar acesso**. Se aparecer um aviso de
     "app não verificado", clique em **Avançado → Acessar (não seguro)** e
     **Permitir** (é normal, o projeto é seu).
   - Copie a **URL do app da Web** que aparece (termina em `/exec`). Guarde-a.
8. **Ativar a verificação automática do Pix:**
   - No editor, no menu de funções (no topo), selecione **`instalarTriggerPix`**.
   - Clique em **Executar** e autorize. Isso faz o sistema confirmar sozinho os
     pagamentos por Pix a cada 10 minutos.

---

## PARTE 4 — Conectar o site ao backend

1. Abra o arquivo **`inscricao.html`** num editor de texto.
2. Procure pelo bloco `CONFIG` (perto do fim do arquivo, dentro do `<script>`):
   ```js
   const CONFIG = {
     MP_PUBLIC_KEY: 'COLE_AQUI_SUA_PUBLIC_KEY_DO_MERCADO_PAGO',
     BACKEND_URL: 'COLE_AQUI_A_URL_DO_APPS_SCRIPT'
   };
   ```
3. Substitua:
   - `MP_PUBLIC_KEY` → a **Public Key de teste** (Parte 1)
   - `BACKEND_URL` → a **URL do app da Web** (Parte 3, passo 7)
4. Salve o arquivo.
5. Repita os passos 1 a 4 no arquivo **`loja.html`** (tem o mesmo bloco `CONFIG`).

---

## PARTE 5 — Testar (com as credenciais de TESTE)

1. Abra o `inscricao.html` no navegador.
2. Escolha os ingressos, preencha o formulário e os nomes dos participantes.
3. No pagamento, use um **cartão de teste** do Mercado Pago:
   - **Número:** `5031 4332 1540 6351`
   - **CVV:** `123`
   - **Validade:** qualquer data futura (ex.: `11/30`)
   - **Titular:** `APRO` (para aprovar) ou `OTHE` (para recusar)
   - **CPF:** qualquer CPF válido
4. Confirme que:
   - Você foi levado para a página de inscrição confirmada.
   - A planilha ganhou uma linha nova na aba **Inscrições**.
   - O email de confirmação chegou (verifique também o Spam).
5. Teste também:
   - **Inscrição gratuita:** inscreva só uma "Criança até 8 anos" — confirma sem pagamento.
   - **Pix:** escolha Pix no pagamento de teste e veja o QR Code aparecer.

---

## PARTE 6 — Ir para produção (pagamentos reais)

Só depois que os testes funcionarem:

1. **No Apps Script:** Configurações do projeto → Propriedades do script →
   troque o valor de `MP_ACCESS_TOKEN` pelo **Access Token de produção**.
2. Crie uma **nova versão da implantação**: **Implantar → Gerenciar implantações →**
   ✏ (editar) **→ Versão: Nova versão → Implantar**. A URL continua a mesma.
3. **No site:** troque `MP_PUBLIC_KEY` pela **Public Key de produção** no
   `inscricao.html` e no `loja.html`.
4. Faça **um teste real de R$ 1,00**: baixe temporariamente o preço de uma
   categoria, faça uma compra de verdade (cartão e Pix), confirme a planilha e o
   email, e depois volte o preço ao normal.

---

## PARTE 7 — Publicar o site (Vercel + domínio)

1. Crie uma conta no **https://vercel.com** e conecte o repositório do GitHub
   (`encontro-calcoes-pretos`). O Vercel publica o site automaticamente a cada
   alteração enviada ao GitHub.
2. Quando comprar o **domínio**, adicione-o no painel do Vercel em
   **Settings → Domains** e siga as instruções de DNS.

> **Importante:** sempre que você alterar o `backend.gs`, precisa criar uma
> **nova versão da implantação** no Apps Script (Parte 6, passo 2) para a
> mudança valer.

---

## PARTE 8 — Abrir a loja de produtos (quando tiver os preços)

A loja já está pronta, mas **desativada**. Para abri-la:

1. No `loja.html`: mude `const LOJA_ABERTA = false;` para `true` e preencha os
   preços reais em `PRODUTOS`.
2. No `backend.gs` (dentro do Apps Script): preencha os mesmos preços em
   `PRECOS_PRODUTOS` e crie uma **nova versão da implantação**.

---

## Resumo: onde vai cada credencial

| Credencial                  | Onde vai                                        |
|-----------------------------|-------------------------------------------------|
| Public Key (Mercado Pago)   | `inscricao.html` e `loja.html` → `MP_PUBLIC_KEY` |
| Access Token (Mercado Pago) | Apps Script → Propriedades do script → `MP_ACCESS_TOKEN` |
| ID da planilha              | Apps Script → Propriedades do script → `SHEET_ID` |
| URL do app da Web           | `inscricao.html` e `loja.html` → `BACKEND_URL`  |

## Dúvidas comuns

**Preciso pagar algo?** Não. Mercado Pago, Google e Vercel são gratuitos para
este uso. O Mercado Pago só cobra uma taxa sobre cada pagamento recebido
(aprox.: Pix 0,99%, cartão de crédito 4,98%, débito 1,99%).

**O inscrito não recebeu o email.** Peça para verificar a pasta de Spam. De
qualquer forma, todos os dados ficam salvos na planilha.

**Mudei o backend.gs e nada aconteceu.** Você precisa criar uma nova versão da
implantação no Apps Script (Parte 6, passo 2).
