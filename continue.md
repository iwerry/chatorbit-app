# Orbi: continuar daqui

Documento principal de continuidade do projeto. Atualize este arquivo ao encerrar uma sessão, seja com Claude ou Codex. Não crie outro arquivo que difira deste nome apenas por maiúsculas/minúsculas.

## 11/11: 0.2.11-2 — sem IA local (100% Orbi Cloud)

- Removidos:
  - `ModelHub.tsx`, `SetupWizard.tsx`, `VoiceLibrary.tsx`, `VoiceInput.tsx`;
  - a chave `CLOUD_ONLY` e todos os seus ramos (provedores com chave própria, Ollama/LM Studio, modelos locais, vozes offline e do sistema, upscale local, passos/seed/força);
  - os tipos e chamadas `local:*`/`voice:*` locais de `api.ts`;
  - os eventos `local:*` do `tauriBridge`;
  - os stubs `local:status`, `voice:clones` e `voice:systemList` do `runtime.rs`.
- `tts.speak` usa só as vozes do Orbi Cloud. `startVoice` força `{type:'cloud'}` (escolhas antigas locais são ignoradas). `creativeOptions(models, catalog)`.
- Importar do ComfyUI continua, sem mapear checkpoints (cada nó usa o modelo da nuvem).
- A pasta `electron/` ainda existe (o código local do Electron não é mais publicado, porque `ORBI_WINDOWS_NATIVE=true`). Pode ser apagada numa limpeza futura junto com os workflows do Electron.
- Primeira release com o Windows só pelo Tauri: o updater do Electron baixa `Orbi-Setup-0.2.11-2.exe` (Tauri) e instala por cima.

## 11/11: decisão — só Tauri (o Electron sai)

- O branch `claude/tauri-transition` foi rebaseado sobre o main (0.2.11-1) e ainda não foi mesclado. Ele contém:
  - `mainBinaryName "Orbi"`;
  - ganchos NSIS que removem o Electron, instalam o WebView2 e recriam os atalhos;
  - Windows no `native-release.yml`;
  - a chave `ORBI_WINDOWS_NATIVE`.
- Proteção nova: com `ORBI_WINDOWS_NATIVE=true` e sem a assinatura configurada, o job `configuration` falha em vez de não publicar nada (o `release.yml` já fica parado nesse caso).
- Ordem para desligar o Electron:
  1. O Daniel configura a assinatura com `build/configure-native-updates.ps1` (requer `gh` e `pnpm`; cria o secret `TAURI_SIGNING_PRIVATE_KEY` e a variable `TAURI_UPDATER_PUBLIC_KEY`).
  2. Mesclar o branch.
  3. Testar a passagem com dados reais (só com OK).
  4. Ligar a variable `ORBI_WINDOWS_NATIVE=true`.
  5. A próxima versão sai como `Orbi-Setup-<v>.exe` Tauri, e o updater do Electron instala por cima com `/UPDATE`.
- 11/11: assinatura configurada (secret `TAURI_SIGNING_PRIVATE_KEY` e variable `TAURI_UPDATER_PUBLIC_KEY`); chave privada em `%LOCALAPPDATA%OrbiBuildKeysPdater.key`, sem senha. O Daniel precisa guardar um backup.
- 11/11, à tarde: a 0.2.11-1 foi publicada (o Ubuntu falhou duas vezes por causa do espelho da Azure, resolvido com `build/apt-mirror.sh`). Primeiro build nativo assinado completo em `native-v0.2.11-1`: Windows NSIS, macOS arm e x64, e Linux deb e AppImage, com o `latest.json` incluindo `windows-x86_64`. A chave tinha ido com BOM pelo pipe do PowerShell e foi reenviada pelo redirecionamento. Teste de passagem Electron → Tauri feito na máquina do Daniel em 11/11 e aprovado:
  - O instalador `-setup.exe /UPDATE` removeu o Electron, instalou o Tauri em `%LOCALAPPDATA%\Orbi` e recriou os atalhos.
  - A importação trouxe 12 conversas, 131 mensagens, 41 mídias, 3 workflows e 1 projeto, e o login continuou ativo.
  - Cuidado: o app Claude (MSIX) virtualiza o AppData. Comandos rodados por ele instalam numa pasta privada, então instaladores e chaves devem ser rodados via `explorer.exe` ou ficar no D:.
  - Backups estão em `D:\OrbiBackups`.
  - `ORBI_WINDOWS_NATIVE=true` ligado em 11/11. A partir da próxima versão, o `release.yml` fica parado e o Windows estável sai do `native-release.yml` (Tauri, `Orbi-Setup-<v>.exe`).

