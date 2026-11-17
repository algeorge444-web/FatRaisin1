import {shopWines} from './hl2.mjs';import fs from 'fs';
process.on('unhandledRejection',()=>{});process.on('uncaughtException',()=>{});
const T=JSON.parse(fs.readFileSync('shoptodo.json','utf8'));const out={};let i=0,done=0,n=0;
const one=async w=>{const items=[];let platform='',page=0;
  while(page<8){let r;try{r=await Promise.race([shopWines(new URLSearchParams({site:w.web,page:String(page),platform})),new Promise(z=>setTimeout(()=>z(null),90000))])}catch(e){r=null}
    if(!r||r.error)break;platform=r.platform||platform;items.push(...(r.items||[]));if(!r.more)break;page++}
  return {platform,items}};
const worker=async()=>{while(i<T.length){const w=T[i++];const r=await one(w);out[w.id]={w,...r};n+=r.items.length;done++;if(done%10==0){fs.writeFileSync('shopraw.json',JSON.stringify(out));console.log(done,'/',T.length,'items',n)}}};
await Promise.all(Array.from({length:14},worker));fs.writeFileSync('shopraw.json',JSON.stringify(out));console.log('done',done,n);process.exit(0);
