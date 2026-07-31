const storageData = {};
const listeners = {
    onInstalled: [],
    onStartup: [],
    onMessage: [],
    onAlarm: [],
};

global.chrome = {
    storage: {
        local: {
            get: (keys) =>
                Promise.resolve(
                    keys.reduce((acc, key) => {
                        acc[key] = storageData[key];
                        return acc;
                    }, {})
                ),
            set: (values) => {
                Object.assign(storageData, values);
                return Promise.resolve();
            },
            clear: () => {
                Object.keys(storageData).forEach((key) => delete storageData[key]);
                return Promise.resolve();
            },
        },
    },
    runtime: {
        onInstalled: { addListener: (fn) => listeners.onInstalled.push(fn) },
        onStartup: { addListener: (fn) => listeners.onStartup.push(fn) },
        onMessage: { addListener: (fn) => listeners.onMessage.push(fn) },
    },
    alarms: {
        create: () => {},
        onAlarm: { addListener: (fn) => listeners.onAlarm.push(fn) },
    },
    tabs: {
        onActivated: { addListener: () => {} },
        onUpdated: { addListener: () => {} },
        query: () => Promise.resolve([]),
    },
    windows: {
        onFocusChanged: { addListener: () => {} },
        WINDOW_ID_NONE: -1,
    },
};

global.fetch = jest.fn(() =>
    Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ sessionId: null }) })
);

global.__chromeTestHelpers = {
    storageData,
    listeners,
    reset() {
        Object.keys(storageData).forEach((key) => delete storageData[key]);
        Object.keys(listeners).forEach((key) => (listeners[key].length = 0));
        global.fetch = jest.fn(() =>
            Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ sessionId: null }) })
        );
    },
};
