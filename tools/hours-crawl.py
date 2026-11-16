import warnings;warnings.filterwarnings('ignore')
import json,re,html,concurrent.futures as cf,requests
from urllib.parse import urljoin,urlparse
T=json.load(open('hourstodo.json'))
H={'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36','Accept':'text/html,*/*','Accept-Language':'en-US,en;q=0.9'}
DAY=re.compile(r'\b(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(day|sday|nesday|rsday|urday)?s?\b|\bdaily\b|\bevery day\b|\b7 days\b|\bweekdays\b|\bweekends\b',re.I)
def get(u):
    try:
        r=requests.get(u,headers=H,timeout=14)
        if r.status_code==200 and 'html' in r.headers.get('content-type',''):return r.text[:800000],r.url
    except Exception:pass
    return '',u
def text(h):
    h=re.sub(r'(?is)<(script|style|noscript|svg)[^>]*>.*?</\1>',' ',h)
    h=re.sub(r'(?i)<(br|/p|/div|/li|/tr|/h\d|/dd|/dt|/td|/th|/span)[^>]*>','\n',h)
    h=html.unescape(re.sub(r'<[^>]+>',' ',h))
    h=re.sub(r'[ \t\xa0​]+',' ',h);return re.sub(r'\s*\n\s*','\n',h)
def windows(t):
    pos=[m.start() for m in DAY.finditer(t)];out=[];last=-9999
    for i,p in enumerate(pos):
        if p<last:continue
        j=i
        while j+1<len(pos) and pos[j+1]-pos[j]<160:j+=1
        n=j-i+1;seg=t[max(0,p-80):pos[j]+140]
        if (n>=2 or re.search(r'daily|every day|7 days',t[p:p+12],re.I)) and re.search(r'\d',seg) :
            out.append(seg[:1200]);last=pos[j]+140
        if len(out)>=4:break
    return out
def ld(h):
    out=[]
    for m in re.finditer(r'(?is)<script[^>]+application/ld\+json[^>]*>(.*?)</script>',h):
        s=m.group(1)
        if 'openingHours' in s or 'OpeningHours' in s:
            try:out.append(json.loads(s.strip()))
            except Exception:
                try:out.append(json.loads(re.sub(r'[\x00-\x1f]',' ',s)))
                except Exception:pass
    return out
def work0(p):
    u=p['web'] if p['web'].startswith('http') else 'https://'+p['web']
    h,fu=get(u)
    if not h:h,fu=get(u.replace('https://','http://'))
    if not h:return {'id':p['id'],'ok':0}
    res={'id':p['id'],'ok':1,'ld':ld(h),'w':[['home',x] for x in windows(text(h))]}
    host=urlparse(fu).netloc
    links=[]
    for m in re.finditer(r'href=["\']([^"\'#]+)["\']',h):
        l=urljoin(fu,m.group(1))
        if urlparse(l).netloc==host and re.search(r'hours|visit|contact|location|taproom|tap-room|tasting|find-us|about',urlparse(l).path,re.I) and l not in links and l.rstrip('/')!=fu.rstrip('/'):links.append(l)
    links.sort(key=lambda l:0 if re.search(r'hours',l,re.I) else 1 if re.search(r'visit|contact|location',l,re.I) else 2)
    for l in links[:3]:
        h2,_=get(l)
        if h2:
            res['ld']+=ld(h2);res['w']+=[[urlparse(l).path[:40],x] for x in windows(text(h2))]
    return res
def work(p):
    try:return work0(p)
    except Exception:return {'id':p['id'],'ok':0}
res=[]
with cf.ThreadPoolExecutor(64) as ex:
    for i,x in enumerate(ex.map(work,T)):
        res.append(x)
        if i%500==0:json.dump(res,open('hoursraw.json','w'));print(i,sum(1 for r in res if r.get('ld')),sum(1 for r in res if r.get('w')),flush=True)
json.dump(res,open('hoursraw.json','w'));print('done',len(res))
