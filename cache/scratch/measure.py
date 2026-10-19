"""Measure the shipped catalogue so the guiding document quotes facts, not vibes."""

import glob
import json
import statistics as st
from colorsys import rgb_to_hls


def hex_to_rgb(value):
    value = value.strip().lstrip('#')
    if len(value) == 3:
        value = ''.join(c * 2 for c in value)
    return tuple(int(value[i:i + 2], 16) / 255 for i in (0, 2, 4))


def srgb_to_lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def oklab(rgb):
    r, g, b = (srgb_to_lin(c) for c in rgb)
    l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b
    m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b
    s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b
    l_, m_, s_ = (x ** (1 / 3) if x >= 0 else -((-x) ** (1 / 3)) for x in (l, m, s))
    return (
        0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
        1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
        0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
    )


def oklch(value):
    L, a, b = oklab(hex_to_rgb(value))
    import math
    return L, math.hypot(a, b), (math.degrees(math.atan2(b, a)) % 360)


def luminance(value):
    r, g, b = (srgb_to_lin(c) for c in hex_to_rgb(value))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(a, b):
    la, lb = luminance(a), luminance(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def q(values):
    values = sorted(values)
    return {
        'n': len(values),
        'min': round(values[0], 3),
        'p25': round(values[len(values) // 4], 3),
        'median': round(st.median(values), 3),
        'p75': round(values[len(values) * 3 // 4], 3),
        'max': round(values[-1], 3),
    }


SURFACES = ['background', 'status_bar_bg', 'ui_text', 'banner_dim', 'ui_accent',
            'ui_border', 'ui_ok', 'ui_warn', 'ui_error', 'selection_bg']

rows = []
for path in sorted(glob.glob('skins-v2/*.yaml')):
    import yaml
    data = yaml.safe_load(open(path, encoding='utf-8'))
    entry = {'name': data['name'], 'pack': data['pack'], 'category': data['category']}
    for mode, key in (('light', 'light_colors'), ('dark', 'dark_colors')):
        palette = data.get(key) or {}
        for surface in SURFACES:
            if surface not in palette:
                entry[f'{mode}:{surface}:missing'] = True
                continue
            L, C, h = oklch(palette[surface])
            entry[f'{mode}:{surface}'] = {'L': round(L, 3), 'C': round(C, 3), 'h': round(h, 1)}
        if palette.get('background') and palette.get('ui_text'):
            entry[f'{mode}:text_contrast'] = round(contrast(palette['ui_text'], palette['background']), 2)
        if palette.get('banner_dim') and palette.get('background'):
            entry[f'{mode}:dim_contrast'] = round(contrast(palette['banner_dim'], palette['background']), 2)
        if palette.get('ui_border') and palette.get('background'):
            entry[f'{mode}:border_contrast'] = round(contrast(palette['ui_border'], palette['background']), 2)
    rows.append(entry)

stats = {}
for mode in ('light', 'dark'):
    for surface in SURFACES:
        values = [r[f'{mode}:{surface}']['L'] for r in rows if f'{mode}:{surface}' in r]
        chroma = [r[f'{mode}:{surface}']['C'] for r in rows if f'{mode}:{surface}' in r]
        stats[f'{mode}:{surface}'] = {'L': q(values), 'C': q(chroma)}
    for measure in ('text_contrast', 'dim_contrast', 'border_contrast'):
        key = f'{mode}:{measure}'
        stats[key] = q([r[key] for r in rows if key in r])

stats['missing_surfaces'] = {
    f'{mode}:{surface}': sum(1 for r in rows if f'{mode}:{surface}:missing' in r)
    for mode in ('light', 'dark') for surface in SURFACES
}
stats['skins'] = len(rows)
json.dump({'stats': stats, 'rows': rows}, open('cache/scratch/measure.json', 'w'), indent=1)
print(json.dumps(stats, indent=1)[:3000])
