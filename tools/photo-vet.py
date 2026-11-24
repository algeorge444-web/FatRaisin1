# Checks candidate place photos (run on GitHub): downloads each image and keeps only real photographs,
# rejecting logos, text graphics, blank backgrounds and flat artwork (colour variety / flat-area test).
# Input tools/photo-vet-list.json [{id,img}]  Output tools/photo-vet-result.json {id:{ok,why,...}}
import json, math, io, urllib.request, concurrent.futures as cf
from PIL import Image, ImageFilter, ImageStat
L = json.load(open('tools/photo-vet-list.json'))
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36'
def feats(im):
    im = im.convert('RGB'); im.thumbnail((256, 256))
    g = im.convert('L'); st = ImageStat.Stat(g)
    q = im.quantize(colors=32, method=Image.Quantize.MEDIANCUT); h = sorted(q.histogram()[:32], reverse=True); tot = sum(h)
    top3 = sum(h[:3]) / tot
    hist = g.histogram(); n = sum(hist); ent = -sum((c / n) * math.log2(c / n) for c in hist if c)
    px = list(g.tobytes()); flat = sum(1 for i in range(len(px) - 1) if abs(px[i] - px[i + 1]) < 2) / len(px)
    return dict(std=round(st.stddev[0], 1), top3=round(top3, 2), ent=round(ent, 2), flat=round(flat, 2))
def one(p):
    try:
        req = urllib.request.Request(p['img'], headers={'User-Agent': UA, 'Accept': 'image/*'})
        data = urllib.request.urlopen(req, timeout=25).read(12_000_000)
        im = Image.open(io.BytesIO(data)); im.load()
        if im.mode in ('RGBA', 'LA', 'P') and 'transparency' in im.info or im.mode == 'RGBA':
            a = im.convert('RGBA').getchannel('A'); 
            if ImageStat.Stat(a).mean[0] < 250: return p['id'], dict(ok=False, why='transparent')
        f = feats(im)
        ok = f['ent'] >= 6.2 and f['flat'] <= 0.76 and f['std'] >= 25 and f['top3'] <= 0.4
        return p['id'], dict(ok=ok, why='' if ok else 'graphic', **f)
    except Exception as e:
        return p['id'], dict(ok=False, why='download')
out = dict(cf.ThreadPoolExecutor(16).map(one, L))
json.dump(out, open('tools/photo-vet-result.json', 'w'))
print(len(out), 'checked;', sum(1 for v in out.values() if v['ok']), 'real photos')
