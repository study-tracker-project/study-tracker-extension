/**
 * @jest-environment jsdom
 */

beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = `
        <div id="status" class="status"></div>
        <div id="login-form">
            <div id="error"></div>
            <button id="googleLoginBtn"></button>
        </div>
        <div id="connected-info" style="display:none">
            <button id="logoutBtn"></button>
        </div>
        <div id="info"></div>
    `;

    global.chrome = {
        identity: {
            getAuthToken: jest.fn(),
            removeCachedAuthToken: jest.fn((details, callback) => {
                if (callback) callback();
            }),
        },
        runtime: {
            sendMessage: jest.fn().mockResolvedValue({ success: true }),
            lastError: null,
        },
        storage: {
            local: { clear: jest.fn().mockResolvedValue(undefined) },
        },
    };

    global.fetch = jest.fn();
});

test("구글 로그인 버튼 클릭 시 chrome.identity.getAuthToken으로 받은 토큰을 백엔드로 전송한다", async () => {
    chrome.identity.getAuthToken.mockImplementation((options, callback) => {
        callback("fake-google-access-token");
    });

    global.fetch
        .mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({ accessToken: "app-access-token" }),
        })
        .mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({ deviceToken: "device-token", deviceId: 1 }),
        });

    require("./popup.js");
    document.dispatchEvent(new Event("DOMContentLoaded"));

    document.getElementById("googleLoginBtn").click();
    await new Promise(process.nextTick);
    await new Promise(process.nextTick);

    expect(global.fetch).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining("/api/auth/google/token"),
        expect.objectContaining({
            method: "POST",
            body: JSON.stringify({ accessToken: "fake-google-access-token" }),
        })
    );

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
        type: "SAVE_CONFIG",
        deviceToken: "device-token",
        deviceId: 1,
        sessionId: null,
    });
});
