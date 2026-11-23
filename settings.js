import {
    createBackup,
    formatStorageDate,
    getSettings,
    getStorageSummary,
    importBackup,
    saveSettings
} from "../js/storage.js";

// ==========================================
// FORMATTING
// ==========================================

function formatDuration(seconds) {
    const safeSeconds = Math.max(
        0,
        Math.floor(Number(seconds) || 0)
    );

    const hours = Math.floor(safeSeconds / 3600);

    const minutes = Math.floor(
        (safeSeconds % 3600) / 60
    );

    const remainingSeconds = safeSeconds % 60;

    if (hours > 0) {
        return `${hours}h ${minutes}m`;
    }

    if (minutes > 0) {
        return `${minutes}m ${remainingSeconds}s`;
    }

    return `${remainingSeconds}s`;
}

function formatBytes(bytes) {
    if (bytes < 1024) {
        return `${bytes} B`;
    }

    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)} KB`;
    }

    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// ==========================================
// RENDER SETTINGS PAGE
// ==========================================

export function renderSettingsPage() {
    const settings = getSettings();
    const summary = getStorageSummary();

    return `
        <section class="page-heading">
            <h1>Settings</h1>

            <p>
                Manage your RE:START preferences and personal data.
            </p>
        </section>

        <!-- STORAGE STATISTICS -->

        <section class="stats-grid">

            <div class="card">
                <div class="card-title">
                    Study Days Saved
                </div>

                <div class="stat-value">
                    ${summary.studyDays}
                </div>

                <div class="stat-description">
                    Days with recorded study data
                </div>
            </div>

            <div class="card">
                <div class="card-title">
                    Recorded Study Time
                </div>

                <div class="stat-value">
                    ${formatDuration(summary.totalStudySeconds)}
                </div>

                <div class="stat-description">
                    Across all saved days
                </div>
            </div>

            <div class="card">
                <div class="card-title">
                    Study Sessions
                </div>

                <div class="stat-value">
                    ${summary.sessionCount}
                </div>

                <div class="stat-description">
                    Saved session records
                </div>
            </div>

        </section>

        <!-- TIMER SETTINGS -->

        <section class="card" style="margin-top:20px">

            <div class="card-title">
                PERSONAL PREFERENCES
            </div>

            <h2 style="margin:8px 0 6px">
                Study timer
            </h2>

            <p class="empty-note" style="margin-bottom:18px">
                Your default durations are remembered between visits.
            </p>

            <div style="
                display:grid;
                grid-template-columns:repeat(auto-fit,minmax(180px,1fr));
                gap:14px;
            ">

                <label>
                    <span
                        class="card-title"
                        style="display:block;margin-bottom:8px"
                    >
                        Focus duration (minutes)
                    </span>

                    <input
                        class="subject-select"
                        id="settings-focus-duration"
                        type="number"
                        min="1"
                        max="300"
                        step="1"
                        value="${settings.timer.focusMinutes}"
                    >
                </label>

                <label>
                    <span
                        class="card-title"
                        style="display:block;margin-bottom:8px"
                    >
                        Break duration (minutes)
                    </span>

                    <input
                        class="subject-select"
                        id="settings-break-duration"
                        type="number"
                        min="1"
                        max="120"
                        step="1"
                        value="${settings.timer.breakMinutes}"
                    >
                </label>

            </div>

            <div style="
                display:flex;
                align-items:center;
                gap:12px;
                flex-wrap:wrap;
                margin-top:16px;
            ">
                <button
                    class="primary-button"
                    id="settings-save-timer"
                >
                    Save preferences
                </button>

                <span
                    class="empty-note"
                    id="settings-save-message"
                    role="status"
                ></span>
            </div>

        </section>

        <!-- DATA MANAGEMENT -->

        <section class="card" style="margin-top:20px">

            <div class="card-title">
                DATA & BACKUP
            </div>

            <h2 style="margin:8px 0 6px">
                Your data lives on this device
            </h2>

            <p class="empty-note" style="line-height:1.7">
                RE:START currently stores its data in this browser.
                It is not synced to your phone or another computer yet.
                Export a backup regularly so you can restore your records
                if browser data is cleared or you change devices.
            </p>

            <div style="
                display:grid;
                grid-template-columns:repeat(auto-fit,minmax(180px,1fr));
                gap:14px;
                margin:20px 0;
            ">

                <div style="
                    padding:14px;
                    border-radius:12px;
                    background:var(--bg-hover);
                ">
                    <div class="card-title">
                        RE:START DATA SIZE
                    </div>

                    <div
                        class="stat-value"
                        style="font-size:22px"
                    >
                        ${formatBytes(summary.storageBytes)}
                    </div>
                </div>

                <div style="
                    padding:14px;
                    border-radius:12px;
                    background:var(--bg-hover);
                ">
                    <div class="card-title">
                        LAST SAVED
                    </div>

                    <div style="font-weight:650;margin-top:8px">
                        ${formatStorageDate(summary.lastUpdated)}
                    </div>
                </div>

            </div>

            <div style="display:flex;gap:12px;flex-wrap:wrap">

                <button
                    class="primary-button"
                    id="settings-export"
                >
                    Export backup
                </button>

                <button
                    class="secondary-button"
                    id="settings-import-trigger"
                >
                    Import backup
                </button>

                <input
                    id="settings-import-file"
                    type="file"
                    accept=".json,application/json"
                    hidden
                >

            </div>

            <p class="empty-note" style="margin-top:14px;line-height:1.6">
                Importing a backup replaces the data currently stored
                in this browser. Export your current data first if you
                may need it later.
            </p>

            <p
                class="empty-note"
                id="settings-backup-message"
                role="status"
                style="margin-top:8px"
            ></p>

        </section>
    `;
}

// ==========================================
// BIND SETTINGS EVENTS
// ==========================================

export function bindSettingsPage() {
    const saveButton = document.querySelector(
        "#settings-save-timer"
    );

    const focusInput = document.querySelector(
        "#settings-focus-duration"
    );

    const breakInput = document.querySelector(
        "#settings-break-duration"
    );

    const saveMessage = document.querySelector(
        "#settings-save-message"
    );

    // ======================================
    // SAVE TIMER PREFERENCES
    // ======================================

    saveButton?.addEventListener("click", () => {
        const focusMinutes = Number(focusInput.value);
        const breakMinutes = Number(breakInput.value);

        if (
            !Number.isInteger(focusMinutes) ||
            focusMinutes < 1 ||
            focusMinutes > 300 ||
            !Number.isInteger(breakMinutes) ||
            breakMinutes < 1 ||
            breakMinutes > 120
        ) {
            saveMessage.textContent =
                "Focus must be 1–300 minutes and break must be 1–120 minutes.";

            return;
        }

        try {
            saveSettings({
                timer: {
                    focusMinutes,
                    breakMinutes
                }
            });

            saveMessage.textContent = "Preferences saved.";
        } catch (error) {
            saveMessage.textContent = error.message;
        }
    });

    // ======================================
    // EXPORT BACKUP
    // ======================================

    document
        .querySelector("#settings-export")
        ?.addEventListener("click", () => {
            const message = document.querySelector(
                "#settings-backup-message"
            );

            try {
                const backup = createBackup();

                const blob = new Blob(
                    [JSON.stringify(backup, null, 2)],
                    {
                        type: "application/json"
                    }
                );

                const url = URL.createObjectURL(blob);

                const link = document.createElement("a");

                const date = new Date()
                    .toISOString()
                    .slice(0, 10);

                link.href = url;
                link.download = `restart-backup-${date}.json`;

                document.body.appendChild(link);

                link.click();
                link.remove();

                window.setTimeout(() => {
                    URL.revokeObjectURL(url);
                }, 1000);

                message.textContent =
                    "Backup exported successfully.";
            } catch (error) {
                message.textContent = error.message;
            }
        });

    // ======================================
    // IMPORT BACKUP
    // ======================================

    const fileInput = document.querySelector(
        "#settings-import-file"
    );

    const importButton = document.querySelector(
        "#settings-import-trigger"
    );

    importButton?.addEventListener("click", () => {
        fileInput?.click();
    });

    fileInput?.addEventListener("change", async () => {
        const file = fileInput.files?.[0];

        if (!file) {
            return;
        }

        const confirmed = window.confirm(
            "Importing this backup will replace the data currently stored in this browser. Continue?"
        );

        if (!confirmed) {
            fileInput.value = "";
            return;
        }

        const message = document.querySelector(
            "#settings-backup-message"
        );

        try {
            const content = await file.text();

            importBackup(content);

            message.textContent =
                "Backup imported. RE:START will reload.";

            window.setTimeout(() => {
                window.location.reload();
            }, 500);
        } catch (error) {
            message.textContent = error.message;
        } finally {
            fileInput.value = "";
        }
    });
}