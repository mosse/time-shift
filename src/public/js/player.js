/**
 * Time-Shifted Radio Player
 * Minimal HLS audio player with reconnection logic.
 */
document.addEventListener('DOMContentLoaded', function() {
    const audio = document.getElementById('audio');
    const statusEl = document.getElementById('status');
    const connectionStatus = document.getElementById('connectionStatus');
    const connectionIndicator = document.getElementById('connectionIndicator');

    // Buffer status elements
    const waitingContainer = document.getElementById('waitingContainer');
    const playerContainer = document.getElementById('playerContainer');
    const countdownTime = document.getElementById('countdownTime');
    const progressBar = document.getElementById('progressBar');
    const bufferStatus = document.getElementById('bufferStatus');

    const streamUrl = '/api/playlist';
    let hls = null;
    let reconnectTimer = null;
    let reconnectAttempts = 0;
    const maxReconnectAttempts = 5;
    let statusPollTimer = null;
    let countdownTimer = null;
    let bufferReady = false;
    let secondsRemaining = 0;
    let currentBufferSecs = 0;
    let requiredBufferSecs = 0;

    const hlsConfig = {
        debug: false,
        manifestLoadingMaxRetry: 5,
        manifestLoadingRetryDelay: 1000,
        manifestLoadingMaxRetryTimeout: 10000,
        startLevel: -1,
        initialLiveManifestSize: 1,
        levelLoadingTimeOut: 10000,
        fragLoadingTimeOut: 20000,
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 90,
        // Live stream settings
        liveSyncDurationCount: 3,
        liveMaxLatencyDurationCount: 10,
        liveDurationInfinity: true,
        // Keep polling for new segments
        manifestLoadingTimeOut: 10000,
        levelLoadingMaxRetry: 4,
        fragLoadingMaxRetry: 6
    };

    function setStatus(message, type) {
        statusEl.textContent = message;
        statusEl.className = 'status';
        if (type === 'error' || type === 'warn') {
            statusEl.classList.add(type);
        }
    }

    function setConnection(state) {
        connectionStatus.textContent = state;
        connectionIndicator.className = 'indicator';
        if (state === 'Connected') connectionIndicator.classList.add('connected');
        else if (state === 'Connecting' || state === 'Buffering') connectionIndicator.classList.add('connecting');
        else if (state === 'Error') connectionIndicator.classList.add('error');
    }

    function cancelReconnect() {
        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }
        reconnectAttempts = 0;
    }

    function scheduleReconnect() {
        if (reconnectAttempts >= maxReconnectAttempts) {
            setStatus('Connection failed. Please refresh the page to try again.', 'error');
            setConnection('Error');
            cancelReconnect();
            return;
        }

        reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(1.5, reconnectAttempts), 10000);
        setStatus('Connection lost. Reconnecting (' + reconnectAttempts + '/' + maxReconnectAttempts + ')...', 'warn');
        setConnection('Connecting');

        reconnectTimer = setTimeout(initPlayer, delay);
    }

    function initPlayer() {
        cancelReconnect();
        setStatus('Connecting...', 'warn');
        setConnection('Connecting');

        if (hls) {
            hls.destroy();
            hls = null;
        }

        if (Hls.isSupported()) {
            hls = new Hls(hlsConfig);

            hls.on(Hls.Events.MANIFEST_PARSED, function() {
                setStatus('Stream ready. Press play to listen.');
                setConnection('Connected');
            });

            hls.on(Hls.Events.FRAG_LOADED, function() {
                setConnection('Connected');
            });

            hls.on(Hls.Events.ERROR, function(event, data) {
                if (!data.fatal) return;

                switch (data.type) {
                    case Hls.ErrorTypes.NETWORK_ERROR:
                        setStatus('Network error. Recovering...', 'error');
                        setConnection('Error');
                        if (data.details === Hls.ErrorDetails.MANIFEST_LOAD_ERROR ||
                            data.details === Hls.ErrorDetails.MANIFEST_LOAD_TIMEOUT) {
                            scheduleReconnect();
                        } else {
                            hls.startLoad();
                        }
                        break;
                    case Hls.ErrorTypes.MEDIA_ERROR:
                        setStatus('Media error. Recovering...', 'error');
                        hls.recoverMediaError();
                        break;
                    default:
                        setStatus('Playback error. Please refresh.', 'error');
                        setConnection('Error');
                        hls.destroy();
                        hls = null;
                        break;
                }
            });

            hls.loadSource(streamUrl);
            hls.attachMedia(audio);

        } else if (audio.canPlayType('application/vnd.apple.mpegurl')) {
            // Native HLS (Safari)
            audio.src = streamUrl;

            audio.addEventListener('loadedmetadata', function() {
                setStatus('Stream ready. Press play to listen.');
                setConnection('Connected');
            });

            audio.addEventListener('error', function() {
                setStatus('Playback error. Reconnecting...', 'error');
                setConnection('Error');
                scheduleReconnect();
            });
        } else {
            setStatus('HLS is not supported in this browser. Try Chrome, Firefox, or Safari.', 'error');
            setConnection('Error');
            return;
        }

        audio.addEventListener('play', function() {
            setStatus('Playing');
            setConnection('Connected');
        });

        audio.addEventListener('pause', function() {
            setStatus('Paused');
        });

        audio.addEventListener('waiting', function() {
            setStatus('Buffering...', 'warn');
            setConnection('Buffering');
        });

        audio.addEventListener('playing', function() {
            setStatus('Playing');
            setConnection('Connected');
        });
    }

    // Start on first user interaction with the play button (via native <audio> controls)
    audio.addEventListener('play', function onFirstPlay() {
        if (!hls && Hls.isSupported()) {
            initPlayer();
            // After init, auto-play
            var waitForReady = setInterval(function() {
                if (hls && audio.readyState >= 2) {
                    clearInterval(waitForReady);
                    audio.play().catch(function() {});
                }
            }, 200);
        }
        audio.removeEventListener('play', onFirstPlay);
    });

    function formatTime(seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;
        return String(hours).padStart(2, '0') + ':' +
               String(minutes).padStart(2, '0') + ':' +
               String(secs).padStart(2, '0');
    }

    function updateCountdownDisplay() {
        const percent = Math.min(100, (currentBufferSecs / requiredBufferSecs) * 100);
        countdownTime.textContent = formatTime(secondsRemaining);
        progressBar.style.width = percent.toFixed(1) + '%';
        bufferStatus.textContent = formatTime(currentBufferSecs) + ' of ' + formatTime(requiredBufferSecs) + ' buffered (' + percent.toFixed(1) + '%)';
    }

    function tickCountdown() {
        if (secondsRemaining > 0) {
            secondsRemaining--;
            currentBufferSecs++;
            updateCountdownDisplay();
        }
        if (secondsRemaining <= 0 && !bufferReady) {
            checkBufferStatus();
        }
    }

    function updateBufferUI(data) {
        currentBufferSecs = data.currentBufferSeconds;
        requiredBufferSecs = data.requiredBufferSeconds;
        secondsRemaining = data.secondsUntilReady;
        updateCountdownDisplay();
    }

    function showPlayer() {
        if (countdownTimer) {
            clearInterval(countdownTimer);
            countdownTimer = null;
        }
        waitingContainer.style.display = 'none';
        playerContainer.style.display = 'block';
        bufferReady = true;
        initPlayer();
    }

    function showWaiting() {
        waitingContainer.style.display = 'block';
        playerContainer.style.display = 'none';
        if (!countdownTimer) {
            countdownTimer = setInterval(tickCountdown, 1000);
        }
    }

    async function checkBufferStatus() {
        try {
            const response = await fetch('/api/status');
            const data = await response.json();

            if (data.bufferReady) {
                updateBufferUI(data.bufferReady);

                if (data.bufferReady.ready) {
                    if (statusPollTimer) {
                        clearInterval(statusPollTimer);
                        statusPollTimer = null;
                    }
                    showPlayer();
                } else {
                    showWaiting();
                }
            }
        } catch (error) {
            bufferStatus.textContent = 'Error checking buffer status';
        }
    }

    // Check buffer status on load and poll every 30 seconds
    checkBufferStatus();
    statusPollTimer = setInterval(checkBufferStatus, 30000);
});
