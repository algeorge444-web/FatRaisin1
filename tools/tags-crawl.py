import warnings;warnings.filterwarnings('ignore')
import json,re,html,concurrent.futures as cf,requests
from urllib.parse import urljoin,urlparse
T=json.load(open('tagstodo.json'))
H={'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36','Accept':'text/html,*/*','Accept-Language':'en-US,en;q=0.9'}
KEY=re.compile(r'dog|pet[s -]|pup|pooch|furry|leash|service animal|patio|beer garden|biergarten|outdoor|picnic|terrace|courtyard|fire ?pit|deck|kitchen|restaurant|menu|wood[- ]fired|pizza|brewpub|bistro|charcuterie|cheese|small plates|lunch|dinner|eatery|food|tours?\b|live music|live band|concert|entertainment|family|kid|children|all ages|21\+|adults only|minors|bed (and|&) breakfast|b&b|guest ?house|cottage|stay|lodging|\binn\b|accommodation|airbnb|vacation rental|wedding|private event|event space|venue|host your',re.I)
def get(u):
    try:
        r=requests.get(u,headers=H,timeout=14)
        if r.status_code==200 and 'html' in r.headers.get('content-type',''):return r.text[:800000],r.url
    except Exception:pass
    return '',u
def text(h):
    h=re.sub(r'(?is)<(script|style|noscript|svg)[^>]*>.*?</\1>',' ',h)
    h=html.unescape(re.sub(r'<[^>]+>',' ',h));return re.sub(r'\s+',' ',h)
def snips(t):
    out=[];last=-999
    for m in KEY.finditer(t):
        if m.start()<last:continue
        out.append(t[max(0,m.start()-60):m.end()+70]);last=m.end()+70
        if len(out)>=120:break
    return out
def work0(p):
    u=p['web'] if p['web'].startswith('http') else 'https://'+p['web']
    h,fu=get(u)
    if not h:h,fu=get(u.replace('https://','http://'))
    if not h:return {'id':p['id'],'ok':0}
    res={'id':p['id'],'ok':1,'s':snips(text(h))}
    host=urlparse(fu).netloc;links=[]
    for m in re.finditer(r'href=["\']([^"\'#]+)["\']',h):
        l=urljoin(fu,m.group(1))
        if urlparse(l).netloc==host and re.search(r'visit|about|faq|menu|food|taproom|tasting|tour|experience|plan',urlparse(l).path,re.I) and l not in links and l.rstrip('/')!=fu.rstrip('/') and not re.search(r'\.(pdf|jpg|png)$',l,re.I):links.append(l)
    links.sort(key=lambda l:0 if re.search(r'visit|faq',l,re.I) else 1)
    for l in links[:3]:
        h2,_=get(l)
        if h2:res['s']+=snips(text(h2))
    return res
def work(p):
    try:return work0(p)
    except Exception:return {'id':p['id'],'ok':0}
res=[]
with cf.ThreadPoolExecutor(64) as ex:
    for i,x in enumerate(ex.map(work,T)):
        res.append(x)
        if i%1000==0:json.dump(res,open('tagsraw.json','w'));print(i,flush=True)
json.dump(res,open('tagsraw.json','w'));print('done',len(res))
