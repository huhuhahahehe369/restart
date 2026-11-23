
// ==========================================
// RE:START M08.3 - ACADEMIC ASSISTANT
// Academic task, assignment and exam planner
// Records are stored in the existing journal array
// using recordType: "academic_task".
// This keeps M03 backup/restore compatibility.
// ==========================================

const DATABASE_KEY = "restart-data-v1";
const RECORD_TYPE = "academic_task";
const MAX_TASKS = 2000;

const TASK_TYPES = [
    { id: "assignment", en: "Assignment", vi: "Bài tập" },
    { id: "exam", en: "Exam", vi: "Bài kiểm tra" },
    { id: "revision", en: "Revision", vi: "Ôn tập" },
    { id: "project", en: "Project", vi: "Dự án" },
    { id: "other", en: "Other", vi: "Khác" }
];

const PRIORITIES = [
    { id: "low", en: "Low", vi: "Thấp" },
    { id: "medium", en: "Medium", vi: "Trung bình" },
    { id: "high", en: "High", vi: "Cao" }
];

const STATUSES = [
    { id: "todo", en: "To do", vi: "Chưa bắt đầu" },
    { id: "in_progress", en: "In progress", vi: "Đang thực hiện" },
    { id: "done", en: "Completed", vi: "Hoàn thành" }
];

const SUBJECT_SUGGESTIONS = [
    "Mathematics",
    "Physics",
    "Chemistry",
    "Biology",
    "Informatics",
    "English",
    "Literature",
    "History",
    "Geography",
    "Civic Education"
];

let editingTaskId = null;
let showTaskForm = false;
let activeFilter = "active";
let activeTypeFilter = "all";
let searchQuery = "";
let subjectFilter = "all";

// ==========================================
// LANGUAGE & HELPERS
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

function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[character]);
}

