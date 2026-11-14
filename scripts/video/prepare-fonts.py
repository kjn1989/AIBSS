"""使い方ムービーの収録用に、Noto Sans JP をシステムフォントとして入れる。

アプリの font-family は -apple-system, 'Hiragino Sans', 'Noto Sans JP', sans-serif。
Linux の収録環境には前の2つが無く、Noto Sans JP も無いと中国語字形のフォントに落ちる。

もう1つ、Noto Sans JP は ⚾ などを白黒の文字として持っているので、そのままだと
iPhone では絵文字で出るものが白黒になる(Hiragino には無いので絵文字に落ちる)。
収録用の写しからは、絵文字表示が既定の文字を外して、iPhone と同じ見え方にする。

使い方:
  npm pack @expo-google-fonts/noto-sans-jp   # TTF が入っている
  tar xzf expo-google-fonts-noto-sans-jp-*.tgz
  python3 scripts/video/prepare-fonts.py package
  fc-cache -f
(fonttools が要る: python3 -m pip install fonttools)
"""
import glob
import os
import shutil
import sys

from fontTools.ttLib import TTFont

# Emoji_Presentation=Yes の BMP 文字(iPhone では絵文字で出る)
EMOJI_RANGES = [
    (0x231A, 0x231B), (0x23E9, 0x23EC), (0x23F0, 0x23F0), (0x23F3, 0x23F3), (0x25FD, 0x25FE),
    (0x2614, 0x2615), (0x2648, 0x2653), (0x267F, 0x267F), (0x2693, 0x2693), (0x26A1, 0x26A1),
    (0x26AA, 0x26AB), (0x26BD, 0x26BE), (0x26C4, 0x26C5), (0x26CE, 0x26CE), (0x26D4, 0x26D4),
    (0x26EA, 0x26EA), (0x26F2, 0x26F3), (0x26F5, 0x26F5), (0x26FA, 0x26FA), (0x26FD, 0x26FD),
    (0x2705, 0x2705), (0x270A, 0x270B), (0x2728, 0x2728), (0x274C, 0x274C), (0x274E, 0x274E),
    (0x2753, 0x2755), (0x2757, 0x2757), (0x2795, 0x2797), (0x27B0, 0x27B0), (0x27BF, 0x27BF),
    (0x2B1B, 0x2B1C), (0x2B50, 0x2B50), (0x2B55, 0x2B55),
]
DROP = {c for a, b in EMOJI_RANGES for c in range(a, b + 1)}
WEIGHTS = ['400Regular', '500Medium', '700Bold', '800ExtraBold', '900Black']

src = sys.argv[1] if len(sys.argv) > 1 else 'package'
dest = os.path.expanduser('~/.local/share/fonts/notojp')
os.makedirs(dest, exist_ok=True)
for w in WEIGHTS:
    for path in glob.glob(os.path.join(src, w, '*.ttf')):
        out = os.path.join(dest, os.path.basename(path))
        shutil.copyfile(path, out)
        font = TTFont(out)
        for table in font['cmap'].tables:
            for c in [c for c in table.cmap if c in DROP]:
                del table.cmap[c]
        font.save(out)
        print('installed', out)
