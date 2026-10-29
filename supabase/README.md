# Orbi Cloud no Supabase

Tudo o que o app Orbi usa na nuvem:
- **Auth:** login com e-mail e senha.
- **Banco (Postgres):** perfis, créditos, extrato, vídeos em produção e eventos do Stripe, todos com RLS ligado.
- **Edge Function `orbi`:** gateway do OpenRouter para chat, imagem, vídeo, voz e transcrição, mais os créditos, o Stripe e a administração.

Projeto: `jtdkbtszyrqogmvznrig` · Função: `https://jtdkbtszyrqogmvznrig.supabase.co/functions/v1/orbi`

## Segredos (Edge Functions › Secrets)

| Nome | Obrigatório | O quê |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | sim | Chave do OpenRouter. Só a função lê; nunca vai para o app |
| `ADMIN_EMAILS` | recomendado | E-mails de administrador, separados por vírgula (dão créditos e veem estatísticas no app) |
| `MARKUP` | não | Margem sobre o custo do OpenRouter (padrão `1.25`) |
| `CREDIT_USD` | não | Valor de 1 crédito em dólar (padrão `0.001`) |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | para cobrar | Chaves do Stripe |
| `STRIPE_PRICE_PRO`, `STRIPE_PRICE_STUDIO`, `STRIPE_PRICE_PACK_S`, `STRIPE_PRICE_PACK_L` | para cobrar | IDs de preço criados no Stripe |
| `PRO_CREDITS`, `STUDIO_CREDITS`, `PRO_LABEL`, `STUDIO_LABEL`, `PACK_S_LABEL`, `PACK_L_LABEL` | não | Créditos por mês e preços mostrados no app |
| `CHAT_MODELS` | não | Lista fixa de modelos de chat (IDs do OpenRouter, separados por vírgula) |

Os créditos de boas-vindas (300) ficam na função `handle_new_user` da migração.

## E-mails com código (Authentication › Emails › Templates)

O app aceita o código de 6 dígitos do e-mail, então ninguém depende de abrir uma página. Inclua `{{ .Token }}` em dois modelos:
- **Confirm signup:** por exemplo, `Seu código Orbi: <b>{{ .Token }}</b>`. Pode manter também o link `{{ .ConfirmationURL }}`.
- **Reset password:** por exemplo, `Código para trocar a senha no Orbi: <b>{{ .Token }}</b>`.

## Autenticação (Authentication › URL Configuration)

- **Site URL:** `https://jtdkbtszyrqogmvznrig.supabase.co/functions/v1/orbi/auth/done`

  É a página que o usuário vê depois de clicar no link de confirmação do e-mail.

## Stripe

1. Crie 4 preços no Stripe:
   - Pro: mensal;
   - Studio: mensal;
   - 5.000 créditos: avulso;
   - 20.000 créditos: avulso.
2. Coloque os IDs nos segredos.
3. Crie um webhook apontando para `https://jtdkbtszyrqogmvznrig.supabase.co/functions/v1/orbi/stripe/webhook` com os eventos:
   - `checkout.session.completed`
   - `invoice.paid`
   - `customer.subscription.created`, `customer.subscription.updated` e `customer.subscription.deleted`

   Salve o `whsec_…` em `STRIPE_WEBHOOK_SECRET`.
4. Ative o Customer portal no Stripe.

## Publicar mudanças

Pelo conector do Supabase (como foi feito agora) ou pela CLI:
```
supabase link --project-ref jtdkbtszyrqogmvznrig
supabase db push
supabase functions deploy orbi --no-verify-jwt
```