## 11/11: 0.2.11-1 — Enhance prompt e Surprise me com IA

- `lib/promptTools.ts`:
  - `pickWriter` escolhe um modelo barato (Haiku → Gemini Flash → GPT mini → DeepSeek) em vez do modelo do chat.
  - `enhancePrompt` (com a caixa vazia chama `surprisePrompt`) e `surprisePrompt`, que usa uma faísca aleatória e as últimas 8 ideias para não repetir. Para imagem e vídeo devolve sempre `{prompt, negative}`.
  - `CRAFT` reúne as regras de escrita por modo. Sem conexão, imagem e vídeo usam `randomPrompt` (offline).
- `PromptTools.tsx`: a prop `single` (Canvas) mostra só o Surprise me. O Node continua com Improve e Surprise.
- `ComposerKit` `CreateControls` com a prop `empty`: o rótulo alterna entre Enhance prompt e Surprise me. Botão novo no composer do chat (`enhanceComposer` no `App.tsx`).
- Só front-end: a `core` é a mesma, então vai como atualização rápida.

## 10–11/11: 0.2.10-2 — Creative › Node (publicada, atualização rápida)

- `NodeFlow.tsx`:
  - Barra flutuante `.flow-rail` com menus (`FlyItem`). Anotações (`Mark`: texto, retângulo, elipse, linha, seta e lápis) salvas em `marks` no workflow. Atalhos V/H/T/M/L/P/\/N.
  - Soltar e enviar arquivos com `importFiles` (`api.importMedia`), que cria nós `load`, `loadvideo` e `loadaudio`.
  - Nós novos: `vector` (Recraft `-vector`, SVG), `recompose` (prompt do workflow `graphic_design_recomposer`), `extend` (`lastFrame()` do vídeo vira `frameImage`), `music` e `sfx` (`lib/audioPrompt.ts`, compartilhado com o Estúdio de Áudio).
  - Inpaint na nuvem: a máscara vai como 2ª referência. Negativo liga/desliga (`negOff`). Vídeo usa `spec.durations`, `spec.resolutions` e `spec.audio`.
  - `fit()` lê as refs (antes os nós ficavam fora da tela depois de carregar um template).
- Rust `media.rs`: `image/svg+xml` → `.svg`.
- Ajustes de 11/11: a roda do mouse sobre os painéis (lista de nós, menu do botão direito, barra) não dá zoom; zoom de 10% a 300% com a grade de pontos subindo de passo; "Limpar anotações e desenhos"; os nós de carregar atualizam a biblioteca (`created()`, releitura ao voltar para a aba) e têm o botão "… do computador".
- Release `v0.2.10-2` com a mesma `core` (`d263873f2dc6ec33`): o Electron recebe só a interface.
- Não existem no OpenRouter e ficaram de fora: Mirelo, Sonilo, 3D, lip sync (VEED), Bria (fundo e green screen), Beeble SwitchX, Topaz e separação de camadas. Clonagem de voz e último quadro de vídeo existem no OpenRouter, mas exigem mudança no Electron e no Rust (o app só repassa campos fixos), então ficam para a versão Tauri.
- Testado no Tauri isolado: barra, formas, lápis, texto, templates e nó Vetor gerando SVG real (375 créditos no Pro; o padrão agora é o não Pro). Impeccable sem anti-padrões.

