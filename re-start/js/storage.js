
const DATABASE_KEY = "restart-data-v1";

const LEGACY_TIMER_KEY = "restart-m02-timer";
const LEGACY_TIMER_SETTINGS_KEY = "restart-timer-settings";
const LEGACY_THEME_KEY = "restart-theme";

const DATABASE_VERSION = 1;

const VALID_GOAL_METRICS = [
    "study_hours",
    "sleep_hours",
    "focus_sessions",
    "subject_hours"
];

const VALID_GOAL_PERIODS = [
    "daily",
    "weekly",
    "monthly"
];

// ==========================================
// DATE & VALIDATION
// ==========================================

function getTodayKey() {
    const now = new Date();

    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
}

function isValidDateKey(value) {
    return (
        typeof value === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(value)
    );
}

function isValidTime(value) {
    return (
        typeof value === "string" &&
        /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
    );
}

function safeNumber(value, fallback = 0) {
    const number = Number(value);

    return Number.isFinite(number) && number >= 0
        ? Math.floor(number)
        : fallback;
}

function createId(prefix) {
    if (globalThis.crypto?.randomUUID) {
        return globalThis.crypto.randomUUID();
    }

    return `${prefix}-${Date.now()}-${Math.random()
        .toString(16)
        .slice(2)}`;
}

// ==========================================
// DEFAULT DATABASE
// ==========================================

function createEmptyDay(date) {
    return {
        date,
        studySeconds: {},
        breakSeconds: 0,
        completedSessions: 0,
        sessions: []
    };
}

function createDefaultDatabase() {
    const now = new Date().toISOString();

    return {
        schemaVersion: DATABASE_VERSION,

        meta: {
            createdAt: now,
            updatedAt: now
        },

        settings: {
            theme: "dark",
            language: "en",

            timer: {
                focusMinutes: 45,
                breakMinutes: 10
            }
        },

        study: {
            days: {}
        },

        sleep: {
            records: [],

            schedule: {
                enabled: false,
                bedtime: "23:00",
                wakeTime: "07:00"
            }
        },

        journal: [],
        goals: []
    };
}

// ==========================================
// STUDY DATA NORMALIZATION
// ==========================================

function normalizeSession(session, date, index) {
    if (!session || typeof session !== "object") {
        return null;
    }

    const seconds = safeNumber(session.seconds);

    if (seconds <= 0) {
        return null;
    }

    return {
        id: session.id || `${date}-session-${index}`,

        type: session.type === "break"
            ? "break"
            : "focus",

        subject:
            typeof session.subject === "string"
                ? session.subject
                : "",

        seconds,

        startedAt:
            typeof session.startedAt === "string"
                ? session.startedAt
                : null,

        endedAt:
            typeof session.endedAt === "string"
                ? session.endedAt
                : null,

        status:
            session.status === "stopped"
                ? "stopped"
                : "completed"
    };
}

function normalizeDay(date, rawDay) {
    const day = createEmptyDay(date);

    if (!rawDay || typeof rawDay !== "object") {
        return day;
    }

    if (
        rawDay.studySeconds &&
        typeof rawDay.studySeconds === "object"
    ) {
        for (const [subject, seconds] of Object.entries(
            rawDay.studySeconds
        )) {
            if (!subject.trim()) continue;

            day.studySeconds[subject] = safeNumber(seconds);
        }
    }

    day.breakSeconds = safeNumber(rawDay.breakSeconds);

    day.completedSessions = safeNumber(
        rawDay.completedSessions
    );

    if (Array.isArray(rawDay.sessions)) {
        day.sessions = rawDay.sessions
            .slice(-10000)
            .map((session, index) =>
                normalizeSession(session, date, index)
            )
            .filter(Boolean);
    }

    return day;
}

// ==========================================
// SLEEP DATA NORMALIZATION
// ==========================================

