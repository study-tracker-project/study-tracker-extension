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
