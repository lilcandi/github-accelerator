Add-Type -AssemblyName System.Drawing

# Lightning bolt designed on a 128x128 grid, scaled to each size.
$bolt = @(
  @(76, 10), @(26, 72), @(56, 72), @(46, 122), @(102, 54), @(64, 54)
)

function New-Icon {
  param([int]$Size, [string]$Path, [hashtable]$V)

  $bmp = New-Object System.Drawing.Bitmap $Size, $Size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)

  $rect = New-Object System.Drawing.Rectangle -ArgumentList 0, 0, $Size, $Size
  $bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush -ArgumentList $rect, ([System.Drawing.ColorTranslator]::FromHtml($V.bgTop)), ([System.Drawing.ColorTranslator]::FromHtml($V.bgBottom)), 90

  # Rounded background
  $r = [int]($Size * 0.24)
  $d = $r * 2
  $rounded = New-Object System.Drawing.Drawing2D.GraphicsPath
  $rounded.AddArc(0, 0, $d, $d, 180, 90)
  $rounded.AddArc($Size - $d, 0, $d, $d, 270, 90)
  $rounded.AddArc($Size - $d, $Size - $d, $d, $d, 0, 90)
  $rounded.AddArc(0, $Size - $d, $d, $d, 90, 90)
  $rounded.CloseFigure()
  $g.FillPath($bgBrush, $rounded)

  # Gradient lightning bolt
  $boltBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush -ArgumentList $rect, ([System.Drawing.ColorTranslator]::FromHtml($V.boltTop)), ([System.Drawing.ColorTranslator]::FromHtml($V.boltBottom)), 90
  $pts = New-Object 'System.Collections.Generic.List[System.Drawing.Point]'
  foreach ($p in $bolt) {
    $x = [int][Math]::Round($p[0] * $Size / 128)
    $y = [int][Math]::Round($p[1] * $Size / 128)
    $pts.Add((New-Object System.Drawing.Point -ArgumentList $x, $y))
  }
  $g.FillPolygon($boltBrush, $pts.ToArray())

  $g.Dispose()
  $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Host "saved $Path"
}

$icons = Join-Path $PSScriptRoot "..\icons"
New-Item -ItemType Directory -Force -Path $icons | Out-Null

# green  = accelerating (toolbar shows this when a route is active)
# dark   = not accelerating (black bolt on light background)
$variants = @(
  @{ name = 'green'; bgTop = '#121a24'; bgBottom = '#0a0e13'; boltTop = '#6fe08f'; boltBottom = '#2ea043' },
  @{ name = 'dark';  bgTop = '#f6f8fa'; bgBottom = '#cfd8e3'; boltTop = '#39414d'; boltBottom = '#0d1117' }
)

foreach ($v in $variants) {
  foreach ($size in 16, 32, 48, 128) {
    New-Icon $size (Join-Path $icons ("icon-{0}-{1}.png" -f $v.name, $size)) $v
  }
}
Write-Host "done"
