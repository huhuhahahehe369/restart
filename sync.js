
// ==========================================
// RE:START M09 - CLOUD SYNC
// Client-side compression + AES-GCM encryption.
// The sync passphrase is never sent to the Worker.
// D1 stores ciphertext only.
// ==========================================

const DATABASE_KEY = "restart-data-v1";
const SYNC_CONFIG_KEY = "restart-cloud-sync-v1";
const AI_CONFIG_KEY = "restart-ai-connection-v1";
const SESSION_PASSWORD_KEY = "restart-ai-session-password-v1";

const MAX_CIPHERTEXT_CHARS = 1_850_000;
const PBKDF2_ITERATIONS = 310_000;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

let syncPassphrase = "";
let pendingRemote = null;
let notice = "";
let noticeType = "info";
let currentMode = "new";
let busy = false;

// ==========================================
// LANGUAGE & HTML HELPERS
// ==========================================

function getLanguage() {
    try {
        const db = JSON.parse(
            localStorage.getItem(DATABASE_KEY) || "{}"
        );

        const language = db?.settings?.language;

        return ["en", "vi", "bi"].includes(language)
            ? language
            : "en";

    } catch (error) {
        console.warn("Could not read RE:START language:", error);
        return "en";
    }
}

function tx(en, vi) {
    const language = getLanguage();

    if (language === "vi") return vi;
    if (language === "bi") return `${en} · ${vi}`;

    return en;
}

function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[char]);
}

function setNotice(message, type = "info") {
    notice = message;
    noticeType = type;
}

// ==========================================
// CONFIGURATION
// ==========================================

function readConfig() {
    try {
        const config = JSON.parse(
            localStorage.getItem(SYNC_CONFIG_KEY) || "null"
        );

        return config && typeof config === "object"
            ? config
            : null;

    } catch {
        return null;
    }
}

function saveConfig(config) {
    localStorage.setItem(
        SYNC_CONFIG_KEY,
        JSON.stringify(config)
    );
}

function getWorkerConnection() {
    let saved = {};

    try {
        saved = JSON.parse(
            localStorage.getItem(AI_CONFIG_KEY) || "{}"
        );
    } catch {}

    let password = "";

    try {
        password = sessionStorage.getItem(
            SESSION_PASSWORD_KEY
        ) || "";
    } catch {}

    return {
        endpoint: String(saved.endpoint || "")
            .trim()
            .replace(/\/+$/, ""),
        password
    };
}

// ==========================================
// LOCAL DATABASE
// ==========================================

function readLocalDatabase() {
    const raw = localStorage.getItem(DATABASE_KEY);

    if (!raw) {
        throw new Error(tx(
            "RE:START local database was not found.",
            "Không tìm thấy dữ liệu RE:START trên thiết bị."
        ));
    }

    let database;

    try {
        database = JSON.parse(raw);
    } catch {
        throw new Error(tx(
            "Local data is unreadable. No changes were made.",
            "Dữ liệu cục bộ không đọc được. Không có thay đổi nào được thực hiện."
        ));
    }

    if (
        !database ||
        typeof database !== "object" ||
        !database.settings ||
        !database.study ||
        !database.sleep ||
        !Array.isArray(database.journal) ||
        !Array.isArray(database.goals)
    ) {
        throw new Error(tx(
            "The database structure is not recognized. Sync was stopped to protect your data.",
            "Không nhận diện được cấu trúc dữ liệu. Đã dừng đồng bộ để bảo vệ dữ liệu."
        ));
    }

    return {
        raw,
        database
    };
}

function getLocalUpdatedAt(database) {
    return String(database?.meta?.updatedAt || "");
}

function getLocalSize() {
    const raw = localStorage.getItem(DATABASE_KEY) || "";
    return new Blob([raw]).size;
}

