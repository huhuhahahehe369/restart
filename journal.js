
// ==========================================
// RE:START M08 - PERSONAL COMPANION
// M08.1 Daily Journal + M08.2 Personal Memory
// Energy is estimated automatically from mood.
// Storage uses the existing restart-data-v1 database.
// ==========================================

const DATABASE_KEY = "restart-data-v1";

const MOODS = [
    { id: "bright", emoji: "☀️", en: "Great", vi: "Rất tốt", energy: 5 },
    { id: "good", emoji: "🙂", en: "Good", vi: "Tốt", energy: 4 },
    { id: "neutral", emoji: "😐", en: "Okay", vi: "Bình thường", energy: 3 },
    { id: "stressed", emoji: "🌧️", en: "Stressed", vi: "Căng thẳng", energy: 2 },
    { id: "tired", emoji: "😴", en: "Tired", vi: "Mệt mỏi", energy: 1 }
];

const VALID_MOODS = MOODS.map(mood => mood.id);

const MEMORY_CATEGORIES = [
    { id: "preference", en: "Preferences", vi: "Sở thích" },
    { id: "habit", en: "Habits", vi: "Thói quen" },
    { id: "goal", en: "Goals", vi: "Mục tiêu" },
    { id: "study", en: "Study", vi: "Học tập" },
    { id: "personal", en: "Personal", vi: "Cá nhân" },
    { id: "other", en: "Other", vi: "Khác" }
];

const VALID_MEMORY_CATEGORIES = MEMORY_CATEGORIES.map(item => item.id);

let selectedDate = getDateKey(new Date());
let draftMood = "neutral";
let activeTab = "journal";
let memoryEditingId = null;
let memorySearch = "";
let memoryFilter = "all";

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

function getDateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function parseDateKey(value) {
    const [year, month, day] = String(value).split("-").map(Number);
    return new Date(year, month - 1, day, 12, 0, 0, 0);
}

function formatDate(value, options = {}) {
    return parseDateKey(value).toLocaleDateString(getLocale(), {
        weekday: options.weekday ? "long" : undefined,
        day: "numeric",
        month: "long",
        year: options.year ? "numeric" : undefined
    });
}

function formatMonth(date) {
    return date.toLocaleDateString(getLocale(), {
        month: "long",
        year: "numeric"
    });
}

function formatTimestamp(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return tx("Unknown date", "Không rõ thời gian");
    }
    return date.toLocaleDateString(getLocale(), {
        day: "numeric",
        month: "short",
        year: "numeric"
    });
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

