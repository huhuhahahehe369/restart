
import {
    getStudyHistory,
    getSleepRecords,
    getGoals,
    saveGoal,
    deleteGoal
} from "../js/storage.js";

// ==========================================
// RE:START M07 - CALENDAR & GOALS
// Uses the existing M02, M04 and storage APIs.
// ==========================================

let calendarMonth = new Date(
    new Date().getFullYear(),
    new Date().getMonth(),
    1,
    12
);

let selectedDate = getDateKey(new Date());
let goalEditorOpen = false;
let editingGoalId = null;
let calendarNotice = "";
let calendarNoticeIsError = false;

const SUBJECTS = [
    "Mathematics",
    "Physics",
    "Informatics",
    "ĐGNL",
    "English",
    "Chemistry"
];

// ==========================================
// LANGUAGE
// ==========================================

function getLanguage() {
    try {
        const language = localStorage.getItem("restart-data-v1");
        const database = language ? JSON.parse(language) : null;
        const selected = database?.settings?.language;
        return ["en", "vi", "bi"].includes(selected) ? selected : "en";
    } catch {
        return "en";
    }
}

function tx(english, vietnamese) {
    const language = getLanguage();

    if (language === "vi") return vietnamese;
    if (language === "bi") return `${english} · ${vietnamese}`;
    return english;
}

function getLocale() {
    return getLanguage() === "vi" ? "vi-VN" : "en-US";
}

// ==========================================
// DATE HELPERS
// ==========================================

function getDateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function parseDateKey(key) {
    const [year, month, day] = String(key).split("-").map(Number);
    return new Date(year, month - 1, day, 12, 0, 0, 0);
}

function addDays(date, amount) {
    const result = new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate(),
        12
    );
    result.setDate(result.getDate() + amount);
    return result;
}

function formatDate(key, options = {}) {
    return parseDateKey(key).toLocaleDateString(getLocale(), {
        weekday: options.weekday ? "long" : undefined,
        day: "numeric",
        month: "short",
        year: options.year ? "numeric" : undefined
    });
}

function formatMonth(date) {
    return date.toLocaleDateString(getLocale(), {
        month: "long",
        year: "numeric"
    });
}

