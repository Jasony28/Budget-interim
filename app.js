import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import { getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, signOut } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, setDoc, getDoc, deleteDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import { initializeAppCheck, ReCaptchaEnterpriseProvider, ReCaptchaV3Provider } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app-check.js";
import { getAI, getGenerativeModel, GoogleAIBackend } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-ai.js";
import { firebaseConfig, recaptchaEnterpriseSiteKey, recaptchaV3SiteKey, geminiModel } from "./firebase-config.js?v=10";

const APP_VERSION=10;
const DEFAULT_CATS=["Courses","Transport","Carburant","Loisirs","Santé","Vêtements","Maison","Resto","Cadeaux","Autre"];
const cats=()=>(S.cats&&S.cats.length?S.cats:DEFAULT_CATS);
const DEF={missions:[],paies:[],depenses:[],fixes:[],objectifs:[],budgets:{},epargneLog:[],pointage:[],cr:[],dettes:[],defi:[],cats:null,reglages:{epargne:0,pct:10,mois:3,ratio:78,statut:"ouvrier"}};
let S=JSON.parse(JSON.stringify(DEF));
let cur=new Date();cur.setDate(1);
const $=id=>document.getElementById(id);
const eur=n=>(Math.round((+n||0)*100)/100).toLocaleString("fr-BE",{style:"currency",currency:"EUR",maximumFractionDigits:0});
const eur2=n=>(+n||0).toLocaleString("fr-BE",{style:"currency",currency:"EUR"});
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,7);
const today=()=>new Date().toISOString().slice(0,10);
const mkey=d=>d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0");
const fmtD=s=>s?new Date(s+"T12:00").toLocaleDateString("fr-BE",{day:"numeric",month:"short"}):"";
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function toast(t){const e=$("toast");e.textContent=t;e.classList.add("on");setTimeout(()=>e.classList.remove("on"),1800)}

/* ---------- stockage : Firebase ---------- */
function normalize(d){d=d||{};return{missions:d.missions||[],paies:d.paies||[],depenses:d.depenses||[],fixes:d.fixes||[],objectifs:d.objectifs||[],budgets:d.budgets||{},epargneLog:d.epargneLog||[],pointage:d.pointage||[],cr:d.cr||[],dettes:d.dettes||[],defi:d.defi||[],cats:d.cats||null,reglages:Object.assign({},DEF.reglages,d.reglages||{})}}
const configured=firebaseConfig.apiKey&&firebaseConfig.apiKey!=="A_REMPLACER";
const app=configured?initializeApp(firebaseConfig):null;
const auth=app?getAuth(app):null;
const fdb=app?initializeFirestore(app,{localCache:persistentLocalCache({tabManager:persistentMultipleTabManager()})}):null;
let fsDoc=null, unsub=null, curUid=null;
function setSync(t){$("sync").textContent=t}
function save(){
  render();syncRappels();
  if(!fsDoc)return;
  setDoc(fsDoc,JSON.parse(JSON.stringify(S))).catch(e=>{console.error(e);setSync("⚠ Erreur de sauvegarde")});
}
function subscribe(uid){
  fsDoc=doc(fdb,"budgets",uid);curUid=uid;
  setSync("Chargement…");
  unsub=onSnapshot(fsDoc,{includeMetadataChanges:true},snap=>{
    const m=snap.metadata;
    if(!m.hasPendingWrites&&snap.exists())S=normalize(snap.data());
    setSync(m.hasPendingWrites?(navigator.onLine?"Sauvegarde…":"Hors ligne · enregistré sur le téléphone"):m.fromCache?"Hors ligne":"✓ Synchronisé");
    render();
    if(!window.__first){window.__first=1;syncRappels();setTimeout(notifierMaintenant,1500);raccourci()}
  },e=>{console.error(e);setSync("⚠ Accès refusé (règles Firestore ?)")});
}
function init(){
  if(!configured){$("loginErr").textContent="Firebase n'est pas encore configuré : remplis le fichier firebase-config.js (voir README).";$("bLogin").disabled=true;return}
  onAuthStateChanged(auth,user=>{
    if(unsub){unsub();unsub=null}
    if(user){
      document.body.classList.remove("signed-out");
      $("who").textContent="Connecté : "+(user.email||user.displayName||"");
      subscribe(user.uid);
    }else{
      document.body.classList.add("signed-out");fsDoc=null;S=JSON.parse(JSON.stringify(DEF));
    }
  });
  getRedirectResult(auth).catch(e=>{$("loginErr").textContent=loginMsg(e)});
  initAI();
}
function loginMsg(e){const c=e&&e.code||"";
  if(c==="auth/unauthorized-domain")return "Domaine non autorisé : ajoute jasony28.github.io dans Firebase → Authentication → Paramètres → Domaines autorisés.";
  if(c==="auth/popup-closed-by-user"||c==="auth/cancelled-popup-request")return "";
  if(c==="auth/network-request-failed")return "Pas de connexion internet.";
  return "Connexion impossible ("+c+").";}
const inWebView=/; wv\)|FBAN|FBAV|Instagram|Line\/|Snapchat|Claude/i.test(navigator.userAgent);
function loginInfo(html,err){const el=$("loginErr");el.style.color=err?"var(--bad)":"var(--mut)";el.innerHTML=html}
if(inWebView)loginInfo("⚠️ Tu es dans un navigateur intégré (appli Claude, Messenger…). Google y bloque la connexion : ouvre ce lien directement dans <b>Chrome</b>.",true);
function provider(){const p=new GoogleAuthProvider();p.setCustomParameters({prompt:"select_account"});return p}
async function loginRedirect(){loginInfo("Redirection vers Google…");try{await signInWithRedirect(auth,provider())}catch(e){loginInfo(esc(loginMsg(e)),true)}}
let loginTimer=null;
$("bLogin").onclick=async()=>{
  loginInfo("Ouverture de la fenêtre Google…");
  clearTimeout(loginTimer);
  loginTimer=setTimeout(()=>{if(document.body.classList.contains("signed-out"))loginInfo(`Rien ne s'ouvre ? <button class="btn sec sm" id="bRedirect" style="margin-top:8px">Essayer autrement</button><br><small>Ou ouvre l'appli directement dans Chrome.</small>`)},8000);
  try{await signInWithPopup(auth,provider());clearTimeout(loginTimer);loginInfo("")}
  catch(e){clearTimeout(loginTimer);
    if(["auth/popup-blocked","auth/operation-not-supported-in-this-environment","auth/web-storage-unsupported"].includes(e.code))return loginRedirect();
    const m=loginMsg(e);loginInfo(esc(m),!!m)}
};
document.addEventListener("click",e=>{if(e.target.id==="bRedirect")loginRedirect()});
$("bLogout").onclick=()=>signOut(auth);
/* ---------- mise à jour de l'appli ---------- */
async function forceUpdate(){
  document.querySelectorAll(".updBtn").forEach(b=>b.classList.add("spin-it"));
  try{const regs=navigator.serviceWorker?await navigator.serviceWorker.getRegistrations():[];for(const r of regs)await r.unregister();
    if(window.caches){const ks=await caches.keys();await Promise.all(ks.filter(k=>k!=="rappels").map(k=>caches.delete(k)))}}catch(e){}
  location.replace(location.pathname+"?maj="+Date.now());
}
async function checkUpdate(){
  try{const r=await fetch("version.json?t="+Date.now(),{cache:"no-store"});if(!r.ok)return;const j=await r.json();
    if(+j.version>APP_VERSION){$("updBanner").hidden=false;$("verLabel").textContent=`Version ${APP_VERSION} · la ${j.version} est disponible`}}catch(e){}
}
document.addEventListener("click",e=>{if(e.target.closest(".updBtn"))forceUpdate()});
document.addEventListener("visibilitychange",()=>{if(!document.hidden)checkUpdate()});
setTimeout(checkUpdate,1500);
if(location.search.includes("maj="))history.replaceState(null,"",location.pathname);
if("serviceWorker" in navigator){const had=!!navigator.serviceWorker.controller;window.addEventListener("load",()=>navigator.serviceWorker.register("sw.js").then(r=>r.update()).catch(()=>{}));navigator.serviceWorker.addEventListener("controllerchange",()=>{if(had&&!window.__reloaded){window.__reloaded=1;location.reload()}})}

/* ---------- calculs ---------- */
const fixesTotal=()=>S.fixes.reduce((a,f)=>a+(+f.montant||0),0);
function monthData(k){
  const p=S.paies.filter(x=>(x.date||"").startsWith(k));
  const recu=p.filter(x=>x.recu).reduce((a,x)=>a+(+x.montant||0),0);
  const att=p.filter(x=>!x.recu).reduce((a,x)=>a+(+x.montant||0),0);
  const all=S.depenses.filter(x=>(x.date||"").startsWith(k));
  const d=all.filter(x=>!x.fixe); // une facture liée à une charge fixe est déjà comptée dans les fixes
  const var_=d.reduce((a,x)=>a+(+x.montant||0),0);
  return{p,recu,att,d,all,var_,fix:fixesTotal(),dep:var_+fixesTotal()};
}
function missionPaid(m){return S.paies.filter(p=>p.mission===m.id&&p.recu).reduce((a,p)=>a+(+p.montant||0),0)}
function daysTo(s){return Math.ceil((new Date(s+"T23:59")-new Date())/864e5)}
const sum=(a,f)=>a.reduce((t,x)=>t+(+f(x)||0),0);
function netHoraire(){
  const p=S.paies.filter(x=>+x.heures>0&&+x.montant>0);
  const h=sum(p,x=>x.heures);
  if(h>=8)return{v:sum(p,x=>x.montant)/h,src:"réel"};
  const t=S.missions.filter(m=>+m.taux>0);
  if(t.length)return{v:sum(t,m=>m.taux)/t.length*S.reglages.ratio/100,src:"estimé"};
  return null;
}
function avgVar(n=3){
  const vals=[];for(let i=1;i<=n;i++){const d=new Date();d.setDate(1);d.setMonth(d.getMonth()-i);const k=mkey(d);if(S.depenses.some(x=>(x.date||"").startsWith(k)))vals.push(monthData(k).var_)}
  if(!vals.length)return monthData(mkey(new Date())).var_;
  return vals.reduce((a,b)=>a+b,0)/vals.length;
}
function moisPour(o){if(!o.echeance)return null;const d=new Date(o.echeance+"T12:00"),n=new Date();const m=Math.max(1,(d.getFullYear()-n.getFullYear())*12+d.getMonth()-n.getMonth());return Math.max(0,(+o.cible-(+o.actuel||0)))/m}

