// background.js
const SERVER_URL = "http://localhost:8080";

// 탭 추적용 상태 (서비스워커 재시작 시 사라져도 무방 — 다음 탭 전환 때 다시 계산됨)
let currentTab = null;
let tabStartTime = null;
let browserLogs = [];

// ── 설정 조회 ──────────────────────────────────────
// MV3 서비스워커는 유휴 상태에서 언제든 종료됐다가 재시작될 수 있고,
// 이때 onInstalled/onStartup은 발생하지 않는다. 그래서 deviceToken 등을
// 모듈 변수에 캐싱하지 않고, 필요할 때마다 매번 storage에서 읽는다.
async function getConfig() {
    const data = await chrome.storage.local.get(["deviceToken", "sessionId", "deviceId"]);
    return {
        deviceToken: data.deviceToken || null,
        sessionId: data.sessionId || null,
        deviceId: data.deviceId || null,
    };
}

// ── 탭 추적 ──────────────────────────────────────

chrome.tabs.onActivated.addListener(async (activeInfo) => {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    handleTabChange(tab);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === "complete" && tab.active) {
        handleTabChange(tab);
    }
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
    if (windowId === chrome.windows.WINDOW_ID_NONE) {
        saveCurrentTabLog();
        currentTab = null;
        tabStartTime = null;
        return;
    }

    try {
        const tabs = await chrome.tabs.query({ active: true, windowId });
        if (tabs.length > 0) {
            handleTabChange(tabs[0]);
        }
    } catch (e) {
        console.error("[오류]", e);
    }
});

function handleTabChange(tab) {
    saveCurrentTabLog();

    if (!tab.url || tab.url.startsWith("chrome://")) {
        currentTab = null;
        tabStartTime = null;
        return;
    }

    currentTab = tab;
    tabStartTime = new Date();
}

function saveCurrentTabLog() {
    if (!currentTab || !tabStartTime) return;

    const durationSec = Math.floor((new Date() - tabStartTime) / 1000);
    if (durationSec < 3) return;

    const domain = extractDomain(currentTab.url);
    if (!domain) return;

    browserLogs.push({
        domain: domain,
        pageTitle: currentTab.title || "",
        startedAt: tabStartTime.toISOString().slice(0, 19),
        durationSec: durationSec
    });

    console.log(`[로그] ${domain} | ${durationSec}초 | 배치: ${browserLogs.length}개`);
}

// ── 알람 (1분마다 로그 전송 + 세션 동기화) ─────────────────

chrome.alarms.create("sendLogs", { periodInMinutes: 1 });
chrome.alarms.create("syncSession", { periodInMinutes: 1 });

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "sendLogs") {
        sendBrowserLogs();
    }
    if (alarm.name === "syncSession") {
        syncActiveSession();
    }
});

async function syncActiveSession() {
    const config = await getConfig();
    if (!config.deviceToken) return;

    try {
        const response = await fetch(`${SERVER_URL}/api/sessions/active`, {
            headers: { "Authorization": `Bearer ${config.deviceToken}` }
        });
        if (response.ok) {
            const data = await response.json();
            if (config.sessionId !== data.sessionId) {
                await chrome.storage.local.set({ sessionId: data.sessionId });
                console.log("[세션 동기화]", data.sessionId);
            }
        } else if (response.status === 400 || response.status === 404) {
            if (config.sessionId) {
                await chrome.storage.local.set({ sessionId: null });
                console.log("[세션 동기화] 활성 세션 없음");
            }
        }
    } catch (e) {
        console.error("[오류] 세션 동기화 실패", e);
    }
}

// ── 도메인 추출 ──────────────────────────────────

function extractDomain(url) {
    try {
        const parsed = new URL(url);
        let domain = parsed.hostname;
        if (domain.startsWith("www.")) {
            domain = domain.slice(4);
        }
        return domain;
    } catch {
        return null;
    }
}

// ── 서버 전송 ─────────────────────────────────────

async function sendBrowserLogs() {
    const config = await getConfig();
    if (!browserLogs.length || !config.deviceToken || !config.sessionId || !config.deviceId) {
        return;
    }

    saveCurrentTabLog();

    const logsToSend = [...browserLogs];
    browserLogs = [];

    try {
        const response = await fetch(`${SERVER_URL}/api/browser-logs`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${config.deviceToken}`
            },
            body: JSON.stringify({
                sessionId: parseInt(config.sessionId),
                deviceId: parseInt(config.deviceId),
                logs: logsToSend
            })
        });

        if (response.ok) {
            console.log(`[전송] ${logsToSend.length}개 브라우저 로그 전송 완료`);
        } else {
            console.error("[오류] 전송 실패:", response.status);
            browserLogs = [...logsToSend, ...browserLogs];
        }
    } catch (e) {
        console.error("[오류] 서버 연결 실패:", e);
        browserLogs = [...logsToSend, ...browserLogs];
    }
}

// ── 팝업으로부터 메시지 수신 ──────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "GET_STATUS") {
        getConfig().then((config) => {
            sendResponse({
                isConnected: !!config.deviceToken,
                sessionId: config.sessionId,
                logCount: browserLogs.length
            });
        });
        return true;
    }

    if (message.type === "SAVE_CONFIG") {
        chrome.storage.local.set({
            deviceToken: message.deviceToken,
            sessionId: message.sessionId,
            deviceId: message.deviceId
        }).then(() => sendResponse({ success: true }));
        return true;
    }

    if (message.type === "SEND_NOW") {
        sendBrowserLogs().then(() => sendResponse({ success: true }));
        return true;
    }

    return true;
});

if (typeof module !== "undefined") {
    module.exports = { extractDomain, getConfig };
}
