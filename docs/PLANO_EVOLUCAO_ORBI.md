# Plano de implementação — layout/workspace e Orbi 3D Engine

Base: os dois relatórios de 11/11/2026 ("Atualização de layout e workspace" e "Implementação do Blender WASM no Orbi"), cruzados com o código atual (Tauri 2 + React 19, 100% Orbi Cloud).

Cada passo termina em algo testável e vira uma versão (`0.M.D-N`) quando toca o app. Marque `[x]` ao concluir e registre detalhes no `continue.md`.

## Regras para todo passo de interface

- Textos da interface em **inglês** no código, sempre via `t()`, com tradução em pt-BR, es e fr no `i18n-dicts.ts` (o script de faltantes tem que voltar vazio).
- **Impeccable** antes e depois de cada mudança visual (`npx impeccable detect <arquivos>`), seguindo o `DESIGN.md` (tokens, espaçamento, estados de foco/hover, contraste).
- Teclado e leitor de tela: todo controle novo com rótulo, foco visível e atalho quando fizer sentido.

## O que eu ajustaria nos relatórios

1. **Menos conceitos:** "Workspace → Project → Session → Panels" é pesado para quem cria conteúdo. Proposta: **Projeto → Conversas**, e o painel "Session" vira o painel **Context** da conversa aberta (ambiente, skills, conectores, saídas). Mesmo poder, um nome a menos.
2. **Docking em duas etapas:** primeiro três regiões fixas com abas (lateral, direita, inferior) e presets Chat/Coding/Creative, como no VS Code; arrastar livremente entre regiões vem depois. Entrega 80% do valor com bem menos risco.
3. **Prioridade pelo público do Orbi (criadores):** Orbi Docs e Usage valem mais cedo que Git. Ordem: marca/avatar → composer → Docs → painéis → browser → Files/Git.
4. **Browser como aba do painel direito**, não janela separada: uma webview, abas leves, "enviar para o chat".
5. **3D sem esperar o build do Blender:** validar primeiro com os artefatos já compilados do HeyPuter numa janela Tauri isolada (horas, não dias). Em paralelo, considerar um motor leve em three.js para o MVP de animação de 8 s com GLB (sem GPL); o Blender WASM entra quando a POC provar ponte `bpy` e desempenho aceitável no WebView2.

## O que já existe (não refazer)

| Pedido no relatório | Situação hoje |
|---|---|
| Terminal integrado | Existe: `TerminalPanel.tsx` (xterm) + `terminal.rs` (portable-pty), abas, maximizar. Falta docking lateral e nova janela. |
| Projetos | Existe (`projects` no SQLite, painel no `WorkspacePanel`). Falta pasta raiz (`root_path`) para Files/Git. |
| Skills e agentes no composer | Existe (`/` e `@`, menus no topo). Falta Project e Connectors no composer. |
| Usage | Existe dentro de Conta (`api.cloudUsage`). Falta tela própria por modelo/modalidade/período. |
| Idioma | Existe em Configurações → Geral. Falta atalho no menu do avatar. |
| MCP | Existe (`mcp.rs`, catálogo). Será a base do "MCP interno" do 3D. |
| NodeFlow, Creative, Media Library | Existem. Recebem os nós e a viewport 3D. |

## Trilha A — Layout e workspace

### A1. Shell e marca (rápido, ~1 dia)
- [x] A1.1 Uma única marca: manter o logo no topo da barra lateral; tirar o logo da barra de título (fica o ícone da janela do sistema) e trocar o planeta grande da tela inicial por título/saudação sem logo repetido.
- [x] A1.2 Menu do avatar: adicionar **Language** (troca imediata, mesma lista de Configurações) e **Usage** (abre a tela de uso).
- [x] A1.3 Tela **Usage**: período (7/30/90 dias), créditos gastos, por modalidade (texto/imagem/vídeo/áudio) e por modelo, histórico. Créditos ≠ custo do provedor; estimativa marcada como estimativa. Se o Edge Function não agregar por modelo, adicionar a agregação no `orbi`.
- [ ] A1.4 Revisar duplicações de comando (topo × lateral × rodapé), tooltips, foco e atalhos. Impeccable antes/depois.

### A2. Composer contextual (~1–2 dias)
- [x] A2.1 Barra do composer com **Project** (projeto ativo), **Skills** e **Connectors** (MCP ativos), compactos; em tela estreita viram um menu "Ferramentas".
- [x] A2.2 Cada mensagem enviada grava um snapshot (projeto, skills, conectores, modelo) para reabrir conversas sem ambiguidade (coluna JSON em `messages`).

### A3. Painéis reorganizáveis (~3–4 dias)
- [ ] A3.1 Dock manager próprio e leve: regiões esquerda/direita/baixo, abas, arrastar entre regiões, redimensionar, recolher, "restaurar padrão".
- [x] A3.2 Painel **Session** (Environment, Context, Connectors, Outputs) usando o que a conversa já sabe.
- [ ] A3.3 Persistência de layout por usuário e por projeto (`panel_layouts`), presets **Chat**, **Coding**, **Creative**.
- [x] A3.4 Terminal entra no dock: baixo (padrão), esquerda/direita, maximizar, abrir em janela própria (`window.rs`).

