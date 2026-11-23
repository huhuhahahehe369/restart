import {
    getSleepRecords,
    saveSleepRecord,
    deleteSleepRecord,
    getSleepSchedule,
    saveSleepSchedule
} from "../js/storage.js";

const ACTIVE_SLEEP_KEY = "restart-m04-active-sleep";

let sleepInterval = null;

let calendarMonth = new Date(
    new Date().getFullYear(),
    new Date().getMonth(),
    1
);

let selectedCalendarDate = getDateKey(new Date());

// ==========================================
// DATE & TIME
// ==========================================

function getDateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
}

function getTodayKey() {
    return getDateKey(new Date());
}

function parseDateKey(dateKey) {
    const [year, month, day] = dateKey.split("-").map(Number);

    return new Date(year, month - 1, day, 12, 0, 0, 0);
}

function formatDuration(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));

    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const remainingSeconds = total % 60;

    return (
        `${String(hours).padStart(2, "0")}h ` +
        `${String(minutes).padStart(2, "0")}m ` +
        `${String(remainingSeconds).padStart(2, "0")}s`
    );
}

function formatCompactDuration(seconds) {
    const total = Math.max(0, Math.floor(seconds));

    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);

    if (hours > 0) {
        return `${hours}h ${minutes}m`;
    }

    if (minutes > 0) {
        return `${minutes}m`;
    }

    return `${Math.floor(total)}s`;
}

function formatElapsed(milliseconds) {
    const totalSeconds = Math.max(
        0,
        Math.floor(milliseconds / 1000)
    );

    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    return [
        String(hours).padStart(2, "0"),
        String(minutes).padStart(2, "0"),
        String(seconds).padStart(2, "0")
    ].join(":");
}

function formatDate(value) {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return "Invalid date";
    }

    return date.toLocaleDateString(undefined, {
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric"
    });
}

function formatDateKey(dateKey) {
    return parseDateKey(dateKey).toLocaleDateString(undefined, {
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric"
    });
}

function formatTime(value) {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return "--:--";
    }

    return date.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit"
    });
}

function toDateTimeLocal(value) {
    const date = new Date(value);
    const offset = date.getTimezoneOffset();

    const localDate = new Date(
        date.getTime() - offset * 60000
    );

    return localDate.toISOString().slice(0, 16);
}

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
// ACTIVE SLEEP SESSION
// ==========================================

function getActiveSleepSession() {
    try {
        const raw = localStorage.getItem(ACTIVE_SLEEP_KEY);

        if (!raw) {
            return null;
        }

        const session = JSON.parse(raw);

        if (
            !session ||
            typeof session.id !== "string" ||
            typeof session.bedtime !== "string" ||
            Number.isNaN(new Date(session.bedtime).getTime())
        ) {
            return null;
        }

        return {
            ...session,
            type: session.type === "nap" ? "nap" : "main"
        };

    } catch (error) {
        console.error("Could not load active sleep session:", error);
        return null;
    }
}

function startSleepSession(type) {
    if (getActiveSleepSession()) {
        throw new Error("A sleep session is already running.");
    }

    const session = {
        id: globalThis.crypto?.randomUUID
            ? globalThis.crypto.randomUUID()
            : `sleep-${Date.now()}`,

        type: type === "nap" ? "nap" : "main",

        bedtime: new Date().toISOString()
    };

    localStorage.setItem(
        ACTIVE_SLEEP_KEY,
        JSON.stringify(session)
    );

    return session;
}

function stopSleepSession() {
    const active = getActiveSleepSession();

    if (!active) {
        throw new Error("There is no active sleep session.");
    }

    const record = saveSleepRecord({
        id: active.id,
        type: active.type,
        bedtime: active.bedtime,
        wakeTime: new Date().toISOString(),
        quality: null,
        note: ""
    });

    // Clear active timer only after saving successfully.
    localStorage.removeItem(ACTIVE_SLEEP_KEY);

    return record;
}

// ==========================================
// DAILY SLEEP CALCULATION
// ==========================================

function getDayBounds(dateKey) {
    const [year, month, day] = dateKey.split("-").map(Number);

    const start = new Date(
        year,
        month - 1,
        day,
        0, 0, 0, 0
    ).getTime();

    const end = new Date(
        year,
        month - 1,
        day + 1,
        0, 0, 0, 0
    ).getTime();

    return { start, end };
}

function getDailySleepBreakdown(
    dateKey,
    records,
    activeSession = null
) {
    const { start, end } = getDayBounds(dateKey);

    let mainMilliseconds = 0;
    let napMilliseconds = 0;

    function addInterval(startValue, endValue, type) {
        const startTime = new Date(startValue).getTime();
        const endTime = new Date(endValue).getTime();

        if (
            !Number.isFinite(startTime) ||
            !Number.isFinite(endTime) ||
            endTime <= startTime
        ) {
            return;
        }

        const overlapStart = Math.max(startTime, start);
        const overlapEnd = Math.min(endTime, end);

        if (overlapEnd <= overlapStart) {
            return;
        }

        const duration = overlapEnd - overlapStart;

        if (type === "nap") {
            napMilliseconds += duration;
        } else {
            mainMilliseconds += duration;
        }
    }

    // Completed records.
    for (const record of records) {
        addInterval(
            record.bedtime,
            record.wakeTime,
            record.type === "nap" ? "nap" : "main"
        );
    }

    // Include an active sleep session.
    if (activeSession) {
        addInterval(
            activeSession.bedtime,
            Date.now(),
            activeSession.type
        );
    }

    const mainSeconds = Math.floor(mainMilliseconds / 1000);
    const napSeconds = Math.floor(napMilliseconds / 1000);

    return {
        mainSeconds,
        napSeconds,
        totalSeconds: mainSeconds + napSeconds
    };
}

