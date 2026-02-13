/**
 * encore.fm player
 * Minimal HLS audio player with reconnection logic and custom controls.
 */
document.addEventListener('DOMContentLoaded', function() {
    const audio = document.getElementById('audio');
    const playButton = document.getElementById('playButton');
    const connectionStatus = document.getElementById('connectionStatus');
    const connectionIndicator = document.getElementById('connectionIndicator');

    // Buffer status elements
    const waitingContainer = document.getElementById('waitingContainer');
    const playerContainer = document.getElementById('playerContainer');
    const countdownTime = document.getElementById('countdownTime');
    const progressBar = document.getElementById('progressBar');
    const bufferStatus = document.getElementById('bufferStatus');

    // Track info elements
    const trackInfo = document.getElementById('trackInfo');
    const trackArt = document.getElementById('trackArt');
    const trackTitle = document.getElementById('trackTitle');
    const trackArtist = document.getElementById('trackArtist');

    // Station elements
    const stationLogo = document.getElementById('stationLogo');
    const stationName = document.getElementById('stationName');

    // Show elements
    const showInfo = document.getElementById('showInfo');
    const showArt = document.getElementById('showArt');
    const showTitle = document.getElementById('showTitle');
    const showSubtitle = document.getElementById('showSubtitle');
    const showSynopsis = document.getElementById('showSynopsis');

    const streamUrl = '/api/playlist';
    let metadataPollTimer = null;
    let currentTrackId = null;
    let currentShowId = null;
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
    let isPlaying = false;
    let isLoading = false;

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

    function setConnection(state) {
        connectionStatus.textContent = state;
        connectionIndicator.className = 'indicator';
        if (state === 'Connected') connectionIndicator.classList.add('connected');
        else if (state === 'Connecting' || state === 'Buffering') connectionIndicator.classList.add('connecting');
        else if (state === 'Error') connectionIndicator.classList.add('error');
    }

    function setLoading(loading) {
        isLoading = loading;
        if (loading) {
            playButton.classList.add('loading');
        } else {
            playButton.classList.remove('loading');
        }
    }

    function updatePlayButtonState() {
        if (isPlaying) {
            playButton.classList.add('playing');
            playButton.setAttribute('aria-label', 'Pause');
        } else {
            playButton.classList.remove('playing');
            playButton.setAttribute('aria-label', 'Play');
        }
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
            setConnection('Error');
            setLoading(false);
            cancelReconnect();
            return;
        }

        reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(1.5, reconnectAttempts), 10000);
        setConnection('Connecting');

        reconnectTimer = setTimeout(initPlayer, delay);
    }

    function initPlayer() {
        cancelReconnect();
        setConnection('Connecting');
        setLoading(true);

        if (hls) {
            hls.destroy();
            hls = null;
        }

        if (Hls.isSupported()) {
            hls = new Hls(hlsConfig);

            hls.on(Hls.Events.MANIFEST_PARSED, function() {
                setConnection('Connected');
                setLoading(false);
                // Auto-play after manifest is loaded
                audio.play().catch(function() {});
            });

            hls.on(Hls.Events.FRAG_LOADED, function() {
                setConnection('Connected');
            });

            hls.on(Hls.Events.ERROR, function(event, data) {
                if (!data.fatal) return;

                switch (data.type) {
                    case Hls.ErrorTypes.NETWORK_ERROR:
                        setConnection('Error');
                        if (data.details === Hls.ErrorDetails.MANIFEST_LOAD_ERROR ||
                            data.details === Hls.ErrorDetails.MANIFEST_LOAD_TIMEOUT) {
                            scheduleReconnect();
                        } else {
                            hls.startLoad();
                        }
                        break;
                    case Hls.ErrorTypes.MEDIA_ERROR:
                        hls.recoverMediaError();
                        break;
                    default:
                        setConnection('Error');
                        setLoading(false);
                        hls.destroy();
                        hls = null;
                        break;
                }
            });

            hls.loadSource(streamUrl);
            hls.attachMedia(audio);

        } else if (audio.canPlayType('application/vnd.apple.mpegurl')) {
            // Native HLS (Safari/iOS)
            audio.src = streamUrl;

            audio.addEventListener('loadedmetadata', function() {
                setConnection('Connected');
                setLoading(false);
                audio.play().catch(function() {});
            });

            audio.addEventListener('error', function() {
                setConnection('Error');
                scheduleReconnect();
            });
        } else {
            setConnection('Error');
            setLoading(false);
            return;
        }

        // Audio event listeners
        audio.addEventListener('play', function() {
            isPlaying = true;
            updatePlayButtonState();
            setConnection('Connected');
        });

        audio.addEventListener('pause', function() {
            isPlaying = false;
            updatePlayButtonState();
        });

        audio.addEventListener('waiting', function() {
            setConnection('Buffering');
        });

        audio.addEventListener('playing', function() {
            isPlaying = true;
            updatePlayButtonState();
            setConnection('Connected');
            setLoading(false);
        });
    }

    // Track if player has been initialized
    let playerInitialized = false;

    // Custom play button handler
    playButton.addEventListener('click', function() {
        if (isLoading) return;

        if (!playerInitialized) {
            // First play - initialize player
            playerInitialized = true;
            initPlayer();
        } else if (audio.paused) {
            setLoading(true);
            audio.play().then(function() {
                setLoading(false);
            }).catch(function() {
                setLoading(false);
            });
        } else {
            audio.pause();
        }
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
        bufferStatus.textContent = formatTime(currentBufferSecs) + ' of ' + formatTime(requiredBufferSecs) + ' buffered';
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
        playerContainer.style.display = 'flex';
        bufferReady = true;
        // Start fetching track metadata
        startMetadataPolling();
    }

    function showWaiting() {
        waitingContainer.style.display = 'flex';
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
            bufferStatus.textContent = 'Checking...';
        }
    }

    // Check buffer status on load and poll every 30 seconds
    checkBufferStatus();
    statusPollTimer = setInterval(checkBufferStatus, 30000);

    /**
     * Fetch and display current track metadata
     * Errors are silently handled - metadata is non-critical
     */
    async function fetchMetadata() {
        try {
            const response = await fetch('/metadata/current');
            const data = await response.json();

            // Update station info (usually static)
            if (data.station) {
                updateStationDisplay(data.station);
            }

            // Update show info
            if (data.show) {
                if (data.show.id !== currentShowId) {
                    currentShowId = data.show.id;
                    updateShowDisplay(data.show);
                }
            } else {
                showDefaultShowInfo();
            }

            // Update track info
            if (data.track && data.track.title) {
                if (data.track.id !== currentTrackId) {
                    currentTrackId = data.track.id;
                    updateTrackDisplay(data.track);
                }
            } else {
                if (currentTrackId !== 'waiting') {
                    currentTrackId = 'waiting';
                }
                showWaitingForTrack(data.trackAvailableIn);
            }
        } catch (error) {
            // Silently fail - metadata is non-critical
            console.debug('Metadata fetch failed:', error.message);
            if (currentTrackId !== 'waiting') {
                currentTrackId = 'waiting';
                showWaitingForTrack();
            }
        }
    }

    /**
     * Update station display (in header)
     */
    function updateStationDisplay(station) {
        if (station.name && stationName) {
            // Use short name for header
            const shortName = station.name.replace('BBC Radio ', '').replace('BBC ', '');
            stationName.textContent = shortName;
        }
        if (station.logoUrl && stationLogo) {
            stationLogo.src = station.logoUrl;
        }
    }

    /**
     * Update show/programme display
     */
    function updateShowDisplay(show) {
        // Update show title
        if (showTitle) {
            showTitle.textContent = show.title || 'BBC Radio 6 Music';
        }

        // Update subtitle (prefer presenter if available)
        if (showSubtitle) {
            const subtitle = show.presenter || show.subtitle || '';
            showSubtitle.textContent = subtitle;
        }

        // Update synopsis
        if (showSynopsis) {
            showSynopsis.textContent = show.synopsis || '';
        }

        // Update show artwork
        if (showArt && showInfo) {
            if (show.imageUrl) {
                showArt.src = show.imageUrl;
                showArt.classList.remove('hidden');
                showInfo.classList.remove('no-art');
                showArt.onerror = function() {
                    this.classList.add('hidden');
                    showInfo.classList.add('no-art');
                };
            } else {
                showArt.src = '';
                showArt.classList.add('hidden');
                showInfo.classList.add('no-art');
            }
        }
    }

    /**
     * Show default show info when no show data available
     */
    function showDefaultShowInfo() {
        if (showTitle) {
            showTitle.textContent = 'BBC Radio 6 Music';
        }
        if (showSubtitle) {
            showSubtitle.textContent = '8 hours delayed';
        }
        if (showSynopsis) {
            showSynopsis.textContent = '';
        }
        if (showArt && showInfo) {
            showArt.src = '';
            showArt.classList.add('hidden');
            showInfo.classList.add('no-art');
        }
    }

    /**
     * Update the track display with new metadata
     */
    function updateTrackDisplay(track) {
        // Add transition class briefly
        trackInfo.classList.add('changing');
        setTimeout(function() {
            trackInfo.classList.remove('changing');
        }, 300);

        // Remove loading/no-art states
        trackInfo.classList.remove('loading', 'no-art');

        // Update title (track name)
        trackTitle.textContent = track.title || 'Unknown Track';

        // Update artist
        trackArtist.textContent = track.artist || 'Unknown Artist';

        // Update album art
        if (track.imageUrl) {
            trackArt.src = track.imageUrl;
            trackArt.classList.remove('hidden');
            trackArt.onerror = function() {
                // Hide on load error
                this.classList.add('hidden');
                trackInfo.classList.add('no-art');
            };
        } else {
            trackArt.src = '';
            trackArt.classList.add('hidden');
            trackInfo.classList.add('no-art');
        }
    }

    /**
     * Show waiting state when no track info is available yet
     * @param {number|null} availableInSeconds - Seconds until track info becomes available
     */
    function showWaitingForTrack(availableInSeconds) {
        trackInfo.classList.add('loading', 'no-art');
        trackTitle.textContent = 'Track Info';

        if (availableInSeconds && availableInSeconds > 0) {
            const hours = Math.floor(availableInSeconds / 3600);
            const minutes = Math.floor((availableInSeconds % 3600) / 60);

            let timeStr;
            if (hours > 0) {
                timeStr = hours + 'h ' + minutes + 'm';
            } else {
                timeStr = minutes + ' min';
            }
            trackArtist.textContent = 'Available in ' + timeStr;
        } else {
            trackArtist.textContent = 'Waiting for track info...';
        }

        trackArt.src = '';
        trackArt.classList.add('hidden');
    }

    /**
     * Start polling for metadata
     */
    function startMetadataPolling() {
        // Show initial loading state
        showWaitingForTrack();
        // Initial fetch after short delay
        setTimeout(fetchMetadata, 500);
        // Poll every 30 seconds
        if (!metadataPollTimer) {
            metadataPollTimer = setInterval(fetchMetadata, 30000);
        }
    }

    /**
     * Stop metadata polling
     */
    function stopMetadataPolling() {
        if (metadataPollTimer) {
            clearInterval(metadataPollTimer);
            metadataPollTimer = null;
        }
    }
});
