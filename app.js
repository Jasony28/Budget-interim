import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import { getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, signOut } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, setDoc, getDoc, getDocFromServer, deleteDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import { initializeAppCheck, ReCaptchaEnterpriseProvider, ReCaptchaV3Provider } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app-check.js";
import { getAI, getGenerativeModel, GoogleAIBackend } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-ai.js";
import * as CFG from "./firebase-config.js?v=40";
import { nrm, sum, bilanFiscal as bilanAnnee, chargeParents, verifOnss, primeFinAnnee, peculeOuvrier } from "./calculs.js?v=40";
const { firebaseConfig, recaptchaEnterpriseSiteKey, recaptchaV3SiteKey, geminiModel } = CFG;
const geminiFallbacks = CFG.geminiFallbacks || ["gemini-3.5-flash-lite","gemini-3.1-flash-lite"];

const APP_VERSION=40;
// écran de démarrage : visible au moins 1,3 s, retiré quand les données sont prêtes (6 s max)
const SPLASH_T0=performance.now();let splashGone=false;
function hideSplash(){if(splashGone)return;splashGone=true;const el=document.getElementById("splash");if(!el)return;
  setTimeout(()=>{el.classList.add("out");setTimeout(()=>el.remove(),600)},Math.max(0,1300-(performance.now()-SPLASH_T0)))}
setTimeout(hideSplash,6000);
const DEFAULT_CATS=["Courses","Transport","Carburant","Loisirs","Santé","Vêtements","Maison","Resto","Cadeaux","Autre"];
const cats=()=>(S.cats&&S.cats.length?S.cats:DEFAULT_CATS);
const DEF={missions:[],paies:[],depenses:[],fixes:[],objectifs:[],budgets:{},epargneLog:[],pointage:[],cr:[],dettes:[],fiches281:[],defi:[],cats:null,reglages:{epargne:0,pct:10,mois:3,ratio:78,statut:"ouvrier",domicile:"",conso:6.5,carbu:1.8},adminDone:{},subsIgnore:[],bourse:{titres:[],ops:[],cours:{}}};
let S=JSON.parse(JSON.stringify(DEF));
let cur=new Date();cur.setDate(1);
const $=id=>document.getElementById(id);
const eur=n=>(Math.round((+n||0)*100)/100).toLocaleString("fr-BE",{style:"currency",currency:"EUR",maximumFractionDigits:0});
const eur2=n=>(+n||0).toLocaleString("fr-BE",{style:"currency",currency:"EUR"});
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,7);
const iso=d=>d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
const today=()=>iso(new Date()); // date locale (pas UTC)
const fmtN=n=>(+n||0).toLocaleString("fr-BE",{maximumFractionDigits:2});
const eurT=n=>(+n||0).toLocaleString("fr-BE",{style:"currency",currency:"EUR",minimumFractionDigits:2,maximumFractionDigits:4});
const mkey=d=>d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0");
const fmtD=s=>s?new Date(s+"T12:00").toLocaleDateString("fr-BE",{day:"numeric",month:"short"}):"";
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function toast(t){const e=$("toast");e.textContent=t;e.classList.add("on");setTimeout(()=>e.classList.remove("on"),1800)}

/* ---------- stockage : Firebase ---------- */
const isDate=s=>typeof s==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(s);
function clean(arr,needDate=true){return (Array.isArray(arr)?arr:[]).filter(x=>x&&typeof x==="object").map(x=>{if(!x.id)x.id=uid();if(needDate&&!isDate(x.date))x.date=today();return x})}
function normalize(d){d=d||{};const n=normalize0(d);["paies","depenses","pointage","epargneLog","cr","dettes"].forEach(k=>n[k]=clean(n[k]));["missions","fixes","objectifs","fiches281"].forEach(k=>n[k]=clean(n[k],false));
  if(!Array.isArray(n.defi))n.defi=[];if(!n.budgets||typeof n.budgets!=="object")n.budgets={};if(n.cats&&!Array.isArray(n.cats))n.cats=null;
  n.paies.forEach(p=>reparerAnnee(p,n.missions));
  n.paies.forEach(p=>{if(p.detail&&Array.isArray(p.detail.jours)&&!p.archive){const h=heuresPayees({heures:p.detail.heures,jours:p.detail.jours}).heures;if(h&&h>(+p.heures||0)+0.25){p.heures=h;p.detail.heures=h}}}); // fiches déjà scannées : on rattrape les heures de récup payées
  return n}
function normalize0(d){return{missions:d.missions||[],paies:d.paies||[],depenses:d.depenses||[],fixes:d.fixes||[],objectifs:d.objectifs||[],budgets:d.budgets||{},epargneLog:d.epargneLog||[],pointage:d.pointage||[],cr:d.cr||[],dettes:d.dettes||[],fiches281:d.fiches281||[],defi:d.defi||[],cats:d.cats||null,adminDone:d.adminDone||{},subsIgnore:d.subsIgnore||[],bourse:Object.assign({titres:[],ops:[],cours:{}},d.bourse||{}),reglages:Object.assign({},DEF.reglages,d.reglages||{})}}
const configured=firebaseConfig.apiKey&&firebaseConfig.apiKey!=="A_REMPLACER";
const app=configured?initializeApp(firebaseConfig):null;
const auth=app?getAuth(app):null;
const fdb=app?initializeFirestore(app,{localCache:persistentLocalCache({tabManager:persistentMultipleTabManager()})}):null;
let fsDoc=null, unsub=null, curUid=null, loaded=false, fsErr=null, fsTimer=null;
function setSync(t){$("sync").title=t;$("sync").setAttribute("aria-label",t);$("sync").classList.toggle("off",/hors|chargement|attente|…/i.test(t));$("sync").classList.toggle("bad",/⚠|erreur|pas encore/i.test(t))}
function compacter(){ // Firestore : 1 Mo max par document → on allège les vieux détails si besoin
  let json=JSON.stringify(S);if(json.length<850e3)return json;
  const items=[...S.paies,...S.depenses].filter(x=>x.detail).sort((a,b)=>a.date.localeCompare(b.date));
  const step=Math.max(20,Math.ceil(items.length/10)); // par paquets de 10 % (rapide même avec des milliers de lignes)
  for(let i=0;i<items.length;i+=step){items.slice(i,i+step).forEach(x=>{delete x.detail.lignes;delete x.detail.jours;delete x.detail.resume});json=JSON.stringify(S);if(json.length<800e3)break}
  if(json.length>=850e3&&S.epargneLog.length>100){S.epargneLog=S.epargneLog.slice(-100);json=JSON.stringify(S)}
  return json}
function save(){
  if(fsDoc&&!loaded){toast("⏳ Chargement de tes données… réessaie dans un instant");return}
  render();syncRappels();
  if(!fsDoc)return;
  const json=compacter();
  if(json.length>1e6){setSync("⚠ Données trop volumineuses");toast("⚠ Base presque pleine : fais une sauvegarde puis supprime d'anciennes données");return}
  localRev=Math.max(localRev,srvRev)+1;const rev=localRev;
  miroir(json,rev);
  const payload=JSON.parse(json);payload._rev=rev;payload._at=Date.now();
  if(!pendingSince)pendingSince=Date.now();
  const myDoc=fsDoc;
  setDoc(myDoc,payload).then(()=>{if(myDoc!==fsDoc)return;ackRev=Math.max(ackRev,rev);if(ackRev>=localRev){pendingSince=0;if(syncPb==="pending"||syncPb==="write"){syncPb=null;render()}}planVerif()})
    .catch(e=>{console.error(e);syncPb="write";syncPbCode=e.code||e.message||"erreur";setSync("⚠ Erreur de sauvegarde");render()});
}
/* ---------- protections anti-perte ---------- */
let localRev=0,srvRev=0,ackRev=0,pendingSince=0,syncPb=null,syncPbCode="",verifT=null,videServeur=false;
function miroir(json,rev){try{localStorage.setItem("miroir-"+curUid,JSON.stringify({date:today(),at:Date.now(),rev,data:json}))}catch(e){}}
function lireMiroir(){try{const m=JSON.parse(localStorage.getItem("miroir-"+curUid)||"null");if(m&&m.data){const d=JSON.parse(m.data);if(aDesDonnees(d))return{...m,d}}}catch(e){}return null}
function planVerif(){clearTimeout(verifT);verifT=setTimeout(verifServeur,8000)}
async function verifServeur(){if(!fsDoc||!loaded||!navigator.onLine)return;
  try{const s=await getDocFromServer(fsDoc);const r=s.exists()?(+s.data()._rev||0):-1;
    if(r<ackRev||(r<0&&aDesDonnees(S))){syncPb="verify";render();save()} // le serveur n'a pas la dernière version : on renvoie
    else if(syncPb==="verify"){syncPb=null;render()}}
  catch(e){console.warn("vérif serveur",e)}}
setInterval(()=>{if(pendingSince&&navigator.onLine&&Date.now()-pendingSince>20000&&syncPb!=="pending"&&syncPb!=="write"){syncPb="pending";setSync("⚠ Changements pas encore envoyés");render()}},5000);
window.addEventListener("online",()=>{if(syncPb)planVerif()});
/* ---------- copies de secours automatiques (1 par jour, 14 jours) ----------
   Rangées dans budgets/{uid}/photos/backup-AAAA-MM-JJ : même règle Firestore que les photos, rien à configurer. */
const BK_JOURS=14,bkId=d=>"backup-"+d;
const aDesDonnees=s=>(s.paies||[]).length+(s.depenses||[]).length+(s.missions||[]).length+(s.fixes||[]).length>0;
function resumeEtat(s){return `${(s.paies||[]).length} paie(s) · ${(s.depenses||[]).length} dépense(s) · ${(s.missions||[]).length} mission(s)`}
async function autoBackup(){try{
  if(!curUid||!aDesDonnees(S))return; // jamais de copie d'un état vide
  const json=compacter();try{localStorage.setItem("bk-local",JSON.stringify({date:today(),data:json}))}catch(e){}
  const ref=doc(fdb,"budgets",curUid,"photos",bkId(today()));
  if((await getDoc(ref)).exists())return;
  await setDoc(ref,{backup:true,date:today(),resume:resumeEtat(S),data:json});
  for(let i=BK_JOURS;i<BK_JOURS+10;i++){const d=new Date();d.setDate(d.getDate()-i);deleteDoc(doc(fdb,"budgets",curUid,"photos",bkId(iso(d)))).catch(()=>{})}
}catch(e){console.warn("copie de secours",e)}}
async function ouvrirVersions(){
  openRaw(`<h3>Versions automatiques <button class="del" data-close>×</button></h3><div class="est"><span class="spin"></span>Recherche de tes copies de secours…</div>`);
  const jours=[...Array(BK_JOURS+1).keys()].map(i=>{const d=new Date();d.setDate(d.getDate()-i);return iso(d)});
  const res=(await Promise.all(jours.map(d=>getDoc(doc(fdb,"budgets",curUid,"photos",bkId(d))).then(s=>s.exists()?s.data():null).catch(()=>null)))).filter(Boolean);
  let loc=null;try{loc=JSON.parse(localStorage.getItem("bk-local")||"null")}catch(e){}
  window.__versions=res;window.__vloc=loc;
  $("sheet").innerHTML=`<h3>Versions automatiques <button class="del" data-close>×</button></h3>
   <p class="sub" style="margin-bottom:12px">L'appli garde une copie de tes données chaque jour pendant ${BK_JOURS} jours, dans ton compte Firebase. Touche une date pour revenir à cette version.</p>
   <div class="card" style="background:var(--card2)">${res.length?res.map((v,i)=>row("",`<b>${new Date(v.date+"T12:00").toLocaleDateString("fr-BE",{weekday:"long",day:"numeric",month:"long"})}</b><small>${esc(v.resume||"")}</small>`,`<button type="button" class="btn sm" data-version="${i}">Restaurer</button>`,"🕘")).join(""):vide("🕘","Pas encore de copie : la première se fait automatiquement aujourd'hui.")}
   ${loc&&loc.data?row("",`<b>Copie sur ce téléphone</b><small>${esc(new Date(loc.date+"T12:00").toLocaleDateString("fr-BE"))}</small>`,`<button type="button" class="btn sec sm" data-version="local">Restaurer</button>`,"📱"):""}</div>`}
function restaurerVersion(k){const v=k==="local"?window.__vloc:(window.__versions||[])[+k];if(!v||!v.data)return;
  let d;try{d=normalize(JSON.parse(v.data))}catch(e){toast("Copie illisible");return}
  if(!confirm(`Revenir à la version du ${new Date(v.date+"T12:00").toLocaleDateString("fr-BE")} ?\n(${resumeEtat(d)})\n\nTes données actuelles seront remplacées. Une copie d'aujourd'hui reste disponible.`))return;
  S=d;save();closeSheet();toast("Version restaurée ✓")}
function fsRaison(e){e=String(e||"");
  if(e==="lent")return "Firebase ne répond pas. Vérifie ta connexion internet (4G / wifi).";
  if(/permission/.test(e))return "Firebase refuse l'accès à tes données (règles Firestore ou App Check).";
  if(/unavailable|network|offline/.test(e))return "Pas de connexion à Firebase pour l'instant.";
  if(/unauthenticated/.test(e))return "Ta connexion Google a expiré : déconnecte-toi puis reconnecte-toi.";
  return "Erreur Firebase : "+e}
async function exporterSauvegarde(){const txt=JSON.stringify(S,null,2),nom="budget-interim-"+today()+".json";
  try{const f=new File([txt],nom,{type:"application/json"});if(navigator.canShare&&navigator.canShare({files:[f]})){await navigator.share({files:[f],title:"Sauvegarde Budget Intérim"});LS.set("lastBackup",Date.now());render();toast("Sauvegarde envoyée ✓");return}}catch(e){if(e&&e.name==="AbortError")return}
  $("bDownload").click();render()}
function reconnecter(){if(!curUid)return;if(unsub){unsub();unsub=null}subscribe(curUid);toast("Nouvelle tentative…")}
async function diagnostic(){
  const u=auth&&auth.currentUser;
  openRaw(`<h3>🩺 Diagnostic <button class="del" data-close>×</button></h3><div class="est"><span class="spin"></span>Je vérifie tes données sur Firebase…</div>`);
  let srv,err=null;try{srv=await getDocFromServer(fsDoc)}catch(e){err=e.code||e.message}
  const d=srv&&srv.exists()?srv.data():null;
  let nbk=0;try{const j=[...Array(BK_JOURS+1).keys()].map(i=>{const x=new Date();x.setDate(x.getDate()-i);return iso(x)});nbk=(await Promise.all(j.map(x=>getDoc(doc(fdb,"budgets",curUid,"photos",bkId(x))).then(s=>s.exists()).catch(()=>false)))).filter(Boolean).length}catch(e){}
  const L=(k,v)=>`<div class="ln"><span>${k}</span><b style="text-align:right">${v}</b></div>`;
  const verdict=err?`<div class="warnbox"><b>Impossible de lire Firebase.</b><br>${esc(fsRaison(err))}</div>`
    :!d&&lireMiroir()?`<div class="warnbox"><b>Firebase est vide, mais ce téléphone a une copie</b> (${esc(resumeEtat(lireMiroir().d))}).<br><button type="button" class="btn sm" data-miroir="1" style="margin-top:8px">♻️ Remettre ces données</button></div>`
    :!d?`<div class="warnbox"><b>Aucune donnée trouvée pour ce compte sur Firebase.</b><br>Vérifie que c'est bien le compte Google que tu utilisais avant. Sinon, essaie « Revenir à une version précédente ».</div>`
    :aDesDonnees(d)&&!aDesDonnees(S)?`<div class="warnbox"><b>Tes données sont bien sur Firebase</b> (${esc(resumeEtat(d))}) mais pas affichées. Touche « Recharger ».</div>`
    :`<div class="okbox"><b>Tout va bien.</b> Tes données sont sur Firebase et à jour sur ce téléphone.</div>`;
  $("sheet").innerHTML=`<h3>🩺 Diagnostic <button class="del" data-close>×</button></h3>${verdict}
   <div class="card" style="background:var(--card2)">${L("Compte",esc(u?(u.email||u.displayName||"?"):"non connecté"))}${L("Identifiant",esc(curUid?curUid.slice(0,6)+"…":"—"))}${L("Connexion internet",navigator.onLine?"✅ oui":"❌ non")}
   ${L("Données sur Firebase",err?"❌ illisibles":d?esc(resumeEtat(d)):"aucune")}${L("Données sur ce téléphone",esc(resumeEtat(S)))}${L("Copies de secours",nbk+" jour(s)")}${L("Envoi à Firebase",syncPb?"⚠️ pas confirmé":pendingSince?"⏳ en cours":"✅ confirmé")}${L("Version de l'appli",APP_VERSION)}</div>
   <div class="two" style="margin-top:12px"><button type="button" class="btn" data-reco="1">🔄 Recharger</button><button type="button" class="btn sec" id="bVersions">🕘 Versions</button></div>`}
