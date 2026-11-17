import json,requests,re,html,concurrent.futures as cf,warnings;warnings.filterwarnings('ignore')
G=json.load(open('c7tenants.json'))
def strip(h):return re.sub(r'\s+',' ',html.unescape(re.sub(r'<[^>]+>',' ',h or ''))).strip()
def pull(x):
    w,t=x;out=[]
    for page in range(1,15):
        try:r=requests.get('https://api.commerce7.com/v1/product/for-web?page=%d&limit=50'%page,headers={'tenant':t},timeout=25).json()
        except Exception:break
        ps=r.get('products') or []
        out+=ps
        if len(ps)<50:break
    return w,t,out
with cf.ThreadPoolExecutor(10) as ex:res=list(ex.map(pull,G))
rows=[]
for w,t,ps in res:
    site=(w['web'] if w['web'].startswith('http') else 'https://'+w['web']).rstrip('/')
    for p in ps:
        if (p.get('type') or '')!='Wine':continue
        wi=p.get('wine') or {};v=(p.get('variants') or [{}])[0]
        title=p.get('title') or ''
        vint=str(wi.get('vintage') or '') or ((re.search(r'\b(19[6-9]\d|20[0-2]\d)\b',title) or [None,''])[1] if re.search(r'\b(19[6-9]\d|20[0-2]\d)\b',title) else '')
        name=re.sub(r'\s+',' ',re.sub(r'\b(19[6-9]\d|20[0-2]\d)\b','',title).replace('|',' ')).strip(' -,')
        typ={'Red':'red','White':'white','Rose':'rose','Rosé':'rose','Sparkling':'sparkling','Dessert':'dessert','Ice Wine':'dessert','Icewine':'dessert','Fortified':'dessert'}.get(wi.get('type') or '','')
        desc=strip(p.get('content')) or strip(p.get('teaser'))
        upc=re.sub(r'\D','',v.get('upcCode') or '')
        rows.append({'Name':name,'Producer':w['name'],'Vintage':vint,'Type':typ,'Grapes':wi.get('varietal') or '','Region':wi.get('appellation') or wi.get('region') or ('Ontario' if w['prov']=='ON' else 'British Columbia'),
          'Barcode':upc if 8<=len(upc)<=14 else '','ABV':v.get('alcoholPercentage') or '','Link':site+'/product/'+(p.get('slug') or ''),'Image':p.get('image') or '','Description':desc[:1500]})
print('wineries',len(res),'with wines',sum(1 for r in res if r[2]),'wines',len(rows),'barcodes',sum(1 for r in rows if r['Barcode']),'notes',sum(1 for r in rows if len(r['Description'])>=40))
json.dump(rows,open('c7rows.json','w'))
