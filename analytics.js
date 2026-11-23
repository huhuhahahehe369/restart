
import {
    getStudyHistory,
    getSleepRecords,
    getSettings
} from "../js/storage.js";

const ACTIVE_STUDY_KEY = "restart-m02-timer";
const ACTIVE_SLEEP_KEY = "restart-m04-active-sleep";

let selectedRange = "7d";

// ==========================================
// LANGUAGE
// ==========================================

function getLanguage() {
    const language = getSettings().language;
    return ["en", "vi", "bi"].includes(language) ? language : "en";
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
// DATE & FORMATTING
// ==========================================

function getDateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function parseDateKey(key) {
    const [year, month, day] = key.split("-").map(Number);
    return new Date(year, month - 1, day, 12, 0, 0, 0);
}

function formatDuration(seconds) {
    const safe = Math.max(0, Math.floor(Number(seconds) || 0));
    const hours = Math.floor(safe / 3600);
    const minutes = Math.floor((safe % 3600) / 60);
    const remainingSeconds = safe % 60;

    if (getLanguage() === "vi") {
        if (hours > 0) return `${hours} giờ ${minutes} phút`;
        if (minutes > 0) return `${minutes} phút ${remainingSeconds} giây`;
        return `${remainingSeconds} giây`;
    }

    const english = hours > 0
        ? `${hours}h ${minutes}m`
        : minutes > 0
            ? `${minutes}m ${remainingSeconds}s`
            : `${remainingSeconds}s`;

    if (getLanguage() === "bi") {
        const vietnamese = hours > 0
            ? `${hours} giờ ${minutes} phút`
            : minutes > 0
                ? `${minutes} phút ${remainingSeconds} giây`
                : `${remainingSeconds} giây`;

        return `${english} · ${vietnamese}`;
    }

    return english;
}

function formatDate(key, options = {}) {
    return parseDateKey(key).toLocaleDateString(getLocale(), {
        day: "numeric",
        month: "short",
        year: options.year ? "numeric" : undefined,
        weekday: options.weekday ? "short" : undefined
    });
}

function formatMonth(key) {
    return parseDateKey(key).toLocaleDateString(getLocale(), {
        month: "short",
        year: "2-digit"
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

function safeDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

// ==========================================
// ACTIVE TIMER PREVIEWS
// ==========================================

function getActiveStudyPreview() {
    try {
        const raw = localStorage.getItem(ACTIVE_STUDY_KEY);

        if (!raw) return null;

        const state = JSON.parse(raw);

        if (
            !state ||
            !state.date ||
            !["focus", "break"].includes(state.phase)
        ) {
            return null;
        }

        const accumulatedMs = Math.max(
            0,
            Number(state.accumulatedMs) || 0
        );

        const remainingMs = Math.max(
            0,
            Number(state.remainingMs) || 0
        );

        const runningMs = state.startedAt
            ? Math.min(
                Math.max(0, Date.now() - Number(state.startedAt)),
                remainingMs
            )
            : 0;

        const seconds = Math.floor(
            (accumulatedMs + runningMs) / 1000
        );

        if (seconds <= 0) return null;

        return {
            date: state.date,
            phase: state.phase,
            subject: typeof state.subject === "string"
                ? state.subject
                : "",
            seconds
        };

    } catch (error) {
        console.warn(
            "Could not read active study timer for analytics:",
            error
        );

        return null;
    }
}

function getActiveSleepPreview() {
    try {
        const raw = localStorage.getItem(ACTIVE_SLEEP_KEY);

        if (!raw) return null;

        const session = JSON.parse(raw);
        const bedtime = safeDate(session?.bedtime);

        if (!session || !bedtime) return null;

        return {
            id: session.id,
            type: session.type === "nap" ? "nap" : "main",
            bedtime: bedtime.toISOString(),
            wakeTime: new Date().toISOString()
        };

    } catch (error) {
        console.warn(
            "Could not read active sleep timer for analytics:",
            error
        );

        return null;
    }
}

// ==========================================
// RANGE & DAILY AGGREGATION
// ==========================================

function getEarliestDateKey(studyHistory, sleepRecords) {
    const keys = studyHistory
        .map(day => day.date)
        .filter(Boolean);

    for (const record of sleepRecords) {
        const bedtime = safeDate(record.bedtime);

        if (bedtime) {
            keys.push(getDateKey(bedtime));
        }
    }

    const today = getDateKey(new Date());

    if (keys.length === 0) {
        return today;
    }

    return keys.sort()[0];
}

function getRangeDateKeys(range, studyHistory, sleepRecords) {
    const today = new Date();

    today.setHours(0, 0, 0, 0);

    const start = new Date(today);

    if (range === "7d") {
        start.setDate(start.getDate() - 6);

    } else if (range === "30d") {
        start.setDate(start.getDate() - 29);

    } else {
        const earliestKey = getEarliestDateKey(
            studyHistory,
            sleepRecords
        );

        const earliest = parseDateKey(earliestKey);

        start.setTime(earliest.getTime());
        start.setHours(0, 0, 0, 0);
    }

    const keys = [];
    const cursor = new Date(start);

    while (cursor <= today) {
        keys.push(getDateKey(cursor));
        cursor.setDate(cursor.getDate() + 1);
    }

    return keys;
}

// ==========================================
// SLEEP TIME SPLITTING
// ==========================================

function getSleepOverlapSeconds(dateKey, records, activeSleep) {
    const [year, month, day] = dateKey.split("-").map(Number);

    const dayStart = new Date(
        year,
        month - 1,
        day,
        0, 0, 0, 0
    ).getTime();

    const dayEnd = new Date(
        year,
        month - 1,
        day + 1,
        0, 0, 0, 0
    ).getTime();

    let mainMilliseconds = 0;
    let napMilliseconds = 0;

    function addInterval(startValue, endValue, type) {
        const start = new Date(startValue).getTime();
        const end = new Date(endValue).getTime();

        if (
            !Number.isFinite(start) ||
            !Number.isFinite(end) ||
            end <= start
        ) {
            return;
        }

        const overlapStart = Math.max(start, dayStart);
        const overlapEnd = Math.min(end, dayEnd);

        if (overlapEnd <= overlapStart) return;

        if (type === "nap") {
            napMilliseconds += overlapEnd - overlapStart;
        } else {
            mainMilliseconds += overlapEnd - overlapStart;
        }
    }

    for (const record of records) {
        addInterval(
            record.bedtime,
            record.wakeTime,
            record.type === "nap" ? "nap" : "main"
        );
    }

    if (activeSleep) {
        addInterval(
            activeSleep.bedtime,
            activeSleep.wakeTime,
            activeSleep.type
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

// ==========================================
// BUILD ANALYTICS DATA
// ==========================================

function buildAnalyticsData(range) {
    const studyHistory = getStudyHistory();
    const sleepRecords = getSleepRecords();

    const activeStudy = getActiveStudyPreview();
    const activeSleep = getActiveSleepPreview();

    const dateKeys = getRangeDateKeys(
        range,
        studyHistory,
        sleepRecords
    );

    const studyByDate = new Map(
        studyHistory.map(day => [day.date, day])
    );

    const rows = dateKeys.map(date => {
        const day = studyByDate.get(date) || {};

        const subjects = {
            ...(day.studySeconds || {})
        };

        let studySeconds = Object.values(subjects)
            .reduce(
                (total, seconds) =>
                    total + Math.max(0, Number(seconds) || 0),
                0
            );

        let breakSeconds = Math.max(
            0,
            Number(day.breakSeconds) || 0
        );

        const focusSessions = Math.max(
            0,
            Number(day.completedSessions) || 0
        );

        // Include active Pomodoro time without double-counting
        // the time already committed to Storage Core.
        if (activeStudy && activeStudy.date === date) {
            if (
                activeStudy.phase === "focus" &&
                activeStudy.subject
            ) {
                subjects[activeStudy.subject] =
                    (subjects[activeStudy.subject] || 0) +
                    activeStudy.seconds;

                studySeconds += activeStudy.seconds;

            } else if (activeStudy.phase === "break") {
                breakSeconds += activeStudy.seconds;
            }
        }

        const sleep = getSleepOverlapSeconds(
            date,
            sleepRecords,
            activeSleep
        );

        return {
            date,
            studySeconds,
            breakSeconds,
            focusSessions,
            subjects,
            mainSleepSeconds: sleep.mainSeconds,
            napSeconds: sleep.napSeconds,
            sleepSeconds: sleep.totalSeconds
        };
    });

    // --------------------------------------
    // TOTALS
    // --------------------------------------

    const subjectTotals = {};

    let totalStudySeconds = 0;
    let totalBreakSeconds = 0;
    let totalSleepSeconds = 0;
    let totalMainSleepSeconds = 0;
    let totalNapSeconds = 0;
    let completedFocusSessions = 0;

    for (const row of rows) {
        totalStudySeconds += row.studySeconds;
        totalBreakSeconds += row.breakSeconds;
        totalSleepSeconds += row.sleepSeconds;
        totalMainSleepSeconds += row.mainSleepSeconds;
        totalNapSeconds += row.napSeconds;
        completedFocusSessions += row.focusSessions;

        for (const [subject, seconds] of Object.entries(row.subjects)) {
            subjectTotals[subject] =
                (subjectTotals[subject] || 0) + seconds;
        }
    }

    const subjects = Object.entries(subjectTotals)
        .sort((a, b) => b[1] - a[1]);

    const studyDays = rows.filter(
        row => row.studySeconds > 0
    ).length;

    const sleepDays = rows.filter(
        row => row.sleepSeconds > 0
    ).length;

    const bestStudyDay = rows
        .filter(row => row.studySeconds > 0)
        .reduce(
            (best, row) =>
                !best || row.studySeconds > best.studySeconds
                    ? row
                    : best,
            null
        );

    const bestSleepDay = rows
        .filter(row => row.sleepSeconds > 0)
        .reduce(
            (best, row) =>
                !best || row.sleepSeconds > best.sleepSeconds
                    ? row
                    : best,
            null
        );

    const activeStudyDayAverage = studyDays > 0
        ? Math.round(totalStudySeconds / studyDays)
        : 0;

    // Count completed records that overlap the selected period.
    const sessionsInRange = sleepRecords.filter(record => {
        const bedtime = safeDate(record.bedtime);
        const wakeTime = safeDate(record.wakeTime);

        if (!bedtime || !wakeTime || dateKeys.length === 0) {
            return false;
        }

        const rangeStart = parseDateKey(
            dateKeys[0]
        ).getTime();

        const lastDate = parseDateKey(
            dateKeys[dateKeys.length - 1]
        );

        const rangeEnd = new Date(
            lastDate.getFullYear(),
            lastDate.getMonth(),
            lastDate.getDate() + 1
        ).getTime();

        return (
            wakeTime.getTime() > rangeStart &&
            bedtime.getTime() < rangeEnd
        );
    });

    return {
        range,
        rows,
        subjects,

        metrics: {
            totalStudySeconds,
            totalBreakSeconds,
            totalSleepSeconds,
            totalMainSleepSeconds,
            totalNapSeconds,
            completedFocusSessions,
            sleepSessions: sessionsInRange.length,
            studyDays,
            sleepDays,
            activeStudyDayAverage
        },

        bestStudyDay,
        bestSleepDay,
        topSubject: subjects[0] || null
    };
}

// ==========================================
// CHART BUCKETS
// ==========================================

function getChartBuckets(rows, range) {
    // 7-day and 30-day views use daily columns.
    if (range !== "all" || rows.length <= 45) {
        return rows.map(row => ({
            label: range === "7d"
                ? parseDateKey(row.date).toLocaleDateString(
                    getLocale(),
                    { weekday: "short" }
                )
                : String(parseDateKey(row.date).getDate()),

            date: row.date,
            studySeconds: row.studySeconds,
            sleepSeconds: row.sleepSeconds,
            mainSleepSeconds: row.mainSleepSeconds,
            napSeconds: row.napSeconds
        }));
    }

    // All-time view groups data by month when history is long.
    const monthly = new Map();

    for (const row of rows) {
        const date = parseDateKey(row.date);

        const key =
            `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

        if (!monthly.has(key)) {
            monthly.set(key, {
                label: formatMonth(`${key}-01`),
                date: key,
                studySeconds: 0,
                sleepSeconds: 0,
                mainSleepSeconds: 0,
                napSeconds: 0
            });
        }

        const bucket = monthly.get(key);

        bucket.studySeconds += row.studySeconds;
        bucket.sleepSeconds += row.sleepSeconds;
        bucket.mainSleepSeconds += row.mainSleepSeconds;
        bucket.napSeconds += row.napSeconds;
    }

    return [...monthly.values()];
}

// ==========================================
// CHART RENDERING
// ==========================================

function renderBarChart(
    rows,
    key,
    title,
    description,
    color
) {
    const maximum = Math.max(
        1,
        ...rows.map(row => Number(row[key]) || 0)
    );

    const columns = rows.map((row, index) => {
        const value = Number(row[key]) || 0;

        const percentage = value > 0
            ? Math.max(2, (value / maximum) * 100)
            : 0;

        const label =
            rows.length > 14 &&
            index % 5 !== 0 &&
            index !== rows.length - 1
                ? ""
                : row.label;

        return `
            <div
                title="${escapeHTML(row.label)}: ${escapeHTML(formatDuration(value))}"
                style="
                    min-width:0;
                    display:flex;
                    flex-direction:column;
                    align-items:center;
                    justify-content:flex-end;
                    gap:7px;
                "
            >
                <span style="
                    font-size:10px;
                    color:var(--text-secondary);
                    white-space:nowrap;
                    min-height:12px;
                ">
                    ${label ? escapeHTML(label) : ""}
                </span>

                <div style="
                    width:100%;
                    height:142px;
                    display:flex;
                    align-items:flex-end;
                    justify-content:center;
                    background:var(--bg-hover);
                    border-radius:7px 7px 3px 3px;
                    overflow:hidden;
                ">
                    <div style="
                        width:72%;
                        height:${percentage}%;
                        min-height:${value > 0 ? "3px" : "0"};
                        background:${color};
                        border-radius:6px 6px 0 0;
                        transition:height 0.25s ease;
                    "></div>
                </div>
            </div>
        `;
    }).join("");

    return `
        <section class="card" style="min-width:0">

            <div class="card-title">
                ${escapeHTML(title)}
            </div>

            <p class="empty-note" style="margin-top:6px">
                ${escapeHTML(description)}
            </p>

            <div style="
                overflow-x:auto;
                margin-top:18px;
                padding-bottom:5px;
            ">
                <div style="
                    min-width:${Math.max(100, rows.length * 25)}px;
                    display:grid;
                    grid-template-columns:repeat(${Math.max(1, rows.length)},minmax(0,1fr));
                    gap:6px;
                    align-items:end;
                ">
                    ${columns || `
                        <p class="empty-note">
                            ${escapeHTML(tx(
                                "No data available yet.",
                                "Chưa có dữ liệu."
                            ))}
                        </p>
                    `}
                </div>
            </div>

        </section>
    `;
}

// ==========================================
// SUBJECT BREAKDOWN
// ==========================================

function renderSubjectBreakdown(subjects) {
    if (subjects.length === 0) {
        return `
            <div class="empty-note">
                ${escapeHTML(tx(
                    "No study data recorded in this period.",
                    "Chưa có dữ liệu học tập trong khoảng thời gian này."
                ))}
            </div>
        `;
    }

    const maximum = subjects[0][1];

    const total = subjects.reduce(
        (sum, item) => sum + item[1],
        0
    );

    return subjects.map(([subject, seconds]) => {
        const percentage = total > 0
            ? (seconds / total) * 100
            : 0;

        const width = maximum > 0
            ? (seconds / maximum) * 100
            : 0;

        return `
            <div style="margin-top:17px">

                <div style="
                    display:flex;
                    justify-content:space-between;
                    align-items:center;
                    gap:12px;
                    margin-bottom:8px;
                ">
                    <strong>${escapeHTML(subject)}</strong>

                    <span style="
                        color:var(--accent);
                        font-weight:650;
                        white-space:nowrap;
                    ">
                        ${escapeHTML(formatDuration(seconds))}
                    </span>
                </div>

                <div style="
                    width:100%;
                    height:8px;
                    background:var(--bg-hover);
                    border-radius:20px;
                    overflow:hidden;
                ">
                    <div style="
                        width:${width}%;
                        height:100%;
                        background:var(--accent);
                        border-radius:20px;
                    "></div>
                </div>

                <p class="empty-note" style="margin-top:5px;font-size:12px">
                    ${percentage.toFixed(1)}%
                    ${escapeHTML(tx("of study time", "thời gian học"))}
                </p>

            </div>
        `;
    }).join("");
}

// ==========================================
// DAILY STUDY & SLEEP COMPARISON
// ==========================================

function renderDailyComparison(rows) {
    const visibleRows = rows
        .filter(row =>
            row.studySeconds > 0 ||
            row.sleepSeconds > 0
        )
        .slice(-14)
        .reverse();

    if (visibleRows.length === 0) {
        return `
            <p class="empty-note">
                ${escapeHTML(tx(
                    "No study or sleep activity recorded in this period.",
                    "Chưa có hoạt động học tập hoặc giấc ngủ trong khoảng thời gian này."
                ))}
            </p>
        `;
    }

    return visibleRows.map(row => `
        <div style="
            display:grid;
            grid-template-columns:minmax(78px,1fr) minmax(0,2fr) minmax(0,2fr);
            gap:10px;
            align-items:center;
            padding:12px 0;
            border-bottom:1px solid var(--border);
        ">

            <strong style="font-size:12px">
                ${escapeHTML(formatDate(
                    row.date,
                    { weekday: true }
                ))}
            </strong>

            <div style="min-width:0">
                <div class="empty-note" style="
                    font-size:11px;
                    margin-bottom:5px;
                ">
                    ${escapeHTML(tx("Study", "Học tập"))}
                </div>

                <strong style="
                    font-size:12px;
                    color:var(--accent);
                ">
                    ${escapeHTML(formatDuration(row.studySeconds))}
                </strong>
            </div>

            <div style="min-width:0">
                <div class="empty-note" style="
                    font-size:11px;
                    margin-bottom:5px;
                ">
                    ${escapeHTML(tx("Sleep", "Giấc ngủ"))}
                </div>

                <strong style="font-size:12px">
                    ${escapeHTML(formatDuration(row.sleepSeconds))}
                </strong>
            </div>

        </div>
    `).join("");
}

// ==========================================
// HIGHLIGHTS
// ==========================================

function renderHighlight(title, value, description) {
    return `
        <div class="card">

            <div class="card-title">
                ${escapeHTML(title)}
            </div>

            <div class="stat-value" style="
                font-size:clamp(20px,3vw,26px);
                margin-top:10px;
                color:var(--accent);
            ">
                ${escapeHTML(value)}
            </div>

            <p class="stat-description" style="margin-top:7px">
                ${escapeHTML(description)}
            </p>

        </div>
    `;
}

function renderInsights(data) {
    const bestStudy = data.bestStudyDay
        ? formatDuration(data.bestStudyDay.studySeconds)
        : "--";

    const bestStudyDescription = data.bestStudyDay
        ? formatDate(data.bestStudyDay.date, { year: true })
        : tx("No study data yet", "Chưa có dữ liệu học tập");

    const bestSleep = data.bestSleepDay
        ? formatDuration(data.bestSleepDay.sleepSeconds)
        : "--";

    const bestSleepDescription = data.bestSleepDay
        ? formatDate(data.bestSleepDay.date, { year: true })
        : tx("No sleep data yet", "Chưa có dữ liệu giấc ngủ");

    const topSubject = data.topSubject
        ? data.topSubject[0]
        : "--";

    const topSubjectDescription = data.topSubject
        ? formatDuration(data.topSubject[1])
        : tx("No subject data yet", "Chưa có dữ liệu môn học");

    return `
        <section style="margin-top:26px">

            <div class="page-heading">
                <h2>
                    ${escapeHTML(tx("Highlights", "Điểm nổi bật"))}
                </h2>

                <p>
                    ${escapeHTML(tx(
                        "A quick look at the most notable activity in this period.",
                        "Tổng quan nhanh về những dữ liệu nổi bật trong khoảng thời gian này."
                    ))}
                </p>
            </div>

            <div class="stats-grid" style="margin-top:14px">

                ${renderHighlight(
                    tx("Longest Study Day", "Ngày học nhiều nhất"),
                    bestStudy,
                    bestStudyDescription
                )}

                ${renderHighlight(
                    tx("Longest Sleep Day", "Ngày ngủ nhiều nhất"),
                    bestSleep,
                    bestSleepDescription
                )}

                ${renderHighlight(
                    tx("Top Subject", "Môn học nhiều nhất"),
                    topSubject,
                    topSubjectDescription
                )}

            </div>

        </section>
    `;
}

// ==========================================
// DASHBOARD RENDERING
// ==========================================

export function renderAnalyticsPage(range = selectedRange) {
    selectedRange = ["7d", "30d", "all"].includes(range)
        ? range
        : "7d";

    const data = buildAnalyticsData(selectedRange);
    const buckets = getChartBuckets(data.rows, selectedRange);
    const metrics = data.metrics;

    const rangeLabels = {
        "7d": tx("Last 7 days", "7 ngày qua"),
        "30d": tx("Last 30 days", "30 ngày qua"),
        "all": tx("All time", "Toàn bộ thời gian")
    };

    const dailyChartDescription =
        selectedRange === "all" && data.rows.length > 45
            ? tx(
                "Monthly totals across your recorded history.",
                "Tổng theo tháng trong toàn bộ lịch sử đã ghi nhận."
            )
            : tx(
                "Daily totals in the selected period.",
                "Tổng thời gian từng ngày trong khoảng đã chọn."
            );

    return `
        <section class="page-heading">

            <h1>
                ${escapeHTML(tx(
                    "Analytics Dashboard",
                    "Bảng phân tích dữ liệu"
                ))}
            </h1>

            <p>
                ${escapeHTML(tx(
                    "Turn your study and sleep records into a clearer picture of your progress.",
                    "Biến dữ liệu học tập và giấc ngủ thành bức tranh rõ ràng hơn về tiến trình của Cún."
                ))}
            </p>

        </section>

        <!-- RANGE FILTER -->

        <section class="card" style="margin-top:20px">

            <div style="
                display:flex;
                justify-content:space-between;
                align-items:center;
                gap:14px;
                flex-wrap:wrap;
            ">

                <div>
                    <div class="card-title">
                        ${escapeHTML(tx("REPORT PERIOD", "KHOẢNG THỜI GIAN"))}
                    </div>

                    <p class="empty-note" style="margin-top:5px">
                        ${escapeHTML(tx(
                            "Choose the period you want to analyze.",
                            "Chọn khoảng thời gian Cún muốn phân tích."
                        ))}
                    </p>
                </div>

                <select
                    class="subject-select"
                    id="analytics-range"
                    style="width:auto;min-width:160px"
                >
                    <option
                        value="7d"
                        ${selectedRange === "7d" ? "selected" : ""}
                    >
                        ${escapeHTML(rangeLabels["7d"])}
                    </option>

                    <option
                        value="30d"
                        ${selectedRange === "30d" ? "selected" : ""}
                    >
                        ${escapeHTML(rangeLabels["30d"])}
                    </option>

                    <option
                        value="all"
                        ${selectedRange === "all" ? "selected" : ""}
                    >
                        ${escapeHTML(rangeLabels.all)}
                    </option>
                </select>

            </div>

        </section>

        <!-- OVERVIEW -->

        <section style="margin-top:22px">

            <div class="page-heading">
                <h2>${escapeHTML(tx("Overview", "Tổng quan"))}</h2>
                <p>${escapeHTML(rangeLabels[selectedRange])}</p>
            </div>

            <section class="stats-grid" style="margin-top:14px">

                <div class="card">
                    <div class="card-title">
                        ${escapeHTML(tx("Total Study Time", "Tổng thời gian học"))}
                    </div>

                    <div class="stat-value">
                        ${escapeHTML(formatDuration(metrics.totalStudySeconds))}
                    </div>

                    <div class="stat-description">
                        ${escapeHTML(tx("Across all subjects", "Tất cả các môn học"))}
                    </div>
                </div>

                <div class="card">
                    <div class="card-title">
                        ${escapeHTML(tx("Focus Sessions", "Phiên tập trung"))}
                    </div>

                    <div class="stat-value">
                        ${metrics.completedFocusSessions}
                    </div>

                    <div class="stat-description">
                        ${escapeHTML(tx("Completed study sessions", "Phiên học đã hoàn thành"))}
                    </div>
                </div>

                <div class="card">
                    <div class="card-title">
                        ${escapeHTML(tx("Total Sleep Time", "Tổng thời gian ngủ"))}
                    </div>

                    <div class="stat-value">
                        ${escapeHTML(formatDuration(metrics.totalSleepSeconds))}
                    </div>

                    <div class="stat-description">
                        ${escapeHTML(tx("Main Sleep + Naps", "Giấc ngủ chính + Giấc ngủ ngắn"))}
                    </div>
                </div>

                <div class="card">
                    <div class="card-title">
                        ${escapeHTML(tx("Recorded Sleep Sessions", "Phiên ngủ đã ghi nhận"))}
                    </div>

                    <div class="stat-value">
                        ${metrics.sleepSessions}
                    </div>

                    <div class="stat-description">
                        ${escapeHTML(tx("Completed sleep records", "Bản ghi giấc ngủ đã hoàn thành"))}
                    </div>
                </div>

            </section>

        </section>

        <!-- STUDY CHART -->

        <section style="margin-top:24px">

            <div class="page-heading">
                <h2>
                    ${escapeHTML(tx("Study Analytics", "Phân tích học tập"))}
                </h2>

                <p>
                    ${escapeHTML(tx(
                        "See how study time changes over time.",
                        "Theo dõi sự thay đổi thời gian học theo ngày."
                    ))}
                </p>
            </div>

            <div style="margin-top:14px">
                ${renderBarChart(
                    buckets,
                    "studySeconds",
                    tx("Study Time", "Thời gian học"),
                    dailyChartDescription,
                    "var(--accent)"
                )}
            </div>

        </section>

        <!-- SUBJECT BREAKDOWN -->

        <section class="card" style="margin-top:20px">

            <div class="card-title">
                ${escapeHTML(tx("SUBJECT BREAKDOWN", "PHÂN BỔ THEO MÔN HỌC"))}
            </div>

            <h2 style="margin-top:8px">
                ${escapeHTML(tx("Study Time by Subject", "Thời gian học theo môn"))}
            </h2>

            <div style="margin-top:8px">
                ${renderSubjectBreakdown(data.subjects)}
            </div>

        </section>

        <!-- SLEEP CHARTS -->

        <section style="margin-top:24px">

            <div class="page-heading">
                <h2>
                    ${escapeHTML(tx("Sleep Analytics", "Phân tích giấc ngủ"))}
                </h2>

                <p>
                    ${escapeHTML(tx(
                        "View total sleep, Main Sleep and Naps over time.",
                        "Theo dõi tổng thời gian ngủ, giấc ngủ chính và giấc ngủ ngắn."
                    ))}
                </p>
            </div>

            <div style="
                display:grid;
                grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr));
                gap:16px;
                margin-top:14px;
            ">

                ${renderBarChart(
                    buckets,
                    "sleepSeconds",
                    tx("Total Sleep", "Tổng thời gian ngủ"),
                    dailyChartDescription,
                    "var(--text-secondary)"
                )}

                ${renderBarChart(
                    buckets,
                    "mainSleepSeconds",
                    tx("Main Sleep", "Giấc ngủ chính"),
                    tx("Main sleep only.", "Chỉ tính giấc ngủ chính."),
                    "var(--accent)"
                )}

                ${renderBarChart(
                    buckets,
                    "napSeconds",
                    tx("Naps", "Giấc ngủ ngắn"),
                    tx("Nap time only.", "Chỉ tính giấc ngủ ngắn."),
                    "var(--text-secondary)"
                )}

            </div>

            <div class="stats-grid" style="margin-top:16px">

                <div class="card">
                    <div class="card-title">
                        ${escapeHTML(tx("Main Sleep", "Giấc ngủ chính"))}
                    </div>

                    <div class="stat-value">
                        ${escapeHTML(formatDuration(metrics.totalMainSleepSeconds))}
                    </div>
                </div>

                <div class="card">
                    <div class="card-title">
                        ${escapeHTML(tx("Naps", "Giấc ngủ ngắn"))}
                    </div>

                    <div class="stat-value">
                        ${escapeHTML(formatDuration(metrics.totalNapSeconds))}
                    </div>
                </div>

            </div>

        </section>

        <!-- STUDY VS SLEEP -->

        <section class="card" style="margin-top:24px">

            <div class="card-title">
                ${escapeHTML(tx("STUDY & SLEEP", "HỌC TẬP & GIẤC NGỦ"))}
            </div>

            <h2 style="margin-top:8px">
                ${escapeHTML(tx("Daily Comparison", "Đối chiếu theo ngày"))}
            </h2>

            <p class="empty-note" style="
                margin-top:6px;
                line-height:1.6;
            ">
                ${escapeHTML(tx(
                    "Compare recorded study and sleep time side by side. This is a view of your data, not a measure of cause and effect.",
                    "Đặt thời gian học và ngủ cạnh nhau để quan sát. Đây là cách xem dữ liệu, không phải kết luận về quan hệ nhân quả."
                ))}
            </p>

            <div style="margin-top:10px">
                ${renderDailyComparison(data.rows)}
            </div>

        </section>

        <!-- HIGHLIGHTS -->

        ${renderInsights(data)}

        <!-- PERIOD DETAILS -->

        <section class="card" style="margin-top:24px">

            <div class="card-title">
                ${escapeHTML(tx("DATA SUMMARY", "TÓM TẮT DỮ LIỆU"))}
            </div>

            <h2 style="margin-top:8px">
                ${escapeHTML(tx(
                    "Your activity in this period",
                    "Hoạt động trong khoảng thời gian này"
                ))}
            </h2>

            <div style="
                display:grid;
                grid-template-columns:repeat(auto-fit,minmax(150px,1fr));
                gap:14px;
                margin-top:16px;
            ">

                <div>
                    <div class="card-title">
                        ${escapeHTML(tx("Days with study", "Ngày có học tập"))}
                    </div>

                    <div class="stat-value">
                        ${metrics.studyDays}
                    </div>
                </div>

                <div>
                    <div class="card-title">
                        ${escapeHTML(tx("Days with sleep", "Ngày có giấc ngủ"))}
                    </div>

                    <div class="stat-value">
                        ${metrics.sleepDays}
                    </div>
                </div>

                <div>
                    <div class="card-title">
                        ${escapeHTML(tx("Break Time", "Thời gian nghỉ"))}
                    </div>

                    <div class="stat-value" style="font-size:21px">
                        ${escapeHTML(formatDuration(metrics.totalBreakSeconds))}
                    </div>
                </div>

                <div>
                    <div class="card-title">
                        ${escapeHTML(tx(
                            "Avg. Study on Active Days",
                            "Học trung bình mỗi ngày có học"
                        ))}
                    </div>

                    <div class="stat-value" style="font-size:21px">
                        ${escapeHTML(formatDuration(metrics.activeStudyDayAverage))}
                    </div>
                </div>

            </div>

            <p class="empty-note" style="
                margin-top:16px;
                line-height:1.6;
            ">
                ${escapeHTML(tx(
                    "Only recorded data is included. Days without records are not treated as zero-sleep or zero-study insights.",
                    "Chỉ dữ liệu đã ghi nhận mới được tính. Ngày chưa có bản ghi không bị xem là ngày không học hoặc không ngủ."
                ))}
            </p>

        </section>

        <div style="
            display:flex;
            justify-content:flex-end;
            margin-top:18px;
        ">
            <button
                class="secondary-button"
                id="analytics-refresh"
            >
                ${escapeHTML(tx("Refresh Analytics", "Làm mới phân tích"))}
            </button>
        </div>
    `;
}

// ==========================================
// BIND EVENTS
// ==========================================

export function bindAnalyticsPage() {
    const rangeSelect = document.querySelector("#analytics-range");
    const refreshButton = document.querySelector("#analytics-refresh");
    const pageContent = document.querySelector(".page-content");

    function refreshPage() {
        if (!pageContent) return;

        pageContent.innerHTML = renderAnalyticsPage(selectedRange);

        bindAnalyticsPage();
    }

    rangeSelect?.addEventListener("change", () => {
        selectedRange = rangeSelect.value;
        refreshPage();
    });

    refreshButton?.addEventListener("click", refreshPage);
}
