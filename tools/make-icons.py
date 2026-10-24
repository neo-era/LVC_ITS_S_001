"""Tạo biểu tượng ứng dụng (nền tối, vòng biển báo đỏ, mũi tên hướng đi)."""
from PIL import Image, ImageDraw
import os

OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'icons')
os.makedirs(OUT, exist_ok=True)

def make(size, pad):
    s = size * 4
    im = Image.new('RGBA', (s, s), (11, 15, 20, 255))
    d = ImageDraw.Draw(im)
    c = s / 2
    r = s * (0.5 - pad)
    d.ellipse([c - r, c - r, c + r, c + r], fill=(255, 255, 255, 255))
    ring = r * 0.2
    d.ellipse([c - r, c - r, c + r, c + r], outline=(229, 57, 53, 255), width=int(ring))
    a = r * 0.55
    d.polygon([(c, c - a), (c + a * 0.7, c + a * 0.8), (c, c + a * 0.35), (c - a * 0.7, c + a * 0.8)], fill=(11, 15, 20, 255))
    return im.resize((size, size), Image.LANCZOS)

make(192, 0.08).save(f'{OUT}/icon-192.png')
make(512, 0.08).save(f'{OUT}/icon-512.png')
make(512, 0.22).save(f'{OUT}/icon-maskable-512.png')
make(180, 0.12).convert('RGB').save(f'{OUT}/apple-touch-icon.png')
make(64, 0.06).save(f'{OUT}/favicon.png')
