# App Icons

Source: `icon.svg` (1024×1024, macOS icon grid: 824px body). An easel whose
tapered legs form an "A" for Atelier, holding a laptop with a `>_` prompt,
with the green status dot from the Services tab.

## Files

- `icon.svg` - editable source
- `32x32.png`, `128x128.png`, `128x128@2x.png` - app icons referenced by `tauri.conf.json`
- `icon.icns` - macOS icon bundle (all sizes)
- `icon.png` - base icon (512×512)

## Regenerating

```bash
rsvg-convert -w 1024 -h 1024 icons/icon.svg -o /tmp/atelier-icon.png
npx tauri icon /tmp/atelier-icon.png -o /tmp/atelier-icons
cp /tmp/atelier-icons/{32x32.png,128x128.png,128x128@2x.png,icon.icns,icon.png} icons/
```

`tauri icon` also emits Windows, Android and iOS assets; only the files above
are used by this macOS app.