/* ---------- rendu ---------- */
const row=(edit,left,right)=>`<div class="row"><div class="l" data-edit="${edit}">${left}</div><div style="display:flex;align-items:center;gap:2px">${right}</div></div>`;
function render(){
  const k=mkey(cur), t=today(), isNow=k===mkey(new Date());
  $("mlabel").textContent=cur.toLocaleDateString("fr-BE",{month:"long",year:"numeric"});
  const M=monthData(k), R=S.reglages, fx=fixesTotal();
  const reste=M.recu+M.att-M.dep;
  $("reste").textContent=eur(reste);
  $("resteCard").classList.toggle("neg",reste<0);
  $("resteSub").textContent=M.att>0?`dont ${eur(M.att)} de paies encore attendues`:"revenus − charges fixes − dépenses";
  $("recu").textContent=eur(M.recu);
  $("attendu").textContent=M.att>0?`+ ${eur(M.att)} attendus`:`${M.p.length} paie(s)`;
  $("dep").textContent=eur(M.dep);
  $("depSub").textContent=`${eur(M.fix)} fixes · ${eur(M.var_)} variables`;

  // budget par jour
  $("jourCard").hidden=!isNow||(M.recu+M.att===0&&M.dep===0);
  if(isNow){const n=new Date(),dim=new Date(n.getFullYear(),n.getMonth()+1,0).getDate(),left=dim-n.getDate()+1;
    const pj=reste/left;$("parJour").textContent=eur(pj)+" / jour";$("parJour").className="v "+(pj<0?"out":pj<10?"pend":"pos");
    $("jourSub").innerHTML=`${left} jour${left>1?"s":""}<br>restant${left>1?"s":""}`;$("moisBar").style.width=((n.getDate()-1)/dim*100)+"%"}

  // alertes
  const A=[];
  const active=S.missions.filter(m=>(!m.debut||m.debut<=t)&&(!m.fin||m.fin>=t));
  if(!S.missions.length) A.push(["","Ajoute ta première mission","Onglet Paies → nouvelle mission, ou scanne directement une fiche de paie 📷."]);
  else if(!active.length) A.push(["bad","Pas de mission en cours",`Avec tes charges fixes de ${eur(fx)}/mois, ton épargne tient ${fx?(R.epargne/fx).toLocaleString("fr-BE",{maximumFractionDigits:1}):"∞"} mois.`]);
  active.forEach(m=>{if(m.fin){const n=daysTo(m.fin);if(n<=14)A.push([n<=5?"bad":"","Fin de mission "+(n<=0?"aujourd'hui":"dans "+n+" j"),`${esc(m.client||m.agence)} se termine le ${fmtD(m.fin)}. Pense à relancer ton agence.`])}
    else A.push(["ok","Mission en cours",`${esc(m.client||m.agence)}${m.taux?" · "+eur2(m.taux)+"/h brut":""}`])});
  const att=S.paies.filter(p=>!p.recu&&p.date<t);
  if(att.length)A.push(["",`${att.length} paie${att.length>1?"s":""} en retard`,`${eur(sum(att,p=>p.montant))} attendus depuis le ${fmtD(att.map(p=>p.date).sort()[0])}. Vérifie ton compte ou relance l'agence.`]);
  const ap=S.depenses.filter(x=>x.paye===false).sort((a,b)=>(a.echeance||"9").localeCompare(b.echeance||"9"));
  if(ap.length){const late=ap.filter(x=>x.echeance&&x.echeance<t),soon=ap.filter(x=>x.echeance&&x.echeance>=t&&daysTo(x.echeance)<=7);
    A.push([late.length?"bad":soon.length?"":"ok",`${ap.length} facture${ap.length>1?"s":""} à payer · ${eur(sum(ap,x=>x.montant))}`,ap.slice(0,3).map(x=>`${esc(x.note||x.cat)} ${eur2(x.montant)}${x.echeance?(x.echeance<t?" — <b style='color:var(--bad)'>en retard</b>":" — avant le "+fmtD(x.echeance)):""}`).join("<br>")])}
  Object.entries(S.budgets).forEach(([c,lim])=>{if(!(+lim>0))return;const sp=sum(M.d.filter(x=>x.cat===c),x=>x.montant);const p=sp/lim;
    if(p>=1)A.push(["bad",`Budget ${c} dépassé`,`${eur(sp)} dépensés pour ${eur(lim)} prévus (+${eur(sp-lim)}).`]);
    else if(p>=.85)A.push(["",`Budget ${c} presque atteint`,`${eur(sp)} sur ${eur(lim)} — il reste ${eur(lim-sp)}.`])});
  const deja=sum(S.epargneLog.filter(x=>(x.date||"").startsWith(k)&&x.montant>0),x=>x.montant);
  const aside=Math.max(0,M.recu*R.pct/100-deja);
  if(aside>=1&&R.pct>0) A.push(["ok",`Mets ${eur(aside)} de côté`,`${R.pct}% de tes paies reçues ce mois, pour tenir pendant les périodes sans mission.`,`<button class="btn sm" data-open="epargne" data-amt="${aside.toFixed(2)}" style="margin-top:10px">C'est fait</button>`]);
  $("alerts").innerHTML=A.map(a=>`<div class="card alert ${a[0]}"><div style="flex:1"><div class="t">${a[1]}</div><p>${a[2]}</p>${a[3]||""}</div></div>`).join("");

  // coussin
  const cible=fx*R.mois;
  if(fx>0){const mo=R.epargne/fx;$("coussin").textContent=mo.toLocaleString("fr-BE",{maximumFractionDigits:1})+" mois";
    $("coussinSub").textContent=`${eur(R.epargne)} d'épargne · objectif ${R.mois} mois = ${eur(cible)}`;
    $("coussinBar").style.width=Math.min(100,R.epargne/cible*100)+"%";
    $("coussinBar").style.background=mo>=R.mois?"var(--pos)":mo>=1?"var(--warn)":"var(--bad)";}
  else{$("coussin").textContent=eur(R.epargne);$("coussinSub").textContent="Ajoute tes charges fixes pour savoir combien de mois tu tiens sans mission.";$("coussinBar").style.width="0"}

  // objectifs
  $("objectifs").innerHTML=S.objectifs.length?S.objectifs.map(o=>{const p=Math.min(100,(+o.actuel||0)/(+o.cible||1)*100),mp=moisPour(o);
    return `<div class="obj" data-edit="objectif:${o.id}"><div class="top"><b>${esc(o.emoji||"🎯")} ${esc(o.nom)}</b><span class="pct">${Math.round(p)} %</span></div>
    <div class="bar"><i style="width:${p}%"></i></div>
    <div class="top sub" style="margin-top:6px"><span>${eur(o.actuel||0)} / ${eur(o.cible)}</span><span>${p>=100?"🎉 Atteint !":mp!=null?eur(mp)+"/mois jusqu'au "+fmtD(o.echeance):""}</span></div>
    ${p<100?`<button class="btn sec sm" data-open="epargne" data-target="${o.id}" style="margin-top:10px">+ Verser</button>`:""}</div>`}).join(""):`<div class="card empty">Un projet ? Voiture, permis, vacances… Crée un objectif et suis ta progression.</div>`;

  // graphique
  const ms=[];for(let i=5;i>=0;i--){const d=new Date(cur);d.setMonth(d.getMonth()-i);ms.push(d)}
  const actif=k=>S.paies.some(p=>(p.date||"").startsWith(k))||S.depenses.some(p=>(p.date||"").startsWith(k));
  const vals=ms.map(d=>{const kk=mkey(d),x=monthData(kk);return[x.recu+x.att,actif(kk)?x.dep:0]});
  const mx=Math.max(1,...vals.flat());
  $("chart").innerHTML=ms.map((d,i)=>`<div class="c"><div class="bars"><i style="height:${vals[i][0]/mx*100}%;background:#f4f4f5"></i><i style="height:${vals[i][1]/mx*100}%;background:var(--acc)"></i></div><small>${d.toLocaleDateString("fr-BE",{month:"short"}).replace(".","")}</small></div>`).join("");
  const withRev=vals.filter(v=>v[0]>0);$("chartAvg").textContent=withRev.length?"moy. "+eur(sum(withRev,v=>v[0])/withRev.length):"";

  // catégories
  const c={};M.d.forEach(x=>c[x.cat]=(c[x.cat]||0)+(+x.montant||0));
  const ce=Object.entries(c).sort((a,b)=>b[1]-a[1]);
  $("cats").innerHTML=ce.length?ce.map(([n,v])=>`<div class="cat"><span>${esc(n)}</span><b>${eur(v)} <small style="color:var(--mut);font-weight:600">${Math.round(v/M.var_*100)}%</small></b></div><div class="bar" style="margin-top:4px;height:6px"><i style="width:${v/ce[0][1]*100}%"></i></div>`).join(""):`<div class="empty">Aucune dépense ce mois</div>`;

  // missions
  const ms2=[...S.missions].sort((a,b)=>(b.debut||"").localeCompare(a.debut||""));
  $("missions").innerHTML=ms2.length?ms2.map(m=>{
    const on=(!m.debut||m.debut<=t)&&(!m.fin||m.fin>=t);
    const h=sum(S.paies.filter(p=>p.mission===m.id),p=>p.heures);
    return row("mission:"+m.id,`<b>${esc(m.client||"Mission")}${on?'<span class="pill g">en cours</span>':(m.debut>t?'<span class="pill y">à venir</span>':'')}</b>
    <small>${esc(m.agence)} · ${fmtD(m.debut)}${m.fin?" → "+fmtD(m.fin):" → ?"}${m.taux?" · "+eur2(m.taux)+"/h":""}</small><br><small>Reçu : ${eur(missionPaid(m))}${h?" · "+h+" h":""}</small>`,
    `<button class="btn sm" data-paie="${m.id}">+ Paie</button><button class="del" data-del="missions:${m.id}">×</button>`)}).join(""):`<div class="empty">Aucune mission</div>`;

  // paies
  const pm=[...M.p].sort((a,b)=>b.date.localeCompare(a.date));
  $("paies").innerHTML=pm.length?pm.map(p=>{const m=S.missions.find(x=>x.id===p.mission);
    return row("paie:"+p.id,`<b>${p.photo?"🖼️ ":p.detail?"📄 ":""}${esc(m?(m.client||m.agence):(p.note||"Paie"))}${p.recu?"":'<span class="pill y">attendue</span>'}</b><small>${fmtD(p.date)}${p.heures?" · "+p.heures+" h":""}${p.note&&m?" · "+esc(p.note):""}</small>`,
    `<span class="amt ${p.recu?"pos":"pend"}" data-toggle="${p.id}" style="cursor:pointer">${eur2(p.montant)}</span><button class="del" data-del="paies:${p.id}">×</button>`)}).join("")+`<div class="sub" style="padding-top:8px">Touche une paie pour la modifier, ou son montant pour la marquer reçue / attendue.</div>`:`<div class="empty">Aucune paie ce mois</div>`;

  // fixes
  $("fixes").innerHTML=S.fixes.length?S.fixes.map(f=>row("fixe:"+f.id,`<b>${esc(f.nom)}</b>${f.jour?`<small>le ${esc(f.jour)} du mois</small>`:""}`,`<span class="amt out">${eur2(f.montant)}</span><button class="del" data-del="fixes:${f.id}">×</button>`)).join("")+`<div class="row"><div class="l"><b>Total</b></div><span class="amt">${eur2(fx)}</span></div>`:`<div class="empty">Loyer, assurance, téléphone, abonnements…</div>`;

  // budgets
  const bl=Object.entries(S.budgets).filter(([,v])=>+v>0);
  $("budgets").innerHTML=bl.length?bl.map(([cat,lim])=>{const sp=sum(M.d.filter(x=>x.cat===cat),x=>x.montant),p=sp/lim;
    return `<div class="cat"><span>${esc(cat)}</span><b class="${p>=1?"out":""}">${eur(sp)} <small style="color:var(--mut);font-weight:600">/ ${eur(lim)}</small></b></div><div class="bar" style="margin-top:4px;height:6px"><i style="width:${Math.min(100,p*100)}%;background:${p>=1?"var(--bad)":p>=.85?"var(--warn)":"var(--pos)"}"></i></div>`}).join(""):`<div class="empty">Fixe un plafond par catégorie (courses, resto…) et l'appli te prévient avant de le dépasser.</div>`;

  // dépenses (+ recherche)
  const q=($("search").value||"").trim().toLowerCase();
  const dl=q?S.depenses.filter(d=>(d.note+" "+d.cat+" "+d.montant).toLowerCase().includes(q)):M.all;
  const dm=[...dl].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,q?100:500);
  $("depenses").innerHTML=(q?`<div class="sub" style="padding-bottom:6px">${dl.length} résultat(s) · ${eur2(sum(dl,x=>x.montant))} au total</div>`:"")+(dm.length?dm.map(d=>row("depense:"+d.id,`<b>${d.photo?"🖼️ ":d.detail?"🧾 ":""}${esc(d.note||d.cat)}${d.fixe?'<span class="pill">charge fixe</span>':""}${d.paye===false?`<span class="pill ${d.echeance&&d.echeance<today()?"r":"y"}">à payer${d.echeance?" · "+fmtD(d.echeance):""}</span>`:""}</b><small>${q?new Date(d.date+"T12:00").toLocaleDateString("fr-BE"):fmtD(d.date)} · ${esc(d.cat)}</small>`,`<span class="amt ${d.paye===false?"pend":"out"}" data-ptoggle="${d.id}" style="cursor:pointer">−${eur2(d.montant)}</span><button class="del" data-del="depenses:${d.id}">×</button>`)).join(""):`<div class="empty">${q?"Aucun résultat":"Aucune dépense ce mois"}</div>`);

  renderStats();renderOutils();renderExtras(M,k);renderPrevision();renderSettings();
  // réglages
  if(document.activeElement?.closest?.("#fSet")==null){$("sEpargne").value=R.epargne;$("sPct").value=R.pct;$("sMois").value=R.mois;$("sRatio").value=R.ratio;$("sStatut").value=R.statut||"ouvrier"}
}

function renderStats(){
  const y=String(cur.getFullYear()), R=S.reglages;
  const P=S.paies.filter(p=>(p.date||"").startsWith(y)), D=S.depenses.filter(d=>(d.date||"").startsWith(y)&&!d.fixe);
  const net=sum(P,p=>p.montant), h=sum(P,p=>p.heures), fx=fixesTotal();
  const moisActifs=new Set([...P,...D].map(x=>x.date.slice(0,7)));
  const nbM=Math.max(1,moisActifs.size);
  $("yLabel").textContent="Net gagné en "+y;$("yNet").textContent=eur(net);
  $("ySub").textContent=P.length?`${P.length} paie(s) · moy. ${eur(net/nbM)}/mois`:"Aucune paie cette année";
  $("yHeures").textContent=h+" h";
  const brutDet=P.filter(p=>p.detail&&p.detail.brut);$("yJours").textContent=brutDet.length?`brut scanné : ${eur(sum(brutDet,p=>p.detail.brut))}`:"";
  $("yNetH").textContent=h?eur2(sum(P.filter(p=>+p.heures>0),p=>p.montant)/sum(P.filter(p=>+p.heures>0),p=>p.heures)):"—";
  const dep=sum(D,d=>d.montant)+fx*moisActifs.size;
  $("yDep").textContent=eur(dep);$("yDepSub").textContent=`dont ${eur(sum(D,d=>d.montant))} variables`;
  const E=S.epargneLog.filter(x=>(x.date||"").startsWith(y));$("yEp").textContent=eur(sum(E,x=>x.montant));
  $("yEpSub").textContent=net?`${Math.round(sum(E,x=>x.montant)/net*100)} % de tes revenus`:"";

  // heures nécessaires
  const nh=netHoraire(), besoin=fx+avgVar();
  if(nh&&besoin>0){const hm=besoin/nh.v;$("hNeed").textContent=Math.ceil(hm)+" h / mois";
    $("hNeedSub").textContent=`≈ ${Math.ceil(hm/4.33)} h par semaine, soit ${(hm/4.33/8).toLocaleString("fr-BE",{maximumFractionDigits:1})} jours de 8 h. Base : ${eur(besoin)} de dépenses mensuelles et ${eur2(nh.v)} net/h (${nh.src}).`}
  else{$("hNeed").textContent="—";$("hNeedSub").textContent="Ajoute des paies avec heures (ou un taux de mission) et tes charges pour le calcul."}

  // simulateur
  const sT=$("simT");if(!sT.value&&!sT.dataset.touched){const m=[...S.missions].reverse().find(m=>+m.taux>0);if(m)sT.value=m.taux}
  const sh=+$("simH").value||0, st=+sT.value||0, sw=+$("simW").value||0;
  if(sh&&st&&sw){const brut=sh*st*sw, n=brut*R.ratio/100, perM=sh*st*4.33*R.ratio/100;
    $("simRes").innerHTML=`Sur ${sw} semaine${sw>1?"s":""} : <b>${eur(n)}</b> net<br><small>${eur(brut)} brut × ${R.ratio} % · ≈ ${eur(perM)} net par mois · il te resterait ≈ ${eur(perM-besoin)} / mois après dépenses</small>`}
  else $("simRes").textContent="Entre les heures et le taux pour estimer ce qu'une mission te rapporte.";

  // par agence
  const ag={};P.forEach(p=>{const m=S.missions.find(x=>x.id===p.mission);const n=m?(m.agence||"?"):"Sans mission";(ag[n]=ag[n]||{n:0,h:0,c:0});ag[n].n+=+p.montant||0;ag[n].h+=+p.heures||0;ag[n].c++});
  const al=Object.entries(ag).sort((a,b)=>b[1].n-a[1].n);
  $("parAgence").innerHTML=al.length?al.map(([n,v])=>`<div class="cat"><span>${esc(n)} <small style="color:var(--mut)">· ${v.c} paie(s)${v.h?" · "+v.h+" h":""}</small></span><b>${eur(v.n)}</b></div><div class="bar" style="margin-top:4px;height:6px"><i style="width:${v.n/al[0][1].n*100}%"></i></div>`).join(""):`<div class="empty">Aucune paie en ${y}</div>`;

  // mois par mois
  const nowK=mkey(new Date());let rows="";const first=[...moisActifs].sort()[0]||nowK;
  for(let i=0;i<12;i++){const k=y+"-"+String(i+1).padStart(2,"0");const x=monthData(k);const act=moisActifs.has(k);if(!act&&(k>nowK||k<first))continue;
    const rev=x.recu+x.att, dd=act?x.dep:0;
    rows+=`<tr class="${k===nowK?"cur":""}"><td>${new Date(k+"-15").toLocaleDateString("fr-BE",{month:"short"})}</td><td>${rev?eur(rev):"—"}</td><td>${dd?eur(dd):"—"}</td><td class="${rev-dd<0?"out":rev-dd>0?"pos":""}">${rev||dd?eur(rev-dd):"—"}</td></tr>`}
  $("parMois").innerHTML=rows?`<table class="mt"><tr><th>Mois</th><th>Revenus</th><th>Dépenses</th><th>Solde</th></tr>${rows}</table>`:`<div class="empty">Rien en ${y}</div>`;
}

/* ---------- outils intérim ---------- */
function paques(y){const a=y%19,b=Math.floor(y/100),c=y%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451),mo=Math.floor((h+l-7*m+114)/31),da=((h+l-7*m+114)%31)+1;return new Date(y,mo-1,da,12)}
const iso=d=>d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
function feries(y){const p=paques(y),add=n=>{const d=new Date(p);d.setDate(d.getDate()+n);return iso(d)};
  return {[y+"-01-01"]:"Nouvel An",[add(1)]:"Lundi de Pâques",[y+"-05-01"]:"Fête du Travail",[add(39)]:"Ascension",[add(50)]:"Lundi de Pentecôte",[y+"-07-21"]:"Fête nationale",[y+"-08-15"]:"Assomption",[y+"-11-01"]:"Toussaint",[y+"-11-11"]:"Armistice",[y+"-12-25"]:"Noël"}}