## 10/11: 0.2.10-1 — controles de áudio (publicada, atualização rápida)

- `AudioStudio.tsx`: grade de vozes com busca e ▶ (prévia "Hi! This is <voz>…", cerca de 4 s); interpretação (`⟦style: …⟧` no início do texto) nos modelos com `instructions` (Gemini TTS, Fish); música com estilo, clima, BPM, duração (Pro), vocal, idioma e marcadores de estrutura; efeitos com duração, intensidade, ambiente e loop. Tudo vira direções no prompt (o Lyria e o Seed Audio leem do texto).
- Função `orbi` v13 (deploy pelo Supabase CLI já logado: `npx supabase functions deploy orbi --project-ref jtdkbtszyrqogmvznrig --no-verify-jwt --use-api --yes`): prévia em `public.voice_samples` (migração `20261110000000_voice_samples`), gerada uma vez por voz e grátis; `⟦style⟧` vira `instructions`. **Publique a função antes do front**, senão a voz lê o marcador.
- Verificado em produção: prévia da Zephyr com 4,04 s, a segunda vez vinda do banco, 0 crédito; voz com estilo sem ler o marcador. Efeito sonoro de chuva gerado (o Seed Audio trata a duração como sugestão).
- Release `v0.2.10-1` com a mesma `core` da 0.2.2-2: o Electron recebe só o pacote de interface.
- A branch `claude/tauri-transition` está atrás da `main`; faça rebase antes de juntar.

## 02/11: 0.2.2-2 — trocar senha logado + e-mails com código

