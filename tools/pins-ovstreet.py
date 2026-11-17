import duckdb,json,time,math,os,re
exec(open('ovmatch2.py').read().split("idx=collections.defaultdict(list)")[0].replace("R=json.load(open('ovbox.json'))","R=[]"))
got={o[0] for o in json.load(open('ovmatch2.json'))}
A=[a for a in A if a['id'] not in got]
ORD={'first':'1st','second':'2nd','third':'3rd','fourth':'4th','fifth':'5th','sixth':'6th','seventh':'7th','eighth':'8th','ninth':'9th','tenth':'10th','eleventh':'11th','twelfth':'12th','thirteenth':'13th','fourteenth':'14th','fifteenth':'15th','sixteenth':'16th','seventeenth':'17th','eighteenth':'18th','nineteenth':'19th','twentieth':'20th'}
REV={v:k for k,v in ORD.items()}
FILES="["+",".join("'https://overturemaps-us-west-2.s3.amazonaws.com/"+k.strip()+"'" for k in open("addrkeys.txt") if k.strip().endswith(".parquet"))+"]"
con=duckdb.connect();con.execute("INSTALL httpfs;LOAD httpfs;SET threads=4;SET memory_limit='2500MB';SET enable_object_cache=true;")
GENW={'st','rd','ave','dr','hwy','blvd','ln','rte','ch','n','s','e','w','the','de','du','la','le','unit','suite','ste','rr','at','road','street','avenue','drive','highway','east','west','north','south','line','concession','county','regional','conc','cty','reg'}
out={}
print(len(A),flush=True)
for i,a in enumerate(A):
    m=re.match(r'\s*(\d+)[a-zA-Z]?\b[ ,\-]*(.*?),',a['addr']+',')
    if not m:continue
    words=[t for t in re.sub(r"[^a-z0-9 ]"," ",m.group(2).lower().replace("'","")).split() if t not in GENW]
    if not words:continue
    pats=set()
    for t in words:
        pats.add(t);pats.add(ORD.get(t,t));pats.add(REV.get(t,t))
    pats=[p for p in pats if len(p)>=2]
    cond=" or ".join("lower(street) like '%%%s%%'"%p.replace("'","") for p in pats)
    D=0.25
    q="select number,street,bbox.ymin,bbox.xmin from read_parquet(%s) where bbox.xmin between %f and %f and bbox.ymin between %f and %f and (%s)"%(FILES,a['lng']-D,a['lng']+D,a['lat']-D,a['lat']+D,cond)
    try:r=con.execute(q).fetchall()
    except Exception as e:print('ERR',a['name'],str(e)[:100],flush=True);continue
    out[a['id']]={'num':int(m.group(1)),'words':words,'pts':[[x[0],x[1],x[2],x[3]] for x in r]}
    if i%10==0:json.dump(out,open('ovstreet.json','w'));print(i,a['name'][:30],len(r),flush=True)
json.dump(out,open('ovstreet.json','w'));print('done',len(out),flush=True)
