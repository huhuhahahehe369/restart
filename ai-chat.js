// ==========================================
// RE:START M08.4 - AI CHAT
// Frontend for a private OpenAI Responses API gateway.
// API secrets remain on the backend, never in this file.
// User documents are indexed in an OpenAI vector store.
// Conversation history remains in this browser.
// ==========================================

const DATABASE_KEY = "restart-data-v1";
const CONFIG_KEY = "restart-ai-connection-v1";
const SESSION_PASSWORD_KEY = "restart-ai-session-password-v1";
const CHAT_KEY = "restart-ai-chat-v1";
const FILES_KEY = "restart-ai-knowledge-files-v1";
const VECTOR_KEY = "restart-ai-vector-store-v1";
const CHAT_OPTIONS_KEY = "restart-ai-chat-options-v1";

const MAX_CHAT_MESSAGES = 80;
const MAX_CONTEXT_CHARS = 18000;
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

const SUPPORTED_EXTENSIONS = [
    "pdf", "doc", "docx", "pptx", "txt", "md", "csv", "json",
    "html", "css", "js", "ts", "py", "c", "cpp", "cs", "go",
    "java", "php", "rb", "sh", "tex"
];

const savedMessages = loadJSON(CHAT_KEY, []);
const savedKnowledgeFiles = loadJSON(FILES_KEY, []);
const savedChatOptionsValue = loadJSON(CHAT_OPTIONS_KEY, {});
const savedChatOptions = savedChatOptionsValue && typeof savedChatOptionsValue === "object"
    ? savedChatOptionsValue
    : {};

let messages = Array.isArray(savedMessages)
    ? savedMessages.filter(item => item && ["user", "assistant"].includes(item.role) && typeof item.content === "string")
    : [];
let knowledgeFiles = Array.isArray(savedKnowledgeFiles)
    ? savedKnowledgeFiles.filter(item => item && typeof item.id === "string" && typeof item.name === "string")
    : [];
let chatOptions = {
    includeStudyData: savedChatOptions.includeStudyData === true,
    includeWellbeingData: savedChatOptions.includeWellbeingData === true,
    includePersonalMemory: savedChatOptions.includePersonalMemory === true,
    mode: savedChatOptions.mode === "deep" ? "deep" : "balanced"
};

let isSending = false;
let isUploading = false;
let connectionOpen = false;
let noticeText = "";
let noticeType = "info";

// ==========================================
// STORAGE & LANGUAGE HELPERS
// ==========================================

function loadJSON(key, fallback) {
    try {
        const value = localStorage.getItem(key);
        return value ? JSON.parse(value) : fallback;
    } catch (error) {
        console.warn(`Could not read ${key}:`, error);
        return fallback;
    }
}

function saveJSON(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
    } catch (error) {
        console.error(`Could not save ${key}:`, error);
        setNotice(
            tx("Browser storage is full. Some local data could not be saved.", "Bộ nhớ trình duyệt đã đầy. Một số dữ liệu cục bộ chưa thể lưu."),
            "error"
        );
        return false;
    }
}

