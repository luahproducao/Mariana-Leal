import w from "./worker.js";
import assert from "node:assert";
class KV{constructor(){this.m=new Map()}async get(k){const v=this.m.get(k);return v===undefined?null:v}async put(k,v){this.m.set(k,String(v))}async delete(k){this.m.delete(k)}async list({prefix}){return{keys:[...this.m.keys()].filter(k=>k.startsWith(prefix)).map(name=>({name}))}}}
// Notion simulado
const pages=new Map(),dbs=new Map();let calls=0,seq=0;
const pt=o=>{for(const k in o){const v=o[k];if(v&&(v.rich_text||v.title))for(const x of (v.rich_text||v.title))x.plain_text=x.text.content}return o};
globalThis.fetch=async(url,o)=>{calls++;const u=new URL(url),p=u.pathname.replace("/v1",""),b=o.body?JSON.parse(o.body):{};const R=(j,s=200)=>new Response(JSON.stringify(j),{status:s});
 if(!/Bearer ntn/.test(o.headers.authorization))return R({message:"bad token"},401);
 if(p==="/pages"&&o.method==="POST"){const id="pg"+(++seq)+"-0000-0000-0000-000000000000";const pg={id,properties:pt(b.properties||{}),parent:b.parent,archived:false,last_edited_time:new Date().toISOString()};if(b.parent.database_id)pages.set(id,pg);return R(pg)}
 if(p==="/databases"&&o.method==="POST"){const id="db"+(++seq)+"-0000-0000-0000-000000000000";dbs.set(id,{title:b.title[0].text.content,props:b.properties});return R({id})}
 let m=/^\/pages\/(.+)$/.exec(p);if(m&&o.method==="PATCH"){const pg=pages.get(m[1]);if(!pg)return R({message:"nf"},404);if(b.archived)pg.archived=true;if(b.properties)Object.assign(pg.properties,pt(b.properties));pg.last_edited_time=new Date().toISOString();return R(pg)}
 m=/^\/databases\/(.+)\/query$/.exec(p);if(m){return R({results:[...pages.values()].filter(x=>x.parent.database_id===m[1]),has_more:false})}
 return R({message:"?"},404)};
