import csv,json,re,unicodedata
s=open('/home/claude/fatraisin1/index.html',encoding='utf8').read()
V=re.findall(r"\['([^']+)','(?:red|white|rose|other)'\]",re.search(r'var VARIETIES=(.*?\]\]);',s,re.S).group(1));V=[[x] for x in V]
GR=sorted({v[0] for v in V},key=len,reverse=True)
APP=r"\b(margaux|pauillac|saint[- ]?julien|st[- ]?julien|saint[- ]?emilion|st[- ]?emilion|pomerol|medoc|haut[- ]medoc|graves|pessac|sauternes|bordeaux|bourgogne|burgundy|chablis|meursault|beaune|pommard|volnay|nuits|gevrey|vosne|chambolle|puligny|chassagne|montrachet|macon|pouilly|sancerre|vouvray|muscadet|beaujolais|morgon|fleurie|brouilly|cotes du rhone|cotes-du-rhone|chateauneuf|gigondas|vacqueyras|crozes|hermitage|cote rotie|condrieu|languedoc|minervois|corbieres|provence|alsace|champagne|cremant|rioja|ribera|priorat|rueda|cava|chianti|brunello|montalcino|montepulciano|barolo|barbaresco|valpolicella|amarone|ripasso|soave|prosecco|asti|moscato|lambrusco|primitivo|nero d.avola|douro|porto|port|vinho verde|mosel|rheingau|tokaji|napa|sonoma|okanagan|niagara|marlborough|barossa|mclaren|coonawarra|mendoza|maipo|st estephe|saint estephe|bolgheri|moulis|fronsac|barsac|listrac|lalande|entre deux mers|cotes de bourg|blaye|castillon|ermitage|carmenere|bierzo|montsant|valdepenas|la mancha|cotes de gascogne|vacqueyras|lirac|tavel|bandol|chinon|bourgueil|saumur|anjou|touraine|cotes du roussillon|faugeres|pic st loup|saint chinian|st chinian|valpolicella classico|langhe|roero|dolcetto|barbera|gavi|etna|taurasi|aglianico|vermentino|morellino|maremma|carignano|cannonau|navarra|toscana|tuscany|sicilia|sicily|puglia|veneto|piemonte|piedmont|abruzzo|campania|sardegna|umbria|marche|trentino|alto adige|friuli|lazio|calabria|california|washington|oregon|columbia valley|paso robles|central coast|lodi|south australia|western australia|victoria|hawkes bay|central otago|casablanca|rapel|uco valley|salta|western cape|swartland|alentejo|dao|bairrada|catalunya|penedes|jumilla|toro|rias baixas|galicia|pays d.oc|vin de france|gascogne|cahors|bergerac|jura|savoie|loire|rhone|similkameen|naramata|golden mile|oliver|osoyoos|kelowna|vancouver island|fraser valley|colchagua|stellenbosch|bin \d+|ice ?wine|icewine|rose|rosé|sparkling|red blend|white blend|red|white|blanc|rouge|tinto|blanco|brut|cuvee|cuvée|reserve|reserva|riserva|crianza|gran reserva|estate|vintage)\b"
def tc(x):
    x=x.lower()
    x=re.sub(r"\b([a-z])",lambda m:m.group(1).upper(),x)
    x=re.sub(r"\b(De|Du|Des|La|Le|Les|Di|Del|Della|Da|Dos|Y|And|Of|The|En|Et|Sur|Am|Von|Van)\b",lambda m:m.group(1).lower(),x)
    x=re.sub(r"(\w)'(S)\b",lambda m:m.group(1)+"'s",x)
    x=re.sub(r"\b(Ii|Iii|Iv|Vqa|Doc|Docg|Aoc|Igt|Bc|Usa|Ipa|Gsm|Xo|Vsop)\b",lambda m:m.group(1).upper(),x)
    return x[:1].upper()+x[1:]
places=json.load(open('/home/claude/chk/hosts.json')) if False else None
import subprocess
names=json.loads(subprocess.check_output(['node','-e',"const w=require('/home/claude/chk/load.js');console.log(JSON.stringify([...w.FR_DATA.CA,...w.FR_DATA.US].filter(r=>r[9]=='winery').map(r=>r[0])))"]))
def nk(x):return re.sub(r'[^a-z0-9 ]','',unicodedata.normalize('NFD',x).encode('ascii','ignore').decode().lower()).replace('  ',' ').strip()
GEN=re.compile(r'\b(winery|wines?|estate|estates|vineyards?|cellars?|family|company|co)\b')
pk=set()
for n in names:
    k=GEN.sub('',nk(n)).strip()
    if len(k)>=4:pk.add(re.sub(r'\s+',' ',k))
def isProducer(a):
    k=re.sub(r'\s+',' ',GEN.sub('',nk(a))).strip()
    return k in pk
TYPE={'Red':'red','White':'white','Rose':'rose','Rosé':'rose','Sparkling':'sparkling','Champagne':'sparkling','Ice':'dessert','Dessert':'dessert','Fortified':'dessert','Port':'dessert','Sake':''}
out={};st={'skip':0,'ok':0}
for r in csv.DictReader(open('bcl.csv',encoding='utf-8-sig',errors='replace')):
    if r['ITEM_CATEGORY_NAME']!='Wine':continue
    upc=re.sub(r'\D','',r['PRODUCT_BASE_UPC_NO'] or '').lstrip('0')
    if len(upc)<7:st['skip']+=1;continue
    ln=r['PRODUCT_LONG_NAME'].strip()
    vint=''
    m=re.search(r'\b(19[5-9]\d|20[0-4]\d)\b',ln)
    if m:vint=m.group(1);ln=(ln[:m.start()]+ln[m.end():])
    ln=re.sub(r'\b\d+(\.\d+)?\s?(L|ML|CL)\b','',ln,flags=re.I)
    ln=re.sub(r'\s+',' ',ln).strip(' -')
    parts=re.split(r'\s*-\s+|\s+-\s*',ln,maxsplit=1)
    name=ln;prod=''
    if len(parts)==2:
        a,b=parts
        al=a.lower()
        bl=b.lower();MK=r'\b(domaine|chateau|ch\.|maison|bodegas?|tenuta|cantina|weingut|clos|estates?|winery|vineyards?|cellars?|family|wines)\b'
        if isProducer(a):prod,name=a,b
        elif any(g in al for g in GR) or re.search(APP,al):name=b+' '+a   # "SHIRAZ - PENFOLDS GRANGE" -> "Penfolds Grange Shiraz"
        elif (any(g in bl for g in GR) or re.search(APP,bl)) and not re.search(MK,bl):prod,name=a,b   # "COPPER MOON - SMOOTH RED"
        elif re.search(MK,bl) and not re.search(MK,al):name=b+' '+a   # "FIXIN LES CRAIS - DOMAINE DENIS BERTHAUT"
        else:name=a+' '+b      # not sure which part is the producer: keep both in the name
    cls=r['ITEM_CLASS_NAME'];t=''
    for k,v in TYPE.items():
        if k.lower() in cls.lower():t=v;break
    ctry=tc(r['PRODUCT_COUNTRY_ORIGIN_NAME'] or '')
    e=[tc(name),tc(prod),vint,t,r['PRODUCT_ALCOHOL_PERCENT'] or '',ctry]
    if upc in out and out[upc][2]>=vint:continue
    out[upc]=e;st['ok']+=1
json.dump(out,open('bcwines.json','w'),ensure_ascii=False)
print(st,len(out))
import random;random.seed(2)
for k in random.sample(list(out),20):print(k,out[k])
