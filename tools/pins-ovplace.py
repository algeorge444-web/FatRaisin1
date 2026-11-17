import duckdb,json,re,math,unicodedata,time
A={a['id']:a for a in json.load(open('approx3.json'))};fixed={x[0] for x in json.load(open('pins3.json'))}
L=[a for i,a in A.items() if i not in fixed]
GEN=set('the winery wineries estate estates vineyard vineyards cellars cellar wine wines brewing brewery company co inc ltd cidery cider distillery distilling spirits craft beer and of family farm tasting room house'.split())
def fold(s):return unicodedata.normalize('NFD',s).encode('ascii','ignore').decode().lower()
def key(n):
    w=[t for t in re.sub(r'[^a-z0-9 ]',' ',fold(n)).split() if t not in GEN and len(t)>=3]
    return max(w,key=len) if w else None
def km(a,b,c,d):
    x=(d-b)*math.pi/180*math.cos(a*math.pi/180);y=(c-a)*math.pi/180;return math.hypot(x,y)*6371
FILES="["+",".join("'https://overturemaps-us-west-2.s3.amazonaws.com/"+k.strip()+"'" for k in open("placekeys.txt") if k.strip().endswith(".parquet"))+"]"
con=duckdb.connect();con.execute("INSTALL httpfs;LOAD httpfs;SET threads=4;SET memory_limit='2500MB';SET enable_object_cache=true;")
cells={}
for a in L:
    if key(a['name']):cells.setdefault((math.floor(a['lat']/0.6),math.floor(a['lng']/0.6)),[]).append(a)
out=[]
for i,(c,G) in enumerate(cells.items()):
    la=[a['lat'] for a in G];lo=[a['lng'] for a in G];D=0.2
    cond=" or ".join("lower(names.primary) like '%%%s%%'"%key(a['name']) for a in G)
    q="select names.primary,bbox.ymin,bbox.xmin,addresses[1].freeform,confidence from read_parquet(%s) where bbox.xmin between %f and %f and bbox.ymin between %f and %f and (%s)"%(FILES,min(lo)-D,max(lo)+D,min(la)-D,max(la)+D,cond)
    try:rows=con.execute(q).fetchall()
    except Exception as e:print('ERR',str(e)[:120],flush=True);continue
    for a in G:
        k=key(a['name']);num=(re.match(r'\s*(?:\d+[A-Za-z]?-)?(\d+)',a['addr']) or [None,''])[1]
        best=None
        for nm,lat,lng,fa,conf in rows:
            if k not in fold(nm or ''):continue
            d=km(a['lat'],a['lng'],lat,lng)
            if d>20:continue
            sc=(3 if num and fa and re.match(r'\s*'+num+r'\b',fa) else 0)+(conf or 0)
            if not best or sc>best[0]:best=(sc,lat,lng,nm,fa,d)
        if best and best[0]>=3:out.append([a['id'],round(best[1],6),round(best[2],6),'place '+str(best[3])+' @ '+str(best[4]),round(best[5],1)])
    print(i+1,'/',len(cells),len(out),flush=True)
json.dump(out,open('ovplace.json','w'));print('found',len(out),'of',len(L))
for o in out[:20]:print(A[o[0]]['name'][:30],'|',A[o[0]]['addr'][:40],'=>',o[3][:70],o[4],'km')
