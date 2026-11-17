import json,re,csv,html,collections
R=json.load(open('shopraw.json'))
s=open('/home/claude/fatraisin1/index.html',encoding='utf8').read()
V=re.findall(r"\['([^']+)','(red|white|rose|other)'\]",re.search(r'var VARIETIES=(.*?\]\]);',s,re.S).group(1))
WINEW=re.compile(r"\b(wine|vin|red|white|ros[eé]|blend|icewine|ice wine|vidal|sparkling|brut|vqa|cuv[eé]e|reserve|late harvest|port|meritage|vintage|appassimento|fortified|dessert|750\s?ml|375\s?ml|200\s?ml)\b",re.I)
MERCH=re.compile(r"\b(magnet|jacket|towel|mitt+|glass(es|ware)?|gift ?card|pie|candle|soap|artwork|art|book|hat|cap|t-?shirt|bath|salts?|dishware|dishes|plates?|cutlery|napkins?|rack|racks|shelf|shelves|riedel|stemware|wings|shirt|hoodie|sweater|ornament|seasoning|jam|jelly|sauce|honey|lotion|oil|vinegar|tour|tasting experience|experience|membership|club|ticket|event|class|workshop|dinner|reservation|shipping|corkscrew|opener|tote|bag|apron|card|cards|lavender|soap|candy|chocolate|cheese|cracker|coffee|tea|mug|coaster|bottle stopper|stopper|decanter|aerator|puzzle|blanket|socks|keychain|sticker|gift box|gift set|giftbox|bundle|case of|package|pack|box|deposit|donation)\b",re.I)
def grapes(t):
    t=t.lower();g=[];seen=set()
    for v,c in V:
        i=t.find(v)
        if i>=0:g.append((i,v))
    out=[]
    for i,v in sorted(g):
        k=re.sub(r'[^a-z]','',v)
        if k in seen:continue
        seen.add(k);out.append(v.title())
    return ', '.join(out[:4])
def typ(t):
    t=t.lower()
    if re.search(r'ice ?wine|late harvest|vin de glace|dessert|port\b|fortified',t):return 'dessert'
    if re.search(r'sparkling|brut|bubbl|m[ée]thode|traditional method|cr[ée]mant|p[ée]t[- ]?nat|fizz',t):return 'sparkling'
    if re.search(r'ros[ée]',t):return 'rose'
    if re.search(r'\bred\b|rouge',t):return 'red'
    if re.search(r'\bwhite\b|blanc',t):return 'white'
    for v,c in V:
        if v in t:return c if c in('red','white') else ''
    return ''
rows=[];st=collections.Counter()
KIT=re.compile(r'kitz|vin bon|u-?vin|u-?brew|cellar solutions|grape juice|winexpert|yonge street winery|wine ?making|brew your own|ferment|stclair estate',re.I)
for v in R.values():
    w=v['w']
    if KIT.search(w['name']):st['kitshop']+=len(v['items']);continue
    for it in v['items']:
        nm=html.unescape(it.get('name') or '').strip();desc=re.sub(r'\s+',' ',html.unescape(it.get('desc') or '')).strip();kind=it.get('kind') or ''
        text=nm+' '+kind+' '+desc[:400]
        if not nm or len(nm)<3:st['noname']+=1;continue
        if MERCH.search(nm+' '+kind):st['merch']+=1;continue
        if re.search(r'\b(cider|cidre|perry|beer|ale|lager|spirits?|vodka|gin|whisky|whiskey|rum|liqueur|brandy|mead)\b',nm+' '+kind,re.I):st['notwine']+=1;continue
        TASTE=re.search(r'\b(aromas?|palate|nose|finish|tannins?|acidity|bouquet|on the nose|notes of|pairs? (well )?with|serve chilled|cellar|vintage|barrel|oak)\b',desc[:600],re.I)
        if not (WINEW.search(nm+' '+kind) or grapes(nm) or (WINEW.search(desc[:300]) and grapes(desc[:300])) or (TASTE and (WINEW.search(desc[:600]) or grapes(desc[:600])))):st['unsure']+=1;continue
        if re.search(r'\bshop\b|—|\s[-–]\s.*(winery|wines|vineyards?)$',nm,re.I) or re.match(r'^(red|white|ros[eé]|sparkling|dessert|all) wines?\b',nm,re.I):st['page']+=1;continue
        if len(desc)<40 and not grapes(nm):st['page']+=1;continue
        vint=(re.search(r'\b(19[6-9]\d|20[0-2]\d)\b',nm) or [None,''])
        vint=vint[1] if vint else ''
        name=re.sub(r'\b(19[6-9]\d|20[0-2]\d)\b','',nm)
        name=re.sub(r'\b\d{3,4}\s?ml\b','',name,flags=re.I)
        p=re.escape(w['name'].split(' ')[0])
        name=re.sub(r'\s+',' ',name).strip(' -|,')
        rows.append({'Name':name,'Producer':w['name'],'Vintage':vint,'Type':typ(text),'Grapes':grapes(nm+' '+desc[:500]),'Region':'Ontario' if w['prov']=='ON' else 'British Columbia',
                     'Barcode':it.get('barcode') or '','Link':it.get('link') or '','Image':it.get('img') or '','Description':desc[:1500]})
        st['wine']+=1
for r in json.load(open('c7rows.json')):
    if MERCH.search(r['Name']) or re.search(r'\b(gift|pack|bundle|case|collection|club|sampler|trio|duo|flight)\b',r['Name'],re.I):st['merch']+=1;continue
    if not r['Grapes']:r['Grapes']=grapes(r['Name']+' '+r['Description'][:500])
    if not r['Type']:r['Type']=typ(r['Name']+' '+r['Description'][:300])
    r.setdefault('ABV','');rows.append(r);st['c7']+=1
for r in rows:r.setdefault('ABV','')
# dedupe by producer+name+vintage
seen=set();out=[]
for r in rows:
    k=(r['Producer'].lower(),r['Name'].lower(),r['Vintage'])
    if k in seen:continue
    seen.add(k);out.append(r)
print(dict(st),'unique',len(out),'with notes',sum(1 for r in out if len(r['Description'])>=40),'wineries',len({r['Producer'] for r in out}))
with open('/mnt/user-data/outputs/winery-shop-wines-ON-BC.csv','w',newline='',encoding='utf-8-sig') as f:
    wr=csv.DictWriter(f,fieldnames=['Name','Producer','Vintage','Type','Grapes','Region','Barcode','ABV','Link','Image','Description']);wr.writeheader();wr.writerows(out)
import random;random.seed(4)
for r in random.sample(out,15):print(r['Producer'][:22],'|',r['Name'][:45],'|',r['Vintage'],r['Type'],'|',r['Grapes'][:30],'|',r['Description'][:70])