function getLanguage() {
    try {
        const database = loadJSON(DATABASE_KEY, {});
        const language = database?.settings?.language;
        return ["en", "vi", "bi"].includes(language) ? language : "en";
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
    return `chat-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function setNotice(message, type = "info") {
    noticeText = message;
    noticeType = type;
}

function getConfig() {
    const savedValue = loadJSON(CONFIG_KEY, { endpoint: "" });
    const saved = savedValue && typeof savedValue === "object"
        ? savedValue
        : { endpoint: "" };
    let accessPassword = "";

    try {
        accessPassword = sessionStorage.getItem(SESSION_PASSWORD_KEY) || "";

        // One-time migration from the earlier M08.4 build, which stored
        // the app password in localStorage. Keep it only for this session.
        if (!accessPassword && saved.accessPassword) {
            accessPassword = String(saved.accessPassword);
            sessionStorage.setItem(SESSION_PASSWORD_KEY, accessPassword);
            saveJSON(CONFIG_KEY, { endpoint: saved.endpoint || "" });
        }
    } catch (error) {
        console.warn("Session storage is unavailable:", error);
    }

    return {
        endpoint: String(saved.endpoint || ""),
        accessPassword
    };
}

function getVectorStoreId() {
    return localStorage.getItem(VECTOR_KEY) || "";
}

function getDateKey(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function parseDateKey(value) {
    const parts = String(value || "").split("-").map(Number);
    if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
    return new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0, 0);
}

function shiftDateKey(key, amount) {
    const date = parseDateKey(key);
    if (!date) return key;
    date.setDate(date.getDate() + amount);
    return getDateKey(date);
}

function formatDate(value) {
    const date = parseDateKey(value);
    if (!date) return value || "";
    return date.toLocaleDateString(
        getLanguage() === "vi" ? "vi-VN" : "en-US",
        { day: "numeric", month: "short", year: "numeric" }
    );
}

function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ==========================================
// RE:START DATA CONTEXT
// ==========================================

function buildAppContext(includeStudyData = false, includeWellbeingData = false, includePersonalMemory = false) {
    const database = loadJSON(DATABASE_KEY, null);

    if (!database || typeof database !== "object") {
        return "No RE:START database is available.";
    }

    const today = getDateKey();
    const start = shiftDateKey(today, -29);
    const daysMap = database.study?.days || {};

    const study = {
        totalSeconds: 0,
        activeDays: 0,
        focusSessions: 0,
        subjects: {}
    };

    let cursor = start;

    while (cursor <= today) {
        const day = daysMap[cursor];
        if (day && typeof day === "object") {
            const bySubject = day.studySeconds && typeof day.studySeconds === "object"
                ? day.studySeconds
                : {};

            let dayTotal = 0;

            for (const [subject, rawSeconds] of Object.entries(bySubject)) {
                const seconds = Number(rawSeconds);
                if (!Number.isFinite(seconds) || seconds <= 0) continue;
                study.subjects[subject] = (study.subjects[subject] || 0) + seconds;
                dayTotal += seconds;
            }

            // Derive from session records only if subject summaries are missing.
            if (dayTotal === 0 && Array.isArray(day.sessions)) {
                for (const session of day.sessions) {
                    if (!session || session.type === "break") continue;
                    const subject = String(session.subject || "").trim();
                    const seconds = Number(session.seconds);
                    if (!subject || !Number.isFinite(seconds) || seconds <= 0) continue;
                    study.subjects[subject] = (study.subjects[subject] || 0) + seconds;
                    dayTotal += seconds;
                }
            }

            study.totalSeconds += dayTotal;
            if (dayTotal > 0) study.activeDays += 1;

            if (Array.isArray(day.sessions) && day.sessions.length) {
                study.focusSessions += day.sessions.filter(session =>
                    session && session.type !== "break" && Number(session.seconds) > 0
                ).length;
            } else {
                study.focusSessions += Math.max(0, Number(day.completedSessions) || 0);
            }
        }

        cursor = shiftDateKey(cursor, 1);
    }

    const sleepRecords = (Array.isArray(database.sleep?.records)
        ? database.sleep.records
        : []).filter(record => {
            const date = new Date(record?.wakeTime || record?.bedtime);
            if (Number.isNaN(date.getTime())) return false;
            const key = getDateKey(date);
            return key >= start && key <= today;
        });

    const mainSleep = sleepRecords.filter(record => record.type !== "nap");
    const naps = sleepRecords.filter(record => record.type === "nap");

    const sleepMinutes = record => {
        const stored = Number(record.durationMinutes);
        if (Number.isFinite(stored) && stored > 0) return stored;
        const from = new Date(record.bedtime);
        const to = new Date(record.wakeTime);
        const difference = (to - from) / 60000;
        return difference > 0 && difference <= 1440 ? difference : 0;
    };

    const avgMainSleepMinutes = mainSleep.length
        ? mainSleep.reduce((sum, item) => sum + sleepMinutes(item), 0) / mainSleep.length
        : null;

    const journalEntries = (Array.isArray(database.journal)
        ? database.journal
        : []).filter(item => {
            if (!item || item.recordType) return false;
            if (!item.date || item.date < start || item.date > today) return false;
            return ["bright", "good", "neutral", "stressed", "tired"].includes(item.mood);
        });

    const moodCounts = {};
    for (const entry of journalEntries) {
        moodCounts[entry.mood] = (moodCounts[entry.mood] || 0) + 1;
    }

    const tasks = (Array.isArray(database.journal)
        ? database.journal
        : []).filter(item => item?.recordType === "academic_task");

    const todayTasks = tasks.filter(task => task.status !== "done");
    const overdueTasks = todayTasks.filter(task =>
        typeof task.dueDate === "string" && task.dueDate && task.dueDate < today
    );

    const goals = (Array.isArray(database.goals) ? database.goals : []).map(goal => ({
        title: goal.title,
        metric: goal.metric,
        targetValue: goal.targetValue,
        period: goal.period,
        subject: goal.subject || ""
    }));

    const context = {
        coverage: { from: start, to: today },
        study: {
            totalStudyHours: Number((study.totalSeconds / 3600).toFixed(2)),
            activeStudyDays: study.activeDays,
            focusSessions: study.focusSessions,
            timeBySubjectHours: Object.fromEntries(
                Object.entries(study.subjects).map(([subject, seconds]) => [
                    subject,
                    Number((seconds / 3600).toFixed(2))
                ])
            )
        },
        sleep: {
            mainSleepRecords: mainSleep.length,
            napRecords: naps.length,
            averageMainSleepHours: avgMainSleepMinutes === null
                ? null
                : Number((avgMainSleepMinutes / 60).toFixed(2))
        },
        journalMood: {
            checkIns: journalEntries.length,
            counts: moodCounts,
            note: "Only mood counts are included. Journal note text is not sent."
        },
        academic: {
            totalTasks: tasks.length,
            openTasks: todayTasks.length,
            overdueTasks: overdueTasks.length,
            upcomingTasks: todayTasks
                .filter(task => task.dueDate && task.dueDate >= today)
                .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
                .slice(0, 20)
                .map(task => ({
                    title: task.title,
                    subject: task.subject,
                    type: task.type,
                    priority: task.priority,
                    status: task.status,
                    dueDate: task.dueDate
                }))
        },
        goals
    };

    // Explicitly include only the data categories the user enabled.
    // Study/task metrics and wellbeing summaries use separate consent switches.
    if (!includeStudyData) {
        delete context.study;
        delete context.academic;
        delete context.goals;
    }

    if (!includeWellbeingData) {
        delete context.sleep;
        delete context.journalMood;
    }

    if (includePersonalMemory) {
        context.personalMemory = (Array.isArray(database.journal)
            ? database.journal
            : [])
            .filter(item => item?.recordType === "memory")
            .slice(0, 30)
            .map(item => ({
                category: item.category,
                title: item.title,
                content: String(item.content || "").slice(0, 700)
            }));
    }

    if (!includeStudyData && !includeWellbeingData && !includePersonalMemory) {
        return JSON.stringify({
            note: "No RE:START personal data was shared for this message."
        });
    }

    let serialized = JSON.stringify(context, null, 2);

    if (serialized.length > MAX_CONTEXT_CHARS) {
        if (context.personalMemory) delete context.personalMemory;
        if (context.academic?.upcomingTasks) {
            context.academic.upcomingTasks = context.academic.upcomingTasks.slice(0, 8);
        }
        serialized = JSON.stringify(context, null, 2);
    }

    return serialized.slice(0, MAX_CONTEXT_CHARS);
}

// ==========================================
// SAFE MESSAGE MARKDOWN
// ==========================================

function renderMarkdown(value) {
    let text = escapeHTML(value);

    const codeBlocks = [];
    text = text.replace(/```([\w+-]*)\n?([\s\S]*?)```/g, (_, language, code) => {
        const index = codeBlocks.length;
        codeBlocks.push(
            `<pre class="ai-chat-code"><code>${code.replace(/\n$/, "")}</code></pre>`
        );
        return `%%CODEBLOCK_${index}%%`;
    });

    text = text.replace(/`([^`]+)`/g, "<code>$1</code>");
    text = text.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    text = text.replace(/(^|\s)\*(.+?)\*(?=\s|$)/g, "$1<em>$2</em>");
    text = text.replace(/^### (.+)$/gm, "<h4>$1</h4>");
    text = text.replace(/^## (.+)$/gm, "<h3>$1</h3>");
    text = text.replace(/^# (.+)$/gm, "<h2>$1</h2>");
    text = text.replace(/^\s*[-*]\s+(.+)$/gm, "<span class=\"ai-chat-list-line\">• $1</span>");
    text = text.replace(/\n/g, "<br>");

    return text.replace(/%%CODEBLOCK_(\d+)%%/g, (_, index) =>
        codeBlocks[Number(index)] || ""
    );
}

function renderMessage(message, index) {
    const isUser = message.role === "user";
    const label = isUser ? tx("You", "Người dùng") : "RE:START AI";
    const body = renderMarkdown(message.content || "");

    return `
        <article class="ai-chat-message ${isUser ? "from-user" : "from-assistant"}">
            <div class="ai-chat-avatar ${isUser ? "user-avatar" : "assistant-avatar"}">
                ${isUser ? "●" : "✧"}
            </div>
            <div class="ai-chat-message-content">
                <div class="ai-chat-message-heading">
                    <strong>${escapeHTML(label)}</strong>
                    ${!isUser ? `<button type="button" class="ai-chat-copy" data-copy-message="${index}" title="${escapeHTML(tx("Copy", "Sao chép"))}">⧉</button>` : ""}
                </div>
                <div class="ai-chat-message-body">${body}</div>
            </div>
        </article>
    `;
}
function renderKnowledgeFiles() {
    if (!knowledgeFiles.length) {
        return `
            <div class="ai-chat-no-files">
                ${escapeHTML(tx(
                    "No reference files yet. Add documents to build a searchable knowledge base.",
                    "Chưa có tài liệu tham chiếu. Thêm tài liệu để tạo kho kiến thức có thể tìm kiếm."
                ))}
            </div>
        `;
    }

    return knowledgeFiles.map(file => `
        <div class="ai-chat-file-row">
            <span class="ai-chat-file-icon">▤</span>
            <div class="ai-chat-file-info">
                <strong>${escapeHTML(file.name)}</strong>
                <small>${escapeHTML(formatBytes(file.bytes || 0))} · ${escapeHTML(file.statusLabel || tx("Indexed or indexing", "Đã gửi hoặc đang xử lý"))}</small>
            </div>
            <button type="button" class="ai-chat-file-delete" data-remove-file="${escapeHTML(file.id)}" title="${escapeHTML(tx("Remove from knowledge base", "Xóa khỏi kho kiến thức"))}">×</button>
        </div>
    `).join("");
}

function renderConnectionPanel() {
    const config = getConfig();

    return `
        <section class="ai-chat-connection ${connectionOpen ? "is-open" : ""}" id="ai-chat-connection" ${connectionOpen ? "" : "hidden"}>
            <div class="ai-chat-connection-heading">
                <div>
                    <div class="ai-chat-eyebrow">${escapeHTML(tx("SECURE CONNECTION", "KẾT NỐI AN TOÀN"))}</div>
                    <h3>${escapeHTML(tx("Connect the AI service", "Kết nối dịch vụ AI"))}</h3>
                </div>
                <button type="button" class="ai-chat-close" id="ai-chat-close-settings">×</button>
            </div>

            <label class="ai-chat-field">
                <span>${escapeHTML(tx("Worker URL", "Địa chỉ Worker"))}</span>
                <input id="ai-chat-endpoint" type="url" autocomplete="url" placeholder="https://your-worker.workers.dev" value="${escapeHTML(config.endpoint)}">
            </label>

            <label class="ai-chat-field">
                <span>${escapeHTML(tx("App access password", "Mật khẩu truy cập ứng dụng"))}</span>
                <input id="ai-chat-access-password" type="password" autocomplete="off" placeholder="${escapeHTML(tx("Enter the private app password", "Nhập mật khẩu ứng dụng riêng tư"))}" value="${escapeHTML(config.accessPassword)}">
            </label>

            <div class="ai-chat-connection-actions">
                <button type="button" class="primary-button" id="ai-chat-save-connection">${escapeHTML(tx("Save connection", "Lưu kết nối"))}</button>
                <button type="button" class="secondary-button" id="ai-chat-test-connection">${escapeHTML(tx("Test connection", "Kiểm tra kết nối"))}</button>
                <span id="ai-chat-connection-status" role="status"></span>
            </div>

            <p class="ai-chat-hint">
                ${escapeHTML(tx(
                    "The OpenAI API key belongs only in backend secrets. Never paste it here or commit it to a repository. Ask a parent or guardian to manage API account access and billing. The app password is separate.",
                    "API key OpenAI chỉ được đặt trong phần Secret của backend. Không dán key vào đây hoặc đưa lên kho mã nguồn. Hãy nhờ phụ huynh/người giám hộ quản lý tài khoản API và thanh toán. Mật khẩu ứng dụng là thông tin riêng."
                ))}
            </p>
        </section>
    `;
}

function renderComposer() {
    const sendingLabel = isSending
        ? tx("Thinking...", "Đang suy nghĩ...")
        : tx("Send", "Gửi");

    return `
        <form class="ai-chat-composer" id="ai-chat-form">
            <textarea
                id="ai-chat-input"
                rows="1"
                maxlength="12000"
                placeholder="${escapeHTML(tx("Message RE:START AI...", "Nhắn tin cho RE:START AI..."))}"
                ${isSending ? "disabled" : ""}
            ></textarea>

            <div class="ai-chat-composer-bottom">
                <div class="ai-chat-composer-tools">
                    <button type="button" class="ai-chat-tool-button" id="ai-chat-attach" ${isUploading || isSending ? "disabled" : ""}>
                        ＋ ${escapeHTML(tx("Add knowledge", "Thêm tài liệu"))}
                    </button>
                    <input type="file" id="ai-chat-file-input" multiple hidden accept=".${SUPPORTED_EXTENSIONS.join(",.")}">
                    <span>${escapeHTML(tx("PDF · DOCX · PPTX · TXT · MD · CSV · code", "PDF · DOCX · PPTX · TXT · MD · CSV · mã nguồn"))}</span>
                </div>
                <button type="submit" class="primary-button ai-chat-send" id="ai-chat-send" ${isSending || isUploading ? "disabled" : ""}>
                    ${isSending ? "◌" : "↑"} ${escapeHTML(sendingLabel)}
                </button>
            </div>
        </form>
    `;
}

function renderAIChat() {
    const mode = chatOptions.mode === "deep" ? "deep" : "balanced";
    const connected = Boolean(getConfig().endpoint && getConfig().accessPassword);

    const welcome = `
        <div class="ai-chat-welcome">
            <div class="ai-chat-welcome-mark">✧</div>
            <h2>${escapeHTML(tx("What are we working on?", "Hôm nay cần xử lý điều gì?"))}</h2>
            <p>${escapeHTML(tx(
                "Ask questions, reason through difficult problems, review your RE:START data or search documents added to the knowledge base.",
                "Đặt câu hỏi, cùng suy luận các vấn đề khó, xem lại dữ liệu RE:START hoặc tìm kiếm trong tài liệu đã thêm vào kho kiến thức."
            ))}</p>
            <div class="ai-chat-suggestions">
                <button type="button" data-chat-prompt="Analyze my study pattern over the last 30 days and suggest one realistic improvement.">${escapeHTML(tx("Analyze my study habits", "Phân tích thói quen học tập"))}</button>
                <button type="button" data-chat-prompt="Help me solve a difficult problem step by step. Explain the reasoning clearly.">${escapeHTML(tx("Work through a problem", "Giải một bài khó từng bước"))}</button>
                <button type="button" data-chat-prompt="Use the files in my knowledge base to summarize the most important ideas and make a study plan.">${escapeHTML(tx("Study my uploaded files", "Học từ tài liệu đã tải lên"))}</button>
            </div>
        </div>
    `;

    const messageHTML = messages.length
        ? messages.map(renderMessage).join("")
        : welcome;

    return `
        <section class="ai-chat-layout" id="ai-chat-root">
            <header class="ai-chat-header">
                <div class="ai-chat-title">
                    <div class="ai-chat-logo">✧</div>
                    <div>
                        <h2>RE:START AI</h2>
                        <p>${escapeHTML(tx("Personal study companion", "Trợ lý học tập cá nhân"))}</p>
                    </div>
                </div>
                <div class="ai-chat-header-actions">
                    <span class="ai-chat-connection-pill ${connected ? "connected" : "disconnected"}">
                        <i></i>${escapeHTML(connected ? tx("Connected", "Đã kết nối") : tx("Not connected", "Chưa kết nối"))}
                    </span>
                    <button type="button" class="secondary-button ai-chat-header-button" id="ai-chat-open-settings">⚙ ${escapeHTML(tx("Connect", "Kết nối"))}</button>
                    <button type="button" class="secondary-button ai-chat-header-button" id="ai-chat-export">⇩ ${escapeHTML(tx("Export", "Xuất chat"))}</button>
                    <button type="button" class="secondary-button ai-chat-header-button" id="ai-chat-new">＋ ${escapeHTML(tx("New chat", "Cuộc trò chuyện mới"))}</button>
                </div>
            </header>

            ${renderConnectionPanel()}

            <div class="ai-chat-conversation" id="ai-chat-conversation">
                <div class="ai-chat-messages" id="ai-chat-messages">
                    ${messageHTML}
                    ${isSending ? `
                        <div class="ai-chat-thinking">
                            <span></span><span></span><span></span>
                            ${escapeHTML(tx("Working through the request...", "Đang xử lý yêu cầu..."))}
                        </div>
                    ` : ""}
                </div>
            </div>

            <section class="ai-chat-knowledge card">
                <div class="ai-chat-knowledge-heading">
                    <div>
                        <div class="ai-chat-eyebrow">${escapeHTML(tx("LONG-TERM KNOWLEDGE", "KHO KIẾN THỨC DÀI HẠN"))}</div>
                        <strong>${escapeHTML(tx("Reference library", "Thư viện tài liệu"))}</strong>
                        <small>${escapeHTML(tx("Files are indexed so the AI can retrieve relevant passages when needed.", "Tài liệu được lập chỉ mục để AI tìm các đoạn liên quan khi cần."))}</small>
                    </div>
                    <span class="ai-chat-file-count">${knowledgeFiles.length}</span>
                </div>
                <div class="ai-chat-file-list">${renderKnowledgeFiles()}</div>
            </section>

            <section class="ai-chat-context-options">
                <label>
                    <input type="checkbox" id="ai-chat-include-study-data" ${chatOptions.includeStudyData ? "checked" : ""}>
                    <span>${escapeHTML(tx("Share study, tasks and goals", "Chia sẻ dữ liệu học tập, nhiệm vụ và mục tiêu"))}</span>
                </label>
                <label>
                    <input type="checkbox" id="ai-chat-include-wellbeing-data" ${chatOptions.includeWellbeingData ? "checked" : ""}>
                    <span>${escapeHTML(tx("Share sleep and mood summaries", "Chia sẻ tóm tắt giấc ngủ và tâm trạng"))}</span>
                </label>
                <label>
                    <input type="checkbox" id="ai-chat-include-memory" ${chatOptions.includePersonalMemory ? "checked" : ""}>
                    <span>${escapeHTML(tx("Include Personal Memory", "Gửi Personal Memory"))}</span>
                </label>
                <label class="ai-chat-mode-select">
                    <span>${escapeHTML(tx("Reasoning", "Suy luận"))}</span>
                    <select id="ai-chat-mode">
                        <option value="balanced" ${mode === "balanced" ? "selected" : ""}>${escapeHTML(tx("Balanced", "Cân bằng"))}</option>
                        <option value="deep" ${mode === "deep" ? "selected" : ""}>${escapeHTML(tx("Deep", "Chuyên sâu"))}</option>
                    </select>
                </label>
            </section>

            <div class="ai-chat-private-note">
                ${escapeHTML(tx(
                    "Each RE:START data category is off by default and is sent only when its own option is enabled. Journal note text is never sent. Personal Memory is a separate opt-in. Uploaded files are stored by the connected knowledge service until removed.",
                    "Mỗi nhóm dữ liệu RE:START đều tắt mặc định và chỉ được gửi khi bật tùy chọn riêng. Nội dung ghi chú nhật ký không được gửi. Personal Memory cần được bật riêng. Tài liệu tải lên được dịch vụ kho kiến thức đã kết nối lưu giữ cho đến khi bị xóa."
                ))}
            </div>

            ${knowledgeFiles.length ? "" : ""}
            ${renderComposer()}

            ${noticeText ? `<div class="ai-chat-notice ${noticeType}" role="status">${escapeHTML(noticeText)}</div>` : ""}
        </section>
    `;
}

// ==========================================
// NETWORK HELPERS
// ==========================================

function getEndpoint() {
    const config = getConfig();
    const endpoint = String(config.endpoint || "").trim().replace(/\/+$/, "");

    if (!endpoint) throw new Error(tx("Enter the Worker URL in connection settings.", "Nhập địa chỉ Worker trong phần cài đặt kết nối."));

    let url;
    try {
        url = new URL(endpoint);
    } catch {
        throw new Error(tx("The Worker URL is invalid.", "Địa chỉ Worker không hợp lệ."));
    }

    const isLocal = ["localhost", "127.0.0.1"].includes(url.hostname);
    if (url.protocol !== "https:" && !isLocal) {
        throw new Error(tx("The Worker URL must use HTTPS.", "Địa chỉ Worker phải sử dụng HTTPS."));
    }

    return endpoint;
}

async function apiRequest(path, options = {}) {
    const config = getConfig();
    if (!config.accessPassword) {
        throw new Error(tx("Enter the app access password in connection settings.", "Nhập mật khẩu ứng dụng trong phần cài đặt kết nối."));
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);

    const headers = new Headers(options.headers || {});
    headers.set("Authorization", `Bearer ${config.accessPassword}`);

    if (options.body && !(options.body instanceof FormData)) {
        headers.set("Content-Type", "application/json");
    }

    try {
        const response = await fetch(`${getEndpoint()}${path}`, {
            ...options,
            headers,
            signal: controller.signal
        });

        const payload = await response.json().catch(() => ({}));

        if (!response.ok) {
            throw new Error(
                payload.error ||
                payload.message ||
                `${tx("Request failed", "Yêu cầu thất bại")} (${response.status})`
            );
        }

        return payload;

    } catch (error) {
        if (error.name === "AbortError") {
            throw new Error(tx("The request timed out. Try again.", "Yêu cầu quá thời gian. Hãy thử lại."));
        }

        throw error;

    } finally {
        clearTimeout(timeout);
    }
}
async function ensureVectorStore() {
    let id = getVectorStoreId();
    if (id) return id;

    const result = await apiRequest("/api/knowledge/create", {
        method: "POST",
        body: JSON.stringify({ name: "RE:START Personal Knowledge" })
    });

    if (!result.vectorStoreId) {
        throw new Error(tx("The knowledge store could not be created.", "Không thể tạo kho kiến thức."));
    }

    localStorage.setItem(VECTOR_KEY, result.vectorStoreId);
    return result.vectorStoreId;
}

// ==========================================
// CHAT OPERATIONS
// ==========================================

function saveMessages() {
    messages = messages.slice(-MAX_CHAT_MESSAGES);
    saveJSON(CHAT_KEY, messages);
}

function scrollChatToBottom() {
    const conversation = document.querySelector("#ai-chat-conversation");
    if (conversation) conversation.scrollTop = conversation.scrollHeight;
}

function refreshChat() {
    const panel = document.querySelector("#ai-chat-panel");
    if (!panel) return;

    panel.innerHTML = renderAIChatPanel();
    bindAIChat();
    scrollChatToBottom();
}

function showConnectionPanel() {
    connectionOpen = true;
    refreshChat();
    document.querySelector("#ai-chat-endpoint")?.focus();
}

async function sendMessage(text) {
    const content = String(text || "").trim();
    if (!content || isSending) return;

    const config = getConfig();
    if (!config.endpoint || !config.accessPassword) {
        setNotice(tx("Connect the AI service before sending a message.", "Hãy kết nối dịch vụ AI trước khi gửi tin nhắn."), "error");
        showConnectionPanel();
        return;
    }

    chatOptions.includeStudyData = Boolean(
        document.querySelector("#ai-chat-include-study-data")?.checked ?? chatOptions.includeStudyData
    );
    chatOptions.includeWellbeingData = Boolean(
        document.querySelector("#ai-chat-include-wellbeing-data")?.checked ?? chatOptions.includeWellbeingData
    );
    chatOptions.includePersonalMemory = Boolean(
        document.querySelector("#ai-chat-include-memory")?.checked ?? chatOptions.includePersonalMemory
    );
    chatOptions.mode = document.querySelector("#ai-chat-mode")?.value || chatOptions.mode;
    saveJSON(CHAT_OPTIONS_KEY, chatOptions);

    const userMessage = {
        id: createId(),
        role: "user",
        content,
        createdAt: new Date().toISOString()
    };

    messages.push(userMessage);
    saveMessages();
    isSending = true;
    setNotice("", "info");
    refreshChat();

    try {
        const appContext = buildAppContext(
            chatOptions.includeStudyData,
            chatOptions.includeWellbeingData,
            chatOptions.includePersonalMemory
        );

        const payload = await apiRequest("/api/chat", {
            method: "POST",
            body: JSON.stringify({
                messages: messages
                    .filter(item => ["user", "assistant"].includes(item.role))
                    .slice(-24)
                    .map(item => ({
                        role: item.role,
                        content: String(item.content || "").slice(0, 10000)
                    })),
                appContext,
                vectorStoreId: getVectorStoreId(),
                mode: chatOptions.mode === "deep" ? "deep" : "balanced"
            })
        });

        const responseText = String(payload.text || "").trim();

        if (!responseText) {
            throw new Error(tx("The AI returned an empty response.", "AI trả về phản hồi trống."));
        }

        messages.push({
            id: createId(),
            role: "assistant",
            content: responseText,
            createdAt: new Date().toISOString()
        });

        saveMessages();

    } catch (error) {
        messages.push({
            id: createId(),
            role: "assistant",
            content: `${tx("Connection error", "Lỗi kết nối")}: ${error.message}`,
            createdAt: new Date().toISOString(),
            isError: true
        });
        saveMessages();

    } finally {
        isSending = false;
        refreshChat();
        document.querySelector("#ai-chat-input")?.focus();
    }
}

// ==========================================
// KNOWLEDGE FILE OPERATIONS
// ==========================================

function getExtension(filename) {
    return String(filename || "").split(".").pop().toLowerCase();
}

async function pollFileStatus(vectorStoreId, fileId) {
    const maximumAttempts = 18;

    for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
        const result = await apiRequest(
            `/api/knowledge/status?vectorStoreId=${encodeURIComponent(vectorStoreId)}&fileId=${encodeURIComponent(fileId)}`,
            { method: "GET" }
        );

        if (result.status === "completed") return "completed";
        if (result.status === "failed" || result.status === "cancelled") {
            throw new Error(result.error || tx("File indexing failed.", "Lập chỉ mục tài liệu thất bại."));
        }

        await new Promise(resolve => setTimeout(resolve, 1800));
    }

    return "in_progress";
}

async function uploadKnowledgeFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length || isUploading) return;

    const config = getConfig();
    if (!config.endpoint || !config.accessPassword) {
        showConnectionPanel();
        setNotice(tx("Connect the AI service before adding knowledge files.", "Hãy kết nối dịch vụ AI trước khi thêm tài liệu."), "error");
        refreshChat();
        return;
    }

    isUploading = true;
    setNotice(tx("Preparing knowledge upload...", "Đang chuẩn bị tải tài liệu lên..."), "info");
    refreshChat();

    try {
        const vectorStoreId = await ensureVectorStore();

        for (const file of files) {
            const extension = getExtension(file.name);

            if (!SUPPORTED_EXTENSIONS.includes(extension)) {
                throw new Error(
                    `${file.name}: ${tx("This file type is not supported.", "Định dạng tệp này chưa được hỗ trợ.")}`
                );
            }

            if (file.size <= 0 || file.size > MAX_UPLOAD_BYTES) {
                throw new Error(
                    `${file.name}: ${tx("File must be smaller than 25 MB and not empty.", "Tệp phải nhỏ hơn 25 MB và không được rỗng.")}`
                );
            }

            setNotice(
                `${tx("Uploading", "Đang tải lên")}: ${file.name}`,
                "info"
            );
            refreshChat();

            const formData = new FormData();
            formData.append("file", file, file.name);
            formData.append("vectorStoreId", vectorStoreId);

            const uploaded = await apiRequest("/api/knowledge/upload", {
                method: "POST",
                body: formData
            });

            if (!uploaded.fileId) {
                throw new Error(tx("The file service did not return a file ID.", "Dịch vụ tài liệu không trả về mã tệp."));
            }

            const metadata = {
                id: uploaded.fileId,
                name: file.name,
                bytes: file.size,
                statusLabel: tx("Indexing", "Đang lập chỉ mục")
            };

            knowledgeFiles = [
                ...knowledgeFiles.filter(item => item.id !== metadata.id),
                metadata
            ];
            saveJSON(FILES_KEY, knowledgeFiles);
            refreshChat();

            const status = await pollFileStatus(vectorStoreId, uploaded.fileId);
            metadata.statusLabel = status === "completed"
                ? tx("Ready", "Sẵn sàng")
                : tx("Indexing", "Đang lập chỉ mục");
            knowledgeFiles = knowledgeFiles.map(item =>
                item.id === metadata.id ? metadata : item
            );
            saveJSON(FILES_KEY, knowledgeFiles);
        }

        setNotice(tx("Knowledge upload complete.", "Đã tải tài liệu vào kho kiến thức."), "success");

    } catch (error) {
        setNotice(error.message || tx("Could not upload the files.", "Không thể tải tài liệu lên."), "error");

    } finally {
        isUploading = false;
        refreshChat();
    }
}

async function removeKnowledgeFile(fileId) {
    const file = knowledgeFiles.find(item => item.id === fileId);
    if (!file) return;

    const confirmed = window.confirm(tx(
        `Remove "${file.name}" from the AI knowledge base? The remote file will also be deleted.`,
        `Xóa "${file.name}" khỏi kho kiến thức AI? Tệp lưu trên máy chủ cũng sẽ bị xóa.`
    ));

    if (!confirmed) return;

    const vectorStoreId = getVectorStoreId();
    if (!vectorStoreId) return;

    try {
        await apiRequest("/api/knowledge/delete", {
            method: "POST",
            body: JSON.stringify({
                vectorStoreId,
                fileId
            })
        });

        knowledgeFiles = knowledgeFiles.filter(item => item.id !== fileId);
        saveJSON(FILES_KEY, knowledgeFiles);
        setNotice(tx("File removed from the knowledge base.", "Đã xóa tài liệu khỏi kho kiến thức."), "success");

    } catch (error) {
        setNotice(error.message || tx("Could not remove the file.", "Không thể xóa tài liệu."), "error");

    } finally {
        refreshChat();
    }
}
// ==========================================
// CONNECTION SETTINGS
// ==========================================

function normalizeEndpoint(value) {
    return String(value || "").trim().replace(/\/+$/, "");
}

function saveConnection() {
    const endpoint = normalizeEndpoint(
        document.querySelector("#ai-chat-endpoint")?.value
    );

    const accessPassword = String(
        document.querySelector("#ai-chat-access-password")?.value || ""
    ).trim();

    if (!endpoint || !accessPassword) {
        const status = document.querySelector("#ai-chat-connection-status");
        if (status) status.textContent = tx("Both fields are required.", "Cần nhập cả hai trường.");
        return;
    }

    try {
        const parsed = new URL(endpoint);
        const isLocal = ["localhost", "127.0.0.1"].includes(parsed.hostname);

        if (parsed.protocol !== "https:" && !isLocal) {
            throw new Error(tx("Use an HTTPS Worker URL.", "Hãy dùng địa chỉ Worker HTTPS."));
        }

        saveJSON(CONFIG_KEY, { endpoint });
        sessionStorage.setItem(SESSION_PASSWORD_KEY, accessPassword);
        setNotice(tx("Connection saved. The password will be kept for this browser session only.", "Đã lưu kết nối. Mật khẩu chỉ được giữ trong phiên trình duyệt hiện tại."), "success");
        connectionOpen = true;
        refreshChat();

    } catch (error) {
        const status = document.querySelector("#ai-chat-connection-status");
        if (status) status.textContent = error.message || tx("Invalid URL.", "Địa chỉ không hợp lệ.");
    }
}

async function testConnection() {
    const endpoint = normalizeEndpoint(
        document.querySelector("#ai-chat-endpoint")?.value
    );
    const accessPassword = String(
        document.querySelector("#ai-chat-access-password")?.value || ""
    ).trim();

    const status = document.querySelector("#ai-chat-connection-status");

    if (!endpoint || !accessPassword) {
        if (status) status.textContent = tx("Enter both fields first.", "Hãy nhập cả hai trường trước.");
        return;
    }

    try {
        const parsed = new URL(endpoint);
        const isLocal = ["localhost", "127.0.0.1"].includes(parsed.hostname);
        if (parsed.protocol !== "https:" && !isLocal) {
            throw new Error(tx("Use an HTTPS Worker URL.", "Hãy dùng địa chỉ Worker HTTPS."));
        }

        if (status) status.textContent = tx("Testing...", "Đang kiểm tra...");

        const response = await fetch(`${endpoint}/api/health`, {
            method: "GET",
            headers: { Authorization: `Bearer ${accessPassword}` }
        });

        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);

        if (status) status.textContent = tx("Connection successful.", "Kết nối thành công.");

    } catch (error) {
        if (status) status.textContent = error.message || tx("Connection failed.", "Kết nối thất bại.");
    }
}

// ==========================================
// CHAT EXPORT
// ==========================================

function exportChat() {
    if (!messages.length) return;

    const markdown = messages.map(message => {
        const title = message.role === "user" ? "User" : "RE:START AI";
        return `## ${title}\n\n${message.content || ""}`;
    }).join("\n\n---\n\n");

    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `restart-ai-chat-${getDateKey()}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
}

// ==========================================
// EVENT BINDING
// ==========================================

export function bindAIChat() {
    const panel = document.querySelector("#ai-chat-root");
    if (!panel || panel.dataset.bound === "true") return;
    panel.dataset.bound = "true";

    document.querySelector("#ai-chat-open-settings")?.addEventListener("click", () => {
        connectionOpen = !connectionOpen;
        refreshChat();
    });

    document.querySelector("#ai-chat-close-settings")?.addEventListener("click", () => {
        connectionOpen = false;
        refreshChat();
    });

    document.querySelector("#ai-chat-save-connection")?.addEventListener("click", saveConnection);
    document.querySelector("#ai-chat-test-connection")?.addEventListener("click", testConnection);

    document.querySelector("#ai-chat-new")?.addEventListener("click", () => {
        if (messages.length && !window.confirm(tx(
            "Start a new chat? The current conversation will be cleared from this browser.",
            "Bắt đầu cuộc trò chuyện mới? Nội dung hiện tại sẽ bị xóa khỏi trình duyệt này."
        ))) return;

        messages = [];
        saveMessages();
        setNotice("", "info");
        refreshChat();
    });

    document.querySelector("#ai-chat-export")?.addEventListener("click", exportChat);

    document.querySelector("#ai-chat-form")?.addEventListener("submit", event => {
        event.preventDefault();
        const input = document.querySelector("#ai-chat-input");
        const value = input?.value || "";
        if (input) input.value = "";
        sendMessage(value);
    });

    const input = document.querySelector("#ai-chat-input");
    input?.addEventListener("keydown", event => {
        if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            document.querySelector("#ai-chat-form")?.requestSubmit();
        }
    });

    input?.addEventListener("input", () => {
        input.style.height = "auto";
        input.style.height = `${Math.min(input.scrollHeight, 180)}px`;
    });

    document.querySelector("#ai-chat-attach")?.addEventListener("click", () => {
        document.querySelector("#ai-chat-file-input")?.click();
    });

    document.querySelector("#ai-chat-file-input")?.addEventListener("change", event => {
        uploadKnowledgeFiles(event.target.files);
        event.target.value = "";
    });

    document.querySelectorAll("[data-remove-file]").forEach(button => {
        button.addEventListener("click", () => removeKnowledgeFile(button.dataset.removeFile));
    });

    document.querySelectorAll("[data-chat-prompt]").forEach(button => {
        button.addEventListener("click", () => sendMessage(button.dataset.chatPrompt));
    });

    document.querySelectorAll("[data-copy-message]").forEach(button => {
        button.addEventListener("click", () => {
            const index = Number(button.dataset.copyMessage);
            const message = messages[index];
            if (message) navigator.clipboard?.writeText(message.content || "");
        });
    });

    document.querySelector("#ai-chat-include-study-data")?.addEventListener("change", event => {
        chatOptions.includeStudyData = event.target.checked;
        saveJSON(CHAT_OPTIONS_KEY, chatOptions);
    });

    document.querySelector("#ai-chat-include-wellbeing-data")?.addEventListener("change", event => {
        chatOptions.includeWellbeingData = event.target.checked;
        saveJSON(CHAT_OPTIONS_KEY, chatOptions);
    });

    document.querySelector("#ai-chat-include-memory")?.addEventListener("change", event => {
        chatOptions.includePersonalMemory = event.target.checked;
        saveJSON(CHAT_OPTIONS_KEY, chatOptions);
    });

    document.querySelector("#ai-chat-mode")?.addEventListener("change", event => {
        chatOptions.mode = event.target.value === "deep" ? "deep" : "balanced";
        saveJSON(CHAT_OPTIONS_KEY, chatOptions);
    });

    scrollChatToBottom();
}

// ==========================================
// PAGE STYLES & RENDER
// ==========================================

export function renderAIChatPanel() {
    return `
        <style>
            #ai-chat-root { display:grid; gap:13px; min-height:620px; }
            #ai-chat-root .ai-chat-header { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:12px; }
            #ai-chat-root .ai-chat-title { display:flex; align-items:center; gap:11px; }
            #ai-chat-root .ai-chat-logo { width:40px; height:40px; display:grid; place-items:center; background:var(--accent-soft); color:var(--accent); border-radius:13px; font-size:22px; }
            #ai-chat-root .ai-chat-title h2 { font-size:17px; }
            #ai-chat-root .ai-chat-title p { margin-top:3px; color:var(--text-muted); font-size:11px; }
            #ai-chat-root .ai-chat-header-actions { display:flex; align-items:center; gap:7px; flex-wrap:wrap; }
            #ai-chat-root .ai-chat-header-button { padding:8px 11px; font-size:11px; }
            #ai-chat-root .ai-chat-connection-pill { display:inline-flex; align-items:center; gap:6px; padding:7px 9px; border-radius:30px; background:var(--bg-secondary); color:var(--text-secondary); font-size:10px; }
            #ai-chat-root .ai-chat-connection-pill i { width:7px; height:7px; border-radius:50%; background:var(--red); }
            #ai-chat-root .ai-chat-connection-pill.connected i { background:var(--accent); }
            #ai-chat-root .ai-chat-connection { padding:16px; border:1px solid var(--border); border-radius:14px; background:var(--bg-secondary); }
            #ai-chat-root .ai-chat-connection[hidden] { display:none; }
            #ai-chat-root .ai-chat-connection-heading { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:13px; }
            #ai-chat-root .ai-chat-connection-heading h3 { margin-top:4px; font-size:15px; }
            #ai-chat-root .ai-chat-close { width:30px; height:30px; border-radius:8px; background:var(--bg-hover); color:var(--text-secondary); font-size:18px; }
            #ai-chat-root .ai-chat-eyebrow { font-size:9px; font-weight:750; letter-spacing:1.4px; color:var(--accent); }
            #ai-chat-root .ai-chat-field { display:grid; gap:6px; margin-bottom:11px; color:var(--text-secondary); font-size:11px; font-weight:650; }
            #ai-chat-root .ai-chat-field input { width:100%; padding:10px 12px; border:1px solid var(--border); border-radius:9px; background:var(--bg-primary); color:var(--text-primary); font:inherit; }
            #ai-chat-root .ai-chat-connection-actions { display:flex; align-items:center; gap:9px; flex-wrap:wrap; }
            #ai-chat-root .ai-chat-connection-actions button { padding:9px 12px; font-size:11px; }
            #ai-chat-root #ai-chat-connection-status { color:var(--text-secondary); font-size:11px; }
            #ai-chat-root .ai-chat-hint { margin-top:12px; color:var(--text-muted); font-size:10px; line-height:1.6; }
            #ai-chat-root .ai-chat-conversation { min-height:310px; max-height:610px; overflow-y:auto; padding:16px; border:1px solid var(--border); border-radius:15px; background:var(--bg-primary); }
            #ai-chat-root .ai-chat-messages { display:grid; gap:21px; }
            #ai-chat-root .ai-chat-welcome { max-width:640px; min-height:290px; margin:auto; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; padding:20px 8px; }
            #ai-chat-root .ai-chat-welcome-mark { width:58px; height:58px; display:grid; place-items:center; border-radius:19px; background:var(--accent-soft); color:var(--accent); font-size:30px; }
            #ai-chat-root .ai-chat-welcome h2 { margin-top:18px; font-size:22px; letter-spacing:-.5px; }
            #ai-chat-root .ai-chat-welcome p { max-width:530px; margin-top:9px; color:var(--text-secondary); font-size:12px; line-height:1.7; }
            #ai-chat-root .ai-chat-suggestions { display:flex; flex-wrap:wrap; justify-content:center; gap:8px; margin-top:19px; }
            #ai-chat-root .ai-chat-suggestions button { padding:9px 12px; border:1px solid var(--border); border-radius:30px; background:var(--bg-secondary); color:var(--text-secondary); font-size:10px; }
            #ai-chat-root .ai-chat-suggestions button:hover { border-color:var(--accent); color:var(--accent); }
            #ai-chat-root .ai-chat-message { display:flex; align-items:flex-start; gap:11px; max-width:900px; }
            #ai-chat-root .ai-chat-message.from-user { margin-left:auto; flex-direction:row-reverse; }
            #ai-chat-root .ai-chat-avatar { width:29px; height:29px; flex:0 0 29px; display:grid; place-items:center; border-radius:10px; font-size:12px; }
            #ai-chat-root .assistant-avatar { background:var(--accent-soft); color:var(--accent); }
            #ai-chat-root .user-avatar { background:var(--bg-hover); color:var(--text-secondary); font-size:9px; }
            #ai-chat-root .ai-chat-message-content { min-width:0; max-width:min(82%,760px); }
            #ai-chat-root .from-user .ai-chat-message-content { padding:11px 13px; border-radius:14px 4px 14px 14px; background:var(--bg-secondary); }
            #ai-chat-root .ai-chat-message-heading { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:6px; color:var(--text-muted); font-size:10px; }
            #ai-chat-root .ai-chat-message-heading strong { color:var(--text-secondary); }
            #ai-chat-root .ai-chat-copy { color:var(--text-muted); font-size:12px; }
            #ai-chat-root .ai-chat-message-body { color:var(--text-primary); font-size:12px; line-height:1.75; overflow-wrap:anywhere; }
            #ai-chat-root .ai-chat-message-body h2, #ai-chat-root .ai-chat-message-body h3, #ai-chat-root .ai-chat-message-body h4 { margin:12px 0 6px; font-size:14px; }
            #ai-chat-root .ai-chat-message-body code { padding:2px 5px; border-radius:5px; background:var(--bg-hover); font-family:ui-monospace,monospace; font-size:11px; }
            #ai-chat-root .ai-chat-code { max-width:100%; overflow:auto; margin:9px 0; padding:12px; border-radius:9px; background:var(--bg-secondary); white-space:pre; }
            #ai-chat-root .ai-chat-code code { padding:0; background:transparent; }
            #ai-chat-root .ai-chat-list-line { display:block; padding-left:8px; }
            #ai-chat-root .ai-chat-thinking { display:flex; align-items:center; gap:5px; color:var(--text-muted); font-size:10px; }
            #ai-chat-root .ai-chat-thinking span { width:5px; height:5px; border-radius:50%; background:var(--accent); animation:restart-ai-pulse 1s infinite ease-in-out; }
            #ai-chat-root .ai-chat-thinking span:nth-child(2) { animation-delay:.15s; }
            #ai-chat-root .ai-chat-thinking span:nth-child(3) { animation-delay:.3s; margin-right:4px; }
            @keyframes restart-ai-pulse { 0%,80%,100% { opacity:.25; transform:translateY(0); } 40% { opacity:1; transform:translateY(-3px); } }
            #ai-chat-root .ai-chat-knowledge { padding:13px 15px; }
            #ai-chat-root .ai-chat-knowledge-heading { display:flex; align-items:center; justify-content:space-between; gap:12px; }
            #ai-chat-root .ai-chat-knowledge-heading strong { display:block; margin-top:3px; font-size:12px; }
            #ai-chat-root .ai-chat-knowledge-heading small { display:block; margin-top:4px; color:var(--text-muted); font-size:10px; }
            #ai-chat-root .ai-chat-file-count { min-width:27px; height:27px; display:grid; place-items:center; border-radius:9px; background:var(--accent-soft); color:var(--accent); font-size:11px; font-weight:700; }
            #ai-chat-root .ai-chat-file-list { display:grid; gap:7px; margin-top:11px; }
            #ai-chat-root .ai-chat-no-files { color:var(--text-muted); font-size:10px; line-height:1.6; }
            #ai-chat-root .ai-chat-file-row { display:flex; align-items:center; gap:9px; padding:8px 9px; border-radius:9px; background:var(--bg-secondary); }
            #ai-chat-root .ai-chat-file-icon { color:var(--accent); font-size:17px; }
            #ai-chat-root .ai-chat-file-info { flex:1; min-width:0; }
            #ai-chat-root .ai-chat-file-info strong { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:10px; }
            #ai-chat-root .ai-chat-file-info small { display:block; margin-top:3px; color:var(--text-muted); font-size:9px; }
            #ai-chat-root .ai-chat-file-delete { width:25px; height:25px; border-radius:7px; color:var(--text-muted); background:transparent; font-size:17px; }
            #ai-chat-root .ai-chat-file-delete:hover { background:rgba(220,90,90,.1); color:var(--red); }
            #ai-chat-root .ai-chat-context-options { display:flex; align-items:center; gap:14px; flex-wrap:wrap; }
            #ai-chat-root .ai-chat-context-options label { display:inline-flex; align-items:center; gap:6px; color:var(--text-secondary); font-size:10px; }
            #ai-chat-root .ai-chat-context-options input { accent-color:var(--accent); }
            #ai-chat-root .ai-chat-mode-select { margin-left:auto; }
            #ai-chat-root .ai-chat-mode-select select { padding:6px 8px; border:1px solid var(--border); border-radius:8px; background:var(--bg-secondary); color:var(--text-primary); font-size:10px; }
            #ai-chat-root .ai-chat-private-note { color:var(--text-muted); font-size:9px; line-height:1.6; }
            #ai-chat-root .ai-chat-composer { padding:12px; border:1px solid var(--border); border-radius:15px; background:var(--bg-secondary); }
            #ai-chat-root .ai-chat-composer textarea { display:block; width:100%; min-height:42px; max-height:180px; resize:none; border:0; outline:0; background:transparent; color:var(--text-primary); font:inherit; font-size:12px; line-height:1.6; }
            #ai-chat-root .ai-chat-composer textarea::placeholder { color:var(--text-muted); }
            #ai-chat-root .ai-chat-composer-bottom { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-top:8px; }
            #ai-chat-root .ai-chat-composer-tools { display:flex; align-items:center; gap:9px; flex-wrap:wrap; }
            #ai-chat-root .ai-chat-tool-button { padding:7px 10px; border:1px solid var(--border); border-radius:30px; background:var(--bg-primary); color:var(--text-secondary); font-size:10px; }
            #ai-chat-root .ai-chat-tool-button:disabled { opacity:.5; }
            #ai-chat-root .ai-chat-composer-tools span { color:var(--text-muted); font-size:9px; }
            #ai-chat-root .ai-chat-send { min-width:86px; padding:8px 12px; font-size:11px; }
            #ai-chat-root .ai-chat-send:disabled { opacity:.5; cursor:not-allowed; }
            #ai-chat-root .ai-chat-notice { padding:9px 11px; border-radius:9px; background:var(--bg-secondary); color:var(--text-secondary); font-size:10px; line-height:1.5; }
            #ai-chat-root .ai-chat-notice.error { color:var(--red); }
            #ai-chat-root .ai-chat-notice.success { color:var(--accent); }
            @media(max-width:650px) {
                #ai-chat-root { min-height:560px; }
                #ai-chat-root .ai-chat-header { align-items:flex-start; flex-direction:column; }
                #ai-chat-root .ai-chat-header-actions { width:100%; }
                #ai-chat-root .ai-chat-conversation { max-height:55vh; padding:12px; }
                #ai-chat-root .ai-chat-message-content { max-width:calc(100% - 40px); }
                #ai-chat-root .ai-chat-context-options { gap:9px; }
                #ai-chat-root .ai-chat-mode-select { margin-left:0; }
                #ai-chat-root .ai-chat-composer-bottom { align-items:flex-end; }
            }
        </style>
        ${renderAIChat()}
    `;
}