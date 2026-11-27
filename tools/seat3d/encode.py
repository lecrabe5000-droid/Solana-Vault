# Encodes the rendered PNG frames into the page's two WebP sets. Pillow is used rather than ffmpeg because it can
# compress the transparency too (alpha_quality): the soft shadows and glows made losslessly-kept alpha the bulk of the size.
#   python3 tools/seat3d/encode.py <png dir> <out root> <size>     → <out root>/hi (size) and <out root>/lo (size / 2)
import sys, os, glob
from multiprocessing import Pool
from PIL import Image
src, out, size = sys.argv[1], sys.argv[2], int(sys.argv[3])
SETS = [("hi", size, 80), ("lo", size // 2, 74)]
def one(path):
    im = Image.open(path); name = os.path.basename(path).replace(".png", ".webp")
    for d, s, q in SETS: im.resize((s, s), Image.LANCZOS).save(os.path.join(out, d, name), "WEBP", quality=q, alpha_quality=76, method=6)
if __name__ == "__main__":
    for d, _, _ in SETS:
        os.makedirs(os.path.join(out, d), exist_ok=True)
        for f in glob.glob(os.path.join(out, d, "*.webp")): os.remove(f)
    with Pool(4) as p: p.map(one, sorted(glob.glob(os.path.join(src, "f-*.png"))))
    for d, _, _ in SETS: print(d, sum(os.path.getsize(f) for f in glob.glob(os.path.join(out, d, "*.webp"))) // 1024, "KB")
