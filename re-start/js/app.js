import {
    getCurrentPage,
    getPageInfo,
    getAllPages
} from "./router.js";

import { renderStudyPage } from "../pages/study.js";

import {
    renderSettingsPage,
    bindSettingsPage
} from "../pages/settings.js";

import {
    renderSleepPage,
    bindSleepPage
} from "../pages/sleep.js";

import {
    renderAnalyticsPage,
    bindAnalyticsPage
} from "../pages/analytics.js";

import {
    renderCalendarPage,
    bindCalendarPage
} from "../pages/calendar.js";

import {
    renderJournalPage,
    bindJournalPage
} from "../pages/journal.js";

import {
    renderAcademicPage,
    bindAcademicPage
} from "../pages/academic.js";

import {
    renderInsightsPage,
    bindInsightsPage
} from "../pages/insights.js";

import {
    renderSyncPage,
    bindSyncPage
} from "../pages/sync.js";

import {
    initializePWA,
    renderPWAControls
} from "./pwa.js";

import { createPomodoro } from "./timer.js";

import {
    getSettings,
    initializeStorage,
    saveSettings
} from "./storage.js";

import {
    applyTranslations,
    observeTranslations
} from "./i18n.js";

// ==========================================
// APP INITIALIZATION
// ==========================================

const app = document.querySelector("#app");

let studyTimer = null;

initializeStorage();

// ==========================================
// PAGE CONFIGURATION
// ==========================================

const pageIcons = {
    study: "◷",
    sleep: "☾",
    journal: "✎",
    academic: "▤",
    insights: "✧",
    sync: "☁",
    analytics: "▥",
    calendar: "▦",
    settings: "⚙"
};

const pageContent = {
    study: renderStudyPage,
    sleep: renderSleepPage,
    journal: renderJournalPage,
    academic: renderAcademicPage,
    insights: renderInsightsPage,
    sync: renderSyncPage,
    analytics: renderAnalyticsPage,
    calendar: renderCalendarPage,
    settings: renderSettingsPage
};

// ==========================================
// LANGUAGE
// ==========================================

const SUPPORTED_LANGUAGES = ["en", "vi", "bi"];

function getCurrentLanguage() {
    const language = getSettings().language;

    return SUPPORTED_LANGUAGES.includes(language)
        ? language
        : "en";
}

function applyLanguage(language) {
    const safeLanguage = SUPPORTED_LANGUAGES.includes(language)
        ? language
        : "en";

    applyTranslations(safeLanguage);

    const selector = document.querySelector("#language-select");

    if (selector) {
        selector.value = safeLanguage;
    }
}

function getPageText(page, field = "title") {
    const translations = {
        academic: {
            title: {
                en: "Academic Assistant",
                vi: "Trợ lý học tập"
            },
            subtitle: {
                en: "Organize assignments, exams and study priorities.",
                vi: "Sắp xếp bài tập, bài kiểm tra và ưu tiên học tập."
            }
        },
        insights: {
            title: {
                en: "AI Insights",
                vi: "Phân tích thông minh"
            },
            subtitle: {
                en: "Discover patterns across study, sleep and daily progress.",
                vi: "Khám phá xu hướng học tập, giấc ngủ và tiến độ hằng ngày."
            }
        },
        sync: {
            title: {
                en: "Cloud Sync",
                vi: "Đồng bộ đám mây"
            },
            subtitle: {
                en: "Keep your data in sync and install RE:START as an app.",
                vi: "Đồng bộ dữ liệu và cài RE:START như một ứng dụng."
            }
        }
    };

    const translated = translations[page]?.[field];

    if (!translated) {
        return getPageInfo(page)?.[field] || "";
    }

    const language = getCurrentLanguage();

    if (language === "vi") return translated.vi;
    if (language === "bi") return `${translated.en} · ${translated.vi}`;

    return translated.en;
}

function bindLanguageSelector() {
    const selector = document.querySelector(
        "#language-select"
    );

    if (!selector) {
        return;
    }

    selector.addEventListener("change", () => {
        const language = selector.value;

        if (!SUPPORTED_LANGUAGES.includes(language)) {
            return;
        }

        try {
            saveSettings({ language });

            const currentPage = getCurrentPage();

            // Re-render pages whose text is generated
            // directly from the selected language.
            if (
                currentPage === "analytics" ||
                currentPage === "calendar" ||
                currentPage === "journal" ||
                currentPage === "academic" ||
                currentPage === "insights" ||
                currentPage === "sync"
            ) {
                const content = document.querySelector(
                    ".page-content"
                );

                if (content) {
                    content.innerHTML =
                        pageContent[currentPage]();

                    if (currentPage === "analytics") {
                        bindAnalyticsPage();
                    }

                    if (currentPage === "calendar") {
                        bindCalendarPage();
                    }

                    if (currentPage === "journal") {
                        bindJournalPage();
                    }

                    if (currentPage === "academic") {
                        bindAcademicPage();
                    }

                    if (currentPage === "insights") {
                        bindInsightsPage();
                    }

                    if (currentPage === "sync") {
                        bindSyncPage();
                    }
                }
            }

            applyLanguage(language);

        } catch (error) {
            console.error("Could not save language:", error);

            alert(error.message);

            selector.value = getCurrentLanguage();
        }
    });
}