function getDailySleepSeconds(dateKey, records, activeSession) {
    return getDailySleepBreakdown(
        dateKey,
        records,
        activeSession
    ).totalSeconds;
}

// ==========================================
// WEEK AND MONTH DATE RANGES
// ==========================================

function getPeriodDateKeys(type) {
    const today = new Date();

    today.setHours(0, 0, 0, 0);

    const start = new Date(today);

    if (type === "week") {
        // Monday is the first day of the week.
        const daysSinceMonday =
            (start.getDay() + 6) % 7;

        start.setDate(
            start.getDate() - daysSinceMonday
        );

    } else if (type === "month") {
        start.setDate(1);
    }

    const dates = [];
    const current = new Date(start);

    while (current <= today) {
        dates.push(getDateKey(current));
        current.setDate(current.getDate() + 1);
    }

    return dates;
}

// ==========================================
// WEEKLY AND MONTHLY EXTREMES
// ==========================================

function getPeriodExtremes(type, records, activeSession) {
    const dates = getPeriodDateKeys(type);

    const recordedDays = dates
        .map(date => ({
            date,

            seconds: getDailySleepSeconds(
                date,
                records,
                activeSession
            )
        }))
        .filter(day => day.seconds > 0);

    if (recordedDays.length === 0) {
        return {
            best: null,
            worst: null
        };
    }

    let best = recordedDays[0];
    let worst = recordedDays[0];

    for (const day of recordedDays) {
        if (day.seconds > best.seconds) {
            best = day;
        }

        if (day.seconds < worst.seconds) {
            worst = day;
        }
    }

    return {
        best,
        worst
    };
}

// ==========================================
// WEEKLY SESSION COUNT
// ==========================================

function getWeeklySessionCount(records) {
    const weekDates = new Set(
        getPeriodDateKeys("week")
    );

    return records.filter(record => {
        return weekDates.has(
            getDateKey(new Date(record.wakeTime))
        );
    }).length;
}

// ==========================================
// SLEEP CONSISTENCY
// ==========================================

function getClockMinutes(dateValue) {
    const date = new Date(dateValue);

    return date.getHours() * 60 + date.getMinutes();
}

function getCircularTimeDifference(first, second) {
    const difference = Math.abs(first - second);

    return Math.min(difference, 1440 - difference);
}

function getSleepConsistency(records, schedule) {
    if (!schedule.enabled) {
        return {
            enabled: false,
            percentage: null,
            matches: 0,
            total: 0
        };
    }

    const weekDates = new Set(
        getPeriodDateKeys("week")
    );

    const targetBedtime = schedule.bedtime
        .split(":")
        .map(Number);

    const targetWakeTime = schedule.wakeTime
        .split(":")
        .map(Number);

    const targetBedMinutes =
        targetBedtime[0] * 60 + targetBedtime[1];

    const targetWakeMinutes =
        targetWakeTime[0] * 60 + targetWakeTime[1];

    // Only Main Sleep records count toward consistency.
    const mainSleepRecords = records.filter(record => {
        const wakeDate = getDateKey(
            new Date(record.wakeTime)
        );

        return (
            record.type !== "nap" &&
            weekDates.has(wakeDate)
        );
    });

    if (mainSleepRecords.length === 0) {
        return {
            enabled: true,
            percentage: null,
            matches: 0,
            total: 0
        };
    }

    let matches = 0;

    for (const record of mainSleepRecords) {
        const actualBedtime = getClockMinutes(record.bedtime);
        const actualWakeTime = getClockMinutes(record.wakeTime);

        const bedtimeDifference = getCircularTimeDifference(
            actualBedtime,
            targetBedMinutes
        );

        const wakeDifference = getCircularTimeDifference(
            actualWakeTime,
            targetWakeMinutes
        );

        // Both times must be within 60 minutes of the target.
        if (
            bedtimeDifference <= 60 &&
            wakeDifference <= 60
        ) {
            matches += 1;
        }
    }

    return {
        enabled: true,
        matches,
        total: mainSleepRecords.length,

        percentage: Math.round(
            (matches / mainSleepRecords.length) * 100
        )
    };
}

// ==========================================
// SLEEP EXTREMES CARDS
// ==========================================

function renderExtremeCard(
    heading,
    title,
    extreme,
    description,
    prefix
) {
    return `
        <div class="card">

            <div class="card-title">
                ${escapeHTML(heading)}
            </div>

            <h3 style="margin-top:10px">
                ${escapeHTML(title)}
            </h3>

            <div
                class="stat-value"
                id="${prefix}-duration"
                style="
                    font-size:clamp(20px,3vw,27px);
                    color:var(--accent);
                    margin-top:12px;
                "
            >
                ${extreme
                    ? formatDuration(extreme.seconds)
                    : "--"}
            </div>

            <div
                class="stat-description"
                id="${prefix}-date"
                style="margin-top:8px"
            >
                ${extreme
                    ? escapeHTML(formatDateKey(extreme.date))
                    : "No sleep data yet"}
            </div>

            <div class="empty-note" style="margin-top:10px;font-size:12px">
                ${escapeHTML(description)}
            </div>

        </div>
    `;
}

// ==========================================
// SLEEP CALENDAR
// ==========================================

function getMonthTitle(date) {
    return date.toLocaleDateString(undefined, {
        month: "long",
        year: "numeric"
    });
}