function subscribe(uid){
  fsDoc=doc(fdb,"budgets",uid);curUid=uid;loaded=false;
  setSync("Chargement…");
  fsErr=null;clearTimeout(fsTimer);fsTimer=setTimeout(()=>{if(!loaded){fsErr=fsErr||"lent";render()}},10000);
  unsub=onSnapshot(fsDoc,{includeMetadataChanges:true},snap=>{
    const m=snap.metadata;if(!m.fromCache)fsErr=null;
    if(!m.hasPendingWrites&&snap.exists()){const dd=snap.data();S=normalize(dd);srvRev=Math.max(srvRev,+dd._rev||0);localRev=Math.max(localRev,srvRev);if(!m.fromCache)ackRev=Math.max(ackRev,+dd._rev||0)}
    if(!m.fromCache&&!m.hasPendingWrites){videServeur=!snap.exists()||!aDesDonnees(snap.data()||{});if(!videServeur)miroir(JSON.stringify(snap.data()),+snap.data()._rev||0)}
    if(!m.hasPendingWrites&&(snap.exists()||!m.fromCache))loaded=true; // jamais d'écriture avant d'avoir lu les vraies données
    if(loaded&&snap.exists()&&!m.fromCache&&!m.hasPendingWrites&&!window.__bk){window.__bk=1;setTimeout(autoBackup,2500)}
    setSync(m.hasPendingWrites?(navigator.onLine?"Sauvegarde…":"Hors ligne · enregistré sur le téléphone"):m.fromCache?"Hors ligne":"✓ Synchronisé");
    render();
    hideSplash();
    if(!window.__first){window.__first=1;syncRappels();setTimeout(notifierMaintenant,1500);raccourci()}
  },e=>{console.error(e);fsErr=e.code||e.message||"erreur";hideSplash();setSync("⚠ Erreur de lecture Firebase");render()});
}
function init(){
  if(!configured){hideSplash();$("loginErr").textContent="Firebase n'est pas encore configuré : remplis le fichier firebase-config.js (voir README).";$("bLogin").disabled=true;return}
  onAuthStateChanged(auth,user=>{
    if(unsub){unsub();unsub=null}
    if(user){
      document.body.classList.remove("signed-out");
      $("who").textContent="Connecté : "+(user.email||user.displayName||"");
      subscribe(user.uid);
    }else{
      hideSplash();document.body.classList.add("signed-out");fsDoc=null;loaded=false;curUid=null;localRev=srvRev=ackRev=pendingSince=0;syncPb=null;videServeur=false;S=JSON.parse(JSON.stringify(DEF));
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
    if(window.caches){const ks=await caches.keys();await Promise.all(ks.filter(k=>k!=="rappels"&&k!=="share").map(k=>caches.delete(k)))}}catch(e){}
  location.replace(location.pathname+"?maj="+Date.now());
}
async function checkUpdate(){
  if(!navigator.onLine)return;
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
  const passe=k<mkey(new Date()); // mois terminé : son bilan inclut toutes ses paies, historique compris
  const pAll=S.paies.filter(x=>(x.date||"").startsWith(k)),p=passe?pAll:pAll.filter(x=>!x.archive); // mois en cours : une fiche « historique » ne compte pas comme argent disponible
  const recu=p.filter(x=>x.recu).reduce((a,x)=>a+(+x.montant||0),0);
  const att=p.filter(x=>!x.recu).reduce((a,x)=>a+(+x.montant||0),0);
  const arch=passe?0:pAll.filter(x=>x.archive).reduce((a,x)=>a+(+x.montant||0),0);
  const all=S.depenses.filter(x=>(x.date||"").startsWith(k));
  const d=all.filter(x=>!(x.fixe&&S.fixes.some(f=>f.id===x.fixe))); // une facture liée à une charge fixe (toujours existante) est déjà comptée dans les fixes
  const var_=d.reduce((a,x)=>a+(+x.montant||0),0);
  const autre=p.filter(x=>x.autre&&x.recu).reduce((a,x)=>a+(+x.montant||0),0);
  // factures pas encore payées : comptées dans « dep » (engagements), mais pas encore sorties du compte
  const nonPaye=all.filter(x=>x.paye===false);
  const fixAPayer=S.fixes.filter(f=>nonPaye.some(x=>x.fixe===f.id)).reduce((a,f)=>a+(+f.montant||0),0);
  const aPayer=nonPaye.filter(x=>!(x.fixe&&S.fixes.some(f=>f.id===x.fixe))).reduce((a,x)=>a+(+x.montant||0),0)+fixAPayer;
  const dep=var_+fixesTotal();
  return{p,pAll,arch,recu,att,autre,d,all,var_,fix:fixesTotal(),dep,aPayer,nAPayer:nonPaye.length,depPaye:dep-aPayer};
}
function missionPaid(m){return S.paies.filter(p=>p.mission===m.id&&p.recu&&!p.autre).reduce((a,p)=>a+(+p.montant||0),0)}
function daysTo(s){return Math.ceil((new Date(s+"T23:59")-new Date())/864e5)}
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
const row=(edit,left,right,ic)=>`<div class="row"><div class="l" data-edit="${edit}">${ic?`<span class="ci${ic.c?" "+ic.c:""}">${ic.i||ic}</span>`:""}<div class="tx">${left}</div></div><div style="display:flex;align-items:center;gap:2px">${right}</div></div>`;
const CAT_IC={courses:"🛒",transport:"🚆",carburant:"⛽",loisirs:"🎮",santé:"💊",vêtements:"👕",maison:"🏠",resto:"🍔",cadeaux:"🎁",autre:"📦",abonnements:"📱",animaux:"🐾",enfants:"🧸",assurance:"🛡️",impôts:"🏛️",épargne:"🐷",banque:"🏦",téléphone:"📱",internet:"🌐",loyer:"🏠",énergie:"⚡",sport:"🏋️",voyage:"✈️",beauté:"💇",cigarettes:"🚬",tabac:"🚬"};
function catIc(c){c=String(c||"");const m=c.match(/^\p{Extended_Pictographic}\uFE0F?/u);if(m)return m[0];const k=c.toLowerCase().trim();return CAT_IC[k]||(Object.entries(CAT_IC).find(([n])=>k.includes(n))||[])[1]||"💳"}
const vide=(ic,t)=>`<div class="empty"><span class="e-ic">${ic}</span>${t}</div>`;
let alertsAll=false;
function jourLabel(d){const t=today(),y=new Date();y.setDate(y.getDate()-1);if(d===t)return "Aujourd'hui";if(d===iso(y))return "Hier";return new Date(d+"T12:00").toLocaleDateString("fr-BE",{weekday:"long",day:"numeric",month:"long"})}
function render(){
  const k=mkey(cur), t=today(), isNow=k===mkey(new Date());
  $("mlabel").textContent=cur.toLocaleDateString("fr-BE",{month:"long",year:"numeric"});
  $("bToday").hidden=isNow;$("bToday").textContent="↩ Revenir à "+new Date().toLocaleDateString("fr-BE",{month:"long"});
  $("resteCard").querySelector(".k").textContent=isNow?"Reste à vivre ce mois":"Bilan de "+cur.toLocaleDateString("fr-BE",{month:"long"});
  const M=monthData(k), R=S.reglages, fx=fixesTotal();
  // argent réellement là : ce qui est reçu − ce qui est payé. « À recevoir » et « à payer » sont montrés à part.
  const reste=M.recu-M.depPaye, prevu=reste+M.att-M.aPayer;
  $("reste").textContent=eur(reste);
  $("resteCard").classList.toggle("neg",reste<0);
  $("resteSub").innerHTML=M.att>0||M.aPayer>0?[M.att>0?`<span style="color:var(--pos)">+ ${eur(M.att)} à recevoir</span>`:"",M.aPayer>0?`<span style="color:var(--out)">− ${eur(M.aPayer)} à payer</span>`:""].filter(Boolean).join(" · ")+`<br>→ <b>${eur(prevu)}</b> une fois tout reçu et payé`:"reçu − dépenses payées";
  $("recu").textContent=eur(M.recu);
  const nP=M.p.filter(x=>!x.autre).length;
  $("attendu").textContent=[M.autre>0?`dont ${eur(M.autre)} d'autres rentrées`:`${nP} paie(s)`,M.att>0?`+ ${eur(M.att)} à recevoir`:""].filter(Boolean).join(" · ");
  $("dep").textContent=eur(M.depPaye);
  $("depSub").textContent=M.aPayer>0?`payé · + ${eur(M.aPayer)} à payer (${M.nAPayer} facture${M.nAPayer>1?"s":""})`:`${eur(M.fix)} fixes · ${eur(M.var_)} variables`;

  // budget par jour
  $("jourCard").hidden=!isNow||(M.recu+M.att===0&&M.dep===0);
  if(isNow){const n=new Date(),dim=new Date(n.getFullYear(),n.getMonth()+1,0).getDate(),left=dim-n.getDate()+1;
    const pj=prevu/left;/* par jour : on tient compte de ce qui va encore rentrer et sortir */$("parJour").textContent=eur(pj);$("jourCard").querySelector(".k").textContent=pj<0?"Il te manque":"Tu peux dépenser";$("parJour").className="v "+(pj<0?"out":pj<10?"pend":"pos");
    $("jourSub").innerHTML=`par jour<br>${left} jour${left>1?"s":""} restant${left>1?"s":""}`;$("moisBar").style.width=((n.getDate()-1)/dim*100)+"%"}

  // alertes
  const A=[];
  const PB={pending:"Tes derniers changements n'arrivent pas jusqu'à Firebase. Ils sont gardés sur ce téléphone, ne vide pas les données de Chrome tant que le point n'est pas vert.",
    write:"Firebase a refusé l'enregistrement ("+esc(syncPbCode)+"). Tes changements sont gardés sur ce téléphone.",verify:"Firebase n'avait pas ta dernière version : je la renvoie automatiquement."};
  if(syncPb)A.push(["bad","Sauvegarde en ligne pas confirmée",PB[syncPb],`<div class="two" style="margin-top:10px"><button class="btn sm" data-resend="1">☁️ Renvoyer</button><button class="btn sec sm" data-diag="1">🩺 Diagnostic</button></div>`]);
  {const mi=loaded&&videServeur&&!aDesDonnees(S)?lireMiroir():null;
   if(mi)A.push(["bad","Tes données sont sur ce téléphone, pas sur Firebase",`Copie du ${new Date(mi.at).toLocaleString("fr-BE",{day:"numeric",month:"long",hour:"2-digit",minute:"2-digit"})} : ${esc(resumeEtat(mi.d))}.`,`<button class="btn sm" data-miroir="1" style="margin-top:10px">♻️ Remettre ces données</button>`])}
  {const lb=LS.get("lastBackup",0),sz=LS.get("bkSnooze",0);if(loaded&&aDesDonnees(S)&&Date.now()-lb>30*864e5&&Date.now()-sz>7*864e5)
    A.push(["","Garde une copie hors de l'appli","Une fois par mois, envoie ta sauvegarde sur Google Drive ou par mail : même si tout disparaît, tu pourras la remettre.",`<div class="two" style="margin-top:10px"><button class="btn sm" data-exporter="1">📤 Envoyer</button><button class="btn sec sm" data-bksnooze="1">Plus tard</button></div>`])}
  if(fsErr&&!loaded)A.push(["bad","Tes données ne s'affichent pas",esc(fsRaison(fsErr))+" Rien n'est effacé : l'appli n'écrit rien tant qu'elle n'a pas relu Firebase.",`<div class="two" style="margin-top:10px"><button class="btn sm" data-reco="1">🔄 Réessayer</button><button class="btn sec sm" data-diag="1">🩺 Diagnostic</button></div>`]);
  const active=S.missions.filter(m=>(!m.debut||m.debut<=t)&&(!m.fin||m.fin>=t));
  if(!S.missions.length) A.push(["","Ajoute ta première mission","Onglet Paies → nouvelle mission, ou scanne directement une fiche de paie 📷."]);
  else if(!active.length) A.push(["bad","Pas de mission en cours",`Avec tes charges fixes de ${eur(fx)}/mois, ton épargne tient ${fx?(R.epargne/fx).toLocaleString("fr-BE",{maximumFractionDigits:1}):"∞"} mois.`]);
  active.forEach(m=>{if(m.fin){const n=daysTo(m.fin);if(n<=14)A.push([n<=5?"bad":"","Fin de mission "+(n<=0?"aujourd'hui":"dans "+n+" j"),`${esc(m.client||m.agence)} se termine le ${fmtD(m.fin).replace(/\.$/,"")}. Pense à relancer ton agence.`])}
    else A.push(["ok","Mission en cours",`${esc(m.client||m.agence)}${m.taux?" · "+eurT(m.taux)+"/h brut":""}`])});
  const att=S.paies.filter(p=>!p.recu&&!p.archive&&p.date<t);
  if(att.length)A.push(["",`${att.length} paie${att.length>1?"s":""} en retard`,`${eur(sum(att,p=>p.montant))} attendus depuis le ${fmtD(att.map(p=>p.date).sort()[0])}. Vérifie ton compte ou relance l'agence.`]);
  {const dP=S.paies.filter(p=>p.detail&&!p.archive&&!p.ctrlVu).sort((x,y)=>y.date.localeCompare(x.date))[0];
    if(dP){const m=S.missions.find(x=>x.id===dP.mission),I=controlePaie(dP.detail,m,dP.id),B=ctrlBilan(I);
      if(B.bad+B.warn)A.push([B.bad?"bad":"",`Ta paie du ${fmtD(dP.date).replace(/\.$/,"")} : ${B.bad+B.warn} point${B.bad+B.warn>1?"s":""} à vérifier`,esc(I.filter(x=>x.s==="bad"||x.s==="warn").map(x=>x.t).join(", ")),`<button class="btn sm" data-detail="${dP.id}" style="margin-top:10px">Voir le contrôle</button>`])}}
  const ap=S.depenses.filter(x=>x.paye===false).sort((a,b)=>(a.echeance||"9").localeCompare(b.echeance||"9"));
  if(ap.length){const late=ap.filter(x=>x.echeance&&x.echeance<t),soon=ap.filter(x=>x.echeance&&x.echeance>=t&&daysTo(x.echeance)<=7);
    A.push([late.length?"bad":soon.length?"":"ok",`${ap.length} facture${ap.length>1?"s":""} à payer · ${eur(sum(ap,x=>x.montant))}`,ap.slice(0,3).map(x=>`${esc(x.note||x.cat)} ${eur2(x.montant)}${x.echeance?(x.echeance<t?" — <b style='color:var(--bad)'>en retard</b>":" — avant le "+fmtD(x.echeance)):""}`).join("<br>")])}
  Object.entries(S.budgets).forEach(([c,lim])=>{if(!(+lim>0))return;const sp=sum(M.d.filter(x=>x.cat===c),x=>x.montant);const p=sp/lim;
    if(p>=1)A.push(["bad",`Budget ${c} dépassé`,`${eur(sp)} dépensés pour ${eur(lim)} prévus (+${eur(sp-lim)}).`]);
    else if(p>=.85)A.push(["",`Budget ${c} presque atteint`,`${eur(sp)} sur ${eur(lim)} — il reste ${eur(lim-sp)}.`])});
  demarchesProches().filter(x=>!x.done&&x.date<=t).slice(0,2).forEach(x=>A.push(["",x.t,x.b+" <small>(coche-la dans Outils → Démarches)</small>"]));
  const deja=sum(S.epargneLog.filter(x=>(x.date||"").startsWith(k)&&x.montant>0),x=>x.montant);
  const aside=Math.max(0,M.recu*R.pct/100-deja);
  if(aside>=1&&R.pct>0) A.push(["ok",`Mets ${eur(aside)} de côté`,`${R.pct}% de tes paies reçues ce mois, pour tenir pendant les périodes sans mission.`,`<button class="btn sm" data-open="epargne" data-amt="${aside.toFixed(2)}" style="margin-top:10px">C'est fait</button>`]);
  const AI=t=>/sauvegarde en ligne|sur ce téléphone, pas/i.test(t)?"☁️":/copie hors/i.test(t)?"💾":/ne s'affichent/i.test(t)?"☁️":/à vérifier/i.test(t)?"🔎":/mission en cours/i.test(t)?"✅":/pas de mission/i.test(t)?"⚠️":/fin de mission/i.test(t)?"⏳":/paie/i.test(t)?"💶":/facture/i.test(t)?"🧾":/budget/i.test(t)?"📊":/de côté/i.test(t)?"🐷":/mission/i.test(t)?"🏭":"📌";
  A.sort((x,y)=>(y[0]==="bad")-(x[0]==="bad"));
  const aH=x=>`<div class="card alert ${x[0]}"><span class="ai">${AI(x[1])}</span><div style="flex:1;min-width:0"><div class="t">${x[1]}</div><p>${x[2]}</p>${x[3]||""}</div></div>`;
  $("alerts").innerHTML=A.slice(0,alertsAll?99:3).map(aH).join("")+(A.length>3&&!alertsAll?`<button type="button" class="more-alerts" data-moreal="1">Voir ${A.length-3} autre${A.length-3>1?"s":""} info${A.length-3>1?"s":""}</button>`:"");

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
  const vals=ms.map(d=>{const kk=mkey(d),x=monthData(kk);return[x.recu+x.att+x.arch,actif(kk)?x.dep:0]});
  const mx=Math.max(1,...vals.flat());
  $("chart").innerHTML=ms.map((d,i)=>`<div class="c"><div class="bars"><i style="height:${vals[i][0]/mx*100}%;background:#f4f4f5"></i><i style="height:${vals[i][1]/mx*100}%;background:var(--acc)"></i></div><small>${d.toLocaleDateString("fr-BE",{month:"short"}).replace(".","")}</small></div>`).join("");
  const withRev=vals.filter(v=>v[0]>0);$("chartAvg").textContent=withRev.length?"moy. "+eur(sum(withRev,v=>v[0])/withRev.length):"";

  // catégories
  const c={};M.d.forEach(x=>c[x.cat]=(c[x.cat]||0)+(+x.montant||0));
  const ce=Object.entries(c).sort((a,b)=>b[1]-a[1]);
  $("cats").innerHTML=ce.length?ce.map(([n,v])=>`<div class="cat" data-stat="cat" data-c="${esc(n)}" style="cursor:pointer"><span>${esc(n)} ›</span><b>${eur(v)} <small style="color:var(--mut);font-weight:600">${Math.round(v/M.var_*100)}%</small></b></div><div class="bar" style="margin-top:4px;height:6px" data-stat="cat" data-c="${esc(n)}"><i style="width:${v/ce[0][1]*100}%"></i></div>`).join(""):`<div class="empty">Aucune dépense ce mois</div>`;

  // missions
  const ms2=[...S.missions].sort((a,b)=>(b.debut||"").localeCompare(a.debut||""));
  $("missions").innerHTML=ms2.length?ms2.map(m=>{
    const on=(!m.debut||m.debut<=t)&&(!m.fin||m.fin>=t);
    const h=sum(S.paies.filter(p=>p.mission===m.id),p=>p.heures);
    return row("mission:"+m.id,`<b>${m.contrat||m.photo?"📑 ":""}${esc(m.client||"Mission")}${on?'<span class="pill g">en cours</span>':(m.debut>t?'<span class="pill y">à venir</span>':'')}</b>
    <small>${esc(m.agence)} · ${fmtD(m.debut)}${m.fin?" → "+fmtD(m.fin):" → ?"}${m.taux?" · "+eurT(m.taux)+"/h":""}</small><br><small>Reçu : ${eur(missionPaid(m))}${h?" · "+fmtN(h)+" h":""}${+m.km>0?" · 🚗 "+fmtN(m.km)+" km ≈ "+eur2(coutJour(m))+"/j":""}</small>`,
    `<button class="btn sm" data-paie="${m.id}">+ Paie</button><button class="del" data-del="missions:${m.id}">×</button>`)}).join(""):`<div class="empty">Aucune mission</div>`;

  try{renderBourse()}catch(e){console.error(e)}
  // paies
  const pm=[...M.pAll].sort((a,b)=>b.date.localeCompare(a.date));
  $("paies").innerHTML=pm.length?pm.map(p=>{const m=S.missions.find(x=>x.id===p.mission);
    let cb="";if(p.detail&&!p.archive){const B=ctrlBilan(controlePaie(p.detail,m,p.id));cb=p.ctrlVu?'<span class="pill">✓ vérifiée</span>':B.bad?`<span class="pill r">❌ ${B.bad+B.warn} à vérifier</span>`:B.warn?`<span class="pill y">⚠️ ${B.warn} à vérifier</span>`:'<span class="pill ok">✅ contrôlée</span>'}
    return row("paie:"+p.id,`<b>${p.photo?"🖼️ ":p.detail?"📄 ":""}${esc(m?(m.client||m.agence):(p.note||(p.autre?"Rentrée":"Paie")))}${p.autre?'<span class="pill">rentrée</span>':""}${cb}${p.archive?'<span class="pill">📚 historique</span>':p.recu?"":`<span class="pill y">à recevoir${p.date>today()?" · "+fmtD(p.date):""}</span>`}</b><small>${fmtD(p.date)}${p.heures?" · "+fmtN(p.heures)+" h":""}${p.note&&m?" · "+esc(p.note):""}</small>`,
    `<span class="amt ${p.archive?"":p.recu?"pos":"pend"}" ${p.archive?"":`data-toggle="${p.id}"`} style="cursor:pointer;${p.archive?"color:var(--mut)":""}">${eur2(p.montant)}</span><button class="del" data-del="paies:${p.id}">×</button>`,{i:p.autre?"💰":p.archive?"📚":"💶",c:p.archive?"pay arch":"pay"})}).join("")+`<div class="sub" style="padding-top:8px">Touche une paie pour la modifier, ou son montant pour la marquer reçue / à recevoir.</div>`:vide("💶","Aucune paie ce mois.<br>Scanne ta fiche de paie ou ajoute-la à la main.");

  // fixes
  $("fixes").innerHTML=S.fixes.length?S.fixes.map(f=>row("fixe:"+f.id,`<b>${esc(f.nom)}</b>${f.jour?`<small>le ${esc(f.jour)} du mois</small>`:""}`,`<span class="amt out">${eur2(f.montant)}</span><button class="del" data-del="fixes:${f.id}">×</button>`,catIc(f.nom)==="💳"?"🔁":catIc(f.nom))).join("")+`<div class="row"><div class="l"><b>Total</b></div><span class="amt">${eur2(fx)}</span></div>`:vide("🔁","Loyer, assurance, téléphone, abonnements…<br>Ajoute ce qui tombe chaque mois.");

  // budgets
  const bl=Object.entries(S.budgets).filter(([,v])=>+v>0);
  $("budgets").innerHTML=bl.length?bl.map(([cat,lim])=>{const sp=sum(M.d.filter(x=>x.cat===cat),x=>x.montant),p=sp/lim;
    return `<div class="cat"><span>${esc(cat)}</span><b class="${p>=1?"out":""}">${eur(sp)} <small style="color:var(--mut);font-weight:600">/ ${eur(lim)}</small></b></div><div class="bar" style="margin-top:4px;height:6px"><i style="width:${Math.min(100,p*100)}%;background:${p>=1?"var(--bad)":p>=.85?"var(--warn)":"var(--pos)"}"></i></div>`}).join(""):`<div class="empty">Fixe un plafond par catégorie (courses, resto…) et l'appli te prévient avant de le dépasser.</div>`;

  // dépenses (+ recherche)
  const q=($("search").value||"").trim().toLowerCase();
  const dl=q?S.depenses.filter(d=>((d.note||"")+" "+(d.cat||"")+" "+fmtN(d.montant)+" "+d.montant).toLowerCase().includes(q)):M.all;
  const dm=[...dl].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,q?100:500);
  $("depenses").innerHTML=(q?`<div class="sub" style="padding-bottom:6px">${dl.length} résultat(s) · ${eur2(sum(dl,x=>x.montant))} au total</div>`:"")+(dm.length?dm.map((d,i)=>(!q&&(i===0||dm[i-1].date!==d.date)?`<div class="day"><span>${jourLabel(d.date)}</span><span>−${eur2(sum(dm.filter(x=>x.date===d.date),x=>x.montant))}</span></div>`:"")+row("depense:"+d.id,`<b>${d.photo?"🖼️ ":d.detail?"🧾 ":""}${esc(d.note||d.cat)}${d.fixe&&S.fixes.some(f=>f.id===d.fixe)?'<span class="pill">charge fixe</span>':""}${d.paye===false?`<span class="pill ${d.echeance&&d.echeance<today()?"r":"y"}">à payer${d.echeance?" · "+fmtD(d.echeance):""}</span>`:""}</b><small>${q?new Date(d.date+"T12:00").toLocaleDateString("fr-BE")+" · ":""}${esc(d.cat)}</small>`,`<span class="amt ${d.paye===false?"pend":"out"}" data-ptoggle="${d.id}" style="cursor:pointer">−${eur2(d.montant)}</span><button class="del" data-del="depenses:${d.id}">×</button>`,catIc(d.cat))).join(""):q?vide("🔍","Aucun résultat"):vide("🧾","Aucune dépense ce mois.<br>Touche <b>Ajouter</b> ou scanne un ticket."));

  renderStats();renderOutils();renderExtras(M,k);renderPrevision();renderSettings();renderTrajets();renderDemarches();renderScore(M,k);renderSubs();renderDoublons();try{renderAccStatus()}catch(e){console.warn(e)}
  // réglages
  if(document.activeElement?.closest?.("#fSet")==null){$("sEpargne").value=R.epargne;$("sPct").value=R.pct;$("sMois").value=R.mois;$("sRatio").value=R.ratio;$("sStatut").value=R.statut||"ouvrier";$("sDomicile").value=R.domicile||"";$("sConso").value=R.conso;$("sCarbu").value=R.carbu}
}

/* ---------- bilan fiscal de l'année (ONSS, précompte, impôt estimé) ---------- */
// Les règles de calcul (impôt, ONSS, bonus à l'emploi, 281.10) sont dans calculs.js, testées dans tests/.
function bilanFiscal(y){return bilanAnnee(S,y)}
/* À charge de ses parents ? ressources nettes = brut imposable − frais professionnels forfaitaires */
function chargeParentsHTML(b,R,y){
  const c=chargeParents(b.imposable,!!R.fiscParentSeul), res=c.ressources, plaf=c.plafond;
  const fin=+y<new Date().getFullYear()?"":` (l'année n'est pas finie${b.src==="paies"&&b.nSans?", et les paies non scannées ne sont pas comptées":""})`;
  return res>plaf
    ?`<div class="warnbox" style="margin:10px 0 0">👨‍👩‍👦 <b>Tu n'es plus à charge de tes parents pour ${y}</b> : tes ressources nettes (≈ ${eur(res)}) dépassent le plafond d'environ ${eur(plaf)}. Préviens-les : ils ne peuvent plus te déclarer comme enfant à charge, leur impôt va augmenter.</div>`
    :`<div class="okbox" style="margin:10px 0 0">👨‍👩‍👦 Tu es encore à charge de tes parents : ≈ ${eur(res)} de ressources nettes sur un plafond d'environ ${eur(plaf)}. Il te reste ≈ <b>${eur(plaf-res)}</b> avant de le dépasser${fin}.</div>`;
}
function situationTxt(R){
  const n=+R.fiscEnf||0;
  return (R.fiscSit==="couple"?"Marié(e) / cohabitant(e) légal(e)":R.fiscSit==="parents"?"Domicilié(e) chez mes parents":"Isolé(e)")+(n?` · ${n} enfant${n>1?"s":""} à charge`:" · sans enfant à charge");
}
function situationFiscale(){
  const R=S.reglages, v=k=>R[k]===undefined||R[k]===null?"":R[k];
  openRaw(`<h3>Ma situation familiale <button class="del" data-close>×</button></h3>
  <form id="fFisc">
    <label>Situation au 1er janvier de l'année suivante<select name="fiscSit"><option value="isole" ${!R.fiscSit||R.fiscSit==="isole"?"selected":""}>Isolé(e), célibataire, divorcé(e), cohabitant de fait</option><option value="parents" ${R.fiscSit==="parents"?"selected":""}>Domicilié(e) chez mes parents</option><option value="couple" ${R.fiscSit==="couple"?"selected":""}>Marié(e) ou cohabitant(e) légal(e)</option></select></label>
    <div class="two"><label>Enfants à charge<input name="fiscEnf" type="number" min="0" step="1" inputmode="numeric" value="${v("fiscEnf")||0}"></label><label>dont moins de 3 ans<input name="fiscEnf3" type="number" min="0" step="1" inputmode="numeric" value="${v("fiscEnf3")||0}"></label></div>
    <p class="sub" style="margin:6px 0 10px">Un cohabitant de fait (pas déclaré à la commune) compte comme isolé : chacun fait sa propre déclaration. Chez tes parents, tu fais aussi ta propre déclaration.</p>
    <label>Si tu vis chez tes parents, ils sont<select name="fiscParentSeul"><option value="0" ${!R.fiscParentSeul?"selected":""}>en couple (mariés / cohabitants)</option><option value="1" ${R.fiscParentSeul?"selected":""}>un parent seul</option></select></label>
    <div class="k">Si tu es marié(e) ou cohabitant(e) légal(e)</div>
    <div class="two"><label>Brut imposable du conjoint (année)<input name="fiscConj" type="number" min="0" step="1" inputmode="decimal" value="${v("fiscConj")}" placeholder="0"></label><label>Précompte retenu du conjoint<input name="fiscConjPP" type="number" min="0" step="1" inputmode="decimal" value="${v("fiscConjPP")}" placeholder="0"></label></div>
    <p class="sub" style="margin:6px 0 10px">Brut moins ONSS, sur sa fiche 281.10 (case « rémunérations ») ou ses fiches de paie. Laisse 0 s'il n'a pas de revenus.</p>
    <label>Taxe communale (%)<input name="fiscCommune" type="number" min="0" max="10" step="0.1" inputmode="decimal" value="${v("fiscCommune")===""?7:v("fiscCommune")}"></label>
    <p class="sub" style="margin:6px 0 10px">Entre 0 et 9 % selon ta commune (souvent 6 à 8 %). Tu la trouves sur ton dernier avertissement-extrait de rôle.</p>
    <button class="btn">Enregistrer</button>
  </form>`);
}
function saveSituation(f){
  const d=Object.fromEntries(new FormData(f)),R=S.reglages,n=x=>Math.max(0,+String(x||"").replace(",",".")||0);
  R.fiscSit=["couple","parents"].includes(d.fiscSit)?d.fiscSit:"isole";R.fiscParentSeul=d.fiscParentSeul==="1";R.fiscEnf=Math.floor(n(d.fiscEnf));R.fiscEnf3=Math.min(R.fiscEnf,Math.floor(n(d.fiscEnf3)));
  R.fiscConj=n(d.fiscConj);R.fiscConjPP=n(d.fiscConjPP);R.fiscCommune=Math.min(10,n(d.fiscCommune));
  closeSheet();save();toast("Situation enregistrée ✓");
}
function renderBilanFiscal(y){
  const box=$("bilanFiscal");if(!box)return;
  const b=bilanFiscal(y);
  $("bilanAnnee").textContent=`🧾 Bilan fiscal ${y}`;
  const btn281=`<button class="btn sec scanBtn" data-mode="f281" style="margin-top:10px">📄 Scanner une fiche 281.10</button>`;
  if(!b.P.length&&!b.F.length){box.innerHTML=`<div class="empty">Aucune paie en ${y}.</div>`+btn281;return}
  if(b.src==="paies"&&!b.brut){box.innerHTML=`<div class="empty">Pour calculer tes cotisations et ton impôt, scanne tes fiches de paie 📷 (ou tes anciennes fiches 📚) : il faut le brut et les retenues de chaque fiche. Ou scanne directement tes fiches 281.10.</div>`+btn281;return}
  const pct=v=>(v*100).toLocaleString("fr-BE",{maximumFractionDigits:1})+" %";
  const ligne=(t,v,c="")=>`<div class="cat"><span>${t}</span><b class="${c}">${v}</b></div>`;
  const s=b.solde, couvert=b.P.length-b.nSans, i=b.ipp, R=S.reglages;
  const revFoyer=b.imposable+(i.couple?+R.fiscConj||0:0);
  const source=b.src==="281"
    ?`<div class="okbox" style="margin:8px 0">📄 Chiffres officiels de ${b.F.length} fiche(s) 281.10.</div>`+
      b.F.map(f=>`<div class="cat"><span>📄 ${esc(f.employeur||"Employeur")} <small style="color:var(--mut)">· ${eur(+f.remu+(+f.autres||0))} · précompte ${eur(f.pp)}</small></span><button class="del" data-del="fiches281:${f.id}">×</button></div>`).join("")+
      (b.manquantes.length?`<div class="warnbox" style="margin:8px 0 0">Il manque la fiche 281.10 de : <b>${b.manquantes.map(esc).join(", ")}</b>. Tant qu'elle manque, ses revenus ne sont pas comptés.</div>`:"")+
      `<div class="k" style="margin-top:14px">Tes revenus ${y}</div>`+
      ligne("Rémunérations imposables",eur2(b.imposable))+
      (b.bonusSocial?ligne("Bonus à l'emploi (réduction de tes cotisations ONSS)",eur2(b.bonusSocial)):"")+
      ligne("Précompte professionnel retenu","− "+eur2(b.pp),"out")
    :`<div class="sub" style="margin:8px 0">${couvert} fiche(s) de paie scannée(s) sur ${b.P.length} paie(s)${b.nSans?` · <b>${b.nSans} sans détail</b>, pas comptée(s) ci-dessous`:""}</div>`+
      ligne("Salaire brut",eur2(b.brut))+
      ligne(`Cotisations ONSS${b.nEst?` <small style="color:var(--mut)">(${b.nEst} estimée(s) à 13,07 %)</small>`:""}`,"− "+eur2(b.onss),"out")+
      (b.bonusSocial?ligne("dont bonus à l'emploi (ONSS en moins)",eur2(b.bonusSocial)):"")+
      ligne("Brut imposable",eur2(b.imposable))+
      ligne("Précompte professionnel retenu","− "+eur2(b.pp),"out");
  box.innerHTML=
    `<div class="cat" style="cursor:pointer" data-fisc="1"><span>👪 ${situationTxt(R)}</span><b style="color:var(--acc,inherit)">Modifier ›</b></div>`+
    source+
    `<div class="k" style="margin-top:14px">Impôt estimé (déclaration ${+y+1})</div>`+
    ligne("Frais professionnels forfaitaires","− "+eur(i.frais))+
    ligne("Ton revenu net imposable",eur(i.net))+
    (i.couple?ligne("Revenu net imposable du conjoint",eur(i.netC))+(i.quotient?ligne("Quotient conjugal (transfert vers celui qui gagne le moins)",eur(i.quotient)):""):"")+
    (i.suppl?ligne(`Quotité exemptée en plus (enfants${!i.couple&&i.nEnf?", parent seul":""})`,eur(i.suppl)):"")+
    (i.bonusFisc?ligne("Bonus à l'emploi fiscal (réduction d'impôt)","− "+eur(i.bonusFisc),"pos"):"")+
    ligne(`Impôt ${i.couple?"du ménage ":""}fédéral + communal (${pct(i.communalPct)})`,eur(i.total))+
    ligne("Taux moyen",revFoyer?pct(i.total/revFoyer):"—")+
    `<div class="${s>=0?"okbox":"warnbox"}" style="margin:10px 0 0">${s>=0?`💚 Remboursement estimé : <b>${eur(s)}</b>`:`⚠️ Supplément à payer estimé : <b>${eur(-s)}</b>`}<br><small>Précompte retenu ${eur(b.pp)}${i.couple?` + conjoint ${eur(b.ppConj)}`:""} − impôt estimé ${eur(i.total)}.</small></div>`+
    (R.fiscSit==="parents"?chargeParentsHTML(b,R,y):"")+
    (i.perdu?`<div class="warnbox" style="margin:8px 0 0">Tes revenus sont trop bas pour profiter de tout le supplément pour enfants : tu as sans doute droit en plus à un <b>crédit d'impôt remboursable</b> (pas compté ici).</div>`:"")+
    (b.src==="paies"?btn281+`<p class="sub" style="margin-top:6px">En mars, chaque agence t'envoie ta fiche 281.10 : scanne-la, le calcul utilisera les chiffres officiels.</p>`:btn281)+
    `<p class="sub" style="margin-top:8px">Estimation avec le barème des revenus 2025. Le bonus à l'emploi fiscal est compté au taux le plus bas (33,14 %) : il peut être un peu plus élevé. Ne tient pas compte des frais de garde, des pensions alimentaires ni des réductions (titres-services, épargne-pension…).</p>`;
}

function renderStats(){
  const y=String(cur.getFullYear()), R=S.reglages;
  renderBilanFiscal(y);
  const P=S.paies.filter(p=>!p.autre&&(p.date||"").startsWith(y)), D=S.depenses.filter(d=>(d.date||"").startsWith(y)&&!(d.fixe&&S.fixes.some(f=>f.id===d.fixe)));
  const net=sum(P,p=>p.montant), h=sum(P,p=>p.heures), fx=fixesTotal();
  const moisActifs=new Set([...P,...D].map(x=>x.date.slice(0,7)));
  const nbM=Math.max(1,moisActifs.size);
  $("yLabel").textContent="Net gagné en "+y;$("yNet").textContent=eur(net);
  const nA=sum(P.filter(p=>p.archive),p=>p.montant);$("ySub").textContent=P.length?`${P.length} paie(s) · moy. ${eur(net/nbM)}/mois${nA?" · dont "+eur(nA)+" d'anciennes fiches":""}`:"Aucune paie cette année";
  $("yHeures").textContent=fmtN(h)+" h";
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
  $("parAgence").innerHTML=al.length?al.map(([n,v])=>`<div class="cat"><span>${esc(n)} <small style="color:var(--mut)">· ${v.c} paie(s)${v.h?" · "+fmtN(v.h)+" h":""}</small></span><b>${eur(v.n)}</b></div><div class="bar" style="margin-top:4px;height:6px"><i style="width:${v.n/al[0][1].n*100}%"></i></div>`).join(""):`<div class="empty">Aucune paie en ${y}</div>`;

  // mois par mois
  const nowK=mkey(new Date());let rows="";const first=[...moisActifs].sort()[0]||nowK;
  for(let i=0;i<12;i++){const k=y+"-"+String(i+1).padStart(2,"0");const x=monthData(k);const act=moisActifs.has(k);if(!act&&(k>nowK||k<first))continue;
    const rev=x.recu+x.att+x.arch, dd=act?x.dep:0;
    rows+=`<tr class="${k===nowK?"cur":""}"><td>${new Date(k+"-15").toLocaleDateString("fr-BE",{month:"short"})}</td><td>${rev?eur(rev):"—"}</td><td>${dd?eur(dd):"—"}</td><td class="${rev-dd<0?"out":rev-dd>0?"pos":""}">${rev||dd?eur(rev-dd):"—"}</td></tr>`}
  $("parMois").innerHTML=rows?`<table class="mt"><tr><th>Mois</th><th>Revenus</th><th>Dépenses</th><th>Solde</th></tr>${rows}</table>`:`<div class="empty">Rien en ${y}</div>`;
}

/* ---------- outils intérim ---------- */
function paques(y){const a=y%19,b=Math.floor(y/100),c=y%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451),mo=Math.floor((h+l-7*m+114)/31),da=((h+l-7*m+114)%31)+1;return new Date(y,mo-1,da,12)}
function feries(y){const p=paques(y),add=n=>{const d=new Date(p);d.setDate(d.getDate()+n);return iso(d)};
  return {[y+"-01-01"]:"Nouvel An",[add(1)]:"Lundi de Pâques",[y+"-05-01"]:"Fête du Travail",[add(39)]:"Ascension",[add(50)]:"Lundi de Pentecôte",[y+"-07-21"]:"Fête nationale",[y+"-08-15"]:"Assomption",[y+"-11-01"]:"Toussaint",[y+"-11-11"]:"Armistice",[y+"-12-25"]:"Noël"}}
