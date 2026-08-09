const SERVER_URL = "https://api.studytracker.cloud";

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
            // 백엔드가 토큰을 거부한 경우, Chrome에 캐시된 액세스 토큰을 그대로 두면
            // 재시도 때마다 같은(이미 거부된) 토큰이 재사용되어 항상 같은 이유로 실패한다.
            // 캐시를 지워서 다음 로그인 시도가 새 토큰을 받을 수 있도록 한다. (완료를 기다리지 않음)
            chrome.identity.removeCachedAuthToken({ token: googleAccessToken }, () => {});
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

function getCachedGoogleAccessToken() {
    return new Promise((resolve) => {
        try {
            chrome.identity.getAuthToken({ interactive: false }, (token) => {
                // interactive: false일 때 캐시된 토큰이 없으면 chrome.runtime.lastError가
                // 설정되거나 token이 비어있을 수 있다 — 로그아웃을 막지 않고 그냥 넘어간다.
                if (chrome.runtime.lastError || !token) {
                    resolve(null);
                    return;
                }
                resolve(token);
            });
        } catch (e) {
            resolve(null);
        }
    });
}

async function handleLogout() {
    // Chrome이 캐싱한 OAuth 액세스 토큰도 함께 제거해야 로그아웃 후 다시 로그인할 때
    // 계정 선택 화면이 뜨고, 다른 구글 계정으로 전환할 수 있다.
    const cachedToken = await getCachedGoogleAccessToken();
    if (cachedToken) {
        chrome.identity.removeCachedAuthToken({ token: cachedToken }, () => {});
    }

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
