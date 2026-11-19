$ErrorActionPreference = 'Stop'
$toolsPath = Join-Path $PSScriptRoot 'tools'
New-Item -ItemType Directory -Force -Path $toolsPath | Out-Null
Invoke-WebRequest 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe' -OutFile (Join-Path $toolsPath 'yt-dlp.exe')
$archivePath = Join-Path $toolsPath 'ffmpeg.zip'
Invoke-WebRequest 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip' -OutFile $archivePath
Expand-Archive -LiteralPath $archivePath -DestinationPath $toolsPath -Force
$ffmpegPath = Get-ChildItem -LiteralPath $toolsPath -Directory -Filter 'ffmpeg-*' | Select-Object -First 1
Copy-Item -LiteralPath (Join-Path $ffmpegPath.FullName 'bin/ffmpeg.exe') -Destination $toolsPath -Force
Copy-Item -LiteralPath (Join-Path $ffmpegPath.FullName 'bin/ffprobe.exe') -Destination $toolsPath -Force
Write-Output 'Video tools are installed. Run npm start.'