function renderCalendar(records, activeSession) {
    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();

    const firstDay = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    // Monday-first layout.
    const offset = (firstDay.getDay() + 6) % 7;

    const totalCells = Math.ceil(
        (offset + daysInMonth) / 7
    ) * 7;

    const todayKey = getTodayKey();

    const currentMonth = new Date(
        new Date().getFullYear(),
        new Date().getMonth(),
        1
    );

    const isCurrentMonth =
        calendarMonth.getFullYear() === currentMonth.getFullYear() &&
        calendarMonth.getMonth() === currentMonth.getMonth();

    const weekdays = [
        "Mon", "Tue", "Wed", "Thu",
        "Fri", "Sat", "Sun"
    ];

    let cells = "";

    for (let index = 0; index < totalCells; index++) {
        const dayNumber = index - offset + 1;

        if (dayNumber < 1 || dayNumber > daysInMonth) {
            cells += `
                <div style="min-height:82px"></div>
            `;

            continue;
        }

        const date = new Date(year, month, dayNumber);
        const dateKey = getDateKey(date);

        const breakdown = getDailySleepBreakdown(
            dateKey,
            records,
            activeSession
        );

        const seconds = breakdown.totalSeconds;

        const intensity = Math.min(
            100,
            Math.round((seconds / (10 * 3600)) * 100)
        );

        const selected = dateKey === selectedCalendarDate;
        const isToday = dateKey === todayKey;

        cells += `
            <button
                type="button"
                data-calendar-date="${dateKey}"
                aria-label="${escapeHTML(formatDateKey(dateKey))}: ${escapeHTML(formatDuration(seconds))}"
                aria-pressed="${selected}"
                style="
                    min-width:0;
                    min-height:82px;
                    padding:8px 5px;
                    display:flex;
                    flex-direction:column;
                    justify-content:space-between;
                    align-items:center;
                    gap:5px;
                    border-radius:10px;
                    border:${selected
                        ? "2px solid var(--accent)"
                        : "1px solid var(--border)"};
                    background:${selected
                        ? "var(--bg-hover)"
                        : "transparent"};
                    color:var(--text-primary);
                    cursor:pointer;
                    font-family:inherit;
                "
            >

                <span style="
                    width:24px;
                    height:24px;
                    display:grid;
                    place-items:center;
                    border-radius:50%;
                    ${isToday
                        ? "background:var(--accent);color:white;font-weight:700;"
                        : ""}
                    font-size:12px;
                ">
                    ${dayNumber}
                </span>

                <span
                    id="calendar-total-${dateKey}"
                    style="
                        font-size:10px;
                        color:var(--text-secondary);
                        white-space:nowrap;
                    "
                >
                    ${seconds > 0
                        ? escapeHTML(formatCompactDuration(seconds))
                        : "—"}
                </span>

                <span style="
                    height:4px;
                    width:80%;
                    background:var(--bg-hover);
                    border-radius:20px;
                    overflow:hidden;
                ">
                    <span style="
                        display:block;
                        height:100%;
                        width:${intensity}%;
                        background:var(--accent);
                        border-radius:20px;
                    "></span>
                </span>

            </button>
        `;
    }

    const selectedDay = getDailySleepBreakdown(
        selectedCalendarDate,
        records,
        activeSession
    );

    return `
        <section
            class="card"
            id="sleep-calendar"
            style="margin-top:22px"
        >

            <div style="
                display:flex;
                align-items:center;
                justify-content:space-between;
                gap:12px;
                flex-wrap:wrap;
            ">

                <div>
                    <div class="card-title">
                        SLEEP CALENDAR
                    </div>

                    <h2 style="margin-top:6px">
                        ${escapeHTML(getMonthTitle(calendarMonth))}
                    </h2>
                </div>

                <div style="display:flex;gap:8px">

                    <button
                        type="button"
                        class="secondary-button"
                        id="calendar-prev"
                        aria-label="Previous month"
                    >
                        ←
                    </button>

                    <button
                        type="button"
                        class="secondary-button"
                        id="calendar-next"
                        aria-label="Next month"
                        ${isCurrentMonth ? "disabled" : ""}
                    >
                        →
                    </button>

                </div>

            </div>

            <div style="
                display:grid;
                grid-template-columns:repeat(7,minmax(0,1fr));
                gap:6px;
                margin-top:18px;
            ">

                ${weekdays.map(day => `
                    <div style="
                        text-align:center;
                        font-size:11px;
                        color:var(--text-secondary);
                        padding:5px 0;
                    ">
                        ${day}
                    </div>
                `).join("")}

                ${cells}

            </div>

            <div style="
                display:flex;
                align-items:center;
                gap:8px;
                margin-top:16px;
            ">
                <span style="
                    width:8px;
                    height:8px;
                    border-radius:50%;
                    background:var(--accent);
                "></span>

                <span class="empty-note">
                    Bar intensity represents total sleep duration.
                </span>
            </div>

            <div style="
                margin-top:18px;
                padding:16px;
                border-radius:12px;
                background:var(--bg-hover);
            ">

                <div class="card-title">
                    SELECTED DAY
                </div>

                <h3
                    id="calendar-selected-date"
                    style="margin-top:7px"
                >
                    ${escapeHTML(formatDateKey(selectedCalendarDate))}
                </h3>

                <div
                    class="stat-value"
                    id="calendar-selected-total"
                    style="
                        color:var(--accent);
                        font-size:25px;
                        margin-top:10px;
                    "
                >
                    ${formatDuration(selectedDay.totalSeconds)}
                </div>

                <div style="
                    display:grid;
                    grid-template-columns:repeat(2,minmax(0,1fr));
                    gap:12px;
                    margin-top:12px;
                ">

                    <div>
                        <div class="card-title">
                            MAIN SLEEP
                        </div>

                        <div
                            id="calendar-selected-main"
                            style="font-weight:650;margin-top:5px"
                        >
                            ${formatDuration(selectedDay.mainSeconds)}
                        </div>
                    </div>

                    <div>
                        <div class="card-title">
                            NAPS
                        </div>

                        <div
                            id="calendar-selected-nap"
                            style="font-weight:650;margin-top:5px"
                        >
                            ${formatDuration(selectedDay.napSeconds)}
                        </div>
                    </div>

                </div>

            </div>

        </section>
    `;
}