- Novo canal `cloud:changePassword` (`PUT /auth/v1/user` com o token da sessão) no Electron (`cloud.cjs`, `main.cjs`) e no Rust (`cloud.rs`). Interface em Configurações › Geral (`ChangePassword` em `SettingsModal.tsx`), visível só com login. Testado no Electron contra um Supabase falso (troca, erro de senha repetida, recusa sem login). A tela ainda não foi vista com uma conta logada.
- Os e-mails do Supabase vinham só com link porque os modelos nunca receberam `{{ .Token }}`, e o Site URL ainda era `localhost:3000`. Os modelos ficam em `supabase/templates/`. Para aplicar: `$env:SUPABASE_ACCESS_TOKEN=...; node build/supabase-auth.mjs --apply`, rodado **dentro** de `chatorbit-app`. A primeira tentativa do Daniel rodou na pasta de cima (`MODULE_NOT_FOUND`); confirmar que aplicou.
- O conector MCP do Supabase não altera a configuração de Auth (só SQL, logs e funções). Não definir senha de usuário por SQL.
- Como `electron/` mudou, esta é uma atualização completa (instalador), não rápida.
- **Verificado em produção:** o Daniel atualizou, trocou a senha em Geral e entrou com a nova. No log do Supabase: `PUT /user` (`user_modified`) às 18:18:30 e login por senha às 18:18:43.
- **Tauri logado (modo isolado):** conta, catálogo, modelos, chat em streaming (Haiku 5.5, 0,0126 crédito) e Media Library com as 34 mídias migradas, tudo funcionando. Faltam geração de imagem e vídeo, voz, ferramentas MCP no chat, terminal e múltiplas janelas.
- **Instalador Windows do Tauri (prévia):** `npx --yes @tauri-apps/cli@2 build --bundles nsis --config src-tauri/tauri.preview.json --ci`. Gera "Orbi Preview", 8,6 MB, com dados e credenciais próprios (`com.orbix.orbi.preview`). Instalação, abertura e desinstalação foram testadas; o Electron não foi afetado. Feche qualquer `orbi-native.exe` aberto antes do build ("Acesso negado"). O instalador **não** foi publicado.
- **Imagem e vídeo no Tauri:** `gpt-image-2` 1024² (7,47 créditos) e `tbc/mischief-1` 3 s/480p a partir da imagem (18,75 créditos). Ambos funcionaram depois da correção dos `null` em `media.rs`. O `mischief-1` exige imagem inicial e só aceita 16:9, mas o catálogo não informa isso.
- **Função `orbi` v12 (02/11):** sem as variantes `:batch` (modo lote do OpenRouter) no chat, imagem e vídeo. Os arquivos publicados foram conferidos contra o repositório. Lista ao vivo: 171 modelos, 0 batch.
- **Versão de transição (branch `claude/tauri-transition`, ainda não está na main):**
  - `src-tauri/windows/hooks.nsh` remove o Orbi Electron em silêncio, instala o WebView2 se faltar e recria os atalhos (o `/UPDATE` do Tauri não os cria). O executável passa a ser `Orbi.exe`. A prévia fica sem ganchos.
  - Workflows: Windows no canal assinado. A variável `ORBI_WINDOWS_NATIVE=true` faz a release estável sair com o instalador Tauri como `Orbi-Setup-<v>.exe`, e o `release.yml` para.
  - Testado com um Electron falso (`/UPDATE /P`): remoção, instalação e atalhos funcionaram; o Orbi real não foi tocado.
  - **Paridade testada no Tauri logado:** MCP interno conectado; DeepWiki conecta sob pedido (3 ferramentas); voz na nuvem (WAV de 1,5 s); terminal PowerShell (comando, saída e código 0; o ConPTY pede `ESC[6n`, que o xterm responde). **Falta:** ferramenta MCP dentro do chat e várias janelas.
  - **10/11:** ferramenta MCP no chat ok (`orbi-core__current_time` chamada, resposta com a hora certa). Várias janelas ok: duas janelas pelo Ctrl+Shift+N, estáveis por mais de 45 s. **Não** teste várias janelas com `--remote-debugging-port`: a segunda janela cai e o perfil do WebView2 (`%LOCALAPPDATA%\com.orbix.orbi\EBWebView`) fica num estado em que o app fecha sozinho ao abrir. Nesse caso, renomeie a pasta. Ficaram perfis de teste `EBWebView.*` nessa pasta.
  - **Supabase (10/11, pelo CLI 3.1 já logado: `config pull` / `diff` / `push` numa pasta temporária):** Site URL agora é `.../functions/v1/orbi/auth/done`. Os modelos de e-mail com código foram **recusados**: o plano gratuito com o e-mail padrão não permite personalizar modelos. É preciso SMTP próprio (Resend, SendGrid…) ou plano pago. O código do e-mail tem 8 dígitos (o app aceita até 8; o texto ainda diz 6).
  - **Bloqueio (Daniel):** chave de assinatura do updater. Instalar `gh` e `pnpm`, rodar `gh auth login` e `build/configure-native-updates.ps1`, e guardar backup de `%LOCALAPPDATA%\OrbiBuildKeys`.
  - O teste de ponta a ponta (Electron real → Tauri) só com ok explícito do Daniel, porque usa os dados reais.
- O Rust agora traduz os erros de login como o Electron (`auth_message` em `cloud.rs`).
- Os modelos de e-mail com código ainda **não** foram aplicados no Supabase (o script rodou na pasta errada). O Site URL continua `localhost:3000`.

## 02/11: Claude Code no PC do Daniel — migração de dados para o Tauri (branch `claude/tauri-data-migration`)