function normalizeSleepRecord(record, index = 0) {
    if (!record || typeof record !== "object") {
        return null;
    }

    const bedtime = new Date(record.bedtime);
    const wakeTime = new Date(record.wakeTime);

    if (
        Number.isNaN(bedtime.getTime()) ||
        Number.isNaN(wakeTime.getTime()) ||
        wakeTime <= bedtime
    ) {
        return null;
    }

    const durationMs = wakeTime.getTime() - bedtime.getTime();

    if (durationMs > 24 * 60 * 60 * 1000) {
        return null;
    }

    const quality = Number(record.quality);

    return {
        id: typeof record.id === "string"
            ? record.id
            : `sleep-${index}-${bedtime.getTime()}`,

        type: record.type === "nap"
            ? "nap"
            : "main",

        bedtime: bedtime.toISOString(),
        wakeTime: wakeTime.toISOString(),

        durationMinutes: Math.round(
            durationMs / 60000
        ),

        quality:
            Number.isInteger(quality) &&
            quality >= 1 &&
            quality <= 5
                ? quality
                : null,

        note: String(record.note || "")
            .trim()
            .slice(0, 500),

        createdAt:
            typeof record.createdAt === "string"
                ? record.createdAt
                : bedtime.toISOString(),

        updatedAt:
            typeof record.updatedAt === "string"
                ? record.updatedAt
                : wakeTime.toISOString()
    };
}

// ==========================================
// GOAL DATA NORMALIZATION
// ==========================================

function normalizeGoal(goal, index = 0) {
    if (!goal || typeof goal !== "object") {
        return null;
    }

    const title = String(goal.title || "").trim();
    const targetValue = Number(goal.targetValue);

    if (
        !title ||
        title.length > 80 ||
        !VALID_GOAL_METRICS.includes(goal.metric) ||
        !VALID_GOAL_PERIODS.includes(goal.period) ||
        !Number.isFinite(targetValue) ||
        targetValue <= 0 ||
        targetValue > 10000
    ) {
        return null;
    }

    const subject = String(goal.subject || "").trim();

    if (
        goal.metric === "subject_hours" &&
        !subject
    ) {
        return null;
    }

    const now = new Date().toISOString();

    return {
        id: typeof goal.id === "string" && goal.id
            ? goal.id
            : `goal-${index}-${Date.now()}`,

        title,

        metric: goal.metric,

        targetValue,

        period: goal.period,

        subject: goal.metric === "subject_hours"
            ? subject
            : "",

        createdAt:
            typeof goal.createdAt === "string"
                ? goal.createdAt
                : now,

        updatedAt:
            typeof goal.updatedAt === "string"
                ? goal.updatedAt
                : now
    };
}

// ==========================================
// DATABASE NORMALIZATION
// ==========================================

function normalizeDatabase(raw) {
    const database = createDefaultDatabase();

    if (!raw || typeof raw !== "object") {
        return database;
    }

    if (raw.meta && typeof raw.meta === "object") {
        database.meta.createdAt =
            raw.meta.createdAt || database.meta.createdAt;

        database.meta.updatedAt =
            raw.meta.updatedAt || database.meta.updatedAt;
    }

    // SETTINGS
    if (raw.settings && typeof raw.settings === "object") {
        database.settings.theme =
            raw.settings.theme === "light"
                ? "light"
                : "dark";

        database.settings.language =
            ["en", "vi", "bi"].includes(raw.settings.language)
                ? raw.settings.language
                : "en";

        const timer = raw.settings.timer || {};

        const focus = safeNumber(timer.focusMinutes, 45);
        const rest = safeNumber(timer.breakMinutes, 10);

        database.settings.timer = {
            focusMinutes: Math.min(300, Math.max(1, focus)),
            breakMinutes: Math.min(120, Math.max(1, rest))
        };
    }

    // STUDY
    const days = raw.study?.days;

    if (days && typeof days === "object") {
        for (const [date, day] of Object.entries(days)) {
            if (!isValidDateKey(date)) continue;

            database.study.days[date] = normalizeDay(date, day);
        }
    }

    // SLEEP
    if (raw.sleep && typeof raw.sleep === "object") {
        if (Array.isArray(raw.sleep.records)) {
            database.sleep.records = raw.sleep.records
                .slice(-10000)
                .map(normalizeSleepRecord)
                .filter(Boolean);
        }

        const schedule = raw.sleep.schedule || {};

        database.sleep.schedule = {
            enabled: schedule.enabled === true,

            bedtime: isValidTime(schedule.bedtime)
                ? schedule.bedtime
                : "23:00",

            wakeTime: isValidTime(schedule.wakeTime)
                ? schedule.wakeTime
                : "07:00"
        };
    }

    // JOURNAL
    if (Array.isArray(raw.journal)) {
        database.journal = raw.journal.slice(-10000);
    }

    // GOALS
    if (Array.isArray(raw.goals)) {
        database.goals = raw.goals
            .slice(-1000)
            .map(normalizeGoal)
            .filter(Boolean);
    }

    return database;
}

