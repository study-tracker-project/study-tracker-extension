document.addEventListener("DOMContentLoaded", async () => {
    const logoutBtn = document.getElementById("logoutBtn");
    if (logoutBtn) {
        logoutBtn.addEventListener("click", handleLogout);
    }

    document.getElementById("sendBtn")?.addEventListener("click", async () => {
        const result = await chrome.runtime.sendMessage({ type: "SEND_NOW" });
        if (result.success) {
            document.getElementById("info").textContent = "전송 완료!";
        }
    });

    await refreshStatus();
});

async function refreshStatus() {
    const status = await chrome.runtime.sendMessage({ type: "GET_STATUS" });

    const statusEl = document.getElementById("status");
    const loginForm = document.getElementById("login-form");
    const connectedInfo = document.getElementById("connected-info");
    const infoEl = document.getElementById("info");

    if (status.isConnected) {
        statusEl.className = "status connected";
        statusEl.textContent = "서버 연결됨";
        loginForm.style.display = "none";
        connectedInfo.style.display = "block";
        infoEl.textContent = `세션 ID: ${status.sessionId || "없음"} | 미전송 로그: ${status.logCount}개`;
    } else {
        statusEl.className = "status disconnected";
        statusEl.textContent = "연결 안 됨 — 웹에서 로그인하면 자동으로 연결돼요";
        loginForm.style.display = "block";
        connectedInfo.style.display = "none";
    }
}

async function handleLogout() {
    // 이 기기(브라우저)의 연결만 끊는다. 웹 로그인 세션은 그대로 유지되므로,
    // studytracker.cloud를 다시 열면(또는 새로고침하면) 브릿지가 자동으로
    // 재연결한다 — 완전히 끊으려면 웹에서도 로그아웃해야 한다.
    await chrome.storage.local.clear();
    await chrome.runtime.sendMessage({
        type: "SAVE_CONFIG",
        deviceToken: null,
        deviceId: null,
        sessionId: null
    });
    await refreshStatus();
}

if (typeof module !== "undefined") {
    module.exports = { handleLogout, refreshStatus };
}
