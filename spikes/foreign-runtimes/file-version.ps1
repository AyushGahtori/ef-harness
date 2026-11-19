param([Parameter(Mandatory = $true)][string]$Path)
$info = (Get-Item -LiteralPath $Path).VersionInfo
if ($info.ProductVersion) {
    Write-Output $info.ProductVersion
} elseif ($info.FileVersion) {
    Write-Output $info.FileVersion
}