function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;

    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)} KB`;
    }

    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// ==========================================
// CRYPTOGRAPHIC HELPERS
// ==========================================

async function hashSnapshot(raw) {
    const digest = await crypto.subtle.digest(
        "SHA-256",
        encoder.encode(raw)
    );

    return toBase64(new Uint8Array(digest));
}

function randomBytes(length) {
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    return bytes;
}

function toBase64(bytes) {
    let binary = "";
    const chunkSize = 0x8000;

    for (
        let offset = 0;
        offset < bytes.length;
        offset += chunkSize
    ) {
        binary += String.fromCharCode(
            ...bytes.subarray(offset, offset + chunkSize)
        );
    }

    return btoa(binary);
}

function fromBase64(value) {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);

    for (let index = 0; index < binary.length; index++) {
        bytes[index] = binary.charCodeAt(index);
    }

    return bytes;
}

// ==========================================
// COMPRESSION
// ==========================================

async function gzipBytes(bytes) {
    if (typeof CompressionStream === "undefined") {
        throw new Error(tx(
            "This browser does not support data compression required for Cloud Sync.",
            "Trình duyệt không hỗ trợ nén dữ liệu cần thiết cho Cloud Sync."
        ));
    }

    const stream = new Blob([bytes])
        .stream()
        .pipeThrough(new CompressionStream("gzip"));

    return new Uint8Array(
        await new Response(stream).arrayBuffer()
    );
}

async function gunzipBytes(bytes) {
    if (typeof DecompressionStream === "undefined") {
        throw new Error(tx(
            "This browser does not support decompression required for Cloud Sync.",
            "Trình duyệt không hỗ trợ giải nén dữ liệu cần thiết cho Cloud Sync."
        ));
    }

    const stream = new Blob([bytes])
        .stream()
        .pipeThrough(new DecompressionStream("gzip"));

    return new Uint8Array(
        await new Response(stream).arrayBuffer()
    );
}

// ==========================================
// KEY DERIVATION
// PBKDF2 -> AES-GCM 256-bit
// ==========================================

async function deriveEncryptionKey(passphrase, saltBytes) {
    if (
        typeof passphrase !== "string" ||
        passphrase.length < 12
    ) {
        throw new Error(tx(
            "Use a sync passphrase with at least 12 characters.",
            "Mật khẩu đồng bộ cần ít nhất 12 ký tự."
        ));
    }

    const baseKey = await crypto.subtle.importKey(
        "raw",
        encoder.encode(passphrase),
        "PBKDF2",
        false,
        ["deriveKey"]
    );

    return crypto.subtle.deriveKey(
        {
            name: "PBKDF2",
            salt: saltBytes,
            iterations: PBKDF2_ITERATIONS,
            hash: "SHA-256"
        },
        baseKey,
        {
            name: "AES-GCM",
            length: 256
        },
        false,
        ["encrypt", "decrypt"]
    );
}
// ==========================================
// ENCRYPTION
// ==========================================

async function encryptDatabase(
    raw,
    syncId,
    passphrase,
    saltBase64
) {
    const saltBytes = fromBase64(saltBase64);

    const key = await deriveEncryptionKey(
        passphrase,
        saltBytes
    );

    const compressed = await gzipBytes(
        encoder.encode(raw)
    );

    const iv = randomBytes(12);

    const additionalData = encoder.encode(
        `RESTART_SYNC_V1:${syncId}`
    );

    const encrypted = await crypto.subtle.encrypt(
        {
            name: "AES-GCM",
            iv,
            additionalData
        },
        key,
        compressed
    );

    const ciphertext = toBase64(
        new Uint8Array(encrypted)
    );

    if (ciphertext.length > MAX_CIPHERTEXT_CHARS) {
        throw new Error(tx(
            "This RE:START database is too large for one D1 sync record. Export a local backup and reduce old records before syncing.",
            "Dữ liệu RE:START quá lớn cho một bản ghi D1. Hãy xuất bản sao lưu và giảm dữ liệu cũ trước khi đồng bộ."
        ));
    }

    return {
        salt: saltBase64,
        iv: toBase64(iv),
        ciphertext,
        format: "gzip-json-v1"
    };
}

// ==========================================
// DECRYPTION
// ==========================================

async function decryptDatabase(
    remote,
    syncId,
    passphrase
) {
    if (remote.format !== "gzip-json-v1") {
        throw new Error(tx(
            "Unsupported cloud snapshot format.",
            "Định dạng dữ liệu đám mây không được hỗ trợ."
        ));
    }

    const saltBytes = fromBase64(remote.salt);
    const iv = fromBase64(remote.iv);
    const ciphertext = fromBase64(remote.ciphertext);

    const key = await deriveEncryptionKey(
        passphrase,
        saltBytes
    );

    const decrypted = await crypto.subtle.decrypt(
        {
            name: "AES-GCM",
            iv,
            additionalData: encoder.encode(
                `RESTART_SYNC_V1:${syncId}`
            )
        },
        key,
        ciphertext
    );

    const uncompressed = await gunzipBytes(
        new Uint8Array(decrypted)
    );

    const raw = decoder.decode(uncompressed);

    let database;

    try {
        database = JSON.parse(raw);
    } catch {
        throw new Error(tx(
            "Cloud data could not be decoded. Check the sync passphrase.",
            "Không giải mã được dữ liệu đám mây. Hãy kiểm tra mật khẩu đồng bộ."
        ));
    }

    if (
        !database ||
        typeof database !== "object" ||
        !database.settings ||
        !database.study ||
        !database.sleep ||
        !Array.isArray(database.journal) ||
        !Array.isArray(database.goals)
    ) {
        throw new Error(tx(
            "Cloud data does not match the RE:START database structure.",
            "Dữ liệu đám mây không khớp cấu trúc RE:START."
        ));
    }

    return {
        raw,
        database
    };
}

// ==========================================
// LOCAL BACKUP
// ==========================================

function downloadLocalBackup(raw) {
    const blob = new Blob(
        [raw],
        { type: "application/json;charset=utf-8" }
    );

    const url = URL.createObjectURL(blob);

    const anchor = document.createElement("a");

    anchor.href = url;

    anchor.download =
        `restart-local-backup-before-sync-${new Date().toISOString().slice(0, 10)}.json`;

    document.body.appendChild(anchor);

    anchor.click();

    anchor.remove();

    setTimeout(
        () => URL.revokeObjectURL(url),
        1500
    );
}

// ==========================================
// SYNC ID
// ==========================================

function validateSyncId(value) {
    return /^[a-f0-9]{32}$/i.test(
        String(value || "")
    );
}

function createLocalSyncId() {
    return Array.from(
        randomBytes(16),
        byte => byte.toString(16).padStart(2, "0")
    ).join("");
}

// ==========================================
// WORKER REQUESTS
// ==========================================

async function workerRequest(path, options = {}) {
    const connection = getWorkerConnection();

    if (!connection.endpoint || !connection.password) {
        throw new Error(tx(
            "Set the Worker URL and app access password first. Use the same connection as AI Chat.",
            "Hãy nhập địa chỉ Worker và mật khẩu ứng dụng trước. Có thể dùng lại kết nối ở AI Chat."
        ));
    }

    const parsed = new URL(connection.endpoint);

    const isLocal = [
        "localhost",
        "127.0.0.1"
    ].includes(parsed.hostname);

    if (
        parsed.protocol !== "https:" &&
        !isLocal
    ) {
        throw new Error(tx(
            "The Worker URL must use HTTPS.",
            "Địa chỉ Worker phải sử dụng HTTPS."
        ));
    }

    const headers = new Headers(
        options.headers || {}
    );

    headers.set(
        "Authorization",
        `Bearer ${connection.password}`
    );

    if (options.body) {
        headers.set("Content-Type", "application/json");
    }

    const response = await fetch(
        `${connection.endpoint}${path}`,
        {
            ...options,
            headers,
            cache: "no-store"
        }
    );

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
        const error = new Error(
            payload.error ||
            `Request failed (${response.status})`
        );

        error.status = response.status;
        error.payload = payload;

        throw error;
    }

    return payload;
}

async function pullRemote(syncId) {
    return workerRequest(
        `/api/sync/pull?syncId=${encodeURIComponent(syncId)}`,
        { method: "GET" }
    );
}

async function pushRemote(
    syncId,
    encrypted,
    expectedRevision
) {
    return workerRequest(
        "/api/sync/push",
        {
            method: "POST",
            body: JSON.stringify({
                syncId,
                ...encrypted,
                expectedRevision
            })
        }
    );
}

// ==========================================
// WORKER CONNECTION UI
// ==========================================

function renderConnectionNotice() {
    const connection = getWorkerConnection();

    const connected = Boolean(
        connection.endpoint &&
        connection.password
    );

    if (connected) {
        return `
            <div class="m09-connection-state is-connected">
                <span class="m09-status-dot"></span>
                <div>
                    <strong>
                        ${escapeHTML(tx(
                            "Worker connected",
                            "Worker đã kết nối"
                        ))}
                    </strong>

                    <small>
                        ${escapeHTML(connection.endpoint)}
                    </small>
                </div>
            </div>
        `;
    }

    return `
        <div class="m09-connection-form">
            <h3>
                ${escapeHTML(tx(
                    "Connect to your Worker",
                    "Kết nối Worker"
                ))}
            </h3>

            <p>
                ${escapeHTML(tx(
                    "You can reuse the Worker URL and app password already entered in AI Chat.",
                    "Mày có thể dùng lại địa chỉ Worker và mật khẩu ứng dụng đã nhập trong AI Chat."
                ))}
            </p>

            <label>
                ${escapeHTML(tx("Worker URL", "Địa chỉ Worker"))}

                <input
                    id="m09-worker-url"
                    type="url"
                    placeholder="https://your-worker.workers.dev"
                    autocomplete="url"
                >
            </label>

            <label>
                ${escapeHTML(tx(
                    "App access password",
                    "Mật khẩu ứng dụng"
                ))}

                <input
                    id="m09-worker-password"
                    type="password"
                    autocomplete="off"
                >
            </label>

            <button
                type="button"
                class="primary-button"
                id="m09-save-worker"
            >
                ${escapeHTML(tx(
                    "Save connection",
                    "Lưu kết nối"
                ))}
            </button>
        </div>
    `;
}

// ==========================================
// SYNC SETUP UI
// ==========================================

function renderSyncSetup() {
    const modeNew = currentMode === "new";

    return `
        <section class="m09-card m09-setup-card">

            <div class="m09-card-heading">
                <div>
                    <span class="m09-eyebrow">
                        ${escapeHTML(tx(
                            "PRIVATE CLOUD VAULT",
                            "KHO ĐÁM MÂY RIÊNG TƯ"
                        ))}
                    </span>

                    <h2>
                        ${escapeHTML(tx(
                            "Set up Cloud Sync",
                            "Thiết lập Cloud Sync"
                        ))}
                    </h2>

                    <p>
                        ${escapeHTML(tx(
                            "Create a new encrypted sync space or connect another device to an existing one.",
                            "Tạo kho đồng bộ được mã hóa hoặc kết nối thiết bị khác vào kho hiện có."
                        ))}
                    </p>
                </div>

                <span class="m09-cloud-icon">☁</span>
            </div>

            <div class="m09-mode-switch">
                <button
                    type="button"
                    data-m09-mode="new"
                    class="${modeNew ? "active" : ""}"
                >
                    ${escapeHTML(tx("Create new", "Tạo mới"))}
                </button>

                <button
                    type="button"
                    data-m09-mode="join"
                    class="${!modeNew ? "active" : ""}"
                >
                    ${escapeHTML(tx(
                        "Connect existing",
                        "Kết nối kho có sẵn"
                    ))}
                </button>
            </div>

            ${!modeNew ? `
                <label class="m09-field">
                    <span>
                        ${escapeHTML(tx("Sync ID", "Mã đồng bộ"))}
                    </span>

                    <input
                        id="m09-existing-id"
                        type="text"
                        maxlength="32"
                        placeholder="32-character Sync ID"
                        autocomplete="off"
                    >
                </label>
            ` : `
                <div class="m09-note">
                    ${escapeHTML(tx(
                        "A new random Sync ID will be generated. Save it somewhere safe so you can connect another device.",
                        "Một mã Sync ID ngẫu nhiên sẽ được tạo. Hãy lưu mã này ở nơi an toàn để kết nối thiết bị khác."
                    ))}
                </div>
            `}

            <label class="m09-field">
                <span>
                    ${escapeHTML(tx(
                        "Sync passphrase",
                        "Mật khẩu đồng bộ"
                    ))}
                </span>

                <input
                    id="m09-passphrase"
                    type="password"
                    minlength="12"
                    autocomplete="new-password"
                    placeholder="${escapeHTML(tx(
                        "At least 12 characters",
                        "Ít nhất 12 ký tự"
                    ))}"
                >
            </label>

            ${modeNew ? `
                <label class="m09-field">
                    <span>
                        ${escapeHTML(tx(
                            "Confirm passphrase",
                            "Xác nhận mật khẩu"
                        ))}
                    </span>

                    <input
                        id="m09-passphrase-confirm"
                        type="password"
                        minlength="12"
                        autocomplete="new-password"
                    >
                </label>
            ` : ""}

            <button
                type="button"
                class="primary-button"
                id="m09-create-or-join"
                ${busy ? "disabled" : ""}
            >
                ${escapeHTML(modeNew
                    ? tx(
                        "Create encrypted sync space",
                        "Tạo kho đồng bộ mã hóa"
                    )
                    : tx(
                        "Connect and download cloud data",
                        "Kết nối và tải dữ liệu đám mây"
                    )
                )}
            </button>
        </section>
    `;
}
// ==========================================
// CONFLICT UI
// ==========================================

function renderConflictPanel() {
    if (!pendingRemote) return "";

    return `
        <section class="m09-card m09-conflict-card">

            <span class="m09-eyebrow">
                ${escapeHTML(tx(
                    "SYNC CONFLICT",
                    "XUNG ĐỘT ĐỒNG BỘ"
                ))}
            </span>

            <h2>
                ${escapeHTML(tx(
                    "Both copies have changed",
                    "Cả hai bản dữ liệu đều đã thay đổi"
                ))}
            </h2>

            <p>
                ${escapeHTML(tx(
                    "The cloud copy was updated on another device while this device also has local changes. Choose which version should become the current copy. A local backup will be downloaded before applying cloud data.",
                    "Bản đám mây đã được cập nhật trên thiết bị khác trong khi thiết bị này cũng có thay đổi cục bộ. Hãy chọn bản muốn giữ. Một bản sao lưu cục bộ sẽ được tải xuống trước khi áp dụng dữ liệu đám mây."
                ))}
            </p>

            <div class="m09-conflict-actions">
                <button
                    type="button"
                    class="secondary-button"
                    id="m09-use-local"
                >
                    ${escapeHTML(tx(
                        "Keep this device's data",
                        "Giữ dữ liệu trên thiết bị này"
                    ))}
                </button>

                <button
                    type="button"
                    class="primary-button"
                    id="m09-use-cloud"
                >
                    ${escapeHTML(tx(
                        "Use cloud data",
                        "Dùng dữ liệu đám mây"
                    ))}
                </button>
            </div>
        </section>
    `;
}

// ==========================================
// CONNECTED DEVICE UI
// ==========================================

function renderConnected(config) {
    const lastSync = config.lastSyncedAt
        ? new Date(config.lastSyncedAt).toLocaleString(
            getLanguage() === "vi" ? "vi-VN" : "en-US"
        )
        : tx("Not synced yet", "Chưa đồng bộ lần nào");

    return `
        <section class="m09-card m09-connected-card">

            <div class="m09-card-heading">
                <div>
                    <span class="m09-eyebrow">
                        ${escapeHTML(tx(
                            "SYNC SPACE CONNECTED",
                            "ĐÃ KẾT NỐI KHO ĐỒNG BỘ"
                        ))}
                    </span>

                    <h2>
                        ${escapeHTML(tx(
                            "Your cloud vault",
                            "Kho đám mây của mày"
                        ))}
                    </h2>

                    <p>
                        ${escapeHTML(tx(
                            "Your database is encrypted on this device before being uploaded.",
                            "Cơ sở dữ liệu được mã hóa trên thiết bị trước khi tải lên."
                        ))}
                    </p>
                </div>

                <span class="m09-cloud-icon">✓</span>
            </div>

            <div class="m09-sync-id-block">
                <div>
                    <small>SYNC ID</small>
                    <code id="m09-sync-id-value">
                        ${escapeHTML(config.syncId)}
                    </code>
                </div>

                <button
                    type="button"
                    class="secondary-button"
                    id="m09-copy-id"
                >
                    ${escapeHTML(tx("Copy ID", "Sao chép mã"))}
                </button>
            </div>

            <div class="m09-stat-row">
                <div>
                    <small>
                        ${escapeHTML(tx(
                            "Local data size",
                            "Dung lượng dữ liệu cục bộ"
                        ))}
                    </small>

                    <strong>
                        ${escapeHTML(formatBytes(getLocalSize()))}
                    </strong>
                </div>

                <div>
                    <small>
                        ${escapeHTML(tx(
                            "Cloud revision",
                            "Phiên bản đám mây"
                        ))}
                    </small>

                    <strong>
                        ${escapeHTML(String(config.revision || 0))}
                    </strong>
                </div>

                <div>
                    <small>
                        ${escapeHTML(tx(
                            "Last sync",
                            "Đồng bộ gần nhất"
                        ))}
                    </small>

                    <strong>
                        ${escapeHTML(lastSync)}
                    </strong>
                </div>
            </div>

            <label class="m09-field">
                <span>
                    ${escapeHTML(tx(
                        "Sync passphrase",
                        "Mật khẩu đồng bộ"
                    ))}
                </span>

                <input
                    id="m09-passphrase"
                    type="password"
                    autocomplete="current-password"
                    placeholder="${escapeHTML(tx(
                        "Enter your sync passphrase",
                        "Nhập mật khẩu đồng bộ"
                    ))}"
                >
            </label>

            <div class="m09-actions">
                <button
                    type="button"
                    class="primary-button"
                    id="m09-sync-now"
                    ${busy ? "disabled" : ""}
                >
                    ↻ ${escapeHTML(tx("Sync now", "Đồng bộ ngay"))}
                </button>

                <button
                    type="button"
                    class="secondary-button"
                    id="m09-export-backup"
                >
                    ⇩ ${escapeHTML(tx(
                        "Download local backup",
                        "Tải bản sao lưu"
                    ))}
                </button>

                <button
                    type="button"
                    class="secondary-button"
                    id="m09-disconnect"
                >
                    ${escapeHTML(tx(
                        "Disconnect this device",
                        "Ngắt kết nối thiết bị này"
                    ))}
                </button>
            </div>

        </section>

        ${renderConflictPanel()}
    `;
}

// ==========================================
// PAGE STYLES
// ==========================================

function renderStyles() {
    return `
        <style>
            #m09-sync-page {
                display: grid;
                gap: 16px;
                color: var(--text-primary);
            }

            #m09-sync-page .m09-heading {
                display: flex;
                justify-content: space-between;
                align-items: flex-start;
                gap: 14px;
                flex-wrap: wrap;
            }

            #m09-sync-page .m09-eyebrow {
                display: block;
                color: var(--accent);
                font-size: 9px;
                font-weight: 800;
                letter-spacing: 1.5px;
                margin-bottom: 7px;
            }

            #m09-sync-page .m09-heading h1 {
                font-size: clamp(24px, 4vw, 32px);
                letter-spacing: -.7px;
            }

            #m09-sync-page .m09-heading p {
                color: var(--text-secondary);
                font-size: 12px;
                line-height: 1.6;
                margin-top: 7px;
                max-width: 650px;
            }

            #m09-sync-page .m09-online-pill {
                display: inline-flex;
                align-items: center;
                gap: 7px;
                padding: 8px 11px;
                border: 1px solid var(--border);
                border-radius: 30px;
                color: var(--text-secondary);
                font-size: 10px;
                background: var(--bg-secondary);
            }

            #m09-sync-page .m09-status-dot {
                width: 7px;
                height: 7px;
                border-radius: 50%;
                background: var(--accent);
                display: inline-block;
                flex: 0 0 auto;
            }

            #m09-sync-page .m09-status-dot.offline {
                background: var(--orange);
            }

            #m09-sync-page .m09-card {
                background: var(--bg-secondary);
                border: 1px solid var(--border);
                border-radius: 15px;
                padding: 18px;
                display: grid;
                gap: 14px;
                min-width: 0;
            }

            #m09-sync-page .m09-card-heading {
                display: flex;
                justify-content: space-between;
                align-items: flex-start;
                gap: 15px;
            }

            #m09-sync-page .m09-card-heading h2 {
                font-size: 17px;
                margin: 0;
            }

            #m09-sync-page .m09-card-heading p {
                font-size: 11px;
                line-height: 1.6;
                color: var(--text-secondary);
                margin-top: 6px;
            }

            #m09-sync-page .m09-cloud-icon {
                width: 39px;
                height: 39px;
                border-radius: 12px;
                background: var(--accent-soft);
                color: var(--accent);
                display: grid;
                place-items: center;
                font-size: 19px;
                flex: 0 0 auto;
            }

            #m09-sync-page .m09-mode-switch {
                display: flex;
                gap: 6px;
                padding: 4px;
                border: 1px solid var(--border);
                border-radius: 11px;
                background: var(--bg-primary);
                width: max-content;
                max-width: 100%;
            }

            #m09-sync-page .m09-mode-switch button {
                border-radius: 8px;
                padding: 8px 12px;
                background: transparent;
                color: var(--text-secondary);
                font-size: 10px;
            }

            #m09-sync-page .m09-mode-switch button.active {
                background: var(--accent-soft);
                color: var(--accent);
                font-weight: 700;
            }

            #m09-sync-page .m09-field {
                display: grid;
                gap: 6px;
                color: var(--text-secondary);
                font-size: 11px;
                font-weight: 650;
            }

            #m09-sync-page .m09-field input {
                width: 100%;
                min-width: 0;
                padding: 11px 12px;
                border: 1px solid var(--border);
                border-radius: 9px;
                background: var(--bg-primary);
                color: var(--text-primary);
                font: inherit;
                font-weight: 400;
            }

            #m09-sync-page .m09-note {
                padding: 11px 12px;
                border-radius: 9px;
                background: var(--bg-primary);
                border: 1px solid var(--border);
                color: var(--text-secondary);
                font-size: 10px;
                line-height: 1.6;
            }

            #m09-sync-page .m09-connection-state {
                display: flex;
                align-items: center;
                gap: 10px;
                padding: 12px;
                border: 1px solid var(--border);
                border-radius: 10px;
                background: var(--bg-primary);
            }

            #m09-sync-page .m09-connection-state strong {
                display: block;
                font-size: 11px;
            }

            #m09-sync-page .m09-connection-state small {
                display: block;
                color: var(--text-muted);
                font-size: 10px;
                margin-top: 4px;
                overflow-wrap: anywhere;
            }

            #m09-sync-page .m09-connection-form {
                display: grid;
                gap: 11px;
                padding: 14px;
                border: 1px solid var(--border);
                border-radius: 12px;
                background: var(--bg-secondary);
            }

            #m09-sync-page .m09-connection-form h3 {
                font-size: 13px;
            }

            #m09-sync-page .m09-connection-form p {
                font-size: 10px;
                color: var(--text-secondary);
                line-height: 1.5;
            }

            #m09-sync-page .m09-sync-id-block {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
                padding: 12px;
                border: 1px solid var(--border);
                border-radius: 10px;
                background: var(--bg-primary);
            }

            #m09-sync-page .m09-sync-id-block small {
                display: block;
                color: var(--text-muted);
                font-size: 9px;
                letter-spacing: 1px;
                margin-bottom: 5px;
            }

            #m09-sync-page .m09-sync-id-block code {
                font-size: 12px;
                overflow-wrap: anywhere;
                user-select: all;
            }

            #m09-sync-page .m09-stat-row {
                display: grid;
                grid-template-columns: repeat(3, minmax(0, 1fr));
                gap: 9px;
            }

            #m09-sync-page .m09-stat-row > div {
                padding: 12px;
                border: 1px solid var(--border);
                border-radius: 10px;
                background: var(--bg-primary);
                min-width: 0;
            }

            #m09-sync-page .m09-stat-row small {
                display: block;
                color: var(--text-muted);
                font-size: 9px;
                line-height: 1.4;
            }

            #m09-sync-page .m09-stat-row strong {
                display: block;
                font-size: 13px;
                margin-top: 6px;
                overflow-wrap: anywhere;
            }

            #m09-sync-page .m09-actions,
            #m09-sync-page .m09-conflict-actions {
                display: flex;
                gap: 8px;
                flex-wrap: wrap;
                align-items: center;
            }

            #m09-sync-page .m09-actions button,
            #m09-sync-page .m09-conflict-actions button {
                font-size: 10px;
                padding: 9px 12px;
            }

            #m09-sync-page .m09-conflict-card {
                border-color: rgba(233,183,139,.4);
            }

            #m09-sync-page .m09-conflict-card h2 {
                font-size: 16px;
            }

            #m09-sync-page .m09-conflict-card p {
                font-size: 11px;
                color: var(--text-secondary);
                line-height: 1.65;
            }

            #m09-sync-page .m09-privacy-card {
                display: flex;
                gap: 11px;
                padding: 13px;
                border: 1px solid var(--border);
                border-radius: 11px;
                background: var(--bg-primary);
                color: var(--text-secondary);
                font-size: 10px;
                line-height: 1.65;
            }

            #m09-sync-page .m09-privacy-card strong {
                display: block;
                color: var(--text-primary);
                font-size: 11px;
                margin-bottom: 4px;
            }

            #m09-sync-page .m09-notice {
                padding: 11px 13px;
                border: 1px solid var(--border);
                border-radius: 10px;
                background: var(--bg-secondary);
                font-size: 10px;
                line-height: 1.6;
                color: var(--text-secondary);
            }

            #m09-sync-page .m09-notice.error {
                color: var(--red);
            }

            #m09-sync-page .m09-notice.success {
                color: var(--accent);
            }

            #m09-sync-page button:disabled {
                opacity: .55;
                cursor: not-allowed;
            }

            @media(max-width:650px) {
                #m09-sync-page .m09-stat-row {
                    grid-template-columns: 1fr;
                }

                #m09-sync-page .m09-card {
                    padding: 14px;
                }

                #m09-sync-page .m09-sync-id-block {
                    align-items: flex-start;
                    flex-direction: column;
                }
            }
        </style>
    `;
}
// ==========================================
// PAGE RENDER
// ==========================================

export function renderSyncPage() {
    let localInfo = "";

    try {
        readLocalDatabase();

        localInfo = `${formatBytes(getLocalSize())} ${tx(
            "stored on this device",
            "được lưu trên thiết bị này"
        )}`;

    } catch (error) {
        localInfo = error.message;
    }

    const config = readConfig();
    const online = navigator.onLine;
    const connected = Boolean(config?.syncId);

    return `
        ${renderStyles()}

        <section id="m09-sync-page">

            <header class="m09-heading">
                <div>
                    <span class="m09-eyebrow">
                        M09 · CLOUD SYNC & PWA
                    </span>

                    <h1>
                        ${escapeHTML(tx(
                            "Your data, in sync.",
                            "Dữ liệu của mày, luôn đồng bộ."
                        ))}
                    </h1>

                    <p>
                        ${escapeHTML(tx(
                            "Keep RE:START data available across your devices with an encrypted cloud copy, plus install the app and use its cached interface offline.",
                            "Giữ dữ liệu RE:START đồng bộ giữa các thiết bị bằng bản sao đám mây được mã hóa, đồng thời cài ứng dụng và dùng giao diện đã lưu khi offline."
                        ))}
                    </p>
                </div>

                <span class="m09-online-pill">
                    <i class="m09-status-dot ${online ? "" : "offline"}"></i>
                    ${escapeHTML(online
                        ? tx("Online", "Đang trực tuyến")
                        : tx("Offline", "Đang ngoại tuyến")
                    )}
                </span>
            </header>

            ${renderConnectionNotice()}

            ${connected
                ? renderConnected(config)
                : renderSyncSetup()
            }

            <aside class="m09-privacy-card">
                <span>◈</span>

                <div>
                    <strong>
                        ${escapeHTML(tx(
                            "Encrypted before upload",
                            "Mã hóa trước khi tải lên"
                        ))}
                    </strong>

                    ${escapeHTML(tx(
                        "Your database is compressed and encrypted in this browser with AES-GCM. The sync passphrase is never sent to Cloudflare. If you forget it, the cloud copy cannot be decrypted. Keep your Sync ID and passphrase in a safe place. Cloud sync requires an internet connection; local RE:START data remains available offline.",
                        "Cơ sở dữ liệu được nén và mã hóa ngay trong trình duyệt bằng AES-GCM. Mật khẩu đồng bộ không được gửi tới Cloudflare. Nếu quên mật khẩu, bản sao đám mây không thể được giải mã. Hãy lưu Sync ID và mật khẩu ở nơi an toàn. Đồng bộ đám mây cần Internet; dữ liệu RE:START cục bộ vẫn dùng được offline."
                    ))}
                </div>
            </aside>

            <div class="m09-note">
                ${escapeHTML(tx("Local data", "Dữ liệu cục bộ"))}:
                ${escapeHTML(localInfo)}.

                ${escapeHTML(tx(
                    "Sync is manual: no background overwrite or automatic upload is performed.",
                    "Đồng bộ thủ công: không tự động tải lên nền hoặc ghi đè dữ liệu."
                ))}
            </div>

            ${notice
                ? `<div class="m09-notice ${escapeHTML(noticeType)}" role="status">${escapeHTML(notice)}</div>`
                : ""
            }

        </section>
    `;
}

// ==========================================
// REFRESH
// ==========================================

function refreshPage() {
    const container = document.querySelector(".page-content");

    if (!container) return;

    container.innerHTML = renderSyncPage();

    bindSyncPage();
}

// ==========================================
// CREATE NEW SYNC SPACE
// ==========================================

async function handleCreate() {
    if (busy) return;

    const connection = getWorkerConnection();

    if (!connection.endpoint || !connection.password) {
        throw new Error(tx(
            "Connect the Worker first using the fields above.",
            "Hãy kết nối Worker trước bằng các ô phía trên."
        ));
    }

    const passphrase =
        document.querySelector("#m09-passphrase")?.value || "";

    const confirm =
        document.querySelector("#m09-passphrase-confirm")?.value || "";

    if (passphrase.length < 12) {
        throw new Error(tx(
            "Use at least 12 characters for the sync passphrase.",
            "Mật khẩu đồng bộ cần ít nhất 12 ký tự."
        ));
    }

    if (passphrase !== confirm) {
        throw new Error(tx(
            "The two passphrases do not match.",
            "Hai mật khẩu không khớp."
        ));
    }

    busy = true;
    syncPassphrase = passphrase;

    setNotice(
        tx(
            "Creating encrypted sync space...",
            "Đang tạo kho đồng bộ mã hóa..."
        ),
        "info"
    );

    refreshPage();

    try {
        const { raw, database } = readLocalDatabase();

        const syncId = createLocalSyncId();
        const salt = toBase64(randomBytes(16));

        const encrypted = await encryptDatabase(
            raw,
            syncId,
            passphrase,
            salt
        );

        const result = await pushRemote(
            syncId,
            encrypted,
            0
        );

        saveConfig({
            syncId,
            salt,
            revision: result.revision,
            lastSyncedLocalUpdatedAt: getLocalUpdatedAt(database),
            lastSyncedHash: await hashSnapshot(raw),
            lastSyncedAt: result.updatedAt || new Date().toISOString()
        });

        pendingRemote = null;

        setNotice(
            tx(
                "Encrypted cloud sync space created. Save the Sync ID and passphrase before connecting another device.",
                "Đã tạo kho đồng bộ mã hóa. Hãy lưu Sync ID và mật khẩu trước khi kết nối thiết bị khác."
            ),
            "success"
        );

    } catch (error) {
        setNotice(
            error.message || tx(
                "Could not create the sync space.",
                "Không thể tạo kho đồng bộ."
            ),
            "error"
        );

    } finally {
        busy = false;
        refreshPage();
    }
}

// ==========================================
// JOIN EXISTING SYNC SPACE
// ==========================================

async function handleJoin() {
    if (busy) return;

    const connection = getWorkerConnection();

    if (!connection.endpoint || !connection.password) {
        throw new Error(tx(
            "Connect the Worker first using the fields above.",
            "Hãy kết nối Worker trước bằng các ô phía trên."
        ));
    }

    const syncId = String(
        document.querySelector("#m09-existing-id")?.value || ""
    ).trim().toLowerCase();

    const passphrase =
        document.querySelector("#m09-passphrase")?.value || "";

    if (!validateSyncId(syncId)) {
        throw new Error(tx(
            "Enter a valid 32-character Sync ID.",
            "Hãy nhập Sync ID hợp lệ gồm 32 ký tự."
        ));
    }

    if (passphrase.length < 12) {
        throw new Error(tx(
            "Use at least 12 characters for the sync passphrase.",
            "Mật khẩu đồng bộ cần ít nhất 12 ký tự."
        ));
    }

    busy = true;
    syncPassphrase = passphrase;

    setNotice(
        tx(
            "Connecting and downloading encrypted data...",
            "Đang kết nối và tải dữ liệu mã hóa..."
        ),
        "info"
    );

    refreshPage();

    try {
        const remote = await pullRemote(syncId);

        if (!remote.exists) {
            throw new Error(tx(
                "No cloud snapshot was found for this Sync ID.",
                "Không tìm thấy bản dữ liệu đám mây cho Sync ID này."
            ));
        }

        const decrypted = await decryptDatabase(
            remote,
            syncId,
            passphrase
        );

        const local = readLocalDatabase();

        const confirmed = window.confirm(tx(
            "The cloud data was decrypted successfully. RE:START will download a backup of this device's current data, then replace the local database with the cloud copy. Continue?",
            "Giải mã dữ liệu đám mây thành công. RE:START sẽ tải bản sao lưu dữ liệu hiện tại của thiết bị, sau đó thay dữ liệu cục bộ bằng bản đám mây. Tiếp tục?"
        ));

        if (!confirmed) return;

        downloadLocalBackup(local.raw);

        localStorage.setItem(
            DATABASE_KEY,
            decrypted.raw
        );

        saveConfig({
            syncId,
            salt: remote.salt,
            revision: remote.revision,
            lastSyncedLocalUpdatedAt: getLocalUpdatedAt(decrypted.database),
            lastSyncedHash: await hashSnapshot(decrypted.raw),
            lastSyncedAt: remote.updatedAt || new Date().toISOString()
        });

        setNotice(
            tx(
                "This device is now connected to the cloud vault. Reloading RE:START...",
                "Thiết bị đã kết nối với kho đám mây. Đang tải lại RE:START..."
            ),
            "success"
        );

        window.location.reload();

    } catch (error) {
        setNotice(
            error.message || tx(
                "Could not connect to the cloud vault.",
                "Không thể kết nối kho đám mây."
            ),
            "error"
        );

    } finally {
        busy = false;
        refreshPage();
    }
}

// ==========================================
// MANUAL SYNC
// ==========================================

async function handleSync() {
    if (busy) return;

    const config = readConfig();

    if (!config?.syncId) {
        throw new Error(tx(
            "No sync space is configured.",
            "Chưa có kho đồng bộ nào được thiết lập."
        ));
    }

    const passphrase =
        document.querySelector("#m09-passphrase")?.value ||
        syncPassphrase;

    if (passphrase.length < 12) {
        throw new Error(tx(
            "Enter your sync passphrase.",
            "Hãy nhập mật khẩu đồng bộ."
        ));
    }

    busy = true;
    syncPassphrase = passphrase;

    setNotice(
        tx(
            "Checking local and cloud versions...",
            "Đang kiểm tra phiên bản cục bộ và đám mây..."
        ),
        "info"
    );

    refreshPage();

    try {
        const local = readLocalDatabase();
        const remote = await pullRemote(config.syncId);

        // Cloud snapshot missing: create it.
        if (!remote.exists) {
            const encrypted = await encryptDatabase(
                local.raw,
                config.syncId,
                passphrase,
                config.salt
            );

            const pushed = await pushRemote(
                config.syncId,
                encrypted,
                0
            );

            saveConfig({
                ...config,
                revision: pushed.revision,
                lastSyncedLocalUpdatedAt: getLocalUpdatedAt(local.database),
                lastSyncedHash: await hashSnapshot(local.raw),
                lastSyncedAt: pushed.updatedAt || new Date().toISOString()
            });

            setNotice(
                tx(
                    "Local data uploaded. Cloud sync is up to date.",
                    "Đã tải dữ liệu cục bộ lên. Cloud Sync đã cập nhật."
                ),
                "success"
            );

            return;
        }

        if (
            remote.revision <
            Number(config.revision || 0)
        ) {
            throw new Error(tx(
                "The cloud revision is older than this device's last known revision. Sync was stopped for safety.",
                "Phiên bản đám mây cũ hơn phiên bản thiết bị đã biết. Đã dừng đồng bộ để an toàn."
            ));
        }

        const localHash = await hashSnapshot(local.raw);

        const localChanged =
            localHash !== String(config.lastSyncedHash || "");

        const cloudChanged =
            remote.revision > Number(config.revision || 0);

        // Both copies changed.
        if (cloudChanged && localChanged) {
            pendingRemote = remote;

            setNotice(
                tx(
                    "Sync conflict detected. Choose which copy to keep.",
                    "Phát hiện xung đột đồng bộ. Hãy chọn bản muốn giữ."
                ),
                "error"
            );

            return;
        }

        // Only cloud changed.
        if (cloudChanged && !localChanged) {
            const decrypted = await decryptDatabase(
                remote,
                config.syncId,
                passphrase
            );

            downloadLocalBackup(local.raw);

            localStorage.setItem(
                DATABASE_KEY,
                decrypted.raw
            );

            saveConfig({
                ...config,
                salt: remote.salt,
                revision: remote.revision,
                lastSyncedLocalUpdatedAt: getLocalUpdatedAt(decrypted.database),
                lastSyncedHash: await hashSnapshot(decrypted.raw),
                lastSyncedAt: remote.updatedAt || new Date().toISOString()
            });

            setNotice(
                tx(
                    "Cloud changes downloaded. Reloading RE:START...",
                    "Đã tải thay đổi từ đám mây. Đang tải lại RE:START..."
                ),
                "success"
            );

            window.location.reload();
            return;
        }

        // Nothing changed.
        if (!localChanged) {
            saveConfig({
                ...config,
                lastSyncedAt: remote.updatedAt || config.lastSyncedAt
            });

            setNotice(
                tx(
                    "Already up to date. No changes needed.",
                    "Dữ liệu đã mới nhất. Không cần thay đổi."
                ),
                "success"
            );

            return;
        }

        // Only local changed: upload a new revision.
        const encrypted = await encryptDatabase(
            local.raw,
            config.syncId,
            passphrase,
            config.salt
        );

        const pushed = await pushRemote(
            config.syncId,
            encrypted,
            remote.revision
        );

        saveConfig({
            ...config,
            revision: pushed.revision,
            lastSyncedLocalUpdatedAt: getLocalUpdatedAt(local.database),
            lastSyncedHash: localHash,
            lastSyncedAt: pushed.updatedAt || new Date().toISOString()
        });

        setNotice(
            tx(
                "Local changes uploaded. Cloud sync is up to date.",
                "Đã tải thay đổi cục bộ lên. Cloud Sync đã cập nhật."
            ),
            "success"
        );

    } catch (error) {
        if (error.status === 409) {
            try {
                pendingRemote = await pullRemote(config.syncId);

                setNotice(
                    tx(
                        "Another device updated the cloud copy. Choose which copy to keep.",
                        "Thiết bị khác vừa cập nhật bản đám mây. Hãy chọn bản muốn giữ."
                    ),
                    "error"
                );

            } catch (pullError) {
                setNotice(pullError.message, "error");
            }

        } else {
            setNotice(
                error.message || tx(
                    "Cloud sync failed.",
                    "Đồng bộ đám mây thất bại."
                ),
                "error"
            );
        }

    } finally {
        busy = false;
        refreshPage();
    }
}

// ==========================================
// CONFLICT RESOLUTION
// ==========================================

async function resolveConflict(choice) {
    if (busy || !pendingRemote) return;

    const config = readConfig();

    const passphrase =
        document.querySelector("#m09-passphrase")?.value ||
        syncPassphrase;

    if (passphrase.length < 12) {
        setNotice(
            tx(
                "Enter your sync passphrase before resolving the conflict.",
                "Hãy nhập mật khẩu đồng bộ trước khi xử lý xung đột."
            ),
            "error"
        );

        refreshPage();
        return;
    }

    busy = true;
    syncPassphrase = passphrase;

    const remote = pendingRemote;
    pendingRemote = null;

    try {
        // Keep cloud version.
        if (choice === "cloud") {
            const decrypted = await decryptDatabase(
                remote,
                config.syncId,
                passphrase
            );

            const local = readLocalDatabase();

            downloadLocalBackup(local.raw);

            localStorage.setItem(
                DATABASE_KEY,
                decrypted.raw
            );

            saveConfig({
                ...config,
                salt: remote.salt,
                revision: remote.revision,
                lastSyncedLocalUpdatedAt: getLocalUpdatedAt(decrypted.database),
                lastSyncedHash: await hashSnapshot(decrypted.raw),
                lastSyncedAt: remote.updatedAt || new Date().toISOString()
            });

            setNotice(
                tx(
                    "Cloud copy applied. Reloading RE:START...",
                    "Đã áp dụng bản đám mây. Đang tải lại RE:START..."
                ),
                "success"
            );

            window.location.reload();
            return;
        }

        // Keep local version and upload it.
        const local = readLocalDatabase();

        const localHash = await hashSnapshot(local.raw);

        const encrypted = await encryptDatabase(
            local.raw,
            config.syncId,
            passphrase,
            config.salt
        );

        const pushed = await pushRemote(
            config.syncId,
            encrypted,
            remote.revision
        );

        saveConfig({
            ...config,
            revision: pushed.revision,
            lastSyncedLocalUpdatedAt: getLocalUpdatedAt(local.database),
            lastSyncedHash: localHash,
            lastSyncedAt: pushed.updatedAt || new Date().toISOString()
        });

        setNotice(
            tx(
                "This device's copy is now the cloud copy.",
                "Dữ liệu trên thiết bị này đã trở thành bản đám mây."
            ),
            "success"
        );

    } catch (error) {
        setNotice(
            error.message || tx(
                "Could not resolve the sync conflict.",
                "Không thể xử lý xung đột đồng bộ."
            ),
            "error"
        );

    } finally {
        busy = false;
        refreshPage();
    }
}

// ==========================================
// WORKER CONNECTION
// ==========================================

function saveWorkerConnection() {
    const endpoint = String(
        document.querySelector("#m09-worker-url")?.value || ""
    ).trim().replace(/\/+$/, "");

    const password = String(
        document.querySelector("#m09-worker-password")?.value || ""
    ).trim();

    if (!endpoint || !password) {
        throw new Error(tx(
            "Enter both Worker URL and app password.",
            "Hãy nhập cả địa chỉ Worker và mật khẩu ứng dụng."
        ));
    }

    const parsed = new URL(endpoint);

    const local = [
        "localhost",
        "127.0.0.1"
    ].includes(parsed.hostname);

    if (
        parsed.protocol !== "https:" &&
        !local
    ) {
        throw new Error(tx(
            "Worker URL must use HTTPS.",
            "Địa chỉ Worker phải dùng HTTPS."
        ));
    }

    localStorage.setItem(
        AI_CONFIG_KEY,
        JSON.stringify({ endpoint })
    );

    sessionStorage.setItem(
        SESSION_PASSWORD_KEY,
        password
    );

    setNotice(
        tx(
            "Worker connection saved for this browser session.",
            "Đã lưu kết nối Worker cho phiên trình duyệt này."
        ),
        "success"
    );

    refreshPage();
}

// ==========================================
// LOCAL BACKUP & DISCONNECT
// ==========================================

function backupLocal() {
    const { raw } = readLocalDatabase();

    downloadLocalBackup(raw);

    setNotice(
        tx(
            "Local backup download started.",
            "Đã bắt đầu tải bản sao lưu cục bộ."
        ),
        "success"
    );

    refreshPage();
}

function disconnectDevice() {
    const confirmed = window.confirm(tx(
        "Disconnect this device from Cloud Sync? The cloud copy will NOT be deleted and local RE:START data will remain unchanged.",
        "Ngắt thiết bị này khỏi Cloud Sync? Bản đám mây KHÔNG bị xóa và dữ liệu RE:START cục bộ vẫn được giữ nguyên."
    ));

    if (!confirmed) return;

    localStorage.removeItem(SYNC_CONFIG_KEY);

    syncPassphrase = "";
    pendingRemote = null;

    setNotice(
        tx(
            "This device has been disconnected. Local data is unchanged.",
            "Thiết bị đã ngắt kết nối. Dữ liệu cục bộ không bị thay đổi."
        ),
        "success"
    );

    refreshPage();
}

// ==========================================
// EVENT BINDING
// ==========================================

export function bindSyncPage() {
    const root = document.querySelector("#m09-sync-page");

    if (!root || root.dataset.bound === "true") return;

    root.dataset.bound = "true";

    document.querySelectorAll("[data-m09-mode]").forEach(button => {
        button.addEventListener("click", () => {
            currentMode = button.dataset.m09Mode === "join"
                ? "join"
                : "new";

            setNotice("", "info");
            refreshPage();
        });
    });

    document.querySelector("#m09-save-worker")?.addEventListener(
        "click",
        () => {
            try {
                saveWorkerConnection();
            } catch (error) {
                setNotice(error.message, "error");
                refreshPage();
            }
        }
    );

    document.querySelector("#m09-create-or-join")?.addEventListener(
        "click",
        async () => {
            try {
                if (currentMode === "new") {
                    await handleCreate();
                } else {
                    await handleJoin();
                }
            } catch (error) {
                setNotice(
                    error.message || tx(
                        "Could not continue.",
                        "Không thể tiếp tục."
                    ),
                    "error"
                );

                refreshPage();
            }
        }
    );

    document.querySelector("#m09-sync-now")?.addEventListener(
        "click",
        async () => {
            try {
                await handleSync();
            } catch (error) {
                setNotice(error.message, "error");
                refreshPage();
            }
        }
    );

    document.querySelector("#m09-use-local")?.addEventListener(
        "click",
        () => resolveConflict("local")
    );

    document.querySelector("#m09-use-cloud")?.addEventListener(
        "click",
        () => resolveConflict("cloud")
    );

    document.querySelector("#m09-export-backup")?.addEventListener(
        "click",
        backupLocal
    );

    document.querySelector("#m09-disconnect")?.addEventListener(
        "click",
        disconnectDevice
    );

    document.querySelector("#m09-copy-id")?.addEventListener(
        "click",
        async () => {
            const id = readConfig()?.syncId;
            if (!id) return;

            try {
                await navigator.clipboard.writeText(id);

                setNotice(
                    tx(
                        "Sync ID copied. Store it somewhere safe.",
                        "Đã sao chép Sync ID. Hãy lưu ở nơi an toàn."
                    ),
                    "success"
                );

            } catch {
                setNotice(
                    tx(
                        "Select and copy the Sync ID manually.",
                        "Hãy chọn và sao chép Sync ID thủ công."
                    ),
                    "info"
                );
            }

            refreshPage();
        }
    );
}
