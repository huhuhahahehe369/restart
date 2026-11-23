
// ==========================================
// RE:START M09 - PWA INSTALL CONTROLS
// Works on HTTPS hosting and localhost.
// ==========================================

let deferredInstallPrompt = null;
let pwaInitialized = false;
let serviceWorkerRegistration = null;

// ==========================================
// DISPLAY MODE
// ==========================================

function isStandalone() {
    return window.matchMedia?.("(display-mode: standalone)").matches ||
        window.navigator.standalone === true;
}

// ==========================================
// PWA CONTROLS
// ==========================================

export function renderPWAControls() {
    const actions = document.querySelector(".header-actions");

    if (!actions) return;

    let status = actions.querySelector("#pwa-network-status");

    if (!status) {
        status = document.createElement("span");
        status.id = "pwa-network-status";
        status.className = "pwa-network-status";
        status.style.cssText =
            "font-size:10px;color:var(--text-muted);white-space:nowrap;";

        actions.appendChild(status);
    }

    status.textContent = navigator.onLine
        ? "● Online"
        : "● Offline";

    status.title = navigator.onLine
        ? "RE:START is online"
        : "RE:START is offline";

    let button = actions.querySelector("#pwa-install-button");

    if (!button) {
        button = document.createElement("button");
        button.id = "pwa-install-button";
        button.type = "button";
        button.className = "icon-button";
        button.style.cssText =
            "width:auto;padding:8px 11px;font-size:11px;white-space:nowrap;";

        button.textContent = "⇩ Install app";

        actions.appendChild(button);
    }

    if (isStandalone()) {
        button.textContent = "✓ Installed";
        button.disabled = true;
        button.title = "RE:START is installed";

    } else {
        button.disabled = false;

        button.title = deferredInstallPrompt
            ? "Install RE:START as an app"
            : "Use your browser menu to install RE:START when available";

        button.textContent = deferredInstallPrompt
            ? "⇩ Install app"
            : "＋ Add app";
    }

    button.onclick = async () => {
        if (!deferredInstallPrompt) {
            alert(
                "To install RE:START, open your browser menu and choose Install app or Create shortcut when that option is available."
            );

            return;
        }

        try {
            await deferredInstallPrompt.prompt();

            await deferredInstallPrompt.userChoice;

        } catch (error) {
            console.error(
                "Could not install RE:START:",
                error
            );

        } finally {
            deferredInstallPrompt = null;
            renderPWAControls();
        }
    };
}

// ==========================================
// INITIALIZE PWA
// ==========================================

export function initializePWA() {
    if (pwaInitialized) return;

    pwaInitialized = true;

    // Browser install prompt
    window.addEventListener("beforeinstallprompt", event => {
        event.preventDefault();

        deferredInstallPrompt = event;

        renderPWAControls();
    });

    // App installed
    window.addEventListener("appinstalled", () => {
        deferredInstallPrompt = null;

        renderPWAControls();
    });

    // Network status
    window.addEventListener(
        "online",
        renderPWAControls
    );

    window.addEventListener(
        "offline",
        renderPWAControls
    );

    // Responsive updates
    window.addEventListener(
        "resize",
        renderPWAControls
    );

    // ======================================
    // SERVICE WORKER REGISTRATION
    // ======================================

    const secureContext =
        location.protocol === "https:" ||
        location.hostname === "localhost" ||
        location.hostname === "127.0.0.1";

    if (
        "serviceWorker" in navigator &&
        secureContext
    ) {
        const workerURL = new URL(
            "../service-worker.js",
            import.meta.url
        );

        const scopeURL = new URL(
            "../",
            import.meta.url
        );

        navigator.serviceWorker.register(workerURL, {
            scope: scopeURL.pathname
        })
        .then(registration => {
            serviceWorkerRegistration = registration;

            registration.update().catch(error => {
                console.warn(
                    "Service Worker update check failed:",
                    error
                );
            });

            console.info(
                "RE:START service worker registered:",
                registration.scope
            );
        })
        .catch(error => {
            console.error(
                "RE:START service worker registration failed:",
                error
            );
        });
    }

    renderPWAControls();
}

// ==========================================
// GET REGISTRATION
// ==========================================

export function getPWARegistration() {
    return serviceWorkerRegistration;
}
