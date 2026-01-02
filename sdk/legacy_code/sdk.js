(function () {
    const Staminads = (function () {
        let instance;
        let config;

        function init(userConfig) {
            config = {
                version: '4.0.0',
                endpoint: userConfig.endpoint || 'https://photon.staminads.com',
                sessionTimeout: userConfig.sessionTimeout || 3600000, // 1 hour in milliseconds
                useBeacon: userConfig.use_beacon !== false, // Default to true
                workspace: userConfig.workspace,
                heartbeatInterval: userConfig.heartbeatInterval || 7000 // 7 seconds
            };

            const HEARTBEAT_DURATION = 420000; // 7 minutes in milliseconds

            const version = config.version;
            const endpoint = config.endpoint;
            const sessionTimeout = config.sessionTimeout;
            const useBeacon = config.useBeacon;
            const sessionKey = `stm_session_${config.workspace}`;
            let lastActiveTime = Date.now();
            let totalDuration = 0;
            let isActive = true;
            let session;
            let durationUpdateInterval;
            let heartbeatInterval;
            let maxScroll = 0;

            function generateUUID() {
                return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
                    const r = Math.random() * 16 | 0;
                    const v = c === 'x' ? r : (r & 0x3 | 0x8);
                    return v.toString(16);
                });
            }

            function updateSession(sessionData) {
                sessionData.updated_at = new Date().toISOString();
                sessionData.duration = totalDuration;
                localStorage.setItem(sessionKey, JSON.stringify(sessionData));
            }

            function createNewSession() {
                try {
                    const now = new Date().toISOString();
                    const newSession = {
                        id: generateUUID(),
                        created_at: now,
                        updated_at: now,
                        referrer: document.referrer || null,
                        landing_page: window.location.href,
                        last_active_time: Date.now(),
                        duration: 0
                    };
                    updateSession(newSession);
                    return newSession;
                } catch (error) {
                    console.error('Session creation error:', error);
                    const now = new Date().toISOString();
                    return {
                        id: generateUUID(),
                        created_at: now,
                        updated_at: now,
                        referrer: document.referrer || null,
                        landing_page: window.location.href,
                        last_active_time: Date.now(),
                        duration: 0
                    };
                }
            }

            function getOrCreateSession() {
                try {
                    const storedSession = localStorage.getItem(sessionKey);
                    if (storedSession) {
                        const parsedSession = JSON.parse(storedSession);
                        if (Date.now() - parsedSession.last_active_time < sessionTimeout) {
                            totalDuration = parsedSession.duration || 0;
                            updateSession(parsedSession);
                            return parsedSession;
                        }
                    }
                    return createNewSession();
                } catch (error) {
                    console.error('Session retrieval error:', error);
                    return createNewSession();
                }
            }

            function calculateMaxScroll() {
                const scrollHeight = Math.max(
                    document.documentElement.scrollHeight,
                    document.body.scrollHeight
                );
                const clientHeight = window.innerHeight;
                const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
                const scrollPercentage = Math.round((scrollTop / (scrollHeight - clientHeight)) * 100);
                maxScroll = Math.max(maxScroll, scrollPercentage);
            }

            function bindEvents() {
                try {
                    window.addEventListener('beforeunload', () => {
                        sendData();
                        storeSessionDataLocally();
                    });
                    window.addEventListener('unload', () => {
                        sendData();
                        storeSessionDataLocally();
                    });
                    document.addEventListener('visibilitychange', handleVisibilityChange);
                    window.addEventListener('blur', handleBlur);
                    window.addEventListener('focus', handleFocus);
                    window.addEventListener('scroll', calculateMaxScroll, { passive: true });
                    setInterval(checkSessionTimeout, 60000); // Check every minute
                    startDurationUpdate();
                    startHeartbeat();
                } catch (error) {
                    console.error('Event binding error:', error);
                }
            }

            function handleVisibilityChange() {
                if (document.hidden) {
                    pauseSession();
                    sendData(); // Send data immediately when page is hidden
                    storeSessionDataLocally();
                } else {
                    resumeSession();
                }
            }

            function handleBlur() {
                pauseSession();
                sendData();
                storeSessionDataLocally();
            }

            function handleFocus() {
                resumeSession();
                sendStoredData();
            }

            function pauseSession() {
                isActive = false;
                updateDuration();
                stopDurationUpdate();
            }

            function resumeSession() {
                isActive = true;
                lastActiveTime = Date.now();
                startDurationUpdate();
            }

            function updateDuration() {
                if (isActive) {
                    const now = Date.now();
                    totalDuration += Math.floor((now - lastActiveTime) / 1000);
                    lastActiveTime = now;
                    updateSession(session);
                }
            }

            function startDurationUpdate() {
                if (!durationUpdateInterval) {
                    durationUpdateInterval = setInterval(updateDuration, 1000);
                }
            }

            function stopDurationUpdate() {
                if (durationUpdateInterval) {
                    clearInterval(durationUpdateInterval);
                    durationUpdateInterval = null;
                }
            }

            function checkSessionTimeout() {
                updateDuration();
                if (Date.now() - session.last_active_time > sessionTimeout) {
                    sendData();
                    session = createNewSession();
                    totalDuration = 0;
                } else {
                    session.last_active_time = Date.now();
                    updateSession(session);
                }
            }

            function isRobotOrHeadless() {
                const botPatterns = [
                    /bot/i, /crawler/i, /spider/i, /googlebot/i, /bingbot/i, /yahoo/i,
                    /baidu/i, /msnbot/i, /yandex/i, /duckduckbot/i, /slurp/i, /headless/i
                ];
                const userAgent = navigator.userAgent.toLowerCase();

                if (botPatterns.some(pattern => pattern.test(userAgent))) {
                    return true;
                }

                return !(
                    'plugins' in navigator &&
                    navigator.languages !== undefined &&
                    !navigator.webdriver &&
                    'localStorage' in window &&
                    'sessionStorage' in window &&
                    'indexedDB' in window &&
                    'devicePixelRatio' in window &&
                    'hardwareConcurrency' in navigator
                );
            }

            function sendData(customPayload = null) {
                if (isRobotOrHeadless()) {
                    console.log('Robot detected, not sending data');
                    return;
                }

                updateDuration();
                const sessionPayload = {
                    id: session.id,
                    referrer: session.referrer,
                    landing_page: session.landing_page,
                    screen_width: window.screen.width,
                    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                    duration: totalDuration,
                    created_at: session.created_at,
                    updated_at: session.updated_at,
                    language: navigator.language || navigator.userLanguage,
                    max_scroll: maxScroll
                };

                const payload = {
                    workspace: config.workspace,
                    sent_at: new Date().toISOString(),
                    v: version,
                    kind: customPayload && typeof customPayload === 'object' && !('isTrusted' in customPayload) ? "conversion" : "session",
                    origin: window.location.origin,
                    [customPayload && typeof customPayload === 'object' && !('isTrusted' in customPayload) ? "conversion" : "session"]: customPayload && typeof customPayload === 'object' && !('isTrusted' in customPayload) ? customPayload : sessionPayload
                };

                sendPayloadImmediately(payload);
            }

            function sendPayloadImmediately(payload) {
                const url = `${endpoint}/data`;
                const data = JSON.stringify(payload);

                if (useBeacon && navigator.sendBeacon) {
                    const blob = new Blob([data], { type: 'application/json' });
                    if (navigator.sendBeacon(url, blob)) {
                        return; // Beacon sent successfully
                    }
                    // If sendBeacon fails, fall back to fetch with keepalive
                }

                // Use fetch with keepalive
                fetch(url, {
                    method: 'POST',
                    body: data,
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    keepalive: true
                }).catch(error => console.error('Fetch failed:', error));
            }

            function trackConversion({ id, created_at, action_id, conversion_value }) {
                if (conversion_value !== undefined && typeof conversion_value !== 'number') {
                    throw new Error('conversion_value must be a number');
                }
                const conversionPayload = { id, created_at, action_id, conversion_value, session_id: session.id };
                sendData(conversionPayload);
            }

            function getTotalDuration() {
                updateDuration(); // Ensure the duration is up-to-date
                return totalDuration;
            }

            function startHeartbeat() {
                // Only start heartbeat for desktop users (> 1000px)
                if (window.screen.width <= 1000) {
                    return;
                }

                heartbeatInterval = setInterval(() => {
                    sendData();
                }, config.heartbeatInterval);

                // Stop heartbeat after 7 minutes
                setTimeout(() => {
                    if (heartbeatInterval) {
                        clearInterval(heartbeatInterval);
                        heartbeatInterval = null;
                    }
                }, HEARTBEAT_DURATION);
            }

            function storeSessionDataLocally() {
                localStorage.setItem('lastSessionData', JSON.stringify(getSessionData()));
            }

            function sendStoredData() {
                const storedData = localStorage.getItem('lastSessionData');
                if (storedData) {
                    sendPayloadImmediately(JSON.parse(storedData));
                    localStorage.removeItem('lastSessionData');
                }
            }

            function getSessionData() {
                return {
                    workspace: config.workspace,
                    sent_at: new Date().toISOString(),
                    v: version,
                    kind: "session",
                    session: {
                        id: session.id,
                        referrer: session.referrer,
                        landing_page: session.landing_page,
                        screen_width: window.screen.width,
                        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                        duration: totalDuration,
                        created_at: session.created_at,
                        updated_at: session.updated_at,
                        language: navigator.language || navigator.userLanguage,
                        max_scroll: maxScroll
                    }
                };
            }

            // Initialize
            session = getOrCreateSession();
            bindEvents();
            sendStoredData(); // Attempt to send any stored data from previous sessions

            // Public API
            return {
                getTotalDuration,
                trackConversion
            };
        }

        return {
            init: function (userConfig) {
                if (!instance) {
                    if (!userConfig || !userConfig.workspace) {
                        throw new Error('Workspace ID is required');
                    }
                    instance = init(userConfig);
                }
                return instance;
            },
            trackConversion: function (conversionData) {
                if (!instance) {
                    throw new Error('Staminads must be initialized before calling trackConversion');
                }
                return instance.trackConversion(conversionData);
            },
            getTotalDuration: function () {
                if (!instance) {
                    throw new Error('Staminads must be initialized before calling getTotalDuration');
                }
                return instance.getTotalDuration();
            },
            get config() {
                if (!config) {
                    throw new Error('Staminads must be initialized before accessing config');
                }
                return { ...config }; // Return a copy to prevent direct modification
            }
        };
    })();

    // Expose Staminads globally
    window.Staminads = Staminads;

})();

// Usage example:
// Staminads.init({ workspace: 'MY_WORKSPACE_ID' });
// Staminads.trackConversion({ id: 'conversion_id', created_at: new Date().toISOString(), conversion_value: 100 });
// console.log(Staminads.config);