### A4. Ferramentas de projeto (~4–5 dias)
- [ ] A4.1 Projeto com pasta raiz (`root_path`) escolhida pelo usuário; escopo de permissão por pasta (nada fora dela).
- [ ] A4.2 **Files**: árvore, busca, filtro por tipo/origem (mensagem/sessão/projeto), preview, abrir com o app do sistema; índice no SQLite + watcher com debounce.
- [ ] A4.3 **Changes (Git)**: branch, arquivos alterados, diff por trecho, stage/unstage, descartar com confirmação, histórico curto. Git via processo controlado no Rust. Patches da IA sempre revisados antes de aplicar.

### A5. Browser interno (~3 dias)
- [ ] A5.1 Webview filha do Tauri (WebView2/WKWebView/WebKitGTK) com abas, URL, voltar/avançar/recarregar, preview de app local (localhost).
- [ ] A5.2 Segurança: conteúdo remoto sem acesso aos comandos Tauri, só http/https, downloads e câmera/mic com confirmação, perfil/cookies separados.
- [ ] A5.3 "Enviar página para o chat" (texto/print autorizado). Automação de páginas fica fora do MVP.

### A6. Orbi Docs (~5–7 dias)
- [ ] A6.1 Editor rico no front (Tiptap/ProseMirror), formato canônico JSON; documentos e revisões no SQLite (`documents`, `document_revisions`).
- [ ] A6.2 Autosave, undo/redo, versões nomeadas.
- [ ] A6.3 Selecionar trecho → "Pedir alteração à IA" → a IA devolve operações → diff → aceitar/rejeitar (uma transação por aceite).
- [ ] A6.4 Chat sugere "abrir no editor" quando a resposta é longa.
- [ ] A6.5 Exportar MD, TXT, HTML, PDF; depois DOCX.

## Trilha B — Orbi 3D Engine (Blender WASM)

Decisões que precisam do Daniel antes da fase B1:
1. **Licença:** o Blender é GPL. O Orbi é Apache-2.0. Distribuir o runtime junto exige oferecer o código-fonte do fork e avaliar o impacto no produto comercial. Recomendado: o motor 3D como componente separado (repositórios `iwerry/blender-wasm` e `iwerry/blender` públicos), baixado sob demanda, com avaliação jurídica antes do lançamento.
2. **Forks:** criar `iwerry/blender-wasm` e `iwerry/blender` a partir dos repositórios HeyPuter.
3. **Build:** a toolchain Emscripten precisa de Linux/WSL2 e várias horas; o lugar certo é um runner de CI dedicado, não o app.

### B0. Preparação
- [ ] Forks criados com remotes upstream; commit do Blender fixado (`fe16888…` no upstream).
- [ ] Inventário de licenças dos componentes.
- [ ] Demo original do HeyPuter rodando num navegador (Chrome) para comparar depois.

### B1. Prova de conceito (gate) — branch `feature/blender-engine-poc`
- [ ] Runtime carrega numa janela Tauri dedicada com COOP/COEP (SharedArrayBuffer, pthreads) sem afetar a janela principal.
- [ ] Executar operação `bpy` por comando, sem UI do Blender. **Se não houver ponte bpy utilizável, parar e decidir (ponte própria no fork).**
- [ ] Criar objeto, aplicar keyframes, mostrar um frame, salvar e reabrir `.blend`, exportar GLB.
- [ ] Meta: animação procedural de 8 s criada só por comandos e salva como projeto editável.
- [ ] Medir: tempo de carga, tamanho do download, memória de pico, tempo por frame no WebView2.

### B2. Orbi 3D API
- [ ] `src/features/blender/`: `BlenderEngine`, `BlenderWasmAdapter`, `BlenderRuntimeLoader`, `SceneCommandValidator`, tipos `scene`/`commands` (versão `1.0`, operações como `object.create`, sem Python livre).
- [ ] Rust `src-tauri/src/blender/`: projetos, assets (download com hash e cache), jobs com cancelamento e limites.

### B3. Produto
- [ ] Agente **Orbi 3D Director** + skills de direção, câmera e animação; ferramentas MCP internas (`scene.create`, `object.add`, `animation.keyframe`, `preview.frame`, `project.save`).
- [ ] Nós no NodeFlow: Create Scene, Add Object, Set Material, Set Camera, Animate, Preview Frame, Save Project, Export Scene, Render Sequence.
- [ ] Creative Studio: viewport, árvore simples, propriedades, câmera, timeline, exportar. `.blend`/GLB/frames na Media Library.

### B4. Vídeo
- [ ] Render de sequência, composição com áudio e MP4 (FFmpeg); worker nativo opcional no Orbi Cloud para cenas pesadas.

### B5. Avançado
- [ ] Rigging, tracking, personagens, composição 2D/3D.

## Ordem recomendada

1. **A1** (marca, idioma e Usage no avatar): mudança visível e rápida.
2. **A2** (composer contextual).
3. **A6** (Orbi Docs).
4. **A3** (painéis, terminal no dock) → **A5** (browser) → **A4** (Files e Git).
5. Em paralelo, **B0/B1**: decisão de licença e POC com os artefatos prontos do HeyPuter; B2+ só depois do gate.