- Ambiente Windows verificado: Rust 1.99.1 MSVC, Build Tools VS, Node 26, WebView2 156. O pnpm não está instalado; usar `npx pnpm@10` (Node 26 não traz corepack). Tauri CLI não instalado. O `.exe` sai com `cargo build --release --features tauri/custom-protocol`, depois de `node build/prepare-native.cjs` e `pnpm build`.
- Build Windows da 0.2.2-1: compilou e abriu a janela "Orbi" (45 MB). A interface não foi percorrida.
- Paridade de IPC: os 23 canais ausentes no Rust são `local:*`, `providers:*` e `voice:*`, que podem ser apagados no modo nuvem. Faltam os eventos `data:changed`, `find:result` e `update:done`. O `tauri.conf.json` não tem alvo Windows (`nsis`/`msi`) e a `pubkey` do updater está vazia.
- Nova `src-tauri/src/legacy.rs`: importação única de `%APPDATA%\Orbi` ao abrir. Detalhes em `docs/TAURI_MIGRATION.md`. Testada com 19 testes Rust e com uma cópia dos dados reais (11 conversas, 97 mensagens, 34 mídias). A cópia foi apagada.
- Eventos `data:changed`, `find:result` e `update:done` implementados no Rust (`lib.rs`, `window.rs`, `mcp.rs`). A contagem da busca foi testada no Node, mas os eventos ainda não foram vistos numa janela aberta.
- **A prévia Tauri nunca tinha mostrado a interface** (tela em branco: o `api.ts` lia `window.orbi` antes do `tauriBridge`). Corrigido: o `api.ts` importa `./tauriBridge`. A CSP do `index.html` agora libera IPC e assets do Tauri.
- Teste isolado sem tocar nos dados reais:

  ```
  $env:ORBI_DATA_DIR="<pasta>"; $env:ORBI_LEGACY_DIR="<cópia de %APPDATA%\Orbi>"; $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9333"
  ```

  Depois é só abrir o `orbi-native.exe`. A janela pode ser inspecionada por CDP em `127.0.0.1:9333`. Os três eventos e a migração foram verificados assim numa janela real. As telas que exigem login não foram vistas.
- O Visual Studio 2026 Community está instalado neste PC (MSVC e depurador). Use-o quando precisar.
- Atenção: abrir a prévia Tauri neste PC agora importaria um retrato dos dados e criaria `electron-migration.json`. A pasta `%APPDATA%\com.orbix.orbi` daqui só tem o banco vazio do teste de abertura, que a migração põe de lado sozinha.

## 30/10: autorização de todas as atualizações automáticas

- Daniel autorizou publicar automaticamente todas as atualizações via GitHub, independentemente do sistema. Windows 0.1.30-1 publicado e verificado: commit `6e5276a713694075491145ba7bef1bff4b2a0d44`, run `41101201803`, release `v0.1.30-1` com EXE e pacote UI.
- Updater oficial Tauri adicionado, com assinatura obrigatória, checagens no app, download/cancelamento/instalação e comparação por data de publicação. Código e pipelines nativos devem ficar junto da main sem substituir o Electron Windows.
- Configuração única de assinatura ainda pendente: chave privada em GitHub Secrets e pública em Variables. Script pronto em `build/configure-native-updates.ps1`; detalhes em `docs/AUTOMATIC_UPDATES.md`. Conector não tem acesso a Secrets; acesso à janela Brave expirou. Não pedir chaves pelo chat nem colocar chave privada no Git.
- Prévia Tauri antiga sem updater exige uma primeira instalação manual de transição. Depois, atualizações assinadas pelo próprio app. Não afirmar entrega automática retroativa a um cliente que não possui updater; não publicar pacote nativo sem assinatura.

## 30/10: execução local de skills e /goal — 0.1.30-1

- Daniel pediu Rust + TypeScript e autorizou levar o fluxo também ao Electron atual. Implementação e limites em `docs/SKILL_LOCAL_RUNTIME.md`.
- Terminal de tarefas com aprovação obrigatória, logs, erros e cancelamento; fila de aprovação; `/goal` sem o limite de oito rodadas; skill Remotion incluída na biblioteca. ZIP fornecido foi somente inspecionado, sem executar scripts.
- Publicação `[source-only]` preserva o pedido de não gerar instaladores. Os testes continuam no CI; release automática ignora esse marcador e empacotamento Tauri é manual. Não afirmar que aplicativos instalados receberam o backend novo: o atualizador Electron exige `core` igual para UI-only e Tauri ainda não tem updater assinado.
- Testes locais: comandos reais inofensivos, cancelamento rápido, UTF-8, códigos de saída, parser e goal com dez rodadas simuladas; recusa pausa; UI em navegador isolado, três temas e 800px; TypeScript, build do front e testes Rust.
- CI final aprovado: run `41094482390` (7 testes Windows/Linux/macOS) e `41094372800` (front + 14 testes Rust Linux/Mac Intel/Apple Silicon). Commits de código: main `d9bcb9f9adaad2908acfede6e32a2e536a6f2560`, Rust `c9cff93f97dd17704cdafb03090dd5c3c1ee4326`. Nenhum instalador gerado; decisão sobre distribuição do backend Windows foi solicitada e permanece pendente.