function createId(prefix = "record") {
    if (globalThis.crypto?.randomUUID) {
        return globalThis.crypto.randomUUID();
    }
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getMood(moodId) {
    return MOODS.find(mood => mood.id === moodId) || MOODS[2];
}

function getEnergyForMood(moodId) {
    return getMood(moodId).energy;
}

function getEnergyLabel(value) {
    const labels = {
        1: tx("Very low", "Rất thấp"),
        2: tx("Low", "Thấp"),
        3: tx("Moderate", "Trung bình"),
        4: tx("High", "Cao"),
        5: tx("Very high", "Rất cao")
    };
    return labels[value] || labels[3];
}

// ==========================================
// SHARED DATABASE ACCESS
// ==========================================

function readJournalDatabase() {
    const raw = localStorage.getItem(DATABASE_KEY);
    if (!raw) {
        throw new Error("RE:START storage was not initialized. Please reload the app.");
    }

    let database;
    try {
        database = JSON.parse(raw);
    } catch (error) {
        console.error("Could not parse RE:START database:", error);
        throw new Error("RE:START data is unreadable. Your saved data has not been changed.");
    }

    if (!database || typeof database !== "object" || !database.settings) {
        throw new Error("RE:START data is unreadable. Your saved data has not been changed.");
    }

    if (!Array.isArray(database.journal)) {
        database.journal = [];
    }

    return database;
}

function writeJournalDatabase(database) {
    database.meta = database.meta || {};
    database.meta.updatedAt = new Date().toISOString();

    try {
        localStorage.setItem(DATABASE_KEY, JSON.stringify(database));
    } catch (error) {
        console.error("Could not save RE:START journal data:", error);
        throw new Error("Could not save data. Browser storage may be full.");
    }
}

// ==========================================
// M08.1 - DAILY JOURNAL STORAGE
// ==========================================

function normalizeJournalEntry(entry) {
    if (!entry || typeof entry !== "object") return null;
    if (entry.recordType === "memory") return null;
    if (typeof entry.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) return null;
    if (!VALID_MOODS.includes(entry.mood)) return null;

    const now = new Date().toISOString();

    return {
        id: typeof entry.id === "string" && entry.id ? entry.id : createId("journal"),
        date: entry.date,
        mood: entry.mood,
        energy: getEnergyForMood(entry.mood),
        note: String(entry.note || "").slice(0, 5000),
        createdAt: typeof entry.createdAt === "string" ? entry.createdAt : now,
        updatedAt: typeof entry.updatedAt === "string" ? entry.updatedAt : now
    };
}

function getJournalEntries() {
    const database = readJournalDatabase();
    return database.journal
        .map(normalizeJournalEntry)
        .filter(Boolean)
        .sort((a, b) => b.date.localeCompare(a.date));
}

function getJournalEntryForDate(date) {
    return getJournalEntries().find(entry => entry.date === date) || null;
}

function saveJournalEntry(data) {
    if (typeof data.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(data.date)) {
        throw new Error("Please choose a valid date.");
    }
    if (!VALID_MOODS.includes(data.mood)) {
        throw new Error("Please choose a mood.");
    }

    const database = readJournalDatabase();
    const existingIndex = database.journal.findIndex(item =>
        item?.recordType !== "memory" && item?.date === data.date
    );
    const existing = existingIndex >= 0
        ? normalizeJournalEntry(database.journal[existingIndex])
        : null;
    const now = new Date().toISOString();

    const saved = {
        id: existing?.id || createId("journal"),
        date: data.date,
        mood: data.mood,
        energy: getEnergyForMood(data.mood),
        note: String(data.note || "").trim().slice(0, 5000),
        createdAt: existing?.createdAt || now,
        updatedAt: now
    };

    if (existingIndex >= 0) {
        database.journal[existingIndex] = saved;
    } else {
        if (database.journal.length >= 10000) {
            throw new Error("The personal journal has reached its storage limit.");
        }
        database.journal.push(saved);
    }

    writeJournalDatabase(database);
    return saved;
}

function deleteJournalEntry(date) {
    const database = readJournalDatabase();
    const previousLength = database.journal.length;

    database.journal = database.journal.filter(item =>
        !(item?.recordType !== "memory" && item?.date === date)
    );

    if (database.journal.length !== previousLength) {
        writeJournalDatabase(database);
        return true;
    }
    return false;
}

// ==========================================
// M08.2 - PERSONAL MEMORY STORAGE
// ==========================================

function normalizeMemoryItem(item) {
    if (!item || typeof item !== "object" || item.recordType !== "memory") return null;
    if (!VALID_MEMORY_CATEGORIES.includes(item.category)) return null;

    const title = String(item.title || "").trim().slice(0, 100);
    const content = String(item.content || "").trim().slice(0, 3000);
    if (!title || !content) return null;

    const now = new Date().toISOString();

    return {
        recordType: "memory",
        id: typeof item.id === "string" && item.id ? item.id : createId("memory"),
        category: item.category,
        title,
        content,
        pinned: item.pinned === true,
        createdAt: typeof item.createdAt === "string" ? item.createdAt : now,
        updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : now
    };
}

function getMemoryItems() {
    const database = readJournalDatabase();
    return database.journal
        .filter(item => item?.recordType === "memory")
        .map(normalizeMemoryItem)
        .filter(Boolean)
        .sort((a, b) => {
            if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
            return new Date(b.updatedAt) - new Date(a.updatedAt);
        });
}

function saveMemoryItem(data) {
    const title = String(data.title || "").trim();
    const content = String(data.content || "").trim();

    if (!title) throw new Error("Please enter a memory title.");
    if (title.length > 100) throw new Error("The title cannot exceed 100 characters.");
    if (!content) throw new Error("Please enter the information to remember.");
    if (content.length > 3000) throw new Error("The memory cannot exceed 3000 characters.");
    if (!VALID_MEMORY_CATEGORIES.includes(data.category)) {
        throw new Error("Please choose a valid memory category.");
    }

    const database = readJournalDatabase();
    const existingIndex = database.journal.findIndex(item =>
        item?.recordType === "memory" && item?.id === data.id
    );
    const existing = existingIndex >= 0
        ? normalizeMemoryItem(database.journal[existingIndex])
        : null;
    const now = new Date().toISOString();

    const saved = {
        recordType: "memory",
        id: existing?.id || createId("memory"),
        category: data.category,
        title,
        content,
        pinned: data.pinned === undefined ? existing?.pinned === true : data.pinned === true,
        createdAt: existing?.createdAt || now,
        updatedAt: now
    };

    if (existingIndex >= 0) {
        database.journal[existingIndex] = saved;
    } else {
        const memoryCount = database.journal.filter(item => item?.recordType === "memory").length;
        if (memoryCount >= 1000) throw new Error("You have reached the 1000-memory limit.");
        if (database.journal.length >= 10000) throw new Error("The personal data storage limit has been reached.");
        database.journal.push(saved);
    }

    writeJournalDatabase(database);
    return saved;
}

function deleteMemoryItem(id) {
    const database = readJournalDatabase();
    const previousLength = database.journal.length;

    database.journal = database.journal.filter(item =>
        !(item?.recordType === "memory" && item?.id === id)
    );

    if (database.journal.length !== previousLength) {
        writeJournalDatabase(database);
        return true;
    }
    return false;
}

function toggleMemoryPin(id) {
    const database = readJournalDatabase();
    const item = database.journal.find(record =>
        record?.recordType === "memory" && record?.id === id
    );

    if (!item) return false;

    item.pinned = item.pinned !== true;
    item.updatedAt = new Date().toISOString();
    writeJournalDatabase(database);
    return true;
}

// ==========================================
// MOOD & ENERGY PRESENTATION
// ==========================================

function renderMoodChoices(currentMood) {
    return MOODS.map(mood => `
        <button
            type="button"
            class="restart-mood-choice ${currentMood === mood.id ? "active" : ""}"
            data-mood="${mood.id}"
            aria-pressed="${currentMood === mood.id}"
        >
            <span class="restart-mood-emoji">${mood.emoji}</span>
            <span>${escapeHTML(tx(mood.en, mood.vi))}</span>
        </button>
    `).join("");
}

function renderEnergyIndicator(moodId) {
    const energy = getEnergyForMood(moodId);

    return `
        <div class="restart-energy-card" aria-live="polite">
            <div class="restart-energy-heading">
                <span>${escapeHTML(tx("Estimated energy level", "Mức năng lượng ước tính"))}</span>
                <strong>${energy}/5 · ${escapeHTML(getEnergyLabel(energy))}</strong>
            </div>
            <div class="restart-energy-dots" aria-label="${energy} out of 5">
                ${[1, 2, 3, 4, 5].map(level => `
                    <span class="restart-energy-dot ${level <= energy ? "filled" : ""}"></span>
                `).join("")}
            </div>
            <p>${escapeHTML(tx("Automatically estimated from the selected mood, not a medical measurement.", "Tự động ước tính từ tâm trạng đã chọn, không phải phép đo y tế."))}</p>
        </div>
    `;
}

// ==========================================
// JOURNAL HISTORY & SUMMARY
// ==========================================

function renderJournalHistory(entries) {
    if (!entries.length) {
        return `
            <div class="restart-empty-state">
                <div class="restart-empty-icon">✎</div>
                <strong>${escapeHTML(tx("Your story starts here", "Hành trình của Cún bắt đầu từ đây"))}</strong>
                <p>${escapeHTML(tx("Save your first daily check-in. Your entries stay on this device.", "Hãy lưu bản ghi đầu tiên. Nhật ký được giữ trên thiết bị này."))}</p>
            </div>
        `;
    }

    return entries.slice(0, 30).map(entry => {
        const mood = getMood(entry.mood);
        const preview = entry.note.trim()
            ? entry.note.trim().slice(0, 160)
            : tx("No written note for this day.", "Ngày này chưa có ghi chú.");

        return `
            <button type="button" class="restart-history-entry ${entry.date === selectedDate ? "active" : ""}" data-open-entry="${entry.date}">
                <span class="restart-history-mood">${mood.emoji}</span>
                <span class="restart-history-copy">
                    <strong>${escapeHTML(formatDate(entry.date, { year: true }))}</strong>
                    <small>${escapeHTML(tx(mood.en, mood.vi))} · ${escapeHTML(tx("Energy", "Năng lượng"))} ${entry.energy}/5</small>
                    <span>${escapeHTML(preview)}</span>
                </span>
                <span class="restart-history-arrow">›</span>
            </button>
        `;
    }).join("");
}

function getMonthSummary(entries) {
    const now = new Date();
    const prefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-`;
    const monthEntries = entries.filter(entry => entry.date.startsWith(prefix));
    const averageEnergy = monthEntries.length
        ? monthEntries.reduce((total, entry) => total + entry.energy, 0) / monthEntries.length
        : 0;
    const moodCounts = {};

    for (const entry of monthEntries) {
        moodCounts[entry.mood] = (moodCounts[entry.mood] || 0) + 1;
    }

    const topMoodId = Object.entries(moodCounts).sort((a, b) => b[1] - a[1])[0]?.[0];

    return {
        count: monthEntries.length,
        averageEnergy,
        topMood: topMoodId ? getMood(topMoodId) : null
    };
}

// ==========================================
// MEMORY PRESENTATION
// ==========================================

function getCategory(category) {
    return MEMORY_CATEGORIES.find(item => item.id === category) || MEMORY_CATEGORIES[5];
}

function getCategoryLabel(category) {
    const item = getCategory(category);
    return tx(item.en, item.vi);
}

function renderMemoryCategoryOptions(selected = "preference") {
    return MEMORY_CATEGORIES.map(category => `
        <option value="${category.id}" ${selected === category.id ? "selected" : ""}>
            ${escapeHTML(tx(category.en, category.vi))}
        </option>
    `).join("");
}

function getFilteredMemoryItems() {
    const query = memorySearch.trim().toLocaleLowerCase();

    return getMemoryItems().filter(item => {
        const categoryMatches = memoryFilter === "all" || item.category === memoryFilter;
        const searchableText = `${item.title} ${item.content} ${item.category}`.toLocaleLowerCase();
        return categoryMatches && (!query || searchableText.includes(query));
    });
}

function renderMemoryCards(items) {
    if (!items.length) {
        return `
            <div class="restart-empty-state">
                <div class="restart-empty-icon">⌂</div>
                <strong>${escapeHTML(tx("Nothing saved yet", "Chưa có thông tin nào được lưu"))}</strong>
                <p>${escapeHTML(tx("Save useful details that you want RE:START to keep available on this device.", "Lưu những thông tin hữu ích mà Cún muốn RE:START giữ lại trên thiết bị này."))}</p>
            </div>
        `;
    }

    return items.map(item => `
        <article class="restart-memory-card">
            <div class="restart-memory-card-top">
                <div class="restart-memory-category">${escapeHTML(getCategoryLabel(item.category))}</div>
                <div class="restart-memory-actions">
                    <button type="button" class="restart-memory-icon-button" data-pin-memory="${escapeHTML(item.id)}"
                        aria-label="${escapeHTML(item.pinned ? tx("Unpin memory", "Bỏ ghim ghi nhớ") : tx("Pin memory", "Ghim ghi nhớ"))}">
                        ${item.pinned ? "★" : "☆"}
                    </button>
                    <button type="button" class="restart-memory-text-button" data-edit-memory="${escapeHTML(item.id)}">${escapeHTML(tx("Edit", "Sửa"))}</button>
                    <button type="button" class="restart-memory-text-button danger" data-delete-memory="${escapeHTML(item.id)}">${escapeHTML(tx("Delete", "Xóa"))}</button>
                </div>
            </div>
            <h3>${escapeHTML(item.title)}</h3>
            <p class="restart-memory-content">${escapeHTML(item.content)}</p>
            <div class="restart-memory-date">${escapeHTML(tx("Updated", "Cập nhật"))}: ${escapeHTML(formatTimestamp(item.updatedAt))}</div>
        </article>
    `).join("");
}

function renderMemoryEditor() {
    if (!memoryEditingId) return "";

    const editing = memoryEditingId === "new"
        ? null
        : getMemoryItems().find(item => item.id === memoryEditingId) || null;

    return `
        <form id="restart-memory-form" class="restart-memory-editor">
            <div class="restart-editor-heading">
                <div>
                    <div class="restart-eyebrow">${escapeHTML(tx("PERSONAL MEMORY", "GHI NHỚ CÁ NHÂN"))}</div>
                    <h3>${escapeHTML(editing ? tx("Edit memory", "Chỉnh sửa ghi nhớ") : tx("Add a memory", "Thêm ghi nhớ mới"))}</h3>
                </div>
            </div>

            <label class="restart-memory-field">
                <span>${escapeHTML(tx("Title", "Tiêu đề"))}</span>
                <input id="restart-memory-title" class="subject-select" type="text" maxlength="100" required
                    value="${escapeHTML(editing?.title || "")}"
                    placeholder="${escapeHTML(tx("e.g. I prefer studying in the evening", "Ví dụ: Cún thích học vào buổi tối"))}">
            </label>

            <label class="restart-memory-field">
                <span>${escapeHTML(tx("Category", "Danh mục"))}</span>
                <select id="restart-memory-category" class="subject-select">
                    ${renderMemoryCategoryOptions(editing?.category || "preference")}
                </select>
            </label>

            <label class="restart-memory-field">
                <span>${escapeHTML(tx("What should RE:START remember?", "Cún muốn RE:START ghi nhớ điều gì?"))}</span>
                <textarea id="restart-memory-content" class="restart-memory-textarea" maxlength="3000" required
                    placeholder="${escapeHTML(tx("Write the detail you want to keep...", "Viết thông tin mà Cún muốn lưu lại..."))}">${escapeHTML(editing?.content || "")}</textarea>
                <small>${escapeHTML(tx("Only save information you are comfortable keeping in this browser.", "Chỉ lưu thông tin mà Cún cảm thấy thoải mái khi giữ trong trình duyệt này."))}</small>
            </label>

            <div class="restart-memory-editor-actions">
                <button type="submit" class="primary-button">${escapeHTML(tx("Save memory", "Lưu ghi nhớ"))}</button>
                <button type="button" class="secondary-button" id="restart-memory-cancel">${escapeHTML(tx("Cancel", "Hủy"))}</button>
            </div>
            <p class="restart-memory-status" id="restart-memory-status" role="status" aria-live="polite"></p>
        </form>
    `;
}

function renderMemoryView() {
    const items = getFilteredMemoryItems();
    const allItems = getMemoryItems();

    return `
        <section class="card">
            <div class="restart-memory-header">
                <div>
                    <div class="restart-eyebrow">${escapeHTML(tx("M08.2 · PERSONAL MEMORY", "M08.2 · GHI NHỚ CÁ NHÂN"))}</div>
                    <h2>${escapeHTML(tx("What should RE:START remember?", "Cún muốn RE:START ghi nhớ điều gì?"))}</h2>
                    <p>${escapeHTML(tx("Keep preferences, habits, goals and useful personal notes in one place. These memories stay on this device and can be managed at any time.", "Lưu sở thích, thói quen, mục tiêu và ghi chú cá nhân tại một nơi. Những ghi nhớ này nằm trên thiết bị và có thể được quản lý bất cứ lúc nào."))}</p>
                </div>
                <div class="restart-memory-count">
                    <strong>${allItems.length}</strong>
                    <span>${escapeHTML(tx("saved memories", "ghi nhớ đã lưu"))}</span>
                </div>
            </div>

            <div class="restart-memory-toolbar">
                <input id="restart-memory-search" class="subject-select" type="search"
                    value="${escapeHTML(memorySearch)}"
                    placeholder="${escapeHTML(tx("Search your memories...", "Tìm trong các ghi nhớ..."))}"
                    aria-label="${escapeHTML(tx("Search memories", "Tìm ghi nhớ"))}">
                <select id="restart-memory-filter" class="subject-select" aria-label="${escapeHTML(tx("Filter memories", "Lọc ghi nhớ"))}">
                    <option value="all" ${memoryFilter === "all" ? "selected" : ""}>${escapeHTML(tx("All categories", "Tất cả danh mục"))}</option>
                    ${renderMemoryCategoryOptions(memoryFilter === "all" ? "" : memoryFilter)}
                </select>
                <button type="button" class="primary-button" id="restart-memory-add">＋ ${escapeHTML(tx("Add memory", "Thêm ghi nhớ"))}</button>
            </div>

            ${renderMemoryEditor()}
            <div class="restart-memory-list" id="restart-memory-list">${renderMemoryCards(items)}</div>
            <p class="restart-memory-privacy">${escapeHTML(tx("Personal Memory is a local notebook, not an AI connection. The assistant will only be able to use these notes after an AI service is connected in a later step.", "Ghi nhớ cá nhân hiện là sổ ghi chú lưu trên thiết bị, chưa phải kết nối AI. Trợ lý chỉ có thể sử dụng các ghi chú này sau khi được kết nối với dịch vụ AI ở bước sau."))}</p>
        </section>
    `;
}

// ==========================================
// JOURNAL VIEW
// ==========================================

function renderJournalView() {
    const entries = getJournalEntries();
    const entry = getJournalEntryForDate(selectedDate);
    const summary = getMonthSummary(entries);
    const today = getDateKey(new Date());

    draftMood = entry?.mood || "neutral";

    return `
        <div class="restart-companion-layout">
            <section class="card">
                <div class="restart-card-heading">
                    <div class="restart-eyebrow">${escapeHTML(tx("DAILY CHECK-IN", "GHI NHẬN HẰNG NGÀY"))}</div>
                    <h2>${escapeHTML(tx("How are you feeling today?", "Hôm nay Cún cảm thấy thế nào?"))}</h2>
                    <p>${escapeHTML(tx("There is no right or wrong answer. Just choose what feels closest.", "Không có câu trả lời đúng hay sai. Chỉ cần chọn điều gần với cảm nhận của Cún nhất."))}</p>
                </div>

                <div class="restart-date-row">
                    <label for="restart-journal-date">${escapeHTML(tx("Entry date", "Ngày ghi nhận"))}</label>
                    <input class="restart-date-input" id="restart-journal-date" type="date" value="${selectedDate}" max="${today}">
                </div>

                <form id="restart-journal-form">
                    <div class="restart-eyebrow">${escapeHTML(tx("MOOD", "TÂM TRẠNG"))}</div>
                    <div class="restart-mood-grid" id="restart-mood-grid">${renderMoodChoices(draftMood)}</div>
                    <div id="restart-energy-indicator">${renderEnergyIndicator(draftMood)}</div>

                    <label class="restart-note-label" for="restart-journal-note">${escapeHTML(tx("What's on your mind?", "Điều gì đang ở trong suy nghĩ của Cún?"))}</label>
                    <textarea class="restart-note-input" id="restart-journal-note" maxlength="5000"
                        placeholder="${escapeHTML(tx("Write about your day, something you learned, a small win, or anything you want to remember...", "Hãy viết về ngày hôm nay, điều Cún học được, một niềm vui nhỏ hoặc bất cứ điều gì Cún muốn lưu giữ..."))}">${escapeHTML(entry?.note || "")}</textarea>

                    <div class="restart-form-actions">
                        <button type="submit" class="primary-button">${escapeHTML(entry ? tx("Update entry", "Cập nhật ghi chú") : tx("Save check-in", "Lưu ghi nhận"))}</button>
                        ${entry ? `<button type="button" class="secondary-button restart-delete" id="restart-journal-delete">${escapeHTML(tx("Delete entry", "Xóa ghi nhận"))}</button>` : ""}
                    </div>
                    <p class="restart-status" id="restart-journal-status" role="status" aria-live="polite"></p>
                </form>
            </section>

            <aside class="card">
                <div class="restart-card-heading">
                    <div class="restart-eyebrow">${escapeHTML(tx("MONTHLY REFLECTION", "NHÌN LẠI THÁNG NÀY"))}</div>
                    <h2>${escapeHTML(formatMonth(new Date()))}</h2>
                    <p>${escapeHTML(tx("A gentle overview of the days you chose to check in.", "Tổng quan về những ngày Cún đã ghi nhận."))}</p>
                </div>
                <div class="restart-companion-summary">
                    <div class="restart-summary-item">
                        <span>${escapeHTML(tx("Days checked in", "Số ngày đã ghi nhận"))}</span>
                        <strong>${summary.count}</strong>
                        <div class="restart-summary-note">${escapeHTML(tx("This month", "Trong tháng này"))}</div>
                    </div>
                    <div class="restart-summary-item">
                        <span>${escapeHTML(tx("Average energy", "Năng lượng trung bình"))}</span>
                        <strong>${summary.count ? `${summary.averageEnergy.toFixed(1)}/5` : "–"}</strong>
                        <div class="restart-summary-note">${escapeHTML(tx("Estimated from selected moods", "Ước tính từ tâm trạng đã chọn"))}</div>
                    </div>
                    <div class="restart-summary-item">
                        <span>${escapeHTML(tx("Most recorded mood", "Tâm trạng được ghi nhận nhiều nhất"))}</span>
                        <strong style="font-size:20px;">${summary.topMood ? `${summary.topMood.emoji} ${escapeHTML(tx(summary.topMood.en, summary.topMood.vi))}` : "–"}</strong>
                        <div class="restart-summary-note">${escapeHTML(tx("A count, not a judgement", "Chỉ là thống kê, không phải đánh giá"))}</div>
                    </div>
                </div>
            </aside>
        </div>

        <section class="card">
            <div class="restart-card-heading">
                <div class="restart-eyebrow">${escapeHTML(tx("YOUR JOURNAL", "NHẬT KÝ CỦA CÚN"))}</div>
                <h2>${escapeHTML(tx("Recent check-ins", "Những ghi nhận gần đây"))}</h2>
                <p>${escapeHTML(tx("Your latest 30 entries. Select one to review or update it.", "30 ghi nhận gần nhất. Chọn một ngày để xem lại hoặc chỉnh sửa."))}</p>
            </div>
            <div class="restart-history-list" id="restart-journal-history">${renderJournalHistory(entries)}</div>
        </section>
    `;
}

// ==========================================
// PUBLIC PAGE RENDER
// ==========================================

export function renderJournalPage() {
    return `
        <section id="restart-journal-page">
            <style>
                #restart-journal-page { display:grid; gap:20px; }
                #restart-journal-page .restart-companion-top p { color:var(--text-secondary); margin-top:7px; max-width:680px; }
                #restart-journal-page .restart-companion-tabs { display:flex; gap:8px; flex-wrap:wrap; padding:5px; border:1px solid var(--border); border-radius:13px; background:var(--bg-secondary); width:max-content; max-width:100%; }
                #restart-journal-page .restart-tab { padding:10px 16px; border-radius:9px; background:transparent; color:var(--text-secondary); font:inherit; font-size:12px; font-weight:650; }
                #restart-journal-page .restart-tab.active { background:var(--accent-soft); color:var(--accent); }
                #restart-journal-page .restart-companion-layout { display:grid; grid-template-columns:minmax(0,1.35fr) minmax(250px,.8fr); gap:20px; align-items:start; }
                #restart-journal-page .restart-eyebrow { color:var(--accent); font-size:11px; font-weight:750; letter-spacing:1.4px; margin-bottom:7px; }
                #restart-journal-page .restart-card-heading { margin-bottom:16px; }
                #restart-journal-page .restart-card-heading h2 { font-size:19px; }
                #restart-journal-page .restart-card-heading p { color:var(--text-muted); font-size:12px; margin-top:5px; line-height:1.5; }
                #restart-journal-page .restart-date-row { display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom:19px; }
                #restart-journal-page .restart-date-row label { color:var(--text-secondary); font-size:12px; }
                #restart-journal-page .restart-date-input { padding:9px 11px; border:1px solid var(--border); border-radius:10px; background:var(--bg-secondary); color:var(--text-primary); font:inherit; }
                #restart-journal-page .restart-mood-grid { display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); gap:8px; margin:10px 0 16px; }
                #restart-journal-page .restart-mood-choice { min-width:0; padding:12px 5px; display:grid; justify-items:center; gap:7px; border:1px solid var(--border); border-radius:12px; background:var(--bg-secondary); color:var(--text-secondary); font:inherit; font-size:11px; }
                #restart-journal-page .restart-mood-choice.active { border-color:var(--accent); background:var(--accent-soft); color:var(--text-primary); }
                #restart-journal-page .restart-mood-emoji { font-size:23px; }
                #restart-journal-page .restart-energy-card { padding:13px 14px; border:1px solid var(--border); border-radius:12px; background:var(--bg-secondary); }
                #restart-journal-page .restart-energy-heading { display:flex; justify-content:space-between; align-items:center; gap:10px; color:var(--text-secondary); font-size:12px; }
                #restart-journal-page .restart-energy-heading strong { color:var(--accent); white-space:nowrap; }
                #restart-journal-page .restart-energy-dots { display:grid; grid-template-columns:repeat(5,1fr); gap:6px; margin-top:11px; }
                #restart-journal-page .restart-energy-dot { height:7px; border-radius:20px; background:var(--bg-hover); }
                #restart-journal-page .restart-energy-dot.filled { background:var(--accent); }
                #restart-journal-page .restart-energy-card p { margin-top:8px; color:var(--text-muted); font-size:10px; }
                #restart-journal-page .restart-note-label { display:block; color:var(--text-secondary); font-size:12px; margin:22px 0 8px; }
                #restart-journal-page .restart-note-input, #restart-journal-page .restart-memory-textarea { width:100%; min-height:155px; resize:vertical; padding:13px; border:1px solid var(--border); border-radius:11px; background:var(--bg-secondary); color:var(--text-primary); font:inherit; line-height:1.65; }
                #restart-journal-page .restart-form-actions { display:flex; gap:9px; align-items:center; flex-wrap:wrap; margin-top:15px; }
                #restart-journal-page .restart-form-actions button { padding:10px 17px; }
                #restart-journal-page .restart-delete { margin-left:auto; color:var(--red); }
                #restart-journal-page .restart-companion-summary { display:grid; gap:10px; }
                #restart-journal-page .restart-summary-item { padding:15px; border:1px solid var(--border); border-radius:13px; background:var(--bg-secondary); }
                #restart-journal-page .restart-summary-item span { display:block; color:var(--text-muted); font-size:11px; }
                #restart-journal-page .restart-summary-item strong { display:block; margin-top:5px; font-size:23px; }
                #restart-journal-page .restart-summary-note { color:var(--text-muted); font-size:11px; line-height:1.5; margin-top:5px; }
                #restart-journal-page .restart-history-list { display:grid; gap:8px; }
                #restart-journal-page .restart-history-entry { width:100%; display:flex; align-items:center; gap:12px; padding:13px; text-align:left; border:1px solid var(--border); border-radius:12px; background:var(--bg-secondary); color:var(--text-primary); }
                #restart-journal-page .restart-history-entry.active { border-color:var(--accent); background:var(--accent-soft); }
                #restart-journal-page .restart-history-mood { width:38px; height:38px; flex:0 0 38px; display:grid; place-items:center; border-radius:11px; background:var(--bg-hover); font-size:20px; }
                #restart-journal-page .restart-history-copy { min-width:0; flex:1; display:grid; gap:3px; }
                #restart-journal-page .restart-history-copy strong { font-size:12px; }
                #restart-journal-page .restart-history-copy small { color:var(--accent); font-size:10px; }
                #restart-journal-page .restart-history-copy > span { color:var(--text-muted); font-size:11px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
                #restart-journal-page .restart-history-arrow { color:var(--text-muted); font-size:20px; }
                #restart-journal-page .restart-empty-state { padding:28px 15px; border:1px dashed var(--border); border-radius:13px; text-align:center; color:var(--text-secondary); }
                #restart-journal-page .restart-empty-icon { color:var(--accent); font-size:28px; margin-bottom:7px; }
                #restart-journal-page .restart-empty-state p { max-width:430px; margin:6px auto 0; color:var(--text-muted); font-size:12px; line-height:1.5; }
                #restart-journal-page .restart-status, #restart-journal-page .restart-memory-status { min-height:18px; color:var(--accent); font-size:12px; }
                #restart-journal-page .restart-memory-header { display:flex; justify-content:space-between; align-items:flex-start; gap:18px; flex-wrap:wrap; }
                #restart-journal-page .restart-memory-header h2 { font-size:20px; }
                #restart-journal-page .restart-memory-header p { max-width:700px; color:var(--text-secondary); font-size:12px; line-height:1.6; margin-top:7px; }
                #restart-journal-page .restart-memory-count { min-width:105px; padding:12px 15px; border:1px solid var(--border); border-radius:12px; background:var(--bg-secondary); text-align:center; }
                #restart-journal-page .restart-memory-count strong { display:block; font-size:24px; }
                #restart-journal-page .restart-memory-count span { display:block; color:var(--text-muted); font-size:10px; }
                #restart-journal-page .restart-memory-toolbar { display:grid; grid-template-columns:minmax(160px,1fr) minmax(130px,.7fr) auto; gap:9px; margin:20px 0 14px; }
                #restart-journal-page .restart-memory-toolbar .subject-select { min-width:0; }
                #restart-journal-page .restart-memory-toolbar button { white-space:nowrap; padding:10px 14px; }
                #restart-journal-page .restart-memory-list { display:grid; grid-template-columns:repeat(auto-fit,minmax(250px,1fr)); gap:12px; margin-top:16px; }
                #restart-journal-page .restart-memory-card { min-width:0; padding:16px; border:1px solid var(--border); border-radius:14px; background:var(--bg-secondary); }
                #restart-journal-page .restart-memory-card-top { display:flex; align-items:center; justify-content:space-between; gap:9px; }
                #restart-journal-page .restart-memory-category { color:var(--accent); font-size:10px; font-weight:750; letter-spacing:1px; text-transform:uppercase; }
                #restart-journal-page .restart-memory-actions { display:flex; align-items:center; gap:5px; }
                #restart-journal-page .restart-memory-icon-button, #restart-journal-page .restart-memory-text-button { padding:5px 7px; border-radius:7px; background:var(--bg-hover); color:var(--text-secondary); font:inherit; font-size:10px; }
                #restart-journal-page .restart-memory-icon-button { font-size:16px; color:var(--accent); }
                #restart-journal-page .restart-memory-text-button.danger { color:var(--red); }
                #restart-journal-page .restart-memory-card h3 { margin:12px 0 8px; font-size:15px; overflow-wrap:anywhere; }
                #restart-journal-page .restart-memory-content { color:var(--text-secondary); font-size:12px; line-height:1.65; white-space:pre-wrap; overflow-wrap:anywhere; }
                #restart-journal-page .restart-memory-date { margin-top:14px; color:var(--text-muted); font-size:10px; }
                #restart-journal-page .restart-memory-editor { display:grid; gap:13px; padding:17px; border:1px solid var(--border); border-radius:13px; background:var(--bg-secondary); margin-top:14px; }
                #restart-journal-page .restart-editor-heading h3 { font-size:17px; }
                #restart-journal-page .restart-memory-field { display:grid; gap:7px; color:var(--text-secondary); font-size:12px; }
                #restart-journal-page .restart-memory-field small { color:var(--text-muted); line-height:1.5; }
                #restart-journal-page .restart-memory-editor-actions { display:flex; gap:9px; flex-wrap:wrap; }
                #restart-journal-page .restart-memory-editor-actions button { padding:10px 16px; }
                #restart-journal-page .restart-memory-privacy { margin-top:17px; color:var(--text-muted); font-size:11px; line-height:1.6; }
                @media(max-width:900px) { #restart-journal-page .restart-companion-layout { grid-template-columns:1fr; } }
                @media(max-width:600px) {
                    #restart-journal-page .restart-mood-grid { gap:4px; }
                    #restart-journal-page .restart-mood-choice { padding:10px 2px; font-size:9px; }
                    #restart-journal-page .restart-mood-emoji { font-size:20px; }
                    #restart-journal-page .restart-memory-toolbar { grid-template-columns:1fr; }
                    #restart-journal-page .restart-energy-heading { align-items:flex-start; flex-direction:column; }
                }
            </style>

            <section class="page-heading restart-companion-top">
                <div>
                    <h1>${escapeHTML(tx("Personal Companion", "Người bạn đồng hành"))}</h1>
                    <p>${escapeHTML(tx("A quiet space to check in, put thoughts into words and keep the details that matter to you.", "Một góc nhỏ để ghi nhận cảm xúc, viết suy nghĩ và lưu giữ những điều quan trọng với Cún."))}</p>
                </div>
            </section>

            <div class="restart-companion-tabs" role="tablist" aria-label="Personal Companion sections">
                <button type="button" class="restart-tab ${activeTab === "journal" ? "active" : ""}" data-companion-tab="journal" role="tab" aria-selected="${activeTab === "journal"}">✎ ${escapeHTML(tx("Daily Journal", "Nhật ký hằng ngày"))}</button>
                <button type="button" class="restart-tab ${activeTab === "memory" ? "active" : ""}" data-companion-tab="memory" role="tab" aria-selected="${activeTab === "memory"}">⌂ ${escapeHTML(tx("Personal Memory", "Ghi nhớ cá nhân"))}</button>
            </div>

            ${activeTab === "journal" ? renderJournalView() : renderMemoryView()}
        </section>
    `;
}

// ==========================================
// PAGE REFRESH & JOURNAL EVENTS
// ==========================================

function refreshJournalPage() {
    const content = document.querySelector(".page-content");
    if (!content) return;
    content.innerHTML = renderJournalPage();
    bindJournalPage();
}

function loadSelectedDate(date) {
    selectedDate = date;
    const entry = getJournalEntryForDate(selectedDate);
    draftMood = entry?.mood || "neutral";
}

function bindJournalTab() {
    const dateInput = document.querySelector("#restart-journal-date");
    const moodGrid = document.querySelector("#restart-mood-grid");
    const form = document.querySelector("#restart-journal-form");
    const deleteButton = document.querySelector("#restart-journal-delete");
    const history = document.querySelector("#restart-journal-history");

    dateInput?.addEventListener("change", () => {
        const value = dateInput.value;
        const today = getDateKey(new Date());
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value > today) return;
        loadSelectedDate(value);
        refreshJournalPage();
    });

    moodGrid?.addEventListener("click", event => {
        const button = event.target.closest("[data-mood]");
        if (!button || !VALID_MOODS.includes(button.dataset.mood)) return;

        draftMood = button.dataset.mood;

        moodGrid.querySelectorAll("[data-mood]").forEach(item => {
            const active = item.dataset.mood === draftMood;
            item.classList.toggle("active", active);
            item.setAttribute("aria-pressed", String(active));
        });

        const energyIndicator = document.querySelector("#restart-energy-indicator");
        if (energyIndicator) {
            energyIndicator.innerHTML = renderEnergyIndicator(draftMood);
        }
    });

    form?.addEventListener("submit", event => {
        event.preventDefault();
        const note = document.querySelector("#restart-journal-note")?.value || "";

        try {
            saveJournalEntry({ date: selectedDate, mood: draftMood, note });
            refreshJournalPage();
            const status = document.querySelector("#restart-journal-status");
            if (status) status.textContent = tx("Your check-in has been saved.", "Đã lưu ghi nhận của Cún.");
        } catch (error) {
            const status = document.querySelector("#restart-journal-status");
            if (status) status.textContent = error.message || tx("Could not save this entry.", "Không thể lưu ghi nhận này.");
        }
    });

    deleteButton?.addEventListener("click", () => {
        const confirmed = window.confirm(tx(
            "Delete this day's journal entry? This cannot be undone.",
            "Xóa ghi nhận của ngày này? Thao tác này không thể hoàn tác."
        ));
        if (!confirmed) return;

        try {
            deleteJournalEntry(selectedDate);
            loadSelectedDate(selectedDate);
            refreshJournalPage();
            const status = document.querySelector("#restart-journal-status");
            if (status) status.textContent = tx("Entry deleted.", "Đã xóa ghi nhận.");
        } catch (error) {
            const status = document.querySelector("#restart-journal-status");
            if (status) status.textContent = error.message || tx("Could not delete this entry.", "Không thể xóa ghi nhận này.");
        }
    });

    history?.addEventListener("click", event => {
        const button = event.target.closest("[data-open-entry]");
        if (!button) return;
        loadSelectedDate(button.dataset.openEntry);
        refreshJournalPage();
    });
}

// ==========================================
// MEMORY EVENTS
// ==========================================

function openMemoryEditor(id = null) {
    memoryEditingId = id || "new";
    refreshJournalPage();
    document.querySelector("#restart-memory-title")?.focus();
    document.querySelector("#restart-memory-form")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function bindMemoryCardActions() {
    const list = document.querySelector("#restart-memory-list");
    if (!list || list.dataset.bound === "true") return;
    list.dataset.bound = "true";

    list.addEventListener("click", event => {
        const editButton = event.target.closest("[data-edit-memory]");
        const deleteButton = event.target.closest("[data-delete-memory]");
        const pinButton = event.target.closest("[data-pin-memory]");

        if (editButton) {
            openMemoryEditor(editButton.dataset.editMemory);
            return;
        }

        if (deleteButton) {
            const confirmed = window.confirm(tx(
                "Delete this saved memory? This cannot be undone.",
                "Xóa ghi nhớ này? Thao tác này không thể hoàn tác."
            ));
            if (!confirmed) return;

            try {
                deleteMemoryItem(deleteButton.dataset.deleteMemory);
                memoryEditingId = null;
                refreshJournalPage();
            } catch (error) {
                alert(error.message || tx("Could not delete this memory.", "Không thể xóa ghi nhớ này."));
            }
            return;
        }

        if (pinButton) {
            try {
                toggleMemoryPin(pinButton.dataset.pinMemory);
                refreshJournalPage();
            } catch (error) {
                alert(error.message || tx("Could not update this memory.", "Không thể cập nhật ghi nhớ này."));
            }
        }
    });
}

function bindMemoryTab() {
    const addButton = document.querySelector("#restart-memory-add");
    const searchInput = document.querySelector("#restart-memory-search");
    const filterSelect = document.querySelector("#restart-memory-filter");
    const form = document.querySelector("#restart-memory-form");
    const cancelButton = document.querySelector("#restart-memory-cancel");

    addButton?.addEventListener("click", () => openMemoryEditor());

    searchInput?.addEventListener("input", () => {
        memorySearch = searchInput.value;
        const listElement = document.querySelector("#restart-memory-list");
        if (listElement) {
            listElement.innerHTML = renderMemoryCards(getFilteredMemoryItems());
        }
    });

    filterSelect?.addEventListener("change", () => {
        memoryFilter = filterSelect.value;
        refreshJournalPage();
    });

    form?.addEventListener("submit", event => {
        event.preventDefault();
        const title = document.querySelector("#restart-memory-title")?.value || "";
        const category = document.querySelector("#restart-memory-category")?.value || "preference";
        const content = document.querySelector("#restart-memory-content")?.value || "";

        try {
            saveMemoryItem({
                id: memoryEditingId === "new" ? undefined : memoryEditingId,
                title,
                category,
                content
            });
            memoryEditingId = null;
            refreshJournalPage();
        } catch (error) {
            const status = document.querySelector("#restart-memory-status");
            if (status) status.textContent = error.message || tx("Could not save this memory.", "Không thể lưu ghi nhớ này.");
        }
    });

    cancelButton?.addEventListener("click", () => {
        memoryEditingId = null;
        refreshJournalPage();
    });

    bindMemoryCardActions();
}

// ==========================================
// PUBLIC EVENT BINDING
// ==========================================

export function bindJournalPage() {
    document.querySelectorAll("[data-companion-tab]").forEach(button => {
        button.addEventListener("click", () => {
            activeTab = button.dataset.companionTab === "memory" ? "memory" : "journal";
            memoryEditingId = null;
            refreshJournalPage();
        });
    });

    if (activeTab === "journal") {
        bindJournalTab();
    } else {
        bindMemoryTab();
    }
}