// ==========================================
// READ & WRITE DATABASE
// ==========================================

function readDatabase() {
    const raw = localStorage.getItem(DATABASE_KEY);

    if (!raw) {
        return createDefaultDatabase();
    }

    try {
        return normalizeDatabase(JSON.parse(raw));
    } catch (error) {
        console.error("RE:START storage read error:", error);

        throw new Error(
            "RE:START data is damaged or unreadable."
        );
    }
}

function writeDatabase(database) {
    database.meta.updatedAt = new Date().toISOString();

    try {
        localStorage.setItem(
            DATABASE_KEY,
            JSON.stringify(database)
        );
    } catch (error) {
        console.error("RE:START storage write error:", error);

        throw new Error(
            "Could not save data. Browser storage may be full."
        );
    }
}

// ==========================================
// M02 DATA MIGRATION
// ==========================================

function migrateLegacyData(database) {
    try {
        const rawTimer = localStorage.getItem(LEGACY_TIMER_KEY);

        if (rawTimer) {
            const oldTimer = JSON.parse(rawTimer);
            const date = oldTimer?.date;

            if (isValidDateKey(date)) {
                const oldDay = normalizeDay(date, oldTimer);
                const existing = database.study.days[date];

                if (!existing) {
                    database.study.days[date] = oldDay;
                } else {
                    for (const [subject, seconds] of Object.entries(
                        oldDay.studySeconds
                    )) {
                        existing.studySeconds[subject] = Math.max(
                            existing.studySeconds[subject] || 0,
                            seconds
                        );
                    }

                    existing.breakSeconds = Math.max(
                        existing.breakSeconds,
                        oldDay.breakSeconds
                    );

                    existing.completedSessions = Math.max(
                        existing.completedSessions,
                        oldDay.completedSessions
                    );
                }
            }
        }
    } catch (error) {
        console.warn("M02 data migration failed:", error);
    }

    try {
        const oldSettings = JSON.parse(
            localStorage.getItem(LEGACY_TIMER_SETTINGS_KEY) || "null"
        );

        if (oldSettings) {
            const focus = safeNumber(oldSettings.focusMinutes, 45);
            const rest = safeNumber(oldSettings.breakMinutes, 10);

            database.settings.timer = {
                focusMinutes: Math.min(300, Math.max(1, focus)),
                breakMinutes: Math.min(120, Math.max(1, rest))
            };
        }
    } catch (error) {
        console.warn("Timer settings migration failed:", error);
    }

    const oldTheme = localStorage.getItem(LEGACY_THEME_KEY);

    if (oldTheme === "light" || oldTheme === "dark") {
        database.settings.theme = oldTheme;
    }
}

// ==========================================
// INITIALIZE STORAGE
// ==========================================

export function initializeStorage() {
    const existing = localStorage.getItem(DATABASE_KEY);

    if (!existing) {
        const database = createDefaultDatabase();

        migrateLegacyData(database);
        writeDatabase(database);

        return;
    }

    readDatabase();
}

// ==========================================
// SETTINGS
// ==========================================

