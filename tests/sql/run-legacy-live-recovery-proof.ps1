param([string]$PgBin = "$PSScriptRoot/../../.tmp/p1-postgres/pgsql/bin")
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path "$PSScriptRoot/../..").Path
$bin = (Resolve-Path $PgBin).Path
$psql = Join-Path $bin 'psql.exe'
$pgctl = Join-Path $bin 'pg_ctl.exe'
if (Get-NetTCPConnection -LocalPort 55448 -State Listen -ErrorAction SilentlyContinue) {
  throw 'Port 55448 is occupied. Do not reuse or stop an unknown server.'
}
$data = Join-Path $repo ('.tmp/legacy-proof-' + [guid]::NewGuid().ToString('N'))
$server = $null
$priorBin = $env:VOSIO_TEST_PG_BIN
try {
  & (Join-Path $bin 'initdb.exe') -D $data -U legacy_owner -A trust --encoding=UTF8 --locale=C
  if ($LASTEXITCODE -ne 0) { throw 'Disposable initdb failed' }
  $server = Start-Process -FilePath (Join-Path $bin 'postgres.exe') -ArgumentList @('-D', $data, '-h', '127.0.0.1', '-p', '55448') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $data 'stdout.log') -RedirectStandardError (Join-Path $data 'stderr.log')
  $ready = $false
  for ($attempt = 0; $attempt -lt 50; $attempt++) {
    & (Join-Path $bin 'pg_isready.exe') -h 127.0.0.1 -p 55448 *> $null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Milliseconds 100
  }
  if (-not $ready) { throw 'Owned disposable server did not become ready' }
  & (Join-Path $bin 'createdb.exe') -h 127.0.0.1 -p 55448 -U legacy_owner legacy_final_vosio_recovery_test
  if ($LASTEXITCODE -ne 0) { throw 'Disposable database creation failed' }
  $sqlArgs = @('-X', '-q', '-h', '127.0.0.1', '-p', '55448', '-U', 'legacy_owner', '-d', 'legacy_final_vosio_recovery_test', '-v', 'ON_ERROR_STOP=1')
  & $psql @sqlArgs -f (Join-Path $PSScriptRoot 'legacy-live-recovery-bootstrap.sql')
  if ($LASTEXITCODE -ne 0) { throw 'Disposable compatible schema failed' }
  foreach ($migration in Get-ChildItem (Join-Path $repo 'supabase/migrations/*.sql') | Sort-Object Name) {
    & $psql @sqlArgs -f $migration.FullName
    if ($LASTEXITCODE -ne 0) { throw "Migration failed: $($migration.Name)" }
  }
  $env:VOSIO_TEST_PG_BIN = $bin
  Push-Location $repo
  try {
    node (Join-Path $PSScriptRoot 'legacy-live-recovery-proof.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'Native recovery proof failed' }
    node (Join-Path $PSScriptRoot 'saved-transcript-dispatch-proof.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'Saved transcript and dispatch proof failed' }
  } finally { Pop-Location }
} finally {
  $env:VOSIO_TEST_PG_BIN = $priorBin
  if ($server) {
    & $pgctl -D $data -m fast -w stop
    if ($LASTEXITCODE -ne 0) { Write-Warning "Owned server PID $($server.Id) requires shutdown; data path $data" }
  }
}