## 30/10: migração Tauri autorizada pelo Daniel

- Arquitetura escolhida: Tauri 2 com backend integral em Rust, sem sidecar Node. Trabalho isolado em `codex/tauri-rust`; Windows estável permanece na main.
- Estado detalhado e pendências em `docs/TAURI_MIGRATION.md`. Não apresentar a migração como concluída: faltam paridade completa, migração dos dados, atualização nativa assinada e validação real de Linux/macOS.
- Backend compila no Windows; 11 testes Rust e TypeScript passaram. Workflow separado gera pacotes de desenvolvimento DEB/AppImage e DMG para Intel/Apple Silicon, sem publicar atualização estável.
- Pacotes preliminares concluídos: run `41078258226`, commit `4e95f68521f8093d3ce75d407140aa82dfaada5e`. Agora são 12 testes aprovados nos três destinos, produção compilada e processo Linux aberto por 12 segundos em Xvfb. Arquivos locais em `../releases/tauri-0.1.30-preview`, com LEIA-ME e hashes. Mac ad-hoc, sem notarização. Sem testes autenticados nem validação interativa no Mac; migração continua incompleta.

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
- Versão no formato `0.M.D-N` (M = mês desde outubro, D = dia sem zero à esquerda; ex.: 0.2.1-1 em 01/11). Zero à esquerda é semver inválido e o Cargo recusa. Cada push na `main` gera uma release, e o app instalado oferece a atualização.
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

## 02/11: o que mudou

- **0.2.2-1 + função v11 + migração `video_estimate`:**
  - `Lightbox.tsx` / `studio.css`: mídia com `position:absolute; inset:0; margin:auto; max-*: calc(100% - padding)` (o `max-height:100%` dentro de grid não funcionava). Detalhes viram painel flutuante abaixo de 980 px; faixa some abaixo de 520 px de altura. `ratioName()` mostra o formato.
  - `MediaLibrary.tsx`: `.ml-masonry` (CSS columns) e `shapeOf()` usa `params.width/height`.
  - `electron/mcp.cjs`: Filesystem padrão em `{workspace}` (migra a config salva uma vez, flag `fsScopedToWorkspace`); `SENSITIVE` pede aprovação para chaves, .env, perfis de navegador.
  - Função `orbi` v11: `needFor()` exige saldo para o custo estimado; `chargeUser()` usa a estimativa como piso (nota "(est.)"); `settleJob()` + `settlePendingVideos()` (em `/me` em segundo plano e em `/admin/stats`); coluna `video_jobs.est_usd`.
  - Testes locais: Postgres em `/var/tmp/pg5544`, OpenRouter falso em `scratchpad/cloudtest/fake.mjs`, testes Deno em `scratchpad/dtest` (`fn_test.ts`, `new_test.ts`).

## 01/11: o que mudou

- **0.2.1-1 (só interface, atualização rápida):** Impeccable init.
  - `PRODUCT.md` atualizado para o Orbi só na nuvem.
  - `navItems` com `group` (create / build / yours) e `.rail-sep` entre grupos (`WorkspacePanel.tsx`, `studio.css`).
  - Menu Criar novo, Seleção dentro de Editar, Exibir sem `go.*` (`App.tsx`).
  - Textos do hero, do aviso offline e do menu do perfil; `shownName` usa o nome da conta.

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
