# PowerShell 5.1+ on Windows. Generates secrets on YOUR machine, never prints them.
# Run in the extracted project folder: powershell -ExecutionPolicy Bypass -File .\setup-local.ps1
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
function New-LocalSecret {
  $bytes = New-Object byte[] 32
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  return ([BitConverter]::ToString($bytes)).Replace('-', '').ToLowerInvariant()
}
$path = Join-Path $PSScriptRoot '.env'
if (Test-Path $path) {
  $text = [IO.File]::ReadAllText($path)
  if ($text -notmatch 'COMMERCE_SERVICE_TOKEN=') { throw 'This is a v1 .env. Use a fresh v2 folder. Your old .env has not been changed.' }
  if ($text -notmatch 'GATEWAY_TEST_KEY=') { throw 'This .env is from v2.0 (no gateway). Use a fresh v2.1 folder. Your old .env has not been changed.' }
  if ($text -notmatch 'GENERATE_LOCALLY') {
    Write-Host 'Existing .env preserved. No secrets were changed.'
    exit 0
  }
} else {
  $text = [IO.File]::ReadAllText((Join-Path $PSScriptRoot '.env.example'))
}
foreach ($name in @('COMMERCE_DB_PASSWORD', 'IDENTITY_DB_PASSWORD', 'COMMERCE_SERVICE_TOKEN', 'IDENTITY_SERVICE_TOKEN', 'SESSION_SECRET', 'MAINTENANCE_TOKEN', 'GRAFANA_ADMIN_PASSWORD', 'GATEWAY_DB_PASSWORD')) {
  $text = $text.Replace(($name + '=GENERATE_LOCALLY'), ($name + '=' + (New-LocalSecret)))
}
$text = $text.Replace('GATEWAY_TEST_KEY=sk_test_GENERATE_LOCALLY', ('GATEWAY_TEST_KEY=sk_test_' + (New-LocalSecret)))
$text = $text.Replace('GATEWAY_WEBHOOK_SECRET=whsec_test_GENERATE_LOCALLY', ('GATEWAY_WEBHOOK_SECRET=whsec_test_' + (New-LocalSecret)))
$admin = @(@{ name = 'local-admin'; role = 'admin'; token = (New-LocalSecret) })
$adminJson = ConvertTo-Json -InputObject $admin -Compress
$text = $text.Replace('ADMIN_TOKENS=[]', ("ADMIN_TOKENS='" + $adminJson + "'"))
if ($text -match 'GENERATE_LOCALLY') { throw 'Unresolved placeholders. No file was written.' }
[IO.File]::WriteAllText($path, $text, (New-Object System.Text.UTF8Encoding($false)))
Write-Host 'Local .env is ready. Secrets were generated here and not printed.'
Write-Host 'For staff login, open .env privately and use the local-admin token. Do not share it.'
Write-Host 'Payments run through the local gateway with simulated connectors (test cards only). Do not use this setup on a public server.'
Write-Host 'Next: docker compose up --build -d'
