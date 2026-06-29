# App Icons

electron-builder reads icons from this directory. You need to provide:

## Required files

| File | Size | Platform |
|------|------|----------|
| `icon.icns` | multi-size (16→1024px) | macOS |
| `icon.ico` | multi-size (16→256px) | Windows |
| `icon.png` | 512×512 | Linux / fallback |

## How to create them

Start with a **1024×1024 PNG** master (`icon-master.png`).

### macOS (.icns)
```bash
# Using iconutil (macOS only)
mkdir icon.iconset
sips -z 16 16     icon-master.png --out icon.iconset/icon_16x16.png
sips -z 32 32     icon-master.png --out icon.iconset/icon_16x16@2x.png
sips -z 32 32     icon-master.png --out icon.iconset/icon_32x32.png
sips -z 64 64     icon-master.png --out icon.iconset/icon_32x32@2x.png
sips -z 128 128   icon-master.png --out icon.iconset/icon_128x128.png
sips -z 256 256   icon-master.png --out icon.iconset/icon_128x128@2x.png
sips -z 256 256   icon-master.png --out icon.iconset/icon_256x256.png
sips -z 512 512   icon-master.png --out icon.iconset/icon_256x256@2x.png
sips -z 512 512   icon-master.png --out icon.iconset/icon_512x512.png
sips -z 1024 1024 icon-master.png --out icon.iconset/icon_512x512@2x.png
iconutil -c icns icon.iconset -o icon.icns
```

### Windows (.ico)
Use [ImageMagick](https://imagemagick.org/) or [icotools](https://www.npmjs.com/package/icotools):
```bash
magick icon-master.png -define icon:auto-resize=256,128,64,48,32,16 icon.ico
```

### Quick option
Use an online converter like [cloudconvert.com](https://cloudconvert.com) to convert
your PNG to ICNS and ICO. No tools required.