// ==========================================
// SLEEP HISTORY
// ==========================================

function renderSleepHistory(records) {
    if (records.length === 0) {
        return `
            <p class="empty-note">
                No completed sleep sessions yet.
            </p>
        `;
    }

    return records.slice(0, 50).map(record => {
        const type = record.type === "nap"
            ? "Nap"
            : "Main Sleep";

        const bedtimeDate = formatDate(record.bedtime);
        const wakeDate = formatDate(record.wakeTime);

        const wakeLabel = bedtimeDate === wakeDate
            ? formatTime(record.wakeTime)
            : `${wakeDate}, ${formatTime(record.wakeTime)}`;

        const durationSeconds = Math.max(
            0,
            Math.floor(
                (
                    new Date(record.wakeTime).getTime() -
                    new Date(record.bedtime).getTime()
                ) / 1000
            )
        );

        return `
            <article style="
                padding:16px 0;
                border-bottom:1px solid var(--border);
            ">

                <div style="
                    display:flex;
                    justify-content:space-between;
                    align-items:center;
                    gap:16px;
                    flex-wrap:wrap;
                ">

                    <div style="min-width:0">

                        <strong>
                            ${escapeHTML(bedtimeDate)}
                        </strong>

                        <span style="
                            display:inline-block;
                            margin-left:7px;
                            padding:3px 8px;
                            border-radius:20px;
                            background:var(--bg-hover);
                            font-size:11px;
                            color:var(--text-secondary);
                        ">
                            ${type}
                        </span>

                        <p class="empty-note" style="margin-top:7px">
                            ${escapeHTML(formatTime(record.bedtime))}
                            →
                            ${escapeHTML(wakeLabel)}
                        </p>

                        ${record.note
                            ? `<p class="empty-note" style="margin-top:6px">${escapeHTML(record.note)}</p>`
                            : ""}

                    </div>

                    <div style="
                        display:flex;
                        align-items:center;
                        gap:10px;
                        flex-wrap:wrap;
                    ">

                        <strong style="
                            color:var(--accent);
                            font-size:17px;
                            white-space:nowrap;
                        ">
                            ${formatDuration(durationSeconds)}
                        </strong>

                        <button
                            type="button"
                            class="secondary-button"
                            data-sleep-edit="${escapeHTML(record.id)}"
                            style="padding:7px 10px;font-size:12px"
                        >
                            Edit
                        </button>

                        <button
                            type="button"
                            class="secondary-button"
                            data-sleep-delete="${escapeHTML(record.id)}"
                            style="padding:7px 10px;font-size:12px"
                        >
                            Delete
                        </button>

                    </div>

                </div>

            </article>
        `;
    }).join("");
}

// ==========================================
// EDIT SLEEP RECORD
// ==========================================

function renderSleepEditor() {
    return `
        <section
            class="card"
            id="sleep-edit-panel"
            style="margin-top:20px"
            hidden
        >

            <div class="card-title">
                EDIT SLEEP RECORD
            </div>

            <h2 id="sleep-edit-title" style="margin-top:8px">
                Edit record
            </h2>

            <form id="sleep-edit-form" style="margin-top:18px">

                <input
                    type="hidden"
                    id="sleep-edit-id"
                >

                <div style="
                    display:grid;
                    grid-template-columns:repeat(auto-fit,minmax(200px,1fr));
                    gap:14px;
                ">

                    <label>
                        <span class="card-title" style="display:block;margin-bottom:8px">
                            Sleep type
                        </span>

                        <select
                            class="subject-select"
                            id="sleep-edit-type"
                        >
                            <option value="main">Main Sleep</option>
                            <option value="nap">Nap</option>
                        </select>
                    </label>

                    <label>
                        <span class="card-title" style="display:block;margin-bottom:8px">
                            Bedtime
                        </span>

                        <input
                            class="subject-select"
                            type="datetime-local"
                            id="sleep-edit-bedtime"
                            required
                        >
                    </label>

                    <label>
                        <span class="card-title" style="display:block;margin-bottom:8px">
                            Wake-up time
                        </span>

                        <input
                            class="subject-select"
                            type="datetime-local"
                            id="sleep-edit-wake"
                            required
                        >
                    </label>

                    <label>
                        <span class="card-title" style="display:block;margin-bottom:8px">
                            Sleep quality
                        </span>

                        <select
                            class="subject-select"
                            id="sleep-edit-quality"
                        >
                            <option value="">Not rated</option>
                            <option value="1">1 · Very unrestful</option>
                            <option value="2">2 · Unrestful</option>
                            <option value="3">3 · Okay</option>
                            <option value="4">4 · Restful</option>
                            <option value="5">5 · Very restful</option>
                        </select>
                    </label>

                </div>

                <label style="display:block;margin-top:16px">
                    <span class="card-title" style="display:block;margin-bottom:8px">
                        Notes
                    </span>

                    <textarea
                        class="subject-select"
                        id="sleep-edit-note"
                        rows="3"
                        maxlength="500"
                        style="width:100%;resize:vertical;font-family:inherit"
                    ></textarea>
                </label>

                <div style="
                    display:flex;
                    gap:10px;
                    flex-wrap:wrap;
                    margin-top:16px;
                ">

                    <button type="submit" class="primary-button">
                        Save Changes
                    </button>

                    <button
                        type="button"
                        class="secondary-button"
                        id="sleep-edit-cancel"
                    >
                        Cancel
                    </button>

                </div>

                <p
                    class="empty-note"
                    id="sleep-edit-message"
                    role="status"
                    style="margin-top:10px"
                ></p>

            </form>

        </section>
    `;
}

