# Orbi: continuar daqui

Documento principal de continuidade do projeto. Atualize este arquivo ao encerrar uma sessão, seja com Claude ou Codex. Não crie outro arquivo que difira deste nome apenas por maiúsculas/minúsculas.

## 30/10: execução local de skills e /goal — 0.1.30-1

- Daniel pediu Rust + TypeScript e autorizou levar o fluxo também ao Electron atual. Implementação e limites em `docs/SKILL_LOCAL_RUNTIME.md`.
- Terminal de tarefas com aprovação obrigatória, logs, erros e cancelamento; fila de aprovação; `/goal` sem o limite de oito rodadas; skill Remotion incluída na biblioteca. ZIP fornecido foi somente inspecionado, sem executar scripts.
- Publicação `[source-only]` preserva o pedido de não gerar instaladores. Os testes continuam no CI; release automática ignora esse marcador e empacotamento Tauri é manual. Não afirmar que aplicativos instalados receberam o backend novo: o atualizador Electron exige `core` igual para UI-only e Tauri ainda não tem updater assinado.
- Testes locais: comandos reais inofensivos, cancelamento rápido, UTF-8, códigos de saída, parser e goal com dez rodadas simuladas; recusa pausa; UI em navegador isolado, três temas e 800px; TypeScript, build do front e testes Rust.

Notas anteriores: [histórico da versão 0.1.27-2](docs/history/continuation-0.1.27-2.md). Esse histórico descreve uma versão antiga; para o estado atual, use as notas abaixo.

Resumo da sessão de 28/10/2026 (Daniel Rodrigues + Claude), para retomar o trabalho sem perder contexto.
Versão desta revisão: **0.1.29-11** (publicação via GitHub Actions, `iwerry/chatorbit-app`).

## 29/10: revisão do workspace com Codex

- Impeccable: contexto inicial carregado, `init` aplicado ao registro existente em `PRODUCT.md`, preservando a identidade de `DESIGN.md`. Detector executado antes e depois; seus alertas sobre brilhos da marca não substituem a direção visual escolhida pelo Daniel.
- `src/workspace.css`: ajustes dos três temas, espaçamento, menus e Boards. Menus do chat agora usam `ModelMenu`; popovers do composer saem do contêiner e se ajustam à janela. As proporções usam só a rolagem do painel externo.
- `ContextIdeas.tsx`: sugestões locais de vídeo, imagem e áudio conforme o rascunho. Preços vêm do catálogo; sugestões de rapidez são por família de modelos, sem promessa de latência medida.
- `AutoTextarea.tsx`: altura automática dos prompts do Canvas e do áudio.
- `WorkflowTabs.tsx` e `NodeFlow.tsx`: cada aba mantém o próprio grafo e execução, salva em uma chave distinta e pode ser reaberta. O workflow antigo continua na chave `flow`. Abas em execução não podem ser fechadas. Botão direito abre a busca de nós na posição do cursor.
- Corrigido o conflito de nomes no Windows: usar somente `continue.md`; o antigo `CONTINUE.md` está preservado integralmente em `docs/history/continuation-0.1.27-2.md`.
- Supabase CLI autenticado e cópia local vinculada ao projeto OrbiX. Arquivos temporários do CLI estão ignorados pelo Git. Nenhuma migração ou função alterada nesta revisão.
- Testes desta revisão: TypeScript e build de produção; navegador isolado com ponte simulada (sem gasto de créditos), menus, prompts longos, visualizador dos Boards, abas independentes, persistência e reabertura, três temas e janelas de 1366×900, 1000×700 e 800×600. Execução real dos provedores não foi usada na validação visual.

## Regras do projeto

- Responder ao Daniel em **português**.
- Versão no formato `0.1.DD-N` (DD = dia do mês). Cada push na `main` gera uma release, e o app instalado oferece a atualização.
  - Para subir só documentação sem gerar release, use `[skip ci]` na mensagem do commit.
- Commits como `Claude <noreply@anthropic.com>`, terminando com `Co-Authored-By` e `Claude-Session`.
- **Nunca** colocar chaves (OpenRouter, Stripe, senha do banco) no código, no app ou no Git: o repositório é público.
- Assinatura da marca: "Developed by Daniel Rodrigues · Draft Creative Studio Ltda".
- Visual: Adaptive Soft UI com três temas (Orbi Dark, Orbi Light, Orbi Terminal). Ver `DESIGN.md` e `PRODUCT.md`.
  - Antes de mexer em interface, rodar o detector do Impeccable.

