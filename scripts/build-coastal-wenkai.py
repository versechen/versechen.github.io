"""Build a renamed WOFF2 display subset from official LXGW WenKai v1.522 Regular.
Usage: python scripts/build-coastal-wenkai.py /path/to/LXGWWenKai-Regular.ttf
Requires fonttools and brotli. The OFL license is shipped beside the font.
"""
from pathlib import Path
import sys
from fontTools import subset
from fontTools.ttLib import TTFont
root = Path(__file__).resolve().parents[1]
text = ''.join(p.read_text(errors='ignore') for p in (root/'src').rglob('*')
               if p.is_file() and p.suffix in ['.astro', '.md', '.mdx', '.ts', '.json'])
text += ''.join(chr(n) for n in range(32,127))
font = TTFont(sys.argv[1])
cmap = font.getBestCmap()
wanted = {ord(c) for c in text}
subsetter = subset.Subsetter(options=subset.Options())
subsetter.populate(unicodes=wanted)
subsetter.subset(font)
for name in font['name'].names:
    if name.nameID in [1,3,4,6,16]:
        name.string = ('CoastalHand-Regular' if name.nameID in [3,6] else 'Coastal Hand').encode(name.getEncoding())
font.flavor = 'woff2'
out = root/'public/fonts/coastal-hand.woff2'
font.save(out)
print(f'{len(wanted & cmap.keys())} Unicode characters; {out.stat().st_size} bytes')
print('Missing source CJK:', ''.join(chr(n) for n in sorted(wanted-cmap.keys()) if 0x3400 <= n <= 0x9fff))