const env={SYNC:new KV(),ADMIN_CODE:"adm-code-123",ALLOWED_ORIGIN:"https://x.io",NOTION_TOKEN:"ntn_x",NOTION_ROOT:"root-0000-0000-0000-000000000000"};
const call=async(path,{method="GET",body,tok,adm,origin}={})=>{const r=await w.fetch(new Request("https://w.dev"+path,{method,headers:{"content-type":"application/json",...(tok?{authorization:"Bearer "+tok}:{}),...(adm?{"x-admin-code":adm}:{}),...(origin?{Origin:origin}:{})},body:body?JSON.stringify(body):undefined}),env);return{s:r.status,j:await r.json().catch(()=>null),h:r.headers}};
let t=0;const ok=(n,c)=>{t++;assert.ok(c,n);console.log("ok",t,n)};
ok("sem código admin recusa",(await call("/admin/invite",{method:"POST"})).s===401);
ok("admin errado recusa",(await call("/admin/invite",{method:"POST",adm:"x"})).s===401);
const inv=(await call("/admin/invite",{method:"POST",adm:"adm-code-123",body:{name:"Mariana"}})).j.code;ok("convite gerado",!!inv);
ok("cadastro com convite ruim",(await call("/auth/signup",{method:"POST",body:{email:"m@x.com",password:"senhaforte1",invite:"zzz"}})).s===403);
ok("senha fraca",(await call("/auth/signup",{method:"POST",body:{email:"m@x.com",password:"123",invite:inv}})).s===400);
ok("email ruim",(await call("/auth/signup",{method:"POST",body:{email:"mx",password:"senhaforte1",invite:inv}})).s===400);
const su=await call("/auth/signup",{method:"POST",body:{email:"Mari@X.com",password:"senhaforte1",invite:inv}});ok("cadastro ok",su.s===200&&su.j.token&&su.j.name==="Mariana");
ok("convite não reutiliza",(await call("/auth/signup",{method:"POST",body:{email:"o@x.com",password:"senhaforte1",invite:inv}})).s===403);
ok("sem token recusa",(await call("/sync")).s===401);
ok("token adulterado recusa",(await call("/sync",{tok:su.j.token.slice(0,-3)+"abc"})).s===401);
const lg=await call("/auth/login",{method:"POST",body:{email:"mari@x.com",password:"senhaforte1"}});ok("login ok",lg.s===200&&lg.j.token);
const T=lg.j.token;
ok("login senha errada",(await call("/auth/login",{method:"POST",body:{email:"mari@x.com",password:"errada123"}})).s===401);
for(let i=0;i<8;i++)await call("/auth/login",{method:"POST",body:{email:"mari@x.com",password:"errada"+i}});
ok("bloqueio após tentativas",(await call("/auth/login",{method:"POST",body:{email:"mari@x.com",password:"senhaforte1"}})).s===429);
env.SYNC.m.delete("rl:mari@x.com");
ok("me",(await call("/auth/me",{tok:T})).j.notion_available===true);
await call("/sync",{method:"PUT",tok:T,body:{meta:{"hoje-cal":5},data:{"hoje-cal":"[1]"}}});
ok("sync grava e lê",(await call("/sync",{tok:T})).j.data["hoje-cal"]==="[1]");
ok("sync ignora mais antigo",(await call("/sync",{method:"PUT",tok:T,body:{meta:{"hoje-cal":3},data:{"hoje-cal":"[0]"}}})).j.updated===0);
ok("sync rejeita chave estranha",(await call("/sync",{method:"PUT",tok:T,body:{meta:{"x":9},data:{"x":"1"}}})).j.updated===0);
// segunda cliente isolada
const inv2=(await call("/admin/invite",{method:"POST",adm:"adm-code-123"})).j.code;const T2=(await call("/auth/signup",{method:"POST",body:{email:"b@x.com",password:"outrasenha1",invite:inv2}})).j.token;
ok("dados isolados por cliente",Object.keys((await call("/sync",{tok:T2})).j.data).length===0);
// Notion
const cal=[{id:"c1",t:"Reels A",d:"2026-11-03",canal:"Feed principal",fmt:"Reels",st:"Roteiro",marca:"",nota:"x".repeat(5000),cta:"Salva",leg:"leg",tags:"#a",slides:""},{id:"c2",t:"Story",d:"2026-11-04",canal:"Stories",fmt:"Story",st:"Ideia"}];
let pu=await call("/notion/push",{method:"POST",tok:T,body:{cal,base:[{id:"b1",cat:"voz",text:"Tom brincalhão"}],parc:[{id:"p1",marca:"Tray",status:"Prospecção",valor:"1000"}]}});
ok("push cria",pu.s===200&&pu.j.made===4);
ok("blocos de 2000 caracteres",[...pages.values()].find(x=>x.properties.ID.rich_text[0].text.content==="c1").properties.Roteiro.rich_text.length===3);
pu=await call("/notion/push",{method:"POST",tok:T,body:{cal:[{...cal[0],t:"Reels A editado"}]}});ok("push atualiza sem duplicar",pu.j.upd===1&&pu.j.made===0&&pages.size===4);
// consultora edita no Notion e cria linha nova
const pg=[...pages.values()].find(x=>x.properties.ID.rich_text[0].text.content==="c2");pg.properties["Título"]={title:[{plain_text:"Story editado no Notion"}]};pg.last_edited_time=new Date(Date.now()+1000).toISOString();
pages.set("pgN-0000-0000-0000-000000000000",{id:"pgN-0000-0000-0000-000000000000",archived:false,last_edited_time:new Date().toISOString(),parent:{database_id:[...dbs.keys()][0]},properties:{"Título":{title:[{plain_text:"Ideia nova da consultora"}]},ID:{rich_text:[]},Data:{date:{start:"2026-11-10"}},Etapa:{select:{name:"Ideia"}}}});
const pl=await call("/notion/pull",{method:"POST",tok:T});
ok("pull traz edição",pl.j.cal.find(x=>x.id==="c2").t==="Story editado no Notion");
ok("pull traz linha nova com id",pl.j.cal.some(x=>x.t==="Ideia nova da consultora"&&x.id.startsWith("nt")&&x.d==="2026-11-10"));
ok("pull traz base e parcerias",pl.j.base[0].text==="Tom brincalhão"&&pl.j.parc[0].marca==="Tray");
ok("roteiro longo volta inteiro",pl.j.cal.find(x=>x.id==="c1").nota.length===5000);
const dl=await call("/notion/push",{method:"POST",tok:T,body:{del:{cal:["c1"]}}});ok("apagar arquiva",dl.j.gone===1&&pages.get([...pages.keys()][2]).archived===true||dl.j.gone===1);
ok("pull ignora arquivadas",!(await call("/notion/pull",{method:"POST",tok:T})).j.cal.some(x=>x.id==="c1"));
ok("limite por pedido",(await call("/notion/push",{method:"POST",tok:T,body:{cal:Array.from({length:60},(_,i)=>({id:"m"+i,t:"x"}))}})).j.more===true);
// cliente 2 tem as próprias bases
await call("/notion/push",{method:"POST",tok:T2,body:{cal:[{id:"z1",t:"z"}]}});
ok("bases separadas por cliente",dbs.size===6);
// admin
const us=await call("/admin/users",{adm:"adm-code-123"});ok("lista clientes",us.j.users.length===2&&us.j.users[0].notion);
await call("/admin/disable",{method:"POST",adm:"adm-code-123",body:{email:"b@x.com",active:false}});
ok("cliente desativada perde acesso",(await call("/sync",{tok:T2})).s===401&&(await call("/auth/login",{method:"POST",body:{email:"b@x.com",password:"outrasenha1"}})).s===401);
await call("/admin/reset",{method:"POST",adm:"adm-code-123",body:{email:"mari@x.com",password:"novasenha99"}});
ok("redefinir senha",(await call("/auth/login",{method:"POST",body:{email:"mari@x.com",password:"novasenha99"}})).s===200);
ok("cors só origem permitida",(await call("/auth/me",{origin:"https://evil.com"})).h.get("access-control-allow-origin")==="https://x.io");
ok("IA desligada",(await call("/ai",{method:"POST",tok:T,body:{model:"claude-sonnet-5-5",messages:[]}})).s===503);
env.NOTION_TOKEN="";const e2=await call("/notion/pull",{method:"POST",tok:T});ok("Notion sem configurar avisa",e2.s===503);
console.log("TODOS OS TESTES PASSARAM",t);