export function getSettings() {
    const database = readDatabase();

    return {
        theme: database.settings.theme,
        language: database.settings.language,
        timer: { ...database.settings.timer }
    };
}

export function saveSettings(partialSettings = {}) {
    const database = readDatabase();

    if (
        partialSettings.theme === "dark" ||
        partialSettings.theme === "light"
    ) {
        database.settings.theme = partialSettings.theme;

        localStorage.setItem(
            LEGACY_THEME_KEY,
            partialSettings.theme
        );
    }

    if (
        ["en", "vi", "bi"].includes(partialSettings.language)
    ) {
        database.settings.language = partialSettings.language;
    }

    if (
        partialSettings.timer &&
        typeof partialSettings.timer === "object"
    ) {
        const focus = Number(partialSettings.timer.focusMinutes);
        const rest = Number(partialSettings.timer.breakMinutes);

        if (
            Number.isInteger(focus) &&
            focus >= 1 &&
            focus <= 300
        ) {
            database.settings.timer.focusMinutes = focus;
        }

        if (
            Number.isInteger(rest) &&
            rest >= 1 &&
            rest <= 120
        ) {
            database.settings.timer.breakMinutes = rest;
        }

        localStorage.setItem(
            LEGACY_TIMER_SETTINGS_KEY,
            JSON.stringify(database.settings.timer)
        );
    }

    writeDatabase(database);

    return getSettings();
}

// ==========================================
// DAILY STUDY DATA
// ==========================================

export function getDayRecord(date = getTodayKey()) {
    if (!isValidDateKey(date)) {
        throw new Error("Invalid date.");
    }

    const database = readDatabase();

    return normalizeDay(
        date,
        database.study.days[date]
    );
}

export function saveDaySummary(date, summary = {}) {
    if (!isValidDateKey(date)) {
        throw new Error("Invalid date.");
    }

    const database = readDatabase();

    const day = normalizeDay(
        date,
        database.study.days[date]
    );

    if (
        summary.studySeconds &&
        typeof summary.studySeconds === "object"
    ) {
        day.studySeconds = {};

        for (const [subject, seconds] of Object.entries(
            summary.studySeconds
        )) {
            if (!subject.trim()) continue;

            day.studySeconds[subject] = safeNumber(seconds);
        }
    }

    if (summary.breakSeconds !== undefined) {
        day.breakSeconds = safeNumber(summary.breakSeconds);
    }

    if (summary.completedSessions !== undefined) {
        day.completedSessions = safeNumber(
            summary.completedSessions
        );
    }

    database.study.days[date] = day;

    writeDatabase(database);

    return normalizeDay(date, day);
}

// ==========================================
// STUDY SESSION HISTORY
// ==========================================

export function addSessionRecord(date, session) {
    if (!isValidDateKey(date)) {
        throw new Error("Invalid date.");
    }

    const database = readDatabase();

    const day = normalizeDay(
        date,
        database.study.days[date]
    );

    const record = normalizeSession(
        session,
        date,
        day.sessions.length
    );

    if (!record) {
        return day;
    }

    day.sessions.push(record);

    if (day.sessions.length > 10000) {
        day.sessions = day.sessions.slice(-10000);
    }

    database.study.days[date] = day;

    writeDatabase(database);

    return normalizeDay(date, day);
}

export function getStudyHistory() {
    const database = readDatabase();

    return Object.values(database.study.days)
        .map(day => normalizeDay(day.date, day))
        .sort((a, b) => b.date.localeCompare(a.date));
}

// ==========================================
// SLEEP RECORDS
// ==========================================

export function getSleepRecords() {
    const database = readDatabase();

    return database.sleep.records
        .map(normalizeSleepRecord)
        .filter(Boolean)
        .sort((a, b) =>
            new Date(b.wakeTime) - new Date(a.wakeTime)
        );
}