function createId() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `academic-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getDateKey(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function isValidDateKey(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function formatDate(value) {
    if (!isValidDateKey(value)) return tx("No deadline", "Không có hạn chót");
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day, 12).toLocaleDateString(
        getLanguage() === "vi" ? "vi-VN" : "en-US",
        { day: "numeric", month: "short", year: "numeric" }
    );
}

function getDaysUntil(value) {
    if (!isValidDateKey(value)) return null;
    const [year, month, day] = value.split("-").map(Number);
    const target = Date.UTC(year, month - 1, day);
    const [todayYear, todayMonth, todayDay] = getDateKey().split("-").map(Number);
    const today = Date.UTC(todayYear, todayMonth - 1, todayDay);
    return Math.round((target - today) / 86400000);
}

function getType(id) {
    return TASK_TYPES.find(item => item.id === id) || TASK_TYPES[4];
}

function getPriority(id) {
    return PRIORITIES.find(item => item.id === id) || PRIORITIES[1];
}

function getStatus(id) {
    return STATUSES.find(item => item.id === id) || STATUSES[0];
}

function getTaskLabel(task) {
    const days = getDaysUntil(task.dueDate);
    if (task.status === "done") return tx("Completed", "Đã hoàn thành");
    if (days === null) return tx("No deadline", "Chưa có hạn");
    if (days < 0) return tx(`${Math.abs(days)}d overdue`, `Quá hạn ${Math.abs(days)} ngày`);
    if (days === 0) return tx("Due today", "Hạn hôm nay");
    if (days === 1) return tx("Due tomorrow", "Hạn ngày mai");
    return tx(`Due in ${days} days`, `Còn ${days} ngày`);
}

// ==========================================
// ACADEMIC TASK STORAGE
// ==========================================

function readAcademicDatabase() {
    const raw = localStorage.getItem(DATABASE_KEY);
    if (!raw) throw new Error("RE:START storage is not initialized. Reload the app and try again.");

    let database;
    try {
        database = JSON.parse(raw);
    } catch (error) {
        console.error("Could not parse RE:START database:", error);
        throw new Error("RE:START data is unreadable. No saved records were changed.");
    }

    if (!database || typeof database !== "object" || !database.settings) {
        throw new Error("RE:START data is unreadable. No saved records were changed.");
    }

    if (!Array.isArray(database.journal)) database.journal = [];
    return database;
}

function writeAcademicDatabase(database) {
    database.meta = database.meta || {};
    database.meta.updatedAt = new Date().toISOString();
    try {
        localStorage.setItem(DATABASE_KEY, JSON.stringify(database));
    } catch (error) {
        console.error("Could not save academic task:", error);
        throw new Error("Could not save data. Browser storage may be full.");
    }
}

function normalizeTask(item) {
    if (!item || typeof item !== "object" || item.recordType !== RECORD_TYPE) return null;

    const title = String(item.title || "").trim().slice(0, 120);
    if (!title) return null;

    const type = TASK_TYPES.some(option => option.id === item.type) ? item.type : "other";
    const priority = PRIORITIES.some(option => option.id === item.priority) ? item.priority : "medium";
    const status = STATUSES.some(option => option.id === item.status) ? item.status : "todo";
    const dueDate = isValidDateKey(item.dueDate) ? item.dueDate : "";
    const estimate = Number(item.estimateMinutes);

    return {
        recordType: RECORD_TYPE,
        id: typeof item.id === "string" && item.id ? item.id : createId(),
        title,
        subject: String(item.subject || "").trim().slice(0, 60),
        type,
        priority,
        status,
        dueDate,
        estimateMinutes: Number.isInteger(estimate) && estimate >= 5 && estimate <= 600 ? estimate : 30,
        notes: String(item.notes || "").trim().slice(0, 2000),
        createdAt: typeof item.createdAt === "string" ? item.createdAt : new Date().toISOString(),
        updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : new Date().toISOString(),
        completedAt: typeof item.completedAt === "string" ? item.completedAt : null
    };
}

function getAcademicTasks() {
    const database = readAcademicDatabase();
    return database.journal
        .filter(item => item?.recordType === RECORD_TYPE)
        .map(normalizeTask)
        .filter(Boolean)
        .sort((a, b) => {
            if (a.status === "done" && b.status !== "done") return 1;
            if (a.status !== "done" && b.status === "done") return -1;
            const aDate = a.dueDate || "9999-12-31";
            const bDate = b.dueDate || "9999-12-31";
            if (aDate !== bDate) return aDate.localeCompare(bDate);
            const priorityRank = { high: 0, medium: 1, low: 2 };
            if (priorityRank[a.priority] !== priorityRank[b.priority]) {
                return priorityRank[a.priority] - priorityRank[b.priority];
            }
            return new Date(b.updatedAt) - new Date(a.updatedAt);
        });
}

function saveAcademicTask(data) {
    const title = String(data.title || "").trim();
    const subject = String(data.subject || "").trim();
    const notes = String(data.notes || "").trim();
    const dueDate = String(data.dueDate || "");
    const estimateMinutes = Number(data.estimateMinutes);

    if (!title) throw new Error(tx("Enter a task title.", "Hãy nhập tên nhiệm vụ."));
    if (title.length > 120) throw new Error(tx("The title cannot exceed 120 characters.", "Tên nhiệm vụ không được vượt quá 120 ký tự."));
    if (subject.length > 60) throw new Error(tx("The subject cannot exceed 60 characters.", "Tên môn học không được vượt quá 60 ký tự."));
    if (notes.length > 2000) throw new Error(tx("Notes cannot exceed 2000 characters.", "Ghi chú không được vượt quá 2000 ký tự."));
    if (dueDate && !isValidDateKey(dueDate)) throw new Error(tx("Choose a valid deadline.", "Hãy chọn hạn chót hợp lệ."));
    if (!TASK_TYPES.some(item => item.id === data.type)) throw new Error(tx("Choose a valid task type.", "Hãy chọn loại nhiệm vụ hợp lệ."));
    if (!PRIORITIES.some(item => item.id === data.priority)) throw new Error(tx("Choose a valid priority.", "Hãy chọn mức ưu tiên hợp lệ."));
    if (!STATUSES.some(item => item.id === data.status)) throw new Error(tx("Choose a valid status.", "Hãy chọn trạng thái hợp lệ."));
    if (!Number.isInteger(estimateMinutes) || estimateMinutes < 5 || estimateMinutes > 600) {
        throw new Error(tx("Estimated time must be between 5 and 600 minutes.", "Thời lượng ước tính phải từ 5 đến 600 phút."));
    }

    const database = readAcademicDatabase();
    const existingIndex = database.journal.findIndex(item =>
        item?.recordType === RECORD_TYPE && item?.id === data.id
    );
    const existing = existingIndex >= 0 ? normalizeTask(database.journal[existingIndex]) : null;
    const now = new Date().toISOString();
    const status = data.status;

    const saved = {
        recordType: RECORD_TYPE,
        id: existing?.id || createId(),
        title,
        subject,
        type: data.type,
        priority: data.priority,
        status,
        dueDate,
        estimateMinutes,
        notes,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
        completedAt: status === "done" ? (existing?.completedAt || now) : null
    };

    if (existingIndex >= 0) {
        database.journal[existingIndex] = saved;
    } else {
        if (database.journal.length >= 10000) {
            throw new Error(tx("The shared personal data storage limit has been reached.", "Đã đạt giới hạn lưu trữ dữ liệu cá nhân."));
        }
        const taskCount = database.journal.filter(item => item?.recordType === RECORD_TYPE).length;
        if (taskCount >= MAX_TASKS) throw new Error(tx("The academic task limit has been reached.", "Đã đạt giới hạn số nhiệm vụ học tập."));
        database.journal.push(saved);
    }

    writeAcademicDatabase(database);
    return saved;
}

function deleteAcademicTask(id) {
    const database = readAcademicDatabase();
    const previousLength = database.journal.length;
    database.journal = database.journal.filter(item =>
        !(item?.recordType === RECORD_TYPE && item?.id === id)
    );
    if (database.journal.length !== previousLength) {
        writeAcademicDatabase(database);
        return true;
    }
    return false;
}

// ==========================================
// TASK SELECTION & PRESENTATION
// ==========================================

function getOpenTasks(tasks) {
    return tasks.filter(task => task.status !== "done");
}

function getSuggestedTask(tasks) {
    return getOpenTasks(tasks).slice().sort((a, b) => {
        const aDays = getDaysUntil(a.dueDate);
        const bDays = getDaysUntil(b.dueDate);
        const aUrgency = aDays === null ? 9999 : aDays;
        const bUrgency = bDays === null ? 9999 : bDays;
        if (aUrgency !== bUrgency) return aUrgency - bUrgency;
        const priorityRank = { high: 0, medium: 1, low: 2 };
        return priorityRank[a.priority] - priorityRank[b.priority];
    })[0] || null;
}

function getFilteredTasks(tasks) {
    const query = searchQuery.trim().toLocaleLowerCase();
    return tasks.filter(task => {
        const matchesStatus =
            activeFilter === "all" ||
            (activeFilter === "active" && task.status !== "done") ||
            (activeFilter === "todo" && task.status === "todo") ||
            (activeFilter === "in_progress" && task.status === "in_progress") ||
            (activeFilter === "done" && task.status === "done") ||
            (activeFilter === "overdue" && task.status !== "done" && getDaysUntil(task.dueDate) < 0);
        const matchesType = activeTypeFilter === "all" || task.type === activeTypeFilter;
        const matchesSubject = subjectFilter === "all" || task.subject === subjectFilter;
        const haystack = `${task.title} ${task.subject} ${task.notes}`.toLocaleLowerCase();
        return matchesStatus && matchesType && matchesSubject && (!query || haystack.includes(query));
    });
}

function renderSelectOptions(items, selected, includeAll = false) {
    const options = includeAll
        ? `<option value="all">${escapeHTML(tx("All types", "Tất cả loại"))}</option>`
        : "";
    return options + items.map(item => `
        <option value="${item.id}" ${selected === item.id ? "selected" : ""}>
            ${escapeHTML(tx(item.en, item.vi))}
        </option>
    `).join("");
}

function renderStats(tasks) {
    const active = tasks.filter(task => task.status !== "done").length;
    const today = tasks.filter(task => task.status !== "done" && task.dueDate === getDateKey()).length;
    const overdue = tasks.filter(task => task.status !== "done" && getDaysUntil(task.dueDate) < 0).length;
    const completed = tasks.filter(task => task.status === "done").length;

    const stats = [
        { label: tx("Active tasks", "Nhiệm vụ đang mở"), value: active, note: tx("Not completed", "Chưa hoàn thành"), color: "var(--accent)" },
        { label: tx("Due today", "Đến hạn hôm nay"), value: today, note: tx("Needs attention today", "Cần xử lý hôm nay"), color: "var(--orange)" },
        { label: tx("Overdue", "Quá hạn"), value: overdue, note: tx("Past deadline", "Đã qua hạn chót"), color: "var(--red)" },
        { label: tx("Completed", "Đã hoàn thành"), value: completed, note: tx("Finished tasks", "Nhiệm vụ đã xong"), color: "var(--blue)" }
    ];

    return stats.map(item => `
        <article class="card ac-stat-card">
            <span class="ac-stat-label">${escapeHTML(item.label)}</span>
            <strong class="ac-stat-value" style="color:${item.color}">${item.value}</strong>
            <span class="ac-stat-note">${escapeHTML(item.note)}</span>
        </article>
    `).join("");
}

function renderTaskForm(task = null) {
    if (!showTaskForm) return "";
    const value = task || {
        title: "", subject: "", type: "assignment", priority: "medium",
        status: "todo", dueDate: "", estimateMinutes: 30, notes: ""
    };

    return `
        <section class="card ac-form-card" id="academic-form-card">
            <div class="ac-section-heading">
                <div>
                    <div class="ac-eyebrow">${escapeHTML(tx("TASK DETAILS", "CHI TIẾT NHIỆM VỤ"))}</div>
                    <h2>${escapeHTML(task ? tx("Edit task", "Chỉnh sửa nhiệm vụ") : tx("New academic task", "Nhiệm vụ học tập mới"))}</h2>
                </div>
                <button type="button" class="secondary-button ac-compact-button" id="academic-form-cancel">${escapeHTML(tx("Cancel", "Hủy"))}</button>
            </div>

            <form id="academic-task-form">
                <div class="ac-form-grid">
                    <label class="ac-field ac-field-wide">
                        <span>${escapeHTML(tx("Task title", "Tên nhiệm vụ"))} *</span>
                        <input id="academic-title" name="title" maxlength="120" required value="${escapeHTML(value.title)}" placeholder="${escapeHTML(tx("e.g. Complete physics exercises", "Ví dụ: Hoàn thành bài tập Vật lý"))}">
                    </label>

                    <label class="ac-field">
                        <span>${escapeHTML(tx("Subject", "Môn học"))}</span>
                        <input id="academic-subject" name="subject" maxlength="60" list="academic-subject-options" value="${escapeHTML(value.subject)}" placeholder="${escapeHTML(tx("Enter a subject", "Nhập môn học"))}">
                        <datalist id="academic-subject-options">${SUBJECT_SUGGESTIONS.map(subject => `<option value="${subject}"></option>`).join("")}</datalist>
                    </label>

                    <label class="ac-field">
                        <span>${escapeHTML(tx("Task type", "Loại nhiệm vụ"))}</span>
                        <select id="academic-type" name="type">${renderSelectOptions(TASK_TYPES, value.type)}</select>
                    </label>

                    <label class="ac-field">
                        <span>${escapeHTML(tx("Priority", "Mức ưu tiên"))}</span>
                        <select id="academic-priority" name="priority">${renderSelectOptions(PRIORITIES, value.priority)}</select>
                    </label>

                    <label class="ac-field">
                        <span>${escapeHTML(tx("Status", "Trạng thái"))}</span>
                        <select id="academic-status" name="status">${renderSelectOptions(STATUSES, value.status)}</select>
                    </label>

                    <label class="ac-field">
                        <span>${escapeHTML(tx("Deadline", "Hạn chót"))}</span>
                        <input id="academic-due-date" name="dueDate" type="date" value="${escapeHTML(value.dueDate)}">
                    </label>

                    <label class="ac-field">
                        <span>${escapeHTML(tx("Estimated time (minutes)", "Thời lượng dự kiến (phút)"))}</span>
                        <input id="academic-estimate" name="estimateMinutes" type="number" min="5" max="600" step="5" required value="${value.estimateMinutes}">
                    </label>

                    <label class="ac-field ac-field-wide">
                        <span>${escapeHTML(tx("Notes", "Ghi chú"))}</span>
                        <textarea id="academic-notes" name="notes" maxlength="2000" rows="3" placeholder="${escapeHTML(tx("Add instructions, materials or a reminder...", "Thêm yêu cầu, tài liệu hoặc lời nhắc..."))}">${escapeHTML(value.notes)}</textarea>
                    </label>
                </div>

                <div class="ac-form-actions">
                    <button type="submit" class="primary-button">${escapeHTML(task ? tx("Save changes", "Lưu thay đổi") : tx("Save task", "Lưu nhiệm vụ"))}</button>
                    <span class="ac-form-status" id="academic-form-status" role="status" aria-live="polite"></span>
                </div>
            </form>
        </section>
    `;
}

function renderSuggestion(tasks) {
    const task = getSuggestedTask(tasks);
    if (!task) {
        return `
            <section class="card ac-suggestion ac-suggestion-empty">
                <div class="ac-suggestion-icon">✦</div>
                <div>
                    <div class="ac-eyebrow">${escapeHTML(tx("NEXT FOCUS", "ƯU TIÊN TIẾP THEO"))}</div>
                    <h2>${escapeHTML(tx("Nothing urgent on the list", "Chưa có nhiệm vụ cần ưu tiên"))}</h2>
                    <p>${escapeHTML(tx("Add an assignment, exam or revision task to build a clear study queue.", "Thêm bài tập, bài kiểm tra hoặc kế hoạch ôn tập để tạo danh sách học tập rõ ràng."))}</p>
                </div>
            </section>
        `;
    }

    const type = getType(task.type);
    const priority = getPriority(task.priority);

    return `
        <section class="card ac-suggestion">
            <div class="ac-suggestion-icon">✦</div>
            <div class="ac-suggestion-copy">
                <div class="ac-eyebrow">${escapeHTML(tx("SUGGESTED NEXT TASK", "NHIỆM VỤ ĐƯỢC ĐỀ XUẤT"))}</div>
                <h2>${escapeHTML(task.title)}</h2>
                <p>${escapeHTML(task.subject || tx("General", "Chung"))} · ${escapeHTML(tx(type.en, type.vi))} · ${escapeHTML(tx(priority.en, priority.vi))}</p>
            </div>
            <div class="ac-suggestion-meta">
                <span class="ac-deadline ${getDaysUntil(task.dueDate) < 0 ? "is-overdue" : ""}">${escapeHTML(getTaskLabel(task))}</span>
                <button type="button" class="secondary-button ac-compact-button" data-view-task="${escapeHTML(task.id)}">${escapeHTML(tx("View task", "Xem nhiệm vụ"))}</button>
            </div>
        </section>
    `;
}

function renderTaskCard(task) {
    const type = getType(task.type);
    const priority = getPriority(task.priority);
    const status = getStatus(task.status);
    const dueDays = getDaysUntil(task.dueDate);
    const overdue = task.status !== "done" && dueDays !== null && dueDays < 0;

    return `
        <article class="ac-task-card ${task.status === "done" ? "is-complete" : ""}" data-task-card="${escapeHTML(task.id)}">
            <div class="ac-task-check ${task.status === "done" ? "is-checked" : ""}">
                <button type="button" class="ac-check-button" data-toggle-task="${escapeHTML(task.id)}" aria-label="${escapeHTML(task.status === "done" ? tx("Reopen task", "Mở lại nhiệm vụ") : tx("Mark complete", "Đánh dấu hoàn thành"))}" title="${escapeHTML(task.status === "done" ? tx("Reopen task", "Mở lại nhiệm vụ") : tx("Mark complete", "Đánh dấu hoàn thành"))}">${task.status === "done" ? "✓" : ""}</button>
            </div>
            <div class="ac-task-main">
                <div class="ac-task-topline">
                    <span class="ac-task-type">${escapeHTML(tx(type.en, type.vi))}</span>
                    <span class="ac-priority priority-${task.priority}">${escapeHTML(tx(priority.en, priority.vi))}</span>
                </div>
                <h3>${escapeHTML(task.title)}</h3>
                <div class="ac-task-meta">
                    ${task.subject ? `<span>${escapeHTML(task.subject)}</span>` : ""}
                    <span>${escapeHTML(tx(status.en, status.vi))}</span>
                    <span>${task.estimateMinutes} ${escapeHTML(tx("min", "phút"))}</span>
                    <span class="${overdue ? "ac-overdue-text" : ""}">${escapeHTML(getTaskLabel(task))}</span>
                </div>
                ${task.notes ? `<p class="ac-task-notes">${escapeHTML(task.notes)}</p>` : ""}
            </div>
            <div class="ac-task-actions">
                <button type="button" class="secondary-button ac-icon-action" data-edit-task="${escapeHTML(task.id)}" aria-label="${escapeHTML(tx("Edit", "Chỉnh sửa"))}" title="${escapeHTML(tx("Edit", "Chỉnh sửa"))}">✎</button>
                <button type="button" class="secondary-button ac-icon-action" data-delete-task="${escapeHTML(task.id)}" aria-label="${escapeHTML(tx("Delete", "Xóa"))}" title="${escapeHTML(tx("Delete", "Xóa"))}">×</button>
            </div>
        </article>
    `;
}

function renderTaskList(tasks) {
    const filtered = getFilteredTasks(tasks);
    if (!filtered.length) {
        return `
            <div class="ac-empty-state">
                <div class="ac-empty-icon">▤</div>
                <strong>${escapeHTML(tx("No matching tasks", "Không có nhiệm vụ phù hợp"))}</strong>
                <p>${escapeHTML(tx("Try another filter or add a new academic task.", "Thử bộ lọc khác hoặc thêm nhiệm vụ học tập mới."))}</p>
            </div>
        `;
    }
    return filtered.map(renderTaskCard).join("");
}

function renderFilters(tasks) {
    const filters = [
        ["active", tx("Active", "Đang mở")],
        ["all", tx("All", "Tất cả")],
        ["todo", tx("To do", "Chưa bắt đầu")],
        ["in_progress", tx("In progress", "Đang thực hiện")],
        ["overdue", tx("Overdue", "Quá hạn")],
        ["done", tx("Completed", "Hoàn thành")]
    ];
    const subjects = [...new Set(tasks.map(task => task.subject).filter(Boolean))].sort((a, b) => a.localeCompare(b));

    return `
        <div class="ac-filter-row">
            <div class="ac-filter-chips" role="group" aria-label="${escapeHTML(tx("Task status filter", "Lọc trạng thái nhiệm vụ"))}">
                ${filters.map(([id, label]) => `
                    <button type="button" class="ac-filter-chip ${activeFilter === id ? "active" : ""}" data-filter="${id}">${escapeHTML(label)}</button>
                `).join("")}
            </div>
            <div class="ac-extra-filters">
                <select id="academic-type-filter" class="subject-select ac-filter-select" aria-label="${escapeHTML(tx("Task type", "Loại nhiệm vụ"))}">
                    ${renderSelectOptions(TASK_TYPES, activeTypeFilter, true)}
                </select>
                <select id="academic-subject-filter" class="subject-select ac-filter-select" aria-label="${escapeHTML(tx("Subject", "Môn học"))}">
                    <option value="all">${escapeHTML(tx("All subjects", "Tất cả môn học"))}</option>
                    ${subjects.map(subject => `<option value="${escapeHTML(subject)}" ${subjectFilter === subject ? "selected" : ""}>${escapeHTML(subject)}</option>`).join("")}
                </select>
            </div>
        </div>
    `;
}

// ==========================================
// PAGE RENDER
// ==========================================

export function renderAcademicPage() {
    const tasks = getAcademicTasks();
    const subjects = [...new Set(tasks.map(task => task.subject).filter(Boolean))];

    const editingTask = editingTaskId
        ? tasks.find(task => task.id === editingTaskId) || null
        : null;

    return `
        <section id="restart-academic-page">
            <style>
                #restart-academic-page { display:grid; gap:20px; }
                #restart-academic-page .ac-page-heading { display:flex; align-items:flex-end; justify-content:space-between; gap:16px; }
                #restart-academic-page .ac-page-heading p { max-width:680px; }
                #restart-academic-page .ac-eyebrow { color:var(--accent); font-size:10px; font-weight:750; letter-spacing:1.5px; }
                #restart-academic-page .ac-stats { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:14px; }
                #restart-academic-page .ac-stat-card { padding:18px 20px; display:flex; flex-direction:column; gap:5px; }
                #restart-academic-page .ac-stat-label { color:var(--text-secondary); font-size:12px; }
                #restart-academic-page .ac-stat-value { font-size:30px; line-height:1.2; font-weight:750; letter-spacing:-1px; font-variant-numeric:tabular-nums; }
                #restart-academic-page .ac-stat-note { color:var(--text-muted); font-size:11px; }
                #restart-academic-page .ac-suggestion { display:flex; align-items:center; gap:16px; padding:20px 22px; }
                #restart-academic-page .ac-suggestion-icon { width:42px; height:42px; flex:0 0 42px; display:grid; place-items:center; border-radius:13px; background:var(--accent-soft); color:var(--accent); font-size:20px; }
                #restart-academic-page .ac-suggestion-copy { flex:1; min-width:0; }
                #restart-academic-page .ac-suggestion h2 { margin-top:5px; font-size:17px; overflow-wrap:anywhere; }
                #restart-academic-page .ac-suggestion p { margin-top:5px; color:var(--text-secondary); font-size:12px; }
                #restart-academic-page .ac-suggestion-meta { display:flex; align-items:flex-end; flex-direction:column; gap:9px; }
                #restart-academic-page .ac-deadline { color:var(--text-secondary); font-size:12px; font-weight:650; }
                #restart-academic-page .ac-deadline.is-overdue, #restart-academic-page .ac-overdue-text { color:var(--red); }
                #restart-academic-page .ac-section-heading { display:flex; align-items:center; justify-content:space-between; gap:14px; margin-bottom:16px; }
                #restart-academic-page .ac-section-heading h2 { margin-top:5px; font-size:19px; }
                #restart-academic-page .ac-compact-button { padding:9px 13px; font-size:12px; white-space:nowrap; }
                #restart-academic-page .ac-form-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:14px; }
                #restart-academic-page .ac-field { display:flex; flex-direction:column; gap:7px; color:var(--text-secondary); font-size:12px; font-weight:600; }
                #restart-academic-page .ac-field-wide { grid-column:1/-1; }
                #restart-academic-page .ac-field input, #restart-academic-page .ac-field select, #restart-academic-page .ac-field textarea { width:100%; min-width:0; padding:12px 13px; border:1px solid var(--border); border-radius:11px; background:var(--bg-secondary); color:var(--text-primary); font:inherit; font-size:13px; outline:none; }
                #restart-academic-page .ac-field textarea { resize:vertical; line-height:1.55; }
                #restart-academic-page .ac-field input:focus, #restart-academic-page .ac-field select:focus, #restart-academic-page .ac-field textarea:focus { border-color:var(--accent); }
                #restart-academic-page .ac-form-actions { display:flex; align-items:center; flex-wrap:wrap; gap:12px; margin-top:16px; }
                #restart-academic-page .ac-form-status { color:var(--red); font-size:12px; }
                #restart-academic-page .ac-toolbar { display:flex; align-items:center; justify-content:space-between; gap:14px; margin-bottom:16px; }
                #restart-academic-page .ac-toolbar h2 { font-size:19px; }
                #restart-academic-page .ac-search { width:min(300px,100%); padding:10px 12px; border:1px solid var(--border); border-radius:10px; background:var(--bg-secondary); color:var(--text-primary); font:inherit; font-size:12px; }
                #restart-academic-page .ac-filter-row { display:grid; gap:12px; margin-bottom:15px; }
                #restart-academic-page .ac-filter-chips { display:flex; flex-wrap:wrap; gap:7px; }
                #restart-academic-page .ac-filter-chip { padding:8px 12px; border:1px solid var(--border); border-radius:30px; background:transparent; color:var(--text-secondary); font-size:11px; }
                #restart-academic-page .ac-filter-chip.active { background:var(--accent-soft); border-color:transparent; color:var(--accent); font-weight:700; }
                #restart-academic-page .ac-extra-filters { display:flex; gap:9px; }
                #restart-academic-page .ac-filter-select { max-width:220px; padding:9px 11px; font-size:12px; }
                #restart-academic-page .ac-task-list { display:grid; gap:10px; }
                #restart-academic-page .ac-task-card { display:flex; align-items:flex-start; gap:13px; padding:16px; border:1px solid var(--border); border-radius:13px; background:var(--bg-secondary); transition:border-color .2s ease, opacity .2s ease; }
                #restart-academic-page .ac-task-card:target { border-color:var(--accent); }
                #restart-academic-page .ac-task-card.is-complete { opacity:.7; }
                #restart-academic-page .ac-task-check { padding-top:2px; }
                #restart-academic-page .ac-check-button { width:22px; height:22px; border:1.5px solid var(--text-muted); border-radius:7px; background:transparent; color:#10251a; font-weight:800; }
                #restart-academic-page .ac-check-button:hover { border-color:var(--accent); }
                #restart-academic-page .ac-check-button.is-checked, #restart-academic-page .ac-task-check.is-checked .ac-check-button { background:var(--accent); border-color:var(--accent); }
                #restart-academic-page .ac-task-main { flex:1; min-width:0; }
                #restart-academic-page .ac-task-topline { display:flex; flex-wrap:wrap; align-items:center; gap:7px; margin-bottom:5px; }
                #restart-academic-page .ac-task-type { color:var(--text-muted); font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.6px; }
                #restart-academic-page .ac-priority { padding:3px 7px; border-radius:20px; font-size:10px; font-weight:650; }
                #restart-academic-page .priority-high { background:rgba(229,141,141,.13); color:var(--red); }
                #restart-academic-page .priority-medium { background:rgba(233,183,139,.13); color:var(--orange); }
                #restart-academic-page .priority-low { background:rgba(145,188,233,.13); color:var(--blue); }
                #restart-academic-page .ac-task-card h3 { font-size:14px; font-weight:700; overflow-wrap:anywhere; }
                #restart-academic-page .ac-task-card.is-complete h3 { text-decoration:line-through; }
                #restart-academic-page .ac-task-meta { display:flex; flex-wrap:wrap; gap:7px 12px; margin-top:7px; color:var(--text-muted); font-size:11px; }
                #restart-academic-page .ac-task-notes { margin-top:9px; color:var(--text-secondary); font-size:12px; line-height:1.55; white-space:pre-wrap; overflow-wrap:anywhere; }
                #restart-academic-page .ac-task-actions { display:flex; gap:6px; }
                #restart-academic-page .ac-icon-action { width:34px; height:34px; padding:0; display:grid; place-items:center; font-size:15px; }
                #restart-academic-page .ac-empty-state { padding:38px 16px; text-align:center; }
                #restart-academic-page .ac-empty-icon { color:var(--accent); font-size:28px; margin-bottom:10px; }
                #restart-academic-page .ac-empty-state strong { display:block; font-size:14px; }
                #restart-academic-page .ac-empty-state p { margin-top:6px; color:var(--text-muted); font-size:12px; }
                @media(max-width:900px) { #restart-academic-page .ac-stats { grid-template-columns:repeat(2,minmax(0,1fr)); } }
                @media(max-width:620px) {
                    #restart-academic-page .ac-page-heading { align-items:flex-start; flex-direction:column; }
                    #restart-academic-page .ac-suggestion { align-items:flex-start; flex-wrap:wrap; }
                    #restart-academic-page .ac-suggestion-meta { width:100%; align-items:flex-start; flex-direction:row; justify-content:space-between; }
                    #restart-academic-page .ac-form-grid { grid-template-columns:1fr; }
                    #restart-academic-page .ac-field-wide { grid-column:auto; }
                    #restart-academic-page .ac-toolbar { align-items:flex-start; flex-direction:column; }
                    #restart-academic-page .ac-search { width:100%; }
                    #restart-academic-page .ac-extra-filters { flex-wrap:wrap; }
                    #restart-academic-page .ac-filter-select { flex:1; max-width:none; }
                    #restart-academic-page .ac-task-card { gap:9px; padding:12px; }
                    #restart-academic-page .ac-task-actions { flex-direction:column; }
                    #restart-academic-page .ac-stat-card { padding:15px; }
                }
            </style>

            <section class="page-heading ac-page-heading">
                <div>
                    <h1>${escapeHTML(tx("Academic Assistant", "Trợ lý học tập"))}</h1>
                    <p>${escapeHTML(tx("Keep assignments, exams and study priorities in one place. Turn deadlines into a clear next step.", "Quản lý bài tập, bài kiểm tra và ưu tiên học tập tại một nơi. Biến hạn chót thành bước tiếp theo rõ ràng."))}</p>
                </div>
                <button type="button" class="primary-button" id="academic-add-task">＋ ${escapeHTML(tx("Add task", "Thêm nhiệm vụ"))}</button>
            </section>

            <section class="ac-stats">${renderStats(tasks)}</section>
            ${renderSuggestion(tasks)}
            ${renderTaskForm(editingTask)}

            <section class="card" id="academic-task-section">
                <div class="ac-toolbar">
                    <div>
                        <div class="ac-eyebrow">${escapeHTML(tx("ACADEMIC WORKSPACE", "KHÔNG GIAN HỌC TẬP"))}</div>
                        <h2>${escapeHTML(tx("Tasks & deadlines", "Nhiệm vụ và hạn chót"))}</h2>
                    </div>
                    <input id="academic-search" class="ac-search" type="search" value="${escapeHTML(searchQuery)}" placeholder="${escapeHTML(tx("Search tasks or subjects...", "Tìm nhiệm vụ hoặc môn học..."))}" aria-label="${escapeHTML(tx("Search tasks", "Tìm nhiệm vụ"))}">
                </div>
                ${renderFilters(tasks)}
                <div class="ac-task-list" id="academic-task-list">${renderTaskList(tasks)}</div>
            </section>
        </section>
    `;
}

// ==========================================
// PAGE EVENTS
// ==========================================

function refreshAcademicPage() {
    const content = document.querySelector(".page-content");
    if (!content) return;
    content.innerHTML = renderAcademicPage();
    bindAcademicPage();
}

function openTaskForm(id = null) {
    editingTaskId = id;
    showTaskForm = true;
    refreshAcademicPage();
    document.querySelector("#academic-form-card")?.scrollIntoView({ behavior: "smooth", block: "start" });
    document.querySelector("#academic-title")?.focus();
}

function bindTaskForm() {
    const form = document.querySelector("#academic-task-form");
    const cancel = document.querySelector("#academic-form-cancel");

    form?.addEventListener("submit", event => {
        event.preventDefault();
        const data = {
            id: editingTaskId || undefined,
            title: document.querySelector("#academic-title")?.value || "",
            subject: document.querySelector("#academic-subject")?.value || "",
            type: document.querySelector("#academic-type")?.value || "other",
            priority: document.querySelector("#academic-priority")?.value || "medium",
            status: document.querySelector("#academic-status")?.value || "todo",
            dueDate: document.querySelector("#academic-due-date")?.value || "",
            estimateMinutes: Number(document.querySelector("#academic-estimate")?.value),
            notes: document.querySelector("#academic-notes")?.value || ""
        };

        try {
            saveAcademicTask(data);
            editingTaskId = null;
            showTaskForm = false;
            refreshAcademicPage();
        } catch (error) {
            const status = document.querySelector("#academic-form-status");
            if (status) status.textContent = error.message || tx("Could not save this task.", "Không thể lưu nhiệm vụ này.");
        }
    });

    cancel?.addEventListener("click", () => {
        editingTaskId = null;
        showTaskForm = false;
        refreshAcademicPage();
    });
}

function bindTaskActions() {
    const root = document.querySelector("#restart-academic-page");
    if (!root || root.dataset.actionsBound === "true") return;
    root.dataset.actionsBound = "true";

    root.addEventListener("click", event => {
        const toggle = event.target.closest("[data-toggle-task]");
        const edit = event.target.closest("[data-edit-task]");
        const remove = event.target.closest("[data-delete-task]");
        const view = event.target.closest("[data-view-task]");

        if (toggle) {
            const task = getAcademicTasks().find(item => item.id === toggle.dataset.toggleTask);
            if (!task) return;
            try {
                saveAcademicTask({ ...task, status: task.status === "done" ? "todo" : "done" });
                refreshAcademicPage();
            } catch (error) {
                alert(error.message);
            }
            return;
        }

        if (edit) {
            openTaskForm(edit.dataset.editTask);
            return;
        }

        if (remove) {
            const confirmed = window.confirm(tx(
                "Delete this academic task? This cannot be undone.",
                "Xóa nhiệm vụ học tập này? Thao tác này không thể hoàn tác."
            ));
            if (!confirmed) return;
            try {
                deleteAcademicTask(remove.dataset.deleteTask);
                refreshAcademicPage();
            } catch (error) {
                alert(error.message || tx("Could not delete this task.", "Không thể xóa nhiệm vụ này."));
            }
            return;
        }

        if (view) {
            const id = view.dataset.viewTask;
            activeFilter = "all";
            activeTypeFilter = "all";
            subjectFilter = "all";
            searchQuery = "";
            refreshAcademicPage();
            const card = document.querySelector(`[data-task-card="${CSS.escape(id)}"]`);
            card?.scrollIntoView({ behavior: "smooth", block: "center" });
            card?.classList.add("ac-highlight");
        }
    });
}

function bindFilters() {
    document.querySelectorAll("[data-filter]").forEach(button => {
        button.addEventListener("click", () => {
            activeFilter = button.dataset.filter || "active";
            refreshAcademicPage();
        });
    });

    document.querySelector("#academic-type-filter")?.addEventListener("change", event => {
        activeTypeFilter = event.target.value;
        refreshAcademicPage();
    });

    document.querySelector("#academic-subject-filter")?.addEventListener("change", event => {
        subjectFilter = event.target.value;
        refreshAcademicPage();
    });

    document.querySelector("#academic-search")?.addEventListener("input", event => {
        searchQuery = event.target.value;
        const list = document.querySelector("#academic-task-list");
        if (list) list.innerHTML = renderTaskList(getAcademicTasks());
    });
}

export function bindAcademicPage() {
    document.querySelector("#academic-add-task")?.addEventListener("click", () => openTaskForm());
    bindTaskForm();
    bindTaskActions();
    bindFilters();
}
