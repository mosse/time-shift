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
    const bufferGrid = document.getElementById('bufferGrid');
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
    let gridPollTimer = null;
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
            window.encoreHls = hls; // exposed for debugging

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
        countdownTime.textContent = formatTime(secondsRemaining);
        bufferStatus.textContent = formatTime(currentBufferSecs) + ' of ' + formatTime(requiredBufferSecs) + ' buffered';
    }

    /**
     * Render the buffer grid visualization
     * @param {Array} blocks - Array of block data from API
     * @param {Element} [targetEl] - Grid container (defaults to the waiting-screen grid)
     */
    function renderBufferGrid(blocks, targetEl) {
        var grid = targetEl || bufferGrid;
        if (!grid || !blocks) return;

        // Clear existing blocks
        grid.innerHTML = '';

        // Render each block
        blocks.forEach(function(block) {
            var div = document.createElement('div');
            div.className = 'buffer-block level-' + block.level;
            if (block.isPlaybackZone && block.level > 0) {
                div.classList.add('playback-zone');
            }
            if (block.hasGap) {
                div.classList.add('gap-block');
            }

            // Add tooltip with details
            var hoursAgo = block.hoursAgo;
            var minsInHour = Math.floor(((block.index % 6) * 10));
            var timeLabel = hoursAgo + 'h ' + minsInHour + 'm ago';
            div.title = timeLabel + ' - ' + block.segmentCount + ' segments' +
                (block.hasGap ? ' - recording gap' : '');

            grid.appendChild(div);
        });
    }

    /**
     * Fetch buffer grid data from API
     * @param {Element} [targetEl] - Grid container to render into
     */
    async function fetchBufferGrid(targetEl) {
        try {
            var response = await fetch('/api/buffer-grid');
            var data = await response.json();

            if (data.blocks) {
                renderBufferGrid(data.blocks, targetEl);
            }
        } catch (error) {
            console.debug('Buffer grid fetch failed:', error.message);
        }
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
        if (gridPollTimer) {
            clearInterval(gridPollTimer);
            gridPollTimer = null;
        }
        waitingContainer.style.display = 'none';
        // Clear the inline display so the stylesheet controls layout
        // (flex on mobile, two-column grid on desktop)
        playerContainer.style.display = '';
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
        // Poll grid every 10 seconds for visual updates
        if (!gridPollTimer) {
            gridPollTimer = setInterval(fetchBufferGrid, 10000);
        }
    }

    async function checkBufferStatus() {
        try {
            const response = await fetch('/api/status');
            const data = await response.json();

            // Health rollup rides along on every status poll
            if (data.health) {
                updateHealthUI(data.health);
            }

            if (data.bufferReady) {
                updateBufferUI(data.bufferReady);

                if (data.bufferReady.ready) {
                    // Keep the status poll running - it feeds the health panel
                    if (!bufferReady) {
                        showPlayer();
                    }
                } else {
                    showWaiting();
                    // Fetch grid visualization
                    fetchBufferGrid();
                }
            }
        } catch (error) {
            bufferStatus.textContent = 'Checking...';
        }
    }

    /**
     * Stream health panel
     */
    const healthToggle = document.getElementById('healthToggle');
    const healthDot = document.getElementById('healthDot');
    const healthPanel = document.getElementById('healthPanel');
    const healthRecorder = document.getElementById('healthRecorder');
    const healthContinuity = document.getElementById('healthContinuity');
    const healthGrid = document.getElementById('healthGrid');
    const healthDownloads = document.getElementById('healthDownloads');
    const healthDisk = document.getElementById('healthDisk');
    const diskBarFill = document.getElementById('diskBarFill');
    let healthGridTimer = null;
    let latestHealth = null;

    function formatDurationShort(totalSeconds) {
        if (totalSeconds === null || totalSeconds === undefined) return '--';
        var hours = Math.floor(totalSeconds / 3600);
        var minutes = Math.floor((totalSeconds % 3600) / 60);
        if (hours > 0) return hours + 'h ' + minutes + 'm';
        if (minutes > 0) return minutes + 'm';
        return Math.floor(totalSeconds) + 's';
    }

    function formatBytes(bytes) {
        if (bytes === null || bytes === undefined) return '--';
        var gb = bytes / (1024 * 1024 * 1024);
        if (gb >= 1) return gb.toFixed(1) + ' GB';
        return Math.round(bytes / (1024 * 1024)) + ' MB';
    }

    function updateHealthUI(health) {
        latestHealth = health;

        if (healthDot) {
            healthDot.className = 'health-dot ' + (health.state || 'good');
        }

        // Only refresh panel text when it's visible
        if (!healthPanel || healthPanel.hidden) return;

        if (healthRecorder) {
            if (health.recorder.live) {
                healthRecorder.textContent = 'Recording — last segment ' +
                    formatDurationShort(health.recorder.lastSegmentAgeSec) + ' ago';
            } else if (health.recorder.lastSegmentAgeSec !== null) {
                healthRecorder.textContent = 'Recorder stalled — no new audio for ' +
                    formatDurationShort(health.recorder.lastSegmentAgeSec);
            } else {
                healthRecorder.textContent = 'Recorder starting up…';
            }
        }

        if (healthContinuity) {
            var playback = health.playback || {};
            if (!playback.playheadBuffered) {
                healthContinuity.textContent = 'Buffer still filling — playback position not reached yet';
            } else if (playback.nextGap && playback.nextGap.inSec === 0) {
                healthContinuity.textContent = 'Playing through a gap — ' +
                    formatDurationShort(playback.nextGap.durationSec) + ' of audio missing';
            } else if (playback.nextGap) {
                healthContinuity.textContent = 'Gap ahead in ' +
                    formatDurationShort(playback.nextGap.inSec) + ' (' +
                    formatDurationShort(playback.nextGap.durationSec) + ' missing)';
            } else {
                healthContinuity.textContent = 'Continuous playback for ' +
                    formatDurationShort(playback.continuousForSec);
            }
        }

        if (healthDownloads) {
            var rate = health.downloads ? health.downloads.successRatePercent : null;
            healthDownloads.textContent = rate === null
                ? 'Downloads: measuring…'
                : 'Downloads: ' + rate + '% success';
        }

        if (health.disk && healthDisk && diskBarFill) {
            var pct = health.disk.capBytes > 0
                ? Math.min(100, Math.round((health.disk.usedBytes / health.disk.capBytes) * 100))
                : 0;
            diskBarFill.style.width = pct + '%';
            diskBarFill.className = 'disk-bar-fill' + (health.disk.pressure ? ' pressure' : '');
            healthDisk.textContent = 'Storage: ' + formatBytes(health.disk.usedBytes) +
                ' of ' + formatBytes(health.disk.capBytes) +
                (health.disk.freeBytes !== null ? ' · ' + formatBytes(health.disk.freeBytes) + ' free on disk' : '');
        }
    }

    function openHealthPanel() {
        healthPanel.hidden = false;
        healthToggle.setAttribute('aria-expanded', 'true');
        if (latestHealth) updateHealthUI(latestHealth);
        // The panel's grid refreshes slowly, and only while open
        fetchBufferGrid(healthGrid);
        if (!healthGridTimer) {
            healthGridTimer = setInterval(function() {
                fetchBufferGrid(healthGrid);
            }, 60000);
        }
    }

    function closeHealthPanel() {
        healthPanel.hidden = true;
        healthToggle.setAttribute('aria-expanded', 'false');
        if (healthGridTimer) {
            clearInterval(healthGridTimer);
            healthGridTimer = null;
        }
    }

    if (healthToggle && healthPanel) {
        healthToggle.addEventListener('click', function() {
            if (healthPanel.hidden) openHealthPanel();
            else closeHealthPanel();
        });
    }

    // Set up media session for lock screen controls
    setupMediaSession();

    // Check buffer status on load and poll every 30 seconds
    checkBufferStatus();
    fetchBufferGrid(); // Initial grid fetch
    statusPollTimer = setInterval(checkBufferStatus, 30000);

    /**
     * Fetch and display current track metadata
     * Errors are silently handled - metadata is non-critical
     */
    let metadataFailureCount = 0;

    /**
     * Get the wall-clock capture time of what's currently playing, derived
     * from EXT-X-PROGRAM-DATE-TIME. Stays accurate through pauses and
     * player buffering. Returns null if unavailable.
     */
    function getPlayheadTime() {
        try {
            if (hls && hls.playingDate) {
                return hls.playingDate.getTime();
            }
            // Native HLS (Safari/iOS) exposes the program date via getStartDate()
            if (audio && typeof audio.getStartDate === 'function' && isPlaying) {
                var start = audio.getStartDate();
                if (start && !isNaN(start.getTime())) {
                    return start.getTime() + audio.currentTime * 1000;
                }
            }
        } catch (e) { /* fall through */ }
        return null;
    }

    async function fetchMetadata() {
        try {
            var url = '/metadata/current';
            var playhead = getPlayheadTime();
            if (playhead) {
                url += '?time=' + playhead;
            }

            const response = await fetch(url);
            const data = await response.json();
            metadataFailureCount = 0;

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
                    // Anchor the track clock to the track's real start when
                    // the server knows it (not the moment we discovered it)
                    currentTrackStartTime = data.track.positionSec !== null &&
                        data.track.positionSec !== undefined
                        ? Date.now() - data.track.positionSec * 1000
                        : Date.now();
                    currentTrackDuration = data.track.duration || null;
                    updateTrackDisplay(data.track);
                }
            } else {
                if (currentTrackId !== 'waiting') {
                    currentTrackId = 'waiting';
                    currentTrackStartTime = null;
                    currentTrackDuration = null;
                }
                showWaitingForTrack(data.trackAvailableIn);
            }

            // Preload the next track's artwork for an instant swap
            if (data.nextTrack && data.nextTrack.imageUrl) {
                var preload = new Image();
                preload.src = data.nextTrack.imageUrl;
            }
        } catch (error) {
            // Transient failures keep the last-known-good display; only
            // clear it after several consecutive misses
            metadataFailureCount++;
            console.debug('Metadata fetch failed (' + metadataFailureCount + '):', error.message);
            if (metadataFailureCount >= 3 && currentTrackId !== 'waiting') {
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

        // Update title (track name) - the title itself links to Apple Music
        trackTitle.textContent = track.title || 'Unknown Track';
        if (track.appleMusicUrl) {
            trackTitle.setAttribute('href', track.appleMusicUrl);
            trackTitle.classList.add('linked');
        } else {
            trackTitle.removeAttribute('href');
            trackTitle.classList.remove('linked');
        }

        // Update artist
        trackArtist.textContent = track.artist || 'Unknown Artist';

        // Update album art: retry once on failure (transient network/CDN
        // hiccups), then fall back to the show artwork before giving up.
        // The blurred glow copy tracks whatever the art ends up being.
        var trackArtGlow = document.getElementById('trackArtGlow');
        function setHeroArt(src) {
            if (src) {
                trackArt.src = src;
                if (trackArtGlow) trackArtGlow.src = src;
            } else {
                // Empty string would resolve to the page URL and fire a request
                trackArt.removeAttribute('src');
                if (trackArtGlow) trackArtGlow.removeAttribute('src');
            }
        }
        if (track.imageUrl) {
            var retried = false;
            trackArt.onerror = function() {
                if (!retried) {
                    retried = true;
                    setTimeout(function() {
                        setHeroArt(track.imageUrl +
                            (track.imageUrl.indexOf('?') === -1 ? '?' : '&') +
                            'retry=' + Date.now());
                    }, 1500);
                    return;
                }
                if (showArt && showArt.src && !showArt.classList.contains('hidden')) {
                    this.onerror = null; // show art already loaded fine
                    setHeroArt(showArt.src);
                    return;
                }
                this.classList.add('hidden');
                if (trackArtGlow) trackArtGlow.classList.add('hidden');
                trackInfo.classList.add('no-art');
            };
            setHeroArt(track.imageUrl);
            trackArt.classList.remove('hidden');
            if (trackArtGlow) trackArtGlow.classList.remove('hidden');
        } else if (showArt && showArt.src && !showArt.classList.contains('hidden')) {
            // No track art from the BBC: use the programme artwork rather
            // than an empty placeholder
            trackArt.onerror = null;
            setHeroArt(showArt.src);
            trackArt.classList.remove('hidden');
            if (trackArtGlow) trackArtGlow.classList.remove('hidden');
        } else {
            trackArt.onerror = null;
            setHeroArt('');
            trackArt.classList.add('hidden');
            if (trackArtGlow) trackArtGlow.classList.add('hidden');
            trackInfo.classList.add('no-art');
        }

        // Update lock screen / media session
        updateMediaSession(track);
    }

    /**
     * Update Media Session for lock screen display
     */
    function updateMediaSession(track) {
        if (!('mediaSession' in navigator)) return;

        const artwork = [];
        if (track.imageUrl) {
            artwork.push({ src: track.imageUrl, sizes: '512x512', type: 'image/jpeg' });
        }
        // Fallback to show art if no track art
        if (artwork.length === 0 && showArt && showArt.src) {
            artwork.push({ src: showArt.src, sizes: '512x512', type: 'image/jpeg' });
        }

        navigator.mediaSession.metadata = new MediaMetadata({
            title: track.title || 'encore.fm',
            artist: track.artist || '',
            album: showTitle ? showTitle.textContent : 'BBC Radio 6 Music',
            artwork: artwork
        });
    }

    /**
     * Set up Media Session action handlers
     */
    function setupMediaSession() {
        if (!('mediaSession' in navigator)) return;

        navigator.mediaSession.setActionHandler('play', function() {
            audio.play();
        });

        navigator.mediaSession.setActionHandler('pause', function() {
            audio.pause();
        });

        // Set initial metadata
        navigator.mediaSession.metadata = new MediaMetadata({
            title: 'encore.fm',
            artist: 'BBC Radio 6 Music',
            album: '8 hours delayed'
        });
    }

    /**
     * Show waiting state when no track info is available yet
     * @param {number|null} availableInSeconds - Seconds until track info becomes available
     */
    function showWaitingForTrack(availableInSeconds) {
        trackInfo.classList.add('loading', 'no-art');
        trackTitle.textContent = 'Track Info';
        trackTitle.removeAttribute('href');
        trackTitle.classList.remove('linked');

        var waitingGlow = document.getElementById('trackArtGlow');
        if (waitingGlow) waitingGlow.classList.add('hidden');

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

    let currentTrackStartTime = null;
    let currentTrackDuration = null;

    /**
     * Schedule next metadata fetch based on track duration
     */
    function scheduleNextMetadataFetch() {
        if (metadataPollTimer) {
            clearTimeout(metadataPollTimer);
        }

        let delay = 15000; // Default 15 seconds

        // If we know track duration, schedule for when track should end
        if (currentTrackStartTime && currentTrackDuration) {
            const elapsed = (Date.now() - currentTrackStartTime) / 1000;
            const remaining = currentTrackDuration - elapsed;

            if (remaining > 5) {
                // Poll 3 seconds before track ends, minimum 5 seconds
                delay = Math.max(5000, (remaining - 3) * 1000);
            }
        }

        metadataPollTimer = setTimeout(function() {
            fetchMetadata();
            scheduleNextMetadataFetch();
        }, delay);
    }

    /**
     * Start polling for metadata
     */
    function startMetadataPolling() {
        // Show initial loading state
        showWaitingForTrack();
        // Initial fetch after short delay
        setTimeout(fetchMetadata, 500);
        // Start scheduled polling
        scheduleNextMetadataFetch();
    }

    /**
     * Stop metadata polling
     */
    function stopMetadataPolling() {
        if (metadataPollTimer) {
            clearTimeout(metadataPollTimer);
            metadataPollTimer = null;
        }
    }
});
