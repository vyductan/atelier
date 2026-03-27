# App Icons

Generated from `/apps/web/public/logo.png`

## Files

- `32x32.png` - 32x32 pixels (app icon, small)
- `128x128.png` - 128x128 pixels (app icon, normal)
- `128x128@2x.png` - 256x256 pixels (app icon, retina)
- `icon.icns` - macOS icon bundle (all sizes)
- `icon.png` - Base icon (256x256)

## Generation

Icons were automatically generated using macOS `sips` and `iconutil`:

```bash
# Resize and pad to square
sips -z 256 256 --padToHeightWidth 256 256 logo.png --out icon-256.png

# Create different sizes
sips -z 32 32 icon-256.png --out 32x32.png
sips -z 128 128 icon-256.png --out 128x128.png
sips -z 256 256 icon-256.png --out 128x128@2x.png

# Create .icns bundle for macOS
iconutil -c icns icon.iconset -o icon.icns
```

## Used By

These icons are referenced in `tauri.conf.json`:

```json
{
  "bundle": {
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ]
  }
}
```

## Updating Icons

To regenerate icons from a new source image:

1. Replace `/apps/web/public/logo.png` with your new logo
2. Run the generation script above
3. Rebuild the app: `pnpm tauri:build`
