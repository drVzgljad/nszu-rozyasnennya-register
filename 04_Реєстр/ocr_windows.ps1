param(
    [int]$Limit = 0
)

$ErrorActionPreference = 'Stop'
$OutputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
Add-Type -AssemblyName System.Runtime.WindowsRuntime

$base = Split-Path -Parent $PSScriptRoot
$textDir = (Get-ChildItem -LiteralPath $base -Directory | Where-Object { $_.Name -like '01_*' } | Select-Object -First 1).FullName
$analysisPath = (Get-ChildItem -LiteralPath $PSScriptRoot -Filter '*.json' |
    Where-Object { (Get-Content -LiteralPath $_.FullName -Raw -Encoding UTF8) -match '"text_quality_counts"' } |
    Select-Object -First 1).FullName
$analysis = Get-Content -LiteralPath $analysisPath -Raw -Encoding UTF8 | ConvertFrom-Json
$scanFiles = @($analysis.files | Where-Object { $_.text_quality -eq 'needs_ocr' })
if ($Limit -gt 0) {
    $scanFiles = @($scanFiles | Select-Object -First $Limit)
}

$asTaskMethod = [System.WindowsRuntimeSystemExtensions].GetMethods() |
    Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 } |
    Select-Object -First 1

function Await-Result($operation, [Type]$resultType) {
    $task = $asTaskMethod.MakeGenericMethod($resultType).Invoke($null, @($operation))
    $task.Wait()
    return $task.Result
}

$language = [Windows.Globalization.Language, Windows.Foundation, ContentType=WindowsRuntime]::new('ru')
$engine = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime]::TryCreateFromLanguage($language)
if ($null -eq $engine) {
    throw 'Windows OCR engine for Cyrillic text could not be created.'
}
$storageFileType = [Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime]
$fileAccessType = [Windows.Storage.FileAccessMode, Windows.Storage, ContentType=WindowsRuntime]
$randomStreamType = [Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType=WindowsRuntime]
$decoderType = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType=WindowsRuntime]
$bitmapType = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType=WindowsRuntime]
$ocrResultType = [Windows.Media.Ocr.OcrResult, Windows.Foundation, ContentType=WindowsRuntime]

$results = @()
foreach ($item in $scanFiles) {
    $stem = [System.IO.Path]::GetFileNameWithoutExtension($item.original_file_name)
    $pageFolder = Join-Path $textDir "_ocr_pages\$stem"
    $pages = @(Get-ChildItem -LiteralPath $pageFolder -Filter '*.png' | Sort-Object Name)
    $texts = @()
    foreach ($page in $pages) {
        $file = Await-Result ($storageFileType::GetFileFromPathAsync($page.FullName)) $storageFileType
        $stream = Await-Result ($file.OpenAsync($fileAccessType::Read)) $randomStreamType
        $decoder = Await-Result ($decoderType::CreateAsync($stream)) $decoderType
        $bitmap = Await-Result ($decoder.GetSoftwareBitmapAsync()) $bitmapType
        $recognition = Await-Result ($engine.RecognizeAsync($bitmap)) $ocrResultType
        $texts += $recognition.Text
        $stream.Dispose()
    }
    $text = $texts -join "`r`n`r`n"
    $target = Join-Path $textDir "$stem.ocr.txt"
    Set-Content -LiteralPath $target -Value $text -Encoding UTF8
    $results += [pscustomobject]@{
        original_file_name = $item.original_file_name
        pages = $pages.Count
        ocr_chars = $text.Length
        ocr_file = "$stem.ocr.txt"
    }
}

$results | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'ocr_results.json') -Encoding UTF8
$results | Select-Object original_file_name,pages,ocr_chars,ocr_file | Format-Table -AutoSize