// ==========================================
// SLEEP SCHEDULE
// ==========================================

function renderSleepSchedule(schedule) {
    return `
        <section class="card" style="margin-top:22px">

            <div class="card-title">
                SLEEP SCHEDULE
            </div>

            <h2 style="margin-top:8px">
                Your preferred routine
            </h2>

            <p class="empty-note" style="margin-top:6px;line-height:1.6">
                Set your preferred Main Sleep and wake-up times.
                Nap sessions are not included in consistency scoring.
            </p>

            <form id="sleep-schedule-form" style="margin-top:18px">

                <label style="
                    display:flex;
                    align-items:center;
                    gap:10px;
                    margin-bottom:18px;
                ">
                    <input
                        type="checkbox"
                        id="sleep-schedule-enabled"
                        ${schedule.enabled ? "checked" : ""}
                    >

                    <span style="font-weight:600">
                        Enable sleep schedule tracking
                    </span>
                </label>

                <div style="
                    display:grid;
                    grid-template-columns:repeat(auto-fit,minmax(200px,1fr));
                    gap:14px;
                ">

                    <label>
                        <span class="card-title" style="display:block;margin-bottom:8px">
                            Preferred bedtime
                        </span>

                        <input
                            class="subject-select"
                            type="time"
                            id="sleep-schedule-bedtime"
                            value="${escapeHTML(schedule.bedtime)}"
                            required
                        >
                    </label>

                    <label>
                        <span class="card-title" style="display:block;margin-bottom:8px">
                            Preferred wake-up time
                        </span>

                        <input
                            class="subject-select"
                            type="time"
                            id="sleep-schedule-wake"
                            value="${escapeHTML(schedule.wakeTime)}"
                            required
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

                    <button type="submit" class="primary-button">
                        Save Sleep Schedule
                    </button>

                    <span
                        class="empty-note"
                        id="sleep-schedule-message"
                        role="status"
                    ></span>

                </div>

            </form>

        </section>
    `;
}

// ==========================================
// SLEEP CONSISTENCY
// ==========================================

function renderConsistency(records, schedule) {
    const consistency = getSleepConsistency(
        records,
        schedule
    );

    let score = "--";

    let description =
        "Set your sleep schedule to begin tracking.";

    if (consistency.enabled && consistency.total > 0) {
        score = `${consistency.percentage}%`;

        description =
            `${consistency.matches} of ${consistency.total} Main Sleep sessions were within 60 minutes of your schedule.`;
    } else if (consistency.enabled) {
        description =
            "No completed Main Sleep sessions recorded this week yet.";
    }

    return `
        <section class="card" style="margin-top:22px">

            <div class="card-title">
                SLEEP CONSISTENCY
            </div>

            <h2 style="margin-top:8px">
                How consistent is your routine?
            </h2>

            <div
                class="stat-value"
                id="sleep-consistency-score"
                style="
                    color:var(--accent);
                    font-size:32px;
                    margin-top:14px;
                "
            >
                ${score}
            </div>

            <p
                id="sleep-consistency-description"
                class="empty-note"
                style="margin-top:8px;line-height:1.6"
            >
                ${escapeHTML(description)}
            </p>

            <p class="empty-note" style="margin-top:12px;font-size:12px">
                Current week · Monday to today. Both bedtime and wake-up
                time must be within 60 minutes of their targets.
            </p>

        </section>
    `;
}

// ==========================================
// RENDER PAGE
// ==========================================