export function saveSleepRecord(record) {
    if (!record || typeof record !== "object") {
        throw new Error("Invalid sleep record.");
    }

    const bedtime = new Date(record.bedtime);
    const wakeTime = new Date(record.wakeTime);

    if (
        Number.isNaN(bedtime.getTime()) ||
        Number.isNaN(wakeTime.getTime())
    ) {
        throw new Error("Please enter valid sleep and wake-up times.");
    }

    const durationMs = wakeTime.getTime() - bedtime.getTime();

    if (durationMs <= 0) {
        throw new Error("Wake-up time must be later than bedtime.");
    }

    if (durationMs > 24 * 60 * 60 * 1000) {
        throw new Error("A sleep record cannot exceed 24 hours.");
    }

    let quality = null;

    if (
        record.quality !== null &&
        record.quality !== undefined &&
        record.quality !== ""
    ) {
        quality = Number(record.quality);

        if (
            !Number.isInteger(quality) ||
            quality < 1 ||
            quality > 5
        ) {
            throw new Error("Sleep quality must be between 1 and 5.");
        }
    }

    const database = readDatabase();

    const existingIndex = database.sleep.records.findIndex(
        item => item.id === record.id
    );

    const now = new Date().toISOString();

    const existingRecord = existingIndex >= 0
        ? database.sleep.records[existingIndex]
        : null;

    const savedRecord = {
        id: existingRecord?.id || record.id || createId("sleep"),

        type: record.type === "nap"
            ? "nap"
            : "main",

        bedtime: bedtime.toISOString(),
        wakeTime: wakeTime.toISOString(),

        durationMinutes: Math.round(
            durationMs / 60000
        ),

        quality,

        note: String(record.note || "")
            .trim()
            .slice(0, 500),

        createdAt:
            existingRecord?.createdAt || now,

        updatedAt: now
    };

    if (existingIndex >= 0) {
        database.sleep.records[existingIndex] = savedRecord;
    } else {
        database.sleep.records.push(savedRecord);
    }

    if (database.sleep.records.length > 10000) {
        database.sleep.records = database.sleep.records.slice(-10000);
    }

    writeDatabase(database);

    return savedRecord;
}

export function deleteSleepRecord(id) {
    if (!id) {
        return false;
    }

    const database = readDatabase();

    const originalLength = database.sleep.records.length;

    database.sleep.records = database.sleep.records.filter(
        record => record.id !== id
    );

    const deleted =
        database.sleep.records.length !== originalLength;

    if (deleted) {
        writeDatabase(database);
    }

    return deleted;
}

// ==========================================
// SLEEP SCHEDULE
// ==========================================

export function getSleepSchedule() {
    const database = readDatabase();

    return {
        ...database.sleep.schedule
    };
}

export function saveSleepSchedule(schedule = {}) {
    if (!isValidTime(schedule.bedtime)) {
        throw new Error("Invalid bedtime.");
    }

    if (!isValidTime(schedule.wakeTime)) {
        throw new Error("Invalid wake-up time.");
    }

    const database = readDatabase();

    database.sleep.schedule = {
        enabled: schedule.enabled === true,
        bedtime: schedule.bedtime,
        wakeTime: schedule.wakeTime
    };

    writeDatabase(database);

    return {
        ...database.sleep.schedule
    };
}

// ==========================================
// GOALS
// ==========================================

export function getGoals() {
    const database = readDatabase();

    return database.goals
        .map((goal, index) => normalizeGoal(goal, index))
        .filter(Boolean)
        .sort((a, b) =>
            new Date(b.createdAt) - new Date(a.createdAt)
        );
}

