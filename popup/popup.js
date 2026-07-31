const SERVER_URL = "http://localhost:8080";

document.addEventListener("DOMContentLoaded", async () => {
    document.getElementById("googleLoginBtn").addEventListener("click", handleGoogleLogin);

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
        statusEl.textContent = "연결 안 됨 — 로그인이 필요해요";
        loginForm.style.display = "block";
        connectedInfo.style.display = "none";
    }
}

function getGoogleAccessToken() {
    return new Promise((resolve, reject) => {
        chrome.identity.getAuthToken({ interactive: true }, (token) => {
            if (chrome.runtime.lastError || !token) {
                reject(chrome.runtime.lastError || new Error("토큰을 받지 못했습니다."));
                return;
            }
            resolve(token);
        });
    });
}

async function handleGoogleLogin() {
    const errorEl = document.getElementById("error");
    errorEl.textContent = "";

    try {
        // 1. Chrome이 관리하는 Google 계정으로 액세스 토큰 획득
        const googleAccessToken = await getGoogleAccessToken();

        // 2. 백엔드에 액세스 토큰 전달 → 우리 서비스 JWT 발급
        const loginRes = await fetch(`${SERVER_URL}/api/auth/google/token`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ accessToken: googleAccessToken })
        });

        if (!loginRes.ok) {
            errorEl.textContent = "Google 로그인 실패.";
            return;
        }

        const loginData = await loginRes.json();
        const accessToken = loginData.accessToken;

        // 3. device_token 발급
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

        // 4. background.js에 저장 요청
        await chrome.runtime.sendMessage({
            type: "SAVE_CONFIG",
            deviceToken: deviceData.deviceToken,
            deviceId: deviceData.deviceId,
            sessionId: null
        });

        await refreshStatus();
    } catch (e) {
        errorEl.textContent = "Google 로그인에 실패했어요.";
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

if (typeof module !== "undefined") {
    module.exports = { handleGoogleLogin, handleLogout, refreshStatus };
}
