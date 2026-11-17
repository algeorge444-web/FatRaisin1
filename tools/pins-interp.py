import json,re,math,collections
S=json.load(open('ovstreet.json'));A={a['id']:a for a in json.load(open('approx3.json'))}
ORD={'first':'1st','second':'2nd','third':'3rd','fourth':'4th','fifth':'5th','sixth':'6th','seventh':'7th','eighth':'8th','ninth':'9th','tenth':'10th','eleventh':'11th','twelfth':'12th','thirteenth':'13th','fourteenth':'14th','fifteenth':'15th','sixteenth':'16th','seventeenth':'17th','eighteenth':'18th','nineteenth':'19th','twentieth':'20th'}
def km(a,b,c,d):
    x=(d-b)*math.pi/180*math.cos(a*math.pi/180);y=(c-a)*math.pi/180;return math.hypot(x,y)*6371
def norm(t):return ORD.get(t,t)
out=[];st=collections.Counter()
for pid,v in S.items():
    a=A[pid];want={norm(t) for t in v['words']}
    mm=re.match(r'\s*(?:\d+[A-Za-z]?-)?(\d+)',a['addr']);v['num']=int(mm.group(1)) if mm else v['num']
    pts=[]
    for num,street,lat,lng in v['pts']:
        toks={norm(t) for t in re.sub(r"[^a-z0-9 ]"," ",(street or '').lower()).split()}
        if not want<=toks:continue
        TY={'st','street','rd','road','ave','avenue','dr','drive','hwy','highway','blvd','ln','lane','crt','court','cres','pl','way','line','trl','pkwy'}
        CAN={'street':'st','road':'rd','avenue':'ave','drive':'dr','highway':'hwy','lane':'ln','court':'crt'}
        ta={CAN.get(x,x) for x in re.sub(r'[^a-z0-9 ]',' ',a['addr'].lower().split(',')[0]).split()}&set(CAN.values())|set();tb={CAN.get(x,x) for x in toks}&set(CAN.values())
        if ta and tb and not (ta&tb):continue
        m=re.match(r'(\d+)',str(num or ''))
        if not m:continue
        if km(a['lat'],a['lng'],lat,lng)>12:continue
        pts.append((int(m.group(1)),street,lat,lng))
    if not pts:st['no_street']+=1;continue
    # the most common exact street spelling (several streets can share words)
    dirw=re.search(r'\b(east|west|north|south|e|w|n|s)\b\s*,',a['addr'].lower())
    if dirw:
        d=dirw.group(1)[0];opp={'e':'w','w':'e','n':'s','s':'n'}[d]
        pts=[p for p in pts if not re.search(r'\b('+opp+r'|'+{'e':'west','w':'east','n':'south','s':'north'}[d]+r')\b',p[1].lower())]
        if not pts:st['wrong_direction']+=1;continue
    sc=collections.Counter(p[1] for p in pts);
    best=None
    for sname,_ in sc.most_common():
        P=sorted(p for p in pts if p[1]==sname)
        N=v['num'];lo=[p for p in P if p[0]<=N];hi=[p for p in P if p[0]>=N]
        same=[p for p in P if p[0]==N]
        if same:best=('exact',same[0][2],same[0][3],sname,0);break
        if lo and hi:
            l,h=lo[-1],hi[0]
            if h[0]-l[0]>600 or km(l[2],l[3],h[2],h[3])>4:continue
            f=(N-l[0])/(h[0]-l[0]);best=('between',l[2]+(h[2]-l[2])*f,l[3]+(h[3]-l[3])*f,sname,min(N-l[0],h[0]-N));break
        near=min(P,key=lambda p:abs(p[0]-N))
        if abs(near[0]-N)<=60 and not best:best=('nearby',near[2],near[3],sname,abs(near[0]-N))
    if not best:st['no_bracket']+=1;continue
    st[best[0]]+=1;out.append([pid,round(best[1],6),round(best[2],6),best[0]+' '+best[3],round(km(a['lat'],a['lng'],best[1],best[2]),1)])
print(len(S),dict(st));json.dump(out,open('interp.json','w'))
for o in out[:12]:print(A[o[0]]['name'][:28],'|',A[o[0]]['addr'][:45],'=>',o[3],o[4],'km')
