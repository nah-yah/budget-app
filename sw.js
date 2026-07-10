// BUILD_ID est remplacé par le SHA du commit au déploiement (Netlify, voir netlify.toml).
// Il change donc à chaque déploiement → le navigateur détecte un nouveau service worker.
const BUILD_ID = '__BUILD_ID__';
const CACHE_NAME = 'budget-app-' + BUILD_ID;
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg'
];

// Hôtes Firebase / Google : NE JAMAIS mettre en cache (auth + sync temps réel doivent
// toujours passer par le réseau, sinon on sert des réponses périmées).
const NO_CACHE_HOSTS = [
  'firestore.googleapis.com',
  'firebaseinstallations.googleapis.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'www.googleapis.com',
  'oauth2.googleapis.com',
  'accounts.google.com',
  'apis.google.com',
  'content-firebaseappcheck.googleapis.com'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  // We only cache GET requests
  if (event.request.method !== 'GET') return;

  // Laisser passer les requêtes Firebase/Google directement au réseau (pas de cache).
  let url;
  try { url = new URL(event.request.url); } catch (e) { return; }
  if (NO_CACHE_HOSTS.indexOf(url.hostname) !== -1) return;

  // HTML / navigation : NETWORK-FIRST — on récupère toujours la dernière version en ligne,
  // et on retombe sur le cache seulement si hors-ligne. Évite de rester bloqué sur une
  // ancienne version de l'app après une mise à jour.
  const isDoc = event.request.mode === 'navigate'
    || url.pathname === '/' || url.pathname.endsWith('/')
    || url.pathname.endsWith('/index.html') || url.pathname.endsWith('index.html');

  if (isDoc) {
    event.respondWith(
      fetch(event.request).then(networkResponse => {
        if (networkResponse && networkResponse.status === 200) {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return networkResponse;
      }).catch(() => caches.match(event.request).then(r => r || caches.match('./index.html')))
    );
    return;
  }

  // Autres ressources (CDN versionnés, polices, icônes) : CACHE-FIRST.
  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).then(networkResponse => {
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      }).catch(() => {
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
      });
    })
  );
});