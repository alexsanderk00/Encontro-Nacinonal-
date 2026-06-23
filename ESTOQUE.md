# Estoque de referência — Produtos Oficiais 2026

> Estoque inicial informado em maio/2026. **Apenas referência interna** — o site
> NÃO bloqueia automaticamente quando o estoque acaba. Acompanhe as vendas pela
> aba **Pedidos** da planilha do Google e atualize as quantidades abaixo conforme
> for vendendo.

## Camiseta do Evento — R$ 65,00
Camiseta Prime (Malha Premium) · 100% algodão, fio 30.1 penteado, costura dupla,
gola e mangas reforçadas, pré-lavada.

| Grade | Tamanho | Estoque inicial |
|-------|---------|-----------------|
| Masculino | P  | 20 |
| Masculino | M  | 45 |
| Masculino | G  | 55 |
| Masculino | GG | 45 |
| Feminino  | P  | 10 |
| Feminino  | M  | 20 |
| Feminino  | G  | 5  |
| **Total** |    | **200** |

## Demais produtos

| Produto | Preço | Estoque inicial |
|---------|-------|-----------------|
| Garrafa | R$ 80,00 | 236 |
| Velame  | R$ 35,00 | 100 |
| Boné    | R$ 35,00 | 100 |
| Moeda   | R$ 60,00 | 120 |

---

### Como acompanhar as vendas
1. Abra a planilha do Google → aba **Pedidos**.
2. A coluna **Itens (detalhe)** mostra o produto, o tamanho e a quantidade de
   cada pedido (ex.: `Camiseta do Evento [G (Masc)] ×2 (R$ 140,00)`).
3. Some as quantidades vendidas por produto/tamanho e compare com o estoque acima.

### Se quiser ativar o bloqueio automático no futuro
Hoje a loja vende sem checar estoque. Para passar a bloquear automaticamente
quando um item/tamanho esgota, é necessário implementar o controle de estoque no
`backend.gs` (contagem de vendas na planilha) e no `loja.html` (esconder o que
esgotou). É só pedir quando desejar.