## Onde está cada coisa

| Pasta / arquivo | O quê |
| --- | --- |
| `src/` | Front em React 19 + TypeScript + Tailwind 4 (Vite) |
| `src/App.tsx` | Chat, caixa de mensagem (Conversar · Imagem · Vídeo), gate de login |
| `src/components/ComposerKit.tsx` | Placeholder animado, guia de comandos, controle de esforço, mic/saída de áudio, controles de imagem/vídeo, card de mídia no chat |
| `src/components/AccountPanel.tsx` | Login/cadastro, Conta e créditos, administração, voz na nuvem |
| `src/components/CreativeStudio.tsx` · `NodeFlow.tsx` | Creative (Launchpad, Canvas, Workflows, Galeria) |
| `src/components/MediaLibrary.tsx` · `Lightbox.tsx` | Media Library em tela cheia e o visualizador |
| `src/lib/cloud.ts` | `CLOUD_ONLY = true`, estado da conta e catálogo |
| `src/lib/creativeBus.ts` · `creative.ts` | Fila de renders entre chat, biblioteca e Creative; modelos e tamanhos |
| `electron/main.cjs` | Processo principal (IPC) |
| `electron/cloud.cjs` | Cliente do Orbi Cloud (Supabase Auth + função `orbi`) |
| `supabase/` | Migração do banco e a Edge Function `orbi` (ver `supabase/README.md`) |
| `library-imports/INDEX.md` | Lista de tarefas detalhada |
| `RELEASE_NOTES.md` | O que mudou em cada versão |

## 29/10: o que mudou

- **0.1.29-9 + função v10:** proporções e resoluções por modelo.
  - Imagens: `supported_parameters.aspect_ratio` e `.resolution` do `/images/models`.
  - Vídeos: `supported_aspect_ratios`.
  - `aspectsFor`, `nearestAspect`, `aspectInfo` e `ratio` em `creative.ts`.
  - `image:generate` aceita `aspect` exato (`main.cjs`).

- **0.1.29-8 + função v9:**
  - Estúdio de Áudio (`AudioStudio.tsx`):
    - Locução: `/v1/audio/speech`.
    - Música: `/v1/music`, Lyria por `chat/completions` com `modalities: ['text', 'audio']` e stream; os pedaços em base64 são juntados.
    - Efeitos: Seed Audio pelo `/v1/audio/speech`, com `purpose: 'sfx'`.
  - PCM vira WAV no servidor (`wavFromPcm`), usado pelo Gemini TTS.
  - Seletor único: `ModelMenu` / `ModelSelect` / `CostChip` (`src/components/ModelMenu.tsx`) e `menuItems.ts`.
  - Mostrar o que custou: `SpendNote` no chip de créditos, com `refreshCloud` depois de cada geração.
- **A testar:** a música (Lyria Pro tinha 22% de disponibilidade no OpenRouter em 29/10; o Clip, 93%) e os efeitos (Seed Audio).

- **0.1.29-7 + função v8:**
  - O catálogo vem de `/models?output_modalities=all`.
    - TTS = saída `speech`, com `supported_voices`.
    - STT = saída `transcription`.
  - Preços em US$:
    - chat: por 1M tokens;
    - imagem: pelos `/images/models/<id>/endpoints`, ou pela média real paga no `ledger`;
    - vídeo: por segundo, a partir dos `pricing_skus`.
  - Admin vê US$; os demais usuários veem créditos (`priceLabel` em `cloud.ts`).
  - Sem vozes locais nem nativas no modo nuvem.
  - Um 402 do OpenRouter vira "saldo acabou".
- **Gastos de teste em 29/10:** cerca de US$ 5,80 no OpenRouter. O Veo 3.1 de 8 s custa US$ 3,20. Manter o saldo do OpenRouter com folga.

- **0.1.29-5 (atualização rápida):** cada ideia tem `model` e `modelName` (`src/lib/ideas.ts`, IDs reais do OpenRouter em 29/10).
  - Os workflows escolhem os melhores modelos (`BEST` e `UPSCALE_MODELS` em `NodeFlow.tsx`), e o upscale 4× funciona na nuvem.
  - **Capas dos cards:** `src/assets/ideas/<id da ideia>.webp|jpg|png|mp4|webm` (`import.meta.glob`).
    - Imagem: até 720 px em webp (cerca de 70 KB).
    - Vídeo: mp4 curto, sem áudio, até 720p.
  - Os IDs das ideias estão em `ideas.ts`.

