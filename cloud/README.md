# Orbi Cloud

O servidor que fica entre os apps do Orbi (PC hoje, site e celular depois) e o **OpenRouter**.

- Guarda a **chave do OpenRouter**. Ela nunca vai para o app do usuário.
- Faz **login**: conta com e-mail e senha.
- Controla os **créditos**: o crédito do plano renova todo mês e o crédito extra não expira.
- Cobra pelo **Stripe**: assinatura mais pacotes de créditos extras.
- Repassa **chat, imagem, vídeo, voz (TTS) e transcrição** e desconta de cada usuário o custo real informado pelo OpenRouter, com a sua margem.

Usa só o Node.js 22 (sem `npm install`): SQLite nativo em modo WAL e TypeScript executado direto pelo Node.

## Rodar no seu PC

1. Instale o **Node.js 22 LTS ou mais novo** (https://nodejs.org).
2. Nesta pasta, copie `.env.example` para `.env` e preencha pelo menos:
   ```
   OPENROUTER_API_KEY=sk-or-v1-...   # sua chave nova do OpenRouter
   ADMIN_TOKEN=um-texto-longo-qualquer
   ```
3. Inicie:
   ```
   npm start
   ```
   Aparece `Orbi Cloud running on http://127.0.0.1:8787`.
4. Abra o Orbi e crie sua conta. Por padrão o app procura o servidor em `http://127.0.0.1:8787`; para trocar, clique no endereço que aparece embaixo da tela de login ou em Configurações › Conta e créditos.

Para se dar créditos sem pagar (testes, suporte):
```
npm run grant -- seu@email.com 5000
```

Os dados ficam em `data/orbi-cloud.db`. Faça backup desse arquivo.

## Créditos e preços

| Item | Padrão | Onde muda |
| --- | --- | --- |
| Valor de 1 crédito | US$ 0,001 (1.000 créditos = US$ 1) | `CREDIT_USD` no `.env` |
| Margem sobre o custo do OpenRouter | 25% | `MARKUP` (1.25) |
| Créditos grátis ao criar conta | 300 | `TRIAL_CREDITS` |
| Planos Pro / Studio | 15.000 / 45.000 créditos por mês | `plans.json` |
| Pacotes extras | 5.000 e 20.000 créditos | `plans.json` |

Os preços em `plans.json` são **hipóteses iniciais**. O valor que o cliente paga de verdade é o preço que você cria no Stripe.

Exemplo de custo: um vídeo de 4 s no Veo 3.1 Fast custa cerca de US$ 0,40 no OpenRouter. Com a margem de 25%, o usuário paga 500 créditos.

## Ligar o Stripe (modo de teste primeiro)

1. Em https://dashboard.stripe.com/test/products crie 4 produtos:
   - **Orbi Pro**: preço recorrente mensal.
   - **Orbi Studio**: preço recorrente mensal.
   - **5.000 créditos**: preço único.
   - **20.000 créditos**: preço único.
2. Copie os **IDs de preço** (`price_...`) para o `.env`: `STRIPE_PRICE_PRO`, `STRIPE_PRICE_STUDIO`, `STRIPE_PRICE_PACK_S`, `STRIPE_PRICE_PACK_L`.
3. Copie a **chave secreta** (`sk_test_...`) para `STRIPE_SECRET_KEY`.
4. Webhooks no seu PC: instale a Stripe CLI e rode
   ```
   stripe listen --forward-to localhost:8787/stripe/webhook --events checkout.session.completed,invoice.paid,customer.subscription.created,customer.subscription.updated,customer.subscription.deleted
   ```
   Copie o `whsec_...` que ela mostra para `STRIPE_WEBHOOK_SECRET`.
5. Ative o **Portal do cliente** em Settings › Billing › Customer portal (é por ele que o usuário cancela ou troca de plano).
6. Reinicie com `npm start`. No app, Conta e créditos › Assinar abre o checkout do Stripe no navegador; use o cartão de teste `4242 4242 4242 4242`.

## Endpoints

| Rota | O quê |
| --- | --- |
| `POST /auth/signup`, `/auth/login`, `/auth/logout` | Conta e sessão (token Bearer) |
| `GET /me`, `/me/usage` | Usuário, plano, créditos e extrato |
| `GET /billing/plans`, `POST /billing/checkout`, `/billing/portal` | Planos, pagamento e portal |
| `POST /stripe/webhook` | Eventos do Stripe (assinatura verificada) |
| `GET /v1/models`, `/v1/catalog` | Modelos de chat, imagem, vídeo e voz (sem modelos gratuitos) |
| `POST /v1/chat/completions` | Chat compatível com a API da OpenAI, com streaming |
| `POST /v1/images` | Imagem |
| `POST /v1/videos`, `GET /v1/videos/:id`, `/v1/videos/:id/content` | Vídeo em fila (job) |
| `POST /v1/audio/speech`, `/v1/audio/transcriptions` | Voz e transcrição |
| `POST /admin/grant`, `GET /admin/stats` | Administração (`ADMIN_TOKEN`) |

## Testes

```
npm test
```
Os testes sobem um OpenRouter falso e um Stripe falso e conferem:
- conta e créditos;
- chat em streaming, imagem, vídeo, voz e transcrição;
- checkout e webhooks;
- isolamento entre usuários;
- bloqueio quando os créditos acabam.

## Para publicar na internet (depois)

O mesmo código roda em qualquer servidor com Node 22 (VPS, Railway, Fly.io, Render).

- Defina `HOST=0.0.0.0` e um `PUBLIC_URL` com HTTPS.
- Aponte o webhook do Stripe para `https://seu-dominio/stripe/webhook`.
- Troque o endereço do servidor no app. Para os clientes, o padrão do app passa a ser esse domínio.
