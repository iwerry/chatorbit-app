# Atualizações por GitHub — Windows, Linux e macOS

Daniel autorizou a geração e publicação automática dos pacotes para todos os sistemas. Não é necessário gerar instaladores manualmente em cada computador de desenvolvimento.

## Canais

- Windows instalado (Electron): `.github/workflows/release.yml` publica a release estável e os pacotes existentes. O aplicativo consulta GitHub Releases, oferece a atualização e mantém a confirmação antes de interromper trabalho e instalar.
- Linux/macOS (Rust/Tauri): `.github/workflows/native-release.yml` compila AppImage/DEB e os dois Macs, assina os pacotes e publica a versão nativa como prévia de transição. Somente quando todos os alvos assinados estão presentes, atualiza `native-channel/latest.json`. O canal nativo é pré-release e não interfere na detecção da release estável pelo Windows.
- O updater nativo oficial verifica a assinatura antes de instalar. Faz checagem automática após iniciar e a cada quatro horas, respeitando a preferência do usuário; download e instalação usam os controles já existentes no app. Versões no formato `0.1.DD-N` usam a data de publicação para atravessar a virada do mês corretamente.

## Configuração única que ainda precisa ser concluída pelo proprietário

As chaves de assinatura ainda não foram configuradas nesta sessão. O conector GitHub não expõe gerenciamento de Secrets; a tentativa de acessar a janela Brave expirou sem liberação. Nenhuma chave privada foi criada, publicada no repositório ou enviada no chat.

No Windows do proprietário, com GitHub CLI (`gh`) e pnpm instalados de suas fontes oficiais:

1. Faça `gh auth login`, concluindo o login do GitHub pessoalmente.
2. Execute `powershell -NoProfile -File .\build\configure-native-updates.ps1` na pasta do projeto atualizado.

O script gera a chave oficial do Tauri em `%LOCALAPPDATA%\OrbiBuildKeys`, protege a pasta para a conta atual, envia a chave privada pelo stdin para `TAURI_SIGNING_PRIVATE_KEY` em GitHub Actions Secrets e salva a pública em `TAURI_UPDATER_PUBLIC_KEY` (Actions Variable). Depois inicia o workflow nativo. Ele não instala programas nem muda a política de execução. Se o computador já tiver uma chave ou o GitHub já tiver outra, preserva a chave existente e exige recuperar o backup; não rotaciona a identidade silenciosamente.

**Guarde um backup privado da chave. Não envie o arquivo `.key` no chat ou no Git.** O workflow recusa publicar pacotes sem assinatura; enquanto os dois valores não existirem, mostra a configuração pendente no resumo de Actions e pula o empacotamento nativo.

## Transição dos aplicativos antigos

As prévias Tauri 0.1.30 distribuídas antes deste trabalho não têm updater. Precisam receber uma vez o novo pacote de transição, após configurar a assinatura. Não é possível instalar um atualizador por push dentro de um executável antigo que não o possui. Depois dessa transição, recebem as próximas versões assinadas pelo próprio aplicativo.

A atualização do Windows Electron segue seu mecanismo existente e não depende dessa configuração de chaves Tauri. A migração completa para Rust continua em andamento; não substituímos o Windows estável pelo backend nativo incompleto. O código dos dois backends compartilha o mesmo frontend no repositório.

Macs usam assinatura ad-hoc de desenvolvimento, sem notarização Apple configurada. A assinatura do updater é outra camada e não substitui a notarização do sistema. A primeira abertura pode precisar ser liberada pelo proprietário do Mac. A instalação Linux DEB pode exigir a autorização normal do sistema. Não desativamos verificações de assinatura, TLS ou proteções do sistema.

## Publicar as próximas versões

Atualize `package.json` no formato `0.1.DD-N` e faça push na `main`. As pipelines usam essa versão; `build/prepare-native.cjs` sincroniza os arquivos de versão Rust/Tauri antes do build. A release Windows já existente não é reconstruída. O marcador `[source-only]` continua disponível exclusivamente para alterações que deliberadamente não devem distribuir um pacote Windows.

As pipelines de testes não precisam da chave privada. A publicação nativa requer a configuração acima e só troca o manifesto depois de verificar todos os destinos. Um commit antigo não pode substituir um canal nativo mais novo. A autenticação real e a atualização assinada de ponta a ponta ainda devem ser validadas após configurar as chaves e instalar a versão de transição.

Referência do mecanismo oficial: https://v2.tauri.app/plugin/updater/.