- **0.1.29-4 (atualização rápida):** o painel de trabalho não abre mais sozinho. Puxadores "=" (terminal, embaixo) e "||" (painel, à direita).
- **Conta draftcs21@gmail.com:** plano Studio ativo até 2036, com 45.000 créditos, liberado via SQL (equipe, sem Stripe).
- **Segredos:** o conector do Supabase não salva segredos ("Storing keys is paused"). Use o painel: Edge Functions › Secrets.

- **0.1.29-3 (atualização rápida):** modelos populares primeiro.
  - Na função `orbi` (versão 2 no Supabase): `featured` no catálogo e ordem por empresa.
  - A lista de modelos do OpenRouter é pública, então carrega mesmo sem a chave.
  - No app: grupo "Populares" e nomes como "ChatGPT · OpenAI". Saíram os botões de modelos locais.

- **Atualização rápida (0.1.29-2):** cada release publica também `orbi-ui-<versão>.asar` (a pasta `dist/`, cerca de 2 MB) e `orbi-ui-<versão>.json`.
  - `build/stamp.cjs` grava em `build-info.json` um `core`: um hash de `electron/`, do `package.json` sem a versão, do `pnpm-lock.yaml` e do instalador.
  - Se o `core` da versão nova for igual ao instalado, o app baixa só o pacote da interface, grava em `%APPDATA%/Orbi/ui/` e recarrega a janela, sem reiniciar.
  - Se o `core` mudou, o app usa o instalador, como antes. O usuário sempre decide, e o app vai direto para a versão mais nova.
  - Mudou `electron/` ou alguma dependência? Então é atualização completa. Só `src/`? Então é rápida.

- Confirmação de cadastro e troca de senha por código de 6 dígitos, dentro do app (testado com um Supabase simulado).
- As licenças do Electron e do Chromium foram para `licenses\` na pasta do app.
- Situação no Supabase em 29/10 00h: nenhuma conta criada e nenhuma chamada à função ainda (falta o Daniel salvar os segredos e testar).

## O que foi feito em 28/10

1. **Caixa de mensagem nova**
   - Placeholder que digita exemplos de `/skills` e `@agentes` (Tab usa o exemplo).
   - Guia do comando escolhido e autocompletar.
   - Slider de esforço (Instantâneo → Alto).
   - Escolha de microfone e saída de áudio (USB, headset) e barra de gravação com onda.
2. **Imagem e vídeo no chat:** botões Conversar · Imagem · Vídeo, com modelo, proporção, duração, resolução, áudio, melhorar prompt e quantidade. Roda na fila do Creative e aparece no chat.
3. **Media Library em página cheia:** busca, filtros, gerar vídeo a partir da imagem, ampliar 4×, editar no Canvas.
4. Removidos os botões Video/Image/Story da tela inicial.
5. **Canvas do Creative:** só "Melhorar" e "Aleatório", que preenchem o prompt e o prompt negativo juntos.
6. **Mudança de negócio: Orbi Cloud**
   - Saíram os modelos gratuitos e locais e as chaves de API do usuário.
   - O usuário paga com assinatura (Pro, Studio) mais créditos extras, via Stripe.
   - Toda a IA vem do OpenRouter: chat, imagem, vídeo (`/api/v1/videos`), voz (`/audio/speech`) e transcrição (`/audio/transcriptions`).
7. **Orbi Cloud no Supabase** (projeto `jtdkbtszyrqogmvznrig`, plano Free)
   - Migração `orbi_cloud` aplicada: `profiles`, `ledger`, `video_jobs`, `stripe_events`, RLS, funções de crédito e 300 créditos de boas-vindas no cadastro.
   - Edge Function `orbi` publicada (verify_jwt desligado; ela confere a sessão sozinha).
   - O app entra com o Supabase Auth (e-mail e senha, com confirmação por e-mail).
   - Administração para quem está em `ADMIN_EMAILS`.
8. Dois documentos no Claude Docs: estrutura do projeto e o artigo crítico.

## Créditos e preços (hipóteses iniciais)

- 1 crédito = US$ 0,001 (`CREDIT_USD`). Margem de 25% sobre o custo do OpenRouter (`MARKUP`).
- Pro: US$ 19/mês com 15.000 créditos. Studio: US$ 49/mês com 45.000 créditos.
- Pacotes extras: 5.000 créditos por US$ 6 e 20.000 por US$ 22. Pacotes só para assinantes; os créditos extras não expiram.
- Os créditos do plano renovam (sem acumular) a cada fatura paga e são usados antes dos extras.

## Pendências: fazer primeiro

- [ ] **Daniel:** em Supabase › Edge Functions › Secrets, criar `OPENROUTER_API_KEY` (chave **nova**; a antiga apareceu no chat e deve ser revogada) e `ADMIN_EMAILS` (`draftcs21@gmail.com`).
- [ ] **Daniel:** em Authentication › URL Configuration, colocar em Site URL `https://jtdkbtszyrqogmvznrig.supabase.co/functions/v1/orbi/auth/done`.
- [ ] **Daniel:** em Authentication › Emails › Templates, colocar `{{ .Token }}` nos modelos "Confirm signup" e "Reset password". Sem isso, o código não chega e só o link funciona.
- [ ] Instalar a 0.1.29-2, criar a conta, confirmar o e-mail e testar com a IA de verdade:
  - chat, imagem, vídeo, voz e ditado;
  - conferir os logs da função pelo conector do Supabase (`query_logs`).