// ==========================================
// NAVIGATION
// ==========================================

function renderNavigation(currentPage) {
    const pages = getAllPages();

    return Object.entries(pages)
        .map(([key, page]) => `
            <a
                href="#/${key}"
                class="nav-link ${currentPage === key ? "active" : ""}"
            >
                <span class="nav-icon">
                    ${pageIcons[key] || "•"}
                </span>

                <span>${getPageText(key)}</span>
            </a>
        `)
        .join("");
}

function renderMobileNavigation(currentPage) {
    const mobilePages = [
        "study",
        "sleep",
        "academic",
        "insights",
        "sync",
        "journal",
        "analytics",
        "calendar",
        "settings"
    ];

    const pages = getAllPages();

    return mobilePages
        .filter(key => pages[key])
        .map(key => `
            <a
                href="#/${key}"
                class="${currentPage === key ? "active" : ""}"
            >
                <span class="nav-icon">
                    ${pageIcons[key] || "•"}
                </span>

                <span>${getPageText(key)}</span>
            </a>
        `)
        .join("");
}

// ==========================================
// PLACEHOLDER PAGES
// ==========================================

function renderPlaceholder(page) {
    const info = getPageInfo(page);

    return `
        <section class="page-heading">
            <h1>${info.title}</h1>
            <p>${info.subtitle}</p>
        </section>

        <div class="card placeholder-card">

            <div>
                <div class="placeholder-icon">
                    ${info.icon}
                </div>

                <h2>Coming soon</h2>

                <p style="margin-top:8px">
                    This section is being prepared.
                </p>
            </div>

        </div>
    `;
}

// ==========================================
// THEME
// ==========================================

function applyTheme(theme) {
    const safeTheme = theme === "light"
        ? "light"
        : "dark";

    document.documentElement.dataset.theme = safeTheme;

    const button = document.querySelector("#theme-toggle");

    if (button) {
        button.textContent =
            safeTheme === "dark" ? "☀" : "☾";

        button.setAttribute(
            "aria-label",
            safeTheme === "dark"
                ? "Switch to light mode"
                : "Switch to dark mode"
        );
    }
}

function toggleTheme() {
    const currentTheme =
        document.documentElement.dataset.theme;

    const nextTheme =
        currentTheme === "dark"
            ? "light"
            : "dark";

    saveSettings({
        theme: nextTheme
    });

    applyTheme(nextTheme);
}

// ==========================================
// TIME FORMATTING
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
        return `${hours}h ${minutes}m ${remainingSeconds}s`;
    }

    if (minutes > 0) {
        return `${minutes}m ${remainingSeconds}s`;
    }

    return `${remainingSeconds}s`;
}

// ==========================================
// HTML ESCAPING
// ==========================================

function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[character]);
}

// ==========================================
// SUBJECT STATISTICS
// ==========================================

function renderSubjectStatistics(statistics) {
    const container = document.querySelector(
        "#subject-statistics"
    );

    const totalElement = document.querySelector(
        "#all-subject-total"
    );

    if (!container || !totalElement) {
        return;
    }

    const subjects = Object.entries(
        statistics.studySeconds
    ).sort((a, b) => b[1] - a[1]);

    totalElement.textContent = formatDuration(
        statistics.totalStudySeconds
    );

    if (subjects.length === 0) {
        container.innerHTML = `
            <p class="empty-note">
                No study sessions recorded today.
            </p>
        `;

        return;
    }

    container.innerHTML = subjects
        .map(([name, seconds]) => {
            const percentage =
                statistics.totalStudySeconds > 0
                    ? (
                        seconds /
                        statistics.totalStudySeconds
                    ) * 100
                    : 0;

            return `
                <div style="margin-bottom:20px">

                    <div style="
                        display:flex;
                        justify-content:space-between;
                        align-items:center;
                        gap:12px;
                        margin-bottom:9px;
                    ">
                        <strong>${escapeHTML(name)}</strong>

                        <span style="
                            color:var(--accent);
                            font-weight:650;
                            font-variant-numeric:tabular-nums;
                        ">
                            ${formatDuration(seconds)}
                        </span>
                    </div>

                    <div style="
                        width:100%;
                        height:7px;
                        background:var(--bg-hover);
                        border-radius:20px;
                        overflow:hidden;
                    ">
                        <div style="
                            width:${percentage}%;
                            height:100%;
                            background:var(--accent);
                            border-radius:20px;
                            transition:width 0.3s ease;
                        "></div>
                    </div>

                    <p class="empty-note" style="margin-top:5px">
                        ${percentage.toFixed(1)}% of total study time
                    </p>

                </div>
            `;
        })
        .join("");
}
// ==========================================
// STUDY TIMER
// ==========================================

