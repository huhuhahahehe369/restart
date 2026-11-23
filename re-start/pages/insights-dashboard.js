// ==========================================
// RE:START M08.4 - AI INSIGHTS
// Private, on-device, rule-based analysis.
// No network requests. No data is uploaded.
// Reads existing M02, M04, M08 and Goals data.
// This module does not modify the database.
// ==========================================

const DATABASE_KEY = "restart-data-v1";
const JOURNAL_RECORD_TYPE = "memory";
const ACADEMIC_RECORD_TYPE = "academic_task";
const SECONDARY_SUBJECT_TYPE = "study_subject";

let selectedRange = 7;

const MOOD_LABELS = {
    bright: { en: "Great", vi: "Rất tốt", score: 5 },
    good: { en: "Good", vi: "Tốt", score: 4 },
    neutral: { en: "Okay", vi: "Bình thường", score: 3 },
    stressed: { en: "Stressed", vi: "Căng thẳng", score: 2 },
    tired: { en: "Tired", vi: "Mệt mỏi", score: 1 }
};

// ==========================================
// LANGUAGE & BASIC HELPERS
// ==========================================

function getLanguage() {
    try {
        const raw = localStorage.getItem(DATABASE_KEY);
        const database = raw ? JSON.parse(raw) : null;
        const language = database?.settings?.language;
        return ["en", "vi", "bi"].includes(language) ? language : "en";
    } catch (error) {
        console.warn("Could not read RE:START language:", error);
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

function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[character]);
}

function safeNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function getDateKey(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function parseDateKey(key) {
    const [year, month, day] = String(key).split("-").map(Number);
    return new Date(year, month - 1, day, 12, 0, 0, 0);
}

function shiftDateKey(key, amount) {
    const date = parseDateKey(key);
    date.setDate(date.getDate() + amount);
    return getDateKey(date);
}

function formatDate(key, options = {}) {
    if (!key) return tx("Not available", "Chưa có dữ liệu");
    return parseDateKey(key).toLocaleDateString(getLocale(), {
        day: "numeric",
        month: "short",
        year: options.year ? "numeric" : undefined,
        weekday: options.weekday ? "short" : undefined
    });
}

function formatDuration(seconds) {
    const safe = Math.max(0, Math.floor(safeNumber(seconds)));
    const hours = Math.floor(safe / 3600);
    const minutes = Math.floor((safe % 3600) / 60);

    if (getLanguage() === "vi") {
        if (hours > 0) return `${hours} giờ ${minutes} phút`;
        if (minutes > 0) return `${minutes} phút`;
        return `${safe} giây`;
    }

    const english = hours > 0
        ? `${hours}h ${minutes}m`
        : minutes > 0
            ? `${minutes}m`
            : `${safe}s`;

    if (getLanguage() === "bi") {
        const vietnamese = hours > 0
            ? `${hours} giờ ${minutes} phút`
            : minutes > 0
                ? `${minutes} phút`
                : `${safe} giây`;
        return `${english} · ${vietnamese}`;
    }

    return english;
}

function formatHours(hours) {
    const value = Number(hours) || 0;
    return `${value.toFixed(1)} ${tx("h", "giờ")}`;
}

function formatPercent(value) {
    return `${Math.round(Math.max(0, Math.min(100, value)))}%`;
}

function average(values) {
    return values.length
        ? values.reduce((sum, value) => sum + value, 0) / values.length
        : null;
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

// ==========================================
// DATABASE ACCESS
// ==========================================

function readDatabase() {
    const raw = localStorage.getItem(DATABASE_KEY);

    if (!raw) {
        return {
            study: { days: {} },
            sleep: { records: [], schedule: {} },
            journal: [],
            goals: []
        };
    }

    try {
        const database = JSON.parse(raw);
        if (!database || typeof database !== "object") {
            throw new Error("Invalid database object.");
        }

        return {
            ...database,
            study: database.study && typeof database.study === "object"
                ? database.study
                : { days: {} },
            sleep: database.sleep && typeof database.sleep === "object"
                ? database.sleep
                : { records: [], schedule: {} },
            journal: Array.isArray(database.journal) ? database.journal : [],
            goals: Array.isArray(database.goals) ? database.goals : []
        };
    } catch (error) {
        console.error("Could not read RE:START data for insights:", error);
        throw new Error(tx(
            "Saved data could not be read. No records were changed.",
            "Không thể đọc dữ liệu đã lưu. Không có bản ghi nào bị thay đổi."
        ));
    }
}

// ==========================================
// STUDY AGGREGATION
// ==========================================

function getDayStudyData(day) {
    if (!day || typeof day !== "object") {
        return {
            subjectSeconds: {},
            totalSeconds: 0,
            breakSeconds: 0,
            focusSessions: 0
        };
    }

    const subjectSeconds = {};
    const recordedSeconds = day.studySeconds && typeof day.studySeconds === "object"
        ? day.studySeconds
        : {};

    for (const [subject, rawSeconds] of Object.entries(recordedSeconds)) {
        const name = String(subject || "").trim();
        const seconds = safeNumber(rawSeconds);
        if (!name || seconds <= 0) continue;
        subjectSeconds[name] = (subjectSeconds[name] || 0) + seconds;
    }

    // If a day has session records but no subject summary, derive its
    // subject totals from focus sessions. Avoid double-counting otherwise.
    if (Object.keys(subjectSeconds).length === 0 && Array.isArray(day.sessions)) {
        for (const session of day.sessions) {
            if (session?.type === "break") continue;
            const subject = String(session?.subject || "").trim();
            const seconds = safeNumber(session?.seconds);
            if (!subject || seconds <= 0) continue;
            subjectSeconds[subject] = (subjectSeconds[subject] || 0) + seconds;
        }
    }

    const totalSeconds = Object.values(subjectSeconds)
        .reduce((sum, value) => sum + value, 0);

    let focusSessions = 0;
    if (Array.isArray(day.sessions) && day.sessions.length) {
        focusSessions = day.sessions.filter(session =>
            session && session.type !== "break" && safeNumber(session.seconds) > 0
        ).length;
    } else {
        focusSessions = safeNumber(day.completedSessions);
    }

    return {
        subjectSeconds,
        totalSeconds,
        breakSeconds: safeNumber(day.breakSeconds),
        focusSessions
    };
}

function aggregateStudyPeriod(daysMap, startKey, endKey) {
    const result = {
        totalSeconds: 0,
        breakSeconds: 0,
        focusSessions: 0,
        activeDays: 0,
        subjectSeconds: {},
        daily: []
    };

    let cursor = startKey;
    while (cursor <= endKey) {
        const day = getDayStudyData(daysMap?.[cursor]);
        result.totalSeconds += day.totalSeconds;
        result.breakSeconds += day.breakSeconds;
        result.focusSessions += day.focusSessions;

        if (day.totalSeconds > 0) result.activeDays += 1;

        for (const [subject, seconds] of Object.entries(day.subjectSeconds)) {
            result.subjectSeconds[subject] = (result.subjectSeconds[subject] || 0) + seconds;
        }

        result.daily.push({ date: cursor, ...day });
        cursor = shiftDateKey(cursor, 1);
    }

    return result;
}

function getPeriodBounds(days) {
    const end = getDateKey();
    return {
        start: shiftDateKey(end, -(days - 1)),
        end
    };
}

function getPreviousPeriodBounds(days) {
    const current = getPeriodBounds(days);
    return {
        start: shiftDateKey(current.start, -days),
        end: shiftDateKey(current.start, -1)
    };
}

function getTopSubjects(subjectSeconds) {
    return Object.entries(subjectSeconds || {})
        .filter(([, seconds]) => safeNumber(seconds) > 0)
        .sort((a, b) => b[1] - a[1]);
}

// ==========================================
// SLEEP AGGREGATION
// ==========================================

function getSleepDurationMinutes(record) {
    const stored = Number(record?.durationMinutes);
    if (Number.isFinite(stored) && stored > 0 && stored <= 1440) {
        return stored;
    }

    const bedtime = new Date(record?.bedtime);
    const wakeTime = new Date(record?.wakeTime);
    if (Number.isNaN(bedtime.getTime()) || Number.isNaN(wakeTime.getTime())) return 0;

    const minutes = (wakeTime.getTime() - bedtime.getTime()) / 60000;
    return minutes > 0 && minutes <= 1440 ? minutes : 0;
}

function getRecordDate(record) {
    const date = new Date(record?.wakeTime || record?.bedtime);
    return Number.isNaN(date.getTime()) ? null : getDateKey(date);
}

function aggregateSleep(records, startKey, endKey) {
    const main = [];
    const naps = [];

    for (const record of records) {
        if (!record || typeof record !== "object") continue;
        const date = getRecordDate(record);
        if (!date || date < startKey || date > endKey) continue;

        const minutes = getSleepDurationMinutes(record);
        if (minutes <= 0) continue;

        const normalized = { date, minutes, quality: Number(record.quality) };
        if (record.type === "nap") naps.push(normalized);
        else main.push(normalized);
    }

    const qualities = main
        .map(item => item.quality)
        .filter(value => Number.isInteger(value) && value >= 1 && value <= 5);

    return {
        main,
        naps,
        totalMainMinutes: main.reduce((sum, item) => sum + item.minutes, 0),
        averageMainMinutes: main.length
            ? main.reduce((sum, item) => sum + item.minutes, 0) / main.length
            : null,
        averageQuality: average(qualities)
    };
}

// ==========================================
// JOURNAL / MOOD AGGREGATION
// ==========================================

function aggregateMood(journal, startKey, endKey) {
    const entries = journal.filter(item => {
        if (!item || typeof item !== "object") return false;
        if (item.recordType === JOURNAL_RECORD_TYPE) return false;
        if (item.recordType === ACADEMIC_RECORD_TYPE) return false;
        if (item.recordType === SECONDARY_SUBJECT_TYPE) return false;
        if (!MOOD_LABELS[item.mood]) return false;
        return typeof item.date === "string" && item.date >= startKey && item.date <= endKey;
    });

    const energyValues = entries
        .map(item => Number(item.energy) || MOOD_LABELS[item.mood].score)
        .filter(value => value >= 1 && value <= 5);

    const counts = {};
    for (const entry of entries) {
        counts[entry.mood] = (counts[entry.mood] || 0) + 1;
    }

    const topMood = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

    return {
        entries,
        count: entries.length,
        averageEnergy: average(energyValues),
        counts,
        topMood
    };
}

// ==========================================
// GOAL PROGRESS
// ==========================================

function getGoalPeriodStart(period) {
    const today = new Date();
    today.setHours(12, 0, 0, 0);

    if (period === "daily") return getDateKey(today);
    if (period === "monthly") {
        return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-01`;
    }

    const weekday = (today.getDay() + 6) % 7;
    today.setDate(today.getDate() - weekday);
    return getDateKey(today);
}

function countFocusSessions(day) {
    if (!day || typeof day !== "object") return 0;
    if (Array.isArray(day.sessions) && day.sessions.length) {
        return day.sessions.filter(session =>
            session && session.type !== "break" && safeNumber(session.seconds) > 0
        ).length;
    }
    return safeNumber(day.completedSessions);
}

function calculateGoalValue(goal, database) {
    const start = getGoalPeriodStart(goal.period);
    const end = getDateKey();
    const daysMap = database.study?.days || {};

    if (goal.metric === "study_hours" || goal.metric === "subject_hours" || goal.metric === "focus_sessions") {
        let total = 0;
        let cursor = start;
        while (cursor <= end) {
            const day = getDayStudyData(daysMap[cursor]);
            if (goal.metric === "study_hours") {
                total += day.totalSeconds / 3600;
            } else if (goal.metric === "subject_hours") {
                total += safeNumber(day.subjectSeconds[goal.subject]) / 3600;
            } else {
                total += countFocusSessions(daysMap[cursor]);
            }
            cursor = shiftDateKey(cursor, 1);
        }
        return total;
    }

    if (goal.metric === "sleep_hours") {
        const sleep = aggregateSleep(
            Array.isArray(database.sleep?.records) ? database.sleep.records : [],
            start,
            end
        );
        return (sleep.totalMainMinutes + sleep.naps.reduce((sum, item) => sum + item.minutes, 0)) / 60;
    }

    return 0;
}

function getGoalUnit(goal) {
    if (goal.metric === "focus_sessions") return tx("sessions", "phiên");
    return tx("hours", "giờ");
}

function getGoalLabel(goal) {
    if (goal.metric === "study_hours") return tx("Study time", "Thời gian học");
    if (goal.metric === "sleep_hours") return tx("Sleep time", "Thời gian ngủ");
    if (goal.metric === "focus_sessions") return tx("Focus sessions", "Phiên tập trung");
    if (goal.metric === "subject_hours") return tx(`${goal.subject} study time`, `Thời gian học ${goal.subject}`);
    return tx("Goal", "Mục tiêu");
}

function getGoalProgress(database) {
    return (Array.isArray(database.goals) ? database.goals : [])
        .map(goal => {
            const target = Number(goal?.targetValue);
            if (!goal || !Number.isFinite(target) || target <= 0) return null;
            const current = calculateGoalValue(goal, database);
            return {
                ...goal,
                current,
                target,
                percentage: clamp((current / target) * 100, 0, 100),
                label: getGoalLabel(goal)
            };
        })
        .filter(Boolean);
}

// ==========================================
// ACADEMIC TASK SUMMARY
// ==========================================

function getAcademicSummary(journal) {
    const tasks = journal
        .filter(item => item?.recordType === ACADEMIC_RECORD_TYPE)
        .filter(item => typeof item.title === "string");

    const today = getDateKey();
    const open = tasks.filter(task => task.status !== "done");
    const overdue = open.filter(task =>
        typeof task.dueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(task.dueDate) && task.dueDate < today
    );
    const dueSoon = open.filter(task => {
        if (typeof task.dueDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(task.dueDate)) return false;
        const diff = Math.round((parseDateKey(task.dueDate) - parseDateKey(today)) / 86400000);
        return diff >= 0 && diff <= 3;
    });

    return {
        total: tasks.length,
        open: open.length,
        completed: tasks.filter(task => task.status === "done").length,
        overdue,
        dueSoon,
        tasks
    };
}

// ==========================================
// INSIGHT GENERATION
// ==========================================

function makeInsight(type, icon, title, description, detail = "") {
    return { type, icon, title, description, detail };
}

function generateInsights(data, current, previous, sleep, mood, academic, goals, range) {
    const insights = [];
    const rangeLabel = tx(`last ${range} days`, `${range} ngày gần nhất`);

    if (current.totalSeconds > 0) {
        if (previous.totalSeconds > 0) {
            const change = ((current.totalSeconds - previous.totalSeconds) / previous.totalSeconds) * 100;
            if (change >= 10) {
                insights.push(makeInsight(
                    "positive", "↗",
                    tx("Study time increased", "Thời gian học tăng"),
                    tx(`Recorded study time is up ${Math.round(change)}% compared with the previous ${range} days.`, `Thời gian học ghi nhận tăng ${Math.round(change)}% so với ${range} ngày liền trước.`),
                    tx("Comparison uses saved study-time totals only.", "So sánh chỉ sử dụng tổng thời gian học đã lưu.")
                ));
            } else if (change <= -10) {
                insights.push(makeInsight(
                    "attention", "↘",
                    tx("Study time decreased", "Thời gian học giảm"),
                    tx(`Recorded study time is down ${Math.abs(Math.round(change))}% compared with the previous ${range} days. Check whether some sessions were not recorded.`, `Thời gian học ghi nhận giảm ${Math.abs(Math.round(change))}% so với ${range} ngày liền trước. Có thể kiểm tra xem phiên học nào chưa được ghi nhận.`),
                    tx("This is a comparison of saved records, not a judgement of progress.", "Đây là so sánh dữ liệu đã lưu, không phải đánh giá năng lực.")
                ));
            } else {
                insights.push(makeInsight(
                    "neutral", "→",
                    tx("Study time is broadly steady", "Thời gian học tương đối ổn định"),
                    tx(`Recorded study time changed by ${Math.abs(Math.round(change))}% compared with the previous period.`, `Thời gian học ghi nhận thay đổi ${Math.abs(Math.round(change))}% so với giai đoạn trước.`),
                    tx("Small changes can be normal from one period to another.", "Mức thay đổi nhỏ có thể xuất hiện giữa các giai đoạn.")
                ));
            }
        } else {
            insights.push(makeInsight(
                "positive", "✦",
                tx("Study records are building", "Dữ liệu học tập đang được tích lũy"),
                tx(`There is ${formatDuration(current.totalSeconds)} of recorded study time in the ${rangeLabel}. More records will make comparisons more useful.`, `Đã ghi nhận ${formatDuration(current.totalSeconds)} trong ${rangeLabel}. Dữ liệu bổ sung sẽ giúp việc so sánh hữu ích hơn.`)
            ));
        }
    } else {
        insights.push(makeInsight(
            "neutral", "◷",
            tx("No study time recorded in this period", "Chưa có thời gian học được ghi nhận"),
            tx("Start or complete a Study Room session to build a study pattern. Existing records are not affected.", "Bắt đầu hoặc hoàn thành một phiên trong Study Room để xây dựng dữ liệu học tập. Các bản ghi cũ vẫn được giữ nguyên.")
        ));
    }

    const consistency = (current.activeDays / range) * 100;
    insights.push(makeInsight(
        current.activeDays >= Math.ceil(range * 0.5) ? "positive" : "neutral",
        "▦",
        tx("Study-day consistency", "Tần suất ghi nhận ngày học"),
        tx(`${current.activeDays} of ${range} days contain recorded study time (${Math.round(consistency)}%).`, `Có ${current.activeDays}/${range} ngày ghi nhận thời gian học (${Math.round(consistency)}%).`),
        current.activeDays > 0
            ? tx("A study day is counted when at least one second is recorded.", "Một ngày học được tính khi có ít nhất một giây được ghi nhận.")
            : tx("No active study days have been recorded yet.", "Chưa có ngày học nào được ghi nhận trong giai đoạn này.")
    ));

    const topSubjects = getTopSubjects(current.subjectSeconds);
    if (topSubjects.length) {
        const [topName, topSeconds] = topSubjects[0];
        const share = current.totalSeconds > 0 ? (topSeconds / current.totalSeconds) * 100 : 0;
        insights.push(makeInsight(
            "neutral", "⌁",
            tx("Most-recorded subject", "Môn học được ghi nhận nhiều nhất"),
            tx(`${topName} accounts for ${Math.round(share)}% of recorded study time in this period.`, `${topName} chiếm ${Math.round(share)}% tổng thời gian học được ghi nhận trong giai đoạn này.`),
            topSubjects.length > 1
                ? tx(`${topSubjects.length} subjects have study-time records.`, `Có ${topSubjects.length} môn học có dữ liệu thời gian.`)
                : tx("Only one subject has study-time records in this period.", "Chỉ có một môn học được ghi nhận trong giai đoạn này.")
        ));
    }

    if (sleep.main.length >= 2) {
        const hours = sleep.averageMainMinutes / 60;
        insights.push(makeInsight(
            "neutral", "☾",
            tx("Recorded main-sleep average", "Thời lượng giấc ngủ chính trung bình"),
            tx(`${hours.toFixed(1)} hours per recorded main-sleep session, based on ${sleep.main.length} entries.`, `Trung bình ${hours.toFixed(1)} giờ mỗi bản ghi giấc ngủ chính, dựa trên ${sleep.main.length} bản ghi.`),
            tx("This reflects saved entries only. Missing or incomplete records can change the average.", "Số liệu phản ánh các bản ghi đã lưu. Bản ghi thiếu hoặc chưa hoàn chỉnh có thể làm thay đổi giá trị trung bình.")
        ));
    } else if (sleep.main.length === 1) {
        insights.push(makeInsight(
            "neutral", "☾",
            tx("One main-sleep entry found", "Có một bản ghi giấc ngủ chính"),
            tx("More entries are needed before a useful sleep average can be calculated.", "Cần thêm bản ghi trước khi có thể tính giá trị trung bình hữu ích.")
        ));
    }

    if (mood.count >= 2) {
        const topMood = MOOD_LABELS[mood.topMood];
        insights.push(makeInsight(
            "neutral", "◌",
            tx("Journal mood pattern", "Tâm trạng trong nhật ký"),
            tx(`${topMood.en} is the most frequently selected mood (${mood.counts[mood.topMood]} of ${mood.count} entries).`, `${topMood.vi} là tâm trạng được chọn nhiều nhất (${mood.counts[mood.topMood]}/${mood.count} bản ghi).`),
            tx("Mood entries are personal check-ins and are not a clinical assessment.", "Các bản ghi tâm trạng là tự đánh giá cá nhân, không phải đánh giá y khoa.")
        ));
    }

    if (academic.overdue.length > 0) {
        insights.push(makeInsight(
            "attention", "!",
            tx("Tasks past their deadline", "Nhiệm vụ đã quá hạn"),
            tx(`${academic.overdue.length} open task${academic.overdue.length === 1 ? " is" : "s are"} past the saved deadline. Consider reviewing the list and choosing one manageable next step.`, `Có ${academic.overdue.length} nhiệm vụ chưa hoàn thành đã qua hạn. Có thể xem lại danh sách và chọn một bước tiếp theo vừa sức.`),
            tx("Only tasks with a valid deadline and a non-completed status are counted.", "Chỉ tính nhiệm vụ có hạn chót hợp lệ và chưa hoàn thành.")
        ));
    } else if (academic.dueSoon.length > 0) {
        insights.push(makeInsight(
            "attention", "◷",
            tx("Deadlines coming up", "Hạn chót sắp đến"),
            tx(`${academic.dueSoon.length} open task${academic.dueSoon.length === 1 ? " is" : "s are"} due within the next three days.`, `Có ${academic.dueSoon.length} nhiệm vụ chưa hoàn thành đến hạn trong ba ngày tới.`),
            tx("The count includes today and the next three calendar days.", "Số lượng bao gồm hôm nay và ba ngày tiếp theo.")
        ));
    } else if (academic.total > 0) {
        insights.push(makeInsight(
            "positive", "✓",
            tx("No overdue academic tasks", "Không có nhiệm vụ học tập quá hạn"),
            tx("No open task with a past deadline was found in Academic Assistant.", "Không tìm thấy nhiệm vụ đang mở nào có hạn chót đã qua trong Academic Assistant.")
        ));
    }

    const nearGoals = goals.filter(goal => goal.percentage >= 80 && goal.percentage < 100);
    const completedGoals = goals.filter(goal => goal.percentage >= 100);
    if (completedGoals.length) {
        insights.push(makeInsight(
            "positive", "★",
            tx("Goal targets reached", "Đã đạt mục tiêu"),
            tx(`${completedGoals.length} goal${completedGoals.length === 1 ? "" : "s"} have reached or passed their current target.`, `Có ${completedGoals.length} mục tiêu đã đạt hoặc vượt chỉ tiêu hiện tại.`)
        ));
    } else if (nearGoals.length) {
        insights.push(makeInsight(
            "positive", "◎",
            tx("Goals getting close", "Mục tiêu đang tiến gần"),
            tx(`${nearGoals.length} goal${nearGoals.length === 1 ? " is" : "s are"} at 80% or more of the target for the current period.`, `Có ${nearGoals.length} mục tiêu đã đạt ít nhất 80% chỉ tiêu trong giai đoạn hiện tại.`)
        ));
    }

    if (!current.totalSeconds && !sleep.main.length && !mood.count && !academic.total && !goals.length) {
        insights.push(makeInsight(
            "neutral", "✧",
            tx("More records unlock more insights", "Cần thêm dữ liệu để tạo phân tích"),
            tx("Use Study Room, Sleep Tracker, Daily Journal and Academic Assistant. Insights appear as records accumulate.", "Sử dụng Study Room, Sleep Tracker, Daily Journal và Academic Assistant. Phân tích sẽ xuất hiện khi dữ liệu được tích lũy.")
        ));
    }

    return insights;
}
// ==========================================
// DATA MODEL FOR THE PAGE
// ==========================================

function buildInsightsModel() {
    const database = readDatabase();
    const bounds = getPeriodBounds(selectedRange);
    const previousBounds = getPreviousPeriodBounds(selectedRange);
    const daysMap = database.study?.days || {};

    const current = aggregateStudyPeriod(daysMap, bounds.start, bounds.end);
    const previous = aggregateStudyPeriod(daysMap, previousBounds.start, previousBounds.end);

    const sleep = aggregateSleep(
        Array.isArray(database.sleep?.records) ? database.sleep.records : [],
        bounds.start,
        bounds.end
    );

    const mood = aggregateMood(
        Array.isArray(database.journal) ? database.journal : [],
        bounds.start,
        bounds.end
    );

    const academic = getAcademicSummary(
        Array.isArray(database.journal) ? database.journal : []
    );

    const goals = getGoalProgress(database);
    const insights = generateInsights(
        database,
        current,
        previous,
        sleep,
        mood,
        academic,
        goals,
        selectedRange
    );

    return {
        bounds,
        current,
        previous,
        sleep,
        mood,
        academic,
        goals,
        insights
    };
}

// ==========================================
// PRESENTATION
// ==========================================

function renderMetricCard(label, value, note, icon, accent = "") {
    return `
        <article class="card ai-metric-card">
            <div class="ai-metric-top">
                <span>${escapeHTML(label)}</span>
                <span class="ai-metric-icon">${icon}</span>
            </div>
            <strong class="ai-metric-value ${accent}">${escapeHTML(value)}</strong>
            <small>${escapeHTML(note)}</small>
        </article>
    `;
}

function renderDailyBars(daily) {
    const max = Math.max(1, ...daily.map(day => day.totalSeconds));

    return daily.map(day => {
        const width = day.totalSeconds > 0
            ? clamp((day.totalSeconds / max) * 100, 3, 100)
            : 0;
        const date = parseDateKey(day.date);
        const label = date.toLocaleDateString(getLocale(), { weekday: "short", day: "numeric" });
        const value = day.totalSeconds > 0 ? formatDuration(day.totalSeconds) : "0";

        return `
            <div class="ai-day-row">
                <span class="ai-day-label">${escapeHTML(label)}</span>
                <div class="ai-bar-track">
                    <div class="ai-bar-fill" style="width:${width}%"></div>
                </div>
                <span class="ai-day-value">${escapeHTML(value)}</span>
            </div>
        `;
    }).join("");
}

function renderSubjectBreakdown(subjectSeconds) {
    const subjects = getTopSubjects(subjectSeconds);
    const total = subjects.reduce((sum, [, seconds]) => sum + seconds, 0);

    if (!subjects.length || total <= 0) {
        return `<div class="ai-empty-inline">${escapeHTML(tx("No subject breakdown available for this period.", "Chưa có dữ liệu phân bổ theo môn trong giai đoạn này."))}</div>`;
    }

    return subjects.slice(0, 8).map(([subject, seconds]) => {
        const percentage = (seconds / total) * 100;
        return `
            <div class="ai-subject-row">
                <div class="ai-subject-heading">
                    <strong>${escapeHTML(subject)}</strong>
                    <span>${escapeHTML(formatDuration(seconds))} · ${Math.round(percentage)}%</span>
                </div>
                <div class="ai-bar-track">
                    <div class="ai-bar-fill ai-subject-fill" style="width:${percentage}%"></div>
                </div>
            </div>
        `;
    }).join("");
}

function renderInsightCards(insights) {
    return insights.map(insight => `
        <article class="ai-insight-card insight-${insight.type}">
            <div class="ai-insight-icon">${escapeHTML(insight.icon)}</div>
            <div class="ai-insight-copy">
                <h3>${escapeHTML(insight.title)}</h3>
                <p>${escapeHTML(insight.description)}</p>
                ${insight.detail ? `<small>${escapeHTML(insight.detail)}</small>` : ""}
            </div>
        </article>
    `).join("");
}

function renderGoalProgress(goals) {
    if (!goals.length) {
        return `<div class="ai-empty-inline">${escapeHTML(tx("No saved goals yet. Add a goal in Calendar to see progress here.", "Chưa có mục tiêu được lưu. Thêm mục tiêu trong Calendar để xem tiến độ tại đây."))}</div>`;
    }

    return goals.slice(0, 6).map(goal => `
        <div class="ai-goal-row">
            <div class="ai-goal-heading">
                <div>
                    <strong>${escapeHTML(goal.title)}</strong>
                    <small>${escapeHTML(goal.label)} · ${escapeHTML(tx(goal.period, goal.period === "daily" ? "hằng ngày" : goal.period === "weekly" ? "hằng tuần" : "hằng tháng"))}</small>
                </div>
                <span>${escapeHTML(formatPercent(goal.percentage))}</span>
            </div>
            <div class="ai-bar-track">
                <div class="ai-bar-fill ai-goal-fill" style="width:${goal.percentage}%"></div>
            </div>
            <small class="ai-goal-detail">${escapeHTML(goal.current.toFixed(goal.metric === "focus_sessions" ? 0 : 1))} / ${escapeHTML(String(goal.target))} ${escapeHTML(getGoalUnit(goal))}</small>
        </div>
    `).join("");
}

function renderAcademicLoad(academic) {
    const completion = academic.total > 0
        ? (academic.completed / academic.total) * 100
        : 0;

    return `
        <div class="ai-workload-grid">
            <div><strong>${academic.open}</strong><span>${escapeHTML(tx("Open", "Đang mở"))}</span></div>
            <div><strong>${academic.dueSoon.length}</strong><span>${escapeHTML(tx("Due soon", "Sắp đến hạn"))}</span></div>
            <div><strong class="${academic.overdue.length ? "ai-danger-text" : ""}">${academic.overdue.length}</strong><span>${escapeHTML(tx("Overdue", "Quá hạn"))}</span></div>
            <div><strong>${academic.completed}</strong><span>${escapeHTML(tx("Completed", "Đã xong"))}</span></div>
        </div>
        <div class="ai-workload-progress">
            <div class="ai-workload-progress-heading">
                <span>${escapeHTML(tx("Overall task completion", "Tỷ lệ hoàn thành nhiệm vụ"))}</span>
                <strong>${formatPercent(completion)}</strong>
            </div>
            <div class="ai-bar-track"><div class="ai-bar-fill ai-goal-fill" style="width:${completion}%"></div></div>
        </div>
    `;
}

// ==========================================
// PAGE RENDER
// ==========================================

export function renderInsightsDashboard() {
    let model;
    let errorMessage = "";

    try {
        model = buildInsightsModel();
    } catch (error) {
        errorMessage = error.message || tx("Could not analyze saved data.", "Không thể phân tích dữ liệu đã lưu.");
    }

    if (!model) {
        return `
            <section class="page-heading"><h1>${escapeHTML(tx("AI Insights", "Phân tích thông minh"))}</h1></section>
            <section class="card ai-error-card"><strong>${escapeHTML(tx("Insights unavailable", "Chưa thể tạo phân tích"))}</strong><p>${escapeHTML(errorMessage)}</p></section>
        `;
    }

    const { bounds, current, sleep, mood, academic, goals, insights } = model;
    const averageSleep = sleep.averageMainMinutes === null
        ? tx("No data", "Chưa có dữ liệu")
        : `${(sleep.averageMainMinutes / 60).toFixed(1)} ${tx("h", "giờ")}`;
    const averageMood = mood.averageEnergy === null
        ? tx("No data", "Chưa có dữ liệu")
        : `${mood.averageEnergy.toFixed(1)}/5`;

    const studyDaysNote = tx(
        `${current.activeDays} of ${selectedRange} days recorded`,
        `${current.activeDays}/${selectedRange} ngày có ghi nhận`
    );

    return `
        <section id="restart-insights-page">
            <style>
                #restart-insights-page { display:grid; gap:20px; }
                #restart-insights-page .ai-heading { display:flex; align-items:flex-end; justify-content:space-between; gap:16px; }
                #restart-insights-page .ai-heading h1 { margin:0; }
                #restart-insights-page .ai-heading p { margin-top:7px; max-width:700px; color:var(--text-secondary); line-height:1.65; }
                #restart-insights-page .ai-eyebrow { color:var(--accent); font-size:10px; font-weight:750; letter-spacing:1.5px; }
                #restart-insights-page .ai-heading-actions { display:flex; align-items:center; gap:9px; flex-wrap:wrap; }
                #restart-insights-page .ai-range-switch { display:flex; gap:4px; padding:4px; border:1px solid var(--border); border-radius:12px; background:var(--bg-secondary); }
                #restart-insights-page .ai-range-button { padding:8px 12px; border-radius:8px; color:var(--text-secondary); background:transparent; font-size:11px; }
                #restart-insights-page .ai-range-button.active { background:var(--accent-soft); color:var(--accent); font-weight:700; }
                #restart-insights-page .ai-refresh { width:36px; height:36px; padding:0; display:grid; place-items:center; }
                #restart-insights-page .ai-privacy-note { display:flex; align-items:flex-start; gap:10px; padding:12px 14px; border:1px solid var(--border); border-radius:12px; color:var(--text-secondary); background:var(--bg-secondary); font-size:11px; line-height:1.6; }
                #restart-insights-page .ai-privacy-note span:first-child { color:var(--accent); font-size:15px; }
                #restart-insights-page .ai-metrics { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:13px; }
                #restart-insights-page .ai-metric-card { display:flex; flex-direction:column; gap:8px; padding:17px 18px; min-width:0; }
                #restart-insights-page .ai-metric-top { display:flex; justify-content:space-between; gap:8px; color:var(--text-secondary); font-size:11px; }
                #restart-insights-page .ai-metric-icon { color:var(--accent); font-size:16px; }
                #restart-insights-page .ai-metric-value { display:block; font-size:clamp(19px,2vw,26px); line-height:1.2; letter-spacing:-.7px; overflow-wrap:anywhere; font-variant-numeric:tabular-nums; }
                #restart-insights-page .ai-metric-value.ai-small-value { font-size:16px; }
                #restart-insights-page .ai-metric-card small { color:var(--text-muted); font-size:10px; }
                #restart-insights-page .ai-main-grid { display:grid; grid-template-columns:minmax(0,1.35fr) minmax(260px,.85fr); gap:16px; }
                #restart-insights-page .ai-panel { padding:19px; min-width:0; }
                #restart-insights-page .ai-panel-heading { display:flex; justify-content:space-between; align-items:flex-start; gap:12px; margin-bottom:16px; }
                #restart-insights-page .ai-panel-heading h2 { margin-top:5px; font-size:17px; }
                #restart-insights-page .ai-panel-heading p { margin-top:5px; color:var(--text-muted); font-size:11px; }
                #restart-insights-page .ai-day-list { display:grid; gap:12px; }
                #restart-insights-page .ai-day-row { display:grid; grid-template-columns:48px minmax(40px,1fr) 82px; align-items:center; gap:10px; }
                #restart-insights-page .ai-day-label { color:var(--text-secondary); font-size:10px; }
                #restart-insights-page .ai-day-value { color:var(--text-secondary); text-align:right; font-size:10px; font-variant-numeric:tabular-nums; }
                #restart-insights-page .ai-bar-track { width:100%; height:7px; overflow:hidden; border-radius:20px; background:var(--bg-hover); }
                #restart-insights-page .ai-bar-fill { height:100%; border-radius:20px; background:var(--accent); transition:width .25s ease; }
                #restart-insights-page .ai-subject-list, #restart-insights-page .ai-goal-list { display:grid; gap:14px; }
                #restart-insights-page .ai-subject-heading, #restart-insights-page .ai-goal-heading { display:flex; justify-content:space-between; align-items:baseline; gap:10px; margin-bottom:7px; }
                #restart-insights-page .ai-subject-heading strong, #restart-insights-page .ai-goal-heading strong { font-size:12px; overflow-wrap:anywhere; }
                #restart-insights-page .ai-subject-heading span, #restart-insights-page .ai-goal-heading > span { color:var(--text-secondary); font-size:10px; white-space:nowrap; }
                #restart-insights-page .ai-subject-fill { background:var(--blue); }
                #restart-insights-page .ai-goal-fill { background:var(--purple); }
                #restart-insights-page .ai-insight-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; }
                #restart-insights-page .ai-insight-card { display:flex; gap:12px; padding:15px; border:1px solid var(--border); border-radius:13px; background:var(--bg-secondary); min-width:0; }
                #restart-insights-page .ai-insight-icon { width:31px; height:31px; flex:0 0 31px; display:grid; place-items:center; border-radius:10px; background:var(--bg-hover); color:var(--text-secondary); font-weight:750; }
                #restart-insights-page .insight-positive .ai-insight-icon { color:var(--accent); background:var(--accent-soft); }
                #restart-insights-page .insight-attention .ai-insight-icon { color:var(--orange); background:rgba(233,183,139,.12); }
                #restart-insights-page .ai-insight-copy { min-width:0; }
                #restart-insights-page .ai-insight-copy h3 { margin-bottom:5px; font-size:12px; }
                #restart-insights-page .ai-insight-copy p { color:var(--text-secondary); font-size:11px; line-height:1.65; overflow-wrap:anywhere; }
                #restart-insights-page .ai-insight-copy small { display:block; margin-top:7px; color:var(--text-muted); font-size:10px; line-height:1.55; }
                #restart-insights-page .ai-goal-detail { display:block; margin-top:5px; color:var(--text-muted); font-size:10px; }
                #restart-insights-page .ai-workload-grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:8px; }
                #restart-insights-page .ai-workload-grid > div { padding:13px 8px; display:flex; flex-direction:column; gap:4px; border-radius:10px; background:var(--bg-secondary); text-align:center; }
                #restart-insights-page .ai-workload-grid strong { font-size:21px; font-variant-numeric:tabular-nums; }
                #restart-insights-page .ai-workload-grid span { color:var(--text-muted); font-size:10px; }
                #restart-insights-page .ai-danger-text { color:var(--red); }
                #restart-insights-page .ai-workload-progress { margin-top:16px; }
                #restart-insights-page .ai-workload-progress-heading { display:flex; justify-content:space-between; margin-bottom:7px; color:var(--text-secondary); font-size:11px; }
                #restart-insights-page .ai-workload-progress-heading strong { color:var(--text-primary); }
                #restart-insights-page .ai-empty-inline { padding:20px 12px; border-radius:10px; background:var(--bg-secondary); color:var(--text-muted); font-size:11px; line-height:1.6; text-align:center; }
                #restart-insights-page .ai-footnote { color:var(--text-muted); font-size:10px; line-height:1.6; }
                #restart-insights-page .ai-error-card { padding:20px; }
                #restart-insights-page .ai-error-card p { margin-top:8px; color:var(--text-secondary); font-size:12px; }
                @media(max-width:900px) {
                    #restart-insights-page .ai-metrics { grid-template-columns:repeat(2,minmax(0,1fr)); }
                    #restart-insights-page .ai-main-grid { grid-template-columns:1fr; }
                }
                @media(max-width:620px) {
                    #restart-insights-page .ai-heading { align-items:flex-start; flex-direction:column; }
                    #restart-insights-page .ai-heading-actions { width:100%; justify-content:space-between; }
                    #restart-insights-page .ai-insight-grid { grid-template-columns:1fr; }
                    #restart-insights-page .ai-panel { padding:15px; }
                    #restart-insights-page .ai-day-row { grid-template-columns:42px minmax(35px,1fr) 69px; gap:7px; }
                    #restart-insights-page .ai-workload-grid { grid-template-columns:repeat(2,minmax(0,1fr)); }
                }
            </style>

            <section class="ai-heading">
                <div class="page-heading">
                    <div class="ai-eyebrow">${escapeHTML(tx("PERSONAL PATTERNS", "PHÂN TÍCH CÁ NHÂN"))}</div>
                    <h1>${escapeHTML(tx("AI Insights", "Phân tích thông minh"))}</h1>
                    <p>${escapeHTML(tx("A clear view of study patterns, sleep records, mood check-ins and academic workload.", "Tổng quan về thói quen học tập, dữ liệu giấc ngủ, tâm trạng và khối lượng học tập."))}</p>
                </div>
                <div class="ai-heading-actions">
                    <div class="ai-range-switch" role="group" aria-label="${escapeHTML(tx("Analysis period", "Giai đoạn phân tích"))}">
                        <button type="button" class="ai-range-button ${selectedRange === 7 ? "active" : ""}" data-insights-range="7">${escapeHTML(tx("7 days", "7 ngày"))}</button>
                        <button type="button" class="ai-range-button ${selectedRange === 30 ? "active" : ""}" data-insights-range="30">${escapeHTML(tx("30 days", "30 ngày"))}</button>
                    </div>
                    <button type="button" class="secondary-button ai-refresh" id="insights-refresh" title="${escapeHTML(tx("Refresh analysis", "Làm mới phân tích"))}" aria-label="${escapeHTML(tx("Refresh analysis", "Làm mới phân tích"))}">↻</button>
                </div>
            </section>

            <div class="ai-privacy-note">
                <span>◈</span>
                <span>${escapeHTML(tx("Private on-device analysis. Records stay in this browser. Insights are generated from saved data using transparent rules; no external AI service is contacted.", "Phân tích riêng tư ngay trên thiết bị. Dữ liệu vẫn nằm trong trình duyệt. Nhận xét được tạo từ dữ liệu đã lưu bằng quy tắc rõ ràng, không kết nối dịch vụ AI bên ngoài."))}</span>
            </div>

            <section class="ai-metrics">
                ${renderMetricCard(tx("Study time", "Thời gian học"), formatDuration(current.totalSeconds), studyDaysNote, "◷")}
                ${renderMetricCard(tx("Study days", "Ngày học"), `${current.activeDays}/${selectedRange}`, tx("Days with saved study time", "Ngày có thời gian học được lưu"), "▦")}
                ${renderMetricCard(tx("Avg. main sleep", "Ngủ chính TB"), averageSleep, tx(`${sleep.main.length} saved entries`, `${sleep.main.length} bản ghi đã lưu`), "☾", "ai-small-value")}
                ${renderMetricCard(tx("Avg. mood energy", "Năng lượng TB"), averageMood, tx(`${mood.count} journal check-ins`, `${mood.count} bản ghi nhật ký`), "◌", "ai-small-value")}
            </section>

            <section class="ai-main-grid">
                <article class="card ai-panel">
                    <div class="ai-panel-heading">
                        <div>
                            <div class="ai-eyebrow">${escapeHTML(tx("DAILY ACTIVITY", "HOẠT ĐỘNG HẰNG NGÀY"))}</div>
                            <h2>${escapeHTML(tx("Study-time pattern", "Biểu đồ thời gian học"))}</h2>
                            <p>${escapeHTML(`${formatDate(bounds.start)} – ${formatDate(bounds.end)}`)}</p>
                        </div>
                        <span class="ai-metric-icon">◷</span>
                    </div>
                    <div class="ai-day-list">${renderDailyBars(current.daily)}</div>
                </article>

                <article class="card ai-panel">
                    <div class="ai-panel-heading">
                        <div>
                            <div class="ai-eyebrow">${escapeHTML(tx("SUBJECT MIX", "PHÂN BỔ MÔN HỌC"))}</div>
                            <h2>${escapeHTML(tx("Where time went", "Thời gian theo môn"))}</h2>
                            <p>${escapeHTML(tx("Based on recorded study time", "Dựa trên thời gian học đã ghi nhận"))}</p>
                        </div>
                    </div>
                    <div class="ai-subject-list">${renderSubjectBreakdown(current.subjectSeconds)}</div>
                </article>
            </section>

            <section class="card ai-panel">
                <div class="ai-panel-heading">
                    <div>
                        <div class="ai-eyebrow">${escapeHTML(tx("GENERATED OBSERVATIONS", "NHẬN XÉT TỰ ĐỘNG"))}</div>
                        <h2>${escapeHTML(tx("Patterns & next steps", "Xu hướng và gợi ý tiếp theo"))}</h2>
                        <p>${escapeHTML(tx("Each note is tied to a saved record or a measurable comparison.", "Mỗi nhận xét đều dựa trên bản ghi hoặc phép so sánh có thể kiểm tra."))}</p>
                    </div>
                    <span class="ai-metric-icon">✧</span>
                </div>
                <div class="ai-insight-grid">${renderInsightCards(insights)}</div>
            </section>

            <section class="ai-main-grid">
                <article class="card ai-panel">
                    <div class="ai-panel-heading">
                        <div>
                            <div class="ai-eyebrow">${escapeHTML(tx("ACADEMIC ASSISTANT", "TRỢ LÝ HỌC TẬP"))}</div>
                            <h2>${escapeHTML(tx("Task workload", "Khối lượng nhiệm vụ"))}</h2>
                            <p>${escapeHTML(tx("Current task list", "Danh sách nhiệm vụ hiện tại"))}</p>
                        </div>
                    </div>
                    ${renderAcademicLoad(academic)}
                </article>

                <article class="card ai-panel">
                    <div class="ai-panel-heading">
                        <div>
                            <div class="ai-eyebrow">${escapeHTML(tx("GOAL TRACKING", "THEO DÕI MỤC TIÊU"))}</div>
                            <h2>${escapeHTML(tx("Current goal progress", "Tiến độ mục tiêu hiện tại"))}</h2>
                        </div>
                    </div>
                    <div class="ai-goal-list">${renderGoalProgress(goals)}</div>
                </article>
            </section>

            <p class="ai-footnote">${escapeHTML(tx("Insights describe recorded activity only. They do not diagnose health conditions or establish cause and effect. Check that entries are complete before drawing conclusions.", "Phân tích chỉ mô tả hoạt động đã ghi nhận. Đây không phải chẩn đoán sức khỏe hay kết luận nguyên nhân. Nên kiểm tra độ đầy đủ của dữ liệu trước khi đưa ra kết luận."))}</p>
        </section>
    `;
}

// ==========================================
// EVENT BINDING
// ==========================================

function refreshDashboard() {
    const panel = document.querySelector("#insights-dashboard-panel");
    if (!panel) return;
    panel.innerHTML = renderInsightsDashboard();
    bindInsightsDashboard();
}

export function bindInsightsDashboard() {
    document.querySelectorAll("[data-insights-range]").forEach(button => {
        button.addEventListener("click", () => {
            const nextRange = Number(button.dataset.insightsRange);
            if (![7, 30].includes(nextRange) || nextRange === selectedRange) return;
            selectedRange = nextRange;
            refreshDashboard();
        });
    });

    document.querySelector("#insights-refresh")?.addEventListener("click", () => {
        refreshDashboard();
    });
}