const brutDe=p=>(p.detail&&+p.detail.brut)||(+p.montant||0)/((+S.reglages.ratio||78)/100);
function periodeStats(a,b){ // a,b = "YYYY-MM-DD" inclus
  const P=S.paies.filter(p=>!p.autre&&p.date>=a&&p.date<=b), T=S.pointage.filter(x=>x.date>=a&&x.date<=b&&+x.heures>0);
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
    cal+=`<div class="d ${h?"w":mis?"mis":""} ${ds===t?"today":""} ${F[ds]?"fer":""}" data-day="${ds}" title="${F[ds]||""}">${d}${h?`<small>${fmtN(h)}h</small>`:""}</div>`}
  $("calendar").innerHTML=cal+"</div>";
  const hm=sum(Object.values(byDay),x=>x),jm=Object.keys(byDay).length,fm=Object.entries(F).filter(([d])=>d.startsWith(k));
  $("calSub").innerHTML=`${jm} jour(s) pointé(s) · ${fmtN(hm)} h${fm.length?` · Férié${fm.length>1?"s":""} : ${fm.map(([d,n])=>fmtD(d)+" ("+n+")").join(", ")}`:""}<br><small>Touche un jour pour pointer tes heures. Rouge = travaillé, foncé = en mission, point jaune = férié payé.</small>`;

  // prime de fin d'année (période 1/7 → 30/6, versée en décembre)
  const yS=now.getMonth()>=6?now.getFullYear():now.getFullYear()-1;
  const cA=yS+"-07-01",cB=(yS+1)+"-06-30",pA=(yS-1)+"-07-01",pB=yS+"-06-30";
  const C=periodeStats(cA,cB),P=periodeStats(pA,pB);
  const bloc=(st,a,b,pay,enCours)=>{const pr=primeFinAnnee(st),ok=pr.ok,prog=pr.progression,pb=pr.brut;
    return `<div class="k">${enCours?"Période en cours":"Période terminée"} : ${fmtD(a)} ${a.slice(0,4)} → ${fmtD(b)} ${b.slice(0,4)}</div>
    <div class="top" style="display:flex;justify-content:space-between;margin-top:6px"><b>${st.jours} j${st.estime?"*":""} · ${fmtN(st.heures)} h</b><span class="${ok?"pos":"pend"}" style="font-weight:800">${ok?"✓ Droit ouvert":enCours?`encore ${Math.max(0,65-st.jours)} j ou ${fmtN(Math.max(0,494-st.heures))} h`:"✗ Conditions non atteintes"}</span></div>
    <div class="bar"><i style="width:${prog}%;background:${ok?"var(--pos)":"var(--acc)"}"></i></div>
    <div class="sub" style="margin-top:6px">${ok||enCours?`Prime ${ok?"":"estimée si le droit s'ouvre "}: <b style="color:var(--txt)">${eur(pb)} brut</b> ≈ ${eur(pb*0.66)} net · versée en ${pay}`:""}</div>`};
  $("primeCard").innerHTML=(P.nbPaies?bloc(P,pA,pB,"décembre "+yS,false)+`<div style="height:14px"></div>`:"")+bloc(C,cA,cB,"décembre "+(yS+1),true)+
    `<p class="sub" style="margin-top:10px">Règle : 65 jours ou 494 heures comme intérimaire entre le 1er juillet et le 30 juin. Prime = 8,33 % du brut gagné, payée par le Fonds social des intérimaires.${(C.estime||P.estime)?" *Jours estimés depuis tes heures payées : pointe tes jours pour un compte exact.":""}</p>`;

  // pécule de vacances
  if(R.statut==="employe")$("peculeCard").innerHTML=`<div class="okbox">En tant qu'employé intérimaire, ton pécule (15,34 %) est déjà ajouté à chaque paie par l'agence.</div>`;
  else{const yN=now.getFullYear(),b1=periodeStats((yN-1)+"-01-01",(yN-1)+"-12-31").brut,b0=periodeStats(yN+"-01-01",yN+"-12-31").brut;
    const pc=peculeOuvrier;
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
  const lf=x=>x.fixe&&S.fixes.some(f=>f.id===x.fixe);const W=S.depenses.filter(x=>x.date>=a7&&x.date<=t&&!lf(x)),W0=S.depenses.filter(x=>x.date>=a14&&x.date<a7&&!lf(x)),Pw=S.paies.filter(p=>p.date>=a7&&p.date<=t&&!p.archive);
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
    const m=cont.find(x=>+x.taux>0);const h=wk.size?sum(P28,x=>x.heures)/wk.size:(m&&+m.hsem)||38;
    if(m){rev=h*4.33*m.taux*S.reglages.ratio/100;src=`${Math.round(h)} h/sem × ${eurT(m.taux)} brut`}else if(mois.length){rev=sum(mois,x=>x)/mois.length;src="moyenne de tes derniers mois"}}
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
  const am=LS.get("aiModele",null),ep=LS.get("aiEpuise",{}),jr=new Date().toISOString().slice(0,10),nEp=Object.values(ep).filter(v=>v===jr).length;
  $("aiState").textContent=!canImg?"Gemini n'est pas disponible.":`Modèle utilisé : ${am||geminiModel}${nEp?` · ${nEp} modèle(s) au quota épuisé aujourd'hui (bascule automatique)`:""}.`;
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
  $("pinPad").innerHTML=[1,2,3,4,5,6,7,8,9,"",0,"⌫"].map(k=>k===""?"<div></div>":`<button type="button" data-pin="${k}">${k}</button>`).join("")+(mode!=="unlock"?`<button type="button" data-pin="x" style="grid-column:1/-1;border-radius:14px;height:48px;font-size:15px">Annuler</button>`:`<button type="button" data-pin="forgot" style="grid-column:1/-1;border-radius:14px;height:44px;font-size:13px;background:none;color:var(--mut)">Code oublié ?</button>`)}
function drawPin(){$("pinDots").textContent="●".repeat(pinBuf.length)+"○".repeat(4-pinBuf.length)}
$("pinPad").onclick=async e=>{const b=e.target.closest("[data-pin]");if(!b)return;const k=b.dataset.pin;
  if(k==="x"){$("lock").hidden=true;return}
  if(k==="forgot"){if(b.dataset.confirm!=="1"){b.dataset.confirm="1";b.textContent="Retirer le code et te déconnecter ? Appuie encore";return}
    LS.set("pinHash",null);$("lock").hidden=true;if(auth)signOut(auth);toast("Code retiré : reconnecte-toi avec Google");return}
  if(k==="⌫"){pinBuf=pinBuf.slice(0,-1);drawPin();return}
  if(pinBuf.length<4)pinBuf+=k;drawPin();if(pinBuf.length<4)return;
  if(pinMode==="unlock"){if(await hashPin(pinBuf)===LS.get("pinHash","")){$("lock").hidden=true;LS.set("pinTries",0)}else{pinBuf="";setTimeout(drawPin,200);$("pinMsg").textContent="Code incorrect"}}
  else if(pinMode==="set1"){pinFirst=pinBuf;showPad("set2")}
  else if(pinMode==="set2"){if(pinBuf===pinFirst){LS.set("pinHash",await hashPin(pinBuf));$("lock").hidden=true;renderSettings();renderBio();toast("Code PIN activé 🔒")}else{showPad("set1");$("pinMsg").textContent="Les codes ne correspondent pas, recommence"}}
};
$("bPin").onclick=()=>{if(LS.get("pinHash",null)){LS.set("pinHash",null);LS.set("bioId",null);renderSettings();renderBio();toast("Code PIN retiré")}else showPad("set1")};
let hiddenAt=0;document.addEventListener("visibilitychange",()=>{if(document.hidden)hiddenAt=Date.now();else if(LS.get("pinHash",null)&&hiddenAt&&Date.now()-hiddenAt>3*60e3){showPad("unlock");if(LS.get("bioId",null))setTimeout(bioDeverrouiller,300)}});
if(LS.get("pinHash",null)){showPad("unlock");if(LS.get("bioId",null))setTimeout(bioDeverrouiller,400)}
// rappels : calculés ici, stockés pour le service worker (notifications même appli fermée si le téléphone le permet)
function rappels(){const t=today(),L=[],add=(id,date,title,body)=>L.push({id,date,title,body});
  S.depenses.filter(x=>x.paye===false&&x.echeance).forEach(x=>{const d=new Date(x.echeance+"T12:00");d.setDate(d.getDate()-3);add("f3-"+x.id,iso(d),"🧾 Facture à payer",`${x.note||x.cat} : ${eur2(x.montant)} avant le ${fmtD(x.echeance)}`);add("f0-"+x.id,x.echeance,"⚠️ Facture à payer aujourd'hui",`${x.note||x.cat} : ${eur2(x.montant)}`)});
  S.missions.filter(m=>m.fin&&m.fin>=t).forEach(m=>{const d=new Date(m.fin+"T12:00");d.setDate(d.getDate()-3);add("m-"+m.id+m.fin,iso(d),"🏭 Fin de mission bientôt",`${m.client||m.agence} se termine le ${fmtD(m.fin)}. Pense à relancer ton agence.`)});
  const n=new Date();S.fixes.filter(f=>+f.jour>0).forEach(f=>{for(const off of [0,1]){const dim=new Date(n.getFullYear(),n.getMonth()+off+1,0).getDate(),d=new Date(n.getFullYear(),n.getMonth()+off,Math.min(+f.jour,dim)-1,12);add("p-"+f.id+iso(d),iso(d),"🔁 Prélèvement demain",`${f.nom} : ${eur2(f.montant)}`)}});
  S.cr.forEach(l=>{const e=new Date(l.date+"T12:00");e.setFullYear(e.getFullYear()+1);e.setDate(e.getDate()-14);if((+l.nb||0)-(+l.used||0)>0)add("cr-"+l.id,iso(e),"🍽️ Chèques-repas","Des chèques-repas expirent dans 2 semaines.")});
  demarchesProches().filter(x=>!x.done).forEach(x=>add("adm-"+x.k,x.date,x.t,x.b.slice(0,120)));
  return L.filter(x=>x.date>=iso(new Date(Date.now()-864e5)))}
async function syncRappels(){try{if(!("caches" in window))return;const c=await caches.open("rappels");await c.put("rappels.json",new Response(JSON.stringify(rappels()),{headers:{"content-type":"application/json"}}))}catch(e){}}
async function notifierMaintenant(){if(!("Notification" in window)||Notification.permission!=="granted")return;const t=today(),vus=LS.get("notifVus",[]);
  const reg=await navigator.serviceWorker?.getRegistration?.();const due=rappels().filter(x=>x.date<=t&&!vus.includes(x.id));
  for(const r of due.slice(0,3)){try{reg?reg.showNotification(r.title,{body:r.body,icon:"icon-192.png",badge:"icon-192.png",tag:r.id}):new Notification(r.title,{body:r.body,icon:"icon-192.png"})}catch(e){}vus.push(r.id)}
  LS.set("notifVus",vus.slice(-300))}
$("bNotif").onclick=async()=>{if(!("Notification" in window))return;const p=await Notification.requestPermission();
  if(p==="granted"){try{const reg=await navigator.serviceWorker.ready;if(reg.periodicSync)await reg.periodicSync.register("rappels",{minInterval:12*3600e3})}catch(e){}syncRappels();notifierMaintenant();toast("Rappels activés 🔔")}renderSettings()};
// raccourcis (appui long sur l'icône)
function raccourci(){const qs=new URLSearchParams(location.search);if(qs.get("share")){history.replaceState(null,"",location.pathname);gererPartage();return}
  const a=qs.get("a");if(!a)return;history.replaceState(null,"",location.pathname);
  if(a==="depense")openSheet("depense");else if(a==="pointage")openSheet("pointage");
  else if(a==="facture")pickSource("Scanner une facture / un ticket",f=>scanFacture(f));else if(a==="paie")pickSource("Scanner une fiche de paie",f=>scanFile(f));else if(a==="contrat")pickSource("Scanner un contrat",f=>scanContrat(f))}

/* ---------- assistant IA ---------- */
function resumeDonnees(){
  const R=S.reglages,L=[];
  L.push(`Aujourd'hui : ${today()}. Statut : intérimaire ${R.statut} en Belgique. Épargne (coussin) : ${eur2(R.epargne)}. Objectif d'épargne par paie : ${R.pct} %. Ratio net/brut : ${R.ratio} %.`);
  L.push("Charges fixes mensuelles : "+(S.fixes.map(f=>`${f.nom} ${eur2(f.montant)}`).join(", ")||"aucune")+` (total ${eur2(fixesTotal())}).`);
  if(Object.keys(S.budgets).length)L.push("Budgets mensuels : "+Object.entries(S.budgets).map(([c,v])=>`${c} ${eur(v)}`).join(", "));
  if(S.objectifs.length)L.push("Objectifs : "+S.objectifs.map(o=>`${o.nom} ${eur(o.actuel||0)}/${eur(o.cible)}${o.echeance?" pour le "+o.echeance:""}`).join(", "));
  const act=S.missions.filter(m=>!m.fin||m.fin>=today());L.push("Missions en cours/à venir : "+(act.map(m=>`${m.client||""} (${m.agence}) ${m.taux?m.taux+" €/h brut":""}${m.hsem?" "+m.hsem+" h/sem":""} ${m.debut||""}→${m.fin||"?"}${m.contrat&&m.contrat.horaire?" horaire "+m.contrat.horaire:""}${+m.km>0?" trajet "+m.km+" km aller ("+eur2(coutJour(m))+"/jour)":""}`).join("; ")||"aucune"));
  const ms=[];for(let i=0;i<6;i++){const d=new Date();d.setDate(1);d.setMonth(d.getMonth()-i);const k=mkey(d),x=monthData(k),c={};x.d.forEach(e=>c[e.cat]=(c[e.cat]||0)+(+e.montant||0));
    ms.push(`${k} : revenus ${eur(x.recu+x.att)}, dépenses variables ${eur(x.var_)} [${Object.entries(c).map(([n,v])=>n+" "+eur(v)).join(", ")}]`)}
  L.push("Par mois (revenus = argent disponible, hors anciennes fiches d'historique) :\n"+ms.join("\n"));
  const tx=[...S.paies.map(p=>`${p.date};${p.autre?"AUTRE RENTREE":"PAIE"}${p.archive?" (historique, argent déjà dépensé)":""};+${p.montant};${p.heures||""}h`),...S.depenses.map(d=>`${d.date};DEPENSE;-${d.montant};${d.cat};${(d.note||"").slice(0,30)}${d.paye===false?";À PAYER":""}`)].sort().reverse().slice(0,250);
  L.push("Transactions récentes (date;type;montant;catégorie;note) :\n"+tx.join("\n"));
  if(S.dettes.some(x=>!x.regle))L.push("Dettes : "+S.dettes.filter(x=>!x.regle).map(x=>`${x.personne} ${x.sens==="du"?"me doit":"je dois"} ${eur2(x.montant)}`).join(", "));
  return L.join("\n");
}
const STYLE_IA="Réponds en français, en tutoyant, de façon simple et concrète, avec des montants précis tirés des données. Pas de titres markdown (#), pas de tableaux. Utilise quelques emojis. Ne donne pas de conseil d'investissement financier.";
let iaBusy=false;
async function askIA(prompt,out,onDone){
  if(!textModel){out.textContent="L'assistant n'est pas disponible.";return}
  if(iaBusy){toast("Patiente, je réfléchis encore…");out.remove&&out.classList.contains("msg")&&out.remove();return}
  iaBusy=true;try{await askIA0(prompt,out,onDone)}finally{iaBusy=false}}
