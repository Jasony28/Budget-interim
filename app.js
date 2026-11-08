import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import { getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, signOut } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, setDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app-check.js";
import { getAI, getGenerativeModel, GoogleAIBackend } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-ai.js";
import { firebaseConfig, recaptchaEnterpriseSiteKey, geminiModel } from "./firebase-config.js";

const CATS=["Courses","Transport","Carburant","Loisirs","Santé","Vêtements","Maison","Resto","Cadeaux","Autre"];
const DEF={missions:[],paies:[],depenses:[],fixes:[],reglages:{epargne:0,pct:10,mois:3,ratio:78}};
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
function normalize(d){d=d||{};return{missions:d.missions||[],paies:d.paies||[],depenses:d.depenses||[],fixes:d.fixes||[],reglages:Object.assign({},DEF.reglages,d.reglages||{})}}
const configured=firebaseConfig.apiKey&&firebaseConfig.apiKey!=="A_REMPLACER";
const app=configured?initializeApp(firebaseConfig):null;
const auth=app?getAuth(app):null;
const fdb=app?initializeFirestore(app,{localCache:persistentLocalCache({tabManager:persistentMultipleTabManager()})}):null;
let fsDoc=null, unsub=null;
function setSync(t){$("sync").textContent=t}
function save(){
  render();
  if(!fsDoc)return;
  setDoc(fsDoc,JSON.parse(JSON.stringify(S))).catch(e=>{console.error(e);setSync("⚠ Erreur de sauvegarde")});
}
function subscribe(uid){
  fsDoc=doc(fdb,"budgets",uid);
  setSync("Chargement…");
  unsub=onSnapshot(fsDoc,{includeMetadataChanges:true},snap=>{
    const m=snap.metadata;
    if(!m.hasPendingWrites&&snap.exists())S=normalize(snap.data());
    setSync(m.hasPendingWrites?(navigator.onLine?"Sauvegarde…":"Hors ligne · enregistré sur le téléphone"):m.fromCache?"Hors ligne":"✓ Synchronisé");
    render();
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
if("serviceWorker" in navigator)window.addEventListener("load",()=>navigator.serviceWorker.register("sw.js").catch(()=>{}));

/* ---------- calculs ---------- */
const fixesTotal=()=>S.fixes.reduce((a,f)=>a+(+f.montant||0),0);
function monthData(k){
  const p=S.paies.filter(x=>(x.date||"").startsWith(k));
  const recu=p.filter(x=>x.recu).reduce((a,x)=>a+(+x.montant||0),0);
  const att=p.filter(x=>!x.recu).reduce((a,x)=>a+(+x.montant||0),0);
  const d=S.depenses.filter(x=>(x.date||"").startsWith(k));
  const var_=d.reduce((a,x)=>a+(+x.montant||0),0);
  return{p,recu,att,d,var_,fix:fixesTotal(),dep:var_+fixesTotal()};
}
function missionPaid(m){return S.paies.filter(p=>p.mission===m.id&&p.recu).reduce((a,p)=>a+(+p.montant||0),0)}
function daysTo(s){return Math.ceil((new Date(s+"T23:59")-new Date())/864e5)}

/* ---------- rendu ---------- */
function render(){
  const k=mkey(cur);
  $("mlabel").textContent=cur.toLocaleDateString("fr-BE",{month:"long",year:"numeric"});
  const M=monthData(k), R=S.reglages;
  const reste=M.recu+M.att-M.dep;
  $("reste").textContent=eur(reste);
  $("resteCard").classList.toggle("neg",reste<0);
  $("resteSub").textContent=M.att>0?`dont ${eur(M.att)} de paies encore attendues`:"revenus − charges fixes − dépenses";
  $("recu").textContent=eur(M.recu);
  $("attendu").textContent=M.att>0?`+ ${eur(M.att)} attendus`:`${M.p.length} paie(s)`;
  $("dep").textContent=eur(M.dep);
  $("depSub").textContent=`${eur(M.fix)} fixes · ${eur(M.var_)} variables`;

  // alertes
  const A=[];const t=today();
  const active=S.missions.filter(m=>(!m.debut||m.debut<=t)&&(!m.fin||m.fin>=t));
  if(!S.missions.length) A.push(["","Ajoute ta première mission","Onglet Paies → nouvelle mission, puis enregistre chaque paie reçue."]);
  else if(!active.length) A.push(["bad","Pas de mission en cours",`Avec tes charges fixes de ${eur(fixesTotal())}/mois, ton épargne tient ${fixesTotal()?(R.epargne/fixesTotal()).toFixed(1):"∞"} mois.`]);
  active.forEach(m=>{if(m.fin){const n=daysTo(m.fin);if(n<=14)A.push([n<=5?"bad":"","Fin de mission "+(n<=0?"aujourd'hui":"dans "+n+" j"),`${esc(m.client||m.agence)} se termine le ${fmtD(m.fin)}. Pense à relancer ton agence.`])}
    else A.push(["ok","Mission en cours",`${esc(m.client||m.agence)} · ${m.taux?eur2(m.taux)+"/h brut":""}`])});
  const aside=(M.recu*R.pct/100);
  if(M.recu>0&&R.pct>0) A.push(["ok",`Mets ${eur(aside)} de côté`,`${R.pct}% de tes paies reçues ce mois, pour lisser les périodes sans mission.`]);
  $("alerts").innerHTML=A.map(a=>`<div class="card alert ${a[0]}"><div><div class="t">${a[1]}</div><p>${a[2]}</p></div></div>`).join("");

  // coussin
  const fx=fixesTotal(), cible=fx*R.mois;
  if(fx>0){const mo=R.epargne/fx;$("coussin").textContent=mo.toFixed(1)+" mois";
    $("coussinSub").textContent=`${eur(R.epargne)} d'épargne · objectif ${R.mois} mois = ${eur(cible)}`;
    $("coussinBar").style.width=Math.min(100,R.epargne/cible*100)+"%";
    $("coussinBar").style.background=mo>=R.mois?"var(--acc)":mo>=1?"var(--warn)":"var(--bad)";}
  else{$("coussin").textContent="—";$("coussinSub").textContent="Ajoute tes charges fixes pour calculer combien de mois tu tiens sans mission.";$("coussinBar").style.width="0"}

  // graphique
  const ms=[];for(let i=5;i>=0;i--){const d=new Date(cur);d.setMonth(d.getMonth()-i);ms.push(d)}
  const vals=ms.map(d=>{const x=monthData(mkey(d));return[x.recu+x.att,x.dep]});
  const mx=Math.max(1,...vals.flat());
  $("chart").innerHTML=ms.map((d,i)=>`<div class="c"><div class="bars"><i style="height:${vals[i][0]/mx*100}%;background:var(--acc)"></i><i style="height:${vals[i][1]/mx*100}%;background:var(--bad)"></i></div><small>${d.toLocaleDateString("fr-BE",{month:"short"}).replace(".","")}</small></div>`).join("");

  // catégories
  const c={};M.d.forEach(x=>c[x.cat]=(c[x.cat]||0)+(+x.montant||0));
  const ce=Object.entries(c).sort((a,b)=>b[1]-a[1]);
  $("cats").innerHTML=ce.length?ce.map(([n,v])=>`<div class="cat"><span>${esc(n)}</span><b>${eur(v)}</b></div><div class="bar" style="margin-top:4px;height:6px"><i style="width:${v/ce[0][1]*100}%;background:var(--bad)"></i></div>`).join(""):`<div class="empty">Aucune dépense ce mois</div>`;

  // missions
  const ms2=[...S.missions].sort((a,b)=>(b.debut||"").localeCompare(a.debut||""));
  $("missions").innerHTML=ms2.length?ms2.map(m=>{
    const on=(!m.debut||m.debut<=t)&&(!m.fin||m.fin>=t);
    return `<div class="row"><div class="l"><b>${esc(m.client||"Mission")}${on?'<span class="pill g">en cours</span>':(m.debut>t?'<span class="pill y">à venir</span>':'')}</b>
    <small>${esc(m.agence)} · ${fmtD(m.debut)}${m.fin?" → "+fmtD(m.fin):" → ?"}${m.taux?" · "+eur2(m.taux)+"/h":""}</small><br><small>Reçu : ${eur(missionPaid(m))}</small></div>
    <div style="display:flex;gap:4px;align-items:center"><button class="btn sm" data-paie="${m.id}">+ Paie</button><button class="del" data-del="missions:${m.id}">×</button></div></div>`}).join(""):`<div class="empty">Aucune mission</div>`;

  // paies
  const pm=[...M.p].sort((a,b)=>b.date.localeCompare(a.date));
  $("paies").innerHTML=pm.length?pm.map(p=>{const m=S.missions.find(x=>x.id===p.mission);
    return `<div class="row"><div class="l" ${p.detail?`data-detail="${p.id}" style="cursor:pointer"`:""}><b>${p.detail?"📄 ":""}${esc(m?(m.client||m.agence):(p.note||"Paie"))}${p.recu?"":'<span class="pill y">attendue</span>'}</b><small>${fmtD(p.date)}${p.heures?" · "+p.heures+" h":""}${p.note&&m?" · "+esc(p.note):""}</small></div>
    <div style="display:flex;align-items:center;gap:2px"><span class="amt ${p.recu?"pos":"pend"}" data-toggle="${p.id}" style="cursor:pointer">${eur2(p.montant)}</span><button class="del" data-del="paies:${p.id}">×</button></div></div>`}).join("")+`<div class="sub" style="padding-top:8px">Touche un montant pour le marquer reçu / attendu.</div>`:`<div class="empty">Aucune paie ce mois</div>`;

  // fixes
  $("fixes").innerHTML=S.fixes.length?S.fixes.map(f=>`<div class="row"><div class="l"><b>${esc(f.nom)}</b></div><div style="display:flex;align-items:center"><span class="amt out">${eur2(f.montant)}</span><button class="del" data-del="fixes:${f.id}">×</button></div></div>`).join("")+`<div class="row"><div class="l"><b>Total</b></div><span class="amt">${eur2(fx)}</span></div>`:`<div class="empty">Loyer, assurance, téléphone, abonnements…</div>`;

  // dépenses
  const dm=[...M.d].sort((a,b)=>b.date.localeCompare(a.date));
  $("depenses").innerHTML=dm.length?dm.map(d=>`<div class="row"><div class="l"><b>${esc(d.note||d.cat)}</b><small>${fmtD(d.date)} · ${esc(d.cat)}</small></div><div style="display:flex;align-items:center"><span class="amt out">−${eur2(d.montant)}</span><button class="del" data-del="depenses:${d.id}">×</button></div></div>`).join(""):`<div class="empty">Aucune dépense ce mois</div>`;

  // réglages
  if(document.activeElement?.closest?.("#fSet")==null){$("sEpargne").value=R.epargne;$("sPct").value=R.pct;$("sMois").value=R.mois;$("sRatio").value=R.ratio}
}

/* ---------- formulaires ---------- */
function openSheet(type,ctx){
  const missOpts=S.missions.map(m=>`<option value="${m.id}" ${ctx===m.id?"selected":""}>${esc(m.client||m.agence)}</option>`).join("");
  const H={
   depense:`<h3>Nouvelle dépense <button class="del" data-close>×</button></h3>
    <form data-f="depense"><label>Montant (€)<input name="montant" type="number" step="0.01" inputmode="decimal" required autofocus></label>
    <label>Catégorie<select name="cat">${CATS.map(c=>`<option>${c}</option>`).join("")}</select></label>
    <div class="two"><label>Date<input name="date" type="date" value="${today()}" required></label><label>Note<input name="note" placeholder="optionnel"></label></div>
    <button class="btn">Ajouter</button></form>`,
   paie:`<h3>Nouvelle paie <button class="del" data-close>×</button></h3>
    <form data-f="paie">${S.missions.length?`<label>Mission<select name="mission" id="pMis"><option value="">— Aucune —</option>${missOpts}</select></label>`:""}
    <div class="two"><label>Heures prestées<input name="heures" id="pH" type="number" step="0.25" inputmode="decimal" placeholder="ex. 38"></label><label>Date<input name="date" type="date" value="${today()}" required></label></div>
    <div class="est" id="pEst">Indique les heures pour une estimation du net.</div>
    <label>Montant net (€)<input name="montant" id="pM" type="number" step="0.01" inputmode="decimal" required></label>
    <label>Note<input name="note" placeholder="ex. semaine 45"></label>
    <label class="chk"><input type="checkbox" name="recu" checked> Déjà reçue sur mon compte</label>
    <button class="btn">Ajouter</button></form>`,
   mission:`<h3>Nouvelle mission <button class="del" data-close>×</button></h3>
    <form data-f="mission"><div class="two"><label>Agence<input name="agence" required placeholder="ex. Randstad"></label><label>Client / poste<input name="client" placeholder="ex. Magasinier"></label></div>
    <div class="two"><label>Début<input name="debut" type="date" value="${today()}"></label><label>Fin prévue<input name="fin" type="date"></label></div>
    <label>Taux horaire brut (€)<input name="taux" type="number" step="0.01" inputmode="decimal"></label>
    <button class="btn">Ajouter</button></form>`,
   fixe:`<h3>Charge fixe mensuelle <button class="del" data-close>×</button></h3>
    <form data-f="fixe"><label>Nom<input name="nom" required placeholder="ex. Loyer"></label>
    <label>Montant par mois (€)<input name="montant" type="number" step="0.01" inputmode="decimal" required></label>
    <button class="btn">Ajouter</button></form>`,
   choix:`<h3>Ajouter <button class="del" data-close>×</button></h3>
    <div style="display:grid;gap:10px"><button class="btn scanBtn" ${canImg?"":"hidden"}>📷 Scanner une fiche de paie</button><button class="btn" data-open="depense">Une dépense</button><button class="btn sec" data-open="paie">Une paie reçue</button><button class="btn sec" data-open="mission">Une mission</button><button class="btn sec" data-open="fixe">Une charge fixe</button></div>`
  };
  $("sheet").innerHTML=H[type];$("sheetBg").classList.add("open");
  if(type==="paie"){
    const upd=()=>{const m=S.missions.find(x=>x.id===($("pMis")?.value));const h=+$("pH").value;
      if(m&&m.taux&&h){const n=m.taux*h*S.reglages.ratio/100;$("pEst").innerHTML=`Estimation : <b>${eur2(n)}</b> net<br><small>${h} h × ${eur2(m.taux)} brut × ${S.reglages.ratio}%</small>`;if(!$("pM").dataset.touched)$("pM").value=n.toFixed(2)}
      else $("pEst").textContent=m&&!m.taux?"Ajoute un taux horaire à la mission pour estimer le net.":"Choisis une mission et indique les heures pour une estimation du net."};
    $("pH").oninput=upd;if($("pMis"))$("pMis").onchange=upd;$("pM").oninput=()=>$("pM").dataset.touched=1;upd();
  }
  setTimeout(()=>$("sheet").querySelector("input")?.focus(),80);
}
function closeSheet(){$("sheetBg").classList.remove("open");if(scanCtl){scanCtl.abort();scanCtl=null}}
function openRaw(h){$("sheet").innerHTML=h;$("sheetBg").classList.add("open")}

/* ---------- scan fiche de paie ---------- */
let model=null, canImg=false, scanCtl=null, scanRes=null;
function initAI(){
  try{
    if(recaptchaEnterpriseSiteKey)initializeAppCheck(app,{provider:new ReCaptchaEnterpriseProvider(recaptchaEnterpriseSiteKey),isTokenAutoRefreshEnabled:true});
    const ai=getAI(app,{backend:new GoogleAIBackend()});
    model=getGenerativeModel(ai,{model:geminiModel,generationConfig:{responseMimeType:"application/json",temperature:0}});
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
function aiErr(e){const m=String(e&&e.message||e||"").toLowerCase();
  if(m.includes("app check")||m.includes("appcheck")||m.includes("recaptcha"))return "Scan bloqué par App Check : ajoute ta clé reCAPTCHA Enterprise dans firebase-config.js (voir README).";
  if(m.includes("429")||m.includes("quota")||m.includes("resource_exhausted"))return "Limite gratuite atteinte pour le moment, réessaie plus tard.";
  if(m.includes("api has not been used")||m.includes("not enabled")||m.includes("permission"))return "Firebase AI Logic n'est pas activé sur ton projet (voir README).";
  if(m.includes("not found")&&m.includes("model"))return "Modèle Gemini introuvable : change geminiModel dans firebase-config.js.";
  if(!navigator.onLine||m.includes("network")||m.includes("fetch"))return "Pas de connexion internet.";
  return "Lecture impossible, réessaie avec une photo plus nette.";}
const PROMPT=`Tu lis la photo ou capture d'écran d'une fiche de paie d'un travailleur intérimaire (probablement en Belgique ou en France).
Extrais les informations et réponds UNIQUEMENT avec un objet JSON de cette forme :
{"agence":"nom de l'agence d'intérim ou employeur","client":"entreprise utilisatrice / lieu de mission ou null","periode_debut":"YYYY-MM-DD ou null","periode_fin":"YYYY-MM-DD ou null","date_paiement":"YYYY-MM-DD ou null","heures":nombre total d'heures prestées ou null,"taux_horaire_brut":nombre ou null,"brut":salaire brut total ou null,"net":montant net à payer / viré sur le compte ou null,
"lignes":[{"libelle":"intitulé court en français","montant":nombre positif,"type":"gain" | "retenue" | "info"}],
"avantages":"chèques-repas, éco-chèques, primes, etc. en une phrase, ou null","resume":"2 phrases simples qui expliquent la fiche (d'où vient la différence entre brut et net)"}
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
async function scanFile(f){
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
    scanRes=r;showScan(r);
  }catch(e){
    if(scanCtl!==ctl||ctl.signal.aborted)return;scanCtl=null;
    console.error(e);
    openRaw(`<h3>Lecture impossible <button class="del" data-close>×</button></h3><div class="est">${esc(aiErr(e))}</div>`);
  }
}
function showScan(r){
  const ag=(r.agence||"").toLowerCase();
  const match=S.missions.find(m=>ag&&m.agence&&(ag.includes(m.agence.toLowerCase())||m.agence.toLowerCase().includes(ag.split(" ")[0])));
  const date=r.date_paiement||r.periode_fin||today();
  const ratio=r.brut&&r.net?Math.round(r.net/r.brut*100):null;
  openRaw(`<h3>Ta fiche de paie <button class="del" data-close>×</button></h3>${detailHTML(r)}
   <form data-f="scan" style="margin-top:16px;border-top:1px solid var(--line);padding-top:14px">
    <div class="two"><label>Net à enregistrer (€)<input name="montant" type="number" step="0.01" inputmode="decimal" required value="${r.net??""}"></label><label>Date<input name="date" type="date" required value="${esc(date)}"></label></div>
    <label>Mission<select name="mission"><option value="">— Aucune —</option>${r.agence&&!match?`<option value="__new" selected>➕ Créer « ${esc(r.agence)}${r.client?" · "+esc(r.client):""} »</option>`:""}${S.missions.map(m=>`<option value="${m.id}" ${match&&match.id===m.id?"selected":""}>${esc(m.client||m.agence)}</option>`).join("")}</select></label>
    <label class="chk"><input type="checkbox" name="recu" checked> Déjà reçue sur mon compte</label>
    ${ratio&&ratio>30&&ratio<100?`<label class="chk"><input type="checkbox" name="ratio" ${Math.abs(ratio-S.reglages.ratio)>=2?"checked":""}> Utiliser ce ratio net/brut (${ratio} %) pour mes estimations</label>`:""}
    <button class="btn">Enregistrer la paie</button></form>`);
}

document.addEventListener("submit",e=>{
  e.preventDefault();const f=e.target;
  if(f.id==="fSet"){const R=S.reglages;R.epargne=+$("sEpargne").value||0;R.pct=+$("sPct").value||0;R.mois=+$("sMois").value||1;R.ratio=+$("sRatio").value||78;save();toast("Réglages enregistrés");return}
  const d=Object.fromEntries(new FormData(f));d.id=uid();
  const t=f.dataset.f;
  if(t==="scan"&&scanRes){const r=scanRes;let mid=d.mission;
    if(mid==="__new"){mid=uid();S.missions.push({id:mid,agence:r.agence||"Agence",client:r.client||"",debut:r.periode_debut||d.date,fin:"",taux:r.taux_horaire_brut||0})}
    else if(mid){const m=S.missions.find(x=>x.id===mid);if(m&&!m.taux&&r.taux_horaire_brut)m.taux=r.taux_horaire_brut}
    if(f.ratio&&f.ratio.checked&&r.brut&&r.net)S.reglages.ratio=Math.round(r.net/r.brut*100);
    S.paies.push({id:d.id,mission:mid||"",date:d.date,montant:+d.montant,recu:!!f.recu.checked,heures:r.heures||"",note:r.periode_debut?`du ${fmtD(r.periode_debut)} au ${fmtD(r.periode_fin)}`:"",detail:r});
    const dt=new Date(d.date+"T12:00");cur=new Date(dt.getFullYear(),dt.getMonth(),1);
    scanRes=null;closeSheet();save();toast(S.reglages.pct?`Paie ajoutée · épargne ${eur(+d.montant*S.reglages.pct/100)}`:"Paie ajoutée");return}
  if(t==="depense"){d.montant=+d.montant;S.depenses.push(d)}
  if(t==="paie"){d.montant=+d.montant;d.recu=!!f.recu.checked;if(d.heures)d.heures=+d.heures;S.paies.push(d);if(d.recu&&S.reglages.pct)toast(`Pense à épargner ${eur(d.montant*S.reglages.pct/100)}`)}
  if(t==="mission"){d.taux=d.taux?+d.taux:0;S.missions.push(d)}
  if(t==="fixe"){d.montant=+d.montant;S.fixes.push(d)}
  if(t==="paie"||t==="depense"){const dt=new Date(d.date+"T12:00");cur=new Date(dt.getFullYear(),dt.getMonth(),1)}
  closeSheet();save();if(t!=="paie")toast("Ajouté");
});

document.addEventListener("click",e=>{
  const b=e.target.closest("button,[data-toggle],[data-detail]");
  if(e.target===$("sheetBg")){closeSheet();return}
  if(!b)return;
  if(b.classList.contains("scanBtn")){$("fileIn").click();return}
  if(b.dataset.detail){const p=S.paies.find(x=>x.id===b.dataset.detail);if(p&&p.detail)openRaw(`<h3>Détail de la paie <button class="del" data-close>×</button></h3>${detailHTML(p.detail)}`);return}
  if(b.dataset.v){document.querySelectorAll("nav button").forEach(x=>x.classList.toggle("on",x===b));
    document.querySelectorAll(".view").forEach(v=>v.classList.toggle("on",v.id==="v-"+b.dataset.v));
    $("fab").style.display=b.dataset.v==="set"?"none":"block";window.scrollTo(0,0);return}
  if(b.dataset.open){openSheet(b.dataset.open);return}
  if(b.dataset.paie){openSheet("paie",b.dataset.paie);return}
  if(b.hasAttribute("data-close")){closeSheet();return}
  if(b.dataset.del){const[k,id]=b.dataset.del.split(":");
    if(b.dataset.confirm!=="1"){b.dataset.confirm="1";b.textContent="Suppr. ?";b.style.color="var(--bad)";b.style.fontSize="12px";setTimeout(()=>{if(b.isConnected){b.dataset.confirm="";b.textContent="×";b.style.color="";b.style.fontSize=""}},2500);return}
    S[k]=S[k].filter(x=>x.id!==id);if(k==="missions")S.paies.forEach(p=>{if(p.mission===id)p.mission=""});save();toast("Supprimé");return}
  if(b.dataset.toggle){const p=S.paies.find(x=>x.id===b.dataset.toggle);if(p){p.recu=!p.recu;save()}return}
});
$("fab").onclick=()=>{const v=document.querySelector(".view.on").id;openSheet(v==="v-rev"?"paie":v==="v-dep"?"depense":"choix")};
$("fileIn").onchange=()=>{const f=$("fileIn").files[0];$("fileIn").value="";if(f)scanFile(f)};
$("prev").onclick=()=>{cur.setMonth(cur.getMonth()-1);render()};
$("next").onclick=()=>{cur.setMonth(cur.getMonth()+1);render()};
$("bCopy").onclick=async()=>{const t=JSON.stringify(S);$("backup").value=t;try{await navigator.clipboard.writeText(t);toast("Copié")}catch(e){$("backup").select();toast("Sélectionné, copie-le")}};
$("bRestore").onclick=()=>{try{const d=JSON.parse($("backup").value);if(!d||typeof d!=="object")throw 0;S=normalize(d);save();$("backup").value="";toast("Données restaurées")}catch(e){toast("Sauvegarde invalide")}};

$("bDownload").onclick=()=>{const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([JSON.stringify(S,null,2)],{type:"application/json"}));a.download="budget-interim-"+today()+".json";a.click();setTimeout(()=>URL.revokeObjectURL(a.href),2000)};
init();
