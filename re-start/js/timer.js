
// ==========================================
// RE:START M02 - POMODORO + STOPWATCH ENGINE
// ==========================================

import {
    addSessionRecord,
    getDayRecord,
    saveDaySummary
} from "./storage.js";

const STORAGE_KEY = "restart-m02-timer";
const MODE_KEY = "restart-m02-selected-mode";

// ==========================================
// DATE
// ==========================================

function getTodayKey() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
}

// ==========================================
// DEFAULT STATE
// ==========================================

function createDefaultState() {
    const date = getTodayKey();
    const dailyRecord = getDayRecord(date);

    return {
        date,
        phase: "ready",
        mode: "pomodoro",
        subject: "",
        focusMinutes: 45,
        breakMinutes: 10,
        remainingMs: 45 * 60 * 1000,
        accumulatedMs: 0,
        startedAt: null,
        sessionStartedAt: null,
        studySeconds: { ...dailyRecord.studySeconds },
        breakSeconds: dailyRecord.breakSeconds,
        completedSessions: dailyRecord.completedSessions
    };
}

// ==========================================
// LOAD STATE
// ==========================================

function loadState() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        const saved = raw ? JSON.parse(raw) : null;

        if (!saved || typeof saved !== "object") {
            return createDefaultState();
        }

        // Keep the existing M02 daily reset behaviour.
        if (saved.date !== getTodayKey()) {
            return createDefaultState();
        }

        const dailyRecord = getDayRecord(saved.date);

        const restored = {
            ...createDefaultState(),
            ...saved,
            mode: saved.mode === "stopwatch" ? "stopwatch" : "pomodoro",
            studySeconds: { ...dailyRecord.studySeconds },
            breakSeconds: dailyRecord.breakSeconds,
            completedSessions: dailyRecord.completedSessions,
            sessionStartedAt: saved.sessionStartedAt || null
        };

        if (restored.phase === "ready") {
            const preferredMode = localStorage.getItem(MODE_KEY);

            if (["pomodoro", "stopwatch"].includes(preferredMode)) {
                restored.mode = preferredMode;
                restored.remainingMs = restored.focusMinutes * 60 * 1000;
                restored.accumulatedMs = 0;
            }
        }

        return restored;

    } catch (error) {
        console.error("Could not load timer state:", error);
        return createDefaultState();
    }
}

// ==========================================
// TIMER ENGINE
// ==========================================

