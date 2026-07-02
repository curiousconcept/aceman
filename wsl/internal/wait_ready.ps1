param([Parameter(Mandatory = $true)][string]$Url)

# Wait until the aceman web server actually answers, THEN let run.bat open the
# browser. Two things matter here:
#
#  1) Probe from Windows (this is the browser's own path). The guest port can be
#     up several seconds before WSL wires Windows' localhost forwarding to it, so
#     a check from inside WSL passes too early and the browser opens to a
#     connection reset. Probing the real Windows URL waits for the path the
#     browser uses. The proxy is disabled so we don't pay the WPAD/IE overhead
#     that made Invoke-WebRequest lag. A full GetResponse() (not a bare TCP
#     connect) confirms Python is serving - podman accepts the handshake before
#     the app is up.
#
#  2) Show a busy mouse cursor while waiting. We swap the normal arrow for the
#     app-starting (arrow+hourglass) cursor system-wide, and ALWAYS restore it in
#     finally. App-starting (not the full hourglass) still lets you click, so a
#     hard window-close mid-wait leaves a usable pointer until the next sign-in.

$sig = @'
[DllImport("user32.dll")] public static extern IntPtr LoadCursor(IntPtr hInstance, int lpCursorName);
[DllImport("user32.dll")] public static extern bool SetSystemCursor(IntPtr hcur, uint id);
[DllImport("user32.dll")] public static extern bool SystemParametersInfo(uint uiAction, uint uiParam, IntPtr pvParam, uint fWinIni);
'@
Add-Type -MemberDefinition $sig -Name Cur -Namespace W | Out-Null

$OCR_NORMAL      = 32512   # the system arrow we replace
$IDC_APPSTARTING = 32650   # arrow + hourglass
$SPI_SETCURSORS  = 0x0057  # reload all system cursors from the user's defaults

try {
    [W.Cur]::SetSystemCursor([W.Cur]::LoadCursor([IntPtr]::Zero, $IDC_APPSTARTING), $OCR_NORMAL) | Out-Null

    for ($i = 0; $i -lt 150; $i++) {
        try {
            $r = [Net.WebRequest]::Create($Url)
            $r.Proxy = $null
            $r.Timeout = 1500
            $r.GetResponse().Close()
            break
        } catch {
            Start-Sleep -Milliseconds 500
        }
    }
} finally {
    [W.Cur]::SystemParametersInfo($SPI_SETCURSORS, 0, [IntPtr]::Zero, 0) | Out-Null
}
