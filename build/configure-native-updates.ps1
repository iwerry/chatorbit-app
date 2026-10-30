param([string]$Repository = 'iwerry/chatorbit-app')
$ErrorActionPreference = 'Stop'
foreach ($program in @('gh','pnpm')) { if (-not (Get-Command $program -ErrorAction SilentlyContinue)) { throw "Instale $program de sua fonte oficial antes de continuar. O script nao instala programas automaticamente." } }
& gh auth status
if ($LASTEXITCODE -ne 0) { throw 'Entre no GitHub com gh auth login antes de continuar. Nao envie tokens no chat.' }
$signingDirectory = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'OrbiBuildKeys'
$signingFile = Join-Path $signingDirectory 'updater.key'
$publicFile = "$signingFile.pub"
$remoteKey = & gh api "repos/$Repository/actions/variables/TAURI_UPDATER_PUBLIC_KEY" --jq '.value' 2>$null
if (-not (Test-Path -LiteralPath $signingFile)) {
  if ($remoteKey) { throw 'Ja existe uma chave publica no GitHub. Recupere o backup da chave privada; nao gere outra chave para substituir os usuarios existentes.' }
  New-Item -ItemType Directory -Force -Path $signingDirectory | Out-Null
  $account = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  & icacls.exe $signingDirectory '/inheritance:r' '/grant:r' ("{0}:(OI)(CI)F" -f $account) | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel proteger a pasta de assinatura.' }
  & pnpm dlx '@tauri-apps/cli@2' signer generate --ci --write-keys $signingFile | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Falha ao gerar a chave de assinatura.' }
}
if (-not (Test-Path -LiteralPath $publicFile)) { throw 'O arquivo publico da chave nao foi encontrado.' }
$publicKey = (Get-Content -LiteralPath $publicFile -Raw).Trim()
if ($publicKey -notmatch '^[A-Za-z0-9+/]+=*$') { throw 'Formato de chave publica inesperado. Use a chave gerada pelo CLI oficial do Tauri.' }
if ($remoteKey -and $remoteKey.Trim() -ne $publicKey) { throw 'A chave local difere da chave publicada. A configuracao foi interrompida para preservar as atualizacoes existentes.' }
# The private key travels over stdin to GitHub encrypted Secrets, never in a command argument or log.
Get-Content -LiteralPath $signingFile -Raw | & gh secret set TAURI_SIGNING_PRIVATE_KEY --repo $Repository
if ($LASTEXITCODE -ne 0) { throw 'Falha ao salvar a chave no GitHub Secrets.' }
& gh variable set TAURI_UPDATER_PUBLIC_KEY --repo $Repository --body $publicKey
if ($LASTEXITCODE -ne 0) { throw 'Falha ao salvar a chave publica no GitHub Variables.' }
Write-Host "Configuracao concluida. Guarde um backup privado de $signingFile. Nunca publique esse arquivo."
& gh workflow run native-release.yml --repo $Repository --ref main
if ($LASTEXITCODE -ne 0) { throw 'As chaves foram configuradas, mas a publicacao precisa ser iniciada em Actions > Native updates.' }
