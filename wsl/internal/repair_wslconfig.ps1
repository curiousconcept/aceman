# Self-heal a stale .wslconfig from an older aceman that wrote
# hostAddressLoopback under [wsl2]. It's an [experimental] key, so WSL warns
# "unknown key 'wsl2.hostAddressLoopback'" on every call. This RELOCATES the key
# aceman itself wrote into [experimental] - it does NOT change your networking
# mode. No-op when the file is absent, has no such key, or already has it under
# [experimental]. Safe to run on every launch.

$cfg = Join-Path $env:USERPROFILE '.wslconfig'
if (-not (Test-Path -LiteralPath $cfg)) { return }
$lines = @(Get-Content -LiteralPath $cfg)

# Section-aware: only act if hostAddressLoopback appears OUTSIDE [experimental].
$section = ''
$misplaced = $false
foreach ($l in $lines) {
    if ($l -match '^\s*\[(.+?)\]') { $section = $matches[1].Trim() }
    elseif ($l -match 'hostAddressLoopback' -and $section -ne 'experimental') { $misplaced = $true }
}
if (-not $misplaced) { return }

if (-not (Test-Path -LiteralPath "$cfg.aceman-backup")) { Copy-Item -LiteralPath $cfg "$cfg.aceman-backup" }

$lines = $lines | Where-Object { $_ -notmatch 'hostAddressLoopback' }
if (-not ($lines | Where-Object { $_ -match '\[experimental\]' })) { $lines += '[experimental]' }
$out = New-Object System.Collections.Generic.List[string]
$e = $false
foreach ($l in $lines) {
    $out.Add($l)
    if (-not $e -and $l -match '\[experimental\]') { $out.Add('hostAddressLoopback=true'); $e = $true }
}
Set-Content -LiteralPath $cfg -Value $out -Encoding ASCII
Write-Host 'aceman: moved a stale hostAddressLoopback in .wslconfig to [experimental] (clears a WSL warning).'