export function renderSleepPage() {
    const records = getSleepRecords();
    const activeSession = getActiveSleepSession();
    const schedule = getSleepSchedule();

    const today = getDailySleepBreakdown(
        getTodayKey(),
        records,
        activeSession
    );

    const weekExtremes = getPeriodExtremes(
        "week",
        records,
        activeSession
    );

    const monthExtremes = getPeriodExtremes(
        "month",
        records,
        activeSession
    );

    const weeklySessionCount = getWeeklySessionCount(records);

    const sleepTimer = activeSession
        ? `
            <div style="
                display:flex;
                flex-direction:column;
                align-items:center;
                text-align:center;
                padding:28px 12px;
            ">

                <div style="
                    font-size:13px;
                    color:var(--accent);
                    font-weight:700;
                    letter-spacing:1.5px;
                ">
                    ${activeSession.type === "nap"
                        ? "NAP IN PROGRESS"
                        : "MAIN SLEEP IN PROGRESS"}
                </div>

                <div
                    id="sleep-live-duration"
                    class="timer-display"
                    style="
                        font-size:clamp(42px,8vw,64px);
                        margin:20px 0 12px;
                        font-variant-numeric:tabular-nums;
                    "
                >
                    ${formatElapsed(
                        Date.now() -
                        new Date(activeSession.bedtime).getTime()
                    )}
                </div>

                <p class="empty-note">
                    Started at ${escapeHTML(formatTime(activeSession.bedtime))}
                    · ${escapeHTML(formatDate(activeSession.bedtime))}
                </p>

                <p class="timer-subtitle" style="margin-top:12px">
                    Your timer keeps running when you close or refresh the app.
                </p>

                <button
                    class="primary-button"
                    id="sleep-stop"
                    style="margin-top:24px"
                >
                    ☀ Stop Sleeping
                </button>

            </div>
        `
        : `
            <div style="
                display:flex;
                flex-direction:column;
                align-items:center;
                text-align:center;
                padding:28px 12px;
            ">

                <div style="font-size:42px;margin-bottom:14px">
                    ☾
                </div>

                <h2>Ready to rest?</h2>

                <p class="empty-note" style="
                    max-width:380px;
                    line-height:1.7;
                    margin-top:8px;
                ">
                    Choose the sleep type, then start the timer.
                </p>

                <label style="
                    display:block;
                    width:min(280px,100%);
                    margin-top:20px;
                    text-align:left;
                ">
                    <span class="card-title" style="display:block;margin-bottom:8px">
                        Sleep type
                    </span>

                    <select class="subject-select" id="sleep-session-type">
                        <option value="main">Main Sleep</option>
                        <option value="nap">Nap</option>
                    </select>
                </label>

                <button
                    class="primary-button"
                    id="sleep-start"
                    style="margin-top:18px"
                >
                    ☾ Start Sleeping
                </button>

            </div>
        `;

    return `
        <section class="page-heading">
            <h1>Sleep Tracker</h1>

            <p>
                Track your sleep, understand your daily rest
                and build a routine that works for you.
            </p>
        </section>

        <!-- SLEEP TIMER -->

        <section class="card" style="margin-top:20px">
            <div class="card-title">SLEEP TIMER</div>
            ${sleepTimer}
        </section>

        <!-- DAILY STATISTICS -->

        <section class="stats-grid" style="margin-top:20px">

            <div class="card">
                <div class="card-title">Today's Sleep</div>

                <div class="stat-value" id="sleep-today-total">
                    ${formatDuration(today.totalSeconds)}
                </div>

                <div class="stat-description">
                    Main Sleep + Naps
                </div>
            </div>

            <div class="card">
                <div class="card-title">Main Sleep Today</div>

                <div class="stat-value" id="sleep-today-main">
                    ${formatDuration(today.mainSeconds)}
                </div>

                <div class="stat-description">
                    Main sleep sessions
                </div>
            </div>

            <div class="card">
                <div class="card-title">Naps Today</div>

                <div class="stat-value" id="sleep-today-nap">
                    ${formatDuration(today.napSeconds)}
                </div>

                <div class="stat-description">
                    Short sleep sessions
                </div>
            </div>

            <div class="card">
                <div class="card-title">Sessions This Week</div>

                <div class="stat-value">
                    ${weeklySessionCount}
                </div>

                <div class="stat-description">
                    Completed sleep sessions
                </div>
            </div>

        </section>

        <!-- WEEKLY INSIGHTS -->

        <section style="margin-top:28px">

            <div class="page-heading">
                <h2>Weekly Sleep Insights</h2>

                <p>
                    Longest and shortest sleep days.
                    Statistics reset every Monday.
                </p>
            </div>

            <div style="
                display:grid;
                grid-template-columns:repeat(auto-fit,minmax(210px,1fr));
                gap:16px;
                margin-top:16px;
            ">

                ${renderExtremeCard(
                    "WEEKLY BEST",
                    "Longest Sleep Day",
                    weekExtremes.best,
                    "Most total sleep this week",
                    "sleep-week-best"
                )}

                ${renderExtremeCard(
                    "WEEKLY LOW",
                    "Shortest Sleep Day",
                    weekExtremes.worst,
                    "Among days with recorded sleep",
                    "sleep-week-worst"
                )}

            </div>

        </section>

        <!-- MONTHLY INSIGHTS -->

        <section style="margin-top:28px">

            <div class="page-heading">
                <h2>Monthly Sleep Insights</h2>

                <p>
                    Longest and shortest sleep days this month.
                    Statistics reset on the first day of each month.
                </p>
            </div>

            <div style="
                display:grid;
                grid-template-columns:repeat(auto-fit,minmax(210px,1fr));
                gap:16px;
                margin-top:16px;
            ">

                ${renderExtremeCard(
                    "MONTHLY BEST",
                    "Longest Sleep Day",
                    monthExtremes.best,
                    "Most total sleep this month",
                    "sleep-month-best"
                )}

                ${renderExtremeCard(
                    "MONTHLY LOW",
                    "Shortest Sleep Day",
                    monthExtremes.worst,
                    "Among days with recorded sleep",
                    "sleep-month-worst"
                )}

            </div>

        </section>

        <!-- SLEEP SCHEDULE -->

        ${renderSleepSchedule(schedule)}

        <!-- SLEEP CONSISTENCY -->

        <section id="sleep-consistency-panel">
            ${renderConsistency(records, schedule)}
        </section>

        <!-- SLEEP CALENDAR -->

        ${renderCalendar(records, activeSession)}

        <!-- EDIT RECORD PANEL -->

        ${renderSleepEditor()}

        <!-- SLEEP HISTORY -->

        <section class="card" style="margin-top:22px">

            <div class="card-title">YOUR RECORDS</div>

            <h2 style="margin-top:8px">
                Sleep History
            </h2>

            <p class="empty-note" style="margin-top:6px">
                Your latest 50 completed sleep sessions.
            </p>

            <div id="sleep-history" style="margin-top:14px">
                ${renderSleepHistory(records)}
            </div>

        </section>
    `;
}

