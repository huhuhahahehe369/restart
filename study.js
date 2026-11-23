
// ==========================================
// RE:START M02 - STUDY ROOM
// Pomodoro + open-ended stopwatch + extra subjects
// ==========================================

const DATABASE_KEY = "restart-data-v1";
const MODE_KEY = "restart-m02-selected-mode";
const SECONDARY_SUBJECT_TYPE = "study_subject";

const CORE_SUBJECTS = [
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
        const raw = localStorage.getItem(DATABASE_KEY);
        const database = raw ? JSON.parse(raw) : null;
        const language = database?.settings?.language;

        return ["en", "vi", "bi"].includes(language)
            ? language
            : "en";

    } catch (error) {
        console.warn("Could not read Study Room language:", error);
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
    if (globalThis.crypto?.randomUUID) {
        return globalThis.crypto.randomUUID();
    }

    return `subject-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getPreferredMode() {
    try {
        const mode = localStorage.getItem(MODE_KEY);
        return mode === "stopwatch" ? "stopwatch" : "pomodoro";
    } catch {
        return "pomodoro";
    }
}

// ==========================================
// SECONDARY SUBJECT STORAGE
// Uses the existing database journal array
// with a separate record type.
// ==========================================

function readDatabase() {
    const raw = localStorage.getItem(DATABASE_KEY);

    if (!raw) {
        throw new Error("RE:START storage is not initialized.");
    }

    const database = JSON.parse(raw);

    if (
        !database ||
        typeof database !== "object" ||
        !database.settings
    ) {
        throw new Error("RE:START data is unreadable.");
    }

    if (!Array.isArray(database.journal)) {
        database.journal = [];
    }

    return database;
}

function getSecondarySubjects() {
    const database = readDatabase();

    return database.journal
        .filter(item => item?.recordType === SECONDARY_SUBJECT_TYPE)
        .filter(item =>
            typeof item.name === "string" &&
            item.name.trim()
        )
        .map(item => ({
            id: String(item.id || ""),
            name: item.name.trim()
        }))
        .filter(item => item.id && item.name)
        .sort((a, b) => a.name.localeCompare(b.name));
}

function saveSecondarySubject(rawName) {
    const name = String(rawName || "")
        .trim()
        .replace(/\s+/g, " ");

    if (!name) {
        throw new Error(
            tx("Enter a subject name.", "Hãy nhập tên môn học.")
        );
    }

    if (name.length > 40) {
        throw new Error(
            tx(
                "Subject names can contain up to 40 characters.",
                "Tên môn học tối đa 40 ký tự."
            )
        );
    }

    const database = readDatabase();

    const existingNames = [
        ...CORE_SUBJECTS,
        ...database.journal
            .filter(item => item?.recordType === SECONDARY_SUBJECT_TYPE)
            .map(item => String(item.name || ""))
    ];

    const duplicate = existingNames.some(existing =>
        existing.trim().toLocaleLowerCase() === name.toLocaleLowerCase()
    );

    if (duplicate) {
        throw new Error(
            tx("This subject already exists.", "Môn học này đã tồn tại.")
        );
    }

    const count = database.journal.filter(
        item => item?.recordType === SECONDARY_SUBJECT_TYPE
    ).length;

    if (count >= 50) {
        throw new Error(
            tx(
                "You can add up to 50 extra subjects.",
                "Cún có thể thêm tối đa 50 môn phụ."
            )
        );
    }

    const now = new Date().toISOString();

    const subject = {
        recordType: SECONDARY_SUBJECT_TYPE,
        id: createId(),
        name,
        createdAt: now
    };

    database.journal.push(subject);

    database.meta = database.meta || {};
    database.meta.updatedAt = now;

    try {
        localStorage.setItem(
            DATABASE_KEY,
            JSON.stringify(database)
        );
    } catch (error) {
        console.error("Could not save secondary subject:", error);

        throw new Error(
            tx(
                "Could not save the subject. Browser storage may be full.",
                "Không thể lưu môn học. Bộ nhớ trình duyệt có thể đã đầy."
            )
        );
    }

    return subject;
}

function deleteSecondarySubject(id) {
    const database = readDatabase();
    const previousLength = database.journal.length;

    database.journal = database.journal.filter(item =>
        !(
            item?.recordType === SECONDARY_SUBJECT_TYPE &&
            item.id === id
        )
    );

    if (database.journal.length === previousLength) {
        return false;
    }

    database.meta = database.meta || {};
    database.meta.updatedAt = new Date().toISOString();

    try {
        localStorage.setItem(
            DATABASE_KEY,
            JSON.stringify(database)
        );
    } catch (error) {
        console.error("Could not remove secondary subject:", error);

        throw new Error(
            tx(
                "Could not update your subjects.",
                "Không thể cập nhật danh sách môn học."
            )
        );
    }

    // Existing study records are deliberately preserved.
    return true;
}

// ==========================================
// SUBJECT SELECTS
// ==========================================

function renderSubjectOptions(emptyLabel) {
    const secondarySubjects = getSecondarySubjects();

    return `
        <option value="">${escapeHTML(emptyLabel)}</option>

        <optgroup label="${escapeHTML(tx("Main subjects", "Môn học chính"))}">
            ${CORE_SUBJECTS.map(subject => `
                <option value="${escapeHTML(subject)}">
                    ${escapeHTML(subject)}
                </option>
            `).join("")}
        </optgroup>

        ${secondarySubjects.length ? `
            <optgroup label="${escapeHTML(tx("Additional subjects", "Môn phụ"))}">
                ${secondarySubjects.map(subject => `
                    <option value="${escapeHTML(subject.name)}">
                        ${escapeHTML(subject.name)}
                    </option>
                `).join("")}
            </optgroup>
        ` : ""}
    `;
}

function renderSecondarySubjectList() {
    const subjects = getSecondarySubjects();

    if (!subjects.length) {
        return `
            <p class="empty-note">
                ${escapeHTML(tx("No additional subjects yet.", "Chưa có môn phụ nào."))}
            </p>
        `;
    }

    return subjects.map(subject => `
        <div class="secondary-subject-chip">
            <span>${escapeHTML(subject.name)}</span>

            <button
                type="button"
                data-remove-secondary-subject="${escapeHTML(subject.id)}"
                aria-label="${escapeHTML(tx("Remove", "Xóa"))} ${escapeHTML(subject.name)}"
                title="${escapeHTML(tx("Remove subject", "Xóa môn học"))}"
            >×</button>
        </div>
    `).join("");
}

function refreshSubjectControls(preferredSubject = null) {
    const subjectSelect = document.querySelector("#subject-select");
    const nextSubjectSelect = document.querySelector("#next-subject-select");
    const list = document.querySelector("#secondary-subject-list");

    const currentSubject =
        preferredSubject ?? subjectSelect?.value ?? "";

    const nextSubject =
        nextSubjectSelect?.value ?? "";

    if (subjectSelect) {
        subjectSelect.innerHTML = renderSubjectOptions(
            tx("Select a subject", "Chọn môn học")
        );

        subjectSelect.value = currentSubject;
    }

    if (nextSubjectSelect) {
        nextSubjectSelect.innerHTML = renderSubjectOptions(
            tx("Select your next subject", "Chọn môn học tiếp theo")
        );

        nextSubjectSelect.value = nextSubject;
    }

    if (list) {
        list.innerHTML = renderSecondarySubjectList();
    }
}

// ==========================================
// STUDY PAGE
// ==========================================

export function renderStudyPage() {
    const mode = getPreferredMode();

    return `
        <section id="restart-study-page">

            <section class="page-heading">
                <h1>Good day. Let's make progress.</h1>
                <p>Your personal space to focus, learn and grow.</p>
            </section>

            <section class="study-grid">

                <div class="card timer-card">

                    <div class="restart-timer-mode-switch"
                        role="group"
                        aria-label="Study timer mode">

                        <button
                            type="button"
                            class="restart-timer-mode-button ${mode === "pomodoro" ? "active" : ""}"
                            data-timer-mode="pomodoro"
                            aria-pressed="${mode === "pomodoro"}"
                        >
                            ◷ ${escapeHTML(tx("Pomodoro", "Pomodoro"))}
                        </button>

                        <button
                            type="button"
                            class="restart-timer-mode-button ${mode === "stopwatch" ? "active" : ""}"
                            data-timer-mode="stopwatch"
                            aria-pressed="${mode === "stopwatch"}"
                        >
                            ⏱ ${escapeHTML(tx("Stopwatch", "Đếm giờ tự do"))}
                        </button>

                    </div>

                    <div class="timer-label" id="timer-phase">
                        ${mode === "stopwatch" ? "STOPWATCH READY" : "READY TO FOCUS"}
                    </div>

                    <div class="timer-display" id="timer-display">
                        ${mode === "stopwatch" ? "00:00:00" : "45:00"}
                    </div>

                    <p class="timer-subtitle" id="timer-message">
                        ${escapeHTML(
                            mode === "stopwatch"
                                ? tx(
                                    "Choose a subject and start counting.",
                                    "Chọn môn học rồi bắt đầu đếm giờ."
                                )
                                : tx(
                                    "Choose a subject and start your session.",
                                    "Chọn môn học và bắt đầu phiên học."
                                )
                        )}
                    </p>

                    <div class="timer-actions">

                        <button
                            class="primary-button"
                            id="timer-start"
                            ${mode === "stopwatch" ? "hidden" : ""}
                        >
                            ${escapeHTML(tx("Start Focus", "Bắt đầu học"))}
                        </button>

                        <button
                            class="primary-button"
                            id="stopwatch-start"
                            ${mode !== "stopwatch" ? "hidden" : ""}
                        >
                            ${escapeHTML(tx("Start counting", "Bắt đầu đếm giờ"))}
                        </button>

                        <button
                            class="secondary-button"
                            id="timer-pause"
                            hidden
                        >
                            ${escapeHTML(tx("Pause", "Tạm dừng"))}
                        </button>

                        <button
                            class="secondary-button"
                            id="timer-stop"
                            hidden
                        >
                            ${escapeHTML(tx("Stop", "Dừng"))}
                        </button>

                    </div>

                    <p class="empty-note" id="timer-progress" style="margin-top:18px">
                        ${escapeHTML(
                            mode === "stopwatch"
                                ? tx(
                                    "No preset duration · Stop whenever you're done.",
                                    "Không cần đặt thời gian · Dừng khi Cún học xong."
                                )
                                : "Focus 45 min · Break 10 min"
                        )}
                    </p>

                </div>

                <div class="card subject-card">

                    <div>
                        <div class="card-title">
                            ${escapeHTML(tx("Current Subject", "Môn học hiện tại"))}
                        </div>

                        <h2 style="margin:8px 0 15px">
                            ${escapeHTML(tx("What are you learning?", "Cún đang học môn gì?"))}
                        </h2>

                        <select class="subject-select" id="subject-select">
                            ${renderSubjectOptions(
                                tx("Select a subject", "Chọn môn học")
                            )}
                        </select>
                    </div>

                    <div class="pomodoro-only" hidden>
                        <div class="card-title">
                            ${escapeHTML(tx("Focus duration (minutes)", "Thời gian tập trung (phút)"))}
                        </div>

                        <input
                            class="subject-select"
                            id="focus-duration"
                            type="number"
                            min="1"
                            max="300"
                            step="1"
                            value="45"
                        >
                    </div>

                    <div class="pomodoro-only" hidden>
                        <div class="card-title">
                            ${escapeHTML(tx("Break duration (minutes)", "Thời gian nghỉ (phút)"))}
                        </div>

                        <input
                            class="subject-select"
                            id="break-duration"
                            type="number"
                            min="1"
                            max="120"
                            step="1"
                            value="10"
                        >
                    </div>

                    <p class="empty-note pomodoro-only" hidden>
                        ${escapeHTML(
                            tx(
                                "Focus: 1–300 minutes · Break: 1–120 minutes. You can customize both before starting.",
                                "Tập trung: 1–300 phút · Nghỉ: 1–120 phút. Cún có thể tùy chỉnh trước khi bắt đầu."
                            )
                        )}
                    </p>

                    <div class="restart-secondary-subjects">

                        <div>
                            <div class="card-title">
                                ${escapeHTML(tx("Additional subjects", "Môn phụ"))}
                            </div>

                            <p class="empty-note" style="margin-top:4px;">
                                ${escapeHTML(
                                    tx(
                                        "Add other subjects and track their study time separately.",
                                        "Thêm các môn học khác và theo dõi thời gian riêng từng môn."
                                    )
                                )}
                            </p>
                        </div>

                        <form id="secondary-subject-form"
                            class="restart-add-subject-form">

                            <input
                                class="subject-select"
                                id="secondary-subject-name"
                                type="text"
                                maxlength="40"
                                placeholder="${escapeHTML(tx("New subject name", "Tên môn học mới"))}"
                                required
                            >

                            <button class="secondary-button" type="submit">
                                ＋ ${escapeHTML(tx("Add", "Thêm"))}
                            </button>

                        </form>

                        <p
                            id="secondary-subject-status"
                            class="empty-note"
                            role="status"
                            aria-live="polite"
                        ></p>

                        <div id="secondary-subject-list"
                            class="restart-secondary-subject-list">
                            ${renderSecondarySubjectList()}
                        </div>

                    </div>

                </div>

            </section>

            <section
                id="next-subject-panel"
                class="card"
                style="margin-top:20px"
                hidden
            >

                <div class="timer-label">BREAK COMPLETED</div>

                <h2 style="margin:10px 0">
                    Ready for the next session?
                </h2>

                <p class="timer-subtitle" style="margin-bottom:18px">
                    Choose the subject you want to study next.
                </p>

                <select class="subject-select" id="next-subject-select">
                    ${renderSubjectOptions(
                        tx("Select your next subject", "Chọn môn học tiếp theo")
                    )}
                </select>

                <button
                    class="primary-button"
                    id="next-subject-start"
                    style="margin-top:15px"
                >
                    Start Next Session
                </button>

            </section>

            <section class="stats-grid">

                <div class="card">
                    <div class="card-title">Today's Study Time</div>
                    <div class="stat-value" id="today-study">0m 0s</div>
                    <div class="stat-description">Total focused time</div>
                </div>

                <div class="card">
                    <div class="card-title">Today's Break Time</div>
                    <div class="stat-value" id="today-break">0m 0s</div>
                    <div class="stat-description">Time spent resting</div>
                </div>

                <div class="card">
                    <div class="card-title">Focus Sessions</div>
                    <div class="stat-value" id="today-sessions">0</div>
                    <div class="stat-description">Completed focus sessions</div>
                </div>

            </section>

            <section class="card" style="margin-top:20px">

                <div style="
                    display:flex;
                    justify-content:space-between;
                    align-items:center;
                    gap:12px;
                    flex-wrap:wrap;
                    margin-bottom:20px;
                ">

                    <div>
                        <h3>Study Time by Subject</h3>
                        <p class="empty-note" style="margin-top:5px">
                            Combined time across all your subjects today.
                        </p>
                    </div>

                    <div style="text-align:right">
                        <div class="card-title">TOTAL STUDY TIME</div>

                        <div
                            class="stat-value"
                            id="all-subject-total"
                            style="color:var(--accent);margin-top:4px"
                        >
                            0m 0s
                        </div>
                    </div>

                </div>

                <div id="subject-statistics">
                    <p class="empty-note">
                        No study sessions recorded today.
                    </p>
                </div>

            </section>

            <style>
                #restart-study-page .restart-timer-mode-switch {
                    display:flex;
                    gap:5px;
                    padding:5px;
                    margin-bottom:24px;
                    border:1px solid var(--border);
                    border-radius:12px;
                    background:var(--bg-secondary);
                }

                #restart-study-page .restart-timer-mode-button {
                    padding:9px 14px;
                    border-radius:9px;
                    background:transparent;
                    color:var(--text-secondary);
                    font:inherit;
                    font-size:12px;
                    font-weight:650;
                }

                #restart-study-page .restart-timer-mode-button.active {
                    background:var(--accent-soft);
                    color:var(--accent);
                }

                #restart-study-page .restart-timer-mode-button:disabled {
                    cursor:not-allowed;
                    opacity:.65;
                }

                #restart-study-page .pomodoro-only[hidden] {
                    display:none !important;
                }

                #restart-study-page .restart-secondary-subjects {
                    display:grid;
                    gap:10px;
                    padding-top:16px;
                    border-top:1px solid var(--border);
                }

                #restart-study-page .restart-add-subject-form {
                    display:grid;
                    grid-template-columns:minmax(0,1fr) auto;
                    gap:8px;
                }

                #restart-study-page .restart-add-subject-form button {
                    padding:10px 13px;
                }

                #restart-study-page .restart-secondary-subject-list {
                    display:flex;
                    flex-wrap:wrap;
                    gap:7px;
                }

                #restart-study-page .secondary-subject-chip {
                    display:flex;
                    align-items:center;
                    gap:8px;
                    padding:6px 9px;
                    border:1px solid var(--border);
                    border-radius:9px;
                    background:var(--bg-secondary);
                    color:var(--text-secondary);
                    font-size:11px;
                }

                #restart-study-page .secondary-subject-chip button {
                    width:18px;
                    height:18px;
                    border-radius:6px;
                    background:var(--bg-hover);
                    color:var(--text-muted);
                    line-height:1;
                }

                #restart-study-page .secondary-subject-chip button:hover {
                    color:var(--red);
                }

                #restart-study-page #secondary-subject-status {
                    min-height:15px;
                }

                @media(max-width:500px) {
                    #restart-study-page .restart-timer-mode-switch {
                        width:100%;
                    }

                    #restart-study-page .restart-timer-mode-button {
                        flex:1;
                        padding:9px 7px;
                    }

                    #restart-study-page .restart-add-subject-form {
                        grid-template-columns:1fr;
                    }
                }
            </style>

        </section>
    `;
}

// ==========================================
// GLOBAL STUDY ROOM EVENTS
// ==========================================

if (
    typeof document !== "undefined" &&
    !globalThis.__restartStudyPageEventsBound
) {
    globalThis.__restartStudyPageEventsBound = true;

    // --------------------------------------
    // TIMER MODE + REMOVE SUBJECT
    // --------------------------------------

    document.addEventListener("click", event => {
        const modeButton = event.target.closest("[data-timer-mode]");

        if (modeButton) {
            const mode = modeButton.dataset.timerMode;
            const timer = globalThis.__restartStudyTimer;

            if (!timer) {
                alert(
                    tx(
                        "The study timer is not ready. Please reload the page.",
                        "Bộ đếm giờ chưa sẵn sàng. Hãy tải lại trang."
                    )
                );
                return;
            }

            const state = timer.getState();

            if (["focus", "break"].includes(state.phase)) {
                return;
            }

            if (!timer.setMode(mode)) {
                alert(
                    tx(
                        "Could not change timer mode.",
                        "Không thể đổi chế độ đếm giờ."
                    )
                );
            }

            return;
        }

        const removeButton = event.target.closest(
            "[data-remove-secondary-subject]"
        );

        if (removeButton) {
            const timer = globalThis.__restartStudyTimer;
            const state = timer?.getState();

            if (
                state &&
                ["focus", "break"].includes(state.phase)
            ) {
                alert(
                    tx(
                        "Stop the active study session before removing a subject.",
                        "Hãy dừng phiên học hiện tại trước khi xóa môn học."
                    )
                );
                return;
            }

            const confirmed = window.confirm(
                tx(
                    "Remove this subject from the selectable list? Existing study records will be kept.",
                    "Xóa môn này khỏi danh sách lựa chọn? Lịch sử học tập đã lưu vẫn được giữ nguyên."
                )
            );

            if (!confirmed) return;

            try {
                deleteSecondarySubject(
                    removeButton.dataset.removeSecondarySubject
                );

                refreshSubjectControls();

                const status = document.querySelector(
                    "#secondary-subject-status"
                );

                if (status) {
                    status.textContent = tx(
                        "Subject removed. Historical study time is preserved.",
                        "Đã xóa môn học. Thời gian học trong lịch sử vẫn được giữ."
                    );
                }

            } catch (error) {
                alert(
                    error.message ||
                    tx(
                        "Could not remove this subject.",
                        "Không thể xóa môn học này."
                    )
                );
            }
        }
    });

    // --------------------------------------
    // ADD SECONDARY SUBJECT
    // --------------------------------------

    document.addEventListener("submit", event => {
        const form = event.target;

        if (
            !(form instanceof HTMLFormElement) ||
            form.id !== "secondary-subject-form"
        ) {
            return;
        }

        event.preventDefault();

        const input = document.querySelector(
            "#secondary-subject-name"
        );

        const status = document.querySelector(
            "#secondary-subject-status"
        );

        if (!input) return;

        try {
            const saved = saveSecondarySubject(input.value);

            input.value = "";

            refreshSubjectControls(saved.name);

            const refreshedStatus = document.querySelector(
                "#secondary-subject-status"
            );

            if (refreshedStatus) {
                refreshedStatus.textContent = tx(
                    `Added ${saved.name} to additional subjects.`,
                    `Đã thêm ${saved.name} vào danh sách môn phụ.`
                );
            }

        } catch (error) {
            if (status) {
                status.textContent =
                    error.message ||
                    tx(
                        "Could not add this subject.",
                        "Không thể thêm môn học này."
                    );
            }
        }
    });

    // --------------------------------------
    // START STOPWATCH
    // --------------------------------------

    document.addEventListener("click", event => {
        const stopwatchButton = event.target.closest(
            "#stopwatch-start"
        );

        if (!stopwatchButton) return;

        const subject =
            document.querySelector("#subject-select")?.value || "";

        const timer = globalThis.__restartStudyTimer;

        if (!subject) {
            alert(
                tx(
                    "Please select a subject before starting.",
                    "Hãy chọn môn học trước khi bắt đầu."
                )
            );
            return;
        }

        if (!timer || !timer.startStopwatch(subject)) {
            alert(
                tx(
                    "Could not start the stopwatch. Check whether another timer is active.",
                    "Không thể bắt đầu đếm giờ. Hãy kiểm tra xem bộ đếm khác có đang chạy không."
                )
            );
        }
    });
}
