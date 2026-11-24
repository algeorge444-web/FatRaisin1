# Makes small previews (data URIs) of candidate place photos so the owner can approve them on one page.
# Run on GitHub. Input tools/photo-thumb-list.json [{id,img}]  Output tools/photo-thumbs.json {id:dataURI}
import json, io, base64, urllib.request, concurrent.futures as cf
from PIL import Image
L = json.load(open('tools/photo-thumb-list.json'))
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36'
def one(p):
    try:
        data = urllib.request.urlopen(urllib.request.Request(p['img'], headers={'User-Agent': UA, 'Accept': 'image/*'}), timeout=25).read(12_000_000)
        im = Image.open(io.BytesIO(data)).convert('RGB'); im.thumbnail((360, 240))
        b = io.BytesIO(); im.save(b, 'JPEG', quality=62, optimize=True)
        return p['id'], 'data:image/jpeg;base64,' + base64.b64encode(b.getvalue()).decode()
    except Exception:
        return p['id'], ''
out = {k: v for k, v in cf.ThreadPoolExecutor(16).map(one, L) if v}
json.dump(out, open('tools/photo-thumbs.json', 'w'))
print(len(out), 'previews made')
