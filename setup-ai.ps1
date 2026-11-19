$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$runtimePath = Join-Path $PSScriptRoot 'tools/python'
New-Item -ItemType Directory -Force -Path 'tools', 'data/models' | Out-Null
if (-not (Test-Path -LiteralPath (Join-Path $runtimePath 'python.exe'))) {
  Invoke-WebRequest 'https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip' -OutFile 'tools/python.zip'
  Expand-Archive -LiteralPath 'tools/python.zip' -DestinationPath $runtimePath -Force
  Add-Content -LiteralPath (Join-Path $runtimePath 'python312._pth') -Value "`nimport site"
  Invoke-WebRequest 'https://bootstrap.pypa.io/get-pip.py' -OutFile 'tools/get-pip.py'
  & (Join-Path $runtimePath 'python.exe') 'tools/get-pip.py' --no-warn-script-location
  if ($LASTEXITCODE -ne 0) { throw 'pip setup failed.' }
}
& (Join-Path $runtimePath 'python.exe') -m pip install -r 'ai/requirements-lock.txt' --no-warn-script-location
if ($LASTEXITCODE -ne 0) { throw 'AI dependency installation failed.' }
& (Join-Path $runtimePath 'python.exe') -c "from faster_whisper import WhisperModel; WhisperModel('base', device='cpu', compute_type='int8', download_root='data/models'); print('Local AI ready')"
if ($LASTEXITCODE -ne 0) { throw 'Could not download the speech model. Re-run setup with an internet connection.' }