- [ ] Conferir os IDs de modelo de voz e transcrição no OpenRouter. Estão fixos em `supabase/functions/orbi/openrouter.ts` (TTS/STT).

## Pendências: depois

- [ ] **Stripe:**
  - criar os 4 preços em modo de teste e colocar os IDs nos segredos;
  - webhook em `.../functions/v1/orbi/stripe/webhook`;
  - ativar o portal do cliente;
  - passar para o modo produção e definir os preços em BRL e USD.
- [x] Recuperar senha e confirmar a conta por código (0.1.29-1). Falta **entrar com Google**.
- [ ] **E-mail próprio (SMTP)** no Supabase antes de lançar; o envio padrão tem limite baixo.
- [x] Licenças movidas para `licenses\` no instalador (0.1.29-1).
- [ ] Ampliar 4× na nuvem: hoje o upscale só funciona com o Real-ESRGAN local, que ficou escondido.
- [ ] Apagar de vez o código dos motores locais (llama.cpp, sd.cpp, whisper, sherpa, Python). Hoje está só escondido por `CLOUD_ONLY`.
- [ ] Próximas fases combinadas:
  - SQLite nativo com WAL no app;
  - **Tauri 2 com backend em Rust** (o front React continua; o `api.ts` é a única porta para trocar);
  - site e app de celular usando o mesmo Supabase.

## Como testar sem a nuvem (desenvolvimento)

- No app, a configuração `cloudBackend` (`{ url, key }`) troca o Supabase por um servidor de teste.
- As funções rodam no Deno com `deno run --allow-all supabase/functions/orbi/index.ts` e as variáveis `SUPABASE_URL`, `SUPABASE_DB_URL`, `OPENROUTER_API_KEY` etc.
- Banco local de teste: PGlite (`pglite-server`), com um esquema `auth` simulado e a migração aplicada.

## Para o Claude ao retomar

- Ler este arquivo, `library-imports/INDEX.md`, `supabase/README.md`, `PRODUCT.md` e `DESIGN.md`.
- O conector do Supabase pode estar ligado: use `list_tables`, `apply_migration`, `deploy_edge_function` e `query_logs` no projeto `jtdkbtszyrqogmvznrig`.
- O ambiente do Claude não acessa `openrouter.ai` nem `supabase.co` direto. Teste com serviços simulados e confira o real pelos logs.

## 0.1.29-11 — atividades e espaços independentes

- Luz pulsante em duas batidas indica execução; a lateral usa ritmo aleatório por atividade e mostra o total. Preferência de movimento reduzido mantém luz estática.
- Canvas e Workflows indicam suas atividades, inclusive nas abas; o nome do workflow aparece na atividade.
- useModeState mantém prompts, configurações e resultados de Imagem/Vídeo separados; conclusões assíncronas apontam explicitamente ao espaço de origem.
- Sem limite de quatro renders simultâneos na nuvem. Limites externos e capacidade local continuam valendo.
- AudioStudio fica montado ao navegar, registra atividades e permite gerações independentes.
- Verificação: TypeScript/build e testes com renders simulados simultâneos, rascunhos independentes e atividade em segundo plano.
