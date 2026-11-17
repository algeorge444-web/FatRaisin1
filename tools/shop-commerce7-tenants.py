import json,requests,re,concurrent.futures as cf,warnings,unicodedata;warnings.filterwarnings('ignore')
P=json.load(open('platf.json'));T=[p[0] for p in P if p[1]=='commerce7']
# also every other ON+BC winery already read via other platforms? only unread ones
H={'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36'}
def slug(s):return re.sub(r'-+','-',re.sub(r'[^a-z0-9]+','-',unicodedata.normalize('NFD',s).encode('ascii','ignore').decode().lower())).strip('-')
def ok(t):
    try:
        r=requests.get('https://api.commerce7.com/v1/product/for-web?page=1&limit=1',headers={'tenant':t},timeout=15)
        return r.status_code==200 and 'products' in r.text
    except Exception:return False
def find(w):
    u=w['web'] if w['web'].startswith('http') else 'https://'+w['web']
    try:t=requests.get(u,headers=H,timeout=15).text
    except Exception:t=''
    cands=re.findall(r'data-tenant=["\']([a-z0-9-]+)',t)+re.findall(r'tenant["\']?\s*[:=]\s*["\']([a-z0-9-]{3,})["\']',t)+re.findall(r'images\.commerce7\.com/([a-z0-9-]+)/',t)
    host=re.sub(r'^www\.','',re.sub(r'^https?://','',u).split('/')[0]).split('.')[0]
    cands+=[host,slug(w['name'])]
    for c in dict.fromkeys(cands):
        if c in('true','false') or len(c)<3:continue
        if ok(c):return w,c
    return w,''
with cf.ThreadPoolExecutor(20) as ex:res=list(ex.map(find,T))
got=[(w,t) for w,t in res if t];print('tenants found',len(got),'of',len(T))
json.dump(got,open('c7tenants.json','w'))