async function askIA0(prompt,out,onDone){
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
      if(r&&!r.erreur&&r.montant_total){if(!cats().includes(r.categorie))r.categorie=cats()[cats().length-1];if(!r.date||!/^\d{4}-\d{2}-\d{2}$/.test(r.date))r.date=today();corrigeAnneeFact(r);
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
  if(/\.csv$|\.txt$/i.test(f.name||"")||/csv|text\/plain|excel/.test(f.type||""))return importCSV(f);
  if(!model){toast("Scan indisponible");return}
  openRaw(`<h3>Lecture du relevé <button class="del" data-close>×</button></h3><div class="est"><span class="spin"></span>Gemini lit tes opérations… (10 à 40 s)</div>`);
  const ctl=scanCtl=new AbortController();
  try{const img=await toJpegB64(f);const res=await model.generateContent([PROMPT_RELEVE(),{inlineData:img}]);if(scanCtl!==ctl||ctl.signal.aborted)return;scanCtl=null;
    const r=parseJSON(res.response.text());
    if(!r||r.erreur||!Array.isArray(r.operations)||!r.operations.length){openRaw(`<h3>Oups <button class="del" data-close>×</button></h3><div class="est">${esc(r&&r.erreur||"Aucune opération trouvée.")}</div>`);return}
    releveRes=r.operations.filter(o=>/^\d{4}-\d{2}-\d{2}$/.test(o.date)&&+o.montant).slice(0,60).map(o=>{o.date=decale(o.date,decalAnnee(o.date));const m=+o.montant,lib=String(o.libelle||"").slice(0,50);
      const near=(a,b,n)=>Math.abs(new Date(a)-new Date(b))<=n*864e5;
      const dup=m<0?S.depenses.some(d=>near(d.date,o.date,3)&&Math.abs(+d.montant-Math.abs(m))<0.01):S.paies.some(p=>near(p.date,o.date,7)&&Math.abs(+p.montant-m)<0.01);
      const ag=S.missions.some(mi=>mi.agence&&lib.toLowerCase().includes(mi.agence.toLowerCase().split(/[ .]/)[0]));
      return{date:o.date,libelle:lib,montant:m,cat:cats().includes(o.categorie)?o.categorie:cats()[cats().length-1],salaire:!!o.salaire||ag,dup}});
    afficherReleve(`${releveRes.length} opération(s)`);
  }catch(e){if(scanCtl!==ctl||ctl.signal.aborted)return;scanCtl=null;console.error(e);openRaw(`<h3>Lecture impossible <button class="del" data-close>×</button></h3><div class="est">${esc(aiErr(e))}</div>`)}
}
$("bReleve").onclick=()=>pickSource("Relevé bancaire : capture, PDF ou fichier CSV",f=>scanReleve(f));

/* ---------- scan de contrat intérimaire ---------- */
const PROMPT_CONTRAT=`Tu lis la photo, capture d'écran ou PDF d'un CONTRAT DE TRAVAIL INTÉRIMAIRE (probablement belge) : contrat journalier/hebdomadaire, prolongation ou avenant.
Réponds UNIQUEMENT avec un objet JSON de cette forme :
{"agence":"agence d'intérim (employeur)","client":"entreprise utilisatrice","fonction":"poste / fonction ou null","lieu":"lieu de travail (ville) ou null",
"date_debut":"YYYY-MM-DD ou null","date_fin":"YYYY-MM-DD ou null","heures_semaine":nombre d'heures par semaine ou null,"horaire":"horaire en quelques mots (ex. 7h-15h30, équipes, nuit) ou null",
"taux_horaire_brut":nombre ou null,"commission_paritaire":"numéro de CP ou null","statut":"ouvrier" | "employé" | null,
"primes":[{"libelle":"prime de nuit, d'équipe, sursalaire, etc.","valeur":"montant ou % tel qu'écrit"}],
"cheque_repas_valeur":valeur faciale d'un chèque-repas ou null,"deplacement":"indemnité de transport / mobilité en quelques mots ou null","motif":"motif de l'intérim (remplacement, surcroît…) ou null",
"resume":"2 phrases simples : de quoi il s'agit et les points importants (dates, salaire, horaire)"}
Règles : nombres avec un point décimal. N'invente rien : null si absent ou illisible. Maximum 8 primes.
Si l'image n'est pas un contrat de travail, réponds {"erreur":"explication courte"}.`;
let contratRes=null;
async function scanContrat(f){lastFile=f;
  if(!model||!canImg){toast("Scan indisponible");return}
  if(f.size>20e6){toast("Fichier trop lourd");return}
  openRaw(`<h3>Lecture du contrat <button class="del" data-close>×</button></h3><div class="est"><span class="spin"></span>Gemini lit ton contrat… (5 à 30 s)</div>`);
  const ctl=scanCtl=new AbortController();
  try{const img=await toJpegB64(f);const res=await model.generateContent([PROMPT_CONTRAT,{inlineData:img}]);
    if(scanCtl!==ctl||ctl.signal.aborted)return;scanCtl=null;
    const r=parseJSON(res.response.text());
    if(!r||typeof r!=="object"||r.erreur){openRaw(`<h3>Oups <button class="del" data-close>×</button></h3><div class="est">${esc(r&&r.erreur||"Je n'ai pas reconnu de contrat de travail.")}</div><button class="btn scanBtn" data-mode="contrat" style="margin-top:12px">Réessayer avec une autre photo</button>`);return}
    ["agence","client","fonction","lieu","horaire","commission_paritaire","statut","deplacement","motif","resume"].forEach(k=>{r[k]=r[k]==null||r[k]===""?null:String(r[k]).slice(0,300)});
    ["date_debut","date_fin"].forEach(k=>{if(!isDate(r[k]))r[k]=null});
    ["heures_semaine","taux_horaire_brut","cheque_repas_valeur"].forEach(k=>{r[k]=r[k]!=null&&r[k]!==""?+r[k]||null:null});
    r.primes=Array.isArray(r.primes)?r.primes.slice(0,8).map(p=>({libelle:String(p.libelle||"").slice(0,60),valeur:String(p.valeur??"").slice(0,30)})).filter(p=>p.libelle):[];
    contratRes=r;showContrat(r);
  }catch(e){if(scanCtl!==ctl||ctl.signal.aborted)return;scanCtl=null;console.error(e);
    openRaw(`<h3>Lecture impossible <button class="del" data-close>×</button></h3><div class="est">${esc(aiErr(e))}</div><details style="margin-top:10px"><summary class="sub">Détail technique</summary><div class="sub" style="word-break:break-word;margin-top:6px">${esc(String(e&&e.message||e).slice(0,400))}</div></details>`)}
}
const PROMPT_281=`Tu lis la photo, capture d'écran ou PDF d'une FICHE FISCALE BELGE 281.10 (« Rémunérations des travailleurs salariés »), envoyée par un employeur, une agence d'intérim ou l'ONVA.
Réponds UNIQUEMENT avec un objet JSON de cette forme :
{"employeur":"nom de l'employeur / agence","annee":année des revenus (nombre, ex. 2025),
"remunerations":montant du code 250 (rémunérations) ou null,
"autres_imposables":somme des AUTRES montants imposables globalement de la fiche (codes 251, 252, 247 : arriérés, préavis, pécule de vacances anticipé…) ou 0,
"precompte":montant du code 286 (précompte professionnel) ou null,
"bonus_emploi":montant du code 284 (bonus à l'emploi : réduction des cotisations personnelles) ou null,
"cotisation_speciale":montant du code 287 (cotisation spéciale de sécurité sociale) ou null,
"frais_deplacement":montant du code 254 (frais de déplacement, exonérés) ou null,
"resume":"1 phrase simple"}
Règles : montants en euros, nombres avec un point décimal, positifs. Utilise les codes ET les libellés. N'invente rien : null si absent ou illisible.
Si le document n'est pas une fiche 281.10, réponds {"erreur":"explication courte"}.`;
let res281=null;
async function scan281(f){lastFile=f;
  if(!model||!canImg){toast("Scan indisponible");return}
  if(f.size>20e6){toast("Fichier trop lourd");return}
  openRaw(`<h3>Lecture de la fiche 281.10 <button class="del" data-close>×</button></h3><div class="est"><span class="spin"></span>Gemini lit ta fiche fiscale… (5 à 30 s)</div>`);
  const ctl=scanCtl=new AbortController();
  try{const img=await toJpegB64(f);const res=await model.generateContent([PROMPT_281,{inlineData:img}]);
    if(scanCtl!==ctl||ctl.signal.aborted)return;scanCtl=null;
    const r=parseJSON(res.response.text());
    if(!r||typeof r!=="object"||r.erreur){openRaw(`<h3>Oups <button class="del" data-close>×</button></h3><div class="est">${esc(r&&r.erreur||"Je n'ai pas reconnu de fiche 281.10.")}</div><button class="btn scanBtn" data-mode="f281" style="margin-top:12px">Réessayer avec une autre photo</button>`);return}
    res281=norm281(r);show281(res281);
  }catch(e){if(scanCtl!==ctl||ctl.signal.aborted)return;scanCtl=null;console.error(e);
    openRaw(`<h3>Lecture impossible <button class="del" data-close>×</button></h3><div class="est">${esc(aiErr(e))}</div>`)}
}
function norm281(r){const n=v=>v==null||v===""?0:Math.max(0,+String(v).replace(",",".")||0);
  const an=Math.round(+r.annee)||new Date().getFullYear()-1;
  return {employeur:String(r.employeur||"").slice(0,80),annee:an>=2000&&an<=2100?an:new Date().getFullYear()-1,remu:n(r.remunerations),autres:n(r.autres_imposables),pp:n(r.precompte),bonus:n(r.bonus_emploi),csss:n(r.cotisation_speciale),depl:n(r.frais_deplacement),resume:String(r.resume||"").slice(0,300)}}
function show281(r){
  const ex=(S.fiches281||[]).find(f=>String(f.annee)===String(r.annee)&&nrm(f.employeur)===nrm(r.employeur));
  const inp=(name,lab,v)=>`<label>${lab}<input name="${name}" type="number" step="0.01" min="0" inputmode="decimal" value="${v||0}"></label>`;
  openRaw(`<h3>Ta fiche 281.10 <button class="del" data-close>×</button></h3>
   ${r.resume?`<div class="est" style="margin-bottom:10px">${esc(r.resume)}</div>`:""}
   ${ex?`<div class="warnbox" style="margin-bottom:10px">🔁 Tu as déjà une fiche ${r.annee} de cet employeur : elle sera remplacée.</div>`:""}
   <p class="sub" style="margin-bottom:10px">Vérifie les montants avec ta fiche avant d'enregistrer.</p>
   <form data-f="f281">
    <div class="two"><label>Employeur / agence<input name="employeur" required value="${esc(r.employeur)}"></label><label>Année des revenus<input name="annee" type="number" min="2000" max="2100" inputmode="numeric" value="${r.annee}"></label></div>
    <div class="two">${inp("remu","Rémunérations (code 250)",r.remu)}${inp("pp","Précompte (code 286)",r.pp)}</div>
    <div class="two">${inp("bonus","Bonus à l'emploi (code 284)",r.bonus)}${inp("autres","Autres imposables (251, 252…)",r.autres)}</div>
    <div class="two">${inp("csss","Cotisation spéciale (287)",r.csss)}${inp("depl","Frais de déplacement (254)",r.depl)}</div>
    <button class="btn">Enregistrer la fiche</button></form>`);
}
function save281(f,d){const n=v=>Math.max(0,+String(v||"").replace(",",".")||0);
  const rec={employeur:String(d.employeur||"").trim().slice(0,80),annee:Math.round(n(d.annee))||new Date().getFullYear()-1,remu:n(d.remu),autres:n(d.autres),pp:n(d.pp),bonus:n(d.bonus),csss:n(d.csss),depl:n(d.depl)};
  if(!Array.isArray(S.fiches281))S.fiches281=[];
  let x=S.fiches281.find(o=>String(o.annee)===String(rec.annee)&&nrm(o.employeur)===nrm(rec.employeur));
  if(x)Object.assign(x,rec);else{x={id:uid(),...rec};S.fiches281.push(x)}
  if(lastFile){const file=lastFile,id=x.id;lastFile=null;savePhoto(file).then(ph=>{const o=S.fiches281.find(o=>o.id===id);if(ph&&o){if(o.photo)delPhoto(o.photo);o.photo=ph;save()}})}
  res281=null;closeSheet();cur=new Date(rec.annee,11,1);save();toast(`Fiche 281.10 ${rec.annee} enregistrée ✓`);
}
function contratHTML(r){
  const L=(k,v)=>v?`<div class="ln"><span>${k}</span><b style="text-align:right">${v}</b></div>`:"";
  return `<div class="grid"><div class="card" style="background:var(--card2)"><div class="k">Mission</div><div class="v" style="font-size:16px">${esc(r.client||"—")}</div><div class="sub">${esc(r.agence||"")}</div></div>
    <div class="card" style="background:var(--card2)"><div class="k">Taux brut</div><div class="v pos" style="font-size:20px">${r.taux_horaire_brut?eurT(r.taux_horaire_brut)+"/h":"—"}</div><div class="sub">${r.heures_semaine?fmtN(r.heures_semaine)+" h / semaine":""}</div></div></div>
    ${r.resume?`<div class="est" style="margin-bottom:10px">${esc(r.resume)}</div>`:""}
    ${L("Période",r.date_debut?`du ${new Date(r.date_debut+"T12:00").toLocaleDateString("fr-BE")}${r.date_fin?" au "+new Date(r.date_fin+"T12:00").toLocaleDateString("fr-BE"):""}`:"")}
    ${L("Fonction",esc(r.fonction))}${L("Lieu",esc(r.lieu))}${L("Horaire",esc(r.horaire))}${L("Statut",esc(r.statut))}${L("Commission paritaire",esc(r.commission_paritaire))}
    ${L("Chèque-repas",r.cheque_repas_valeur?eur2(r.cheque_repas_valeur):"")}${L("Déplacement",esc(r.deplacement))}${L("Motif",esc(r.motif))}
    ${r.primes.length?`<div class="k" style="margin-top:12px">Primes et sursalaires</div>${r.primes.map(p=>L(esc(p.libelle),esc(p.valeur))).join("")}`:""}
    ${r.heures_semaine&&r.taux_horaire_brut?`<div class="okbox" style="margin-top:12px">💶 Estimation : ≈ ${eur(r.heures_semaine*r.taux_horaire_brut*S.reglages.ratio/100)} net par semaine, ≈ ${eur(r.heures_semaine*4.33*r.taux_horaire_brut*S.reglages.ratio/100)} par mois (ratio ${S.reglages.ratio} %).</div>`:""}`;
}
function showContrat(r){
  const lo=s=>(s||"").toLowerCase(),first=s=>lo(s).split(/[ .\-]/)[0];
  const match=S.missions.find(m=>m.agence&&r.agence&&(lo(r.agence).includes(lo(m.agence))||lo(m.agence).includes(first(r.agence)))&&(!r.client||!m.client||lo(r.client).includes(first(m.client))||lo(m.client).includes(first(r.client))));
  openRaw(`<h3>Ton contrat <button class="del" data-close>×</button></h3>${contratHTML(r)}
   <form data-f="contrat" style="margin-top:16px;border-top:1px solid var(--line);padding-top:14px">
    <label>Mission<select name="mission"><option value="__new" ${match?"":"selected"}>➕ Nouvelle mission</option>${S.missions.map(m=>`<option value="${m.id}" ${match&&match.id===m.id?"selected":""}>Mettre à jour : ${esc(m.client||m.agence)}</option>`).join("")}</select></label>
    ${match?`<p class="sub">Même agence et client qu'une mission existante : c'est sûrement une prolongation, je la mets à jour.</p>`:""}
    <div class="two"><label>Agence<input name="agence" required value="${esc(r.agence||match?.agence||"")}"></label><label>Client / poste<input name="client" value="${esc(r.client||match?.client||"")}"></label></div>
    <div class="two"><label>Début<input name="debut" type="date" value="${esc(match&&match.debut&&(!r.date_debut||match.debut<r.date_debut)?match.debut:(r.date_debut||today()))}"></label><label>Fin<input name="fin" type="date" value="${esc(r.date_fin||"")}"></label></div>
    <div class="two"><label>Taux brut (€/h)<input name="taux" type="number" step="0.0001" inputmode="decimal" value="${r.taux_horaire_brut??match?.taux??""}"></label><label>Heures / semaine<input name="hsem" type="number" step="0.5" inputmode="decimal" value="${r.heures_semaine??match?.hsem??""}"></label></div>
    ${r.statut&&!r.statut.startsWith(S.reglages.statut==="employe"?"empl":"ouv")?`<label class="chk"><input type="checkbox" name="statut" checked> Passer mon statut en « ${esc(r.statut)} » (pour le calcul du pécule)</label>`:""}
    <button class="btn">${match?"Mettre à jour la mission":"Créer la mission"}</button></form>`);
}
function saveContrat(f,d){const r=contratRes;if(!r)return;
  let m=d.mission==="__new"?null:S.missions.find(x=>x.id===d.mission);
  if(!m){m={id:uid()};S.missions.push(m)}
  Object.assign(m,{agence:d.agence,client:d.client||"",debut:d.debut||"",fin:d.fin||"",taux:d.taux?+d.taux:(m.taux||0),hsem:d.hsem?+d.hsem:(m.hsem||""),contrat:r});if(!m.adresse&&r.lieu)m.adresse=r.lieu;
  if(f.statut&&f.statut.checked)S.reglages.statut=/empl/i.test(r.statut)?"employe":"ouvrier";
  if(lastFile){const file=lastFile,mid=m.id;lastFile=null;savePhoto(file).then(ph=>{const x=S.missions.find(x=>x.id===mid);if(ph&&x){if(x.photo)delPhoto(x.photo);x.photo=ph;save()}})}
  contratRes=null;closeSheet();save();toast(d.mission==="__new"?"Mission créée depuis le contrat ✓":"Mission mise à jour ✓");
}

/* ---------- trajets (OpenStreetMap : Nominatim + OSRM, uniquement sur demande) ---------- */
// Règles Nominatim : 1 requête/s max, pas d'autocomplétion ni de requêtes en masse, attribution OSM.
const geoCache={};let lastGeo=0;
async function geocode(q){q=q.trim();if(!q)throw new Error("adresse vide");if(geoCache[q])return geoCache[q];
  const wait=1100-(Date.now()-lastGeo);if(wait>0)await new Promise(r=>setTimeout(r,wait));lastGeo=Date.now();
  const r=await fetch("https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&accept-language=fr&countrycodes=be,fr,nl,lu,de&q="+encodeURIComponent(q));
  if(!r.ok)throw new Error("géocodage "+r.status);const j=await r.json();if(!j.length)throw new Error("Adresse introuvable : « "+q+" »");
  return geoCache[q]={lat:+j[0].lat,lon:+j[0].lon,nom:j[0].display_name}}
function vol(a,b){const R=6371,t=x=>x*Math.PI/180,dl=t(b.lat-a.lat),dn=t(b.lon-a.lon),h=Math.sin(dl/2)**2+Math.cos(t(a.lat))*Math.cos(t(b.lat))*Math.sin(dn/2)**2;return 2*R*Math.asin(Math.sqrt(h))}
async function distanceRoute(dep,arr){const A=await geocode(dep),B=await geocode(arr);
  try{const r=await fetch(`https://router.project-osrm.org/route/v1/driving/${A.lon},${A.lat};${B.lon},${B.lat}?overview=false`);const j=await r.json();
    if(j.code==="Ok"&&j.routes&&j.routes[0])return{km:Math.round(j.routes[0].distance/100)/10,min:Math.round(j.routes[0].duration/60),src:"route"}}catch(e){}
  return{km:Math.round(vol(A,B)*1.3*10)/10,min:null,src:"estimé"}}
const coutKm=()=>(+S.reglages.conso||6.5)/100*(+S.reglages.carbu||1.8);
const coutJour=m=>+m.km>0?2*m.km*coutKm():0;
function primeMobilite(m){const p=[...S.paies].filter(p=>p.mission===m.id&&p.detail&&Array.isArray(p.detail.lignes)).sort((a,b)=>b.date.localeCompare(a.date))[0];
  if(!p)return null;const l=p.detail.lignes.filter(l=>/mobilit|déplacement|deplacement|transport|km/i.test(l.libelle)&&l.type!=="retenue");if(!l.length)return null;
  const jours=(p.detail.jours&&p.detail.jours.length)||Math.max(1,Math.round((+p.heures||38)/7.6));
  const vus=new Set();const tot=sum(l.filter(x=>{const k=Math.round(x.montant*100);if(vus.has(k))return false;vus.add(k);return true}),x=>x.montant); // évite les doublons imposable/net
  return{parJour:tot/jours,total:tot,jours}}
function renderTrajets(){
  const t=today(),act=S.missions.filter(m=>(!m.fin||m.fin>=t));
  if(!act.length){$("trajetCard").innerHTML=`<div class="empty">Ajoute une mission pour calculer le coût de tes trajets.</div>`;return}
  $("trajetCard").innerHTML=act.map(m=>{
    if(!(+m.km>0))return `<div class="sub-row"><div class="l"><b>${esc(m.client||m.agence)}</b><small>Trajet pas encore calculé</small></div><button class="btn sec sm" data-edit2="mission:${m.id}">📍 Calculer</button></div>`;
    const cj=coutJour(m),js=m.hsem?Math.max(1,Math.round(+m.hsem/7.6)):5,netH=m.taux?m.taux*S.reglages.ratio/100:0,hj=m.hsem?+m.hsem/js:7.6;
    const pm=primeMobilite(m);
    return `<div style="padding:8px 0;border-bottom:1px solid var(--line)"><div style="display:flex;justify-content:space-between;gap:8px"><b>${esc(m.client||m.agence)}</b><span class="sub">${fmtN(m.km)} km${m.min?" · "+m.min+" min":""} (aller)</span></div>
      <div class="grid" style="margin-top:8px"><div><div class="sub">Coût par jour (A/R)</div><div class="v out" style="font-size:19px">${eur2(cj)}</div></div><div><div class="sub">Par mois (≈ ${Math.round(js*4.33)} j)</div><div class="v out" style="font-size:19px">${eur(cj*js*4.33)}</div></div></div>
      ${netH?`<div class="sub" style="margin-top:6px">Net réel après trajet : ≈ <b style="color:var(--txt)">${eur2(netH-cj/hj)}/h</b> au lieu de ${eur2(netH)}/h · le trajet mange ${Math.round(cj/(netH*hj)*100)} % de ta journée.</div>`:""}
      ${pm?`<div class="${pm.parJour>=cj?"okbox":"warnbox"}" style="margin:8px 0 0">Prime de mobilité ≈ ${eur2(pm.parJour)}/jour (dernière fiche) : elle couvre ${Math.round(pm.parJour/cj*100)} % de ton carburant.</div>`:""}
    </div>`}).join("")+`<p class="osm">Distances © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">contributeurs OpenStreetMap</a> · calcul ${eur2(coutKm())}/km (${fmtN(S.reglages.conso)} L/100 km × ${eur2(S.reglages.carbu)}/L, modifiable dans Réglages)</p>`;
}
async function calcTrajet(){const dep=$("fDep").value.trim(),arr=$("fArr").value.trim(),out=$("trajRes");
  if(!dep||!arr){out.textContent="Indique les deux adresses.";return}
  $("bCalc").disabled=true;out.innerHTML=`<span class="spin"></span>Calcul de l'itinéraire…`;
  try{const r=await distanceRoute(dep,arr);$("fKm").value=r.km;$("fMin").value=r.min||"";
    out.innerHTML=`🚗 <b>${fmtN(r.km)} km</b>${r.min?" · "+r.min+" min":""} aller${r.src==="estimé"?" (estimation à vol d'oiseau, service d'itinéraire indisponible)":""} → ≈ <b>${eur2(2*r.km*coutKm())}</b> de carburant par jour (aller-retour)`}
  catch(e){out.textContent=/introuvable/.test(e.message)?e.message+" : précise la ville ou le code postal.":"Calcul impossible (connexion ?). Tu peux taper les km toi-même."}
  $("bCalc").disabled=false}

/* ---------- démarches administratives (Belgique) ---------- */
function demarches(y){const L=[
  {k:"bak"+y,date:y+"-01-10",t:"💾 Archive ton année "+(y-1),b:"Télécharge le CSV et le bilan PDF de "+(y-1)+" (onglet Stats) pour tes archives."},
  {k:"281-"+y,date:y+"-03-05",t:"📄 Fiches fiscales 281.10",b:"Chaque agence doit t'envoyer ta fiche 281.10 de "+(y-1)+". Vérifie que tu en as bien une par agence : elles servent pour ta déclaration. Scanne-les dans l'appli (Stats → Bilan fiscal) pour un calcul d'impôt exact."},
  {k:"tax-"+y,date:y+"-05-15",t:"🧾 Déclaration d'impôts",b:"La déclaration (MyMinfin / Tax-on-web) est en général ouverte. Compare les montants préremplis avec tes 281.10 et note la date limite affichée sur MyMinfin."},
  {k:"tax2-"+y,date:y+"-07-01",t:"⏰ Déclaration envoyée ?",b:"Si ce n'est pas encore fait, vérifie la date limite sur MyMinfin et envoie ta déclaration."},
  {k:"fds-"+y,date:y+"-12-05",t:"🎁 Document de prime de fin d'année",b:"Le Fonds social des intérimaires envoie le document début décembre. Pas reçu vers le 15 décembre ? Demande un duplicata."}];
  if(S.reglages.statut!=="employe")L.splice(3,0,{k:"onva-"+y,date:y+"-04-15",t:"🏖️ Pécule de vacances (ONVA)",b:"L'ONVA paie le pécule en mai ou juin. Vérifie ton compte de vacances et ton numéro de compte bancaire."});
  return L}
function demarchesProches(){const y=new Date().getFullYear(),t=today();return [...demarches(y),...demarches(y+1)].map(x=>({...x,done:!!S.adminDone[x.k]})).filter(x=>{const e=new Date(x.date+"T12:00");e.setDate(e.getDate()+45);return iso(e)>=t}).slice(0,5)}
function renderDemarches(){const L=demarchesProches(),t=today();
  $("adminCard").innerHTML=L.map(x=>`<label class="adm ${x.done?"done":""}"><input type="checkbox" data-admin="${x.k}" ${x.done?"checked":""}><div style="flex:1"><b>${x.t}</b><div class="sub">${x.b}</div></div><span class="d">${x.date<=t?"maintenant":fmtD(x.date)}</span></label>`).join("")+`<p class="sub" style="margin-top:8px">Coche une démarche quand elle est faite. Les dates sont indicatives : vérifie toujours sur les sites officiels.</p>`}

/* ---------- abonnements détectés ---------- */
const SUB_STOP=new Set("com be fr nl eu www sa nv bv srl sprl ab ltd inc gmbh payment paiement payments sepa domiciliation dom carte achat bancontact visa maestro the le la les de du des et".split(" "));
const subKey=s=>{const w=String(s||"").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[0-9#*/._\-:,'()]+/g," ").split(/\s+/).filter(x=>x&&!SUB_STOP.has(x));
  if(!w.length)return "";return w[0].length>=5?w[0]:w.slice(0,2).join(" ")};
const lie=x=>x.fixe&&S.fixes.some(f=>f.id===x.fixe);
function autoLink(d){if(d.fixe||!d.note)return;const k=subKey(d.note);if(k.length<3)return;const f=S.fixes.find(f=>subKey(f.nom)===k);if(f)d.fixe=f.id}
function detectSubs(){
  const lim=iso(new Date(new Date().getFullYear(),new Date().getMonth()-6,1)),G={};
  S.depenses.filter(d=>d.date>=lim&&d.note&&!lie(d)).forEach(d=>{const k=subKey(d.note);if(k.length<3)return;(G[k]=G[k]||[]).push(d)});
  const fixK=new Set(S.fixes.map(f=>subKey(f.nom)));
  return Object.entries(G).filter(([k,L])=>{if(fixK.has(k)||S.subsIgnore.includes(k))return false;
    const mois=new Set(L.map(d=>d.date.slice(0,7)));if(mois.size<2||mois.size!==L.length)return false; // une fois par mois, au moins 2 mois
    const v=L.map(d=>+d.montant).sort((a,b)=>a-b),med=v[Math.floor(v.length/2)];return v.every(x=>Math.abs(x-med)<=Math.max(1,med*0.15))})
   .map(([k,L])=>{const v=L.map(d=>+d.montant).sort((a,b)=>a-b),last=[...L].sort((a,b)=>b.date.localeCompare(a.date))[0];return{k,nom:last.note,montant:v[Math.floor(v.length/2)],n:L.length,jour:+last.date.slice(8,10),cat:last.cat}})}
function renderSubs(){const L=detectSubs();
  $("subsBox").innerHTML=L.length?`<h2>🔁 Abonnements détectés</h2><div class="card"><p class="sub" style="margin-bottom:4px">Ces dépenses reviennent chaque mois au même prix. En faire des charges fixes rend ton budget plus juste.</p>
    ${L.map(s=>`<div class="sub-row"><div class="l"><b>${esc(s.nom)}</b><small>${eur2(s.montant)}/mois · vu ${s.n} mois · vers le ${s.jour}</small></div><button class="btn sm" data-subadd="${esc(s.k)}" style="width:auto">+ Fixe</button><button class="del" data-subign="${esc(s.k)}" title="Ignorer">×</button></div>`).join("")}</div>`:"";}
function addSub(k){const s=detectSubs().find(x=>x.k===k);if(!s)return;const id=uid();
  S.fixes.push({id,nom:s.nom,montant:Math.round(s.montant*100)/100,jour:s.jour||""});
  S.depenses.forEach(d=>{if(!lie(d)&&subKey(d.note)===k)d.fixe=id});save();toast("« "+s.nom+" » ajouté aux charges fixes ✓")}

/* ---------- score de santé financière ---------- */
function calcScore(M,k){const R=S.reglages,fx=fixesTotal(),t=today(),parts=[];
  const ep=sum(S.epargneLog.filter(x=>(x.date||"").startsWith(k)&&x.montant>0),x=>x.montant),obj=M.recu*(R.pct||10)/100;
  parts.push({n:"Épargne du mois",max:25,v:M.recu>0?Math.min(1,obj?ep/obj:1)*25:12,tip:obj>ep?`Mets ${eur(obj-ep)} de côté pour atteindre tes ${R.pct} %.`:""});
  const cib=fx*(R.mois||3);parts.push({n:"Coussin de sécurité",max:25,v:fx?Math.min(1,R.epargne/cib)*25:(R.epargne>0?18:8),tip:fx&&R.epargne<cib?`Ton coussin couvre ${(R.epargne/fx).toLocaleString("fr-BE",{maximumFractionDigits:1})} mois sur ${R.mois} visés.`:""});
  const reste=M.recu+M.att-M.dep;parts.push({n:"Reste à vivre",max:20,v:reste>=0?20:Math.max(0,20+reste/Math.max(300,fx)*20),tip:reste<0?`Tu dépenses ${eur(-reste)} de plus que tes revenus ce mois-ci.`:""});
  const bl=Object.entries(S.budgets).filter(([,v])=>+v>0),ok=bl.filter(([c,v])=>sum(M.d.filter(x=>x.cat===c),x=>x.montant)<=v).length,over=bl.filter(([c,v])=>sum(M.d.filter(x=>x.cat===c),x=>x.montant)>v);
  parts.push({n:"Budgets",max:15,v:bl.length?ok/bl.length*15:9,tip:over.length?`Budget dépassé : ${over.map(x=>x[0]).join(", ")}.`:bl.length?"":"Fixe des budgets par catégorie pour mieux te suivre."});
  const late=S.depenses.filter(x=>x.paye===false&&x.echeance&&x.echeance<t).length+S.paies.filter(p=>!p.recu&&!p.archive&&p.date<t).length;
  parts.push({n:"Retards",max:15,v:Math.max(0,15-late*5),tip:late?`${late} facture(s) ou paie(s) en retard à régler.`:""});
  const score=Math.round(sum(parts,p=>p.v));return{score,parts}}
function renderScore(M,k){const {score,parts}=calcScore(M,k);
  const lbl=score>=80?"Excellent 💪":score>=60?"Correct 👍":score>=40?"Fragile ⚠️":"À surveiller 🚨",col=score>=80?"var(--pos)":score>=60?"#f4f4f5":score>=40?"var(--warn)":"var(--bad)";
  const r=30,C=2*Math.PI*r,len=score/100*C;
  $("scoreRing").innerHTML=`<svg width="78" height="78" viewBox="0 0 78 78"><circle cx="39" cy="39" r="${r}" fill="none" stroke="#24242a" stroke-width="8"/><circle cx="39" cy="39" r="${r}" fill="none" stroke="${col}" stroke-width="8" stroke-linecap="round" stroke-dasharray="${len} ${C}" transform="rotate(-90 39 39)"/><text x="39" y="45" text-anchor="middle" fill="#f4f4f5" font-size="20" font-weight="800">${score}</text></svg>`;
  $("scoreLbl").textContent=lbl;
  const tips=[...parts].sort((a,b)=>a.v/a.max-b.v/b.max).filter(p=>p.tip&&p.v<p.max*0.9).slice(0,2).map(p=>"• "+p.tip);
  $("scoreTips").innerHTML=tips.length?tips.map(esc).join("<br>"):"Tout est au vert ce mois-ci, continue comme ça !";}

/* ---------- bilan PDF du mois ---------- */
// chargement d'un script externe ; en cas d'échec (hors ligne) on retire la balise pour pouvoir réessayer plus tard
function loadScript(src){return new Promise((ok,ko)=>{const old=document.querySelector(`script[src="${src}"]`);if(old&&old.dataset.ok){ok();return}if(old)old.remove();
  const s=document.createElement("script");s.src=src;s.onload=()=>{s.dataset.ok="1";ok()};s.onerror=()=>{s.remove();ko(new Error("chargement "+src))};document.head.appendChild(s)})}
const pdfTxt=s=>String(s??"").replace(/[  ]/g," ").replace(/[^\x00-\xff€’–—…]/g,"").trim();
async function bilanPDF(){
  const btn=$("bPdf");btn.disabled=true;btn.textContent="⏳ Création du PDF…";
  try{
    await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js");
    await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js");
    const {jsPDF}=window.jspdf,docp=new jsPDF({unit:"mm",format:"a4"}),k=mkey(cur),M=monthData(k),R=S.reglages,E=x=>pdfTxt(eur2(x));
    const mois=cur.toLocaleDateString("fr-BE",{month:"long",year:"numeric"}),red=[239,35,60],W=210;
    docp.setFillColor(...red);docp.rect(0,0,W,30,"F");docp.setTextColor(255);docp.setFont("helvetica","bold");docp.setFontSize(20);docp.text("Budget Intérim",14,14);
    docp.setFontSize(12);docp.setFont("helvetica","normal");docp.text(pdfTxt("Bilan de "+mois),14,22);docp.text(pdfTxt(($("who").textContent||"").replace("Connecté : ","")),W-14,22,{align:"right"});
    const {score}=calcScore(M,k),ep=sum(S.epargneLog.filter(x=>(x.date||"").startsWith(k)),x=>x.montant),reste=M.recu-M.depPaye,prevu=reste+M.att-M.aPayer;
    const tbl=(y,head,body,opt={})=>{docp.autoTable({startY:y,head:[head],body,theme:"grid",styles:{fontSize:9,cellPadding:2,textColor:30},headStyles:{fillColor:[24,24,28],textColor:255},alternateRowStyles:{fillColor:[247,247,248]},margin:{left:14,right:14},...opt});return docp.lastAutoTable.finalY+8};
    const h2=(y,t)=>{docp.setTextColor(...red);docp.setFont("helvetica","bold");docp.setFontSize(12);docp.text(pdfTxt(t),14,y);return y+3};
    let y=40;
    y=tbl(h2(y,"Résumé"),["Indicateur","Montant"],[["Paies reçues",E(M.recu)],["À recevoir",E(M.att)],["Charges fixes",E(M.fix)],["Dépenses variables",E(M.var_)],["Dont factures à payer",E(M.aPayer)],["Reste à vivre (reçu − payé)",E(reste)],["Une fois tout reçu et payé",E(prevu)],["Épargne du mois",E(ep)],["Coussin de sécurité",E(R.epargne)],["Score de santé",score+" / 100"]],{columnStyles:{1:{halign:"right",fontStyle:"bold"}}});
    const c={};M.d.forEach(x=>c[x.cat]=(c[x.cat]||0)+(+x.montant||0));const ce=Object.entries(c).sort((a,b)=>b[1]-a[1]);
    if(ce.length)y=tbl(h2(y,"Dépenses par catégorie"),["Catégorie","Montant","Part"],ce.map(([n,v])=>[pdfTxt(n),E(v),Math.round(v/M.var_*100)+" %"]),{columnStyles:{1:{halign:"right"},2:{halign:"right"}}});
    if(M.p.length)y=tbl(h2(y,"Paies"),["Date","Mission","Heures","Net","Statut"],[...M.p].sort((a,b)=>a.date.localeCompare(b.date)).map(p=>{const m=S.missions.find(x=>x.id===p.mission);return[new Date(p.date+"T12:00").toLocaleDateString("fr-BE"),pdfTxt(m?(m.client||m.agence):(p.note||"")),p.heures?fmtN(p.heures):"",E(p.montant),p.recu?"reçue":"à recevoir"]}),{columnStyles:{3:{halign:"right"}}});
    if(S.fixes.length)y=tbl(h2(y,"Charges fixes"),["Charge","Jour","Montant"],S.fixes.map(f=>[pdfTxt(f.nom),f.jour||"",E(f.montant)]),{columnStyles:{2:{halign:"right"}}});
    if(M.all.length)y=tbl(h2(y,"Dépenses du mois"),["Date","Description","Catégorie","Montant"],[...M.all].sort((a,b)=>a.date.localeCompare(b.date)).map(d=>[new Date(d.date+"T12:00").toLocaleDateString("fr-BE"),pdfTxt(d.note||"")+(d.paye===false?" (à payer)":"")+(lie(d)?" (fixe)":""),pdfTxt(d.cat),E(d.montant)]),{columnStyles:{3:{halign:"right"}}});
    const n=docp.getNumberOfPages();for(let i=1;i<=n;i++){docp.setPage(i);docp.setFontSize(8);docp.setTextColor(150);docp.text(pdfTxt(`Généré le ${new Date().toLocaleDateString("fr-BE")} avec Budget Intérim`),14,290);docp.text(`${i} / ${n}`,W-14,290,{align:"right"})}
    docp.save(`bilan-${k}.pdf`);LS.set("lastBackup",Date.now());toast("PDF téléchargé ✓");
  }catch(e){console.error(e);toast(navigator.onLine?"Création du PDF impossible":"Il faut une connexion pour créer le PDF")}
  btn.disabled=false;btn.textContent="📄 Bilan PDF du mois"}
$("bPdf").onclick=bilanPDF;

/* ---------- partager vers l'appli (photo / PDF depuis la galerie, un mail…) ---------- */
let sharedFile=null;
async function lireFichierPartage(){try{const c=await caches.open("share");const r=await c.match("shared");if(!r)return null;
  const blob=await r.blob();const name=decodeURIComponent(r.headers.get("x-name")||"document");await c.delete("shared");return new File([blob],name,{type:blob.type||r.headers.get("content-type")||"image/jpeg"})}catch(e){return null}}
async function gererPartage(){const f=await lireFichierPartage();if(!f){toast("Aucun fichier reçu");return}sharedFile=f;
  openRaw(`<h3>Document reçu <button class="del" data-close>×</button></h3><p class="sub" style="margin-bottom:10px">${esc(f.name)} · ${Math.round(f.size/1024)} Ko. C'est quoi ?</p>
   <div style="display:grid;gap:10px"><button class="btn" data-share="auto">🤖 Laisse l'IA deviner</button><button class="btn sec" data-share="paie">💶 Fiche de paie</button><button class="btn sec" data-share="fiche281">📄 Fiche fiscale 281.10</button><button class="btn sec" data-share="facture">🧾 Facture / ticket</button><button class="btn sec" data-share="contrat">📑 Contrat</button><button class="btn sec" data-share="releve">🏦 Relevé bancaire</button></div>`)}
async function routerPartage(type){const f=sharedFile;if(!f)return;
  if(/\.csv$/i.test(f.name||"")||/csv/.test(f.type||""))type="releve";
  if(type==="auto"){if(!model){toast("IA indisponible");return}openRaw(`<h3>Analyse… <button class="del" data-close>×</button></h3><div class="est"><span class="spin"></span>Je regarde de quel document il s'agit…</div>`);
    try{const img=await toJpegB64(f);const res=await model.generateContent([`Quel est ce document ? Réponds UNIQUEMENT avec un JSON {"type":"paie"|"fiche281"|"facture"|"contrat"|"releve"|"autre"} : "paie" = fiche de paie / décompte de salaire, "fiche281" = fiche fiscale belge 281.10 (récapitulatif annuel des rémunérations), "facture" = facture ou ticket de caisse, "contrat" = contrat de travail intérimaire, "releve" = relevé ou capture d'opérations bancaires.`,{inlineData:img}]);
      type=(parseJSON(res.response.text())||{}).type}catch(e){openRaw(`<h3>Analyse impossible <button class="del" data-close>×</button></h3><div class="est">${esc(aiErr(e))}</div>`);return}
    if(!["paie","fiche281","facture","contrat","releve"].includes(type)){gererPartageRetry();return}}
  ({paie:scanFile,fiche281:scan281,facture:scanFacture,contrat:scanContrat,releve:scanReleve})[type](f)}
function gererPartageRetry(){openRaw(`<h3>Je n'ai pas reconnu ce document <button class="del" data-close>×</button></h3><div style="display:grid;gap:10px"><button class="btn sec" data-share="paie">💶 Fiche de paie</button><button class="btn sec" data-share="fiche281">📄 Fiche fiscale 281.10</button><button class="btn sec" data-share="facture">🧾 Facture / ticket</button><button class="btn sec" data-share="contrat">📑 Contrat</button><button class="btn sec" data-share="releve">🏦 Relevé bancaire</button></div>`)}

/* ---------- déverrouillage par empreinte (WebAuthn, sur cet appareil) ---------- */
const b64u={enc:b=>btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,""),dec:s=>Uint8Array.from(atob(s.replace(/-/g,"+").replace(/_/g,"/")+"===".slice((s.length+3)%4)),c=>c.charCodeAt(0))};
async function bioDispo(){try{return !!(window.PublicKeyCredential&&await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable())}catch(e){return false}}
async function bioActiver(){try{const cred=await navigator.credentials.create({publicKey:{challenge:crypto.getRandomValues(new Uint8Array(32)),rp:{name:"Budget Intérim"},user:{id:crypto.getRandomValues(new Uint8Array(16)),name:"budget-interim",displayName:"Budget Intérim"},
    pubKeyCredParams:[{type:"public-key",alg:-7},{type:"public-key",alg:-257}],authenticatorSelection:{authenticatorAttachment:"platform",userVerification:"required",residentKey:"discouraged"},timeout:60000}});
  LS.set("bioId",b64u.enc(cred.rawId));toast("Empreinte activée 👆");renderBio()}catch(e){console.warn(e);toast("Empreinte non activée")}}
async function bioDeverrouiller(){const id=LS.get("bioId",null);if(!id)return false;
  try{await navigator.credentials.get({publicKey:{challenge:crypto.getRandomValues(new Uint8Array(32)),allowCredentials:[{type:"public-key",id:b64u.dec(id),transports:["internal"]}],userVerification:"required",timeout:60000}});
    $("lock").hidden=true;return true}catch(e){console.warn(e);return false}}
async function renderBio(){const ok=await bioDispo(),pin=!!LS.get("pinHash",null),on=!!LS.get("bioId",null);
  $("bBio").hidden=!ok||!pin;$("bioState").hidden=!ok||!pin;$("bBio").textContent=on?"👆 Désactiver l'empreinte":"👆 Déverrouiller avec l'empreinte";
  $("bioState").textContent=on?"Activée : à l'ouverture, ton empreinte suffit (le code PIN reste en secours).":"Utilise ton empreinte au lieu du code PIN.";
  $("bBioUnlock").hidden=!on}
$("bBio").onclick=()=>{if(LS.get("bioId",null)){LS.set("bioId",null);renderBio();toast("Empreinte désactivée")}else bioActiver()};
$("bBioUnlock").onclick=()=>bioDeverrouiller();
renderBio();

/* ---------- import d'anciennes fiches de paie (historique) ---------- */
let histoRes=[];
async function scanHisto(files){
  if(!model){toast("Scan indisponible");return}
  histoRes=[];openRaw(`<h3>Lecture de ${files.length} fiche(s) <button class="del" data-close>×</button></h3><div class="est" id="histoProg"><span class="spin"></span>0 / ${files.length}</div><p class="sub" style="margin-top:8px">Garde l'appli ouverte pendant la lecture.</p>`);
  const ctl=scanCtl=new AbortController();
  for(let i=0;i<files.length;i++){if(ctl.signal.aborted)return;
    try{const img=await toJpegB64(files[i]);const res=await model.generateContent([PROMPT,{inlineData:img}]);const r=parseJSON(res.response.text());
      if(r&&!r.erreur&&(+r.net||+r.brut)){["brut","net","heures","taux_horaire_brut"].forEach(k=>{r[k]=r[k]!=null&&r[k]!==""?+r[k]||null:null});
        ["periode_debut","periode_fin","date_paiement"].forEach(k=>{if(!isDate(r[k]))r[k]=null});
        if(Array.isArray(r.jours))heuresPayees(r);
        r.lignes=Array.isArray(r.lignes)?r.lignes.slice(0,25).map(l=>({libelle:String(l.libelle||"").slice(0,80),montant:Math.abs(+l.montant||0),type:["gain","retenue","info"].includes(l.type)?l.type:"info"})):[];
        r.jours=Array.isArray(r.jours)?r.jours.filter(j=>isDate(j.date)&&+j.heures>0).slice(0,31):[];delete r.resume;
        const date=r.date_paiement||r.periode_fin||r.periode_debut;
        const ex=S.paies.find(p=>date&&memePaie(p,date,r.net));
        const dup=(ex&&ex.detail)||histoRes.some(x=>procheJ(x.date,date||today())&&Math.abs((+x.r.net||0)-(+r.net||0))<0.01);
        const remplace=ex&&!ex.detail?ex.id:null; // virement bancaire déjà importé → la fiche le remplace
        histoRes.push({r,file:files[i],date:date||today(),dup,remplace,sansDate:!date})}
    }catch(e){console.error(e);if(i===0){openRaw(`<h3>Lecture impossible <button class="del" data-close>×</button></h3><div class="est">${esc(aiErr(e))}</div>`);return}}
    if($("histoProg"))$("histoProg").innerHTML=`<span class="spin"></span>${i+1} / ${files.length}`}
  if(scanCtl===ctl)scanCtl=null;
  if(!histoRes.length){openRaw(`<h3>Oups <button class="del" data-close>×</button></h3><div class="est">Aucune fiche de paie reconnue.</div>`);return}
  histoRes.sort((a,b)=>a.date.localeCompare(b.date));
  const tot=sum(histoRes.filter(x=>!x.dup),x=>x.r.net),h=sum(histoRes.filter(x=>!x.dup),x=>x.r.heures);
  openRaw(`<h3>${histoRes.length} ancienne(s) fiche(s) <button class="del" data-close>×</button></h3>
    <div class="okbox">📚 Elles seront ajoutées à ton <b>historique</b> : elles comptent pour ta prime de fin d'année, ton pécule et tes stats, mais <b>pas</b> comme argent disponible.</div>
    <form data-f="histo">${histoRes.map((x,i)=>`<div class="chk-row"><input type="checkbox" name="h${i}" ${x.dup?"":"checked"}><div class="l"><b>${esc(x.r.agence||"?")}${x.r.client?" · "+esc(x.r.client):""}</b><small>${x.sansDate?"⚠ date illisible · ":""}${new Date(x.date+"T12:00").toLocaleDateString("fr-BE")}${x.r.heures?" · "+fmtN(x.r.heures)+" h":""}${x.r.brut?" · "+eur(x.r.brut)+" brut":""}${x.dup?" · déjà présente":x.remplace?" · remplace le virement bancaire":""}</small></div><b>${x.r.net?eur2(x.r.net):"—"}</b></div>`).join("")}
    <p class="sub" style="margin:8px 0">Total : ${eur2(tot)} net · ${fmtN(h)} h. Les missions sont créées automatiquement par agence et client.</p>
    <label class="chk"><input type="checkbox" name="photos" checked> Garder les photos des fiches</label>
    <button class="btn">Ajouter à l'historique</button></form>`);
}
function saveHisto(f){let n=0;const lo=s=>(s||"").toLowerCase(),first=s=>lo(s).split(/[ .\-]/)[0];
  histoRes.forEach((x,i)=>{if(!f["h"+i]||!f["h"+i].checked)return;const r=x.r;
    let m=S.missions.find(m=>m.agence&&r.agence&&(lo(r.agence).includes(lo(m.agence))||lo(m.agence).includes(first(r.agence)))&&(!r.client||!m.client||lo(r.client).includes(first(m.client))||lo(m.client).includes(first(r.client))));
    if(!m&&r.agence){m={id:uid(),agence:r.agence,client:r.client||"",debut:r.periode_debut||x.date,fin:r.periode_fin||x.date,taux:r.taux_horaire_brut||0};S.missions.push(m)}
    else if(m){if(r.periode_debut&&(!m.debut||r.periode_debut<m.debut))m.debut=r.periode_debut;if(!m.taux&&r.taux_horaire_brut)m.taux=r.taux_horaire_brut}
    if(x.remplace)S.paies=S.paies.filter(p=>p.id!==x.remplace);
    const id=uid();S.paies.push({id,mission:m?m.id:"",date:x.date,montant:+r.net||0,recu:true,archive:true,heures:r.heures||"",note:r.periode_debut?`du ${fmtD(r.periode_debut)} au ${fmtD(r.periode_fin)}`:"",detail:r});n++;
    if(f.photos&&f.photos.checked)savePhoto(x.file).then(ph=>{const p=S.paies.find(p=>p.id===id);if(ph&&p){p.photo=ph;save()}})});
  histoRes=[];closeSheet();save();toast(`${n} fiche(s) ajoutée(s) à l'historique 📚`)}
$("bHisto").onclick=()=>pickSource("Anciennes fiches de paie (plusieurs possibles)",fs=>scanHisto(Array.isArray(fs)?fs:[fs]),true);

/* ---------- import CSV bancaire (CBC/KBC, Belfius, ING, BNP…) : lu sur le téléphone, rien n'est envoyé ---------- */
function parseCSV(txt){txt=txt.replace(/^﻿/,"");const first=txt.split(/\r?\n/).find(l=>l.trim())||"";
  const delim=[";",",","\t"].map(d=>[d,first.split(d).length]).sort((a,b)=>b[1]-a[1])[0][0];
  const rows=[];let row=[],cell="",q=false;
  for(let i=0;i<txt.length;i++){const c=txt[i];
    if(q){if(c==='"'){if(txt[i+1]==='"'){cell+='"';i++}else q=false}else cell+=c}
    else if(c==='"')q=true;else if(c===delim){row.push(cell);cell=""}
    else if(c==="\n"||c==="\r"){if(c==="\r"&&txt[i+1]==="\n")i++;row.push(cell);if(row.some(x=>x.trim()))rows.push(row);row=[];cell=""}
    else cell+=c}
  row.push(cell);if(row.some(x=>x.trim()))rows.push(row);return rows}
function parseMontant(s){s=String(s||"").replace(/[€\s ]/g,"");if(!s)return NaN;
  if(/,\d{1,2}$/.test(s))s=s.replace(/\./g,"").replace(",",".");else s=s.replace(/,/g,"");return parseFloat(s)}
function parseDateFR(s){s=String(s||"").trim();let m;
  if((m=s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/))){const y=m[3].length===2?"20"+m[3]:m[3];return `${y}-${m[2].padStart(2,"0")}-${m[1].padStart(2,"0")}`}
  if((m=s.match(/^(\d{4})-(\d{2})-(\d{2})/)))return `${m[1]}-${m[2]}-${m[3]}`;
  if((m=s.match(/^(\d{4})(\d{2})(\d{2})$/)))return `${m[1]}-${m[2]}-${m[3]}`;return null}
