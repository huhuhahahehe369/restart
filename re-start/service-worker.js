
const CACHE_PREFIX = "restart-pwa-";
const CACHE_VERSION = "m09-v3";
const CACHE_NAME = `${CACHE_PREFIX}${CACHE_VERSION}`;

function getBaseURL() {
    return new URL("./", self.registration.scope);
}

function getShellURLs() {
    const base = getBaseURL();

    return [
        base.href,
        new URL("index.html", base).href,
        new URL("manifest.webmanifest", base).href,
        new URL("icons/icon-192.png", base).href,
        new URL("icons/icon-512.png", base).href
    ];
}

async function networkFirst(request, fallbackURL = null) {
    const cache = await caches.open(CACHE_NAME);

    try {
        const response = await fetch(request, {
            cache: "no-store"
        });

        if (response && response.ok) {
            await cache.put(request, response.clone());
        }

        return response;

    } catch (error) {
        const cached = await cache.match(request);

        if (cached) return cached;

        if (fallbackURL) {
            const fallback = await cache.match(fallbackURL);
            if (fallback) return fallback;
        }

        throw error;
    }
}

// ==========================================
// INSTALL
// ==========================================

self.addEventListener("install", event => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE_NAME);

        await Promise.all(getShellURLs().map(async url => {
            try {
                const response = await fetch(url, {
                    cache: "no-store"
                });

                if (response && response.ok) {
                    await cache.put(url, response);
                }

            } catch (error) {
                console.warn("Could not precache:", url, error);
            }
        }));

        await self.skipWaiting();
    })());
});

// ==========================================
// ACTIVATE
// ==========================================

self.addEventListener("activate", event => {
    event.waitUntil((async () => {
        const keys = await caches.keys();

        await Promise.all(
            keys
                .filter(key =>
                    key.startsWith(CACHE_PREFIX) &&
                    key !== CACHE_NAME
                )
                .map(key => caches.delete(key))
        );

        await self.clients.claim();

        console.info(
            "RE:START service worker active:",
            CACHE_NAME
        );
    })());
});

// ==========================================
// FETCH
// ==========================================

self.addEventListener("fetch", event => {
    const request = event.request;

    if (request.method !== "GET") return;

    const url = new URL(request.url);

    if (url.origin !== self.location.origin) return;

    // API requests are never cached.
    if (url.pathname.includes("/api/")) return;

    const isNavigation = request.mode === "navigate";
    const isScript = /\.(?:js|mjs)$/i.test(url.pathname);
    const isStylesheet = /\.css$/i.test(url.pathname);

    const isOtherStatic =
        /\.(?:png|jpg|jpeg|webp|svg|ico|woff2?|webmanifest)$/i
            .test(url.pathname);

    // NETWORK FIRST: HTML, JavaScript and CSS
    if (isNavigation || isScript || isStylesheet) {
        event.respondWith((async () => {
            const shellURL = new URL(
                "index.html",
                getBaseURL()
            ).href;

            try {
                return await networkFirst(
                    request,
                    isNavigation ? shellURL : null
                );

            } catch (error) {
                if (isNavigation) {
                    return new Response(
                        "<main style='font-family:sans-serif;padding:2rem'><h1>RE:START is offline</h1><p>Reconnect to the internet to load the latest app code.</p></main>",
                        {
                            status: 503,
                            headers: {
                                "Content-Type": "text/html; charset=utf-8"
                            }
                        }
                    );
                }

                return new Response(
                    "App asset unavailable offline.",
                    {
                        status: 503,
                        headers: {
                            "Content-Type": "text/plain; charset=utf-8"
                        }
                    }
                );
            }
        })());

        return;
    }

    // CACHE FIRST: images, icons and fonts
    if (isOtherStatic) {
        event.respondWith((async () => {
            const cache = await caches.open(CACHE_NAME);
            const cached = await cache.match(request);

            if (cached) {
                event.waitUntil(
                    fetch(request)
                        .then(response => {
                            if (response && response.ok) {
                                return cache.put(
                                    request,
                                    response.clone()
                                );
                            }
                        })
                        .catch(() => {})
                );

                return cached;
            }

            try {
                const response = await fetch(request);

                if (response && response.ok) {
                    await cache.put(
                        request,
                        response.clone()
                    );
                }

                return response;

            } catch {
                return new Response(
                    "Offline asset unavailable.",
                    { status: 503 }
                );
            }
        })());
    }
});
