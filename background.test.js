beforeEach(() => {
    jest.resetModules();
    global.__chromeTestHelpers.reset();
});

function getMessageListener() {
    return global.__chromeTestHelpers.listeners.onMessage[0];
}

test("서비스워커가 재시작돼도(모듈 재로드) storage에 저장된 deviceToken을 인식한다", async () => {
    await chrome.storage.local.set({ deviceToken: "device-token-123", sessionId: null, deviceId: 7 });

    require("./background.js");
    const onMessage = getMessageListener();

    const status = await new Promise((resolve) => {
        onMessage({ type: "GET_STATUS" }, {}, resolve);
    });

    expect(status.isConnected).toBe(true);
});

test("GET_STATUS는 storage에 deviceToken이 없으면 연결 안 됨으로 응답한다", async () => {
    require("./background.js");
    const onMessage = getMessageListener();

    const status = await new Promise((resolve) => {
        onMessage({ type: "GET_STATUS" }, {}, resolve);
    });

    expect(status.isConnected).toBe(false);
});

test("sendLogs 알람 리스너는 하나만 등록된다 (중복 리스너 없음)", () => {
    require("./background.js");

    expect(global.__chromeTestHelpers.listeners.onAlarm).toHaveLength(1);
});

test("SAVE_CONFIG 메시지를 받으면 storage에 저장하고 이후 GET_STATUS는 연결됨으로 응답한다", async () => {
    require("./background.js");
    const onMessage = getMessageListener();

    const saveResult = await new Promise((resolve) => {
        onMessage(
            { type: "SAVE_CONFIG", deviceToken: "test-token", deviceId: 9, sessionId: null },
            {},
            resolve
        );
    });

    expect(saveResult).toEqual({ success: true });
    expect(global.__chromeTestHelpers.storageData.deviceToken).toBe("test-token");
    expect(global.__chromeTestHelpers.storageData.deviceId).toBe(9);

    const status = await new Promise((resolve) => {
        onMessage({ type: "GET_STATUS" }, {}, resolve);
    });

    expect(status.isConnected).toBe(true);
});

test("세션 동기화는 프로덕션 API 서버로 요청을 보낸다", async () => {
    await chrome.storage.local.set({ deviceToken: "device-token-123", sessionId: null, deviceId: 7 });

    require("./background.js");
    const onAlarm = global.__chromeTestHelpers.listeners.onAlarm[0];

    await onAlarm({ name: "syncSession" });
    await new Promise(process.nextTick);
    await new Promise(process.nextTick);

    expect(global.fetch).toHaveBeenCalledWith(
        "https://api.studytracker.cloud/api/sessions/active",
        expect.anything()
    );
});

// ── 웹 → 확장 프로그램 자동 로그인 브릿지 ──────────────

const WEB_SENDER = { origin: "https://studytracker.cloud" };

function getExternalMessageListener() {
    return global.__chromeTestHelpers.listeners.onMessageExternal[0];
}

test("웹으로부터 WEB_LOGIN 메시지를 받으면 그 accessToken으로 기기를 등록하고 storage에 저장한다", async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ deviceToken: "device-token", deviceId: 1 }),
    });

    require("./background.js");
    const onMessageExternal = getExternalMessageListener();

    const result = await new Promise((resolve) => {
        onMessageExternal({ type: "WEB_LOGIN", accessToken: "web-access-token" }, WEB_SENDER, resolve);
    });

    expect(global.fetch).toHaveBeenCalledWith(
        "https://api.studytracker.cloud/api/auth/device",
        expect.objectContaining({
            method: "POST",
            headers: expect.objectContaining({ Authorization: "Bearer web-access-token" }),
        })
    );
    expect(result).toEqual({ success: true });
    expect(global.__chromeTestHelpers.storageData.deviceToken).toBe("device-token");
    expect(global.__chromeTestHelpers.storageData.deviceId).toBe(1);
});

test("이미 deviceToken이 있으면 WEB_LOGIN을 받아도 재등록하지 않는다 (기기 row가 계속 쌓이는 것 방지)", async () => {
    await chrome.storage.local.set({ deviceToken: "existing-device-token", sessionId: null, deviceId: 5 });
    global.fetch = jest.fn();

    require("./background.js");
    const onMessageExternal = getExternalMessageListener();

    const result = await new Promise((resolve) => {
        onMessageExternal({ type: "WEB_LOGIN", accessToken: "web-access-token" }, WEB_SENDER, resolve);
    });

    expect(global.fetch).not.toHaveBeenCalled();
    expect(result).toEqual({ success: true });
    expect(global.__chromeTestHelpers.storageData.deviceToken).toBe("existing-device-token");
});

test("WEB_LOGIN 처리 중 기기 등록이 실패하면 실패를 응답하고 아무것도 저장하지 않는다", async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({ ok: false });

    require("./background.js");
    const onMessageExternal = getExternalMessageListener();

    const result = await new Promise((resolve) => {
        onMessageExternal({ type: "WEB_LOGIN", accessToken: "web-access-token" }, WEB_SENDER, resolve);
    });

    expect(result.success).toBe(false);
    expect(global.__chromeTestHelpers.storageData.deviceToken).toBeUndefined();
});

test("studytracker.cloud가 아닌 출처에서 온 WEB_LOGIN은 거부한다 (manifest 설정 실수에 대한 이중 방어)", async () => {
    global.fetch = jest.fn();

    require("./background.js");
    const onMessageExternal = getExternalMessageListener();

    const result = await new Promise((resolve) => {
        onMessageExternal(
            { type: "WEB_LOGIN", accessToken: "web-access-token" },
            { origin: "https://evil.example.com" },
            resolve
        );
    });

    expect(global.fetch).not.toHaveBeenCalled();
    expect(result).toEqual({ success: false, error: "허용되지 않은 출처입니다." });
    expect(global.__chromeTestHelpers.storageData.deviceToken).toBeUndefined();
});
