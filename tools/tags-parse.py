import json,re,collections,sys,random
R=json.load(open('tagsraw2.json'));T={p['id']:p for p in json.load(open('tagstodo.json'))}
POS={
 'b':r"\b(bbq|barbe[cq]ue) (joint|restaurant|menu|platters?|pit|smoker|sandwich(es)?|plates?|trays?|dinners?|nights?|kitchen|shack|house)|(wine|beer|cider|brews?|beers|wines|ciders),? (and |& )?(bbq|barbe[cq]ue)\b|smokehouse|house[- ]smoked|smoked (meats?|brisket|ribs|pork)|pulled pork|burnt ends|(texas|carolina|kansas city|memphis|southern)[- ]style (bbq|barbe[cq]ue)|our (bbq|barbe[cq]ue|smoker)\b",
 'z':r"\bpizzas?\b|pizzeria|wood[- ]fired (oven|pies?)",
 'c':r"charcuterie|(meat (and|&) )?cheese (boards?|plates?|platters?|pairings?|shop)|local cheeses?|artisan(al)? (cheeses?|foods?|breads?)|farm (shop|store|market|stand)|cheesemonger",
 'v':r"sunset (views?|tastings?|sips?|sessions?|over|on the|dinners?|hour|toast)|(watch|catch|enjoy)(ing)? (the|a) sunset|\bsunsets\b|waterfront|lakefront|lakeside|riverside|riverfront|oceanfront|overlook(ing|s)?\b|(scenic|panoramic|stunning|breathtaking|beautiful|sweeping|spectacular|mountain|lake|valley|vineyard|river|ocean|water|harbou?r) views?|views? of (the |our )?(lake|river|valley|mountains?|vineyards?|bay|ocean|water|harbou?r|hills|countryside|falls|skyline|orchards?|farm|sound|coast)",
 'o':r"\borchards?\b|u-pick|pick[- ]your[- ]own|farm brewery|farmhouse brewery|working farm|on (the|our) (family )?farm|farm[- ]to[- ](glass|table|bottle)",
 'u':r"sparkling (wines?|ciders?|ros[e\u00e9]|brut|mead)|\bbubbly\b|\bbrut\b|p[e\u00e9]t[- ]?nat|m[e\u00e9]thode (traditionnelle|champenoise|ancestrale)|traditional method|blanc de blancs",
 'i':r"fire ?pits?|bonfires?|fire ?places?|fireside|wood stove",
 'r':r"\bromantic\b|date nights?|for couples|couples (getaway|retreat|package|night)",
 'g':r"reserve tastings?|library (wines?|tastings?)|private tastings?|seated tastings?|elevated (tastings?|experiences?)|vip (tastings?|experiences?)|premium (tastings?|experiences?)|sit[- ]down tastings?|guided tastings?",
 'h':r"hidden gem|off the beaten (path|track)|family[- ]owned|family[- ]run|small[- ]batch|nano[- ]?brewery|micro[- ]?winery|boutique (winery|brewery|distillery|cidery)",
 'd':r"(dog|pet|pup|pooch|canine)[- ]?friendly|dogs? (are |is )?(always |more than )?(welcome|allowed|permitted)|well[- ]behaved (dogs|pets|pups)|leashed (dogs|pets)|(dogs|pets) on (a )?leash|bring (your|the) (dog|pup|pooch|four[- ]legged)|furry friends? (are )?welcome",
 'p':r"\bpatio\b|beer garden|biergarten|outdoor (seating|tasting|space|area|patio|deck|bar|dining|tables)|seating outside|picnic (area|tables?|grounds|on)|\bterrace\b|courtyard|fire ?pits?|on (the|our) (deck|lawn)|lawn games",
 'f':r"full kitchen|our kitchen|scratch kitchen|\brestaurant\b|food menu|lunch menu|dinner menu|brunch menu|wood[- ]fired|\bbrewpub\b|brew pub|\bbistro\b|charcuterie|cheese (board|plate|platter)|small plates|\beatery\b|gastropub|smokehouse|\bburgers\b|\bpizzas?\b|\btacos\b|\bsandwiches\b|\bappetizers\b",
 't':r"(winery|brewery|distillery|vineyard|cellar|cave|guided|production|facility|behind[- ]the[- ]scenes|barrel room|estate|private|public) tours?|tours? (and|&|\+) tastings?|tastings? (and|&|\+) tours?|book (a|your) tour|take (a|the) tour|tour times|tours (are )?(offered|available|run|daily|every)",
 'm':r"live music|live bands?|music series|concert series|live entertainment|live acoustic|music on the (patio|lawn|deck)",
 'k':r"(family|kid|child|children)[- ]?friendly|(kids|children|families|minors) (are )?(always )?welcome|all ages (are )?welcome|bring the (kids|family|whole family)",
 's':r"stay with us|book (a|your) stay|our (inn|cottages?|cabins?|suites|guest ?house|villa|b&b|bed (and|&) breakfast|vacation rental|farmhouse rental)|the (inn|villa|guest ?house|cottages?|lodge|suites) at\b|on-?site (lodging|accommodations?)|vineyard (cottage|stay|guest ?house)|overnight stays?|stay (overnight|the night|on the (vineyard|estate|farm))|harvest ?hosts",
 'e':r"weddings?|private (events?|parties|party|functions?)|event (space|venue|rental)|host your (event|party|next)|rehearsal dinners?|corporate events?|book (an|your) event",
}
NEG={
 'd':r"no (dogs|pets)|not (dog|pet)[- ]friendly|(dogs|pets) (are )?not (allowed|permitted|welcome)|service animals only|only service (animals|dogs)|leave (your )?(dogs|pets) at home|cannot (allow|accommodate) (dogs|pets)|no outside (dogs|pets)",
 'k':r"21 ?\+ only|21 and (over|older) only|adults only|no (kids|children|minors)|(kids|children|minors) (are )?not (allowed|permitted)|must be (21|19)\+? (or older )?to enter|no one under (21|19)|not (kid|child|family)[- ]friendly",
 'p':None,'f':None,'s':r"end of our b&b|no longer (offer|rent|have)[^.]{0,30}(stay|lodging|b&b|cottage|rooms)|b&b (is|has) (now )?closed",'t':r"tours?[^.\u00b7?]{0,40}\? ?(a: ?)?(not at this time|no\b|unfortunately|we do not|we don't)|tours? (are )?(not|no longer) (currently )?(offered|available)|(do not|don't|no longer|not currently) (offer|offering|give|giving) (public |brewery |winery |distillery )?tours|no (public )?tours|you are already in it",'m':None,'e':None,'b':None,'z':None,'c':None,'v':None,'o':None,'u':None,'i':None,'r':None,'g':None,'h':None}
