import json,re,collections,sys
DN=['monday','tuesday','wednesday','thursday','friday','saturday','sunday']
DMAP={}
for i,d in enumerate(DN):
    for a in {d,d[:3],d+'s'}:DMAP[a]=i
DMAP.update({'tues':1,'thur':3,'thurs':3,'weds':2,'mo':0,'tu':1,'we':2,'th':3,'fr':4,'sa':5,'su':6})
D=r'(?:mondays?|tuesdays?|wednesdays?|thursdays?|fridays?|saturdays?|sundays?|mon|tues?|weds?|thurs?|thur?|fri|sat|sun)\.?'
ALL=r'(?:daily|every ?day|7 days(?: a week)?|seven days(?: a week)?|open daily)'
T=r'(?:\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?|noon|midnight)'
DAYS=r'(?P<days>'+ALL+r'|weekdays|weekends|'+D+r'(?:\s*(?:-|,|&|and|/|\+)\s*'+D+r')*)'
RX=re.compile(DAYS+r'\s*[:|@,;\u2022\u00b7*]?\s*(?:from\s+|open\s+)?(?:(?P<closed>closed)|(?P<o>'+T+r')\s*-\s*(?P<c>'+T+r'))',re.I)
RX2=re.compile(r'(?P<o>'+T+r')\s*-\s*(?P<c>'+T+r')\s*[,|]?\s*(?:on\s+|every\s+)?'+DAYS,re.I)
BAD=re.compile(r'currently closed|closed (for the season|until)|reopen|re-open|happy hour|kitchen|brunch|trivia|live music|tours? (times|at|run|daily)|pick-?up|curbside|office|food truck|yoga|bingo|karaoke|summer|winter|spring|fall hours|autumn|season|january|february|march|april|\bmay\b|june|july|august|september|october|november|december|\b(jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b\.?|appointment|reservation only|holiday|memorial|labor day|thanksgiving|christmas|temporarily|last (call|pour|seating)|delivery|restaurant hours|bottle shop|retail|store hours|distillery tours|coffee|breakfast|lunch|dinner|class|event|food (service )?hours|kitchen hours|\bmusic\b',re.I)
def norm(s):
    s=s.lower().replace('–','-').replace('—','-').replace('‒','-').replace('‐','-').replace('‑','-').replace('−','-').replace('~','-')
    s=re.sub(r'\b(to|thru|through|until|till|til)\b','-',s)
    s=re.sub(r'\s*-\s*','-',s);s=re.sub(r'[ \t]+',' ',s)
    s=re.sub(r'('+D+r'|'+ALL+r')-(?=\d|noon|closed)',r'\1: ',s)
    return s
def ptime(t,hint=None):
    t=t.strip().lower().replace('.','')
    if t=='noon':return 12*60,True
    if t=='midnight':return 24*60,True
    m=re.match(r'(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$',t)
    if not m:return None,False
    h=int(m.group(1));mi=int(m.group(2) or 0);ap=m.group(3)
    if h>24 or mi>59:return None,False
    if ap:
        if h>12 or h==0:return None,False
        if ap=='am':h=0 if h==12 else h
        else:h=h if h==12 else h+12
        return h*60+mi,True
    if h>12:return h*60+mi,True   # 24h clock
    return (h,mi),False
def prange(o,c):
    a,ak=ptime(o);b,bk=ptime(c)
    if a is None or b is None:return None
    if ak and bk:pass
    elif bk and not ak:
        h,mi=a;cands=[x for x in ((h%12)*60+mi,(h%12+12)*60+mi) if x<b]
        if not cands:return None
        a=max(cands) if b-max(cands)>=60 else min(cands)
        if b-a>14*60:return None
    elif ak and not bk:
        h,mi=b;cands=[x for x in ((h%12)*60+mi,(h%12+12)*60+mi,24*60 if h==12 else -1) if x>a]
        if not cands:return None
        b=min(cands)
    else:
        (h1,m1),(h2,m2)=a,b
        if not((7<=h1<=12 or 1<=h1<=5) and 3<=h2<=12):return None
        a=(h1*60+m1) if 7<=h1<=12 else (h1+12)*60+m1
        b=(h2+12)*60+m2 if h2<12 else 24*60
    if b<=a:
        if b<=3*60:b+=24*60
        else:return None
    if not(6*60<=a<=22*60) or b-a<60 or b-a>18*60 or b>27*60:return None
    return a,b
