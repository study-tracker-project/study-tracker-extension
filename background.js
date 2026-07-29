// background.js
const SERVER_URL = "http://localhost:8080";

// 상태 변수
let currentTab = null;
let tabStartTime = null;
let browserLogs = [];
let deviceToken = null;
let sessionId = null;
let deviceId = null;

// ── 초기화 ──────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
    console.log("[Study Tracker] 설치 완료");
    loadConfig();
});

chrome.runtime.onStartup.addListener(() => {
    loadConfig();
});

async function loadConfig() {
    const data = await chrome.storage.local.get([
        "deviceToken", "sessionId", "deviceId"
    ]);
    deviceToken = data.deviceToken || null;
    sessionId = data.sessionId || null;
    deviceId = data.deviceId || null;
    console.log("[설정] 로드 완료", { deviceToken: !!deviceToken, sessionId, deviceId });
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
        // 브라우저 포커스 잃음 → 현재 탭 로그 저장
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
    // 이전 탭 로그 저장
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
    if (durationSec < 3) return; // 3초 미만은 무시

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

// 1분마다 주기적으로 현재 세션 ID 검색
async function syncActiveSession() {
    if (!deviceToken) return;
    try {
        const response = await fetch(`${SERVER_URL}/api/sessions/active`, {
            headers: { "Authorization": `Bearer ${deviceToken}` }
        });
        if (response.ok) {
            const data = await response.json();
            if (sessionId !== data.sessionId) {
                sessionId = data.sessionId;
                chrome.storage.local.set({ sessionId: data.sessionId });
                console.log("[세션 동기화]", sessionId);
            }
        } else if (response.status === 400 || response.status === 404) {
            if (sessionId) {
                sessionId = null;
                chrome.storage.local.set({ sessionId: null });
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
    if (!browserLogs.length || !deviceToken || !sessionId || !deviceId) {
        return;
    }

    // 현재 탭도 저장
    saveCurrentTabLog();

    const logsToSend = [...browserLogs];
    browserLogs = [];

    try {
        const response = await fetch(`${SERVER_URL}/api/browser-logs`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${deviceToken}`
            },
            body: JSON.stringify({
                sessionId: parseInt(sessionId),
                deviceId: parseInt(deviceId),
                logs: logsToSend
            })
        });

        if (response.ok) {
            console.log(`[전송] ${logsToSend.length}개 브라우저 로그 전송 완료`);
        } else {
            console.error("[오류] 전송 실패:", response.status);
            browserLogs = [...logsToSend, ...browserLogs]; // 실패 시 복구
        }
    } catch (e) {
        console.error("[오류] 서버 연결 실패:", e);
        browserLogs = [...logsToSend, ...browserLogs]; // 실패 시 복구
    }
}

// ── 주기적 전송 (1분마다) ─────────────────────────

chrome.alarms.create("sendLogs", { periodInMinutes: 1 });

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "sendLogs") {
        sendBrowserLogs();
    }
});

// ── 팝업으로부터 메시지 수신 ──────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "GET_STATUS") {
        sendResponse({
            isConnected: !!deviceToken,
            sessionId: sessionId,
            logCount: browserLogs.length
        });
    }

    if (message.type === "SAVE_CONFIG") {
        deviceToken = message.deviceToken;
        sessionId = message.sessionId;
        deviceId = message.deviceId;
        chrome.storage.local.set({
            deviceToken: message.deviceToken,
            sessionId: message.sessionId,
            deviceId: message.deviceId
        });
        sendResponse({ success: true });
    }

    if (message.type === "SEND_NOW") {
        sendBrowserLogs().then(() => sendResponse({ success: true }));
        return true; // 비동기 응답
    }

    return true;
});