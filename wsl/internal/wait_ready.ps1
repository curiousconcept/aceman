param([Parameter(Mandatory = $true)][string]$Url)

# Wait until the aceman web server answers, THEN let run.bat open the browser.
#
# Probe 127.0.0.1 directly, NOT 'localhost': localhost resolves to ::1 (IPv6)
# first, and .NET's WebRequest does not fall back to IPv4 the way a browser's
# happy-eyeballs does - so probing 'localhost' fails forever even while the
# server is up on IPv4 and the browser reaches it fine. Proxy is disabled so we
# don't pay the WPAD/IE lag. Any HTTP answer (even a non-200) means the server
# is serving, so we stop and open. The loop is BOUNDED - if the probe never
# succeeds we still hand back so run.bat opens the browser rather than hanging.
#
# The loop BREAKS as soon as the server answers - that's the real trigger, so a
# slow start just waits longer. The iteration cap (~2 min of refused attempts,
# which are fast) is only a safety net so a truly-unreachable server can't hang
# forever; it is NOT meant to fire on a normal startup.
#
# While waiting, swap the arrow for the app-starting (arrow+hourglass) cursor
# and ALWAYS restore it in finally. The loop is bounded, so finally is reached.

$probe = $Url -replace 'localhost', '127.0.0.1'

$sig = @'
[DllImport("user32.dll")] public static extern IntPtr LoadCursor(IntPtr hInstance, int lpCursorName);
[DllImport("user32.dll")] public static extern bool SetSystemCursor(IntPtr hcur, uint id);
[DllImport("user32.dll")] public static extern bool SystemParametersInfo(uint uiAction, uint uiParam, IntPtr pvParam, uint fWinIni);
'@
Add-Type -MemberDefinition $sig -Name Cur -Namespace W | Out-Null

$OCR_NORMAL      = 32512
$IDC_APPSTARTING = 32650
$SPI_SETCURSORS  = 0x0057

try {
    [W.Cur]::SetSystemCursor([W.Cur]::LoadCursor([IntPtr]::Zero, $IDC_APPSTARTING), $OCR_NORMAL) | Out-Null

    for ($i = 0; $i -lt 240; $i++) {
        try {
            $r = [Net.WebRequest]::Create($probe)
            $r.Proxy = $null
            $r.Timeout = 1000
            $r.GetResponse().Close()
            break
        } catch {
            # A WebException that carries a Response means the server answered
            # (some non-2xx) - it IS up, so stop waiting.
            if ($_.Exception.Response) { break }
            Start-Sleep -Milliseconds 500
        }
    }
} finally {
    [W.Cur]::SystemParametersInfo($SPI_SETCURSORS, 0, [IntPtr]::Zero, 0) | Out-Null
}
