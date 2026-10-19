"""Draws the Local AI Voice Studio logo (a voice waveform in a rounded square) and writes every icon the app needs.

  python3 tools/generate-icons.py        (needs Pillow)

Writes: public/ (favicons, apple-touch, PWA icons, manifest, window icon) and build/ (installer icons: icon.png 1024,
icon.ico for Windows, icon.icns for macOS). The same drawing is also saved as public/favicon.svg.
"""
import json, os
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
CYAN, CYAN_DARK, BG_TOP, BG_BOT = (0, 217, 255), (14, 140, 190), (22, 27, 37), (9, 12, 18)
# bars: (center x, half height, half width) in a 100x100 design box
BARS = [(18, 20, 6.2), (34, 33, 6.6), (50, 44, 7.2), (66, 33, 6.6), (82, 20, 6.2)]


def render(size, rounded=True, simple=None, pad=0.0):
    """size px logo. rounded=False -> full-bleed square (apple-touch / maskable). pad = safe-zone margin (0..0.2)."""
    S = 4  # supersampling for clean edges
    N = size * S
    simple = size <= 40 if simple is None else simple
    bars = BARS
    if size <= 24:      # tiny: three bold bars stay readable
        bars = [(26, 24, 8.5), (50, 38, 9), (74, 24, 8.5)]
    img = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    # background gradient
    grad = Image.new("RGBA", (1, N))
    for y in range(N):
        t = y / (N - 1)
        grad.putpixel((0, y), tuple(int(BG_TOP[i] + (BG_BOT[i] - BG_TOP[i]) * t) for i in range(3)) + (255,))
    bg = grad.resize((N, N))
    mask = Image.new("L", (N, N), 0)
    d = ImageDraw.Draw(mask)
    if rounded:
        d.rounded_rectangle([0, 0, N - 1, N - 1], radius=int(N * 0.22), fill=255)
    else:
        d.rectangle([0, 0, N, N], fill=255)
    img.paste(bg, (0, 0), mask)
    draw = ImageDraw.Draw(img)
    if rounded:  # glowing border
        bw = 0 if size <= 24 else max(S, int(N * (0.045 if not simple else 0.06)))
        if bw:
            draw.rounded_rectangle([bw // 2, bw // 2, N - 1 - bw // 2, N - 1 - bw // 2], radius=int(N * 0.22), outline=CYAN + (255,), width=bw)
    inner = 1.0 - 2 * pad
    off = pad * N

    def X(v): return off + v / 100.0 * N * inner
    def Y(v): return off + v / 100.0 * N * inner

    if not simple:  # soft halo behind each bar
        halo = Image.new("RGBA", (N, N), (0, 0, 0, 0))
        hd = ImageDraw.Draw(halo)
        for cx, hh, hw in bars:
            hd.rounded_rectangle([X(cx - hw * 1.55), Y(50 - hh * 1.06), X(cx + hw * 1.55), Y(50 + hh * 1.06)], radius=int(N * 0.05), fill=CYAN + (60,))
        img.alpha_composite(halo.filter(ImageFilter.GaussianBlur(N * 0.006)))
        draw = ImageDraw.Draw(img)
    widen = (1.0 if size <= 24 else 0.72) if simple else 1.0
    for cx, hh, hw in bars:
        hw2 = hw * widen
        r = (X(cx + hw2) - X(cx - hw2)) / 2
        draw.rounded_rectangle([X(cx - hw2), Y(50 - hh), X(cx + hw2), Y(50 + hh)], radius=r, fill=CYAN + (255,))
        if not simple:
            iw = hw * 0.38
            draw.rounded_rectangle([X(cx - iw), Y(50 - hh * 0.5), X(cx + iw), Y(50 + hh * 0.5)], radius=(X(cx + iw) - X(cx - iw)) / 2, fill=CYAN_DARK + (255,))
    return img.resize((size, size), Image.LANCZOS)


def svg():
    bars = ""
    for cx, hh, hw in BARS:
        bars += (f'<rect x="{cx - hw * 1.55:.1f}" y="{50 - hh * 1.06:.1f}" width="{hw * 3.1:.1f}" height="{hh * 2.12:.1f}" rx="5" fill="#00D9FF" opacity=".24"/>'
                 f'<rect x="{cx - hw:.1f}" y="{50 - hh}" width="{hw * 2:.1f}" height="{hh * 2}" rx="{hw:.1f}" fill="#00D9FF"/>'
                 f'<rect x="{cx - hw * .38:.1f}" y="{50 - hh * .5:.1f}" width="{hw * .76:.1f}" height="{hh:.1f}" rx="{hw * .38:.1f}" fill="#0E8CBE"/>')
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">'
            '<stop offset="0" stop-color="#161B25"/><stop offset="1" stop-color="#090C12"/></linearGradient></defs>'
            '<rect x="2.2" y="2.2" width="95.6" height="95.6" rx="21" fill="url(#g)" stroke="#00D9FF" stroke-width="4.4"/>' + bars + '</svg>\n')


def save(img, *parts):
    path = os.path.join(ROOT, *parts)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path)
    print("wrote", os.path.relpath(path, ROOT))


big = render(1024)
for s in (16, 32, 48):
    save(render(s), "public", f"favicon-{s}x{s}.png")
save(render(180, rounded=False), "public", "apple-touch-icon.png")
save(render(192), "public", "icon-192.png")
save(render(512), "public", "icon-512.png")
save(render(512, rounded=False, pad=0.12), "public", "maskable-512.png")
save(render(512), "public", "icon.png")                      # Electron window icon / Linux
ico_sizes = [(s, s) for s in (16, 24, 32, 48, 64, 128, 256)]
# every ICO size is drawn on its own (a shrunken big logo turns into a blur at 16 px)
frames = [render(s) for s in (16, 24, 32, 48, 64, 128, 256)]
for target in (("public", "favicon.ico"), ("build", "icon.ico")):
    frames[-1].save(os.path.join(ROOT, *target), format="ICO", sizes=ico_sizes, append_images=frames[:-1])
    print("wrote", "/".join(target))
save(big, "build", "icon.png")
big.save(os.path.join(ROOT, "build", "icon.icns"))
print("wrote build/icon.icns")
open(os.path.join(ROOT, "public", "favicon.svg"), "w").write(svg())
print("wrote public/favicon.svg")
json.dump({
    "name": "Local AI Voice Studio", "short_name": "Voice Studio",
    "description": "Text-to-speech, voice cloning and dubbing on your own PC",
    "start_url": "/", "display": "standalone", "background_color": "#080A0F", "theme_color": "#00D9FF",
    "icons": [
        {"src": "/icon-192.png", "sizes": "192x192", "type": "image/png"},
        {"src": "/icon-512.png", "sizes": "512x512", "type": "image/png"},
        {"src": "/maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
    ],
}, open(os.path.join(ROOT, "public", "site.webmanifest"), "w"), indent=2)
print("wrote public/site.webmanifest")
