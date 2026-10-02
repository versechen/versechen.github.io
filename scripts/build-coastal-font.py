"""Rebuild the licensed display subset from a local Noto Serif CJK TTC.
Usage: python scripts/build-coastal-font.py /path/to/NotoSerifCJK-Regular.ttc
Requires fonttools; emits WOFF with no external font service.
"""
from pathlib import Path
import sys
from fontTools import subset
from fontTools.ttLib import TTFont
root = Path(__file__).resolve().parents[1]
text = ''.join(p.read_text(errors='ignore') for p in (root/'src').rglob('*') if p.is_file() and p.suffix in ['.astro','.md','.mdx','.ts'])
font = TTFont(sys.argv[1], fontNumber=2)
subsetter = subset.Subsetter(options=subset.Options())
subsetter.populate(text=text)
subsetter.subset(font)
for name in font['name'].names:
    if name.nameID in [1,3,4,6,16]:
        name.string = ('CoastalEditorial-Regular' if name.nameID in [3,6] else 'Coastal Editorial').encode(name.getEncoding())
font.flavor = 'woff'
font.save(root/'public/fonts/coastal-editorial.woff')