function bindStudyPage() {
    if (studyTimer) {
        studyTimer.destroy();
        studyTimer = null;
    }

    const subjectSelect = document.querySelector(
        "#subject-select"
    );

    const focusInput = document.querySelector(
        "#focus-duration"
    );

    const breakInput = document.querySelector(
        "#break-duration"
    );

    const startButton = document.querySelector(
        "#timer-start"
    );

    const pauseButton = document.querySelector(
        "#timer-pause"
    );

    const stopButton = document.querySelector(
        "#timer-stop"
    );

    const nextPanel = document.querySelector(
        "#next-subject-panel"
    );

    const nextSubject = document.querySelector(
        "#next-subject-select"
    );

    const nextStart = document.querySelector(
        "#next-subject-start"
    );

    const timerDisplay = document.querySelector(
        "#timer-display"
    );

    const timerPhase = document.querySelector(
        "#timer-phase"
    );

    const timerMessage = document.querySelector(
        "#timer-message"
    );

    const timerProgress = document.querySelector(
        "#timer-progress"
    );

    const studyStat = document.querySelector(
        "#today-study"
    );

    const breakStat = document.querySelector(
        "#today-break"
    );

    const sessionStat = document.querySelector(
        "#today-sessions"
    );

    const savedSettings = getSettings().timer;

    focusInput.value = savedSettings.focusMinutes;
    breakInput.value = savedSettings.breakMinutes;

    // CREATE TIMER
    studyTimer = createPomodoro(state => {
        timerDisplay.textContent = state.displayTime;

        const isRunning = state.isRunning;

        const isPaused =
            !isRunning &&
            ["focus", "break"].includes(state.phase);

        if (state.phase === "focus") {
            timerPhase.textContent = "FOCUS SESSION";

            timerMessage.textContent =
                `Currently studying ${state.subject}`;

        } else if (state.phase === "break") {
            timerPhase.textContent = "BREAK TIME";

            timerMessage.textContent =
                "Take a little rest. You've earned it.";

        } else if (state.phase === "choose") {
            timerPhase.textContent = "SESSION COMPLETED";

            timerMessage.textContent =
                "Choose your next subject.";

        } else {
            timerPhase.textContent = "READY TO FOCUS";

            timerMessage.textContent =
                "Choose a subject and start your session.";
        }

        startButton.hidden =
            isRunning ||
            isPaused ||
            state.phase === "break" ||
            state.phase === "choose";

        pauseButton.hidden = !isRunning && !isPaused;
        stopButton.hidden = !isRunning && !isPaused;

        pauseButton.textContent =
            isPaused ? "Resume" : "Pause";

        nextPanel.hidden = state.phase !== "choose";

        if (state.phase === "break") {
            timerProgress.textContent =
                `Break · ${state.breakMinutes} minutes`;

        } else {
            timerProgress.textContent =
                `Focus ${state.focusMinutes} min · Break ${state.breakMinutes} min`;
        }

        const settingsLocked = state.phase !== "ready";

        subjectSelect.disabled = settingsLocked;
        focusInput.disabled = settingsLocked;
        breakInput.disabled = settingsLocked;

        studyStat.textContent = formatDuration(
            state.totalStudySeconds
        );

        breakStat.textContent = formatDuration(
            state.breakSeconds
        );

        sessionStat.textContent = state.completedSessions;

        renderSubjectStatistics(state);
    });

    // READ SETTINGS
    function readSettings() {
        const focusMinutes = Number(focusInput.value);
        const breakMinutes = Number(breakInput.value);

        if (
            !Number.isInteger(focusMinutes) ||
            !Number.isInteger(breakMinutes) ||
            focusMinutes < 1 ||
            focusMinutes > 300 ||
            breakMinutes < 1 ||
            breakMinutes > 120
        ) {
            alert(
                "Focus duration must be 1–300 minutes. " +
                "Break duration must be 1–120 minutes."
            );

            return null;
        }

        const settings = {
            focusMinutes,
            breakMinutes
        };

        saveSettings({
            timer: settings
        });

        return settings;
    }

    // START FOCUS
    startButton.addEventListener("click", () => {
        const settings = readSettings();

        if (!settings) return;

        const started = studyTimer.start(
            subjectSelect.value,
            settings.focusMinutes,
            settings.breakMinutes
        );

        if (!started) {
            alert("Please select a subject before starting.");
        }
    });

    // PAUSE / RESUME
    pauseButton.addEventListener("click", () => {
        const state = studyTimer.getState();

        if (state.isRunning) {
            studyTimer.pause();
        } else {
            studyTimer.resume();
        }
    });

    // STOP
    stopButton.addEventListener("click", () => {
        const confirmed = confirm(
            "Stop this session and record the elapsed time?"
        );

        if (confirmed) {
            studyTimer.stop();
        }
    });

    // NEXT SUBJECT
    nextStart.addEventListener("click", () => {
        const settings = readSettings();

        if (!settings) return;

        const subject = nextSubject.value;

        if (!subject) {
            alert("Please choose your next subject.");
            return;
        }

        subjectSelect.value = subject;

        studyTimer.start(
            subject,
            settings.focusMinutes,
            settings.breakMinutes
        );
    });
}
// ==========================================
// MAIN RENDER
// ==========================================