def pdays(s):
    s=s.strip().lower()
    if re.fullmatch(ALL,s):return list(range(7))
    if s=='weekdays':return [0,1,2,3,4]
    if s=='weekends':return [5,6]
    toks=re.findall(r'[a-z]+|-|,|&|/|\+',s);out=[];i=0;prev=None;rng=False
    for t in toks:
        if t in('-',):rng=True;continue
        if t in(',','&','/','+','and'):continue
        k=DMAP.get(t.rstrip('.'))
        if k is None:return None
        if rng and prev is not None:
            j=prev
            while j!=k:
                j=(j+1)%7;out.append(j)
            rng=False
        else:out.append(k)
        prev=k
    return out or None
HARD=re.compile(r'currently closed|closed (for the season|until)|reopen|re-open|temporarily|appointment|reservation only|anytown|123 main',re.I)
SEASONAL=re.compile(r'summer|winter|spring|fall hours|autumn|season|january|february|march|april|\bmay\b|june|july|august|september|october|november|december|\b(jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b\.?',re.I)
FIRSTDAY=re.compile(r'\b(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(day|sday|nesday|rsday|urday)?s?\b|\bdaily\b|\bevery ?day\b|\b7 days\b|\bweekdays\b|\bweekends\b',re.I)
def trim(w):
    """keep only the opening-hours part of a block of text: a schedule that is headed by kitchen, brunch, seasonal or
    other side hours is turned away; anything after such a word (a food-truck or brunch schedule that follows) is cut off"""
    if HARD.search(w):return None
    d=FIRSTDAY.search(w)
    if not d:return None
    pre=w[max(0,d.start()-40):d.start()]
    if BAD.search(pre) or SEASONAL.search(w[:d.start()]):return None
    cut=BAD.search(w,d.end())
    return w[:cut.start()] if cut else w
def pwin(w):
    w=trim(w)
    if not w:return None
    s=norm(w);res={};n=0
    ms=list(RX.finditer(s));m2=list(RX2.finditer(s))
    fd=re.search(DAYS,s,re.I)
    tf=fd and re.search(T+r'-'+T+r'\s*[,|]?\s*(?:on\s+|every\s+)?$',s[:fd.start()],re.I)
    if tf or not ms:ms=m2
    for m in ms:
        ds=pdays(m.group('days'))
        if not ds:return None
        if m.groupdict().get('closed'):v='closed'
        else:
            v=prange(m.group('o'),m.group('c'))
            if not v:return None
            n+=1
        for d in ds:
            if d in res and res[d]!=v:return None
            res[d]=v
    if n==0 or len(res)<2:return None
    if all(v=='closed' or v[1]-v[0]<120 for v in res.values()):return None
    return tuple(res.get(i,'closed') for i in range(7))
def pld(objs):
    out=[]
    def walk(o):
        if isinstance(o,dict):
            if 'openingHoursSpecification' in o:
                sp=o['openingHoursSpecification'];sp=sp if isinstance(sp,list) else [sp];res={};ok=True
                for x in sp:
                    if not isinstance(x,dict) or x.get('validFrom') or x.get('validThrough'):continue
                    dw=x.get('dayOfWeek');dw=dw if isinstance(dw,list) else [dw]
                    o1,c1=str(x.get('opens') or ''),str(x.get('closes') or '')
                    for d in dw:
                        k=DMAP.get(str(d).split('/')[-1].lower())
                        if k is None:ok=False;continue
                        m1=re.match(r'(\d{1,2}):(\d{2})',o1);m2=re.match(r'(\d{1,2}):(\d{2})',c1)
                        if not m1 or not m2:ok=False;continue
                        a=int(m1.group(1))*60+int(m1.group(2));b=int(m2.group(1))*60+int(m2.group(2))
                        if a==b==0:v='closed'
                        else:
                            if b<=a:b+=24*60 if b<=3*60 else 0
                            if not(6*60<=a<=22*60) or b-a<60 or b-a>18*60:ok=False;continue
                            v=(a,b)
                        if k in res and res[k]!=v:ok=False
                        res[k]=v
                if ok and any(v!='closed' for v in res.values()):out.append(tuple(res.get(i,'closed') for i in range(7)))
            oh=o.get('openingHours')
            if oh:
                oh=oh if isinstance(oh,list) else [oh];res={};ok=True
                for s in oh:
                    for part in re.split(r'[;,](?=\s*[A-Za-z])',str(s)):
                        m=re.match(r'\s*([A-Za-z,\- ]+?)\s+(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})\s*$',part)
                        if not m:ok=False;continue
                        ds=pdays(m.group(1).lower().replace(' ',''))
                        a=[int(x) for x in m.group(2).split(':')];b=[int(x) for x in m.group(3).split(':')];a=a[0]*60+a[1];b=b[0]*60+b[1]
                        if b<=a and b<=180:b+=1440
                        if not ds or not(360<=a<=1320) or b-a<60 or b-a>1080:ok=False;continue
                        for d in ds:
                            if d in res and res[d]!=(a,b):ok=False
                            res[d]=(a,b)
                if ok and res:out.append(tuple(res.get(i,'closed') for i in range(7)))
            for v in o.values():walk(v)
        elif isinstance(o,list):
            for v in o:walk(v)
    walk(objs);return out
