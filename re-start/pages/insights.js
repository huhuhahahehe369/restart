// ==========================================
// RE:START M08.4 - AI INSIGHTS + AI CHAT
// Compatibility wrapper for both dashboard export names:
// - renderInsightsDashboard / bindInsightsDashboard
// - renderInsightsPage / bindInsightsPage
// ==========================================

import * as Dashboard from "./insights-dashboard.js";
import {
    renderAIChatPanel,
    bindAIChat
} from "./ai-chat.js";

const renderDashboard =
    Dashboard.renderInsightsDashboard ||
    Dashboard.renderInsightsPage;

const bindDashboard =
    Dashboard.bindInsightsDashboard ||
    Dashboard.bindInsightsPage;

if (typeof renderDashboard !== "function" || typeof bindDashboard !== "function") {
    throw new Error(
        "M08.4 dashboard exports are missing. Check pages/insights-dashboard.js."
    );
}

let activeTab = "chat";

function tx(english, vietnamese) {
    try {
        const database = JSON.parse(
            localStorage.getItem("restart-data-v1") || "{}"
        );
        const language = database?.settings?.language || "en";

        if (language === "vi") return vietnamese;
        if (language === "bi") return `${english} · ${vietnamese}`;
    } catch {}

    return english;
}

function renderTabs() {
    return `
        <div class="m084-tabs" role="tablist" aria-label="AI workspace">
            <button
                type="button"
                role="tab"
                aria-selected="${activeTab === "chat"}"
                class="m084-tab ${activeTab === "chat" ? "active" : ""}"
                data-m084-tab="chat"
            >
                ✧ ${tx("AI Chat", "Trò chuyện AI")}
            </button>

            <button
                type="button"
                role="tab"
                aria-selected="${activeTab === "insights"}"
                class="m084-tab ${activeTab === "insights" ? "active" : ""}"
                data-m084-tab="insights"
            >
                ▥ ${tx("Insights", "Phân tích")}
            </button>
        </div>
    `;
}

export function renderInsightsPage() {
    return `
        <section id="restart-m084-page">
            <style>
                #restart-m084-page {
                    display: grid;
                    gap: 15px;
                }

                #restart-m084-page .m084-tabs {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 7px;
                    padding: 5px;
                    width: max-content;
                    max-width: 100%;
                    border: 1px solid var(--border);
                    background: var(--bg-secondary);
                    border-radius: 12px;
                }

                #restart-m084-page .m084-tab {
                    padding: 9px 15px;
                    border-radius: 8px;
                    color: var(--text-secondary);
                    background: transparent;
                    font-size: 11px;
                    font-weight: 650;
                }

                #restart-m084-page .m084-tab.active {
                    background: var(--accent-soft);
                    color: var(--accent);
                }

                #restart-m084-page .m084-panel[hidden] {
                    display: none;
                }
            </style>

            ${renderTabs()}

            <div
                id="ai-chat-panel"
                class="m084-panel"
                ${activeTab === "chat" ? "" : "hidden"}
            >
                ${activeTab === "chat" ? renderAIChatPanel() : ""}
            </div>

            <div
                id="insights-dashboard-panel"
                class="m084-panel"
                ${activeTab === "insights" ? "" : "hidden"}
            >
                ${activeTab === "insights" ? renderDashboard() : ""}
            </div>
        </section>
    `;
}

export function bindInsightsPage() {
    document.querySelectorAll("[data-m084-tab]").forEach(button => {
        button.addEventListener("click", () => {
            const next = button.dataset.m084Tab;

            if (
                !["chat", "insights"].includes(next) ||
                next === activeTab
            ) {
                return;
            }

            activeTab = next;

            const content = document.querySelector(".page-content");
            if (!content) return;

            content.innerHTML = renderInsightsPage();
            bindInsightsPage();
        });
    });

    if (activeTab === "chat") {
        bindAIChat();
    } else {
        bindDashboard();
    }
}