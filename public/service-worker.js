const CACHE_NAME = 'opencode-mobile-web-chat-v2'
const SHELL_ASSETS = ['/', '/index.html', '/manifest.webmanifest', '/icons/pwa-192.png']

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS)))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  if (request.method !== 'GET' || url.origin !== self.location.origin) {
    return
  }

  if (url.pathname.startsWith('/@vite') || url.pathname.startsWith('/src/') || url.pathname.startsWith('/node_modules/')) {
    return
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone()
          void caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', copy))
          return response
        })
        .catch(async () => {
          const cached = await caches.match('/index.html')
          return cached || Response.error()
        })
    )
    return
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (!response || response.status !== 200 || response.type === 'opaque') {
            return response
          }

          const copy = response.clone()
          void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy))
          return response
        })
        .catch(() => cached || Response.error())

      return cached || network
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const targetUrl = event.notification.data?.url || '/'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        const clientUrl = new URL(client.url)
        if (clientUrl.pathname === targetUrl && 'focus' in client) {
          return client.focus()
        }
      }

      if (clients[0] && 'navigate' in clients[0] && 'focus' in clients[0]) {
        return clients[0].navigate(targetUrl).then((nextClient) => nextClient?.focus())
      }

      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl)
      }

      return undefined
    })
  )
})