const brutDe=p=>(p.detail&&+p.detail.brut)||(+p.montant||0)/((+S.reglages.ratio||78)/100);
function periodeStats(a,b){ // a,b = "YYYY-MM-DD" inclus
  const P=S.paies.filter(p=>p.date>=a&&p.date<=b), T=S.pointage.filter(x=>x.date>=a&&x.date<=b&&+x.heures>0);
  const brut=sum(P,brutDe), hP=sum(P,p=>p.heures), hT=sum(T,x=>x.heures);
  const jours=T.length?new Set(T.map(x=>x.date)).size:Math.round(hP/7.6);
  return{brut,heures:Math.max(hP,hT),jours,estime:!T.length,nbPaies:P.length};
}
function renderOutils(){
  const R=S.reglages,t=today(),now=new Date();
  // calendrier du mois affiché
  const y=cur.getFullYear(),m=cur.getMonth(),dim=new Date(y,m+1,0).getDate(),first=(new Date(y,m,1).getDay()+6)%7,F=feries(y);
  const k=mkey(cur);const byDay={};S.pointage.filter(x=>x.date.startsWith(k)).forEach(x=>byDay[x.date]=(byDay[x.date]||0)+(+x.heures||0));
  let cal=`<div class="cal">${["L","M","M","J","V","S","D"].map(d=>`<div class="h">${d}</div>`).join("")}`;
  for(let i=0;i<first;i++)cal+=`<div></div>`;
  for(let d=1;d<=dim;d++){const ds=k+"-"+String(d).padStart(2,"0");const mis=S.missions.some(mm=>(!mm.debut||mm.debut<=ds)&&(!mm.fin||mm.fin>=ds));const h=byDay[ds];
    cal+=`<div class="d ${h?"w":mis?"mis":""} ${ds===t?"today":""} ${F[ds]?"fer":""}" data-day="${ds}" title="${F[ds]||""}">${d}${h?`<small>${h}h</small>`:""}</div>`}
  $("calendar").innerHTML=cal+"</div>";
  const hm=sum(Object.values(byDay),x=>x),jm=Object.keys(byDay).length,fm=Object.entries(F).filter(([d])=>d.startsWith(k));
  $("calSub").innerHTML=`${jm} jour(s) pointé(s) · ${hm} h${fm.length?` · Férié${fm.length>1?"s":""} : ${fm.map(([d,n])=>fmtD(d)+" ("+n+")").join(", ")}`:""}<br><small>Touche un jour pour pointer tes heures. Rouge = travaillé, foncé = en mission, point jaune = férié payé.</small>`;

  // prime de fin d'année (période 1/7 → 30/6, versée en décembre)
  const yS=now.getMonth()>=6?now.getFullYear():now.getFullYear()-1;
  const cA=yS+"-07-01",cB=(yS+1)+"-06-30",pA=(yS-1)+"-07-01",pB=yS+"-06-30";
  const C=periodeStats(cA,cB),P=periodeStats(pA,pB);
  const bloc=(st,a,b,pay,enCours)=>{const okJ=st.jours>=65,okH=st.heures>=494,ok=okJ||okH,prog=Math.min(100,Math.max(st.jours/65,st.heures/494)*100),pb=st.brut*0.0833;
    return `<div class="k">${enCours?"Période en cours":"Période terminée"} : ${fmtD(a)} ${a.slice(0,4)} → ${fmtD(b)} ${b.slice(0,4)}</div>
    <div class="top" style="display:flex;justify-content:space-between;margin-top:6px"><b>${st.jours} j${st.estime?"*":""} · ${st.heures} h</b><span class="${ok?"pos":"pend"}" style="font-weight:800">${ok?"✓ Droit ouvert":enCours?`encore ${Math.max(0,65-st.jours)} j ou ${Math.max(0,494-st.heures)} h`:"✗ Conditions non atteintes"}</span></div>
    <div class="bar"><i style="width:${prog}%;background:${ok?"var(--pos)":"var(--acc)"}"></i></div>
    <div class="sub" style="margin-top:6px">${ok||enCours?`Prime ${ok?"":"estimée si le droit s'ouvre "}: <b style="color:var(--txt)">${eur(pb)} brut</b> ≈ ${eur(pb*0.66)} net · versée en ${pay}`:""}</div>`};
  $("primeCard").innerHTML=(P.nbPaies?bloc(P,pA,pB,"décembre "+yS,false)+`<div style="height:14px"></div>`:"")+bloc(C,cA,cB,"décembre "+(yS+1),true)+
    `<p class="sub" style="margin-top:10px">Règle : 65 jours ou 494 heures comme intérimaire entre le 1er juillet et le 30 juin. Prime = 8,33 % du brut gagné, payée par le Fonds social des intérimaires.${(C.estime||P.estime)?" *Jours estimés depuis tes heures payées : pointe tes jours pour un compte exact.":""}</p>`;

  // pécule de vacances
  if(R.statut==="employe")$("peculeCard").innerHTML=`<div class="okbox">En tant qu'employé intérimaire, ton pécule (15,34 %) est déjà ajouté à chaque paie par l'agence.</div>`;
  else{const yN=now.getFullYear(),b1=periodeStats((yN-1)+"-01-01",(yN-1)+"-12-31").brut,b0=periodeStats(yN+"-01-01",yN+"-12-31").brut;
    const pc=b=>b*1.08*0.1538;
    $("peculeCard").innerHTML=`<div class="grid"><div class="card" style="background:var(--card2);margin:0"><div class="k">Mai-juin ${yN}</div><div class="v" style="font-size:20px">${b1?eur(pc(b1)):"—"}</div><div class="sub">sur ${eur(b1)} brut ${yN-1}</div></div>
      <div class="card" style="background:var(--card2);margin:0"><div class="k">Mai-juin ${yN+1}</div><div class="v" style="font-size:20px">${b0?eur(pc(b0)):"—"}</div><div class="sub">déjà ${eur(b0)} brut en ${yN}</div></div></div>
      <p class="sub" style="margin-top:10px">Ouvrier : 15,38 % du brut de l'année précédente porté à 108 %, versé par l'ONVA en mai ou juin (montant brut, retenues ensuite). Pense à donner ton numéro de compte à l'ONVA.</p>`}

  // chèques-repas
  const lots=S.cr.map(l=>{const e=new Date(l.date+"T12:00");e.setFullYear(e.getFullYear()+1);return{...l,exp:iso(e),reste:(+l.nb||0)-(+l.used||0)}}).filter(l=>l.reste>0);
  const valid=lots.filter(l=>l.exp>=t),tot=sum(valid,l=>l.reste*(+l.valeur||0)),nb=sum(valid,l=>l.reste);
  const soon=valid.filter(l=>daysTo(l.exp)<=30);
  $("crCard").innerHTML=lots.length?`<div style="display:flex;justify-content:space-between;align-items:baseline"><div><div class="k">Disponible</div><div class="v pos">${eur2(tot)}</div></div><div class="sub">${nb} chèque(s)</div></div>
    ${soon.length?`<div class="warnbox" style="margin-top:10px">⏳ ${sum(soon,l=>l.reste)} chèque(s) expirent avant le ${fmtD(soon.map(l=>l.exp).sort()[0])} : utilise-les en priorité !</div>`:""}
    ${lots.sort((a,b)=>a.exp.localeCompare(b.exp)).map(l=>row("cheques:"+l.id,`<b>${l.reste} × ${eur2(l.valeur)}</b><small>reçus le ${fmtD(l.date)} · ${l.exp<t?"<span style='color:var(--bad)'>expirés</span>":"expirent le "+new Date(l.exp+"T12:00").toLocaleDateString("fr-BE")}</small>`,`<button class="btn sec sm" data-cruse="${l.id}">−1</button>`)).join("")}`
    :`<div class="empty">Ajoute tes chèques-repas (ou scanne ta fiche de paie) pour suivre ton solde et leur date d'expiration (12 mois).</div>`;

  // dettes
  const ouv=S.dettes.filter(x=>!x.regle),regl=S.dettes.filter(x=>x.regle);
  const onMe=sum(ouv.filter(x=>x.sens==="du"),x=>x.montant),jeDois=sum(ouv.filter(x=>x.sens==="dois"),x=>x.montant);
  $("dettes").innerHTML=S.dettes.length?`<div class="two" style="margin-bottom:6px"><div><div class="k">On me doit</div><div class="v pos" style="font-size:20px">${eur(onMe)}</div></div><div><div class="k">Je dois</div><div class="v out" style="font-size:20px">${eur(jeDois)}</div></div></div>
    ${[...ouv,...regl.slice(-5)].map(x=>row("dette:"+x.id,`<b style="${x.regle?"text-decoration:line-through;opacity:.5":""}">${esc(x.personne)}</b><small>${x.sens==="du"?"me doit":"je lui dois"} · ${fmtD(x.date)}${x.note?" · "+esc(x.note):""}</small>`,`<span class="amt ${x.sens==="du"?"pos":"out"}">${eur2(x.montant)}</span>${x.regle?"":`<button class="btn sec sm" data-regle="${x.id}">✓</button>`}`)).join("")}`
    :`<div class="empty">Prêté 20 € à un collègue ? Note-le ici pour ne pas oublier.</div>`;

  // défi 52 semaines
  const done=new Set(S.defi),tDefi=sum([...done],n=>n);
  $("defi").innerHTML=`<p class="sub" style="margin-bottom:10px">Semaine 1 : 1 €, semaine 2 : 2 €… jusqu'à 52 €. Au bout d'un an : <b style="color:var(--txt)">1 378 €</b>. Touche une case quand c'est mis de côté.</p>
    <div class="defi">${Array.from({length:52},(_,i)=>`<button class="${done.has(i+1)?"on":""}" data-defi="${i+1}">${i+1}</button>`).join("")}</div>
    <div class="bar" style="margin-top:12px"><i style="width:${tDefi/1378*100}%"></i></div><div class="sub" style="margin-top:6px">${eur(tDefi)} épargnés · ${done.size}/52 semaines</div>`;
}

function renderExtras(M,k){
  const t=today();
  // comparaison même mois année passée
  const kN1=(+k.slice(0,4)-1)+k.slice(4),N1=monthData(kN1);
  if(N1.var_>0&&M.var_>0){const dlt=(M.var_-N1.var_)/N1.var_*100;$("depSub").innerHTML+=`<br><span style="color:${dlt>0?"var(--out)":"var(--pos)"}">${dlt>0?"▲":"▼"} ${Math.abs(Math.round(dlt))} % vs ${new Date(kN1+"-15").toLocaleDateString("fr-BE",{month:"short",year:"numeric"})}</span>`}
  // semaine
  const d7=new Date();d7.setDate(d7.getDate()-6);const d14=new Date();d14.setDate(d14.getDate()-13);const a7=iso(d7),a14=iso(d14);
  const W=S.depenses.filter(x=>x.date>=a7&&x.date<=t&&!x.fixe),W0=S.depenses.filter(x=>x.date>=a14&&x.date<a7&&!x.fixe),Pw=S.paies.filter(p=>p.date>=a7&&p.date<=t);
  $("weekCard").hidden=!(W.length||Pw.length);
  if(W.length||Pw.length){const tw=sum(W,x=>x.montant),t0=sum(W0,x=>x.montant),cc={};W.forEach(x=>cc[x.cat]=(cc[x.cat]||0)+(+x.montant||0));const top=Object.entries(cc).sort((a,b)=>b[1]-a[1])[0];
    $("weekBody").innerHTML=`<div class="two" style="margin-top:8px"><div><div class="sub">Dépensé (7 j)</div><div class="v out" style="font-size:20px">${eur(tw)}</div>${t0?`<div class="sub" style="color:${tw>t0?"var(--out)":"var(--pos)"}">${tw>t0?"▲":"▼"} ${eur(Math.abs(tw-t0))} vs sem. passée</div>`:""}</div><div><div class="sub">Reçu (7 j)</div><div class="v pos" style="font-size:20px">${eur(sum(Pw,p=>p.montant))}</div>${top?`<div class="sub">Top : ${esc(top[0])} ${eur(top[1])}</div>`:""}</div></div>`}
  // donut catégories
  const c={};M.d.forEach(x=>c[x.cat]=(c[x.cat]||0)+(+x.montant||0));let ce=Object.entries(c).sort((a,b)=>b[1]-a[1]);
  if(ce.length>5){const rest=ce.slice(5).reduce((a,x)=>a+x[1],0);ce=ce.slice(0,5).concat([["Autres",rest]])}
  const tot=sum(ce,x=>x[1]),col=["#ef233c","#f4f4f5","#ff8a95","#9a9aa5","#b8121f","#5a5a63"];
  if(tot>0){let acc=0;const r=42,C=2*Math.PI*r;
    const arcs=ce.map(([n,v],i)=>{const len=v/tot*C,el=`<circle r="${r}" cx="60" cy="60" fill="none" stroke="${col[i]}" stroke-width="18" stroke-dasharray="${len} ${C-len}" stroke-dashoffset="${-acc}" transform="rotate(-90 60 60)"/>`;acc+=len;return el}).join("");
    $("donut").innerHTML=`<div style="display:flex;align-items:center;gap:14px;margin:10px 0 4px"><svg viewBox="0 0 120 120" width="120" height="120" style="flex:none">${arcs}<text x="60" y="58" text-anchor="middle" fill="#f4f4f5" font-size="15" font-weight="800">${eur(tot)}</text><text x="60" y="74" text-anchor="middle" fill="#9a9aa5" font-size="9">ce mois</text></svg>
      <div style="flex:1;font-size:12px">${ce.map(([n,v],i)=>`<div style="display:flex;justify-content:space-between;gap:6px;padding:2px 0"><span><i style="display:inline-block;width:9px;height:9px;border-radius:3px;background:${col[i]};margin-right:6px"></i>${esc(n)}</span><b>${Math.round(v/tot*100)}%</b></div>`).join("")}</div></div>`}
  else $("donut").innerHTML="";
}

function renderPrevision(){
  const n=new Date();const nx=new Date(n.getFullYear(),n.getMonth()+1,1),kx=mkey(nx),start=kx+"-01";
  const cont=S.missions.filter(m=>(!m.fin||m.fin>=start)&&(!m.debut||m.debut<=kx+"-28"));
  const mois=[];for(let i=1;i<=3;i++){const d=new Date(n.getFullYear(),n.getMonth()-i+1,1);const x=monthData(mkey(d));if(x.recu+x.att>0)mois.push(x.recu+x.att)}
  let rev=0,src="";
  if(cont.length){const P28=S.pointage.filter(x=>x.date>=iso(new Date(Date.now()-28*864e5))),wk=new Set(P28.map(x=>{const d=new Date(x.date+"T12:00");d.setDate(d.getDate()-((d.getDay()+6)%7));return iso(d)}));
    const h=wk.size?sum(P28,x=>x.heures)/wk.size:38;const m=cont.find(x=>+x.taux>0);
    if(m){rev=h*4.33*m.taux*S.reglages.ratio/100;src=`${Math.round(h)} h/sem × ${eur2(m.taux)} brut`}else if(mois.length){rev=sum(mois,x=>x)/mois.length;src="moyenne de tes derniers mois"}}
  const dep=fixesTotal()+avgVar();
  $("prevNet").textContent=cont.length?eur(rev-dep):"⚠ Aucune mission";
  $("prevNet").className="v "+(cont.length?(rev-dep>=0?"pos":"out"):"pend");
  $("prevSub").textContent=cont.length?`${nx.toLocaleDateString("fr-BE",{month:"long"})} : ≈ ${eur(rev)} de revenus (${src}) − ≈ ${eur(dep)} de dépenses.${cont.some(m=>m.fin&&m.fin<kx+"-28")?" ⚠ Une mission se termine pendant le mois.":""}`:`Aucune mission prévue en ${nx.toLocaleDateString("fr-BE",{month:"long"})}. Charges à couvrir : ≈ ${eur(dep)} (ton coussin couvre ${fixesTotal()?(S.reglages.epargne/dep).toLocaleString("fr-BE",{maximumFractionDigits:1}):"?"} mois).`;
  // courbe épargne
  const L=[...S.epargneLog].sort((a,b)=>a.date.localeCompare(b.date));
  if(L.length<2){$("epCurve").innerHTML=`<div class="empty">Fais au moins 2 versements pour voir la courbe.</div>`;return}
  let c=0;const pts=L.map(x=>{c+=+x.montant||0;return[x.date,c]}),mx=Math.max(...pts.map(p=>p[1]),1),mn=Math.min(0,...pts.map(p=>p[1]));
  const W=320,H=110,xs=i=>i/(pts.length-1)*W,ys=v=>H-(v-mn)/(mx-mn||1)*H;
  const line=pts.map((p,i)=>`${xs(i).toFixed(1)},${ys(p[1]).toFixed(1)}`).join(" ");
  $("epCurve").innerHTML=`<svg viewBox="-4 -8 ${W+8} ${H+26}" width="100%"><polygon points="0,${H} ${line} ${W},${H}" fill="rgba(239,35,60,.15)"/><polyline points="${line}" fill="none" stroke="#ef233c" stroke-width="2.5" stroke-linejoin="round"/>
    <text x="0" y="${H+18}" fill="#9a9aa5" font-size="10">${fmtD(pts[0][0])}</text><text x="${W}" y="${H+18}" fill="#9a9aa5" font-size="10" text-anchor="end">${fmtD(pts[pts.length-1][0])} · ${eur(c)}</text></svg>`;
}