function renderApp() {
    if (!app) return;

    if (studyTimer) {
        studyTimer.destroy();
        studyTimer = null;
    }

    const currentPage = getCurrentPage();
    const info = getPageInfo(currentPage);

    const content = pageContent[currentPage]
        ? pageContent[currentPage]()
        : renderPlaceholder(currentPage);

    const currentLanguage = getCurrentLanguage();

    app.innerHTML = `
        <div class="app-layout">

            <aside class="sidebar">

                <div class="brand">
                    <div class="brand-mark">R</div>

                    <div>
                        <div class="brand-name">RE:START</div>

                        <div class="brand-caption">
                            STUDY & LIFE TRACKER
                        </div>
                    </div>
                </div>

                <div class="nav-label">Workspace</div>

                <nav class="nav-list">
                    ${renderNavigation(currentPage)}
                </nav>

                <div class="sidebar-bottom">
                    <div class="card" style="padding:16px">

                        <div class="card-title">
                            A little reminder
                        </div>

                        <p style="margin-top:8px;font-size:13px">
                            Progress doesn't have to be perfect.
                            Just keep moving.
                        </p>

                    </div>
                </div>

            </aside>

            <main class="main-area">

                <header class="topbar">

                    <div class="breadcrumb">
                        Workspace / <strong>${escapeHTML(getPageText(currentPage))}</strong>
                    </div>

                    <div class="header-actions" style="
                        display:flex;
                        align-items:center;
                        gap:10px;
                    ">

                        <select
                            class="subject-select"
                            id="language-select"
                            aria-label="Language"
                            style="
                                width:auto;
                                min-width:125px;
                                max-width:160px;
                                padding:8px 10px;
                                font-size:13px;
                            "
                        >
                            <option value="en">English</option>
                            <option value="vi">Vietnamese</option>
                            <option value="bi">Bilingual</option>
                        </select>

                        <button
                            class="icon-button"
                            id="theme-toggle"
                            aria-label="Switch theme"
                        >
                            ☀
                        </button>

                    </div>

                </header>

                <div class="page-content">
                    ${content}
                </div>

            </main>

            <nav class="mobile-nav" style="grid-template-columns:none;grid-auto-flow:column;grid-auto-columns:minmax(54px,1fr);overflow-x:auto;">
                ${renderMobileNavigation(currentPage)}
            </nav>

        </div>
    `;

    applyTheme(getSettings().theme);

    // Bind page events before translation.
    if (currentPage === "study") {
        bindStudyPage();
    }

    if (currentPage === "sleep") {
        bindSleepPage();
    }

    if (currentPage === "analytics") {
        bindAnalyticsPage();
    }

    if (currentPage === "calendar") {
        bindCalendarPage();
    }

    if (currentPage === "journal") {
        bindJournalPage();
    }

    if (currentPage === "academic") {
        bindAcademicPage();
    }

    if (currentPage === "insights") {
        bindInsightsPage();
    }

    if (currentPage === "sync") {
        bindSyncPage();
    }

    if (currentPage === "settings") {
        bindSettingsPage();
    }

    applyLanguage(currentLanguage);

    bindLanguageSelector();

    document
        .querySelector("#theme-toggle")
        .addEventListener("click", toggleTheme);

    renderPWAControls();
}

// ==========================================
// APP INITIALIZATION
// ==========================================

window.addEventListener("hashchange", renderApp);

renderApp();
initializePWA();
renderPWAControls();

observeTranslations(getCurrentLanguage);