function lireCSVBanque(txt){const rows=parseCSV(txt);
  const hi=rows.findIndex(r=>r.some(c=>/date|datum/.test(nrm(c)))&&r.some(c=>/montant|bedrag|amount|debit|credit/.test(nrm(c))));
  if(hi<0)throw new Error("Colonnes non reconnues (il faut au moins une date et un montant).");
  const H=rows[hi].map(nrm),col=(...re)=>{for(const r of re){const i=H.findIndex(h=>r.test(h));if(i>=0)return i}return -1};
  const cD=col(/^date$/,/date (d.)?execution|date comptable|boekingsdatum|uitvoeringsdatum/,/^datum/,/date/),cM=col(/^montant$/,/^bedrag$/,/^amount$/,/montant|bedrag/),cDeb=col(/debit/),cCre=col(/credit/);
  const cH=H.findIndex(h=>/^nom$|^naam$|titulaire|^name$/.test(h)),cCpte=col(/^numero de compte$|^compte$|^rekeningnummer$|^account$/),cCp=col(/compte contrepartie|rekening tegenpartij|numero de compte contrepartie|iban contrepartie/);
  const cN=col(/nom (de la )?contrepartie|naam (van de )?tegenpartij|beneficiaire|counterparty/),cL=col(/^description$/,/omschrijving|libelle|description/),cC=col(/communication libre/,/vrije mededeling/,/^communication$/,/^mededeling$/,/communication/,/mededeling/);
  const out=[];
  for(const r of rows.slice(hi+1)){const date=parseDateFR(r[cD]);let m=cM>=0?parseMontant(r[cM]):NaN;
    if(isNaN(m)&&(cDeb>=0||cCre>=0)){const d=parseMontant(r[cDeb]),c=parseMontant(r[cCre]);m=(isNaN(c)?0:Math.abs(c))-(isNaN(d)?0:Math.abs(d))}
    if(!date||isNaN(m)||!m)continue;
    const lib=libelleBanque(r[cL]||r[cC]||"Opération",r[cN]);
    const tit=nrm(r[cH]),cp=nrm(r[cN]),cpte=String(r[cCpte]||"").replace(/\s/g,""),cpCpte=String(r[cCp]||"").replace(/\s/g,""),txt=nrm([r[cN],r[cL],r[cC]].join(" "));
    const tok=s=>s.split(/[^a-z]+/).filter(w=>w.length>=3),tT=tok(tit),tC=new Set(tok(cp));
    const interne=(tT.length>0&&tT.every(w=>tC.has(w)))||(cpte&&cpCpte&&cpte===cpCpte)||/epargne|spaarrekening|compte d.epargne|livret|vers (mon|votre) compte|virement interne|eigen rekening/.test(txt);
    out.push({date,montant:Math.round(m*100)/100,libelle:lib.replace(/\s+/g," ").slice(0,50),texte:[r[cN],r[cL],r[cC]].join(" "),interne})}
  if(!out.length)throw new Error("Aucune opération trouvée dans ce fichier.");return out}