/* ---------- réglages, PIN, mode discret, rappels ---------- */
const LS={get:(k,d)=>{try{const v=localStorage.getItem(k);return v==null?d:JSON.parse(v)}catch(e){return d}},set:(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}};
function renderSettings(){
  $("catList").innerHTML=cats().map(c=>`<button type="button" data-delcat="${esc(c)}">${esc(c)}</button>`).join("");
  $("pinState").textContent=LS.get("pinHash",null)?"Activé : l'appli demande ton code à l'ouverture (sur ce téléphone).":"Désactivé.";
  $("bPin").textContent=LS.get("pinHash",null)?"🔓 Retirer le code PIN":"🔒 Activer un code PIN";
  const np=("Notification" in window)?Notification.permission:"unsupported";
  $("notifState").textContent=np==="granted"?"Activés : factures à payer, fins de mission, prélèvements, chèques-repas qui expirent.":np==="denied"?"Bloqués dans les réglages du téléphone/navigateur.":np==="unsupported"?"Non pris en charge sur cet appareil.":"Désactivés.";
  $("bNotif").hidden=np==="granted"||np==="unsupported";
  const lb=LS.get("lastBackup",null);$("lastBackup").textContent=lb?"dernière copie le "+new Date(lb).toLocaleDateString("fr-BE")+".":"aucune copie pour l'instant.";
}
$("fCat").onsubmit=e=>{e.preventDefault();e.stopPropagation();const v=$("catNew").value.trim().slice(0,30);if(!v)return;if(cats().includes(v)){toast("Existe déjà");return}S.cats=[...cats(),v];$("catNew").value="";save();toast("Catégorie ajoutée")};
// mode discret
function applyDiscret(){document.body.classList.toggle("discret",!!LS.get("discret",false));$("bDiscret").textContent=LS.get("discret",false)?"🙈":"👁"}
$("bDiscret").onclick=()=>{LS.set("discret",!LS.get("discret",false));applyDiscret()};applyDiscret();
// code PIN (haché, stocké sur l'appareil)
async function hashPin(p){const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode("budget-interim:"+p));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("")}
let pinBuf="",pinMode=null,pinFirst="";
function showPad(mode){pinMode=mode;pinBuf="";$("lock").hidden=false;$("pinMsg").textContent=mode==="set1"?"Choisis un code à 4 chiffres":mode==="set2"?"Confirme ton code":"";drawPin();
  $("pinPad").innerHTML=[1,2,3,4,5,6,7,8,9,"",0,"⌫"].map(k=>k===""?"<div></div>":`<button type="button" data-pin="${k}">${k}</button>`).join("")+(mode!=="unlock"?`<button type="button" data-pin="x" style="grid-column:1/-1;border-radius:14px;height:48px;font-size:15px">Annuler</button>`:"")}
function drawPin(){$("pinDots").textContent="●".repeat(pinBuf.length)+"○".repeat(4-pinBuf.length)}
$("pinPad").onclick=async e=>{const b=e.target.closest("[data-pin]");if(!b)return;const k=b.dataset.pin;
  if(k==="x"){$("lock").hidden=true;return}
  if(k==="⌫"){pinBuf=pinBuf.slice(0,-1);drawPin();return}
  if(pinBuf.length<4)pinBuf+=k;drawPin();if(pinBuf.length<4)return;
  if(pinMode==="unlock"){if(await hashPin(pinBuf)===LS.get("pinHash","")){$("lock").hidden=true;LS.set("pinTries",0)}else{pinBuf="";setTimeout(drawPin,200);$("pinMsg").textContent="Code incorrect"}}
  else if(pinMode==="set1"){pinFirst=pinBuf;showPad("set2")}
  else if(pinMode==="set2"){if(pinBuf===pinFirst){LS.set("pinHash",await hashPin(pinBuf));$("lock").hidden=true;renderSettings();toast("Code PIN activé 🔒")}else{showPad("set1");$("pinMsg").textContent="Les codes ne correspondent pas, recommence"}}
};
$("bPin").onclick=()=>{if(LS.get("pinHash",null)){LS.set("pinHash",null);renderSettings();toast("Code PIN retiré")}else showPad("set1")};
let hiddenAt=0;document.addEventListener("visibilitychange",()=>{if(document.hidden)hiddenAt=Date.now();else if(LS.get("pinHash",null)&&hiddenAt&&Date.now()-hiddenAt>3*60e3)showPad("unlock")});
if(LS.get("pinHash",null))showPad("unlock");
// rappels : calculés ici, stockés pour le service worker (notifications même appli fermée si le téléphone le permet)
function rappels(){const t=today(),L=[],add=(id,date,title,body)=>L.push({id,date,title,body});
  S.depenses.filter(x=>x.paye===false&&x.echeance).forEach(x=>{const d=new Date(x.echeance+"T12:00");d.setDate(d.getDate()-3);add("f3-"+x.id,iso(d),"🧾 Facture à payer",`${x.note||x.cat} : ${eur2(x.montant)} avant le ${fmtD(x.echeance)}`);add("f0-"+x.id,x.echeance,"⚠️ Facture à payer aujourd'hui",`${x.note||x.cat} : ${eur2(x.montant)}`)});
  S.missions.filter(m=>m.fin&&m.fin>=t).forEach(m=>{const d=new Date(m.fin+"T12:00");d.setDate(d.getDate()-3);add("m-"+m.id+m.fin,iso(d),"🏭 Fin de mission bientôt",`${m.client||m.agence} se termine le ${fmtD(m.fin)}. Pense à relancer ton agence.`)});
  const n=new Date();S.fixes.filter(f=>+f.jour>0).forEach(f=>{for(const off of [0,1]){const d=new Date(n.getFullYear(),n.getMonth()+off,+f.jour-1,12);add("p-"+f.id+iso(d),iso(d),"🔁 Prélèvement demain",`${f.nom} : ${eur2(f.montant)}`)}});
  S.cr.forEach(l=>{const e=new Date(l.date+"T12:00");e.setFullYear(e.getFullYear()+1);e.setDate(e.getDate()-14);if((+l.nb||0)-(+l.used||0)>0)add("cr-"+l.id,iso(e),"🍽️ Chèques-repas","Des chèques-repas expirent dans 2 semaines.")});
  return L.filter(x=>x.date>=iso(new Date(Date.now()-864e5)))}
async function syncRappels(){try{if(!("caches" in window))return;const c=await caches.open("rappels");await c.put("rappels.json",new Response(JSON.stringify(rappels()),{headers:{"content-type":"application/json"}}))}catch(e){}}
async function notifierMaintenant(){if(!("Notification" in window)||Notification.permission!=="granted")return;const t=today(),vus=LS.get("notifVus",[]);
  const reg=await navigator.serviceWorker?.getRegistration?.();const due=rappels().filter(x=>x.date<=t&&!vus.includes(x.id));
  for(const r of due.slice(0,3)){try{reg?reg.showNotification(r.title,{body:r.body,icon:"icon-192.png",badge:"icon-192.png",tag:r.id}):new Notification(r.title,{body:r.body,icon:"icon-192.png"})}catch(e){}vus.push(r.id)}
  LS.set("notifVus",vus.slice(-300))}
$("bNotif").onclick=async()=>{if(!("Notification" in window))return;const p=await Notification.requestPermission();
  if(p==="granted"){try{const reg=await navigator.serviceWorker.ready;if(reg.periodicSync)await reg.periodicSync.register("rappels",{minInterval:12*3600e3})}catch(e){}syncRappels();notifierMaintenant();toast("Rappels activés 🔔")}renderSettings()};
// raccourcis (appui long sur l'icône)
function raccourci(){const a=new URLSearchParams(location.search).get("a");if(!a)return;history.replaceState(null,"",location.pathname);
  if(a==="depense")openSheet("depense");else if(a==="pointage")openSheet("pointage");
  else if(a==="facture")pickSource("Scanner une facture / un ticket",f=>scanFacture(f));else if(a==="paie")pickSource("Scanner une fiche de paie",f=>scanFile(f))}