def fmt(v):
    def f(m):
        m%=1440;h=m//60;mi=m%60;return '%d:%02d %s'%((h%12) or 12,mi,'AM' if h<12 else 'PM')
    return 'Closed' if v=='closed' else f(v[0])+' – '+f(v[1])
if __name__=='__main__':
    R=json.load(open('hoursraw.json'));TD={p['id']:p for p in json.load(open('hourstodo.json'))}
    out={};st=collections.Counter()
    from urllib.parse import urlparse
    host=lambda u:urlparse(u if u.startswith('http') else 'https://'+u).netloc.lower().replace('www.','')
    allp=json.load(open('allhosts.json'));HOSTN=collections.Counter(host(u) for u in allp)
    LDN=collections.Counter(x for r in R if r.get('ok') for x in set(pld(r.get('ld') or [])))
    for r in R:
        if not r.get('ok'):st['nosite']+=1;continue
        if HOSTN[host(TD[r['id']]['web'])]>1:st['chain']+=1;continue
        c=[('ld',x) for x in pld(r.get('ld') or [])]
        for src,w in r.get('w') or []:
            if re.search(r'locations',src,re.I):continue
            x=pwin(w)
            if x:c.append((src,x))
        if not c:st['none' if not r.get('w') else 'unparsed']+=1;continue
        kinds=set(x for _,x in c)
        # hours given only in the page's structured data: kept unless the page talks of appointments, or the same
        # hours appear on several unrelated sites (a website template's sample hours)
        if all(k=='ld' for k,_ in c) and (r.get('w') or []):
            if any(re.search(r'appointment|reservation only|temporarily closed',w,re.I) for _,w in r['w']) or LDN[c[0][1]]>3:st['ld_unconfirmed']+=1;continue
            st['ld_only']+=1
        if len(kinds)>1:
            # several different schedules: take the one most of the site's pages agree on, else the one on an hours page
            cnt=collections.Counter(x for _,x in c).most_common()
            hp=set(x for src,x in c if re.search(r'hours',src,re.I))
            if cnt[0][1]>cnt[1][1]:kinds={cnt[0][0]};st['conflict_majority']+=1
            elif len(hp)==1:kinds=hp;st['conflict_hourspage']+=1
            else:st['conflict']+=1;continue
        h=kinds.pop()
        if all(v!='closed' and v==(0,1440) for v in h):st['24h']+=1;continue
        out[r['id']]=[DN[i].capitalize()+': '+fmt(h[i]) for i in range(7)];st['ok_ld' if c[0][0]=='ld' else 'ok_text']+=1
    print(len(R),dict(st));json.dump(out,open('hoursfound.json','w'))
    import random;random.seed(int(sys.argv[1]) if len(sys.argv)>1 else 1)
    Rm={r['id']:r for r in R}
    for i in random.sample(list(out),min(7,len(out))):
        print('\n##',TD[i]['name'],TD[i]['web'],'\n  ',' | '.join(s.split(': ',1)[1] for s in out[i]));
        for src,w in (Rm[i].get('w') or [])[:2]:print('   src[%s]:'%src,re.sub(r'\s+',' ',w)[:260])