// libellé lisible à partir des descriptions bancaires (CBC/KBC…)
function libelleBanque(desc,nomCp){const d=String(desc||"").replace(/\s+/g," ").trim(),titre=s=>s.toLowerCase().replace(/(^|[\s'’\-])\S/g,c=>c.toUpperCase());let m;
  if(nomCp&&String(nomCp).trim())return titre(String(nomCp).replace(/^(m\.?|mme|mlle|mr|mevr|dhr)\s+/i,"").trim());
  if((m=d.match(/CREANCIER\s*:\s*(.+?)\s+REF/i)))return titre(m[1]);
  if(/^RETRAIT D.ESPECES/i.test(d)){m=d.match(/HEURES\s+(?:\d+_)?(\S+)/i);return "Retrait d'espèces"+(m?" · "+titre(m[1]):"")}
  if((m=d.match(/HEURES\s+(.+?)\s+(?:AVEC|NUMERO DE CARTE|PAIEMENT SANS|TITULAIRE|PAR WERO)/i)))return titre(m[1].replace(/^\d+_/,"").replace(/\s+(BE|FR|NL|LU|DE)\d{4}\b.*$/i,"").replace(/\s+IE[A-Z0-9]*\b.*$/i,"").replace(/\*/g," ").trim());
  if(/^(FORFAIT|CONSOMMATION) .*COMPTE/i.test(d))return "Frais bancaires";
  return titre(d.replace(/\b(BE|FR|NL|LU)\d{2}[\d ]{8,}/g,"").slice(0,45))}
const MOTS_CAT=[[/delhaize|colruyt|aldi|lidl|carrefour|crf mkt|intermarche|spar|okay|match|proxy|albert heijn|cora|super|hopper/,"Courses"],[/total|shell|esso|q8|texaco|lukoil|dats|gabriels|octa|power|maes|station|air-serv|wash/,"Carburant"],[/sncb|nmbs|stib|mivb|tec|de lijn|parking|uber|bolt|indigo|peage|bebat/,"Transport"],[/quick|mcdo|mcdonald|burger|kfc|pizza|resto|restaurant|cafe|brasserie|deliveroo|uber eats|takeaway|snack|friterie/,"Resto"],[/pharma|apotheek|medecin|mutualite|mutualiteit|hopital|dentiste|kine/,"Santé"],[/proximus|orange|telenet|base|voo|scarlet|engie|luminus|totalenergies|eneco|vivaqua|swde|loyer|ikea|brico|gamma|hubo|action/,"Maison"],[/zara|h&m|primark|c&a|kiabi|jbc|decathlon|zalando|vinted/,"Vêtements"],[/netflix|spotify|disney|cinema|kinepolis|steam|playstation|xbox|basic.?fit|jims|fitness|google play|apple\.com|itunes/,"Loisirs"],[/cofidis|buy way|cetelem|credit|santander/,"Maison"]];
function catDevine(t){t=nrm(t);if(/retrait d.especes/.test(t)&&cats().includes("Autre"))return "Autre";for(const [re,c] of MOTS_CAT)if(re.test(t)&&cats().includes(c))return c;return cats().includes("Autre")?"Autre":cats()[cats().length-1]}
async function importCSV(f){
  openRaw(`<h3>Lecture du fichier <button class="del" data-close>×</button></h3><div class="est"><span class="spin"></span>Je lis tes opérations…</div>`);
  let ops;try{const buf=await f.arrayBuffer();let txt;try{txt=new TextDecoder("utf-8",{fatal:true}).decode(buf)}catch(e){txt=new TextDecoder("windows-1252").decode(buf)} // les banques belges exportent souvent en ISO-8859-1
    ops=lireCSVBanque(txt)}catch(e){openRaw(`<h3>Import impossible <button class="del" data-close>×</button></h3><div class="est">${esc(e.message)}</div><p class="sub" style="margin-top:8px">Exporte le fichier au format CSV depuis ta banque en ligne (sur ordinateur), puis réessaie.</p>`);return}
  ops.sort((x,y)=>y.date.localeCompare(x.date));ops=ops.slice(0,2000); // les plus récentes d'abord
  const near=(a,b,n)=>Math.abs(new Date(a)-new Date(b))<=n*864e5;
  releveRes=ops.map(o=>{const m=o.montant,lib=o.libelle;
    const dup=m<0?S.depenses.some(d=>near(d.date,o.date,3)&&Math.abs(+d.montant-Math.abs(m))<0.01):S.paies.some(p=>near(p.date,o.date,7)&&Math.abs(+p.montant-m)<0.01);
    const ag=S.missions.some(mi=>mi.agence&&nrm(o.texte).includes(nrm(mi.agence).split(/[ .]/)[0]))||/salaire|loon|wedde|interim|randstad|adecco|manpower|start people|asap|tempo.?team|accent|daoust|synergie|unique|trace/.test(nrm(o.texte));
    return{date:o.date,libelle:lib,montant:m,cat:catDevine(o.texte),salaire:m>0&&ag&&!o.interne,dup,interne:!!o.interne}});
  // catégories affinées par l'IA si disponible (libellés seulement, sans numéros de compte)
  if(textModel&&model){try{$("sheet").querySelector(".est").innerHTML=`<span class="spin"></span>${releveRes.length} opérations · je classe les dépenses…`;
    const dep=releveRes.map((o,i)=>[i,o]).filter(([,o])=>o.montant<0).slice(0,200);
    if(dep.length){const res=await model.generateContent(`Classe chaque dépense bancaire belge dans une catégorie parmi ${JSON.stringify(cats())}. Réponds UNIQUEMENT avec un JSON {"c":{"index":"catégorie"}}.\n`+dep.map(([i,o])=>`${i}: ${o.libelle} (${Math.abs(o.montant)} €)`).join("\n"));
      const j=parseJSON(res.response.text());if(j&&j.c)Object.entries(j.c).forEach(([i,c])=>{if(releveRes[+i]&&cats().includes(c))releveRes[+i].cat=c})}}catch(e){console.warn("classement IA",e)}}
  afficherReleve(`${releveRes.length} opération(s) importée(s) du fichier`);
}
function afficherReleve(titre){
  const nSel=releveRes.filter(o=>!o.dup&&!o.interne).length;
  openRaw(`<h3>${esc(titre)} <button class="del" data-close>×</button></h3>
    <p class="sub" style="margin-bottom:6px">Coché par défaut : ${nSel} opération(s). Décochés : doublons et virements entre tes propres comptes (épargne…). Les autres entrées (remboursements, virements de proches…) comptent comme « autres rentrées ».</p>
    <div class="chips" style="margin-bottom:6px"><button type="button" data-relper="0">Ce mois-ci</button><button type="button" data-relper="3">3 derniers mois</button><button type="button" data-relper="12">Tout</button><button type="button" data-relall="0">Rien</button></div>
    <form data-f="releve">${releveRes.map((o,i)=>`<div class="chk-row"><input type="checkbox" name="o${i}" ${!o.dup&&!o.interne?"checked":""}><div class="l"><b>${esc(o.libelle)}</b><small>${fmtD(o.date)} ${o.date.slice(0,4)} · ${o.interne?"🔄 virement entre tes comptes":o.montant>0?(o.salaire?"💶 paie":"💰 autre rentrée"):esc(o.cat)}${o.dup?" · déjà présent":""}</small></div><b class="${o.montant<0?"out":"pos"}">${o.montant>0?"+":""}${eur2(o.montant)}</b></div>`).join("")}
    <label class="chk" style="margin-top:8px"><input type="checkbox" name="anciennes" checked> Les paies d'avant ce mois-ci vont dans l'historique 📚 (hors budget)</label>
    <button class="btn" style="margin-top:10px">Importer la sélection</button></form>`)}

/* ---------- doublons de paies (fiche scannée 2 fois, ou fiche + virement bancaire) ---------- */
const procheJ=(a,b,n=7)=>Math.abs(new Date(a+"T12:00")-new Date(b+"T12:00"))<=n*864e5;
function memePaie(p,date,montant){return Math.abs((+p.montant||0)-(+montant||0))<0.01&&procheJ(p.date,date)}
function qualite(p){ // plus c'est haut, plus la paie est fiable à garder
  let q=0;if(p.detail)q+=10;if(p.photo)q+=2;if(+p.heures>0)q+=1;
  const m=S.missions.find(x=>x.id===p.mission),d=p.detail;
  if(d&&+d.brut>0&&+p.heures>0){const t=+d.taux_horaire_brut||(m&&+m.taux)||0;if(t){const h=d.brut/t;q+=Math.max(0,5-Math.abs(h-p.heures))}} // heures cohérentes avec le brut
  return q}
function trouverDoublons(){const L=S.paies.filter(p=>!p.autre).sort((a,b)=>a.date.localeCompare(b.date)),vus=new Set(),G=[];
  for(let i=0;i<L.length;i++){if(vus.has(L[i].id))continue;const g=[L[i]];
    for(let j=i+1;j<L.length&&procheJ(L[i].date,L[j].date);j++)if(!vus.has(L[j].id)&&memePaie(L[j],L[i].date,L[i].montant))g.push(L[j]);
    if(g.length>1){g.forEach(x=>vus.add(x.id));g.sort((a,b)=>qualite(b)-qualite(a));G.push(g)}}
  return G}
function renderDoublons(){const G=trouverDoublons();
  $("dupBox").innerHTML=G.length?`<div class="card alert bad" style="cursor:pointer" data-dups="1"><div style="flex:1"><div class="t">⚠️ ${G.length} paie(s) en double</div><p>La même paie est comptée plusieurs fois (fiche scannée 2 fois, ou fiche + virement de la banque). Touche ici pour nettoyer.</p></div></div>`:""}
function ouvrirDoublons(){const G=trouverDoublons();if(!G.length){toast("Aucun doublon");return}
  const lab=p=>{const m=S.missions.find(x=>x.id===p.mission);return `<b>${eur2(p.montant)} · ${new Date(p.date+"T12:00").toLocaleDateString("fr-BE")}</b><small>${p.detail?"📄 fiche scannée":"🏦 virement / saisie"}${p.heures?" · "+fmtN(p.heures)+" h":""}${p.detail&&p.detail.brut?" · "+eur2(p.detail.brut)+" brut":""}${p.note?" · "+esc(p.note):""}</small>`};
  openRaw(`<h3>Paies en double <button class="del" data-close>×</button></h3>
    <p class="sub" style="margin-bottom:8px">Pour chaque groupe, choisis la paie à <b>garder</b> (déjà présélectionnée : la plus complète, avec des heures cohérentes avec le brut). Les autres seront supprimées.</p>
    <form data-f="dups">${G.map((g,gi)=>`<div class="card" style="background:var(--card2);padding:10px 12px">${g.map((p,pi)=>`<label class="chk-row" style="border-bottom:${pi<g.length-1?"1px solid var(--line)":"0"}"><input type="radio" name="g${gi}" value="${p.id}" ${pi===0?"checked":""}><div class="l">${lab(p)}</div>${p.photo?`<button type="button" class="btn sec sm" data-photo="${p.photo}" style="width:auto">🖼️</button>`:""}</label>`).join("")}</div>`).join("")}
    <button class="btn">Supprimer les doublons</button></form>`)}
function nettoyerDoublons(f){const G=trouverDoublons();let n=0;
  G.forEach((g,gi)=>{const keep=(f["g"+gi]&&f["g"+gi].value)||g[0].id,k=g.find(p=>p.id===keep);
    g.forEach(p=>{if(p.id===keep)return;if(!k.photo&&p.photo){k.photo=p.photo}else if(p.photo)delPhoto(p.photo);
      if(p.recu)k.recu=true;S.paies=S.paies.filter(x=>x.id!==p.id);n++})});
  closeSheet();save();toast(`${n} doublon(s) supprimé(s) ✓`)}

/* ---------- formulaires ---------- */
const COLL={depense:"depenses",paie:"paies",mission:"missions",fixe:"fixes",objectif:"objectifs",pointage:"pointage",dette:"dettes",cheques:"cr"};
const EMOJIS=["🎯","🚗","🏖️","🏠","📱","🎓","💍","🎮","🛠️","🐶"];
function openSheet(type,ctx,item,opts={}){
  const it=item||{}, ed=!!item, V=(k,d="")=>esc(it[k]??d);
  const head=(t)=>`<h3>${t} <button class="del" type="button" data-close>×</button></h3>`;
  const delBtn=ed?`<button type="button" class="btn danger" data-del2="${COLL[type]}:${it.id}" style="margin-top:4px">Supprimer</button>`:"";
  const actMis=(S.missions.filter(m=>(!m.debut||m.debut<=today())&&(!m.fin||m.fin>=today())).slice(-1)[0]||{}).id;
  const selMis=ed?it.mission:(ctx||actMis);
  const missOpts=S.missions.map(m=>`<option value="${m.id}" ${selMis===m.id?"selected":""}>${esc(m.client||m.agence)}</option>`).join("");
  const lc=S.depenses.length?S.depenses[S.depenses.length-1].cat:"",lastCat=cats().includes(lc)?lc:cats()[0];
  const H={
   depense:`${head(ed?"Modifier la dépense":"Nouvelle dépense")}
    <form data-f="depense" data-id="${V("id")}"><label>Montant (€)<input name="montant" type="number" step="0.01" inputmode="decimal" required value="${V("montant")}"></label>
    <label>Catégorie</label><div class="chips" id="catChips">${cats().map(c=>`<button type="button" class="${(it.cat||lastCat)===c?"on":""}" data-cat="${esc(c)}">${esc(c)}</button>`).join("")}</div>
    <input type="hidden" name="cat" id="catIn" value="${esc(it.cat||lastCat)}">
    <div class="two"><label>Date<input name="date" type="date" value="${V("date",today())}" required></label><label>Note<input name="note" placeholder="ex. Delhaize" value="${V("note")}" list="notesList"></label></div>
    <datalist id="notesList">${[...new Set(S.depenses.map(d=>d.note).filter(Boolean))].slice(-30).map(n=>`<option value="${esc(n)}">`).join("")}</datalist>
    <label class="chk"><input type="checkbox" name="paye" ${it.paye===false?"":"checked"}> Déjà payée</label>
    <label>Échéance (si pas encore payée)<input name="echeance" type="date" value="${V("echeance")}"></label>
    ${it.detail?`<button type="button" class="btn sec" data-fdetail="${it.id}">🧾 Voir le détail du document</button>`:""}
    ${ed?(it.photo?`<div class="two"><button type="button" class="btn sec" data-photo="${it.photo}">🖼️ Voir la photo</button><button type="button" class="btn sec" data-attach="depenses:${it.id}">🔄 Remplacer</button></div>`:`<button type="button" class="btn sec" data-attach="depenses:${it.id}">📎 Joindre une photo / un PDF</button>`):""}
    <button class="btn">${ed?"Enregistrer":"Ajouter"}</button>${delBtn}</form>`,
   paie:`${head(ed?"Modifier la paie":opts.aRecevoir?"Argent à recevoir":"Nouvelle paie")}
    <form data-f="paie" data-id="${V("id")}">${S.missions.length?`<label>Mission<select name="mission" id="pMis"><option value="">— Aucune —</option>${missOpts}</select></label>`:""}
    <div class="two"><label>Heures prestées<input name="heures" id="pH" type="number" step="0.25" inputmode="decimal" placeholder="ex. 38" value="${V("heures")}"></label><label>Date<input name="date" type="date" value="${V("date",today())}" required></label></div>
    <div class="est" id="pEst">Indique les heures pour une estimation du net.</div>
    <label>Montant net (€)<input name="montant" id="pM" type="number" step="0.01" inputmode="decimal" required value="${V("montant")}" ${ed?'data-touched="1"':""}></label>
    <label>Note<input name="note" placeholder="${opts.aRecevoir?"ex. prime de fin d'année":"ex. semaine 45"}" value="${V("note")}"></label>
    <label class="chk"><input type="checkbox" name="recu" ${ed?(it.recu?"checked":""):(opts.aRecevoir?"":"checked")}> Déjà reçue sur mon compte <small style="color:var(--mut)">(sinon : à recevoir, pas encore dans ton reste à vivre)</small></label>
    <label class="chk"><input type="checkbox" name="autre" ${it.autre||opts.aRecevoir?"checked":""}> 💰 Pas une paie (prime, remboursement, virement d'un proche, vente, allocation…)</label>
    <label class="chk"><input type="checkbox" name="archive" ${it.archive?"checked":""}> 📚 Historique seulement (argent déjà dépensé, ne compte pas dans mon budget)</label>
    ${it.detail?`<button type="button" class="btn sec" data-detail="${it.id}">📄 Voir le détail de la fiche</button>`:""}
    ${ed?(it.photo?`<div class="two"><button type="button" class="btn sec" data-photo="${it.photo}">🖼️ Voir la photo</button><button type="button" class="btn sec" data-attach="paies:${it.id}">🔄 Remplacer</button></div>`:`<button type="button" class="btn sec" data-attach="paies:${it.id}">📎 Joindre la fiche (photo / PDF)</button>`):""}
    <button class="btn">${ed?"Enregistrer":"Ajouter"}</button>${delBtn}</form>`,
   mission:`${head(ed?"Modifier la mission":"Nouvelle mission")}
    <form data-f="mission" data-id="${V("id")}"><div class="two"><label>Agence<input name="agence" required placeholder="ex. ASAP" value="${V("agence")}" list="agList"></label><label>Client / poste<input name="client" placeholder="ex. Magasinier" value="${V("client")}"></label></div>
    <datalist id="agList">${[...new Set(S.missions.map(m=>m.agence).filter(Boolean))].map(n=>`<option value="${esc(n)}">`).join("")}</datalist>
    <div class="two"><label>Début<input name="debut" type="date" value="${V("debut",today())}"></label><label>Fin prévue<input name="fin" type="date" value="${V("fin")}"></label></div>
    <div class="two"><label>Taux horaire brut (€)<input name="taux" type="number" step="0.0001" inputmode="decimal" value="${V("taux")}"></label><label>Heures / semaine<input name="hsem" type="number" step="0.5" inputmode="decimal" placeholder="ex. 38" value="${V("hsem")}"></label></div>
    <div class="card" style="background:var(--card2);margin:0"><div class="k">🚗 Trajet domicile → mission</div>
      <label style="margin-top:8px">Départ<input id="fDep" name="_dep" value="${esc(S.reglages.domicile||"")}" placeholder="Ton adresse (gardée pour la prochaine fois)"></label>
      <label style="margin-top:8px">Arrivée<input id="fArr" name="adresse" value="${V("adresse",it.contrat&&it.contrat.lieu?it.contrat.lieu:"")}" placeholder="Adresse de la mission"></label>
      <div style="display:flex;gap:8px;align-items:flex-end;margin-top:8px"><label style="flex:1">Km (aller)<input id="fKm" name="km" type="number" step="0.1" inputmode="decimal" value="${V("km")}"></label><input type="hidden" id="fMin" name="min" value="${V("min")}"><button type="button" class="btn sm" id="bCalc" style="width:auto;height:46px">📍 Calculer</button></div>
      <div class="sub" id="trajRes" style="margin-top:6px">${+it.km>0?`≈ ${eur2(coutJour(it))} de carburant par jour (aller-retour)`:""}</div>
      <p class="osm">Itinéraire © contributeurs OpenStreetMap (Nominatim, OSRM)</p></div>
    ${it.contrat?`<button type="button" class="btn sec" data-cdetail="${it.id}">📑 Voir le détail du contrat</button>`:""}
    ${ed?(it.photo?`<div class="two"><button type="button" class="btn sec" data-photo="${it.photo}">🖼️ Voir le contrat</button><button type="button" class="btn sec" data-attach="missions:${it.id}">🔄 Remplacer</button></div>`:`<button type="button" class="btn sec" data-attach="missions:${it.id}">📎 Joindre le contrat (photo / PDF)</button>`):""}
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
      return `<label style="grid-template-columns:1fr 120px;align-items:center;display:grid">${esc(c)}${avg?` <small style="font-weight:400">moy. ${eur(avg)}</small>`:""}<input name="b_${esc(c)}" type="number" step="1" inputmode="numeric" value="${esc(S.budgets[c]||"")}" placeholder="—"></label>`}).join("")}
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
    <div class="pick-h">À la main</div>
    <div class="pick-grid"><button class="main" data-open="depense"><span>💸</span>Une dépense<small>courses, resto, essence…</small></button><button data-open="paie"><span>💶</span>Une rentrée<small>paie, remboursement…</small></button></div>
    ${canImg?`<div class="pick-h">Scanner avec l'IA</div><div class="pick-grid"><button class="scanBtn" data-mode="facture"><span>🧾</span>Ticket / facture</button><button class="scanBtn"><span>📷</span>Fiche de paie</button><button class="scanBtn" data-mode="contrat"><span>📑</span>Contrat</button><button class="scanBtn" data-mode="f281"><span>📄</span>Fiche 281.10</button><button type="button" onclick="document.getElementById('bHisto').click()"><span>📚</span>Anciennes fiches</button></div>`:""}
    <div class="pick-h">Autre</div>
    <div class="pick-grid"><button data-open="epargne"><span>🐷</span>Mettre de côté</button><button data-open="fixe"><span>🔁</span>Charge fixe</button><button data-open="mission"><span>🏭</span>Mission</button><button data-open="objectif"><span>🎯</span>Objectif</button><button data-open="pointage"><span>⏱️</span>Pointer des heures</button><button data-open="cheques"><span>🍽️</span>Chèques-repas</button><button data-open="dette"><span>🤝</span>Dette / prêt</button><button type="button" data-go="releve"><span>🏦</span>Relevé bancaire</button></div>`,
  };
  $("sheet").innerHTML=H[type];$("sheetBg").classList.add("open");
  if(type==="paie"){
    const upd=()=>{const m=S.missions.find(x=>x.id===($("pMis")?.value));const h=+$("pH").value;
      if(m&&m.taux&&h){const n=m.taux*h*S.reglages.ratio/100;$("pEst").innerHTML=`Estimation : <b>${eur2(n)}</b> net<br><small>${fmtN(h)} h × ${eurT(m.taux)} brut × ${S.reglages.ratio}%</small>`;if(!$("pM").dataset.touched)$("pM").value=n.toFixed(2)}
      else $("pEst").textContent=m&&!m.taux?"Ajoute un taux horaire à la mission pour estimer le net.":"Choisis une mission et indique les heures pour une estimation du net."};
    $("pH").oninput=upd;if($("pMis"))$("pMis").onchange=upd;$("pM").oninput=()=>$("pM").dataset.touched=1;upd();
  }
  if(!ed)setTimeout(()=>$("sheet").querySelector("input:not([type=hidden])")?.focus(),80);
}
function closeSheet(){$("sheetBg").classList.remove("open");if(scanCtl){scanCtl.abort();scanCtl=null}}
// paie déjà enregistrée avec une année mal lue : impossible si elle tombe bien avant le début de sa mission.
// On remet la même date (jour/mois) dans l'année de la mission, si ça tombe entre le début de la mission et aujourd'hui.
function reparerAnnee(p,missions){const m=missions.find(x=>x.id===p.mission);
  if(!m||!/^\d{4}-\d{2}-\d{2}$/.test(m.debut||"")||!/^\d{4}-\d{2}-\d{2}$/.test(p.date||""))return;
  const lim=new Date(m.debut+"T12:00");lim.setDate(lim.getDate()-31);if(new Date(p.date+"T12:00")>=lim)return;
  const y0=+m.debut.slice(0,4),fin=new Date();fin.setDate(fin.getDate()+7);const dec=new Date(m.debut+"T12:00");dec.setDate(dec.getDate()-7);
  for(const y of [y0,y0+1]){const c=y+p.date.slice(4),dc=new Date(c+"T12:00");if(dc>=dec&&dc<=fin){const dy=y-+p.date.slice(0,4);
    const fx=d=>/^\d{4}-\d{2}-\d{2}$/.test(d||"")?(+d.slice(0,4)+dy)+d.slice(4):d;
    if(p.detail){["periode_debut","periode_fin","date_paiement"].forEach(k=>{p.detail[k]=fx(p.detail[k])});if(Array.isArray(p.detail.jours))p.detail.jours.forEach(j=>{j.date=fx(j.date)})}
    if(p.archive&&c.slice(0,7)>=mkey(new Date(Date.now()-40*864e5)))p.archive=false; // cochée « ancienne » seulement à cause de la mauvaise année
    p.date=c;return}}}
// l'IA lit parfois la bonne date avec la mauvaise année (ex. 10/11/2025 au lieu de 2026) : la paie part alors dans un vieux mois.
// Si la même date dans l'année en cours tombe dans les 60 derniers jours (ou la semaine qui vient), on corrige.
// mission correspondant à une fiche : même agence, puis même client, puis mission qui couvre la période, puis la plus récente
function missionPourFiche(r){const lo=x=>nrm(x),ag=lo(r.agence),cl=lo(r.client),d=r.periode_fin||r.periode_debut||r.date_paiement||today();
  const C=S.missions.filter(m=>ag&&m.agence&&(ag.includes(lo(m.agence))||lo(m.agence).includes(ag.split(" ")[0])));
  const sc=m=>(cl&&m.client&&(cl.includes(lo(m.client).split(" ")[0])||lo(m.client).includes(cl.split(" ")[0]))?4:0)+((!m.debut||m.debut<=d)&&(!m.fin||m.fin>=(r.periode_debut||d))?2:0)+(cl&&m.client&&!(cl.includes(lo(m.client).split(" ")[0])||lo(m.client).includes(cl.split(" ")[0]))?-3:0);
  return C.sort((a,b)=>sc(b)-sc(a)||(b.debut||"").localeCompare(a.debut||""))[0]}
// écart d'années à appliquer à une date lue par l'IA (0 si elle semble juste)
function decalAnnee(d){if(!/^\d{4}-\d{2}-\d{2}$/.test(d||""))return 0;const t=new Date(),y=t.getFullYear();if(Math.abs(new Date(d+"T12:00")-t)/864e5<200)return 0;
  for(const yy of [y,y-1]){const j=(new Date(yy+d.slice(4)+"T12:00")-t)/864e5;if(j>=-60&&j<=7)return yy-+d.slice(0,4)}return 0}
const decale=(d,n)=>n&&/^\d{4}-\d{2}-\d{2}$/.test(d||"")?(+d.slice(0,4)+n)+d.slice(4):d;
// ticket / facture : on corrige la date et on décale l'échéance d'autant
function corrigeAnneeFact(r){const n=decalAnnee(r.date);if(n){r.date=decale(r.date,n);r.echeance=decale(r.echeance,n)}return n}
function corrigeAnnee(r){const t=new Date(),y=t.getFullYear();let lu=null;
  const fx=d=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(d||""))return d;const n=new Date(d+"T12:00");if(Math.abs(n-t)/864e5<200)return d;
    for(const yy of [y,y-1]){const c=yy+d.slice(4),j=(new Date(c+"T12:00")-t)/864e5;if(j>=-60&&j<=7){lu=lu||d.slice(0,4);return c}}return d};
  ["periode_debut","periode_fin","date_paiement","date_etablissement"].forEach(k=>{r[k]=fx(r[k])});
  if(Array.isArray(r.jours))r.jours.forEach(j=>{j.date=fx(j.date)});
  return lu}
/* ---------- bourse : suivi des placements (prix notés à la main, crypto mise à jour via CoinGecko) ---------- */
const BTYPES={etf:"📊 ETF / fonds",action:"🏢 Action",crypto:"🪙 Crypto"};
const CRYPTOS=[["bitcoin","Bitcoin (BTC)"],["ethereum","Ethereum (ETH)"],["solana","Solana (SOL)"],["ripple","XRP"],["binancecoin","BNB"],["cardano","Cardano (ADA)"],["dogecoin","Dogecoin (DOGE)"],["tether","Tether (USDT)"],["usd-coin","USDC"],["chainlink","Chainlink (LINK)"],["polkadot","Polkadot (DOT)"],["litecoin","Litecoin (LTC)"]];
// position d'un titre : quantité, coût restant (méthode du prix moyen), gains réalisés sur les ventes
function boursePos(t){const B=S.bourse;let q=0,cout=0,real=0,verse=0;
  B.ops.filter(o=>o.titre===t.id).sort((a,b)=>(a.date||"").localeCompare(b.date||"")).forEach(o=>{const qq=+o.qte||0,px=+o.prix||0,fr=+o.frais||0;
    if(o.sens==="vente"){const part=q>0?cout*Math.min(1,qq/q):0;real+=qq*px-fr-part;cout-=part;q=Math.max(0,q-qq)}else{cout+=qq*px+fr;q+=qq;verse+=qq*px+fr}});
  const c=B.cours[t.id],last=[...B.ops].filter(o=>o.titre===t.id).sort((a,b)=>(b.date||"").localeCompare(a.date||""))[0];
  const prix=c&&+c.prix>0?+c.prix:last?+last.prix:0,dateC=c&&+c.prix>0?c.date:last?last.date:"";
  const val=q*prix;return{q,cout,real,verse,prix,dateC,manuel:!(c&&+c.prix>0),val,gain:val-cout,pct:cout>0?(val-cout)/cout*100:0}}
const qFmt=n=>(+n||0).toLocaleString("fr-BE",{maximumFractionDigits:8});
const sg=n=>(n>=0?"+":"−")+eur2(Math.abs(n));
function renderBourse(){const el=$("bourseCard");if(!el)return;const B=S.bourse,T=B.titres.map(t=>({t,p:boursePos(t)}));
  const inv=sum(T,x=>x.p.cout),val=sum(T,x=>x.p.val),real=sum(T,x=>x.p.real),g=val-inv;
  const st=$("st-bourse");if(st)st.textContent=T.length?`${eur(val)} · ${g>=0?"+":"−"}${eur(Math.abs(g))}`:"Suis tes actions, ETF et cryptos";
  const hasCrypto=B.titres.some(t=>t.type==="crypto"&&t.cg);
  el.innerHTML=(T.length?`<div class="two"><div><div class="sub">Investi</div><div class="v" style="font-size:20px">${eur(inv)}</div></div><div><div class="sub">Valeur actuelle</div><div class="v ${g>=0?"pos":"out"}" style="font-size:20px">${eur(val)}</div><div class="sub" style="color:${g>=0?"var(--pos)":"var(--out)"}">${sg(g)}${inv>0?` (${g>=0?"+":""}${(g/inv*100).toFixed(1).replace(".",",")} %)`:""}</div></div></div>
    ${real?`<div class="sub" style="margin-top:6px">Gains déjà encaissés sur tes ventes : <b style="color:${real>=0?"var(--pos)":"var(--out)"}">${sg(real)}</b></div>`:""}
    <div style="margin-top:10px">${T.sort((a,b)=>b.p.val-a.p.val).map(({t,p})=>row("",`<b data-btitre="${t.id}" style="cursor:pointer">${esc(t.nom)}${t.ticker?` <small style="color:var(--mut)">${esc(t.ticker)}</small>`:""}</b><small data-btitre="${t.id}" style="cursor:pointer">${p.q>0?qFmt(p.q)+" × "+eurT(p.prix):"vendu"} · ${p.manuel?"cours du "+(p.dateC?fmtD(p.dateC):"?"):"cours du "+fmtD(p.dateC)}</small>`,
      `<div style="text-align:right;cursor:pointer" data-btitre="${t.id}"><b>${eur2(p.val)}</b><div style="font-size:12px;color:${p.gain>=0?"var(--pos)":"var(--out)"}">${p.q>0?sg(p.gain)+" ("+(p.pct>=0?"+":"")+p.pct.toFixed(1).replace(".",",")+" %)":""}</div></div>`,t.type==="crypto"?"🪙":t.type==="etf"?"📊":"🏢")).join("")}</div>`
    :`<div class="empty">Note ce que tu achètes (ETF, actions, crypto) : je calcule ce que tu as investi et combien ça vaut aujourd'hui.</div>`)
    +`${model?`<button type="button" class="btn sm" data-bscan="1" style="margin-top:10px;width:100%">📸 Importer une capture de mon appli de bourse</button>`:""}<div class="two" style="margin-top:8px"><button type="button" class="btn ${model?"sec ":""}sm" data-bop="">+ Achat / vente</button>${hasCrypto?`<button type="button" class="btn sec sm" data-bcrypto="1">↻ Cours crypto</button>`:""}</div>
    ${T.some(x=>x.t.type!=="crypto"&&x.p.q>0)?`<p class="sub" style="margin-top:8px">Pour les actions et ETF, touche une ligne puis « Mettre à jour le cours » avec le prix affiché dans ton appli de bourse (en €).</p>`:""}`}
function bourseOpForm(tid,sens){const B=S.bourse,t=B.titres.find(x=>x.id===tid);
  openRaw(`<h3>${t?esc(t.nom):"Achat / vente"} <button class="del" type="button" data-close>×</button></h3>
  <form id="fBourseOp">
   ${t?`<input type="hidden" name="titre" value="${t.id}">`:`<label>Placement<select name="titre" id="bTitreSel"><option value="__new">➕ Nouveau placement</option>${B.titres.map(x=>`<option value="${x.id}">${esc(x.nom)}</option>`).join("")}</select></label>
   <div id="bNew"><div class="two"><label>Type<select name="type" id="bType">${Object.entries(BTYPES).map(([k,v])=>`<option value="${k}">${v}</option>`).join("")}</select></label><label>Code (facultatif)<input name="ticker" placeholder="ex. IWDA, AAPL"></label></div>
    <label id="bNomL">Nom<input name="nom" placeholder="ex. iShares MSCI World"></label>
    <label id="bCgL" hidden>Crypto<select name="cg">${CRYPTOS.map(([k,v])=>`<option value="${k}">${v}</option>`).join("")}</select></label></div>`}
   <div class="two"><label>Opération<select name="sens"><option value="achat">Achat</option><option value="vente" ${sens==="vente"?"selected":""}>Vente</option></select></label><label>Date<input name="date" type="date" required value="${today()}"></label></div>
   <div class="two"><label>Montant total (€)<input name="montant" type="number" step="0.01" inputmode="decimal" placeholder="ex. 100"></label><label>Prix d'une part (€)<input name="prix" type="number" step="any" inputmode="decimal" placeholder="ex. 98,40"></label></div>
   <div class="two"><label>Nombre de parts<input name="qte" type="number" step="any" inputmode="decimal" placeholder="calculé si vide"></label><label>Frais (€)<input name="frais" type="number" step="0.01" inputmode="decimal" placeholder="0"></label></div>
   <p class="sub">Remplis au moins deux des trois : montant, prix d'une part, nombre de parts. Le montant total inclut les frais.</p>
   <button class="btn">Enregistrer</button></form>`);
  const ty=$("bType");if(ty){const upd=()=>{const c=ty.value==="crypto";$("bCgL").hidden=!c;$("bNomL").hidden=c};ty.onchange=upd;upd();$("bTitreSel").onchange=()=>{$("bNew").hidden=$("bTitreSel").value!=="__new"}}}
function bourseSaveOp(f){const d=Object.fromEntries(new FormData(f)),B=S.bourse;
  const fr=Math.max(0,+String(d.frais||"").replace(",",".")||0);let mt=+String(d.montant||"").replace(",",".")||0,px=+String(d.prix||"").replace(",",".")||0,q=+String(d.qte||"").replace(",",".")||0;
  if(!q&&mt&&px)q=(d.sens==="vente"?mt+fr:mt-fr)/px;else if(!px&&q&&mt)px=(d.sens==="vente"?mt+fr:mt-fr)/q;
  if(!(q>0&&px>0)){toast("Indique au moins deux valeurs : montant, prix d'une part ou nombre de parts");return}
  let tid=d.titre;
  if(!tid||tid==="__new"){const cr=d.type==="crypto",lab=cr?(CRYPTOS.find(c=>c[0]===d.cg)||[d.cg,d.cg])[1]:String(d.nom||"").trim();if(!lab){toast("Donne un nom au placement");return}
    const ex=B.titres.find(x=>cr?x.cg===d.cg:x.nom.toLowerCase()===lab.toLowerCase());
    if(ex)tid=ex.id;else{tid=uid();B.titres.push({id:tid,nom:lab.slice(0,60),ticker:String(d.ticker||"").trim().toUpperCase().slice(0,15),type:d.type||"action",cg:cr?d.cg:""})}}
  const t=B.titres.find(x=>x.id===tid);if(!t)return;
  if(d.sens==="vente"){const p=boursePos(t);if(q>p.q+1e-9){toast(`Tu n'as que ${qFmt(p.q)} part(s) de ${t.nom}`);return}}
  B.ops.push({id:uid(),titre:tid,date:d.date||today(),sens:d.sens==="vente"?"vente":"achat",qte:Math.round(q*1e8)/1e8,prix:Math.round(px*1e6)/1e6,frais:fr});
  if(!B.cours[tid]||(B.cours[tid].date||"")<=(d.date||today()))B.cours[tid]={prix:Math.round(px*1e6)/1e6,date:d.date||today()};
  closeSheet();save();toast(d.sens==="vente"?"Vente enregistrée ✓":"Achat enregistré ✓")}
function bourseTitre(tid){const B=S.bourse,t=B.titres.find(x=>x.id===tid);if(!t)return;const p=boursePos(t);
  const ops=B.ops.filter(o=>o.titre===tid).sort((a,b)=>(b.date||"").localeCompare(a.date||""));
  const ln=(a,b,c="")=>`<div class="ln"><span>${a}</span><b class="${c}" style="text-align:right">${b}</b></div>`;
  openRaw(`<h3>${esc(t.nom)} <button class="del" type="button" data-close>×</button></h3><p class="sub">${BTYPES[t.type]||""}${t.ticker?" · "+esc(t.ticker):""}</p>
   <div class="card" style="background:var(--card2);margin-top:10px">${ln("Parts",qFmt(p.q))}${ln("Investi (encore en portefeuille)",eur2(p.cout))}${ln("Cours",`${eurT(p.prix)} <small style="color:var(--mut);font-weight:600">${p.dateC?fmtD(p.dateC):""}</small>`)}${ln("Valeur actuelle",eur2(p.val))}${ln("Plus / moins-value",p.q>0?sg(p.gain)+" ("+(p.pct>=0?"+":"")+p.pct.toFixed(1).replace(".",",")+" %)":"—",p.gain>=0?"pos":"out")}${p.real?ln("Gains encaissés (ventes)",sg(p.real),p.real>=0?"pos":"out"):""}</div>
   <div class="two" style="margin-top:12px">${t.type==="crypto"&&t.cg?`<button type="button" class="btn sec" data-bcrypto="1">↻ Cours en direct</button>`:`<button type="button" class="btn sec" data-bcours="${t.id}">✏️ Mettre à jour le cours</button>`}<button type="button" class="btn sec" data-bop="${t.id}">+ Achat / vente</button></div>
   <div class="day" style="margin-top:14px;text-transform:none"><span>Opérations</span><span>${ops.length}</span></div><div class="card" style="background:var(--card2)">${ops.map(o=>row("",`<b>${o.sens==="vente"?"Vente":"Achat"} · ${qFmt(o.qte)} part(s)</b><small>${fmtD(o.date)} ${o.date?o.date.slice(0,4):""} · ${eurT(o.prix)} la part${+o.frais?" · frais "+eur2(o.frais):""}</small>`,`<span class="amt ${o.sens==="vente"?"pos":"out"}">${o.sens==="vente"?"+":"−"}${eur2(o.qte*o.prix+(o.sens==="vente"?-1:1)*(+o.frais||0))}</span><button class="del" type="button" data-bdelop="${o.id}" data-t="${t.id}">×</button>`,o.sens==="vente"?"💰":"🛒")).join("")}</div>`)}
function bourseCoursForm(tid){const t=S.bourse.titres.find(x=>x.id===tid);if(!t)return;const p=boursePos(t);
  openRaw(`<h3>Cours de ${esc(t.nom)} <button class="del" type="button" data-close>×</button></h3><form id="fBourseCours"><input type="hidden" name="titre" value="${t.id}">
   <label>Prix d'une part aujourd'hui (€)<input name="prix" type="number" step="any" inputmode="decimal" required value="${p.prix||""}"></label>
   <p class="sub">Regarde le prix dans ton appli de bourse${t.ticker?` (code ${esc(t.ticker)})`:""}, en euros.</p><button class="btn">Enregistrer</button></form>`)}
function bourseSaveCours(f){const d=Object.fromEntries(new FormData(f)),px=+String(d.prix||"").replace(",",".");if(!(px>0)){toast("Prix invalide");return}
  S.bourse.cours[d.titre]={prix:px,date:today()};save();bourseTitre(d.titre);toast("Cours mis à jour ✓")}
async function bourseMajCrypto(){const ids=[...new Set(S.bourse.titres.filter(t=>t.type==="crypto"&&t.cg).map(t=>t.cg))];if(!ids.length)return;
  toast("Récupération des cours…");
  try{const r=await fetch("https://api.coingecko.com/api/v3/simple/price?vs_currencies=eur&ids="+encodeURIComponent(ids.join(",")));if(!r.ok)throw new Error(r.status);const j=await r.json();let n=0;
    S.bourse.titres.forEach(t=>{const px=j[t.cg]&&+j[t.cg].eur;if(t.type==="crypto"&&px>0){S.bourse.cours[t.id]={prix:px,date:today()};n++}});
    save();if($("sheetBg").classList.contains("open")){const open=S.bourse.titres.find(t=>$("sheet").innerHTML.includes(`data-bop="${t.id}"`));if(open)bourseTitre(open.id)}toast(n?`${n} cours crypto mis à jour ✓`:"Aucun cours trouvé")}
  catch(e){console.warn(e);toast(navigator.onLine?"Service de cours indisponible, réessaie plus tard":"Pas de connexion internet")}}
/* ---------- import d'une capture d'appli de bourse ---------- */
const PROMPT_BOURSE=`Tu lis une capture d'écran (ou PDF) d'une appli de bourse ou de crypto (Trade Republic, Bolero, Revolut, Degiro, eToro, Keytrade, Binance, Bitvavo…) montrant un portefeuille ou une position.
Réponds UNIQUEMENT avec un JSON : {"positions":[{"nom":"nom du titre","ticker":"code/symbole ou null","isin":"ISIN ou null","type":"etf" | "action" | "crypto","quantite":nombre de parts/unités ou null,"prix_moyen":prix d'achat moyen d'UNE part en euros ou null,"investi":montant total investi en euros ou null,"cours":prix actuel d'UNE part en euros ou null,"valeur":valeur actuelle totale de la position en euros ou null}]}
Les ETF / trackers / fonds (iShares, Vanguard, Amundi, Xtrackers, MSCI, S&P 500…) ont le type "etf". Ne compte pas le solde d'espèces ni le total du portefeuille comme une position. Nombres au format JSON (point décimal, sans symbole). Si une valeur n'est pas visible, mets null. N'invente rien.
Si ce n'est pas un portefeuille / une position de bourse : {"erreur":"explication courte"}.`;
const CG_SYM={btc:"bitcoin",eth:"ethereum",sol:"solana",xrp:"ripple",bnb:"binancecoin",ada:"cardano",doge:"dogecoin",usdt:"tether",usdc:"usd-coin",link:"chainlink",dot:"polkadot",ltc:"litecoin"};
let bourseRes=null;
function bourseTrouve(x){const B=S.bourse,lo=v=>nrm(v||"");return B.titres.find(t=>(x.cg&&t.cg===x.cg)||(x.isin&&t.isin&&t.isin===x.isin)||(x.ticker&&t.ticker&&lo(t.ticker)===lo(x.ticker))||lo(t.nom)===lo(x.nom))}
async function scanBourse(f){if(!model){toast("Scan indisponible");return}
  openRaw(`<h3>Lecture de la capture <button class="del" data-close>×</button></h3><div class="est"><span class="spin"></span>Gemini lit tes placements… (10 à 40 s)</div>`);
  const ctl=scanCtl=new AbortController();
  try{const img=await toJpegB64(f);const res=await model.generateContent([PROMPT_BOURSE,{inlineData:img}]);if(scanCtl!==ctl||ctl.signal.aborted)return;scanCtl=null;
    const r=parseJSON(res.response.text());
    if(!r||r.erreur||!Array.isArray(r.positions)||!r.positions.length){openRaw(`<h3>Oups <button class="del" data-close>×</button></h3><div class="est">${esc(r&&r.erreur||"Aucun placement trouvé sur la capture.")}</div>`);return}
    const N=v=>{const n=+String(v??"").replace(",",".");return n>0&&isFinite(n)?n:null};
    bourseRes=r.positions.slice(0,40).map(o=>{const type=["etf","action","crypto"].includes(o.type)?o.type:"action",tk=String(o.ticker||"").trim().toUpperCase().slice(0,15),nom=String(o.nom||tk||"").trim().slice(0,60);
      let q=N(o.quantite),pm=N(o.prix_moyen),inv=N(o.investi),c=N(o.cours),v=N(o.valeur);
      if(!q&&v&&c)q=v/c;if(!q&&inv&&pm)q=inv/pm;if(!c&&v&&q)c=v/q;if(!inv&&pm&&q)inv=pm*q;
      const cg=type==="crypto"?(CG_SYM[tk.toLowerCase()]||(CRYPTOS.find(x=>nrm(x[1]).includes(nrm(nom).split(" ")[0]))||[""])[0]):"";
      const x={nom,ticker:tk,isin:/^[A-Z]{2}[A-Z0-9]{10}$/.test(String(o.isin||"").toUpperCase())?String(o.isin).toUpperCase():"",type,cg,q,inv,c,ok:!!(q&&c&&nom)};x.ex=bourseTrouve(x);return x}).filter(x=>x.nom);
    if(!bourseRes.length){openRaw(`<h3>Oups <button class="del" data-close>×</button></h3><div class="est">Aucun placement lisible.</div>`);return}
    openRaw(`<h3>${bourseRes.length} placement(s) trouvé(s) <button class="del" data-close>×</button></h3><p class="sub">Vérifie puis importe. Un placement déjà suivi est mis à jour (parts et cours), sans doublon.</p>
     <div class="card" style="background:var(--card2);margin-top:10px">${bourseRes.map((x,i)=>{const p=x.ex?boursePos(x.ex):null;
      return `<label class="chk" style="align-items:flex-start;padding:8px 0;border-bottom:1px solid var(--line)"><input type="checkbox" data-bi="${i}" ${x.ok?"checked":"disabled"}><span style="flex:1"><b>${esc(x.nom)}</b>${x.ticker?` <small style="color:var(--mut)">${esc(x.ticker)}</small>`:""}<br>
      <small style="color:var(--mut)">${BTYPES[x.type]} · ${x.q?qFmt(x.q)+" part(s)":"parts ?"} · cours ${x.c?eurT(x.c):"?"}${x.inv?" · investi "+eur2(x.inv):" · prix d'achat inconnu"}</small><br>
      <small>${!x.ok?'<span style="color:var(--out)">Parts ou cours illisibles : pas importé</span>':x.ex?`🔄 mise à jour de ${esc(x.ex.nom)} (${qFmt(p.q)} → ${qFmt(x.q)} parts)`:"➕ nouveau placement"} · valeur <b>${x.q&&x.c?eur2(x.q*x.c):"?"}</b></small></span></label>`}).join("")}</div>
     ${bourseRes.some(x=>x.ok&&!x.inv&&!x.ex)?`<p class="sub" style="margin-top:8px">⚠️ Sans prix d'achat sur la capture, je prends la valeur actuelle comme montant investi (gain de départ = 0 €).</p>`:""}
     <button type="button" class="btn" data-bimport="1" style="margin-top:12px;width:100%">Importer</button>`);
  }catch(e){if(scanCtl!==ctl||ctl.signal.aborted)return;scanCtl=null;console.error(e);openRaw(`<h3>Lecture impossible <button class="del" data-close>×</button></h3><div class="est">${esc(aiErr(e))}</div>`)}}
// aligne chaque placement sur la capture : on ajoute un achat ou une vente pour arriver au bon nombre de parts, puis on met le cours du jour
function bourseImport(){if(!bourseRes)return;const B=S.bourse,t0=today();let n=0;
  document.querySelectorAll("#sheet [data-bi]").forEach(cb=>{if(!cb.checked)return;const x=bourseRes[+cb.dataset.bi];if(!x||!x.ok)return;
    let t=bourseTrouve(x);if(!t){t={id:uid(),nom:x.nom,ticker:x.ticker,isin:x.isin,type:x.type,cg:x.cg};B.titres.push(t)}else{if(x.isin&&!t.isin)t.isin=x.isin;if(x.ticker&&!t.ticker)t.ticker=x.ticker}
    const p=boursePos(t),dq=x.q-p.q;
    if(dq>1e-9){const cible=x.inv!=null?x.inv:p.cout+dq*x.c,ajout=cible-p.cout,px=ajout>0?ajout/dq:x.c;B.ops.push({id:uid(),titre:t.id,date:t0,sens:"achat",qte:Math.round(dq*1e8)/1e8,prix:Math.round(px*1e6)/1e6,frais:0,source:"capture"})}
    else if(dq<-1e-9)B.ops.push({id:uid(),titre:t.id,date:t0,sens:"vente",qte:Math.round(-dq*1e8)/1e8,prix:Math.round(x.c*1e6)/1e6,frais:0,source:"capture"});
    B.cours[t.id]={prix:Math.round(x.c*1e6)/1e6,date:t0};n++});
  bourseRes=null;closeSheet();save();toast(n?`${n} placement(s) importé(s) ✓`:"Rien d'importé")}
/* ---------- détail des chiffres de l'accueil (touche une carte) ---------- */
function openStat(kind,c){
  const k=mkey(cur),M=monthData(k),mois=cur.toLocaleDateString("fr-BE",{month:"long",year:"numeric"});
  const lieF=x=>x.fixe&&S.fixes.some(f=>f.id===x.fixe);
  const pRow=p=>{const m=S.missions.find(x=>x.id===p.mission);return row("paie:"+p.id,`<b>${p.photo?"🖼️ ":p.detail?"📄 ":""}${esc(m?(m.client||m.agence):(p.note||(p.autre?"Rentrée":"Paie")))}${p.recu?"":`<span class="pill y">à recevoir</span>`}</b><small>${fmtD(p.date)}${p.heures?" · "+fmtN(p.heures)+" h":""}${p.note&&m?" · "+esc(p.note):""}</small>`,`<span class="amt ${p.recu?"pos":"pend"}">+${eur2(p.montant)}</span>`,{i:p.autre?"💰":"💶",c:"pay"})};
  const dRow=d=>row("depense:"+d.id,`<b>${d.photo?"🖼️ ":d.detail?"🧾 ":""}${esc(d.note||d.cat)}${d.paye===false?`<span class="pill ${d.echeance&&d.echeance<today()?"r":"y"}">à payer${d.echeance?" · "+fmtD(d.echeance):""}</span>`:""}</b><small>${fmtD(d.date)} · ${esc(d.cat)}</small>`,`<span class="amt ${d.paye===false?"pend":"out"}">−${eur2(d.montant)}</span>`,catIc(d.cat));
  const fRow=f=>{const nonPaye=M.all.some(x=>x.fixe===f.id&&x.paye===false);return row("fixe:"+f.id,`<b>${esc(f.nom)}${nonPaye?'<span class="pill y">à payer</span>':""}</b><small>charge fixe${f.jour?" · le "+esc(f.jour)+" du mois":""}</small>`,`<span class="amt ${nonPaye?"pend":"out"}">−${eur2(f.montant)}</span>`,"🔁")};
  const bloc=(t,tot,html,vide_)=>`<div class="day" style="margin-top:14px;text-transform:none"><span>${t}</span><span>${tot}</span></div><div class="card" style="background:var(--card2)">${html||`<div class="empty">${vide_}</div>`}</div>`;
  const ln=(a,b,cl="")=>`<div class="ln"><span>${a}</span><b class="${cl}" style="text-align:right">${b}</b></div>`;
  const byDate=(a,b)=>(b.date||"").localeCompare(a.date||"");
  let h="";
  if(kind==="recu"){const R=M.p.filter(p=>p.recu).sort(byDate),A=M.p.filter(p=>!p.recu).sort(byDate);
    h=`<h3>Reçu en ${mois}</h3><p class="sub">Paies et autres rentrées du mois. Touche une ligne pour la modifier.</p>`
     +bloc("✅ Déjà reçu",eur2(M.recu),R.map(pRow).join(""),"Rien de reçu ce mois-ci.")
     +bloc("⏳ À recevoir",eur2(M.att),A.map(pRow).join(""),"Rien en attente.")
     +(M.arch?`<p class="sub" style="margin-top:10px">📚 ${eur2(M.arch)} de fiches « historique » ne sont pas comptées.</p>`:"")}
  else if(kind==="dep"){const V=M.d.filter(d=>d.paye!==false).sort(byDate),AP=M.all.filter(d=>d.paye===false).sort(byDate),cc={};
    V.forEach(d=>cc[d.cat]=(cc[d.cat]||0)+(+d.montant||0));
    const fixPaye=M.fix-S.fixes.filter(f=>M.all.some(x=>x.fixe===f.id&&x.paye===false)).reduce((a,f)=>a+(+f.montant||0),0);
    h=`<h3>Dépensé en ${mois}</h3><p class="sub">Ce qui est déjà sorti de ton compte, puis ce qui reste à payer.</p>`
     +bloc("🔁 Charges fixes",eur2(fixPaye)+" payé",S.fixes.map(fRow).join(""),"Aucune charge fixe.")
     +bloc("💸 Dépenses payées",eur2(sum(V,d=>d.montant)),(Object.keys(cc).length>1?`<div style="padding:4px 0 8px">${Object.entries(cc).sort((a,b)=>b[1]-a[1]).map(([n,v])=>ln(catIc(n)+" "+esc(n),eur2(v))).join("")}</div>`:"")+V.map(dRow).join(""),"Aucune dépense payée.")
     +bloc("🧾 À payer",eur2(M.aPayer),AP.map(dRow).join(""),"Aucune facture en attente.")}
  else if(kind==="reste"){const reste=M.recu-M.depPaye,prevu=reste+M.att-M.aPayer;
    h=`<h3>Reste à vivre · ${mois}</h3><div class="card" style="background:var(--card2);margin-top:10px">`
     +ln("Reçu",`+${eur2(M.recu)}`,"pos")+ln("Dépensé (payé)",`−${eur2(M.depPaye)}`,"out")+`<div style="border-top:1px solid var(--line);margin:6px 0"></div>`+ln("<b>Reste à vivre</b>",eur2(reste),reste<0?"out":"pos")
     +(M.att||M.aPayer?ln("À recevoir",`+${eur2(M.att)}`,"pos")+ln("À payer",`−${eur2(M.aPayer)}`,"out")+`<div style="border-top:1px solid var(--line);margin:6px 0"></div>`+ln("<b>Une fois tout reçu et payé</b>",eur2(prevu),prevu<0?"out":"pos"):"")+`</div>
     <div class="two" style="margin-top:12px"><button type="button" class="btn sec" data-stat="recu">💶 Voir le reçu</button><button type="button" class="btn sec" data-stat="dep">💸 Voir le dépensé</button></div>`}
  else if(kind==="week"){const t=today(),d7=new Date();d7.setDate(d7.getDate()-6);const a7=iso(d7);
    const W=S.depenses.filter(x=>x.date>=a7&&x.date<=t&&!lieF(x)).sort(byDate),P=S.paies.filter(p=>p.date>=a7&&p.date<=t&&!p.archive).sort(byDate);
    h=`<h3>Tes 7 derniers jours</h3><p class="sub">Du ${fmtD(a7)} à aujourd'hui.</p>`+bloc("💶 Reçu",eur2(sum(P,p=>p.montant)),P.map(pRow).join(""),"Rien reçu cette semaine.")+bloc("💸 Dépensé",eur2(sum(W,d=>d.montant)),W.map(dRow).join(""),"Aucune dépense cette semaine.")}
  else if(kind==="cat"){const L=M.d.filter(d=>d.cat===c||(c==="Autres"&&!0)).sort(byDate);
    const top5=(()=>{const o={};M.d.forEach(x=>o[x.cat]=(o[x.cat]||0)+(+x.montant||0));return Object.entries(o).sort((a,b)=>b[1]-a[1]).slice(0,5).map(x=>x[0])})();
    const LL=c==="Autres"?M.d.filter(d=>!top5.includes(d.cat)).sort(byDate):M.d.filter(d=>d.cat===c).sort(byDate);
    h=`<h3>${catIc(c)} ${esc(c)} · ${mois}</h3>`+bloc(`${LL.length} dépense(s)`,eur2(sum(LL,d=>d.montant)),LL.map(dRow).join(""),"Aucune dépense.")}
  openRaw(h.replace(/^<h3>(.*?)<\/h3>/,`<h3>$1 <button class="del" type="button" data-close>×</button></h3>`))}
function openRaw(h){$("sheet").innerHTML=h;$("sheetBg").classList.add("open")}

/* ---------- scan fiche de paie ---------- */
let model=null, textModel=null, canImg=false, scanCtl=null, scanRes=null;
function initAI(){
  try{
    if(recaptchaV3SiteKey)initializeAppCheck(app,{provider:new ReCaptchaV3Provider(recaptchaV3SiteKey),isTokenAutoRefreshEnabled:true});
    else if(recaptchaEnterpriseSiteKey)initializeAppCheck(app,{provider:new ReCaptchaEnterpriseProvider(recaptchaEnterpriseSiteKey),isTokenAutoRefreshEnabled:true});
    const ai=getAI(app,{backend:new GoogleAIBackend()});
    // Chaîne de modèles : bascule automatique si quota épuisé (429) ou modèle retiré (404)
    const noms=[geminiModel,...geminiFallbacks.filter(n=>n&&n!==geminiModel)];
    const mk=json=>noms.map(n=>({n,m:getGenerativeModel(ai,{model:n,generationConfig:json?{responseMimeType:"application/json",temperature:0}:{temperature:0.4}})}));
    const chaines={json:mk(true),text:mk(false)};
    const gen=async(parts,kind)=>{const ep=LS.get("aiEpuise",{}),jour=new Date().toISOString().slice(0,10);let last;
      for(const {n,m} of chaines[kind]){if(ep[n]===jour)continue;
        try{const r=await m.generateContent(parts);if(n!==noms[0]&&!window.__aiNote){window.__aiNote=1;toast("Quota du jour atteint : j'utilise un modèle plus léger ⚡")}LS.set("aiModele",n);return r}
        catch(e){last=e;const s=(String(e&&e.code||"")+" "+String(e&&e.message||e)).toLowerCase();
          if(/429|quota|resource.?exhausted|rate.?limit|resource has been exhausted/.test(s)){ep[n]=jour;LS.set("aiEpuise",ep);continue}
          if(/404|not.?found|no longer available|not supported/.test(s)&&/model/.test(s))continue;
          throw e}}
      throw last||new Error("quota")};
    model={generateContent:p=>gen(p,"json")};textModel={generateContent:p=>gen(p,"text")};
    canImg=true;
  }catch(e){console.warn("IA indisponible",e);canImg=false}
  document.querySelectorAll(".scanBtn").forEach(b=>b.hidden=!canImg);$("bHisto").hidden=!canImg;
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
  if(m.includes("app check")||m.includes("appcheck")||m.includes("recaptcha"))return (recaptchaV3SiteKey||recaptchaEnterpriseSiteKey)?(recaptchaEnterpriseSiteKey?"App Check refuse l'appli : dans Firebase → App Check → Applications, enregistre l'appli avec « Fraud Defense (reCAPTCHA Enterprise) » et la clé "+recaptchaEnterpriseSiteKey.slice(0,10)+"…, puis attends 5 minutes.":"App Check refuse l'appli : vérifie la clé secrète reCAPTCHA dans Firebase → App Check, et que le domaine jasony28.github.io est autorisé."):"Scan bloqué par App Check : il manque la clé reCAPTCHA dans l'appli (voir README).";
  if(m.includes("429")||m.includes("quota")||m.includes("resource exhausted")||m.includes("resource_exhausted")||m.includes("resource has been exhausted"))return "Quota gratuit de Gemini épuisé pour aujourd'hui sur tous les modèles. Il revient vers 9 h (minuit heure de Californie). Pour ne plus être bloqué : Réglages → « Gemini : plus de quota ».";
  if(m.includes("api has not been used")||m.includes("not enabled")||m.includes("permission"))return "Firebase AI Logic n'est pas activé sur ton projet (voir README).";
  if(m.includes("not found")&&m.includes("model"))return "Aucun modèle Gemini disponible : il faut mettre à jour la liste dans firebase-config.js.";
  if(!navigator.onLine||m.includes("network")||m.includes("fetch"))return "Pas de connexion internet.";
  return "Lecture impossible, réessaie avec une photo plus nette.";}
// heures payées = total du calendrier de la fiche s'il est plus grand (ex. jour de récup payé oublié par la lecture)
function heuresPayees(r){const hj=(r.jours||[]).reduce((a,j)=>a+(+j.heures||0),0);if(hj>(+r.heures||0)+0.25)r.heures=Math.round(hj*100)/100;return r}
const PROMPT=`Tu lis la photo ou capture d'écran d'une fiche de paie d'un travailleur intérimaire (probablement en Belgique ou en France).
Extrais les informations et réponds UNIQUEMENT avec un objet JSON de cette forme :
{"agence":"nom de l'agence d'intérim ou employeur","client":"entreprise utilisatrice / lieu de mission ou null","periode_debut":"YYYY-MM-DD ou null","periode_fin":"YYYY-MM-DD ou null","date_paiement":"YYYY-MM-DD ou null","date_etablissement":"YYYY-MM-DD date où la fiche a été établie / éditée ou null","heures":nombre TOTAL d'heures payées sur la fiche ou null (heures prestées + heures de récupération payées + jours fériés / petits chômages / congés payés en heures ; ex. 31 h prestées + 8 h de récup payées = 39),"taux_horaire_brut":nombre ou null,"brut":salaire brut total ou null,"net":montant net à payer / viré sur le compte ou null,
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
   <div class="card" style="background:var(--card2)"><div class="k">Heures · taux</div><div class="v" style="font-size:17px">${d.heures!=null?fmtN(d.heures):"—"} h${d.taux_horaire_brut?" · "+eurT(d.taux_horaire_brut):""}</div></div></div>
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
    ["agence","client","periode_debut","periode_fin","date_paiement","date_etablissement","avantages","resume"].forEach(k=>{r[k]=r[k]==null?null:String(r[k]).slice(0,400)});
    ["periode_debut","periode_fin","date_paiement","date_etablissement"].forEach(k=>{if(r[k]&&!/^\d{4}-\d{2}-\d{2}$/.test(r[k]))r[k]=null});
    r.jours=Array.isArray(r.jours)?r.jours.filter(j=>/^\d{4}-\d{2}-\d{2}$/.test(j.date)&&+j.heures>0).slice(0,31).map(j=>({date:j.date,heures:+j.heures})):[];
    heuresPayees(r);
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
    corrigeAnneeFact(r);
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
    <label>Catégorie</label><div class="chips" id="catChips">${cats().map(c=>`<button type="button" class="${r.categorie===c?"on":""}" data-cat="${esc(c)}">${esc(c)}</button>`).join("")}</div>
    <input type="hidden" name="cat" id="catIn" value="${esc(r.categorie)}">
    <label>Note<input name="note" value="${esc(r.fournisseur||"")}"></label>
    <label class="chk"><input type="checkbox" name="paye" ${r.deja_paye||!r.echeance?"checked":""}> Déjà payée</label>
    <label>Échéance (si pas encore payée)<input name="echeance" type="date" value="${esc(r.echeance||"")}"></label>
    ${r.recurrent&&!dejaFixe&&mens?`<label class="chk"><input type="checkbox" name="fixe" checked> Ajouter « ${esc(r.fournisseur||"cette facture")} » aux charges fixes (${eur2(mens)}/mois${per>1?", "+r.periodicite+" ÷ "+per:""})</label>`:""}
    ${r.recurrent&&dejaFixe?`<p class="sub">Déjà dans tes charges fixes : « ${esc(dejaFixe.nom)} » (${eur2(dejaFixe.montant)}/mois).</p>`:""}
    <button class="btn">Enregistrer la dépense</button></form>`);
}

/* ---------- contrôle de fiche de paie ---------- */
function controlePaie(r,m,pid){ // renvoie [{s:"ok"|"warn"|"bad"|"info",t,d}]
  const I=[],L=r.lignes||[],J=Array.isArray(r.jours)?r.jours:[],has=re=>L.find(l=>re.test(nrm(l.libelle||"")));
  const ct=(m&&m.contrat)||{},add=(s,t,d)=>I.push({s,t,d:d||""});
  // taux horaire
  const tPrev=+(m&&m.taux)||+ct.taux_horaire_brut||0;
  if(r.taux_horaire_brut&&tPrev){if(Math.abs(tPrev-r.taux_horaire_brut)>0.005)add(r.taux_horaire_brut<tPrev?"bad":"info","Taux horaire",`${eurT(r.taux_horaire_brut)} sur la fiche, ${eurT(tPrev)} prévu${m&&m.contrat?" dans ton contrat":" pour la mission"}.`);else add("ok","Taux horaire",`${eurT(tPrev)} brut, comme prévu.`)}
  // heures payées vs pointées
  if(r.periode_debut&&r.periode_fin&&r.heures){const pt=S.pointage.filter(x=>x.date>=r.periode_debut&&x.date<=r.periode_fin&&(!m||!x.mission||x.mission===m.id));
    if(pt.length){const hp=sum(pt,x=>x.heures);
      if(hp-r.heures>0.25)add("bad","Heures payées",`Tu as pointé ${fmtN(hp)} h mais ${fmtN(r.heures)} h sont payées : il manque ${fmtN(hp-r.heures)} h (≈ ${eur2((hp-r.heures)*(r.taux_horaire_brut||tPrev||0))} brut).`);
      else if(r.heures-hp>0.25)add("info","Heures payées",`${fmtN(r.heures)} h payées pour ${fmtN(hp)} h pointées : ton pointage est peut-être incomplet.`);
      else add("ok","Heures payées",`${fmtN(r.heures)} h, comme ton pointage.`)}
    else add("info","Heures payées",`${fmtN(r.heures)} h payées. Pointe tes heures (Outils → Pointage) pour que je puisse les comparer.`)}
  if(J.length&&r.heures){const hj=sum(J,j=>j.heures);if(Math.abs(hj-r.heures)>0.25)add("warn","Détail des jours",`Les jours détaillés font ${fmtN(hj)} h, mais ${fmtN(r.heures)} h sont payées.`)}
  // calcul heures × taux
  if(r.heures&&r.taux_horaire_brut){const gl=L.filter(l=>l.type==="gain"&&/heure|presta|prest|uren|recup|salaire de base|ferie/.test(nrm(l.libelle||""))&&!/sursal|majoration|supplement|prime/.test(nrm(l.libelle||"")));const g=gl.length?{montant:sum(gl,l=>l.montant)}:null;
    if(g){const att=r.heures*r.taux_horaire_brut;if(Math.abs(g.montant-att)>1)add(g.montant<att?"bad":"info","Calcul du salaire",`${fmtN(r.heures)} h × ${eurT(r.taux_horaire_brut)} = ${eur2(att)}, mais la fiche indique ${eur2(g.montant)}${gl.length>1?" ("+gl.map(l=>l.libelle).join(" + ")+")":""}.`);else add("ok","Calcul du salaire",`${fmtN(r.heures)} h × ${eurT(r.taux_horaire_brut)} = ${eur2(att)}.`)}}
  // heures sup
  if(r.heures&&r.periode_debut&&r.periode_fin){const sem=Math.max(1,Math.round((new Date(r.periode_fin)-new Date(r.periode_debut))/864e5+1)/7);const lourd=r.heures/sem>40.5||J.some(j=>+j.heures>9.5);
    if(lourd&&!has(/sursal|suppl|overtime|majoration|\b150\b|50 ?%|heures sup/))add("warn","Heures supplémentaires",`Plus de 40 h par semaine (ou plus de 9 h 30 sur un jour) mais aucun sursalaire visible. Les heures sup sont normalement payées +50 %.`)}
  // ONSS
  const on=L.find(l=>l.type==="retenue"&&/onss|rsz|cotis.*(soc|pers)|securite sociale|sec\.? ?soc/.test(nrm(l.libelle||"")));
  if(on&&r.brut){const ouv=(S.reglages.statut||"ouvrier")==="ouvrier",v=verifOnss(on.montant,r.brut,ouv),att=v.attendu;
    if(v.etat==="haut")add("warn","Cotisations ONSS",`${eur2(on.montant)} retenus, c'est plus que les 13,07 % habituels (≈ ${eur2(att)}${ouv?" pour un ouvrier, sur 108 % du brut":""}).`);
    else if(v.etat==="bas")add("ok","Cotisations ONSS",`${eur2(on.montant)} : moins que 13,07 %, c'est sûrement le bonus à l'emploi (réduction pour les petits salaires), tant mieux pour toi.`);
    else add("ok","Cotisations ONSS",`${eur2(on.montant)} ≈ 13,07 %${ouv?" de 108 % du brut":" du brut"}.`)}
  // net / brut
  if(r.brut&&r.net){const q=r.net/r.brut;if(q<0.6||q>1.05)add("warn","Net par rapport au brut",`Le net fait ${Math.round(q*100)} % du brut : inhabituel, vérifie les retenues.`)}
  // chèques-repas
  const jours=J.length||(r.periode_debut&&r.periode_fin?new Set(S.pointage.filter(x=>x.date>=r.periode_debut&&x.date<=r.periode_fin&&+x.heures>0).map(x=>x.date)).size:0);
  const crPrevu=!!ct.cheque_repas_valeur||S.paies.some(p=>p.id!==pid&&p.mission&&m&&p.mission===m.id&&p.detail&&p.detail.cheques_repas_nombre);
  const ncr=+r.cheques_repas_nombre||0;
  if(ncr&&jours){if(ncr<jours)add("bad","Chèques-repas",`${ncr} chèque(s) pour ${jours} jour(s) prestés : il en manquerait ${jours-ncr} (1 par jour travaillé).`);else add("ok","Chèques-repas",`${ncr} chèque(s) pour ${jours} jour(s) prestés.`)}
  else if(!ncr&&crPrevu)add("bad","Chèques-repas",`Aucun chèque-repas sur cette fiche alors que ${ct.cheque_repas_valeur?"ton contrat en prévoit ("+eur2(ct.cheque_repas_valeur)+")":"tu en reçois d'habitude"}.`);
  else if(ncr)add("ok","Chèques-repas",`${ncr} chèque(s)-repas.`);
  // primes du contrat
  (Array.isArray(ct.primes)?ct.primes:[]).forEach(p=>{const mot=nrm(p.libelle||"").split(/[^a-z]+/).filter(w=>w.length>=5&&!/prime|indemn|sursal/.test(w))[0];if(!mot)return;
    if(!has(new RegExp(mot)))add("warn","Prime du contrat",`« ${p.libelle} » (${p.valeur||"prévue"}) n'apparaît pas sur la fiche.`);else add("ok","Prime du contrat",`« ${p.libelle} » est bien payée.`)});
  // déplacement
  const dpl=has(/mobil|deplac|transport|km|navette|vervoer|trajet/);
  if(dpl)add("ok","Frais de déplacement",`${dpl.libelle} : ${eur2(dpl.montant)}.`);
  else if(ct.deplacement)add("warn","Frais de déplacement",`Ton contrat prévoit : ${ct.deplacement}. Rien n'apparaît sur la fiche.`);
  else if(m&&(+m.km>0||S.reglages.domicile))add("info","Frais de déplacement",`Aucune intervention dans tes trajets. Selon le secteur, tu peux y avoir droit : demande à ton agence.`);
  // période dans la mission
  if(m&&r.periode_debut&&((m.debut&&r.periode_fin<m.debut)||(m.fin&&r.periode_debut>m.fin)))add("info","Période",`La période (${fmtD(r.periode_debut)} → ${fmtD(r.periode_fin)}) est en dehors des dates de la mission.`);
  // net reçu sur le compte
  const dp=r.date_paiement||r.periode_fin;
  if(r.net&&dp){const ag=m&&m.agence?nrm(m.agence).split(/[ .]/)[0]:"";const b=S.paies.find(p=>p.id!==pid&&!p.detail&&!p.autre&&p.recu&&Math.abs(new Date(p.date)-new Date(dp))<=10*864e5&&(!ag||nrm(p.note||"").includes(ag)||p.mission===(m&&m.id)));
    if(b){if(Math.abs(b.montant-r.net)>0.5)add("bad","Montant reçu",`Sur ton compte : ${eur2(b.montant)} le ${fmtD(b.date)}, mais la fiche annonce ${eur2(r.net)} net (écart ${eur2(r.net-b.montant)}).`);else add("ok","Montant reçu",`${eur2(b.montant)} bien arrivé sur ton compte.`)}}
  return I;
}
const ctrlBilan=I=>({bad:I.filter(x=>x.s==="bad").length,warn:I.filter(x=>x.s==="warn").length,ok:I.filter(x=>x.s==="ok").length});
function ctrlHTML(I,pid){if(!I.length)return "";const B=ctrlBilan(I),pb=B.bad+B.warn,IC={ok:"✅",warn:"⚠️",bad:"❌",info:"ℹ️"},ord={bad:0,warn:1,info:2,ok:3};
  return `<div class="card ctrl ${B.bad?"bad":B.warn?"warn":"ok"}"><div class="ctrl-h"><span>${B.bad?"❌":B.warn?"⚠️":"✅"}</span><div><b>${pb?pb+" point"+(pb>1?"s":"")+" à vérifier":"Fiche correcte"}</b><small>${B.ok} contrôle${B.ok>1?"s":""} OK sur ${I.length}</small></div></div>
  ${[...I].sort((x,y)=>ord[x.s]-ord[y.s]).map(x=>`<div class="ctrl-i ${x.s}"><span>${IC[x.s]}</span><div><b>${esc(x.t)}</b><small>${esc(x.d)}</small></div></div>`).join("")}
  ${pb?`<div class="two" style="margin-top:12px"><button type="button" class="btn sm" data-agmsg="${pid||"__scan"}">✉️ Écrire à l'agence</button>${pid?`<button type="button" class="btn sec sm" data-ctrlvu="${pid}">✓ C'est réglé</button>`:""}</div>`:""}</div>`}
const jeDis=s=>s.replace(/\bTu as\b/g,"J'ai").replace(/\btu as\b/g,"j'ai").replace(/\bton (compte|contrat|pointage)\b/gi,(_,w)=>"mon "+w).replace(/\btu en reçois\b/g,"j'en reçois").replace(/\bTon\b/g,"Mon").replace(/\btes\b/g,"mes").replace(/\btu\b/g,"je");
function msgAgence(r,m,I){const pb=I.filter(x=>x.s==="bad"||x.s==="warn");
  const per=r.periode_debut&&r.periode_fin?` du ${new Date(r.periode_debut+"T12:00").toLocaleDateString("fr-BE")} au ${new Date(r.periode_fin+"T12:00").toLocaleDateString("fr-BE")}`:"";
  return `Bonjour,\n\nJ'ai vérifié ma fiche de paie${per}${m?` (mission ${m.client||m.agence})`:""} et certains points me posent question :\n\n${pb.map(x=>"• "+x.t+" : "+jeDis(x.d)).join("\n")}\n\nPourriez-vous vérifier et me tenir au courant ? Merci d'avance.\n\nBonne journée`}
let scanCtrl=null;
function showScan(r){
  const match=missionPourFiche(r);
  const anCorr=corrigeAnnee(r);
  // une fiche de régularisation (période ancienne, établie récemment) est payée vers sa date d'établissement, pas à la fin de la période
  const etab=/^\d{4}-\d{2}-\d{2}$/.test(r.date_etablissement||"")&&r.date_etablissement<=today()?r.date_etablissement:null;
  const date=r.date_paiement||(etab&&(!r.periode_fin||etab>r.periode_fin)?etab:r.periode_fin)||today();const vieille=date<mkey(new Date())+"-01";
  // on ne propose de créer une mission que pour une fiche avec des heures, sur une période récente
  const recente=!r.periode_fin||(new Date()-new Date(r.periode_fin+"T12:00"))/864e5<=45, nouvMis=!!(r.agence&&!match&&+r.heures>0&&recente);
  const ratio=r.brut&&r.net?Math.round(r.net/r.brut*100):null;
  const W=[];const CI=controlePaie(r,match);scanCtrl={r,m:match,I:CI};
  const newDays=r.jours.filter(j=>!S.pointage.some(x=>x.date===j.date));
  const exP=r.net?S.paies.find(p=>memePaie(p,date,r.net)):null;
  if(anCorr)W.push(`📅 L'année lue sur la fiche semblait fausse (${anCorr}) : je l'ai corrigée en ${new Date().getFullYear()}. Vérifie la date ci-dessous.`);
  if(date.slice(0,7)!==mkey(new Date()))W.push(`📅 Cette paie sera rangée en <b>${new Date(date+"T12:00").toLocaleDateString("fr-BE",{month:"long",year:"numeric"})}</b>${vieille?" comme ancienne fiche":""}. Si elle est de ce mois-ci, change la date ci-dessous.`);
  if(exP&&exP.detail)W.unshift(`🔁 Cette fiche semble <b>déjà enregistrée</b> (${eur2(exP.montant)} le ${fmtD(exP.date)}). L'enregistrer créerait un doublon.`);
  const ctrl=(W.length?`<div class="warnbox">${W.join("<br>")}</div>`:"")+ctrlHTML(CI);
  openRaw(`<h3>Ta fiche de paie <button class="del" data-close>×</button></h3>${ctrl}${detailHTML(r)}
   <form data-f="scan" style="margin-top:16px;border-top:1px solid var(--line);padding-top:14px">
    <div class="two"><label>Net à enregistrer (€)<input name="montant" type="number" step="0.01" inputmode="decimal" required value="${r.net??""}"></label><label>Date<input name="date" type="date" required value="${esc(date)}"></label></div>
    <label>Mission<select name="mission"><option value="">— Aucune —</option>${r.agence&&!match?`<option value="__new" ${nouvMis?"selected":""}>➕ Créer « ${esc(r.agence)}${r.client?" · "+esc(r.client):""} »</option>`:""}${S.missions.map(m=>`<option value="${m.id}" ${match&&match.id===m.id?"selected":""}>${esc(m.client||m.agence)}</option>`).join("")}</select></label>
    <label class="chk"><input type="checkbox" name="recu" ${date>today()?"":"checked"}> Déjà reçue sur mon compte <small style="color:var(--mut)">(décoche si pas encore touchée : elle sera « à recevoir »)</small></label>
    <label class="chk"><input type="checkbox" name="archive" ${vieille?"checked":""}> 📚 Ancienne fiche : historique seulement (ne compte pas comme argent disponible)</label>
    ${newDays.length?`<label class="chk"><input type="checkbox" name="pointer" checked> Ajouter ${newDays.length} jour(s) au pointage (${fmtN(sum(newDays,j=>j.heures))} h)</label>`:""}
    ${r.cheques_repas_nombre?`<label class="chk"><input type="checkbox" name="crAdd" checked> Ajouter ${r.cheques_repas_nombre} chèque(s)-repas${r.cheques_repas_valeur?" de "+eur2(r.cheques_repas_valeur):""}</label>`:""}
    ${ratio&&ratio>30&&ratio<100?`<label class="chk"><input type="checkbox" name="ratio" ${Math.abs(ratio-S.reglages.ratio)>=2?"checked":""}> Utiliser ce ratio net/brut (${ratio} %) pour mes estimations</label>`:""}
    <button class="btn">Enregistrer la paie</button></form>`);
}

document.addEventListener("submit",e=>{
  e.preventDefault();const f=e.target;
  if(f.id==="fFisc"){saveSituation(f);return}
  if(f.id==="fBourseOp"){bourseSaveOp(f);return}
  if(f.id==="fBourseCours"){bourseSaveCours(f);return}
  if(f.id==="fSet"){const R=S.reglages;R.epargne=+$("sEpargne").value||0;R.pct=+$("sPct").value||0;R.mois=+$("sMois").value||1;R.ratio=+$("sRatio").value||78;R.statut=$("sStatut").value;R.domicile=$("sDomicile").value.trim();R.conso=+$("sConso").value||6.5;R.carbu=+$("sCarbu").value||1.8;save();toast("Réglages enregistrés");return}
  const d=Object.fromEntries(new FormData(f));d.id=uid();
  const t=f.dataset.f;
  if(t==="scan"&&scanRes){const r=scanRes;let mid=d.mission;
    if(mid==="__new"){mid=uid();S.missions.push({id:mid,agence:r.agence||"Agence",client:r.client||"",debut:r.periode_debut||d.date,fin:r.periode_fin&&r.periode_fin<today()?r.periode_fin:"",taux:r.taux_horaire_brut||0})}
    else if(mid){const m=S.missions.find(x=>x.id===mid);if(m&&!m.taux&&r.taux_horaire_brut)m.taux=r.taux_horaire_brut}
    if(f.ratio&&f.ratio.checked&&r.brut&&r.net)S.reglages.ratio=Math.round(r.net/r.brut*100);
    if(f.pointer&&f.pointer.checked)r.jours.filter(j=>!S.pointage.some(x=>x.date===j.date)).forEach(j=>S.pointage.push({id:uid(),mission:mid||"",date:j.date,heures:j.heures,type:"normal"}));
    if(f.crAdd&&f.crAdd.checked)S.cr.push({id:uid(),date:d.date,nb:r.cheques_repas_nombre,valeur:r.cheques_repas_valeur||((S.missions.find(x=>x.id===mid)||{}).contrat||{}).cheque_repas_valeur||8,used:0});
    {const exB=S.paies.find(p=>!p.detail&&memePaie(p,d.date,d.montant));if(exB){S.paies=S.paies.filter(p=>p.id!==exB.id);if(exB.archive)f.archive&&(f.archive.checked=true)}} // remplace le virement bancaire importé
    S.paies.push({id:d.id,mission:mid||"",date:d.date,montant:+d.montant,recu:!!f.recu.checked,archive:!!(f.archive&&f.archive.checked),heures:r.heures||"",note:r.periode_debut?`du ${fmtD(r.periode_debut)} au ${fmtD(r.periode_fin)}`:"",detail:r});
    if(lastFile){const pid=d.id,file=lastFile;lastFile=null;savePhoto(file).then(ph=>{const p=S.paies.find(x=>x.id===pid);if(ph&&p){p.photo=ph;save()}})}
    const dt=new Date(d.date+"T12:00");cur=new Date(dt.getFullYear(),dt.getMonth(),1);
    scanRes=null;closeSheet();save();toast(f.archive&&f.archive.checked?"Ajoutée à l'historique 📚 (hors budget)":S.reglages.pct?`Paie ajoutée · épargne ${eur(+d.montant*S.reglages.pct/100)}`:"Paie ajoutée");return}
  if(t==="facture"&&factRes){const r=factRes;
    const dep={id:d.id,montant:+d.montant,cat:d.cat,date:d.date,note:d.note||"",paye:!!f.paye.checked,echeance:f.paye.checked?"":(d.echeance||""),detail:r};
    S.depenses.push(dep);
    if(lastFile){const file=lastFile;lastFile=null;savePhoto(file).then(ph=>{const x=S.depenses.find(x=>x.id===dep.id);if(ph&&x){x.photo=ph;save()}})}
    if(f.fixe&&f.fixe.checked){const per=PER[r.periodicite]||1,fid=uid();S.fixes.push({id:fid,nom:r.fournisseur||d.note||"Facture",montant:Math.round(+d.montant/per*100)/100,jour:""});dep.fixe=fid}
    else{const fx=S.fixes.find(x=>r.recurrent&&r.fournisseur&&x.nom.toLowerCase().includes(r.fournisseur.toLowerCase().split(" ")[0]));if(fx)dep.fixe=fx.id;else autoLink(dep)}
    const dt=new Date(d.date+"T12:00");cur=new Date(dt.getFullYear(),dt.getMonth(),1);
    factRes=null;closeSheet();save();toast(dep.paye?"Dépense ajoutée ✓":"Ajoutée · à payer avant le "+fmtD(dep.echeance||d.date));return}
  if(t==="contrat"&&contratRes){saveContrat(f,d);return}
  if(t==="f281"&&res281){save281(f,d);return}
  if(t==="histo"&&histoRes.length){saveHisto(f);return}
  if(t==="dups"){nettoyerDoublons(f);return}
  if(t==="multi"&&multiRes.length){let n=0;multiRes.forEach(({r,file},i)=>{if(!f["m"+i]||!f["m"+i].checked)return;const id=uid();
      S.depenses.push({id,montant:r.montant_total,cat:r.categorie,date:r.date,note:r.fournisseur||"",paye:!(r.echeance&&!r.deja_paye),echeance:r.echeance&&!r.deja_paye?r.echeance:"",detail:r});n++;
      savePhoto(file).then(ph=>{const x=S.depenses.find(x=>x.id===id);if(ph&&x){x.photo=ph;save()}})});
    multiRes=[];closeSheet();save();toast(n+" dépense(s) ajoutée(s) ✓");return}
  if(t==="releve"&&releveRes.length){let n=0;releveRes.forEach((o,i)=>{if(!f["o"+i]||!f["o"+i].checked)return;
      if(o.montant<0){const dd={id:uid(),montant:Math.abs(o.montant),cat:o.cat,date:o.date,note:o.libelle,paye:true};autoLink(dd);S.depenses.push(dd)}
      else S.paies.push({id:uid(),mission:(!o.salaire?{}:S.missions.find(mi=>mi.agence&&o.libelle.toLowerCase().includes(mi.agence.toLowerCase().split(/[ .]/)[0]))||{}).id||"",date:o.date,montant:o.montant,recu:true,autre:!o.salaire,archive:!!(f.anciennes&&f.anciennes.checked&&o.date<mkey(new Date())+"-01"),heures:"",note:o.libelle});n++});
    releveRes=[];closeSheet();save();toast(n+" opération(s) importée(s) ✓");return}
  if(t==="budgets"){const B={};cats().forEach(c=>{const v=+d["b_"+c];if(v>0)B[c]=v});S.budgets=B;closeSheet();save();toast("Budgets enregistrés");return}
  if(t==="epargne"){const m=Math.abs(+d.montant||0)*(+f.dataset.sign||1);if(!m)return;
    if(d.target){const o=S.objectifs.find(o=>o.id===d.target);if(o){o.actuel=Math.round(((+o.actuel||0)+m)*100)/100;if(o.actuel>=+o.cible&&m>0)setTimeout(()=>toast("🎉 Objectif « "+o.nom+" » atteint !"),300)}}
    else S.reglages.epargne=Math.round(((+S.reglages.epargne||0)+m)*100)/100;
    S.epargneLog.push({id:d.id,date:d.date,montant:m,target:d.target||"",note:d.note||""});
    if(S.epargneLog.length>400)S.epargneLog=S.epargneLog.slice(-400);
    closeSheet();save();toast(m>0?`+${eur2(m)} mis de côté 💪`:`${eur2(m)} retiré`);return}
  // ajout / modification générique
  const fix={depense:x=>{x.montant=+x.montant;x.paye=!!f.paye.checked;if(x.paye)x.echeance=""},paie:x=>{x.montant=+x.montant;x.recu=!!f.recu.checked;x.autre=!!(f.autre&&f.autre.checked);if(x.autre)x.mission="";x.archive=!!(f.archive&&f.archive.checked);x.heures=x.heures?+x.heures:""},
    mission:x=>{x.taux=x.taux?+x.taux:0;x.hsem=x.hsem?+x.hsem:"";x.km=x.km?+x.km:"";x.min=x.min?+x.min:"";const dep=(x._dep||"").trim();if(dep&&dep!==S.reglages.domicile)S.reglages.domicile=dep;delete x._dep},fixe:x=>{x.montant=+x.montant},objectif:x=>{x.cible=+x.cible;x.actuel=+x.actuel||0},
    pointage:x=>{x.heures=+x.heures;delete x.semaine},cheques:x=>{x.nb=+x.nb;x.valeur=+x.valeur;x.used=+x.used||0},dette:x=>{x.montant=+x.montant;x.regle=!!(f.regle&&f.regle.checked)}};
  if(!fix[t])return;
  if(t==="pointage"&&!f.dataset.id&&f.semaine&&f.semaine.checked){const d0=new Date(d.date+"T12:00");const mon=new Date(d0);mon.setDate(d0.getDate()-((d0.getDay()+6)%7));
    for(let i=0;i<5;i++){const dd=new Date(mon);dd.setDate(mon.getDate()+i);const ds=iso(dd);if(!S.pointage.some(x=>x.date===ds&&x.mission===d.mission))S.pointage.push({id:uid(),mission:d.mission||"",date:ds,heures:+d.heures,type:d.type})}
    closeSheet();save();toast("Semaine pointée ✓");return}
  fix[t](d);
  if(t==="depense"&&!f.dataset.id)autoLink(d);
  const coll=S[COLL[t]], eid=f.dataset.id;
  if(eid){const o=coll.find(x=>x.id===eid);if(o){delete d.id;Object.assign(o,d)}}
  else coll.push(d);
  if(t==="paie"&&!eid&&d.recu&&!d.archive&&S.reglages.pct)setTimeout(()=>toast(`Pense à épargner ${eur(d.montant*S.reglages.pct/100)}`),50);
  if((t==="paie"||t==="depense")&&d.date){const dt=new Date(d.date+"T12:00");cur=new Date(dt.getFullYear(),dt.getMonth(),1)}
  closeSheet();save();toast(eid?"Modifié ✓":"Ajouté ✓");
});

document.addEventListener("change",e=>{const k=e.target.dataset&&e.target.dataset.admin;if(!k)return;if(e.target.checked)S.adminDone[k]=1;else delete S.adminDone[k];save()});
document.addEventListener("click",e=>{
  const b=e.target.closest("button,[data-stat],[data-btitre],[data-toggle],[data-ptoggle],[data-detail],[data-edit],[data-cat],[data-emo],[data-day],[data-dups],[data-fisc]");
  if(e.target===$("sheetBg")){closeSheet();return}
  if(!b)return;
  if(b.classList.contains("scanBtn")){const m=b.dataset.mode||"paie";const T={facture:"Scanner une facture / un ticket",contrat:"Scanner un contrat",paie:"Scanner une fiche de paie",f281:"Scanner une fiche fiscale 281.10"},F={facture:scanFacture,contrat:scanContrat,paie:scanFile,f281:scan281};pickSource(T[m]||T.paie,f=>(F[m]||scanFile)(f));return}
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
  if(b.dataset.stat){openStat(b.dataset.stat,b.dataset.c);return}
  if(b.dataset.bop!==undefined){bourseOpForm(b.dataset.bop,b.dataset.sens);return}
  if(b.dataset.btitre){bourseTitre(b.dataset.btitre);return}
  if(b.dataset.bcours){bourseCoursForm(b.dataset.bcours);return}
  if(b.dataset.bdelop){const B=S.bourse;B.ops=B.ops.filter(o=>o.id!==b.dataset.bdelop);const t=b.dataset.t;if(!B.ops.some(o=>o.titre===t)){B.titres=B.titres.filter(x=>x.id!==t);delete B.cours[t];closeSheet()}else bourseTitre(t);save();toast("Opération supprimée");return}
  if(b.dataset.bcrypto){bourseMajCrypto();return}
  if(b.dataset.bscan){pickSource("Capture de ton appli de bourse (Trade Republic, Bolero, Revolut, Degiro, Binance…)",f=>scanBourse(f));return}
  if(b.dataset.bimport){bourseImport();return}
  if(b.dataset.edit&&b.tagName!=="BUTTON"){const[ty,id]=b.dataset.edit.split(":");const o=(S[COLL[ty]]||[]).find(x=>x.id===id);if(o)openSheet(ty,null,o);return}
  if(b.dataset.del2){const[k,id]=b.dataset.del2.split(":");
    if(b.dataset.confirm!=="1"){b.dataset.confirm="1";b.textContent="Appuie encore pour confirmer";setTimeout(()=>{if(b.isConnected){b.dataset.confirm="";b.textContent="Supprimer"}},3000);return}
    {const o=(S[k]||[]).find(x=>x.id===id);if(o&&o.photo)delPhoto(o.photo)}S[k]=S[k].filter(x=>x.id!==id);if(k==="missions")S.paies.forEach(p=>{if(p.mission===id)p.mission=""});closeSheet();save();toast("Supprimé");return}
  if(b.dataset.photo){openPhoto(b.dataset.photo);return}
  if(b.dataset.attach){const tg=b.dataset.attach;pickSource("Joindre un document",f=>attachPhoto(tg,f));return}
  if(b.id==="bCalc"){calcTrajet();return}
  if(b.dataset.dups){ouvrirDoublons();return}
  if(b.dataset.fisc){situationFiscale();return}
  if(b.dataset.subadd){addSub(b.dataset.subadd);return}
  if(b.dataset.subign){S.subsIgnore.push(b.dataset.subign);save();return}
  if(b.dataset.share){routerPartage(b.dataset.share);return}
  if(b.dataset.relall){document.querySelectorAll('#sheet form[data-f="releve"] .chk-row input').forEach(x=>x.checked=b.dataset.relall==="1");return}
  if(b.dataset.relper){const n=+b.dataset.relper,d=new Date();const lim=n?iso(new Date(d.getFullYear(),d.getMonth()-n+1,1)):mkey(d)+"-01";
    document.querySelectorAll('#sheet form[data-f="releve"] .chk-row input').forEach((x,i)=>{const o=releveRes[i];x.checked=!!o&&(n===12||o.date>=lim)&&!o.dup&&!o.interne});
    const nb=[...document.querySelectorAll('#sheet form[data-f="releve"] .chk-row input')].filter(x=>x.checked).length;toast(nb+" opération(s) cochée(s)");return}
  if(b.dataset.edit2){const[ty,id]=b.dataset.edit2.split(":");const o=(S[COLL[ty]]||[]).find(x=>x.id===id);if(o)openSheet(ty,null,o);return}
  if(b.dataset.cdetail){const m=S.missions.find(x=>x.id===b.dataset.cdetail);if(m&&m.contrat)openRaw(`<h3>Contrat <button class="del" data-close>×</button></h3>${contratHTML(m.contrat)}`);return}
  if(b.dataset.fdetail){const p=S.depenses.find(x=>x.id===b.dataset.fdetail);if(p&&p.detail)openRaw(`<h3>Détail du document <button class="del" data-close>×</button></h3>${factDetailHTML(p.detail)}`);return}
  if(b.dataset.detail){const p=S.paies.find(x=>x.id===b.dataset.detail);if(p&&p.detail){const m=S.missions.find(x=>x.id===p.mission);openRaw(`<h3>Détail de la paie <button class="del" data-close>×</button></h3>${ctrlHTML(controlePaie(p.detail,m,p.id),p.id)}${detailHTML(p.detail)}`)}return}
  if(b.dataset.agmsg){let r,m,I;if(b.dataset.agmsg==="__scan"&&scanCtrl)({r,m,I}=scanCtrl);else{const p=S.paies.find(x=>x.id===b.dataset.agmsg);if(!p||!p.detail)return;r=p.detail;m=S.missions.find(x=>x.id===p.mission);I=controlePaie(r,m,p.id)}
    const txt=msgAgence(r,m,I);
    openRaw(`<h3>Message pour ton agence <button class="del" data-close>×</button></h3><p class="sub" style="margin-bottom:10px">Relis-le, modifie si besoin, puis envoie-le par mail ou WhatsApp.</p><textarea id="agTxt" style="height:260px;font-family:inherit;font-size:14px;line-height:1.45">${esc(txt)}</textarea><div class="two" style="margin-top:12px"><button type="button" class="btn" id="agShare">📤 Envoyer</button><button type="button" class="btn sec" id="agCopy">📋 Copier</button></div>`);
    $("agCopy").onclick=async()=>{try{await navigator.clipboard.writeText($("agTxt").value);toast("Message copié ✓")}catch(e){$("agTxt").select();document.execCommand("copy");toast("Message copié ✓")}};
    $("agShare").onclick=async()=>{const t=$("agTxt").value;if(navigator.share){try{await navigator.share({title:"Ma fiche de paie",text:t})}catch(e){}}else{location.href="mailto:?subject="+encodeURIComponent("Question sur ma fiche de paie")+"&body="+encodeURIComponent(t)}};return}
  if(b.dataset.ctrlvu){const p=S.paies.find(x=>x.id===b.dataset.ctrlvu);if(p){p.ctrlVu=true;save();closeSheet();toast("Noté, paie marquée comme vérifiée ✓")}return}
  if(b.dataset.resend){syncPb=null;pendingSince=0;save();toast("Envoi à Firebase…");return}
  if(b.dataset.miroir){const mi=lireMiroir();if(mi&&confirm(`Remettre ces données ?\n${resumeEtat(mi.d)}`)){S=normalize(mi.d);videServeur=false;save();toast("Données remises ✓")}return}
  if(b.dataset.exporter){exporterSauvegarde();return}
  if(b.dataset.bksnooze){LS.set("bkSnooze",Date.now());render();return}
  if(b.dataset.reco){closeSheet();reconnecter();return}
  if(b.dataset.diag||b.id==="sync"){diagnostic();return}
  if(b.dataset.version){restaurerVersion(b.dataset.version);return}
  if(b.id==="bVersions"){ouvrirVersions();return}
  if(b.dataset.moreal){alertsAll=true;render();return}
  if(b.dataset.go==="releve"){closeSheet();$("bReleve").click();return}
  if(b.dataset.acc){const d=$("acc-"+b.dataset.acc);if(d){d.open=true;setTimeout(()=>d.scrollIntoView({behavior:"smooth",block:"start"}),30)}return}
  if(b.dataset.v){if(b.dataset.v==="set")renderSettings();document.querySelectorAll("nav button").forEach(x=>x.classList.toggle("on",x.dataset.v===b.dataset.v));
    document.querySelectorAll(".view").forEach(v=>v.classList.toggle("on",v.id==="v-"+b.dataset.v));
    $("fab").style.display=b.dataset.v==="set"?"none":"block";$("monthBar").style.display=b.dataset.v==="set"?"none":"";window.scrollTo(0,0);return}
  if(b.dataset.open){const o=b.dataset.open;if(o==="retrait")openSheet("epargne",null,null,{retrait:true});else if(o==="arecevoir")openSheet("paie",null,null,{aRecevoir:true});else openSheet(o,null,null,{amt:b.dataset.amt,target:b.dataset.target});return}
  if(b.dataset.paie){openSheet("paie",b.dataset.paie);return}
  if(b.hasAttribute("data-close")){closeSheet();return}
  if(b.dataset.del){const[k,id]=b.dataset.del.split(":");
    if(b.dataset.confirm!=="1"){b.dataset.confirm="1";b.textContent="Suppr. ?";b.style.color="var(--bad)";b.style.fontSize="12px";setTimeout(()=>{if(b.isConnected){b.dataset.confirm="";b.textContent="×";b.style.color="";b.style.fontSize=""}},2500);return}
    {const o=(S[k]||[]).find(x=>x.id===id);if(o&&o.photo)delPhoto(o.photo)}S[k]=S[k].filter(x=>x.id!==id);if(k==="missions")S.paies.forEach(p=>{if(p.mission===id)p.mission=""});save();toast("Supprimé");return}
  if(b.dataset.ptoggle){const p=S.depenses.find(x=>x.id===b.dataset.ptoggle);if(p){p.paye=p.paye===false;if(p.paye)p.echeance="";save();toast(p.paye?"Marquée payée ✓":"Marquée à payer")}return}
  if(b.dataset.toggle){const p=S.paies.find(x=>x.id===b.dataset.toggle);if(p){p.recu=!p.recu;save()}return}
});
document.querySelectorAll("details.acc").forEach(d=>{let st={};try{st=JSON.parse(localStorage.getItem("accOpen")||"{}")}catch(e){}if(d.id in st)d.open=!!st[d.id];
  d.addEventListener("toggle",()=>{try{const s=JSON.parse(localStorage.getItem("accOpen")||"{}");s[d.id]=d.open;localStorage.setItem("accOpen",JSON.stringify(s))}catch(e){}})});
function renderAccStatus(){const t=today(),k=t.slice(0,7),set=(id,v)=>{const e=$("st-"+id);if(e)e.textContent=v};
  set("ia","Analyse ton mois, réponds à tes questions");
  const hp=sum(S.pointage.filter(x=>(x.date||"").startsWith(k)),x=>x.heures);set("cal",hp?fmtN(hp)+" h pointées ce mois":"Note tes heures jour par jour");
  set("trajet",S.reglages.domicile?"Coût et km de tes trajets":"Ajoute tes adresses pour calculer le coût");
  try{const dm=demarchesProches().filter(x=>!x.done);set("admin",dm.length?dm.length+" à venir · prochaine le "+fmtD(dm[0].date):"Rien à faire pour l'instant 👌")}catch(e){set("admin","")}
  set("prime","Estimation et conditions (65 j / 494 h)");set("pecule","Estimation payée en mai-juin");
  set("cr",(S.cr||[]).length?"Suivi de ton solde":"Suis ton solde de chèques-repas");
  const dt=(S.dettes||[]).filter(x=>!x.regle);set("dettes",dt.length?dt.length+" en cours":"Qui te doit quoi, à qui tu dois");
  const dd=(S.defi||[]).length;set("defi",dd?dd+" / 52 semaines":"Épargne un peu plus chaque semaine")}
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
  if(src==="file"){i.accept="application/pdf,image/*,.csv,text/csv";i.removeAttribute("capture")}
  else{i.accept="image/*";if(src==="camera")i.setAttribute("capture","environment");else i.removeAttribute("capture")}
  i.multiple=pickMulti&&src!=="camera";
  i.click()}
$("pickIn").onchange=()=>{const fs=[...$("pickIn").files];$("pickIn").value="";if(fs.length&&pickCb){const cb=pickCb;pickCb=null;cb(pickMulti?fs.slice(0,15):fs[0])}};
async function attachPhoto(target,f){
  const[k,id]=target.split(":");closeSheet();toast("Enregistrement de la photo…");
  const ph=await savePhoto(f);const o=S[k].find(x=>x.id===id);
  if(ph&&o){if(o.photo)delPhoto(o.photo);o.photo=ph;save();toast("Photo jointe ✓")}else toast("Photo trop lourde ou non enregistrée")}
$("viewerClose").onclick=()=>$("viewer").classList.remove("open");

$("bToday").onclick=()=>{cur=new Date();cur.setDate(1);render();window.scrollTo(0,0)};
$("prev").onclick=()=>{cur.setMonth(cur.getMonth()-1);render()};
$("next").onclick=()=>{cur.setMonth(cur.getMonth()+1);render()};
$("bCopy").onclick=async()=>{LS.set("lastBackup",Date.now());renderSettings();const t=JSON.stringify(S);$("backup").value=t;try{await navigator.clipboard.writeText(t);toast("Copié")}catch(e){$("backup").select();toast("Sélectionné, copie-le")}};
$("bRestore").onclick=()=>{const b=$("bRestore");let d;try{d=JSON.parse($("backup").value);if(!d||typeof d!=="object"||Array.isArray(d))throw 0}catch(e){toast("Sauvegarde invalide");return}
  if(b.dataset.confirm!=="1"){b.dataset.confirm="1";b.textContent="⚠ Remplacer TOUT ? Appuie encore";setTimeout(()=>{b.dataset.confirm="";b.textContent="Restaurer"},3500);return}
  b.dataset.confirm="";b.textContent="Restaurer";S=normalize(d);save();$("backup").value="";toast("Données restaurées")};

$("bDownload").onclick=()=>{LS.set("lastBackup",Date.now());renderSettings();const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([JSON.stringify(S,null,2)],{type:"application/json"}));a.download="budget-interim-"+today()+".json";a.click();setTimeout(()=>URL.revokeObjectURL(a.href),2000)};
init();
