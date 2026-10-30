# Skills com execução local — 0.1.30-1

## Uso

Na biblioteca, instale a skill `informative-video-remotion`. No chat, use `/informative-video-remotion /goal Crie um vídeo vertical de 30 segundos sobre café`. `/goal /informative-video-remotion ...` também funciona.

A orientação enviada ao modelo exige verificar o ambiente real, informar dependências presentes/ausentes, instalar apenas o necessário depois da aprovação e verificar o resultado. A skill nova é uma implementação do Orbi baseada no fluxo solicitado; o ZIP fornecido continha um projeto de referência, não o SKILL.md original. Seus scripts e seu MP4 não foram executados nem tratados como prova de uma renderização nova.

O terminal da tarefa mostra comando, pasta, stdout/stderr e estado final. Comandos usam PowerShell no Windows, bash no Linux e zsh no Mac. São processos não interativos: o terminal manual existente continua disponível para ações interativas. Se um programa exigir login, senha ou interação, a skill deve pausar e pedir ajuda.

Cada comando requer aprovação, inclusive quando a aprovação automática de outras ferramentas está ativa. Recusa ou cancelamento pausa a execução e impede continuar automaticamente. Solicitações concorrentes entram em fila e somente a janela de origem pode responder. O botão Parar do chat cancela a tarefa; Parar comando encerra o processo correspondente. A saída é limitada em memória; o resultado devolvido ao modelo contém código de saída e trechos dos logs, enquanto o painel conserva um trecho maior.

`/goal` remove o limite de oito rodadas de ferramentas. A execução continua enquanto o modelo solicita ferramentas, até responder, ser interrompida ou ocorrer um bloqueio. Não é uma promessa de conclusão autônoma infalível: disponibilidade do modelo, contexto, créditos e aprovações continuam necessários. O protocolo exige evidência para alegar sucesso, mas uma afirmação do modelo não substitui inspeção do artefato.

## Implementações

- Rust/Tauri: `command_jobs.rs` gerencia processos, UTF-8, eventos e cancelamento por janela. Nenhum Node sidecar é usado pelo aplicativo. Node/Remotion são dependências da skill, somente quando o trabalho precisa delas.
- Electron existente: `command-jobs.cjs` oferece o mesmo contrato durante a migração. A aplicação estável ainda não foi convertida integralmente para Rust.
- TypeScript/React: protocolo de execução, `/goal`, fila de aprovação e painel de registros compartilhados entre os dois backends.

## Distribuição sem instaladores

Este código é publicado com `[source-only]`. O workflow de release ignora esse marcador, enquanto os testes continuam rodando. Empacotamento Tauri fica somente manual. Nenhum instalador ou atualização de aplicativo é gerado por esses commits.

Isso **não entrega o novo backend aos aplicativos já instalados**. O atualizador Electron aceita atualização apenas de interface quando o fingerprint `core` é igual (`build/stamp.cjs`, `build/ui-pack.cjs`, `electron/updater.cjs`). Aqui o backend mudou. As prévias Tauri não têm atualização assinada configurada e não aceitam ASAR Electron. Para efetivar nos computadores, será necessária uma distribuição apropriada de backend; apenas o push do código não basta.

## Verificação

Testes locais: execução real de comandos inofensivos em PowerShell, UTF-8, stderr/código de falha, cancelamento rápido e isolamento por janela; continuação simulada por dez rodadas de ferramentas e pausa após recusa; parser das duas formas de `/goal`; TypeScript e build do front. Rust inclui testes de shell real e cancelamento. Navegador isolado: registros, cancelamento, fila de aprovação, ausência da opção de aprovação automática para comandos, três temas e janela estreita.

Os testes usam dados sintéticos e não instalam Remotion/FFmpeg, não acessam a conta do usuário e não gastam créditos. Verificações de comandos são executadas também no CI Windows/Linux/macOS; o runtime Rust tem seu próprio workflow de compilação/testes, sem empacotamento.

Referências oficiais consultadas: https://www.remotion.dev/docs/cli/render e https://www.remotion.dev/docs/cli/browser.