// ==========================================
// LIVE DASHBOARD UPDATE
// ==========================================

function updateDashboardStatistics() {
    const records = getSleepRecords();
    const activeSession = getActiveSleepSession();
    const schedule = getSleepSchedule();

    const today = getDailySleepBreakdown(
        getTodayKey(),
        records,
        activeSession
    );

    const updates = [
        ["#sleep-today-total", formatDuration(today.totalSeconds)],
        ["#sleep-today-main", formatDuration(today.mainSeconds)],
        ["#sleep-today-nap", formatDuration(today.napSeconds)]
    ];

    for (const [selector, value] of updates) {
        const element = document.querySelector(selector);

        if (element) {
            element.textContent = value;
        }
    }

    // Update weekly and monthly extremes.
    const week = getPeriodExtremes(
        "week",
        records,
        activeSession
    );

    const month = getPeriodExtremes(
        "month",
        records,
        activeSession
    );

    function updateExtreme(prefix, extreme) {
        const duration = document.querySelector(
            `#${prefix}-duration`
        );

        const date = document.querySelector(
            `#${prefix}-date`
        );

        if (duration) {
            duration.textContent = extreme
                ? formatDuration(extreme.seconds)
                : "--";
        }

        if (date) {
            date.textContent = extreme
                ? formatDateKey(extreme.date)
                : "No sleep data yet";
        }
    }

    updateExtreme("sleep-week-best", week.best);
    updateExtreme("sleep-week-worst", week.worst);

    updateExtreme("sleep-month-best", month.best);
    updateExtreme("sleep-month-worst", month.worst);

    // Update consistency.
    const consistency = getSleepConsistency(
        records,
        schedule
    );

    const scoreElement = document.querySelector(
        "#sleep-consistency-score"
    );

    const descriptionElement = document.querySelector(
        "#sleep-consistency-description"
    );

    if (scoreElement && descriptionElement) {
        if (!consistency.enabled) {
            scoreElement.textContent = "--";

            descriptionElement.textContent =
                "Set your sleep schedule to begin tracking.";

        } else if (consistency.total === 0) {
            scoreElement.textContent = "--";

            descriptionElement.textContent =
                "No completed Main Sleep sessions recorded this week yet.";

        } else {
            scoreElement.textContent =
                `${consistency.percentage}%`;

            descriptionElement.textContent =
                `${consistency.matches} of ${consistency.total} Main Sleep sessions were within 60 minutes of your schedule.`;
        }
    }

    // Update selected calendar date.
    updateSelectedCalendarDay(records, activeSession);
}

// ==========================================
// CALENDAR SELECTED-DAY UPDATE
// ==========================================

function updateSelectedCalendarDay(
    records = getSleepRecords(),
    activeSession = getActiveSleepSession()
) {
    const breakdown = getDailySleepBreakdown(
        selectedCalendarDate,
        records,
        activeSession
    );

    const updates = [
        ["#calendar-selected-total", formatDuration(breakdown.totalSeconds)],
        ["#calendar-selected-main", formatDuration(breakdown.mainSeconds)],
        ["#calendar-selected-nap", formatDuration(breakdown.napSeconds)]
    ];

    for (const [selector, value] of updates) {
        const element = document.querySelector(selector);

        if (element) {
            element.textContent = value;
        }
    }

    const cellDuration = document.getElementById(
        `calendar-total-${selectedCalendarDate}`
    );

    if (cellDuration) {
        cellDuration.textContent =
            breakdown.totalSeconds > 0
                ? formatCompactDuration(breakdown.totalSeconds)
                : "—";
    }
}

// ==========================================
// PAGE EVENT BINDING
// ==========================================