export function saveGoal(goal) {
    if (!goal || typeof goal !== "object") {
        throw new Error("Invalid goal.");
    }

    const title = String(goal.title || "").trim();
    const targetValue = Number(goal.targetValue);

    if (!title) {
        throw new Error("Please enter a goal name.");
    }

    if (title.length > 80) {
        throw new Error("Goal name cannot exceed 80 characters.");
    }

    if (!VALID_GOAL_METRICS.includes(goal.metric)) {
        throw new Error("Invalid goal type.");
    }

    if (!VALID_GOAL_PERIODS.includes(goal.period)) {
        throw new Error("Invalid goal period.");
    }

    if (
        !Number.isFinite(targetValue) ||
        targetValue <= 0 ||
        targetValue > 10000
    ) {
        throw new Error("Please enter a valid target.");
    }

    const subject = String(goal.subject || "").trim();

    if (
        goal.metric === "subject_hours" &&
        !subject
    ) {
        throw new Error("Please select a subject.");
    }

    if (
        goal.metric === "focus_sessions" &&
        !Number.isInteger(targetValue)
    ) {
        throw new Error("Focus session target must be a whole number.");
    }

    const database = readDatabase();

    const existingIndex = database.goals.findIndex(
        item => item.id === goal.id
    );

    const existing = existingIndex >= 0
        ? normalizeGoal(database.goals[existingIndex], existingIndex)
        : null;

    const now = new Date().toISOString();

    const savedGoal = {
        id: existing?.id || goal.id || createId("goal"),

        title,
        metric: goal.metric,
        targetValue,
        period: goal.period,

        subject: goal.metric === "subject_hours"
            ? subject
            : "",

        createdAt: existing?.createdAt || now,
        updatedAt: now
    };

    if (existingIndex >= 0) {
        database.goals[existingIndex] = savedGoal;
    } else {
        if (database.goals.length >= 1000) {
            throw new Error("Maximum number of goals reached.");
        }

        database.goals.push(savedGoal);
    }

    writeDatabase(database);

    return savedGoal;
}

export function deleteGoal(id) {
    if (!id) {
        return false;
    }

    const database = readDatabase();

    const previousLength = database.goals.length;

    database.goals = database.goals.filter(
        goal => goal.id !== id
    );

    const deleted =
        database.goals.length !== previousLength;

    if (deleted) {
        writeDatabase(database);
    }

    return deleted;
}

// ==========================================
// STORAGE SUMMARY
// ==========================================

export function getStorageSummary() {
    const database = readDatabase();

    const days = Object.values(database.study.days);

    const totalStudySeconds = days.reduce((total, day) => {
        const dailyTotal = Object.values(day.studySeconds)
            .reduce((sum, seconds) => sum + safeNumber(seconds), 0);

        return total + dailyTotal;
    }, 0);

    const sessionCount = days.reduce(
        (total, day) => total + day.sessions.length,
        0
    );

    const serialized = JSON.stringify(database);

    let storageBytes;

    try {
        storageBytes = new Blob([serialized]).size;
    } catch {
        storageBytes = serialized.length;
    }

    return {
        studyDays: days.length,
        sessionCount,
        totalStudySeconds,
        sleepRecordCount: database.sleep.records.length,
        goalCount: database.goals.length,
        storageBytes,
        lastUpdated: database.meta.updatedAt
    };
}

// ==========================================
// BACKUP & RESTORE
// ==========================================

export function createBackup() {
    return {
        app: "RE:START",
        formatVersion: 1,
        exportedAt: new Date().toISOString(),
        data: readDatabase()
    };
}

export function importBackup(rawBackup) {
    let backup = rawBackup;

    if (typeof rawBackup === "string") {
        try {
            backup = JSON.parse(rawBackup);
        } catch {
            throw new Error("Invalid JSON backup file.");
        }
    }

    if (
        !backup ||
        backup.app !== "RE:START" ||
        backup.formatVersion !== 1 ||
        !backup.data
    ) {
        throw new Error("Unsupported RE:START backup file.");
    }

    const database = normalizeDatabase(backup.data);

    writeDatabase(database);

    localStorage.removeItem(LEGACY_TIMER_KEY);

    localStorage.setItem(
        LEGACY_THEME_KEY,
        database.settings.theme
    );

    localStorage.setItem(
        LEGACY_TIMER_SETTINGS_KEY,
        JSON.stringify(database.settings.timer)
    );

    return getStorageSummary();
}

// ==========================================
// DATE FORMATTING
// ==========================================

export function formatStorageDate(value) {
    if (!value) {
        return "Not available";
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return "Not available";
    }

    return date.toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit"
    });
}
