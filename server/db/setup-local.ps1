# One-time local setup: creates the game's database user and database on your local Postgres.
# Asks for the "postgres" superuser password you set when installing Postgres. The game's own password is read
# from server/.env (generated, local only), so it never has to be typed or shown.
#   powershell -ExecutionPolicy Bypass -File server\db\setup-local.ps1              (port from server/.env: 5433 = Postgres 18)
#   powershell -ExecutionPolicy Bypass -File server\db\setup-local.ps1 -Port 5432   (Postgres 17; also updates server/.env)
param([int]$Port = 0)
$ErrorActionPreference = 'Stop'
$envFile = Join-Path $PSScriptRoot '..\.env'
$lines = Get-Content $envFile
$url = ($lines | Where-Object { $_ -match '^DATABASE_URL=' }) -replace '^DATABASE_URL=', ''
if ($url -notmatch '^postgres://([^:]+):([^@]+)@([^:]+):(\d+)/(.+)$') { throw "DATABASE_URL in server/.env isn't postgres://user:password@host:port/db" }
$user, $pw, $dbHost, $envPort, $db = $Matches[1], $Matches[2], $Matches[3], $Matches[4], $Matches[5]
if ($Port -eq 0) { $Port = [int]$envPort }
$psql = 'C:\Program Files\PostgreSQL\18\bin\psql.exe'

function Invoke-Psql([string[]]$psqlArgs, [string]$what) {
  # psql's error text arrives on stderr; with 'Stop', Windows PowerShell would throw on it before we can explain.
  $ErrorActionPreference = 'Continue'
  $out = & $psql -h localhost -p $Port -U postgres -d postgres -v ON_ERROR_STOP=1 -q @psqlArgs 2>&1 | ForEach-Object { "$_" }
  if ($LASTEXITCODE -ne 0) {
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
    Write-Host "Stopped: $what failed." -ForegroundColor Red
    Write-Host ($out | Out-String)
    exit 1
  }
  return $out
}

$secure = Read-Host "Password for the postgres superuser (Postgres on port $Port)" -AsSecureString
$env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))

# Check the password first, so nothing half-happens.
Invoke-Psql @('-c', 'SELECT 1') 'Signing in as postgres (wrong password, or a different Postgres version?)' | Out-Null

Invoke-Psql @('-c', "DO `$`$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '$user') THEN CREATE ROLE $user LOGIN PASSWORD '$pw'; ELSE ALTER ROLE $user LOGIN PASSWORD '$pw'; END IF; END `$`$;") 'Creating the game user' | Out-Null
$exists = Invoke-Psql @('-tAc', "SELECT 1 FROM pg_database WHERE datname = '$db'") 'Checking for the database'
if ("$exists".Trim() -ne '1') { Invoke-Psql @('-c', "CREATE DATABASE $db OWNER $user") 'Creating the database' | Out-Null }
Remove-Item Env:PGPASSWORD

# A different port than server/.env had: point the game at it.
if ($Port -ne [int]$envPort) {
  $newUrl = "postgres://${user}:${pw}@${dbHost}:${Port}/${db}"
  ($lines | ForEach-Object { if ($_ -match '^DATABASE_URL=') { "DATABASE_URL=$newUrl" } else { $_ } }) | Set-Content -Encoding utf8 $envFile
  Write-Host "server/.env now points at port $Port."
}
Write-Host "Done: database '$db' owned by '$user' on port $Port. The server creates its tables when it starts." -ForegroundColor Green