export function bindSleepPage() {
    if (sleepInterval) {
        clearInterval(sleepInterval);
        sleepInterval = null;
    }

    const startButton = document.querySelector("#sleep-start");
    const stopButton = document.querySelector("#sleep-stop");

    const historyContainer = document.querySelector("#sleep-history");

    const pageContent = document.querySelector(".page-content");

    // ======================================
    // REFRESH PAGE
    // ======================================

    function refreshSleepPage() {
        if (!pageContent) {
            return;
        }

        if (sleepInterval) {
            clearInterval(sleepInterval);
            sleepInterval = null;
        }

        pageContent.innerHTML = renderSleepPage();

        bindSleepPage();
    }

    // ======================================
    // START SLEEPING
    // ======================================

    startButton?.addEventListener("click", () => {
        const type = document.querySelector(
            "#sleep-session-type"
        )?.value || "main";

        try {
            startSleepSession(type);
            refreshSleepPage();
        } catch (error) {
            window.alert(error.message);
        }
    });

    // ======================================
    // STOP SLEEPING
    // ======================================

    stopButton?.addEventListener("click", () => {
        const confirmed = window.confirm(
            "Finish this sleep session and save the record?"
        );

        if (!confirmed) {
            return;
        }

        try {
            stopSleepSession();
            refreshSleepPage();
        } catch (error) {
            window.alert(error.message);
        }
    });

    // ======================================
    // LIVE TIMER AND STATISTICS
    // ======================================

    function updateLiveTimer() {
        const display = document.querySelector(
            "#sleep-live-duration"
        );

        // Stop polling when the user leaves the Sleep page.
        if (!display || !display.isConnected) {
            clearInterval(sleepInterval);
            sleepInterval = null;
            return;
        }

        const activeSession = getActiveSleepSession();

        if (!activeSession) {
            clearInterval(sleepInterval);
            sleepInterval = null;
            return;
        }

        const elapsed =
            Date.now() -
            new Date(activeSession.bedtime).getTime();

        display.textContent = formatElapsed(elapsed);

        updateDashboardStatistics();
    }

    if (getActiveSleepSession()) {
        updateLiveTimer();

        sleepInterval = setInterval(
            updateLiveTimer,
            1000
        );
    }

    // ======================================
    // SAVE SLEEP SCHEDULE
    // ======================================

    const scheduleForm = document.querySelector(
        "#sleep-schedule-form"
    );

    scheduleForm?.addEventListener("submit", event => {
        event.preventDefault();

        const enabled = document.querySelector(
            "#sleep-schedule-enabled"
        ).checked;

        const bedtime = document.querySelector(
            "#sleep-schedule-bedtime"
        ).value;

        const wakeTime = document.querySelector(
            "#sleep-schedule-wake"
        ).value;

        const message = document.querySelector(
            "#sleep-schedule-message"
        );

        try {
            saveSleepSchedule({
                enabled,
                bedtime,
                wakeTime
            });

            message.textContent = "Sleep schedule saved.";

            updateDashboardStatistics();

        } catch (error) {
            message.textContent = error.message;
        }
    });

    // ======================================
    // EDIT SLEEP RECORD
    // ======================================

    const editPanel = document.querySelector(
        "#sleep-edit-panel"
    );

    const editForm = document.querySelector(
        "#sleep-edit-form"
    );

    historyContainer?.addEventListener("click", event => {
        const editButton = event.target.closest(
            "[data-sleep-edit]"
        );

        if (!editButton) {
            return;
        }

        const id = editButton.dataset.sleepEdit;

        const record = getSleepRecords().find(
            item => item.id === id
        );

        if (!record) {
            return;
        }

        document.querySelector("#sleep-edit-id").value =
            record.id;

        document.querySelector("#sleep-edit-type").value =
            record.type === "nap" ? "nap" : "main";

        document.querySelector("#sleep-edit-bedtime").value =
            toDateTimeLocal(record.bedtime);

        document.querySelector("#sleep-edit-wake").value =
            toDateTimeLocal(record.wakeTime);

        document.querySelector("#sleep-edit-quality").value =
            record.quality || "";

        document.querySelector("#sleep-edit-note").value =
            record.note || "";

        document.querySelector("#sleep-edit-title").textContent =
            `Edit ${record.type === "nap" ? "Nap" : "Main Sleep"}`;

        editPanel.hidden = false;

        document.querySelector("#sleep-edit-message").textContent = "";

        editPanel.scrollIntoView({
            behavior: "smooth",
            block: "center"
        });
    });

    editForm?.addEventListener("submit", event => {
        event.preventDefault();

        const id = document.querySelector(
            "#sleep-edit-id"
        ).value;

        const message = document.querySelector(
            "#sleep-edit-message"
        );

        try {
            saveSleepRecord({
                id,

                type: document.querySelector(
                    "#sleep-edit-type"
                ).value,

                bedtime: document.querySelector(
                    "#sleep-edit-bedtime"
                ).value,

                wakeTime: document.querySelector(
                    "#sleep-edit-wake"
                ).value,

                quality: document.querySelector(
                    "#sleep-edit-quality"
                ).value || null,

                note: document.querySelector(
                    "#sleep-edit-note"
                ).value
            });

            refreshSleepPage();

        } catch (error) {
            message.textContent = error.message;
        }
    });

    document
        .querySelector("#sleep-edit-cancel")
        ?.addEventListener("click", () => {
            editPanel.hidden = true;
        });

    // ======================================
    // DELETE SLEEP RECORD
    // ======================================

    historyContainer?.addEventListener("click", event => {
        const deleteButton = event.target.closest(
            "[data-sleep-delete]"
        );

        if (!deleteButton) {
            return;
        }

        const confirmed = window.confirm(
            "Delete this sleep record?"
        );

        if (!confirmed) {
            return;
        }

        try {
            deleteSleepRecord(deleteButton.dataset.sleepDelete);
            refreshSleepPage();

        } catch (error) {
            window.alert(error.message);
        }
    });

    // ======================================
    // CALENDAR NAVIGATION
    // ======================================

    document
        .querySelector("#calendar-prev")
        ?.addEventListener("click", () => {
            calendarMonth = new Date(
                calendarMonth.getFullYear(),
                calendarMonth.getMonth() - 1,
                1
            );

            selectedCalendarDate = getDateKey(calendarMonth);

            refreshSleepPage();
        });

    document
        .querySelector("#calendar-next")
        ?.addEventListener("click", () => {
            const nextMonth = new Date(
                calendarMonth.getFullYear(),
                calendarMonth.getMonth() + 1,
                1
            );

            const currentMonth = new Date(
                new Date().getFullYear(),
                new Date().getMonth(),
                1
            );

            if (nextMonth > currentMonth) {
                return;
            }

            calendarMonth = nextMonth;

            selectedCalendarDate = getDateKey(calendarMonth);

            refreshSleepPage();
        });

    // ======================================
    // SELECT CALENDAR DAY
    // ======================================

    document
        .querySelector("#sleep-calendar")
        ?.addEventListener("click", event => {
            const dayButton = event.target.closest(
                "[data-calendar-date]"
            );

            if (!dayButton) {
                return;
            }

            selectedCalendarDate =
                dayButton.dataset.calendarDate;

            refreshSleepPage();
        });
}