/* ---------- assistant IA ---------- */
function resumeDonnees(){
  const R=S.reglages,L=[];
  L.push(`Aujourd'hui : ${today()}. Statut : intérimaire ${R.statut} en Belgique. Épargne (coussin) : ${eur2(R.epargne)}. Objectif d'épargne par paie : ${R.pct} %. Ratio net/brut : ${R.ratio} %.`);
  L.push("Charges fixes mensuelles : "+(S.fixes.map(f=>`${f.nom} ${eur2(f.montant)}`).join(", ")||"aucune")+` (total ${eur2(fixesTotal())}).`);
  if(Object.keys(S.budgets).length)L.push("Budgets mensuels : "+Object.entries(S.budgets).map(([c,v])=>`${c} ${eur(v)}`).join(", "));
  if(S.objectifs.length)L.push("Objectifs : "+S.objectifs.map(o=>`${o.nom} ${eur(o.actuel||0)}/${eur(o.cible)}${o.echeance?" pour le "+o.echeance:""}`).join(", "));
  const act=S.missions.filter(m=>!m.fin||m.fin>=today());L.push("Missions en cours/à venir : "+(act.map(m=>`${m.client||""} (${m.agence}) ${m.taux?m.taux+" €/h brut":""} ${m.debut||""}→${m.fin||"?"}`).join("; ")||"aucune"));
  const ms=[];for(let i=0;i<6;i++){const d=new Date();d.setDate(1);d.setMonth(d.getMonth()-i);const k=mkey(d),x=monthData(k),c={};x.d.forEach(e=>c[e.cat]=(c[e.cat]||0)+(+e.montant||0));
    ms.push(`${k} : revenus ${eur(x.recu+x.att)}, dépenses variables ${eur(x.var_)} [${Object.entries(c).map(([n,v])=>n+" "+eur(v)).join(", ")}]`)}
  L.push("Par mois :\n"+ms.join("\n"));
  const tx=[...S.paies.map(p=>`${p.date};PAIE;+${p.montant};${p.heures||""}h`),...S.depenses.map(d=>`${d.date};DEPENSE;-${d.montant};${d.cat};${(d.note||"").slice(0,30)}${d.paye===false?";À PAYER":""}`)].sort().reverse().slice(0,250);
  L.push("Transactions récentes (date;type;montant;catégorie;note) :\n"+tx.join("\n"));
  if(S.dettes.some(x=>!x.regle))L.push("Dettes : "+S.dettes.filter(x=>!x.regle).map(x=>`${x.personne} ${x.sens==="du"?"me doit":"je dois"} ${eur2(x.montant)}`).join(", "));
  return L.join("\n");
}
const STYLE_IA="Réponds en français, en tutoyant, de façon simple et concrète, avec des montants précis tirés des données. Pas de titres markdown (#), pas de tableaux. Utilise quelques emojis. Ne donne pas de conseil d'investissement financier.";
async function askIA(prompt,out,onDone){
  if(!textModel){out.textContent="L'assistant n'est pas disponible.";return}
  out.innerHTML=`<span class="spin"></span>Réflexion…`;
  try{const res=await textModel.generateContent(prompt);const t=res.response.text().replace(/\*\*(.+?)\*\*/g,"$1").replace(/^#+\s*/gm,"").trim();out.textContent=t;onDone&&onDone(t)}
  catch(e){console.error(e);out.textContent=aiErr(e)}
}
$("bConseil").onclick=()=>{const o=$("conseilOut");o.hidden=false;
  askIA(`Tu es un conseiller budget bienveillant pour un intérimaire. Voici ses données :\n${resumeDonnees()}\n\nAnalyse son mois en cours (comparé aux précédents) et donne-lui : 1 phrase de bilan, puis 4 conseils concrets et chiffrés (où économiser, combien mettre de côté, risque de fin de mission, factures à payer…). 120 mots maximum. ${STYLE_IA}`,o)};
let chatHist=[];
const SUGG=["Combien j'ai dépensé en resto ce mois ?","Je peux m'acheter un truc à 300 € ?","Où est-ce que je peux économiser ?","Combien il me reste jusqu'à la fin du mois ?"];
$("chatSugg").innerHTML=SUGG.map(q=>`<button type="button" data-ask="${esc(q)}">${esc(q)}</button>`).join("");
function chatSend(q){if(!q)return;const log=$("chatLog");
  log.insertAdjacentHTML("beforeend",`<div class="msg me">${esc(q)}</div>`);const a=document.createElement("div");a.className="msg ai";log.appendChild(a);
  const hist=chatHist.slice(-6).map(h=>`${h.r==="u"?"Utilisateur":"Assistant"} : ${h.t}`).join("\n");
  askIA(`Tu es l'assistant de l'appli Budget Intérim. Données de l'utilisateur :\n${resumeDonnees()}\n\n${hist?"Conversation précédente :\n"+hist+"\n\n":""}Question : ${q}\n\nRéponds en 80 mots maximum. ${STYLE_IA}`,a,t=>{chatHist.push({r:"u",t:q},{r:"a",t});a.scrollIntoView({block:"nearest"})});
  $("chatSugg").hidden=true}
$("fChat").onsubmit=e=>{e.preventDefault();e.stopPropagation();const q=$("chatIn").value.trim();$("chatIn").value="";chatSend(q)};

// plusieurs tickets d'un coup
let multiRes=[];
async function scanMany(files){
  if(!model){toast("Scan indisponible");return}
  multiRes=[];openRaw(`<h3>Lecture de ${files.length} document(s) <button class="del" data-close>×</button></h3><div class="est" id="multiProg"><span class="spin"></span>0 / ${files.length}</div>`);
  const ctl=scanCtl=new AbortController();
  for(let i=0;i<files.length;i++){if(ctl.signal.aborted)return;
    try{const img=await toJpegB64(files[i]);const res=await model.generateContent([promptFact(),{inlineData:img}]);const r=parseJSON(res.response.text());
      if(r&&!r.erreur&&r.montant_total){if(!cats().includes(r.categorie))r.categorie=cats()[cats().length-1];if(!r.date||!/^\d{4}-\d{2}-\d{2}$/.test(r.date))r.date=today();
        r.montant_total=Math.abs(+r.montant_total);r.lignes=Array.isArray(r.lignes)?r.lignes.slice(0,15):[];multiRes.push({r,file:files[i]})}
    }catch(e){console.error(e);if(i===0){openRaw(`<h3>Lecture impossible <button class="del" data-close>×</button></h3><div class="est">${esc(aiErr(e))}</div>`);return}}
    if($("multiProg"))$("multiProg").innerHTML=`<span class="spin"></span>${i+1} / ${files.length}`}
  if(scanCtl===ctl)scanCtl=null;
  if(!multiRes.length){openRaw(`<h3>Oups <button class="del" data-close>×</button></h3><div class="est">Aucun ticket ni facture reconnu.</div>`);return}
  openRaw(`<h3>${multiRes.length} document(s) lu(s) <button class="del" data-close>×</button></h3>
    <form data-f="multi">${multiRes.map(({r},i)=>`<div class="chk-row"><input type="checkbox" name="m${i}" checked><div class="l"><b>${esc(r.fournisseur||"?")}</b><small>${fmtD(r.date)} · ${esc(r.categorie)}${r.echeance&&!r.deja_paye?" · à payer avant le "+fmtD(r.echeance):""}</small></div><b class="out">−${eur2(r.montant_total)}</b></div>`).join("")}
    <p class="sub" style="margin:8px 0">Total : ${eur2(sum(multiRes,x=>x.r.montant_total))}. Tu pourras modifier chaque dépense ensuite.</p>
    <button class="btn">Enregistrer la sélection</button></form>`);
}
$("bMulti").onclick=()=>pickSource("Plusieurs tickets / factures",fs=>scanMany(Array.isArray(fs)?fs:[fs]),true);

// relevé bancaire
let releveRes=[];
const PROMPT_RELEVE=()=>`Tu lis un relevé de compte bancaire belge (capture d'écran d'appli comme CBC/KBC, ou PDF d'extrait).
Réponds UNIQUEMENT avec un JSON : {"operations":[{"date":"YYYY-MM-DD","libelle":"bénéficiaire ou description courte","montant":nombre (négatif = sortie, positif = entrée),"categorie":une valeur parmi ${JSON.stringify(cats())},"salaire":true si c'est un salaire / une paie d'agence d'intérim}]}
Maximum 60 opérations. Ignore les soldes et totaux. N'invente rien. Si ce n'est pas un relevé : {"erreur":"explication courte"}.`;
async function scanReleve(f){
  if(!model){toast("Scan indisponible");return}
  openRaw(`<h3>Lecture du relevé <button class="del" data-close>×</button></h3><div class="est"><span class="spin"></span>Gemini lit tes opérations… (10 à 40 s)</div>`);
  const ctl=scanCtl=new AbortController();
  try{const img=await toJpegB64(f);const res=await model.generateContent([PROMPT_RELEVE(),{inlineData:img}]);if(scanCtl!==ctl||ctl.signal.aborted)return;scanCtl=null;
    const r=parseJSON(res.response.text());
    if(!r||r.erreur||!Array.isArray(r.operations)||!r.operations.length){openRaw(`<h3>Oups <button class="del" data-close>×</button></h3><div class="est">${esc(r&&r.erreur||"Aucune opération trouvée.")}</div>`);return}
    releveRes=r.operations.filter(o=>/^\d{4}-\d{2}-\d{2}$/.test(o.date)&&+o.montant).slice(0,60).map(o=>{const m=+o.montant,lib=String(o.libelle||"").slice(0,50);
      const near=(a,b,n)=>Math.abs(new Date(a)-new Date(b))<=n*864e5;
      const dup=m<0?S.depenses.some(d=>near(d.date,o.date,3)&&Math.abs(+d.montant-Math.abs(m))<0.01):S.paies.some(p=>near(p.date,o.date,7)&&Math.abs(+p.montant-m)<0.01);
      const ag=S.missions.some(mi=>mi.agence&&lib.toLowerCase().includes(mi.agence.toLowerCase().split(/[ .]/)[0]));
      return{date:o.date,libelle:lib,montant:m,cat:cats().includes(o.categorie)?o.categorie:cats()[cats().length-1],salaire:!!o.salaire||ag,dup}});
    openRaw(`<h3>${releveRes.length} opération(s) <button class="del" data-close>×</button></h3>
      <p class="sub" style="margin-bottom:6px">Les doublons (déjà dans l'appli) sont décochés. Les entrées d'argent ne sont importées que si ce sont des paies.</p>
      <form data-f="releve">${releveRes.map((o,i)=>`<div class="chk-row"><input type="checkbox" name="o${i}" ${!o.dup&&(o.montant<0||o.salaire)?"checked":""}><div class="l"><b>${esc(o.libelle)}</b><small>${fmtD(o.date)} · ${o.montant>0?(o.salaire?"💶 paie":"entrée"):esc(o.cat)}${o.dup?" · déjà présent":""}</small></div><b class="${o.montant<0?"out":"pos"}">${o.montant>0?"+":""}${eur2(o.montant)}</b></div>`).join("")}
      <button class="btn" style="margin-top:10px">Importer la sélection</button></form>`);
  }catch(e){if(scanCtl!==ctl||ctl.signal.aborted)return;scanCtl=null;console.error(e);openRaw(`<h3>Lecture impossible <button class="del" data-close>×</button></h3><div class="est">${esc(aiErr(e))}</div>`)}
}
$("bReleve").onclick=()=>pickSource("Relevé bancaire (capture ou PDF)",f=>scanReleve(f));

/* ---------- formulaires ---------- */
const COLL={depense:"depenses",paie:"paies",mission:"missions",fixe:"fixes",objectif:"objectifs",pointage:"pointage",dette:"dettes",cheques:"cr"};
const EMOJIS=["🎯","🚗","🏖️","🏠","📱","🎓","💍","🎮","🛠️","🐶"];
function openSheet(type,ctx,item,opts={}){
  const it=item||{}, ed=!!item, V=(k,d="")=>esc(it[k]??d);
  const head=(t)=>`<h3>${t} <button class="del" type="button" data-close>×</button></h3>`;
  const delBtn=ed?`<button type="button" class="btn danger" data-del2="${COLL[type]}:${it.id}" style="margin-top:4px">Supprimer</button>`:"";
  const missOpts=S.missions.map(m=>`<option value="${m.id}" ${(it.mission||ctx)===m.id?"selected":""}>${esc(m.client||m.agence)}</option>`).join("");
  const lastCat=S.depenses.length?S.depenses[S.depenses.length-1].cat:cats()[0];
  const H={
   depense:`${head(ed?"Modifier la dépense":"Nouvelle dépense")}
    <form data-f="depense" data-id="${V("id")}"><label>Montant (€)<input name="montant" type="number" step="0.01" inputmode="decimal" required value="${V("montant")}"></label>
    <label>Catégorie</label><div class="chips" id="catChips">${cats().map(c=>`<button type="button" class="${(it.cat||lastCat)===c?"on":""}" data-cat="${c}">${c}</button>`).join("")}</div>
    <input type="hidden" name="cat" id="catIn" value="${esc(it.cat||lastCat)}">
    <div class="two"><label>Date<input name="date" type="date" value="${V("date",today())}" required></label><label>Note<input name="note" placeholder="ex. Delhaize" value="${V("note")}" list="notesList"></label></div>
    <datalist id="notesList">${[...new Set(S.depenses.map(d=>d.note).filter(Boolean))].slice(-30).map(n=>`<option value="${esc(n)}">`).join("")}</datalist>
    <label class="chk"><input type="checkbox" name="paye" ${it.paye===false?"":"checked"}> Déjà payée</label>
    <label>Échéance (si pas encore payée)<input name="echeance" type="date" value="${V("echeance")}"></label>
    ${it.detail?`<button type="button" class="btn sec" data-fdetail="${it.id}">🧾 Voir le détail du document</button>`:""}
    ${ed?(it.photo?`<div class="two"><button type="button" class="btn sec" data-photo="${it.photo}">🖼️ Voir la photo</button><button type="button" class="btn sec" data-attach="depenses:${it.id}">🔄 Remplacer</button></div>`:`<button type="button" class="btn sec" data-attach="depenses:${it.id}">📎 Joindre une photo / un PDF</button>`):""}
    <button class="btn">${ed?"Enregistrer":"Ajouter"}</button>${delBtn}</form>`,
   paie:`${head(ed?"Modifier la paie":"Nouvelle paie")}
    <form data-f="paie" data-id="${V("id")}">${S.missions.length?`<label>Mission<select name="mission" id="pMis"><option value="">— Aucune —</option>${missOpts}</select></label>`:""}
    <div class="two"><label>Heures prestées<input name="heures" id="pH" type="number" step="0.25" inputmode="decimal" placeholder="ex. 38" value="${V("heures")}"></label><label>Date<input name="date" type="date" value="${V("date",today())}" required></label></div>
    <div class="est" id="pEst">Indique les heures pour une estimation du net.</div>
    <label>Montant net (€)<input name="montant" id="pM" type="number" step="0.01" inputmode="decimal" required value="${V("montant")}" ${ed?'data-touched="1"':""}></label>
    <label>Note<input name="note" placeholder="ex. semaine 45" value="${V("note")}"></label>
    <label class="chk"><input type="checkbox" name="recu" ${!ed||it.recu?"checked":""}> Déjà reçue sur mon compte</label>
    ${it.detail?`<button type="button" class="btn sec" data-detail="${it.id}">📄 Voir le détail de la fiche</button>`:""}
    ${ed?(it.photo?`<div class="two"><button type="button" class="btn sec" data-photo="${it.photo}">🖼️ Voir la photo</button><button type="button" class="btn sec" data-attach="paies:${it.id}">🔄 Remplacer</button></div>`:`<button type="button" class="btn sec" data-attach="paies:${it.id}">📎 Joindre la fiche (photo / PDF)</button>`):""}
    <button class="btn">${ed?"Enregistrer":"Ajouter"}</button>${delBtn}</form>`,
   mission:`${head(ed?"Modifier la mission":"Nouvelle mission")}
    <form data-f="mission" data-id="${V("id")}"><div class="two"><label>Agence<input name="agence" required placeholder="ex. ASAP" value="${V("agence")}" list="agList"></label><label>Client / poste<input name="client" placeholder="ex. Magasinier" value="${V("client")}"></label></div>
    <datalist id="agList">${[...new Set(S.missions.map(m=>m.agence).filter(Boolean))].map(n=>`<option value="${esc(n)}">`).join("")}</datalist>
    <div class="two"><label>Début<input name="debut" type="date" value="${V("debut",today())}"></label><label>Fin prévue<input name="fin" type="date" value="${V("fin")}"></label></div>
    <label>Taux horaire brut (€)<input name="taux" type="number" step="0.0001" inputmode="decimal" value="${V("taux")}"></label>
    <button class="btn">${ed?"Enregistrer":"Ajouter"}</button>${delBtn}</form>`,
   fixe:`${head(ed?"Modifier la charge":"Charge fixe mensuelle")}
    <form data-f="fixe" data-id="${V("id")}"><label>Nom<input name="nom" required placeholder="ex. Loyer" value="${V("nom")}"></label>
    <div class="two"><label>Montant par mois (€)<input name="montant" type="number" step="0.01" inputmode="decimal" required value="${V("montant")}"></label><label>Jour du prélèvement<input name="jour" type="number" min="1" max="31" inputmode="numeric" placeholder="ex. 5" value="${V("jour")}"></label></div>
    <button class="btn">${ed?"Enregistrer":"Ajouter"}</button>${delBtn}</form>`,
   objectif:`${head(ed?"Modifier l'objectif":"Nouvel objectif")}
    <form data-f="objectif" data-id="${V("id")}"><div class="chips" id="emoChips">${EMOJIS.map(e=>`<button type="button" class="${(it.emoji||"🎯")===e?"on":""}" data-emo="${e}">${e}</button>`).join("")}</div>
    <input type="hidden" name="emoji" id="emoIn" value="${esc(it.emoji||"🎯")}">
    <label>Nom<input name="nom" required placeholder="ex. Permis de conduire" value="${V("nom")}"></label>
    <div class="two"><label>Montant visé (€)<input name="cible" type="number" step="0.01" inputmode="decimal" required value="${V("cible")}"></label><label>Déjà de côté (€)<input name="actuel" type="number" step="0.01" inputmode="decimal" value="${V("actuel",0)}"></label></div>
    <label>Pour quand ? (facultatif)<input name="echeance" type="date" value="${V("echeance")}"></label>
    <button class="btn">${ed?"Enregistrer":"Créer l'objectif"}</button>${delBtn}</form>`,
   epargne:`${head(opts.retrait?"Retirer de l'épargne":"Mettre de côté")}
    <form data-f="epargne" data-sign="${opts.retrait?-1:1}"><label>Montant (€)<input name="montant" type="number" step="0.01" inputmode="decimal" required value="${esc(opts.amt||"")}"></label>
    <label>${opts.retrait?"Depuis":"Vers"}<select name="target"><option value="">🛟 Coussin de sécurité (${eur(S.reglages.epargne)})</option>${S.objectifs.map(o=>`<option value="${o.id}" ${opts.target===o.id?"selected":""}>${esc(o.emoji||"🎯")} ${esc(o.nom)} (${eur(o.actuel||0)})</option>`).join("")}</select></label>
    <div class="two"><label>Date<input name="date" type="date" value="${today()}" required></label><label>Note<input name="note" placeholder="facultatif"></label></div>
    <button class="btn">${opts.retrait?"Retirer":"Épargner"}</button>
    ${S.epargneLog.length?`<div class="k" style="margin-top:8px">Derniers mouvements</div>${[...S.epargneLog].reverse().slice(0,6).map(x=>{const o=S.objectifs.find(o=>o.id===x.target);return `<div class="ln"><span>${fmtD(x.date)} · ${o?esc(o.nom):"Coussin"}${x.note?" · "+esc(x.note):""}</span><b class="${x.montant<0?"out":"pos"}">${x.montant>0?"+":""}${eur2(x.montant)}</b></div>`}).join("")}`:""}</form>`,
   budgets:`${head("Budgets par catégorie")}
    <form data-f="budgets"><p class="sub">Plafond mensuel par catégorie. Laisse vide pour ne pas suivre.</p>
    ${cats().map(c=>{const avg=(()=>{let t=0,n=0;for(let i=1;i<=3;i++){const d=new Date();d.setDate(1);d.setMonth(d.getMonth()-i);const x=sum(S.depenses.filter(e=>e.cat===c&&e.date.startsWith(mkey(d))),e=>e.montant);if(x){t+=x;n++}}return n?t/n:0})();
      return `<label style="grid-template-columns:1fr 120px;align-items:center;display:grid">${c}${avg?` <small style="font-weight:400">moy. ${eur(avg)}</small>`:""}<input name="b_${c}" type="number" step="1" inputmode="numeric" value="${esc(S.budgets[c]||"")}" placeholder="—"></label>`}).join("")}
    <button class="btn">Enregistrer</button></form>`,
   pointage:`${head(ed?"Modifier le pointage":"Pointer des heures")}
    <form data-f="pointage" data-id="${V("id")}">${S.missions.length?`<label>Mission<select name="mission">${S.missions.map(m=>`<option value="${m.id}" ${(it.mission||(S.missions.find(mm=>(!mm.fin||mm.fin>=today()))||{}).id)===m.id?"selected":""}>${esc(m.client||m.agence)}</option>`).join("")}</select></label>`:""}
    <div class="two"><label>Date<input name="date" type="date" required value="${esc(it.date||opts.date||today())}"></label><label>Heures<input name="heures" type="number" step="0.25" inputmode="decimal" required value="${V("heures",8)}"></label></div>
    <label>Type d'heures</label><div class="chips" id="typeChips">${[["normal","Normales"],["nuit","Nuit"],["samedi","Samedi"],["dimanche","Dimanche"],["sup","Heures sup"],["ferie","Férié"]].map(([v,l])=>`<button type="button" class="${(it.type||"normal")===v?"on":""}" data-ptype="${v}">${l}</button>`).join("")}</div>
    <input type="hidden" name="type" id="typeIn" value="${esc(it.type||"normal")}">
    ${!ed?`<label class="chk"><input type="checkbox" name="semaine"> Pointer toute la semaine (lun → ven)</label>`:""}
    <button class="btn">${ed?"Enregistrer":"Pointer"}</button>${delBtn}</form>`,
   cheques:`${head(ed?"Modifier les chèques-repas":"Chèques-repas reçus")}
    <form data-f="cheques" data-id="${V("id")}"><div class="two"><label>Nombre<input name="nb" type="number" inputmode="numeric" required value="${V("nb",5)}"></label><label>Valeur faciale (€)<input name="valeur" type="number" step="0.01" inputmode="decimal" required value="${V("valeur",8)}"></label></div>
    <div class="two"><label>Reçus le<input name="date" type="date" required value="${V("date",today())}"></label><label>Déjà utilisés<input name="used" type="number" inputmode="numeric" value="${V("used",0)}"></label></div>
    <button class="btn">${ed?"Enregistrer":"Ajouter"}</button>${delBtn}</form>`,
   dette:`${head(ed?"Modifier":"Dette ou prêt")}
    <form data-f="dette" data-id="${V("id")}"><div class="chips" id="sensChips"><button type="button" class="${(it.sens||"du")==="du"?"on":""}" data-sens="du">💰 On me doit</button><button type="button" class="${it.sens==="dois"?"on":""}" data-sens="dois">💸 Je dois</button></div>
    <input type="hidden" name="sens" id="sensIn" value="${esc(it.sens||"du")}">
    <div class="two"><label>Personne<input name="personne" required value="${V("personne")}"></label><label>Montant (€)<input name="montant" type="number" step="0.01" inputmode="decimal" required value="${V("montant")}"></label></div>
    <div class="two"><label>Date<input name="date" type="date" value="${V("date",today())}"></label><label>Note<input name="note" value="${V("note")}"></label></div>
    ${ed?`<label class="chk"><input type="checkbox" name="regle" ${it.regle?"checked":""}> Réglé</label>`:""}
    <button class="btn">${ed?"Enregistrer":"Ajouter"}</button>${delBtn}</form>`,
   choix:`${head("Ajouter")}
    <div style="display:grid;gap:10px"><button class="btn scanBtn" ${canImg?"":"hidden"}>📷 Scanner une fiche de paie</button><button class="btn scanBtn" data-mode="facture" ${canImg?"":"hidden"}>🧾 Scanner une facture / un ticket</button><button class="btn" data-open="depense">💸 Une dépense</button><button class="btn sec" data-open="paie">💶 Une paie reçue</button><button class="btn sec" data-open="mission">🏭 Une mission</button><button class="btn sec" data-open="fixe">🔁 Une charge fixe</button><button class="btn sec" data-open="epargne">🛟 Mettre de côté</button><button class="btn sec" data-open="objectif">🎯 Un objectif</button><button class="btn sec" data-open="pointage">⏱️ Pointer des heures</button><button class="btn sec" data-open="cheques">🍽️ Chèques-repas</button><button class="btn sec" data-open="dette">🤝 Dette / prêt</button></div>`
  };
  $("sheet").innerHTML=H[type];$("sheetBg").classList.add("open");
  if(type==="paie"){
    const upd=()=>{const m=S.missions.find(x=>x.id===($("pMis")?.value));const h=+$("pH").value;
      if(m&&m.taux&&h){const n=m.taux*h*S.reglages.ratio/100;$("pEst").innerHTML=`Estimation : <b>${eur2(n)}</b> net<br><small>${h} h × ${eur2(m.taux)} brut × ${S.reglages.ratio}%</small>`;if(!$("pM").dataset.touched)$("pM").value=n.toFixed(2)}
      else $("pEst").textContent=m&&!m.taux?"Ajoute un taux horaire à la mission pour estimer le net.":"Choisis une mission et indique les heures pour une estimation du net."};
    $("pH").oninput=upd;if($("pMis"))$("pMis").onchange=upd;$("pM").oninput=()=>$("pM").dataset.touched=1;upd();
  }
  if(!ed)setTimeout(()=>$("sheet").querySelector("input:not([type=hidden])")?.focus(),80);
}
function closeSheet(){$("sheetBg").classList.remove("open");if(scanCtl){scanCtl.abort();scanCtl=null}}
function openRaw(h){$("sheet").innerHTML=h;$("sheetBg").classList.add("open")}

/* ---------- scan fiche de paie ---------- */
let model=null, textModel=null, canImg=false, scanCtl=null, scanRes=null;
function initAI(){
  try{
    if(recaptchaV3SiteKey)initializeAppCheck(app,{provider:new ReCaptchaV3Provider(recaptchaV3SiteKey),isTokenAutoRefreshEnabled:true});
    else if(recaptchaEnterpriseSiteKey)initializeAppCheck(app,{provider:new ReCaptchaEnterpriseProvider(recaptchaEnterpriseSiteKey),isTokenAutoRefreshEnabled:true});
    const ai=getAI(app,{backend:new GoogleAIBackend()});
    model=getGenerativeModel(ai,{model:geminiModel,generationConfig:{responseMimeType:"application/json",temperature:0}});
    textModel=getGenerativeModel(ai,{model:geminiModel,generationConfig:{temperature:0.4}});
    canImg=true;
  }catch(e){console.warn("IA indisponible",e);canImg=false}
  document.querySelectorAll(".scanBtn").forEach(b=>b.hidden=!canImg);
}
async function toJpegB64(file){
  try{
    const bmp=await createImageBitmap(file);
    const sc=Math.min(1,2000/Math.max(bmp.width,bmp.height));
    const c=document.createElement("canvas");c.width=Math.round(bmp.width*sc);c.height=Math.round(bmp.height*sc);
    c.getContext("2d").drawImage(bmp,0,0,c.width,c.height);
    return{data:c.toDataURL("image/jpeg",0.88).split(",")[1],mimeType:"image/jpeg"};
  }catch(e){
    const buf=await file.arrayBuffer();let bin="";const u=new Uint8Array(buf);
    for(let i=0;i<u.length;i+=32768)bin+=String.fromCharCode.apply(null,u.subarray(i,i+32768));
    return{data:btoa(bin),mimeType:file.type||"image/jpeg"};
  }
}
function parseJSON(t){
  t=String(t||"").trim().replace(/^```(?:json)?\s*/i,"").replace(/```$/,"");
  try{return JSON.parse(t)}catch(e){}
  const i=t.indexOf("{"),j=t.lastIndexOf("}");
  if(i>=0&&j>i){try{return JSON.parse(t.slice(i,j+1))}catch(e){}}
  return null;
}
function aiErr(e){const m=(String(e&&e.code||"")+" "+String(e&&e.message||e||"")).toLowerCase().replace(/-/g," ");
  if(m.includes("api not enabled")||m.includes("ailogic")||m.includes("get started"))return "Gemini n'est pas encore activé : Console Firebase → AI Logic → « Commencer » → Gemini Developer API (voir README). Attends ensuite 2-3 minutes.";
  if(m.includes("app check")||m.includes("appcheck")||m.includes("recaptcha"))return (recaptchaV3SiteKey||recaptchaEnterpriseSiteKey)?"App Check refuse l'appli : vérifie que la clé secrète reCAPTCHA est bien enregistrée dans Firebase → App Check, et que le domaine jasony28.github.io est autorisé.":"Scan bloqué par App Check : il manque la clé reCAPTCHA dans l'appli (voir README).";
  if(m.includes("429")||m.includes("quota")||m.includes("resource_exhausted"))return "Limite gratuite atteinte pour le moment, réessaie plus tard.";
  if(m.includes("api has not been used")||m.includes("not enabled")||m.includes("permission"))return "Firebase AI Logic n'est pas activé sur ton projet (voir README).";
  if(m.includes("not found")&&m.includes("model"))return "Modèle Gemini introuvable : change geminiModel dans firebase-config.js.";
  if(!navigator.onLine||m.includes("network")||m.includes("fetch"))return "Pas de connexion internet.";
  return "Lecture impossible, réessaie avec une photo plus nette.";}
const PROMPT=`Tu lis la photo ou capture d'écran d'une fiche de paie d'un travailleur intérimaire (probablement en Belgique ou en France).
Extrais les informations et réponds UNIQUEMENT avec un objet JSON de cette forme :
{"agence":"nom de l'agence d'intérim ou employeur","client":"entreprise utilisatrice / lieu de mission ou null","periode_debut":"YYYY-MM-DD ou null","periode_fin":"YYYY-MM-DD ou null","date_paiement":"YYYY-MM-DD ou null","heures":nombre total d'heures prestées ou null,"taux_horaire_brut":nombre ou null,"brut":salaire brut total ou null,"net":montant net à payer / viré sur le compte ou null,
"lignes":[{"libelle":"intitulé court en français","montant":nombre positif,"type":"gain" | "retenue" | "info"}],
"avantages":"chèques-repas, éco-chèques, primes, etc. en une phrase, ou null","resume":"2 phrases simples qui expliquent la fiche (d'où vient la différence entre brut et net)",
"cheques_repas_nombre":nombre de chèques-repas attribués ou null,"cheques_repas_valeur":valeur faciale d'un chèque-repas ou null,
"jours":[{"date":"YYYY-MM-DD","heures":nombre}] (le calendrier / détail des jours prestés s'il est présent, sinon [])}
Règles : montants en euros, nombres avec un point décimal, toujours positifs (le type indique gain ou retenue). "gain" = heures, sursalaires, primes, indemnités ; "retenue" = ONSS / cotisations sociales, précompte professionnel, retenues diverses, part personnelle chèques-repas ; "info" = totaux intermédiaires ou valeurs informatives. Maximum 25 lignes, les plus importantes. N'invente rien : mets null si une valeur n'est pas lisible.
Si l'image n'est pas une fiche de paie, réponds {"erreur":"explication courte"}.`;
function detailHTML(d){
  const n=v=>v==null||v===""?"—":eur2(v);
  const ret=(d.lignes||[]).filter(l=>l.type==="retenue").reduce((a,l)=>a+(+l.montant||0),0);
  const L=t=>(d.lignes||[]).filter(l=>l.type===t).map(l=>`<div class="ln"><span>${esc(l.libelle)}</span><b class="${t==="gain"?"pos":t==="retenue"?"out":""}">${t==="retenue"?"−":""}${eur2(l.montant)}</b></div>`).join("");
  return `<div class="grid">
   <div class="card" style="background:var(--card2)"><div class="k">Brut</div><div class="v">${n(d.brut)}</div></div>
   <div class="card" style="background:var(--card2)"><div class="k">Net à payer</div><div class="v pos">${n(d.net)}</div></div>
   <div class="card" style="background:var(--card2)"><div class="k">Retenues</div><div class="v out">${ret?eur2(ret):"—"}</div></div>
   <div class="card" style="background:var(--card2)"><div class="k">Heures · taux</div><div class="v" style="font-size:17px">${d.heures??"—"} h${d.taux_horaire_brut?" · "+eur2(d.taux_horaire_brut):""}</div></div></div>
   <div class="sub" style="margin:2px 0 10px">${esc(d.agence||"")}${d.client?" · "+esc(d.client):""}${d.periode_debut?" · du "+fmtD(d.periode_debut)+" au "+fmtD(d.periode_fin):""}</div>
   ${d.resume?`<div class="est" style="margin-bottom:10px">${esc(d.resume)}</div>`:""}
   ${L("gain")?`<div class="k" style="margin-top:6px">Gains</div>${L("gain")}`:""}
   ${L("retenue")?`<div class="k" style="margin-top:12px">Retenues</div>${L("retenue")}`:""}
   ${L("info")?`<div class="k" style="margin-top:12px">Infos</div>${L("info")}`:""}
   ${d.avantages?`<div class="k" style="margin-top:12px">Avantages</div><div class="sub">${esc(d.avantages)}</div>`:""}`;
}
/* ---------- photos (stockées compressées dans Firestore : budgets/{uid}/photos/{id}) ---------- */
let lastFile=null;
async function compressPhoto(file){
  if(file.type==="application/pdf"){
    if(file.size>700e3)return null; // PDF trop gros pour être gardé
    const r=await toJpegB64(file);return r;
  }
  const bmp=await createImageBitmap(file);
  for(const [max,q] of [[1600,.72],[1300,.6],[1000,.5],[800,.45]]){
    const sc=Math.min(1,max/Math.max(bmp.width,bmp.height));
    const c=document.createElement("canvas");c.width=Math.round(bmp.width*sc);c.height=Math.round(bmp.height*sc);
    c.getContext("2d").drawImage(bmp,0,0,c.width,c.height);
    const data=c.toDataURL("image/jpeg",q).split(",")[1];
    if(data.length<850e3)return{data,mimeType:"image/jpeg"};
  }
  return null;
}
async function savePhoto(file){
  if(!file||!curUid)return null;
  try{const p=await compressPhoto(file);if(!p)return null;
    const id=uid();
    setDoc(doc(fdb,"budgets",curUid,"photos",id),{data:p.data,mime:p.mimeType,date:today()}).catch(e=>{console.error(e);toast("⚠ Photo non enregistrée (règles Firestore ?)")});
    return id;
  }catch(e){console.error(e);return null}
}
function delPhoto(id){if(id&&curUid)deleteDoc(doc(fdb,"budgets",curUid,"photos",id)).catch(()=>{})}
async function openPhoto(id){
  $("viewer").classList.add("open");$("viewerBody").innerHTML=`<div class="est"><span class="spin"></span>Chargement…</div>`;
  try{const snap=await getDoc(doc(fdb,"budgets",curUid,"photos",id));
    if(!snap.exists()){$("viewerBody").innerHTML=`<div class="est">Photo introuvable.</div>`;return}
    const p=snap.data();
    if(p.mime==="application/pdf"){
      const bin=atob(p.data),u=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);
      const url=URL.createObjectURL(new Blob([u],{type:"application/pdf"}));
      $("viewerBody").innerHTML=`<div style="text-align:center;padding:30px"><div style="font-size:60px">📄</div><a class="btn" href="${url}" target="_blank" rel="noopener" style="display:inline-block;width:auto;text-decoration:none;margin-top:14px">Ouvrir le PDF</a></div>`;
    }else{
      $("viewerBody").innerHTML=`<img id="vImg" src="data:${p.mime};base64,${p.data}" alt="Document">`;
      $("vImg").onclick=()=>$("vImg").classList.toggle("zoom");
    }
  }catch(e){console.error(e);$("viewerBody").innerHTML=`<div class="est">Impossible d'afficher la photo (connexion ou règles Firestore).</div>`}
}
async function scanFile(f){lastFile=f;
  if(!model||!canImg){toast("Scan indisponible");return}
  if(f.size>20e6){toast("Image trop lourde");return}
  openRaw(`<h3>Lecture de ta fiche <button class="del" data-close>×</button></h3><div class="est"><span class="spin"></span>Gemini analyse ta fiche de paie… (5 à 30 s)</div>`);
  const ctl=scanCtl=new AbortController();
  try{
    const img=await toJpegB64(f);
    const res=await model.generateContent([PROMPT,{inlineData:img}]);
    if(scanCtl!==ctl||ctl.signal.aborted)return;scanCtl=null;
    const r=parseJSON(res.response.text());
    if(!r||typeof r!=="object"||r.erreur){openRaw(`<h3>Oups <button class="del" data-close>×</button></h3><div class="est">${esc(r&&r.erreur||"Je n'ai pas reconnu de fiche de paie.")}</div><button class="btn scanBtn" style="margin-top:12px">Réessayer avec une autre photo</button>`);return}
    r.lignes=Array.isArray(r.lignes)?r.lignes.slice(0,25).map(l=>({libelle:String(l.libelle||"").slice(0,80),montant:Math.abs(+l.montant||0),type:["gain","retenue","info"].includes(l.type)?l.type:"info"})):[];
    ["brut","net","heures","taux_horaire_brut"].forEach(k=>{if(r[k]!=null&&r[k]!=="")r[k]=+r[k]||null});
    ["agence","client","periode_debut","periode_fin","date_paiement","avantages","resume"].forEach(k=>{r[k]=r[k]==null?null:String(r[k]).slice(0,400)});
    ["periode_debut","periode_fin","date_paiement"].forEach(k=>{if(r[k]&&!/^\d{4}-\d{2}-\d{2}$/.test(r[k]))r[k]=null});
    r.jours=Array.isArray(r.jours)?r.jours.filter(j=>/^\d{4}-\d{2}-\d{2}$/.test(j.date)&&+j.heures>0).slice(0,31).map(j=>({date:j.date,heures:+j.heures})):[];
    ["cheques_repas_nombre","cheques_repas_valeur"].forEach(k=>{r[k]=r[k]!=null&&r[k]!==""?+r[k]||null:null});
    scanRes=r;showScan(r);
  }catch(e){
    if(scanCtl!==ctl||ctl.signal.aborted)return;scanCtl=null;
    console.error(e);
    openRaw(`<h3>Lecture impossible <button class="del" data-close>×</button></h3><div class="est">${esc(aiErr(e))}</div><details style="margin-top:10px"><summary class="sub">Détail technique</summary><div class="sub" style="word-break:break-word;margin-top:6px">${esc(String(e&&e.message||e).slice(0,400))}</div></details>`);
  }
}
const promptFact=()=>`Tu lis la photo, capture d'écran ou PDF d'une FACTURE ou d'un TICKET DE CAISSE (probablement en Belgique ou en France).
Réponds UNIQUEMENT avec un objet JSON de cette forme :
{"type":"facture" | "ticket","fournisseur":"nom du commerce ou de la société","date":"YYYY-MM-DD (date de la facture / du ticket) ou null","montant_total":montant total TTC à payer en euros,"echeance":"YYYY-MM-DD date limite de paiement ou null","deja_paye":true si c'est un ticket de caisse ou si la facture indique qu'elle est payée / domiciliée, sinon false,
"categorie":une valeur parmi ${JSON.stringify(cats())},
"recurrent":true si c'est un abonnement ou une facture régulière (énergie, eau, internet, téléphone, assurance, loyer, abonnement, crédit), sinon false,
"periodicite":"mensuel" | "bimestriel" | "trimestriel" | "annuel" | null,
"lignes":[{"libelle":"article ou poste, court","montant":nombre}],
"resume":"1 phrase simple : ce que c'est et ce qu'il faut faire (payer avant le…, déjà payé…)"}
Règles : nombres avec un point décimal, montants positifs. Maximum 15 lignes, les plus importantes (pour un ticket de courses, regroupe si besoin). N'invente rien : null si illisible.
Catégories : supermarché → "Courses" ; essence/station → "Carburant" ; train, bus, parking, péage → "Transport" ; restaurant, fast-food, café → "Resto" ; pharmacie, médecin → "Santé" ; énergie, eau, internet, téléphone, loyer, assurance habitation, meubles, bricolage → "Maison".
Si l'image n'est ni une facture ni un ticket, réponds {"erreur":"explication courte"}.`;
let factRes=null;
async function scanFacture(f){lastFile=f;
  if(!model||!canImg){toast("Scan indisponible");return}
  if(f.size>20e6){toast("Fichier trop lourd");return}
  openRaw(`<h3>Lecture de ta facture <button class="del" data-close>×</button></h3><div class="est"><span class="spin"></span>Gemini analyse ton document… (5 à 30 s)</div>`);
  const ctl=scanCtl=new AbortController();
  try{
    const img=await toJpegB64(f);
    const res=await model.generateContent([promptFact(),{inlineData:img}]);
    if(scanCtl!==ctl||ctl.signal.aborted)return;scanCtl=null;
    const r=parseJSON(res.response.text());
    if(!r||typeof r!=="object"||r.erreur){openRaw(`<h3>Oups <button class="del" data-close>×</button></h3><div class="est">${esc(r&&r.erreur||"Je n'ai pas reconnu de facture ni de ticket.")}</div><button class="btn scanBtn" data-mode="facture" style="margin-top:12px">Réessayer avec une autre photo</button>`);return}
    r.lignes=Array.isArray(r.lignes)?r.lignes.slice(0,15).map(l=>({libelle:String(l.libelle||"").slice(0,60),montant:Math.abs(+l.montant||0)})):[];
    r.montant_total=r.montant_total!=null?Math.abs(+r.montant_total)||null:null;
    ["fournisseur","resume","periodicite","type"].forEach(k=>{r[k]=r[k]==null?null:String(r[k]).slice(0,300)});
    ["date","echeance"].forEach(k=>{if(r[k]&&!/^\d{4}-\d{2}-\d{2}$/.test(r[k]))r[k]=null});
    if(!cats().includes(r.categorie))r.categorie=cats().includes("Autre")?"Autre":cats()[cats().length-1];
    r.deja_paye=!!r.deja_paye;r.recurrent=!!r.recurrent;
    factRes=r;showFacture(r);
  }catch(e){
    if(scanCtl!==ctl||ctl.signal.aborted)return;scanCtl=null;
    console.error(e);
    openRaw(`<h3>Lecture impossible <button class="del" data-close>×</button></h3><div class="est">${esc(aiErr(e))}</div><details style="margin-top:10px"><summary class="sub">Détail technique</summary><div class="sub" style="word-break:break-word;margin-top:6px">${esc(String(e&&e.message||e).slice(0,400))}</div></details>`);
  }
}
const PER={mensuel:1,bimestriel:2,trimestriel:3,annuel:12};
function factDetailHTML(r){
  return `<div class="grid"><div class="card" style="background:var(--card2)"><div class="k">${r.type==="ticket"?"Ticket":"Facture"}</div><div class="v" style="font-size:17px">${esc(r.fournisseur||"—")}</div><div class="sub">${r.date?new Date(r.date+"T12:00").toLocaleDateString("fr-BE"):""}</div></div>
   <div class="card" style="background:var(--card2)"><div class="k">Total</div><div class="v out">${r.montant_total!=null?eur2(r.montant_total):"—"}</div><div class="sub">${r.echeance?"à payer avant le "+fmtD(r.echeance):r.deja_paye?"payé":""}</div></div></div>
   ${r.resume?`<div class="est" style="margin-bottom:10px">${esc(r.resume)}</div>`:""}
   ${r.lignes&&r.lignes.length?`<div class="k">Détail</div>${r.lignes.map(l=>`<div class="ln"><span>${esc(l.libelle)}</span><b>${eur2(l.montant)}</b></div>`).join("")}`:""}`;
}
function showFacture(r){
  const per=PER[r.periodicite]||1, mens=r.montant_total?r.montant_total/per:0;
  const dejaFixe=S.fixes.find(x=>r.fournisseur&&x.nom.toLowerCase().includes(r.fournisseur.toLowerCase().split(" ")[0]));
  openRaw(`<h3>${r.type==="ticket"?"Ton ticket":"Ta facture"} <button class="del" data-close>×</button></h3>${factDetailHTML(r)}
   <form data-f="facture" style="margin-top:16px;border-top:1px solid var(--line);padding-top:14px">
    <div class="two"><label>Montant (€)<input name="montant" type="number" step="0.01" inputmode="decimal" required value="${r.montant_total??""}"></label><label>Date<input name="date" type="date" required value="${esc(r.date||today())}"></label></div>
    <label>Catégorie</label><div class="chips" id="catChips">${cats().map(c=>`<button type="button" class="${r.categorie===c?"on":""}" data-cat="${c}">${c}</button>`).join("")}</div>
    <input type="hidden" name="cat" id="catIn" value="${esc(r.categorie)}">
    <label>Note<input name="note" value="${esc(r.fournisseur||"")}"></label>
    <label class="chk"><input type="checkbox" name="paye" ${r.deja_paye||!r.echeance?"checked":""}> Déjà payée</label>
    <label>Échéance (si pas encore payée)<input name="echeance" type="date" value="${esc(r.echeance||"")}"></label>
    ${r.recurrent&&!dejaFixe&&mens?`<label class="chk"><input type="checkbox" name="fixe" checked> Ajouter « ${esc(r.fournisseur||"cette facture")} » aux charges fixes (${eur2(mens)}/mois${per>1?", "+r.periodicite+" ÷ "+per:""})</label>`:""}
    ${r.recurrent&&dejaFixe?`<p class="sub">Déjà dans tes charges fixes : « ${esc(dejaFixe.nom)} » (${eur2(dejaFixe.montant)}/mois).</p>`:""}
    <button class="btn">Enregistrer la dépense</button></form>`);
}
function showScan(r){
  const ag=(r.agence||"").toLowerCase();
  const match=S.missions.find(m=>ag&&m.agence&&(ag.includes(m.agence.toLowerCase())||m.agence.toLowerCase().includes(ag.split(" ")[0])));
  const date=r.date_paiement||r.periode_fin||today();
  const ratio=r.brut&&r.net?Math.round(r.net/r.brut*100):null;
  // contrôle de la fiche
  const W=[];
  if(match&&+match.taux>0&&r.taux_horaire_brut&&Math.abs(match.taux-r.taux_horaire_brut)>0.005)W.push(`Taux horaire : ${eur2(r.taux_horaire_brut)} sur la fiche, ${eur2(match.taux)} prévu pour la mission.`);
  if(r.periode_debut&&r.periode_fin){const pt=S.pointage.filter(x=>x.date>=r.periode_debut&&x.date<=r.periode_fin&&(!match||!x.mission||x.mission===match.id));
    if(pt.length&&r.heures){const hp=sum(pt,x=>x.heures);if(Math.abs(hp-r.heures)>0.25)W.push(hp>r.heures?`Heures : tu as pointé ${hp} h mais seulement ${r.heures} h sont payées — il manquerait ${hp-r.heures} h ! Vérifie avec ton agence.`:`Heures : ${r.heures} h payées pour ${hp} h pointées (ton pointage est peut-être incomplet).`)}}
  if(r.heures&&r.taux_horaire_brut){const g=(r.lignes||[]).find(l=>l.type==="gain"&&/heure/i.test(l.libelle));if(g&&Math.abs(g.montant-r.heures*r.taux_horaire_brut)>1)W.push(`Calcul des heures : ${r.heures} h × ${eur2(r.taux_horaire_brut)} = ${eur2(r.heures*r.taux_horaire_brut)}, mais la fiche indique ${eur2(g.montant)}.`)}
  if(r.brut&&r.net&&(r.net/r.brut<0.6||r.net/r.brut>1.05))W.push(`Le net représente ${Math.round(r.net/r.brut*100)} % du brut : c'est inhabituel, vérifie les retenues.`);
  if(r.jours.length&&r.heures){const hj=sum(r.jours,j=>j.heures);if(Math.abs(hj-r.heures)>0.25)W.push(`Le détail des jours fait ${hj} h, mais ${r.heures} h sont payées.`)}
  const newDays=r.jours.filter(j=>!S.pointage.some(x=>x.date===j.date));
  const ctrl=W.length?`<div class="warnbox"><b>⚠️ À vérifier</b><br>${W.join("<br>")}</div>`:(r.heures||r.taux_horaire_brut)?`<div class="okbox">✅ Fiche cohérente : heures, taux et montants concordent.</div>`:"";
  openRaw(`<h3>Ta fiche de paie <button class="del" data-close>×</button></h3>${ctrl}${detailHTML(r)}
   <form data-f="scan" style="margin-top:16px;border-top:1px solid var(--line);padding-top:14px">
    <div class="two"><label>Net à enregistrer (€)<input name="montant" type="number" step="0.01" inputmode="decimal" required value="${r.net??""}"></label><label>Date<input name="date" type="date" required value="${esc(date)}"></label></div>
    <label>Mission<select name="mission"><option value="">— Aucune —</option>${r.agence&&!match?`<option value="__new" selected>➕ Créer « ${esc(r.agence)}${r.client?" · "+esc(r.client):""} »</option>`:""}${S.missions.map(m=>`<option value="${m.id}" ${match&&match.id===m.id?"selected":""}>${esc(m.client||m.agence)}</option>`).join("")}</select></label>
    <label class="chk"><input type="checkbox" name="recu" checked> Déjà reçue sur mon compte</label>
    ${newDays.length?`<label class="chk"><input type="checkbox" name="pointer" checked> Ajouter ${newDays.length} jour(s) au pointage (${sum(newDays,j=>j.heures)} h)</label>`:""}
    ${r.cheques_repas_nombre?`<label class="chk"><input type="checkbox" name="crAdd" checked> Ajouter ${r.cheques_repas_nombre} chèque(s)-repas${r.cheques_repas_valeur?" de "+eur2(r.cheques_repas_valeur):""}</label>`:""}
    ${ratio&&ratio>30&&ratio<100?`<label class="chk"><input type="checkbox" name="ratio" ${Math.abs(ratio-S.reglages.ratio)>=2?"checked":""}> Utiliser ce ratio net/brut (${ratio} %) pour mes estimations</label>`:""}
    <button class="btn">Enregistrer la paie</button></form>`);
}

document.addEventListener("submit",e=>{
  e.preventDefault();const f=e.target;
  if(f.id==="fSet"){const R=S.reglages;R.epargne=+$("sEpargne").value||0;R.pct=+$("sPct").value||0;R.mois=+$("sMois").value||1;R.ratio=+$("sRatio").value||78;R.statut=$("sStatut").value;save();toast("Réglages enregistrés");return}
  const d=Object.fromEntries(new FormData(f));d.id=uid();
  const t=f.dataset.f;
  if(t==="scan"&&scanRes){const r=scanRes;let mid=d.mission;
    if(mid==="__new"){mid=uid();S.missions.push({id:mid,agence:r.agence||"Agence",client:r.client||"",debut:r.periode_debut||d.date,fin:"",taux:r.taux_horaire_brut||0})}
    else if(mid){const m=S.missions.find(x=>x.id===mid);if(m&&!m.taux&&r.taux_horaire_brut)m.taux=r.taux_horaire_brut}
    if(f.ratio&&f.ratio.checked&&r.brut&&r.net)S.reglages.ratio=Math.round(r.net/r.brut*100);
    if(f.pointer&&f.pointer.checked)r.jours.filter(j=>!S.pointage.some(x=>x.date===j.date)).forEach(j=>S.pointage.push({id:uid(),mission:mid||"",date:j.date,heures:j.heures,type:"normal"}));
    if(f.crAdd&&f.crAdd.checked)S.cr.push({id:uid(),date:d.date,nb:r.cheques_repas_nombre,valeur:r.cheques_repas_valeur||8,used:0});
    S.paies.push({id:d.id,mission:mid||"",date:d.date,montant:+d.montant,recu:!!f.recu.checked,heures:r.heures||"",note:r.periode_debut?`du ${fmtD(r.periode_debut)} au ${fmtD(r.periode_fin)}`:"",detail:r});
    if(lastFile){const pid=d.id,file=lastFile;lastFile=null;savePhoto(file).then(ph=>{const p=S.paies.find(x=>x.id===pid);if(ph&&p){p.photo=ph;save()}})}
    const dt=new Date(d.date+"T12:00");cur=new Date(dt.getFullYear(),dt.getMonth(),1);
    scanRes=null;closeSheet();save();toast(S.reglages.pct?`Paie ajoutée · épargne ${eur(+d.montant*S.reglages.pct/100)}`:"Paie ajoutée");return}
  if(t==="facture"&&factRes){const r=factRes;
    const dep={id:d.id,montant:+d.montant,cat:d.cat,date:d.date,note:d.note||"",paye:!!f.paye.checked,echeance:f.paye.checked?"":(d.echeance||""),detail:r};
    S.depenses.push(dep);
    if(lastFile){const file=lastFile;lastFile=null;savePhoto(file).then(ph=>{const x=S.depenses.find(x=>x.id===dep.id);if(ph&&x){x.photo=ph;save()}})}
    if(f.fixe&&f.fixe.checked){const per=PER[r.periodicite]||1,fid=uid();S.fixes.push({id:fid,nom:r.fournisseur||d.note||"Facture",montant:Math.round(+d.montant/per*100)/100,jour:""});dep.fixe=fid}
    else{const fx=S.fixes.find(x=>r.recurrent&&r.fournisseur&&x.nom.toLowerCase().includes(r.fournisseur.toLowerCase().split(" ")[0]));if(fx)dep.fixe=fx.id}
    const dt=new Date(d.date+"T12:00");cur=new Date(dt.getFullYear(),dt.getMonth(),1);
    factRes=null;closeSheet();save();toast(dep.paye?"Dépense ajoutée ✓":"Ajoutée · à payer avant le "+fmtD(dep.echeance||d.date));return}
  if(t==="multi"&&multiRes.length){let n=0;multiRes.forEach(({r,file},i)=>{if(!f["m"+i]||!f["m"+i].checked)return;const id=uid();
      S.depenses.push({id,montant:r.montant_total,cat:r.categorie,date:r.date,note:r.fournisseur||"",paye:!(r.echeance&&!r.deja_paye),echeance:r.echeance&&!r.deja_paye?r.echeance:"",detail:r});n++;
      savePhoto(file).then(ph=>{const x=S.depenses.find(x=>x.id===id);if(ph&&x){x.photo=ph;save()}})});
    multiRes=[];closeSheet();save();toast(n+" dépense(s) ajoutée(s) ✓");return}
  if(t==="releve"&&releveRes.length){let n=0;releveRes.forEach((o,i)=>{if(!f["o"+i]||!f["o"+i].checked)return;
      if(o.montant<0)S.depenses.push({id:uid(),montant:Math.abs(o.montant),cat:o.cat,date:o.date,note:o.libelle,paye:true});
      else S.paies.push({id:uid(),mission:(S.missions.find(mi=>mi.agence&&o.libelle.toLowerCase().includes(mi.agence.toLowerCase().split(/[ .]/)[0]))||{}).id||"",date:o.date,montant:o.montant,recu:true,heures:"",note:o.libelle});n++});
    releveRes=[];closeSheet();save();toast(n+" opération(s) importée(s) ✓");return}
  if(t==="budgets"){const B={};cats().forEach(c=>{const v=+d["b_"+c];if(v>0)B[c]=v});S.budgets=B;closeSheet();save();toast("Budgets enregistrés");return}
  if(t==="epargne"){const m=Math.abs(+d.montant||0)*(+f.dataset.sign||1);if(!m)return;
    if(d.target){const o=S.objectifs.find(o=>o.id===d.target);if(o){o.actuel=Math.round(((+o.actuel||0)+m)*100)/100;if(o.actuel>=+o.cible&&m>0)setTimeout(()=>toast("🎉 Objectif « "+o.nom+" » atteint !"),300)}}
    else S.reglages.epargne=Math.round(((+S.reglages.epargne||0)+m)*100)/100;
    S.epargneLog.push({id:d.id,date:d.date,montant:m,target:d.target||"",note:d.note||""});
    if(S.epargneLog.length>400)S.epargneLog=S.epargneLog.slice(-400);
    closeSheet();save();toast(m>0?`+${eur2(m)} mis de côté 💪`:`${eur2(m)} retiré`);return}
  // ajout / modification générique
  const fix={depense:x=>{x.montant=+x.montant;x.paye=!!f.paye.checked;if(x.paye)x.echeance=""},paie:x=>{x.montant=+x.montant;x.recu=!!f.recu.checked;x.heures=x.heures?+x.heures:""},
    mission:x=>{x.taux=x.taux?+x.taux:0},fixe:x=>{x.montant=+x.montant},objectif:x=>{x.cible=+x.cible;x.actuel=+x.actuel||0},
    pointage:x=>{x.heures=+x.heures;delete x.semaine},cheques:x=>{x.nb=+x.nb;x.valeur=+x.valeur;x.used=+x.used||0},dette:x=>{x.montant=+x.montant;x.regle=!!(f.regle&&f.regle.checked)}};
  if(!fix[t])return;
  if(t==="pointage"&&!f.dataset.id&&f.semaine&&f.semaine.checked){const d0=new Date(d.date+"T12:00");const mon=new Date(d0);mon.setDate(d0.getDate()-((d0.getDay()+6)%7));
    for(let i=0;i<5;i++){const dd=new Date(mon);dd.setDate(mon.getDate()+i);const ds=iso(dd);if(!S.pointage.some(x=>x.date===ds&&x.mission===d.mission))S.pointage.push({id:uid(),mission:d.mission||"",date:ds,heures:+d.heures,type:d.type})}
    closeSheet();save();toast("Semaine pointée ✓");return}
  fix[t](d);
  const coll=S[COLL[t]], eid=f.dataset.id;
  if(eid){const o=coll.find(x=>x.id===eid);if(o){delete d.id;Object.assign(o,d)}}
  else coll.push(d);
  if(t==="paie"&&!eid&&d.recu&&S.reglages.pct)setTimeout(()=>toast(`Pense à épargner ${eur(d.montant*S.reglages.pct/100)}`),50);
  if((t==="paie"||t==="depense")&&d.date){const dt=new Date(d.date+"T12:00");cur=new Date(dt.getFullYear(),dt.getMonth(),1)}
  closeSheet();save();toast(eid?"Modifié ✓":"Ajouté ✓");
});

document.addEventListener("click",e=>{
  const b=e.target.closest("button,[data-toggle],[data-ptoggle],[data-detail],[data-edit],[data-cat],[data-emo],[data-day]");
  if(e.target===$("sheetBg")){closeSheet();return}
  if(!b)return;
  if(b.classList.contains("scanBtn")){const m=b.dataset.mode||"paie";pickSource(m==="facture"?"Scanner une facture / un ticket":"Scanner une fiche de paie",f=>(m==="facture"?scanFacture:scanFile)(f));return}
  if(b.dataset.src){choosePick(b.dataset.src);return}
  if(b.dataset.ask){chatSend(b.dataset.ask);return}
  if(b.dataset.ptype){document.querySelectorAll("#typeChips button").forEach(x=>x.classList.toggle("on",x===b));$("typeIn").value=b.dataset.ptype;return}
  if(b.dataset.sens){document.querySelectorAll("#sensChips button").forEach(x=>x.classList.toggle("on",x===b));$("sensIn").value=b.dataset.sens;return}
  if(b.dataset.day){const ex=S.pointage.find(x=>x.date===b.dataset.day);if(ex)openSheet("pointage",null,ex);else openSheet("pointage",null,null,{date:b.dataset.day});return}
  if(b.dataset.cruse){const l=S.cr.find(x=>x.id===b.dataset.cruse);if(l){l.used=(+l.used||0)+1;save();toast("1 chèque utilisé")}return}
  if(b.dataset.regle){const x=S.dettes.find(x=>x.id===b.dataset.regle);if(x){x.regle=true;save();toast("Réglé ✓")}return}
  if(b.dataset.defi){const n=+b.dataset.defi,i=S.defi.indexOf(n);
    if(i>=0){S.defi.splice(i,1);S.reglages.epargne=Math.round(((+S.reglages.epargne||0)-n)*100)/100;S.epargneLog=S.epargneLog.filter(x=>x.id!=="defi-"+n);toast("Semaine "+n+" annulée")}
    else{S.defi.push(n);S.reglages.epargne=Math.round(((+S.reglages.epargne||0)+n)*100)/100;S.epargneLog.push({id:"defi-"+n,date:today(),montant:n,target:"",note:"Défi semaine "+n});toast(`+${n} € · semaine ${n} ✓`)}
    save();return}
  if(b.dataset.delcat){const c=b.dataset.delcat;if(b.dataset.confirm!=="1"){b.dataset.confirm="1";b.textContent="Supprimer « "+c+" » ?";setTimeout(()=>{if(b.isConnected){b.dataset.confirm="";b.textContent=c}},2500);return}
    S.cats=cats().filter(x=>x!==c);save();toast("Catégorie supprimée");return}
  if(b.dataset.cat){document.querySelectorAll("#catChips button").forEach(x=>x.classList.toggle("on",x===b));$("catIn").value=b.dataset.cat;return}
  if(b.dataset.emo){document.querySelectorAll("#emoChips button").forEach(x=>x.classList.toggle("on",x===b));$("emoIn").value=b.dataset.emo;return}
  if(b.dataset.edit&&b.tagName!=="BUTTON"){const[ty,id]=b.dataset.edit.split(":");const o=(S[COLL[ty]]||[]).find(x=>x.id===id);if(o)openSheet(ty,null,o);return}
  if(b.dataset.del2){const[k,id]=b.dataset.del2.split(":");
    if(b.dataset.confirm!=="1"){b.dataset.confirm="1";b.textContent="Appuie encore pour confirmer";setTimeout(()=>{if(b.isConnected){b.dataset.confirm="";b.textContent="Supprimer"}},3000);return}
    {const o=(S[k]||[]).find(x=>x.id===id);if(o&&o.photo)delPhoto(o.photo)}S[k]=S[k].filter(x=>x.id!==id);if(k==="missions")S.paies.forEach(p=>{if(p.mission===id)p.mission=""});closeSheet();save();toast("Supprimé");return}
  if(b.dataset.photo){openPhoto(b.dataset.photo);return}
  if(b.dataset.attach){const tg=b.dataset.attach;pickSource("Joindre un document",f=>attachPhoto(tg,f));return}
  if(b.dataset.fdetail){const p=S.depenses.find(x=>x.id===b.dataset.fdetail);if(p&&p.detail)openRaw(`<h3>Détail du document <button class="del" data-close>×</button></h3>${factDetailHTML(p.detail)}`);return}
  if(b.dataset.detail){const p=S.paies.find(x=>x.id===b.dataset.detail);if(p&&p.detail)openRaw(`<h3>Détail de la paie <button class="del" data-close>×</button></h3>${detailHTML(p.detail)}`);return}
  if(b.dataset.v){document.querySelectorAll("nav button").forEach(x=>x.classList.toggle("on",x.dataset.v===b.dataset.v));
    document.querySelectorAll(".view").forEach(v=>v.classList.toggle("on",v.id==="v-"+b.dataset.v));
    $("fab").style.display=b.dataset.v==="set"?"none":"block";$("monthBar").style.display=b.dataset.v==="set"?"none":"";window.scrollTo(0,0);return}
  if(b.dataset.open){const o=b.dataset.open;if(o==="retrait")openSheet("epargne",null,null,{retrait:true});else openSheet(o,null,null,{amt:b.dataset.amt,target:b.dataset.target});return}
  if(b.dataset.paie){openSheet("paie",b.dataset.paie);return}
  if(b.hasAttribute("data-close")){closeSheet();return}
  if(b.dataset.del){const[k,id]=b.dataset.del.split(":");
    if(b.dataset.confirm!=="1"){b.dataset.confirm="1";b.textContent="Suppr. ?";b.style.color="var(--bad)";b.style.fontSize="12px";setTimeout(()=>{if(b.isConnected){b.dataset.confirm="";b.textContent="×";b.style.color="";b.style.fontSize=""}},2500);return}
    {const o=(S[k]||[]).find(x=>x.id===id);if(o&&o.photo)delPhoto(o.photo)}S[k]=S[k].filter(x=>x.id!==id);if(k==="missions")S.paies.forEach(p=>{if(p.mission===id)p.mission=""});save();toast("Supprimé");return}
  if(b.dataset.ptoggle){const p=S.depenses.find(x=>x.id===b.dataset.ptoggle);if(p){p.paye=p.paye===false;if(p.paye)p.echeance="";save();toast(p.paye?"Marquée payée ✓":"Marquée à payer")}return}
  if(b.dataset.toggle){const p=S.paies.find(x=>x.id===b.dataset.toggle);if(p){p.recu=!p.recu;save()}return}
});
$("fab").onclick=()=>{const v=document.querySelector(".view.on").id;openSheet(v==="v-rev"?"paie":v==="v-dep"?"depense":"choix")};
let sTimer;$("search").oninput=()=>{clearTimeout(sTimer);sTimer=setTimeout(render,150)};
["simH","simT","simW"].forEach(id=>$(id).oninput=()=>{if(id==="simT")$("simT").dataset.touched=1;renderStats()});
$("bCsv").onclick=()=>{
  const y=String(cur.getFullYear()),q=v=>`"${String(v??"").replace(/"/g,'""')}"`,n=v=>String(+v||0).replace(".",",");
  const L=[["Type","Date","Montant","Catégorie / Mission","Heures","Brut","Reçue","Note"].map(q).join(";")];
  S.paies.filter(p=>(p.date||"").startsWith(y)).forEach(p=>{const m=S.missions.find(x=>x.id===p.mission);L.push([q("Paie"),q(p.date),n(p.montant),q(m?(m.agence+" "+(m.client||"")).trim():""),n(p.heures),p.detail&&p.detail.brut?n(p.detail.brut):"",q(p.recu?"oui":"non"),q(p.note)].join(";"))});
  S.depenses.filter(d=>(d.date||"").startsWith(y)).forEach(d=>L.push([q("Dépense"),q(d.date),n(-d.montant),q(d.cat),"","","",q(d.note)].join(";")));
  const a=document.createElement("a");a.href=URL.createObjectURL(new Blob(["\ufeff"+L.join("\n")],{type:"text/csv;charset=utf-8"}));a.download=`budget-interim-${y}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),2000);toast("CSV téléchargé")};
// Choix de la source : galerie (sélecteur de photos Android), appareil photo, ou fichier/PDF
let pickCb=null,pickMulti=false;
function pickSource(title,cb,multi=false){pickCb=cb;pickMulti=multi;
  openRaw(`<h3>${title} <button class="del" type="button" data-close>×</button></h3>
  <div style="display:grid;gap:10px"><button class="btn" data-src="gallery">🖼️ Choisir dans la galerie</button><button class="btn sec" data-src="camera">📷 Prendre une photo</button><button class="btn sec" data-src="file">📄 Fichier / PDF</button></div>`)}
function choosePick(src){const i=$("pickIn");
  if(src==="file"){i.accept="application/pdf,image/*";i.removeAttribute("capture")}
  else{i.accept="image/*";if(src==="camera")i.setAttribute("capture","environment");else i.removeAttribute("capture")}
  i.multiple=pickMulti&&src!=="camera";
  i.click()}
$("pickIn").onchange=()=>{const fs=[...$("pickIn").files];$("pickIn").value="";if(fs.length&&pickCb){const cb=pickCb;pickCb=null;cb(pickMulti?fs.slice(0,15):fs[0])}};
async function attachPhoto(target,f){
  const[k,id]=target.split(":");closeSheet();toast("Enregistrement de la photo…");
  const ph=await savePhoto(f);const o=S[k].find(x=>x.id===id);
  if(ph&&o){if(o.photo)delPhoto(o.photo);o.photo=ph;save();toast("Photo jointe ✓")}else toast("Photo trop lourde ou non enregistrée")}
$("viewerClose").onclick=()=>$("viewer").classList.remove("open");

$("prev").onclick=()=>{cur.setMonth(cur.getMonth()-1);render()};
$("next").onclick=()=>{cur.setMonth(cur.getMonth()+1);render()};
$("bCopy").onclick=async()=>{LS.set("lastBackup",Date.now());renderSettings();const t=JSON.stringify(S);$("backup").value=t;try{await navigator.clipboard.writeText(t);toast("Copié")}catch(e){$("backup").select();toast("Sélectionné, copie-le")}};
$("bRestore").onclick=()=>{try{const d=JSON.parse($("backup").value);if(!d||typeof d!=="object")throw 0;S=normalize(d);save();$("backup").value="";toast("Données restaurées")}catch(e){toast("Sauvegarde invalide")}};

$("bDownload").onclick=()=>{LS.set("lastBackup",Date.now());renderSettings();const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([JSON.stringify(S,null,2)],{type:"application/json"}));a.download="budget-interim-"+today()+".json";a.click();setTimeout(()=>URL.revokeObjectURL(a.href),2000)};
init();
