const SERVER_URL = "http://localhost:8080";

document.addEventListener("DOMContentLoaded", async () => {
    await refreshStatus();

    document.getElementById("loginBtn").addEventListener("click", handleLogin);

    const logoutBtn = document.getElementById("logoutBtn");
    if (logoutBtn) {
        logoutBtn.addEventListener("click", handleLogout);
    }

    document.getElementById("sendBtn").addEventListener("click", async () => {
        const result = await chrome.runtime.sendMessage({ type: "SEND_NOW" });
        if (result.success) {
            document.getElementById("info").textContent = "전송 완료!";
        }
    });
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
        statusEl.textContent = "연결 안 됨 — 로그인이 필요해요";
        loginForm.style.display = "block";
        connectedInfo.style.display = "none";
    }
}

async function handleLogin() {
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value.trim();
    const errorEl = document.getElementById("error");
    errorEl.textContent = "";

    if (!email || !password) {
        errorEl.textContent = "이메일과 비밀번호를 입력해주세요.";
        return;
    }

    try {
        // 1. 로그인
        const loginRes = await fetch(`${SERVER_URL}/api/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password })
        });

        if (!loginRes.ok) {
            errorEl.textContent = "로그인 실패. 이메일/비밀번호를 확인해주세요.";
            return;
        }

        const loginData = await loginRes.json();
        const accessToken = loginData.accessToken;

        // 2. device_token 발급
        const deviceRes = await fetch(`${SERVER_URL}/api/auth/device`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${accessToken}`
            },
            body: JSON.stringify({
                deviceName: "Chrome Extension",
                deviceType: "PC"
            })
        });

        if (!deviceRes.ok) {
            errorEl.textContent = "기기 등록 실패.";
            return;
        }

        const deviceData = await deviceRes.json();

        // 3. background.js에 저장 요청
        await chrome.runtime.sendMessage({
            type: "SAVE_CONFIG",
            deviceToken: deviceData.deviceToken,
            deviceId: deviceData.deviceId,
            sessionId: null  // 자동 동기화가 채워줄 예정
        });

        await refreshStatus();
    } catch (e) {
        errorEl.textContent = "서버 연결에 실패했어요.";
        console.error(e);
    }
}

async function handleLogout() {
    await chrome.storage.local.clear();
    await chrome.runtime.sendMessage({
        type: "SAVE_CONFIG",
        deviceToken: null,
        deviceId: null,
        sessionId: null
    });
    await refreshStatus();
}