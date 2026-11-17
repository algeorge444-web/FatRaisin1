import json,re,collections,math
A=json.load(open('approx3.json'));R=json.load(open('ovbox.json'))
import os
done={r[0] for r in json.load(open('census2.json'))}
A=[a for a in A if a['id'] not in done]
idx=collections.defaultdict(list)
for c,pc,num,street,unit,lat,lng in R:
    if num is None or lat is None:continue
    idx[(c,str(num).strip().lower())].append((street or '',lat,lng))
ORD={'first':'1st','second':'2nd','third':'3rd','fourth':'4th','fifth':'5th','sixth':'6th','seventh':'7th','eighth':'8th','ninth':'9th','tenth':'10th','eleventh':'11th','twelfth':'12th','thirteenth':'13th','fourteenth':'14th','fifteenth':'15th','sixteenth':'16th'}
AB={'street':'st','road':'rd','avenue':'ave','drive':'dr','highway':'hwy','boulevard':'blvd','lane':'ln','line':'line','concession':'conc','route':'rte','rang':'rang','chemin':'ch','county':'cty','regional':'reg','sideroad':'sdrd','side':'side','north':'n','south':'s','east':'e','west':'w','saint':'st','ste':'st','trail':'trl','court':'crt','crescent':'cres','parkway':'pkwy','place':'pl'}
def toks(s):
    s=re.sub(r"[^a-z0-9 ]"," ",s.lower().replace("'",""));return [AB.get(ORD.get(t,t),ORD.get(t,t)) for t in s.split()]
GEN={'st','rd','ave','dr','hwy','blvd','ln','line','rte','ch','cty','reg','n','s','e','w','trl','crt','cres','pkwy','pl','conc','rang','the','de','du','la','le','unit','suite','ste','rr'}
def km(a,b,c,d):
    x=(d-b)*math.pi/180*math.cos(a*math.pi/180);y=(c-a)*math.pi/180;return math.hypot(x,y)*6371
out=[];st=collections.Counter()
for a in A:
    m=re.match(r'\s*(?:\d+[A-Za-z]?-)?(\d+)[a-zA-Z]?\b[ ,\-]*(.*?),',a['addr']+',')
    if not m:st['nonum']+=1;continue
    num,street=m.group(1),m.group(2)
    c=[x for x in idx.get((a['cc'],num),[]) if km(a['lat'],a['lng'],x[1],x[2])<30]
    if not c:st['no_number_nearby']+=1;continue
    want=[t for t in toks(street) if t not in GEN]
    best=None
    for s,lat,lng in c:
        have=set(toks(s))
        sc=sum(1 for t in want if t in have)
        if want and sc<len(want):continue
        TY={'st','rd','ave','dr','hwy','blvd','ln','crt','cres','pl','way','line','trl','pkwy','conc'}
        ta=set(toks(street))&TY;tb=have&TY
        if ta and tb and not (ta&tb):continue
        if km(a['lat'],a['lng'],lat,lng)>15:continue
        d=km(a['lat'],a['lng'],lat,lng)
        if not best or sc>best[0] or (sc==best[0] and d<best[4]):best=(sc,lat,lng,s,d)
    if not best:
        if len({(round(x[1],4),round(x[2],4)) for x in c})==1 and not want:best=(0,c[0][1],c[0][2],c[0][0],0)
        else:st['street_mismatch']+=1;continue
    out.append([a['id'],round(best[1],6),round(best[2],6),best[3],round(km(a['lat'],a['lng'],best[1],best[2]),1)]);st['ok_'+a['cc']]+=1
print(len(A),dict(st));json.dump(out,open('ovmatch2.json','w'))
import statistics;print('moved km median',statistics.median(o[4] for o in out),'>40km',[(o[3],o[4]) for o in out if o[4]>40][:6])
T={a['id']:a for a in A}
for o in out[:6]+[o for o in out if T[o[0]]['name'] in('Rockway Vineyards','Polonée Distillery','Hernder on 4th')]:print(T[o[0]]['name'],'|',T[o[0]]['addr'],'=>',o[3],o[1],o[2],o[4],'km')
