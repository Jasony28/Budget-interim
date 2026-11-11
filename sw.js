// Service worker : met l'appli en cache pour qu'elle s'ouvre même sans réseau.
// Les données, elles, sont gérées hors ligne par Firestore.
const CACHE = "budget-interim-v27";
const FILES = ["./", "./index.html", "./app.js?v=27", "./firebase-config.js?v=27", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== "rappels" && k !== "share").map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  // Fichier partagé depuis une autre appli (galerie, mail…) → gardé puis l'appli s'ouvre dessus
  if (e.request.method === "POST" && url.origin === location.origin && url.pathname.endsWith("/share")) {
    e.respondWith((async () => {
      try {
        const fd = await e.request.formData();
        const f = fd.get("file");
        if (f && f.size) {
          const c = await caches.open("share");
          await c.put("shared", new Response(f, { headers: { "content-type": f.type || "application/octet-stream", "x-name": encodeURIComponent(f.name || "document") } }));
        }
      } catch (err) {}
      return Response.redirect("./?share=1", 303);
    })());
    return;
  }
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.endsWith("version.json")) return; // Firebase & CDN : réseau direct
  // Réseau d'abord (pour recevoir les mises à jour), cache si hors ligne
  e.respondWith(
    fetch(e.request, { cache: "no-cache" }).then(r => {
      const copy = r.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return r;
    }).catch(() => caches.match(e.request).then(r => r || caches.match("./index.html")))
  );
});

// ---------- Rappels (notifications même appli fermée, si le téléphone autorise la synchro périodique) ----------
async function envoyerRappels() {
  try {
    const c = await caches.open("rappels");
    const r = await c.match("rappels.json"); if (!r) return;
    const list = await r.json();
    const vusR = await c.match("vus.json"); const vus = vusR ? await vusR.json() : [];
    const d = new Date(); const t = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    const due = list.filter(x => x.date <= t && !vus.includes(x.id)).slice(0, 3);
    for (const x of due) { await self.registration.showNotification(x.title, { body: x.body, icon: "icon-192.png", badge: "icon-192.png", tag: x.id }); vus.push(x.id); }
    await c.put("vus.json", new Response(JSON.stringify(vus.slice(-300))));
  } catch (e) {}
}
self.addEventListener("periodicsync", e => { if (e.tag === "rappels") e.waitUntil(envoyerRappels()); });
self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window" }).then(cl => cl.length ? cl[0].focus() : self.clients.openWindow("./")));
});
