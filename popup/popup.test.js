/**
 * @jest-environment jsdom
 */

beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = `
        <div id="status" class="status"></div>
        <div id="login-form"></div>
        <div id="connected-info" style="display:none">
            <button id="logoutBtn"></button>
        </div>
        <div id="info"></div>
    `;

    global.chrome = {
        runtime: {
            sendMessage: jest.fn().mockResolvedValue({ success: true, isConnected: false, sessionId: null, logCount: 0 }),
        },
        storage: {
            local: { clear: jest.fn().mockResolvedValue(undefined) },
        },
    };
});

test("연결 안 됨 상태에서는 웹에서 로그인하면 자동 연결된다는 안내를 보여준다", async () => {
    require("./popup.js");
    document.dispatchEvent(new Event("DOMContentLoaded"));
    await new Promise(process.nextTick);

    expect(document.getElementById("status").textContent).toBe("연결 안 됨 — 웹에서 로그인하면 자동으로 연결돼요");
});

test("로그아웃 버튼 클릭 시 storage를 비우고 background에 알린다", async () => {
    require("./popup.js");
    document.dispatchEvent(new Event("DOMContentLoaded"));

    document.getElementById("logoutBtn").click();
    await new Promise(process.nextTick);
    await new Promise(process.nextTick);

    expect(chrome.storage.local.clear).toHaveBeenCalled();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
        type: "SAVE_CONFIG",
        deviceToken: null,
        deviceId: null,
        sessionId: null,
    });
});
