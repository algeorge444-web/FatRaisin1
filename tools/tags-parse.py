import json,re,collections,sys,random
R=json.load(open('tagsraw.json'));T={p['id']:p for p in json.load(open('tagstodo.json'))}
POS={
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
 'p':None,'f':None,'s':r"end of our b&b|no longer (offer|rent|have)[^.]{0,30}(stay|lodging|b&b|cottage|rooms)|b&b (is|has) (now )?closed",'t':r"tours?[^.\u00b7?]{0,40}\? ?(a: ?)?(not at this time|no\b|unfortunately|we do not|we don't)|tours? (are )?(not|no longer) (currently )?(offered|available)|(do not|don't|no longer|not currently) (offer|offering|give|giving) (public |brewery |winery |distillery )?tours|no (public )?tours|you are already in it",'m':None,'e':None}
MIN={'d':1,'p':1,'f':2,'t':1,'m':1,'k':1,'s':1,'e':1}
out={};cnt=collections.Counter();ev={}
for r in R:
    if not r.get('ok') or not r.get('s'):continue
    txt=' · '.join(r['s']).lower().replace('’',"'");tags=''
    for k in 'fpdktmse':
        hits=set(m.group(0) for m in re.finditer(POS[k],txt))
        if len(hits)<MIN[k] and not (k=='f' and re.search(r"full kitchen|scratch kitchen|\brestaurant\b|\bbrewpub\b|brew pub|food menu|gastropub",txt)):continue
        if NEG[k] and re.search(NEG[k],txt):cnt['neg_'+k]+=1;continue
        tags+=k;cnt[k]+=1;ev[(r['id'],k)]=list(hits)[:3]
    if tags:out[r['id']]=tags
print(len(R),len(out),dict(cnt));json.dump(out,open('tagsfound.json','w'))
random.seed(int(sys.argv[1]) if len(sys.argv)>1 else 1);Rm={r['id']:r for r in R}
for k in 'dkst':
    ids=[i for i,t in out.items() if k in t]
    for i in random.sample(ids,min(5,len(ids))):
        m=re.search(POS[k],' · '.join(Rm[i]['s']).lower());sn=' · '.join(Rm[i]['s'])
        print(k,'|',T[i]['name'][:28],'|',sn[max(0,m.start()-70):m.end()+60].replace('\n',' '))