MIN={'b':1,'z':1,'c':1,'v':1,'o':1,'u':1,'i':1,'r':1,'g':1,'h':1,'d':1,'p':1,'f':2,'t':1,'m':1,'k':1,'s':1,'e':1}
out={};cnt=collections.Counter();ev={}
for r in R:
    if not r.get('ok') or not r.get('s'):continue
    txt=' · '.join(r['s']).lower().replace('’',"'");tags=''
    for k in 'fpdktmsezbcviuorgh':
        hits=set(m.group(0) for m in re.finditer(POS[k],txt))
        if len(hits)<MIN[k] and not (k=='f' and re.search(r"full kitchen|scratch kitchen|\brestaurant\b|\bbrewpub\b|brew pub|food menu|gastropub",txt)):continue
        if NEG[k] and re.search(NEG[k],txt):cnt['neg_'+k]+=1;continue
        tags+=k;cnt[k]+=1;ev[(r['id'],k)]=list(hits)[:3]
    if tags:out[r['id']]=tags
print(len(R),len(out),dict(cnt));json.dump(out,open('tagsfound2.json','w'))
random.seed(int(sys.argv[1]) if len(sys.argv)>1 else 1);Rm={r['id']:r for r in R}
for k in (sys.argv[2] if len(sys.argv)>2 else 'bzcv'):
    ids=[i for i,t in out.items() if k in t]
    for i in random.sample(ids,min(5,len(ids))):
        m=re.search(POS[k],' · '.join(Rm[i]['s']).lower());sn=' · '.join(Rm[i]['s'])
        print(k,'|',T[i]['name'][:28],'|',sn[max(0,m.start()-70):m.end()+60].replace('\n',' '))
