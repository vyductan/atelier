# Quick Start Guide

## ⚠️ Important: How to Run the App

This is a **Tauri desktop application**. It must be run through Tauri, not directly in a browser.

### ✅ Correct Way

```bash
cd apps/desktop
pnpm atelier:devev
```

This will:

1. Start the Vite dev server
2. Compile the Rust backend
3. Launch the native desktop app
4. Enable hot reload

### ❌ Wrong Way

```bash
# DON'T do this:
pnpm dev
```

This only starts the Vite server at `http://localhost:1420` but **won't work** because the Tauri API won't be available in the browser.

## 🎯 Common Issues

### "Cannot read properties of undefined (reading 'invoke')"

**Solution:** You're running `pnpm dev` instead of `pnpm atelier:devev`. Use the correct command above.

### Port 1420 already in use

```bash
# Kill the process
lsof -ti:1420 | xargs kill -9

# Then run again
pnpm atelier:devev
```

### Rust compilation errors

```bash
cd src-tauri
cargo clean
cd ..
pnpm atelier:devev
```

## 📚 More Info

See the full [README.md](README.md) and [DEVELOPMENT.md](DEVELOPMENT.md) for complete documentation.