function formatDuration(seconds) {
    const totalMinutes = Math.floor(Math.max(0, Number(seconds) || 0) / 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    if (getLanguage() === "vi") {
        if (hours > 0) return `${hours} giờ ${minutes} phút`;
        return `${minutes} phút`;
    }

    const english = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
    if (getLanguage() === "bi") {
        const vietnamese = hours > 0
            ? `${hours} giờ ${minutes} phút`
            : `${minutes} phút`;
        return `${english} · ${vietnamese}`;
    }
    return english;
}

function formatClock(value) {
    return new Date(value).toLocaleTimeString(getLocale(), {
        hour: "2-digit",
        minute: "2-digit"
    });
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

function roundValue(value, digits = 1) {
    const power = 10 ** digits;
    return Math.round((Number(value) || 0) * power) / power;
}

// ==========================================
// DATA AGGREGATION
// ==========================================

function createEmptyDay(date) {
    return {
        date,
        studySeconds: 0,
        subjects: {},
        completedSessions: 0,
        mainSleepSeconds: 0,
        napSeconds: 0
    };
}

function getDailyData() {
    const days = new Map();

    function ensureDay(dateKey) {
        if (!days.has(dateKey)) {
            days.set(dateKey, createEmptyDay(dateKey));
        }
        return days.get(dateKey);
    }

    // Study data is already stored by local calendar day in M02.
    const studyHistory = getStudyHistory();

    for (const record of studyHistory) {
        if (!record?.date) continue;

        const day = ensureDay(record.date);
        const subjects = record.studySeconds || {};

        for (const [subject, rawSeconds] of Object.entries(subjects)) {
            const seconds = Math.max(0, Number(rawSeconds) || 0);
            day.subjects[subject] = (day.subjects[subject] || 0) + seconds;
            day.studySeconds += seconds;
        }

        day.completedSessions = Math.max(
            day.completedSessions,
            Number(record.completedSessions) || 0
        );
    }

    // Sleep can cross midnight, so split each record at local midnight.
    const sleepRecords = getSleepRecords();

    for (const record of sleepRecords) {
        const bedtime = new Date(record.bedtime);
        const wakeTime = new Date(record.wakeTime);

        if (
            Number.isNaN(bedtime.getTime()) ||
            Number.isNaN(wakeTime.getTime()) ||
            wakeTime <= bedtime
        ) {
            continue;
        }

        let cursor = new Date(
            bedtime.getFullYear(),
            bedtime.getMonth(),
            bedtime.getDate(),
            0, 0, 0, 0
        );

        while (cursor < wakeTime) {
            const nextMidnight = new Date(
                cursor.getFullYear(),
                cursor.getMonth(),
                cursor.getDate() + 1,
                0, 0, 0, 0
            );

            const overlapStart = Math.max(bedtime.getTime(), cursor.getTime());
            const overlapEnd = Math.min(wakeTime.getTime(), nextMidnight.getTime());
            const overlapSeconds = Math.max(
                0,
                Math.floor((overlapEnd - overlapStart) / 1000)
            );

            if (overlapSeconds > 0) {
                const day = ensureDay(getDateKey(cursor));
                if (record.type === "nap") {
                    day.napSeconds += overlapSeconds;
                } else {
                    day.mainSleepSeconds += overlapSeconds;
                }
            }

            cursor = nextMidnight;
        }
    }

    return days;
}

function getDayData(dateKey, days) {
    return days.get(dateKey) || createEmptyDay(dateKey);
}

function getSleepEntriesForDate(dateKey) {
    const dayStart = parseDateKey(dateKey);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    return getSleepRecords()
        .map(record => {
            const bedtime = new Date(record.bedtime);
            const wakeTime = new Date(record.wakeTime);
            const start = new Date(Math.max(bedtime.getTime(), dayStart.getTime()));
            const end = new Date(Math.min(wakeTime.getTime(), dayEnd.getTime()));
            const seconds = Math.max(0, Math.floor((end - start) / 1000));

            return { ...record, visibleStart: start, visibleEnd: end, visibleSeconds: seconds };
        })
        .filter(record => record.visibleSeconds > 0)
        .sort((a, b) => a.visibleStart - b.visibleStart);
}

// ==========================================
// CALENDAR GRID
// ==========================================

function renderWeekdayHeaders() {
    const english = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const vietnamese = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];

    return english.map((day, index) => `
        <div class="restart-weekday">
            ${escapeHTML(tx(day, vietnamese[index]))}
        </div>
    `).join("");
}

function renderCalendarGrid(days) {
    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();
    const firstDate = new Date(year, month, 1, 12);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const mondayOffset = (firstDate.getDay() + 6) % 7;
    const todayKey = getDateKey(new Date());
    const cells = [];

    for (let index = 0; index < mondayOffset; index++) {
        cells.push('<div class="restart-calendar-empty" aria-hidden="true"></div>');
    }

    for (let dayNumber = 1; dayNumber <= daysInMonth; dayNumber++) {
        const date = new Date(year, month, dayNumber, 12);
        const dateKey = getDateKey(date);
        const data = getDayData(dateKey, days);
        const selected = dateKey === selectedDate;
        const isToday = dateKey === todayKey;
        const hasStudy = data.studySeconds > 0;
        const hasSleep = data.mainSleepSeconds + data.napSeconds > 0;

        const border = selected
            ? "2px solid var(--accent)"
            : isToday
                ? "1px solid var(--accent)"
                : "1px solid var(--border)";

        const background = selected
            ? "var(--accent-soft)"
            : "var(--bg-secondary)";

        cells.push(`
            <button
                type="button"
                class="restart-calendar-day"
                data-calendar-date="${dateKey}"
                aria-label="${escapeHTML(formatDate(dateKey))}"
                aria-pressed="${selected}"
                style="border:${border};background:${background};"
            >
                <span class="restart-day-number">${dayNumber}</span>
                <span class="restart-day-markers">
                    ${hasStudy ? `<span class="restart-day-marker study" title="${escapeHTML(tx("Study recorded", "Có dữ liệu học tập"))}">◷ ${escapeHTML(formatDuration(data.studySeconds))}</span>` : ""}
                    ${hasSleep ? `<span class="restart-day-marker sleep" title="${escapeHTML(tx("Sleep recorded", "Có dữ liệu giấc ngủ"))}">☾ ${escapeHTML(formatDuration(data.mainSleepSeconds + data.napSeconds))}</span>` : ""}
                </span>
            </button>
        `);
    }

    while (cells.length < 42) {
        cells.push('<div class="restart-calendar-empty" aria-hidden="true"></div>');
    }

    return cells.join("");
}

// ==========================================
// SELECTED DAY DETAILS
// ==========================================

function renderSelectedDay(days) {
    const day = getDayData(selectedDate, days);
    const subjectRows = Object.entries(day.subjects)
        .filter(([, seconds]) => seconds > 0)
        .sort((a, b) => b[1] - a[1]);

    const sleepEntries = getSleepEntriesForDate(selectedDate);
    const mainSleepSeconds = sleepEntries
        .filter(record => record.type !== "nap")
        .reduce((total, record) => total + record.visibleSeconds, 0);
    const napSeconds = sleepEntries
        .filter(record => record.type === "nap")
        .reduce((total, record) => total + record.visibleSeconds, 0);

    const subjectMarkup = subjectRows.length
        ? subjectRows.map(([subject, seconds]) => `
            <div class="restart-detail-row">
                <span>${escapeHTML(subject)}</span>
                <strong>${escapeHTML(formatDuration(seconds))}</strong>
            </div>
        `).join("")
        : `<p class="empty-note">${escapeHTML(tx("No study time recorded on this day.", "Ngày này chưa có thời gian học được ghi nhận."))}</p>`;

    const sleepMarkup = sleepEntries.length
        ? sleepEntries.map(record => `
            <div class="restart-detail-row restart-sleep-row">
                <span>
                    <strong>${record.type === "nap" ? escapeHTML(tx("Nap", "Ngủ ngắn")) : escapeHTML(tx("Main sleep", "Ngủ chính"))}</strong>
                    <small>${escapeHTML(formatClock(record.visibleStart))} – ${escapeHTML(formatClock(record.visibleEnd))}</small>
                </span>
                <strong>${escapeHTML(formatDuration(record.visibleSeconds))}</strong>
            </div>
        `).join("")
        : `<p class="empty-note">${escapeHTML(tx("No sleep records on this day.", "Ngày này chưa có bản ghi giấc ngủ."))}</p>`;

    const totalSleepSeconds = mainSleepSeconds + napSeconds;

    return `
        <section class="card restart-selected-day">
            <div class="restart-section-eyebrow">${escapeHTML(tx("SELECTED DAY", "NGÀY ĐƯỢC CHỌN"))}</div>
            <h2>${escapeHTML(formatDate(selectedDate, { weekday: true, year: true }))}</h2>

            <div class="restart-day-stats">
                <div class="restart-day-stat">
                    <span>${escapeHTML(tx("Study time", "Thời gian học"))}</span>
                    <strong>${escapeHTML(formatDuration(day.studySeconds))}</strong>
                </div>
                <div class="restart-day-stat">
                    <span>${escapeHTML(tx("Focus sessions", "Phiên tập trung"))}</span>
                    <strong>${day.completedSessions}</strong>
                </div>
                <div class="restart-day-stat">
                    <span>${escapeHTML(tx("Total sleep", "Tổng thời gian ngủ"))}</span>
                    <strong>${escapeHTML(formatDuration(totalSleepSeconds))}</strong>
                </div>
            </div>

            <div class="restart-detail-section">
                <h3>${escapeHTML(tx("Study by subject", "Thời gian học theo môn"))}</h3>
                ${subjectMarkup}
            </div>

            <div class="restart-detail-section">
                <h3>${escapeHTML(tx("Sleep records", "Bản ghi giấc ngủ"))}</h3>
                ${sleepMarkup}
                <p class="empty-note restart-detail-hint">
                    ${escapeHTML(tx("Sleep sessions crossing midnight are split between their calendar days.", "Giấc ngủ qua nửa đêm được chia thời lượng vào từng ngày tương ứng."))}
                </p>
            </div>
        </section>
    `;
}

// ==========================================
// GOAL CALCULATIONS
// ==========================================

function getPeriodRange(dateKey, period) {
    const date = parseDateKey(dateKey);

    if (period === "weekly") {
        const mondayOffset = (date.getDay() + 6) % 7;
        const start = addDays(date, -mondayOffset);
        return { start, end: addDays(start, 6) };
    }

    if (period === "monthly") {
        const start = new Date(date.getFullYear(), date.getMonth(), 1, 12);
        const end = new Date(date.getFullYear(), date.getMonth() + 1, 0, 12);
        return { start, end };
    }

    return { start: date, end: date };
}

function getDateKeysInRange(start, end) {
    const keys = [];
    let cursor = new Date(start);

    while (cursor <= end) {
        keys.push(getDateKey(cursor));
        cursor = addDays(cursor, 1);
    }

    return keys;
}

function getGoalMetricValue(goal, dateKeys, days) {
    let total = 0;

    for (const dateKey of dateKeys) {
        const day = getDayData(dateKey, days);

        if (goal.metric === "study_hours") {
            total += day.studySeconds / 3600;
        } else if (goal.metric === "sleep_hours") {
            total += (day.mainSleepSeconds + day.napSeconds) / 3600;
        } else if (goal.metric === "focus_sessions") {
            total += day.completedSessions;
        } else if (goal.metric === "subject_hours") {
            total += (day.subjects[goal.subject] || 0) / 3600;
        }
    }

    return total;
}

function getMetricLabel(metric) {
    const labels = {
        study_hours: tx("Study hours", "Giờ học"),
        sleep_hours: tx("Sleep hours", "Giờ ngủ"),
        focus_sessions: tx("Focus sessions", "Phiên tập trung"),
        subject_hours: tx("Subject study hours", "Giờ học theo môn")
    };
    return labels[metric] || metric;
}

function getPeriodLabel(period) {
    const labels = {
        daily: tx("Daily", "Hằng ngày"),
        weekly: tx("Weekly", "Hằng tuần"),
        monthly: tx("Monthly", "Hằng tháng")
    };
    return labels[period] || period;
}

function formatGoalValue(value, metric) {
    if (metric === "focus_sessions") {
        return String(Math.floor(value));
    }
    return String(roundValue(value, 1));
}

function renderGoalCards(goals, days) {
    if (!goals.length) {
        return `
            <div class="restart-empty-goals">
                <div class="restart-empty-icon">◎</div>
                <strong>${escapeHTML(tx("No goals yet", "Chưa có mục tiêu nào"))}</strong>
                <p>${escapeHTML(tx("Create a goal and RE:START will calculate progress from your Study and Sleep records.", "Tạo mục tiêu để RE:START tự tính tiến độ từ dữ liệu học tập và giấc ngủ."))}</p>
            </div>
        `;
    }

    return goals.map(goal => {
        const range = getPeriodRange(selectedDate, goal.period);
        const dateKeys = getDateKeysInRange(range.start, range.end);
        const progress = getGoalMetricValue(goal, dateKeys, days);
        const percentage = Math.min(100, Math.max(0, (progress / goal.targetValue) * 100));
        const unit = goal.metric === "focus_sessions"
            ? tx("sessions", "phiên")
            : tx("hours", "giờ");
        const rangeLabel = `${formatDate(getDateKey(range.start))} – ${formatDate(getDateKey(range.end))}`;

        return `
            <article class="restart-goal-card">
                <div class="restart-goal-topline">
                    <div>
                        <span class="restart-goal-period">${escapeHTML(getPeriodLabel(goal.period))}</span>
                        <h3>${escapeHTML(goal.title)}</h3>
                        <p class="empty-note">${escapeHTML(getMetricLabel(goal.metric))}${goal.metric === "subject_hours" ? ` · ${escapeHTML(goal.subject)}` : ""}</p>
                    </div>
                    <div class="restart-goal-actions">
                        <button type="button" class="secondary-button restart-small-button" data-edit-goal="${escapeHTML(goal.id)}">${escapeHTML(tx("Edit", "Sửa"))}</button>
                        <button type="button" class="secondary-button restart-small-button" data-delete-goal="${escapeHTML(goal.id)}">${escapeHTML(tx("Delete", "Xóa"))}</button>
                    </div>
                </div>

                <div class="restart-goal-values">
                    <strong>${escapeHTML(formatGoalValue(progress, goal.metric))} / ${escapeHTML(formatGoalValue(goal.targetValue, goal.metric))} ${escapeHTML(unit)}</strong>
                    <span>${Math.round(percentage)}%</span>
                </div>
                <div class="restart-progress-track" role="progressbar" aria-valuenow="${Math.round(percentage)}" aria-valuemin="0" aria-valuemax="100" aria-label="${escapeHTML(goal.title)}">
                    <div class="restart-progress-fill" style="width:${percentage.toFixed(1)}%"></div>
                </div>
                <p class="empty-note restart-goal-range">${escapeHTML(rangeLabel)}</p>
            </article>
        `;
    }).join("");
}

// ==========================================
// GOAL FORM
// ==========================================

function renderGoalForm() {
    return `
        <form id="restart-goal-form" class="restart-goal-form" ${goalEditorOpen ? "" : "hidden"}>
            <div class="restart-form-heading">
                <div>
                    <div class="restart-section-eyebrow">${escapeHTML(tx("GOAL DETAILS", "THÔNG TIN MỤC TIÊU"))}</div>
                    <h3>${escapeHTML(editingGoalId ? tx("Edit goal", "Chỉnh sửa mục tiêu") : tx("Create a goal", "Tạo mục tiêu mới"))}</h3>
                </div>
            </div>

            <label class="restart-field">
                <span>${escapeHTML(tx("Goal name", "Tên mục tiêu"))}</span>
                <input id="restart-goal-title" class="subject-select" type="text" maxlength="80" required placeholder="${escapeHTML(tx("e.g. Study consistently", "Ví dụ: Duy trì việc học đều đặn"))}">
            </label>

            <div class="restart-form-grid">
                <label class="restart-field">
                    <span>${escapeHTML(tx("Goal type", "Loại mục tiêu"))}</span>
                    <select id="restart-goal-metric" class="subject-select">
                        <option value="study_hours">${escapeHTML(tx("Study hours", "Giờ học"))}</option>
                        <option value="sleep_hours">${escapeHTML(tx("Sleep hours", "Giờ ngủ"))}</option>
                        <option value="focus_sessions">${escapeHTML(tx("Focus sessions", "Phiên tập trung"))}</option>
                        <option value="subject_hours">${escapeHTML(tx("Subject study hours", "Giờ học theo môn"))}</option>
                    </select>
                </label>

                <label class="restart-field">
                    <span>${escapeHTML(tx("Period", "Chu kỳ"))}</span>
                    <select id="restart-goal-period" class="subject-select">
                        <option value="daily">${escapeHTML(tx("Daily", "Hằng ngày"))}</option>
                        <option value="weekly" selected>${escapeHTML(tx("Weekly", "Hằng tuần"))}</option>
                        <option value="monthly">${escapeHTML(tx("Monthly", "Hằng tháng"))}</option>
                    </select>
                </label>

                <label class="restart-field" id="restart-goal-subject-wrap" hidden>
                    <span>${escapeHTML(tx("Subject", "Môn học"))}</span>
                    <select id="restart-goal-subject" class="subject-select">
                        ${SUBJECTS.map(subject => `<option value="${escapeHTML(subject)}">${escapeHTML(subject)}</option>`).join("")}
                    </select>
                </label>

                <label class="restart-field">
                    <span>${escapeHTML(tx("Target", "Mục tiêu cần đạt"))}</span>
                    <input id="restart-goal-target" class="subject-select" type="number" min="0.1" max="10000" step="0.1" required value="5">
                    <small id="restart-goal-target-help">${escapeHTML(tx("Enter the target in hours.", "Nhập mục tiêu theo giờ."))}</small>
                </label>
            </div>

            <div class="restart-form-actions">
                <button type="submit" class="primary-button" id="restart-goal-submit">${escapeHTML(tx("Save goal", "Lưu mục tiêu"))}</button>
                <button type="button" class="secondary-button" id="restart-goal-cancel">${escapeHTML(tx("Cancel", "Hủy"))}</button>
            </div>
        </form>
    `;
}

// ==========================================
// PAGE RENDER
// ==========================================

export function renderCalendarPage() {
    const days = getDailyData();
    const goals = getGoals();
    const selectedDay = getDayData(selectedDate, days);
    const monthTitle = formatMonth(calendarMonth);

    return `
        <section id="restart-calendar">
            <style>
                #restart-calendar { display:grid; gap:20px; }
                #restart-calendar .restart-calendar-layout { display:grid; grid-template-columns:minmax(0,1.55fr) minmax(280px,1fr); gap:20px; align-items:start; }
                #restart-calendar .restart-section-eyebrow { color:var(--accent); font-size:11px; font-weight:750; letter-spacing:1.4px; margin-bottom:7px; }
                #restart-calendar .restart-month-heading { display:flex; justify-content:space-between; align-items:center; gap:12px; margin-bottom:18px; }
                #restart-calendar .restart-month-heading h2 { font-size:20px; }
                #restart-calendar .restart-month-actions { display:flex; gap:8px; }
                #restart-calendar .restart-month-actions button { width:38px; height:38px; padding:0; border:1px solid var(--border); border-radius:10px; background:var(--bg-secondary); color:var(--text-primary); font-size:18px; }
                #restart-calendar .restart-weekdays, #restart-calendar .restart-calendar-grid { display:grid; grid-template-columns:repeat(7,minmax(0,1fr)); gap:6px; }
                #restart-calendar .restart-weekday { color:var(--text-muted); text-align:center; font-size:11px; font-weight:700; padding:7px 0; }
                #restart-calendar .restart-calendar-day { min-width:0; min-height:82px; padding:8px 5px; border-radius:11px; color:var(--text-primary); text-align:left; display:flex; flex-direction:column; gap:7px; overflow:hidden; }
                #restart-calendar .restart-day-number { font-size:13px; font-weight:700; }
                #restart-calendar .restart-day-markers { display:grid; gap:3px; }
                #restart-calendar .restart-day-marker { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:9px; line-height:1.35; color:var(--text-secondary); }
                #restart-calendar .restart-day-marker.study { color:var(--accent); }
                #restart-calendar .restart-day-marker.sleep { color:var(--blue); }
                #restart-calendar .restart-calendar-empty { min-height:82px; }
                #restart-calendar .restart-calendar-legend { display:flex; gap:16px; flex-wrap:wrap; margin-top:14px; color:var(--text-muted); font-size:11px; }
                #restart-calendar .restart-legend-dot { display:inline-block; width:7px; height:7px; border-radius:50%; margin-right:6px; background:var(--accent); }
                #restart-calendar .restart-legend-dot.sleep { background:var(--blue); }
                #restart-calendar .restart-day-stats { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:9px; margin:18px 0 22px; }
                #restart-calendar .restart-day-stat { padding:12px; border-radius:12px; background:var(--bg-secondary); min-width:0; }
                #restart-calendar .restart-day-stat span { display:block; color:var(--text-muted); font-size:11px; }
                #restart-calendar .restart-day-stat strong { display:block; margin-top:6px; font-size:17px; overflow-wrap:anywhere; }
                #restart-calendar .restart-detail-section { padding-top:16px; margin-top:15px; border-top:1px solid var(--border); }
                #restart-calendar .restart-detail-section h3 { font-size:14px; margin-bottom:12px; }
                #restart-calendar .restart-detail-row { display:flex; justify-content:space-between; align-items:center; gap:12px; padding:9px 0; border-bottom:1px solid var(--border); font-size:12px; }
                #restart-calendar .restart-detail-row:last-child { border-bottom:0; }
                #restart-calendar .restart-detail-row strong { flex-shrink:0; }
                #restart-calendar .restart-sleep-row small { display:block; margin-top:3px; color:var(--text-muted); }
                #restart-calendar .restart-detail-hint { margin-top:10px; line-height:1.5; }
                #restart-calendar .restart-goals-heading { display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom:16px; }
                #restart-calendar .restart-goal-list { display:grid; grid-template-columns:repeat(auto-fit,minmax(250px,1fr)); gap:12px; }
                #restart-calendar .restart-goal-card { padding:16px; border:1px solid var(--border); border-radius:14px; background:var(--bg-secondary); min-width:0; }
                #restart-calendar .restart-goal-topline { display:flex; justify-content:space-between; align-items:flex-start; gap:10px; }
                #restart-calendar .restart-goal-topline h3 { font-size:15px; margin:4px 0; overflow-wrap:anywhere; }
                #restart-calendar .restart-goal-period { color:var(--accent); font-size:10px; font-weight:750; text-transform:uppercase; letter-spacing:1px; }
                #restart-calendar .restart-goal-actions { display:flex; gap:5px; flex-shrink:0; }
                #restart-calendar .restart-small-button { padding:7px 9px; font-size:11px; border-radius:8px; }
                #restart-calendar .restart-goal-values { display:flex; justify-content:space-between; gap:10px; margin:18px 0 8px; font-size:12px; }
                #restart-calendar .restart-progress-track { height:8px; overflow:hidden; border-radius:20px; background:var(--bg-hover); }
                #restart-calendar .restart-progress-fill { height:100%; border-radius:20px; background:var(--accent); }
                #restart-calendar .restart-goal-range { margin-top:9px; }
                #restart-calendar .restart-empty-goals { padding:28px 16px; border:1px dashed var(--border); border-radius:14px; text-align:center; color:var(--text-secondary); }
                #restart-calendar .restart-empty-icon { font-size:28px; color:var(--accent); margin-bottom:8px; }
                #restart-calendar .restart-empty-goals p { max-width:480px; margin:6px auto 0; color:var(--text-muted); font-size:12px; }
                #restart-calendar .restart-goal-form { padding:18px; margin-top:14px; border:1px solid var(--border); border-radius:14px; background:var(--bg-secondary); }
                #restart-calendar .restart-goal-form[hidden], #restart-calendar [hidden] { display:none !important; }
                #restart-calendar .restart-form-heading { margin-bottom:14px; }
                #restart-calendar .restart-form-heading h3 { font-size:17px; }
                #restart-calendar .restart-form-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:14px; }
                #restart-calendar .restart-field { display:grid; gap:7px; min-width:0; color:var(--text-secondary); font-size:12px; }
                #restart-calendar .restart-field small { color:var(--text-muted); }
                #restart-calendar .restart-form-actions { display:flex; flex-wrap:wrap; gap:9px; margin-top:16px; }
                #restart-calendar .restart-form-actions button { padding:10px 17px; }
                #restart-calendar .restart-notice { margin:0 0 12px; color:var(--accent); font-size:12px; }
                #restart-calendar .restart-notice.error { color:var(--red); }
                @media(max-width:1000px) { #restart-calendar .restart-calendar-layout { grid-template-columns:1fr; } }
                @media(max-width:520px) {
                    #restart-calendar .restart-calendar-day { min-height:60px; padding:6px 3px; border-radius:8px; gap:4px; }
                    #restart-calendar .restart-calendar-empty { min-height:60px; }
                    #restart-calendar .restart-day-number { font-size:11px; }
                    #restart-calendar .restart-day-marker { font-size:8px; }
                    #restart-calendar .restart-weekdays, #restart-calendar .restart-calendar-grid { gap:3px; }
                    #restart-calendar .restart-day-stats { grid-template-columns:1fr; }
                    #restart-calendar .restart-day-stat { display:flex; justify-content:space-between; align-items:center; gap:10px; }
                    #restart-calendar .restart-day-stat strong { margin:0; font-size:15px; }
                    #restart-calendar .restart-form-grid { grid-template-columns:1fr; }
                    #restart-calendar .restart-goal-topline { flex-direction:column; }
                }
            </style>

            <section class="page-heading">
                <h1>${escapeHTML(tx("Calendar & Goals", "Lịch & Mục tiêu"))}</h1>
                <p>${escapeHTML(tx("Keep track of daily activity and turn your plans into measurable goals.", "Theo dõi hoạt động mỗi ngày và biến kế hoạch thành những mục tiêu có thể đo lường."))}</p>
            </section>

            <div class="restart-calendar-layout">
                <section class="card">
                    <div class="restart-month-heading">
                        <h2>${escapeHTML(monthTitle)}</h2>
                        <div class="restart-month-actions">
                            <button type="button" id="restart-calendar-prev" aria-label="${escapeHTML(tx("Previous month", "Tháng trước"))}">‹</button>
                            <button type="button" id="restart-calendar-today" aria-label="${escapeHTML(tx("Go to today", "Về hôm nay"))}" style="width:auto;padding:0 11px;font-size:11px;">${escapeHTML(tx("Today", "Hôm nay"))}</button>
                            <button type="button" id="restart-calendar-next" aria-label="${escapeHTML(tx("Next month", "Tháng sau"))}">›</button>
                        </div>
                    </div>

                    <div class="restart-weekdays">${renderWeekdayHeaders()}</div>
                    <div class="restart-calendar-grid" id="restart-calendar-grid">${renderCalendarGrid(days)}</div>
                    <div class="restart-calendar-legend">
                        <span><i class="restart-legend-dot"></i>${escapeHTML(tx("Study time", "Thời gian học"))}</span>
                        <span><i class="restart-legend-dot sleep"></i>${escapeHTML(tx("Sleep time", "Thời gian ngủ"))}</span>
                    </div>
                </section>

                ${renderSelectedDay(days)}
            </div>

            <section class="card">
                <div class="restart-goals-heading">
                    <div>
                        <div class="restart-section-eyebrow">${escapeHTML(tx("PERSONAL TARGETS", "MỤC TIÊU CÁ NHÂN"))}</div>
                        <h2>${escapeHTML(tx("Goal management", "Quản lý mục tiêu"))}</h2>
                        <p class="empty-note" style="margin-top:5px;">${escapeHTML(tx("Progress is calculated automatically from saved Study and Sleep records.", "Tiến độ được tự động tính từ dữ liệu học tập và giấc ngủ đã lưu."))}</p>
                    </div>
                    <button type="button" class="primary-button" id="restart-goal-add">＋ ${escapeHTML(tx("Add goal", "Thêm mục tiêu"))}</button>
                </div>

                ${calendarNotice ? `<p class="restart-notice ${calendarNoticeIsError ? "error" : ""}" role="status">${escapeHTML(calendarNotice)}</p>` : ""}
                <div class="restart-goal-list">${renderGoalCards(goals, days)}</div>
                ${renderGoalForm()}
            </section>
        </section>
    `;
}

// ==========================================
// PAGE EVENTS
// ==========================================

function refreshCalendarPage() {
    const content = document.querySelector(".page-content");
    if (!content) return;

    content.innerHTML = renderCalendarPage();
    bindCalendarPage();
}

function setGoalSubjectVisibility() {
    const metric = document.querySelector("#restart-goal-metric");
    const subjectWrap = document.querySelector("#restart-goal-subject-wrap");
    const target = document.querySelector("#restart-goal-target");
    const help = document.querySelector("#restart-goal-target-help");

    if (!metric || !subjectWrap || !target || !help) return;

    const isSubject = metric.value === "subject_hours";
    const isSessions = metric.value === "focus_sessions";

    subjectWrap.hidden = !isSubject;
    target.step = isSessions ? "1" : "0.1";
    target.min = isSessions ? "1" : "0.1";
    target.value = isSessions ? String(Math.max(1, Math.round(Number(target.value) || 1))) : target.value;

    help.textContent = isSessions
        ? tx("Enter a whole number of sessions.", "Nhập số phiên học là số nguyên.")
        : tx("Enter the target in hours.", "Nhập mục tiêu theo giờ.");
}

function openGoalEditor(goal = null) {
    goalEditorOpen = true;
    editingGoalId = goal?.id || null;
    refreshCalendarPage();

    const title = document.querySelector("#restart-goal-title");
    const metric = document.querySelector("#restart-goal-metric");
    const period = document.querySelector("#restart-goal-period");
    const subject = document.querySelector("#restart-goal-subject");
    const target = document.querySelector("#restart-goal-target");

    if (title) title.value = goal?.title || "";
    if (metric) metric.value = goal?.metric || "study_hours";
    if (period) period.value = goal?.period || "weekly";
    if (subject) subject.value = goal?.subject || SUBJECTS[0];
    if (target) target.value = goal ? String(goal.targetValue) : "5";

    setGoalSubjectVisibility();
    document.querySelector("#restart-goal-title")?.focus();
    document.querySelector("#restart-goal-form")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

export function bindCalendarPage() {
    const previousButton = document.querySelector("#restart-calendar-prev");
    const nextButton = document.querySelector("#restart-calendar-next");
    const todayButton = document.querySelector("#restart-calendar-today");
    const grid = document.querySelector("#restart-calendar-grid");
    const addGoalButton = document.querySelector("#restart-goal-add");
    const goalList = document.querySelector(".restart-goal-list");
    const form = document.querySelector("#restart-goal-form");
    const metricSelect = document.querySelector("#restart-goal-metric");
    const cancelButton = document.querySelector("#restart-goal-cancel");

    previousButton?.addEventListener("click", () => {
        calendarMonth = new Date(
            calendarMonth.getFullYear(),
            calendarMonth.getMonth() - 1,
            1,
            12
        );
        const dayNumber = parseDateKey(selectedDate).getDate();
        const maxDay = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 0).getDate();
        selectedDate = getDateKey(new Date(
            calendarMonth.getFullYear(),
            calendarMonth.getMonth(),
            Math.min(dayNumber, maxDay),
            12
        ));
        refreshCalendarPage();
    });

    nextButton?.addEventListener("click", () => {
        calendarMonth = new Date(
            calendarMonth.getFullYear(),
            calendarMonth.getMonth() + 1,
            1,
            12
        );
        const dayNumber = parseDateKey(selectedDate).getDate();
        const maxDay = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 0).getDate();
        selectedDate = getDateKey(new Date(
            calendarMonth.getFullYear(),
            calendarMonth.getMonth(),
            Math.min(dayNumber, maxDay),
            12
        ));
        refreshCalendarPage();
    });

    todayButton?.addEventListener("click", () => {
        const today = new Date();
        calendarMonth = new Date(today.getFullYear(), today.getMonth(), 1, 12);
        selectedDate = getDateKey(today);
        refreshCalendarPage();
    });

    grid?.addEventListener("click", event => {
        const button = event.target.closest("[data-calendar-date]");
        if (!button) return;

        selectedDate = button.dataset.calendarDate;
        calendarNotice = "";
        refreshCalendarPage();
    });

    addGoalButton?.addEventListener("click", () => {
        calendarNotice = "";
        openGoalEditor();
    });

    goalList?.addEventListener("click", event => {
        const editButton = event.target.closest("[data-edit-goal]");
        const deleteButton = event.target.closest("[data-delete-goal]");

        if (editButton) {
            const goal = getGoals().find(item => item.id === editButton.dataset.editGoal);
            if (goal) openGoalEditor(goal);
            return;
        }

        if (deleteButton) {
            const goalId = deleteButton.dataset.deleteGoal;
            const confirmed = window.confirm(tx(
                "Delete this goal? Its saved Study and Sleep records will not be deleted.",
                "Xóa mục tiêu này? Dữ liệu học tập và giấc ngủ đã lưu sẽ không bị xóa."
            ));

            if (!confirmed) return;

            try {
                deleteGoal(goalId);
                calendarNotice = tx("Goal deleted.", "Đã xóa mục tiêu.");
                calendarNoticeIsError = false;
                goalEditorOpen = false;
                editingGoalId = null;
                refreshCalendarPage();
            } catch (error) {
                calendarNotice = error.message || tx("Could not delete this goal.", "Không thể xóa mục tiêu này.");
                calendarNoticeIsError = true;
                refreshCalendarPage();
            }
        }
    });

    metricSelect?.addEventListener("change", setGoalSubjectVisibility);

    cancelButton?.addEventListener("click", () => {
        goalEditorOpen = false;
        editingGoalId = null;
        refreshCalendarPage();
    });

    form?.addEventListener("submit", event => {
        event.preventDefault();

        const title = document.querySelector("#restart-goal-title")?.value || "";
        const metric = document.querySelector("#restart-goal-metric")?.value || "study_hours";
        const period = document.querySelector("#restart-goal-period")?.value || "weekly";
        const subject = document.querySelector("#restart-goal-subject")?.value || "";
        const targetValue = Number(document.querySelector("#restart-goal-target")?.value);

        try {
            saveGoal({
                id: editingGoalId || undefined,
                title,
                metric,
                period,
                subject,
                targetValue
            });

            calendarNotice = editingGoalId
                ? tx("Goal updated.", "Đã cập nhật mục tiêu.")
                : tx("Goal created.", "Đã tạo mục tiêu.");
            calendarNoticeIsError = false;
            goalEditorOpen = false;
            editingGoalId = null;
            refreshCalendarPage();
        } catch (error) {
            const message = error?.message || tx("Could not save this goal.", "Không thể lưu mục tiêu này.");
            const status = document.querySelector(".restart-notice");

            if (status) {
                status.textContent = message;
                status.classList.add("error");
            } else {
                calendarNotice = message;
                calendarNoticeIsError = true;
                refreshCalendarPage();
            }
        }
    });

    if (goalEditorOpen) setGoalSubjectVisibility();
}
