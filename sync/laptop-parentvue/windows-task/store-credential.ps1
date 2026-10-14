# Store the ParentVUE credentials in Windows Credential Manager via cmdkey.exe.
# Run once on the Windows laptop (interactive):
#   powershell -ExecutionPolicy Bypass -File store-credential.ps1
#
# Uses cmdkey.exe (built into Windows) — no PowerShell modules needed.
# The sync script reads them back via the keyring library.

$target = "cockpit-parentvue"

$username = Read-Host "ParentVUE username"
$secure = Read-Host "ParentVUE password" -AsSecureString
$plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))

# Remove any stale entry first (idempotent re-run).
cmdkey /delete:$target 2>$null | Out-Null

cmdkey /generic:$target /user:$username /pass:$plain

# Clear the plaintext from memory.
$plain = $null
[GC]::Collect()

# Verify.
$verify = cmdkey /list:$target 2>&1 | Out-String
if ($verify -match [regex]::Escape($target)) {
    Write-Host "OK: credentials stored for '$username' under '$target'."
} else {
    Write-Host "FAILED: could not verify the stored credential." -ForegroundColor Red
    exit 1
}
