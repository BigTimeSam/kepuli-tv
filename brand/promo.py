"""Kauppasivun promokuvat: Codexin generoima televisio + oikealla fontilla ladottu teksti."""
import math
import os
from PIL import Image, ImageDraw, ImageFont

BRAND = os.path.dirname(os.path.abspath(__file__))
SF = '/System/Library/Fonts/SFNS.ttf'
BG, TEXT, MUTED, ACCENT, CYAN = (10,12,17), (231,234,242), (141,149,170), (124,92,255), (34,211,238)

def font(size, weight='Regular'):
    f = ImageFont.truetype(SF, size); f.set_variation_by_name(weight); return f

def glow(size, center, radius, color, strength):
    """Pehmeä radiaalinen hehku. Apuruudukko seuraa kuvasuhdetta, muuten
       ympyrä venyisi soikioksi leveissä kuvissa."""
    w, h = size
    gw = 128; gh = max(8, round(gw*h/w))
    g = Image.new('RGB', (gw, gh), BG); px = g.load()
    cx, cy = center[0]/w*gw, center[1]/h*gh
    rx, ry = radius/w*gw, radius/h*gh
    for y in range(gh):
        for x in range(gw):
            d = math.hypot((x-cx)/rx, (y-cy)/ry)
            t = max(0.0, 1.0-d)**2 * strength
            px[x,y] = tuple(int(BG[i] + (color[i]-BG[i])*t) for i in range(3))
    return g.resize(size, Image.BICUBIC)

def tile(w, h, tv_frac, title_px, tag_px, gap, pad, lines, out):
    tv = Image.open(f'{BRAND}/master-full.png')
    th = int(h*tv_frac); tv = tv.resize((th, th), Image.LANCZOS)

    d0 = ImageDraw.Draw(Image.new('RGB', (1,1)))
    size = title_px
    ft = font(size, 'Semibold'); fg = font(tag_px, 'Regular')
    text_w = max([d0.textlength('Kepuli-TV', font=ft)] +
                 [d0.textlength(l, font=fg) for l in lines])
    # otsikko kutistetaan jos ryhmä ei mahdu reunusten väliin
    while size > 12 and th + gap + text_w > w - 2*pad:
        size -= 2; ft = font(size, 'Semibold')
        text_w = max([d0.textlength('Kepuli-TV', font=ft)] +
                     [d0.textlength(l, font=fg) for l in lines])

    group_w = th + gap + text_w
    x0 = (w - group_w)/2                      # koko ryhmä optisesti keskelle
    tv_x, tv_y = int(x0), (h-th)//2
    cx = tv_x + th/2

    img = glow((w,h), (cx, h*0.5), h*0.95, ACCENT, 0.34).convert('RGBA')
    img = Image.blend(img, glow((w,h), (cx, h*0.46), h*0.46, CYAN, 0.26).convert('RGBA'), 0.45)
    img.alpha_composite(tv, (tv_x, tv_y))

    d = ImageDraw.Draw(img)
    x = tv_x + th + gap
    title_h, line_h = size*1.02, tag_px*1.42
    block = title_h + tag_px*0.8 + line_h*len(lines)
    y = (h - block)/2
    d.text((x, y), 'Kepuli-TV', font=ft, fill=TEXT)
    y += title_h + tag_px*0.8
    for ln in lines:
        d.text((x, y), ln, font=fg, fill=MUTED); y += line_h

    img.convert('RGB').save(out, optimize=True)
    print(f'{out.split("/")[-1]}  {w}x{h}  otsikko {size}px  ryhmä {int(group_w)}px / {w-2*pad}px')

tile(440, 280,  0.74, 46, 17, 22, 26,
     ['Xtream Codes -IPTV', 'suoraan selaimessa'],
     f'{BRAND}/promo-small-440x280.png')
tile(1400, 560, 0.80, 128, 42, 64, 80,
     ['Xtream Codes -IPTV suoraan selaimessa'],
     f'{BRAND}/promo-marquee-1400x560.png')
