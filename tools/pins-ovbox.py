import duckdb,json,time,math,os
A=json.load(open('approx3.json'));done={r[0] for r in json.load(open('census2.json'))};A=[a for a in A if a['id'] not in done]
FILES="["+",".join("'https://overturemaps-us-west-2.s3.amazonaws.com/"+k.strip()+"'" for k in open("addrkeys.txt") if k.strip().endswith(".parquet"))+"]"
con=duckdb.connect();con.execute("INSTALL httpfs;LOAD httpfs;SET threads=4;SET memory_limit='2500MB';SET enable_object_cache=true;")
cells={}
for a in A:cells.setdefault((math.floor(a['lat']/0.6),math.floor(a['lng']/0.6)),[]).append(a)
rows=json.load(open('ovbox.json')) if os.path.exists('ovbox.json') else []
doneCells=set(json.load(open('ovcells.json'))) if os.path.exists('ovcells.json') else set()
print(len(A),'places',len(cells),'cells',flush=True)
nums=lambda L:",".join("'%s'"%n for n in {(__import__('re').match(r'\s*(\d+)',a['addr']) or [None,'x'])[1] for a in L})
for i,(k,L) in enumerate(sorted(cells.items())):
    key='%d,%d'%k
    if key in doneCells:continue
    la=[a['lat'] for a in L];lo=[a['lng'] for a in L];D=0.3
    q="select country,postcode,number,street,unit,bbox.ymin,bbox.xmin from read_parquet(%s) where bbox.xmin between %f and %f and bbox.ymin between %f and %f and number in (%s)"%(FILES,min(lo)-D,max(lo)+D,min(la)-D,max(la)+D,nums(L))
    t=time.time()
    try:r=con.execute(q).fetchall()
    except Exception as e:print('cell',key,'ERR',str(e)[:150],flush=True);continue
    rows+=[list(x) for x in r];doneCells.add(key)
    json.dump(rows,open('ovbox.json','w'));json.dump(sorted(doneCells),open('ovcells.json','w'))
    print(i+1,'/',len(cells),key,len(L),'places',len(r),'rows',int(time.time()-t),'s',flush=True)
print('rows',len(rows),flush=True)