export function createPomodoro(onUpdate) {
    let state = loadState();
    let interval = null;

    // ======================================
    // SAVE
    // ======================================

    function persistDailySummary() {
        saveDaySummary(state.date, {
            studySeconds: state.studySeconds,
            breakSeconds: state.breakSeconds,
            completedSessions: state.completedSessions
        });
    }

    function save() {
        try {
            localStorage.setItem(
                STORAGE_KEY,
                JSON.stringify(state)
            );

            persistDailySummary();

        } catch (error) {
            console.error("Could not save timer state:", error);
        }
    }

    // ======================================
    // TIMER CALCULATIONS
    // ======================================

    function getElapsed() {
        if (!state.startedAt) return 0;

        const elapsed = Math.max(
            0,
            Date.now() - state.startedAt
        );

        // Stopwatch mode has no preset duration.
        if (state.mode === "stopwatch") {
            return elapsed;
        }

        return Math.min(
            elapsed,
            Math.max(0, state.remainingMs)
        );
    }

    function getRemaining() {
        if (state.mode === "stopwatch") return 0;

        if (!state.startedAt) {
            return Math.max(0, state.remainingMs);
        }

        return Math.max(
            0,
            state.remainingMs - getElapsed()
        );
    }

    function getCurrentPhaseElapsed() {
        return Math.max(
            0,
            state.accumulatedMs + getElapsed()
        );
    }

    function formatTimer(milliseconds) {
        const totalSeconds = Math.ceil(
            Math.max(0, milliseconds) / 1000
        );

        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;

        return (
            String(minutes).padStart(2, "0") +
            ":" +
            String(seconds).padStart(2, "0")
        );
    }

    function formatStopwatch(milliseconds) {
        const totalSeconds = Math.floor(
            Math.max(0, milliseconds) / 1000
        );

        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;

        return [
            hours,
            minutes,
            seconds
        ]
            .map(value => String(value).padStart(2, "0"))
            .join(":");
    }

    // ======================================
    // LIVE STATISTICS
    // ======================================

    function getLiveStatistics() {
        const studySeconds = {
            ...state.studySeconds
        };

        let breakSeconds = state.breakSeconds;

        const currentElapsedSeconds = Math.floor(
            getCurrentPhaseElapsed() / 1000
        );

        if (state.phase === "focus" && state.subject) {
            studySeconds[state.subject] =
                (studySeconds[state.subject] || 0) +
                currentElapsedSeconds;
        }

        if (state.phase === "break") {
            breakSeconds += currentElapsedSeconds;
        }

        const totalStudySeconds = Object.values(studySeconds)
            .reduce(
                (total, seconds) => total + (Number(seconds) || 0),
                0
            );

        return {
            studySeconds,
            breakSeconds,
            totalStudySeconds
        };
    }

    // ======================================
    // RECORD SESSION
    // ======================================

    function addStudyTime(seconds) {
        if (!state.subject || seconds <= 0) {
            return;
        }

        state.studySeconds[state.subject] =
            (state.studySeconds[state.subject] || 0) + seconds;
    }

    function createSessionId() {
        if (globalThis.crypto?.randomUUID) {
            return globalThis.crypto.randomUUID();
        }

        return (
            `session-${Date.now()}-` +
            Math.random().toString(16).slice(2)
        );
    }

    function recordSession(type, seconds, status = "completed") {
        if (seconds <= 0) return;

        addSessionRecord(state.date, {
            id: createSessionId(),
            type,

            subject: type === "focus"
                ? state.subject
                : "",

            seconds,
            startedAt: state.sessionStartedAt,
            endedAt: new Date().toISOString(),
            status
        });
    }

    // ======================================
    // MODE-SPECIFIC UI
    // ======================================

    function syncModeUI(displayTime) {
        const selectedMode = state.phase === "ready"
            ? (localStorage.getItem(MODE_KEY) || state.mode)
            : state.mode;

        const isActive =
            state.phase === "focus" ||
            state.phase === "break";

        const timerStart = document.querySelector("#timer-start");
        const stopwatchStart = document.querySelector("#stopwatch-start");
        const timerPhase = document.querySelector("#timer-phase");
        const timerMessage = document.querySelector("#timer-message");
        const timerProgress = document.querySelector("#timer-progress");
        const timerDisplay = document.querySelector("#timer-display");

        document.querySelectorAll("[data-timer-mode]").forEach(button => {
            const active = button.dataset.timerMode === selectedMode;

            button.classList.toggle("active", active);
            button.setAttribute("aria-pressed", String(active));
            button.disabled = isActive;
        });

        document.querySelectorAll(".pomodoro-only").forEach(element => {
            element.hidden = selectedMode !== "pomodoro";
        });

        if (timerStart) {
            timerStart.hidden =
                selectedMode !== "pomodoro" ||
                state.phase !== "ready";
        }

        if (stopwatchStart) {
            stopwatchStart.hidden =
                selectedMode !== "stopwatch" ||
                state.phase !== "ready";
        }

        if (selectedMode === "stopwatch") {
            if (timerPhase) {
                if (state.phase === "focus") {
                    timerPhase.textContent = state.startedAt
                        ? "STOPWATCH SESSION"
                        : "STOPWATCH PAUSED";
                } else {
                    timerPhase.textContent = "STOPWATCH READY";
                }
            }

            if (timerMessage) {
                timerMessage.textContent = state.phase === "focus"
                    ? (
                        state.startedAt
                            ? `Tracking study time for ${state.subject}.`
                            : `Session paused · ${state.subject}`
                    )
                    : "Choose a subject and start counting.";
            }

            if (timerProgress) {
                timerProgress.textContent =
                    "No preset duration · Stop whenever you're done.";
            }

            if (timerDisplay && state.phase === "ready") {
                timerDisplay.textContent = displayTime;
            }
        }
    }

    // ======================================
    // UPDATE UI
    // ======================================

    function update() {
        const remaining = getRemaining();
        const elapsed = getCurrentPhaseElapsed();
        const statistics = getLiveStatistics();

        const displayTime = state.mode === "stopwatch"
            ? formatStopwatch(elapsed)
            : formatTimer(remaining);

        onUpdate({
            ...state,

            studySeconds: statistics.studySeconds,
            breakSeconds: statistics.breakSeconds,
            totalStudySeconds: statistics.totalStudySeconds,

            remainingMs: remaining,
            elapsedMs: elapsed,
            displayTime,
            isRunning: Boolean(state.startedAt)
        });

        syncModeUI(displayTime);

        if (
            state.mode === "pomodoro" &&
            state.startedAt &&
            remaining <= 0
        ) {
            finishPhase();
        }
    }

    function startInterval() {
        clearInterval(interval);

        // Update four times per second.
        interval = setInterval(update, 250);
    }

    // ======================================
    // FINISH POMODORO PHASE
    // ======================================

    function finishPhase() {
        if (!state.startedAt || state.mode !== "pomodoro") {
            return;
        }

        clearInterval(interval);

        const totalSeconds = Math.round(
            getCurrentPhaseElapsed() / 1000
        );

        state.startedAt = null;

        if (state.phase === "focus") {
            addStudyTime(totalSeconds);

            state.completedSessions += 1;

            recordSession(
                "focus",
                totalSeconds,
                "completed"
            );

            state.sessionStartedAt = null;

            // Automatically start break.
            state.phase = "break";
            state.accumulatedMs = 0;

            state.remainingMs =
                state.breakMinutes * 60 * 1000;

            state.sessionStartedAt =
                new Date().toISOString();

            state.startedAt = Date.now();

            save();
            update();
            startInterval();

            return;
        }

        if (state.phase === "break") {
            state.breakSeconds += totalSeconds;

            recordSession(
                "break",
                totalSeconds,
                "completed"
            );

            state.sessionStartedAt = null;
            state.phase = "choose";
            state.accumulatedMs = 0;
            state.remainingMs = 0;

            save();
            update();
        }
    }

    // ======================================
    // CHANGE TIMER MODE
    // ======================================

    function setMode(mode) {
        if (!["pomodoro", "stopwatch"].includes(mode)) {
            return false;
        }

        if (
            state.phase === "focus" ||
            state.phase === "break"
        ) {
            return false;
        }

        clearInterval(interval);
        interval = null;

        state.mode = mode;
        state.phase = "ready";
        state.startedAt = null;
        state.sessionStartedAt = null;
        state.accumulatedMs = 0;

        state.remainingMs =
            state.focusMinutes * 60 * 1000;

        localStorage.setItem(MODE_KEY, mode);

        save();
        update();

        return true;
    }

    // ======================================
    // START POMODORO
    // ======================================

    function start(subject, focusMinutes, breakMinutes) {
        if (!subject || state.startedAt) {
            return false;
        }

        if (!["ready", "choose"].includes(state.phase)) {
            return false;
        }

        if (
            !Number.isInteger(focusMinutes) ||
            !Number.isInteger(breakMinutes) ||
            focusMinutes < 1 ||
            focusMinutes > 300 ||
            breakMinutes < 1 ||
            breakMinutes > 120
        ) {
            return false;
        }

        state.mode = "pomodoro";
        localStorage.setItem(MODE_KEY, "pomodoro");

        state.subject = subject;
        state.focusMinutes = focusMinutes;
        state.breakMinutes = breakMinutes;

        state.phase = "focus";
        state.accumulatedMs = 0;

        state.remainingMs =
            focusMinutes * 60 * 1000;

        state.sessionStartedAt =
            new Date().toISOString();

        state.startedAt = Date.now();

        save();
        update();
        startInterval();

        return true;
    }

    // ======================================
    // START STOPWATCH
    // ======================================

    function startStopwatch(subject) {
        if (!subject || state.startedAt) {
            return false;
        }

        if (!["ready", "choose"].includes(state.phase)) {
            return false;
        }

        state.mode = "stopwatch";
        localStorage.setItem(MODE_KEY, "stopwatch");

        state.subject = subject;
        state.phase = "focus";
        state.accumulatedMs = 0;
        state.remainingMs = 0;

        state.sessionStartedAt =
            new Date().toISOString();

        state.startedAt = Date.now();

        save();
        update();
        startInterval();

        return true;
    }

    // ======================================
    // PAUSE
    // ======================================

    function pause() {
        if (!state.startedAt) return;

        state.accumulatedMs += getElapsed();

        if (state.mode === "pomodoro") {
            state.remainingMs = getRemaining();
        }

        state.startedAt = null;

        clearInterval(interval);
        interval = null;

        save();
        update();
    }

    // ======================================
    // RESUME
    // ======================================

    function resume() {
        if (state.startedAt) return;

        if (!["focus", "break"].includes(state.phase)) {
            return;
        }

        state.startedAt = Date.now();

        save();
        update();
        startInterval();
    }

    // ======================================
    // STOP
    // ======================================

    function stop() {
        const seconds = Math.round(
            getCurrentPhaseElapsed() / 1000
        );

        if (state.phase === "focus") {
            addStudyTime(seconds);

            if (state.mode === "stopwatch" && seconds > 0) {
                state.completedSessions += 1;

                recordSession(
                    "focus",
                    seconds,
                    "completed"
                );
            } else {
                recordSession(
                    "focus",
                    seconds,
                    "stopped"
                );
            }
        }

        if (state.phase === "break") {
            state.breakSeconds += seconds;

            recordSession(
                "break",
                seconds,
                "stopped"
            );
        }

        clearInterval(interval);
        interval = null;

        state.phase = "ready";
        state.startedAt = null;
        state.sessionStartedAt = null;
        state.accumulatedMs = 0;

        state.remainingMs =
            state.focusMinutes * 60 * 1000;

        save();
        update();
    }

    // ======================================
    // GET STATE
    // ======================================

    function getState() {
        const statistics = getLiveStatistics();
        const remaining = getRemaining();
        const elapsed = getCurrentPhaseElapsed();

        return {
            ...state,
            ...statistics,
            remainingMs: remaining,
            elapsedMs: elapsed,

            displayTime: state.mode === "stopwatch"
                ? formatStopwatch(elapsed)
                : formatTimer(remaining),

            isRunning: Boolean(state.startedAt)
        };
    }

    // ======================================
    // DESTROY
    // ======================================

    function destroy() {
        clearInterval(interval);
        interval = null;
    }

    // Restore active timer after page refresh.
    if (state.startedAt) {
        startInterval();
    }

    const api = {
        start,
        startStopwatch,
        setMode,
        pause,
        resume,
        stop,
        getState,
        destroy
    };

    // Used by the Study Room's mode selector.
    globalThis.__restartStudyTimer = api;

    update();

    return api;
}
