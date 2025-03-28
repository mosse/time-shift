/**
 * Time-Shifted Radio Player JavaScript
 * This file contains all the functionality for the time-shifted radio player interface
 */

document.addEventListener('DOMContentLoaded', function() {
    // Configuration
    const config = {
        autoPlay: false,                // Auto-play disabled by default
        debugMode: false,               // Debug logging
        defaultVolume: 0.8,             // Default volume (0-1)
        volumeStep: 0.1,                // Volume change step for keyboard
        bufferHealthThreshold: {
            good: 0.8,                  // >80% buffer is good health
            fair: 0.4,                  // >40% buffer is fair health
            poor: 0                      // Below that is poor health
        },
        streamTimeUpdateInterval: 1000, // Update stream time every second
        storageKey: {
            volume: 'timeshift-player-volume',
            muted: 'timeshift-player-muted'
        },
        hlsConfig: {
            debug: false,               // HLS.js debug mode
            manifestLoadingMaxRetry: 5, // Maximum number of retries for manifest loading
            manifestLoadingRetryDelay: 1000, // Delay between retries
            manifestLoadingMaxRetryTimeout: 10000, // Maximum timeout for retries
            startLevel: -1,             // Start level (auto)
            initialLiveManifestSize: 1, // Initial live manifest size
            levelLoadingTimeOut: 10000, // Level loading timeout
            fragLoadingTimeOut: 20000,  // Fragment loading timeout
            enableWorker: true,         // Enable web worker for better performance
            lowLatencyMode: false,      // Low latency mode
            backBufferLength: 90        // Back buffer length in seconds
        }
    };
    
    // Set current year in footer
    document.getElementById('currentYear').textContent = new Date().getFullYear();
    
    // Elements
    const video = document.getElementById('video');
    const audioPlayer = document.getElementById('audioPlayer');
    const playButton = document.getElementById('playButton');
    const refreshButton = document.getElementById('refreshButton');
    const playerStatusContent = document.getElementById('playerStatusContent');
    const statusContent = document.getElementById('statusContent');
    const tabs = document.querySelectorAll('.tab');
    const tabContents = document.querySelectorAll('.tab-content');
    const segmentType = document.getElementById('segmentType');
    const timestampGroup = document.getElementById('timestampGroup');
    const sequenceGroup = document.getElementById('sequenceGroup');
    const timestamp = document.getElementById('timestamp');
    const sequence = document.getElementById('sequence');
    const loadSegmentButton = document.getElementById('loadSegmentButton');
    const nextSegmentButton = document.getElementById('nextSegmentButton');
    const checkStatusButton = document.getElementById('checkStatusButton');
    const muteButton = document.getElementById('muteButton');
    const volumeSlider = document.getElementById('volumeSlider');
    const playIcon = playButton.querySelector('.play-icon');
    const bufferingOverlay = document.getElementById('bufferingOverlay');
    const bufferFill = document.getElementById('bufferFill');
    const bufferAmount = document.getElementById('bufferAmount');
    const healthIndicator = document.getElementById('healthIndicator');
    const streamTime = document.getElementById('streamTime');
    const connectionStatus = document.getElementById('connectionStatus');
    const connectionIndicator = document.getElementById('connectionIndicator');
    const settingsButton = document.getElementById('settingsButton');
    const keyboardShortcuts = document.querySelector('.keyboard-shortcuts');
    
    // Stream URLs
    const streamUrl = '/stream.m3u8';
    let hls = null;
    let currentSequence = 0;
    let reconnectTimer = null;
    let reconnectAttempts = 0;
    const maxReconnectAttempts = 5;
    let streamTimeInterval = null;
    let streamStartTime = null;
    let isMuted = false;
    let swipeStartY = 0;
    let currentVolume = loadVolumeFromStorage();
    
    /**
     * Load volume setting from localStorage
     */
    function loadVolumeFromStorage() {
        const savedVolume = localStorage.getItem(config.storageKey.volume);
        const savedMuted = localStorage.getItem(config.storageKey.muted);
        
        if (savedVolume !== null) {
            const volume = parseFloat(savedVolume);
            volumeSlider.value = volume * 100;
            return volume;
        } else {
            volumeSlider.value = config.defaultVolume * 100;
            return config.defaultVolume;
        }
        
        if (savedMuted === 'true') {
            isMuted = true;
            muteButton.classList.add('muted');
        }
    }
    
    /**
     * Save volume setting to localStorage
     */
    function saveVolumeToStorage(volume) {
        localStorage.setItem(config.storageKey.volume, volume.toString());
    }
    
    /**
     * Save mute setting to localStorage
     */
    function saveMuteToStorage(muted) {
        localStorage.setItem(config.storageKey.muted, muted.toString());
    }
    
    /**
     * Format time in HH:MM:SS format
     */
    function formatTime(seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        
        return [
            hours.toString().padStart(2, '0'),
            minutes.toString().padStart(2, '0'),
            secs.toString().padStart(2, '0')
        ].join(':');
    }
    
    /**
     * Helper function for logging
     */
    function log(message, level = 'info') {
        if (config.debugMode || level === 'error') {
            const prefix = `[HLS Player] [${level.toUpperCase()}]`;
            
            switch (level) {
                case 'error':
                    console.error(prefix, message);
                    break;
                case 'warn':
                    console.warn(prefix, message);
                    break;
                case 'debug':
                    console.debug(prefix, message);
                    break;
                default:
                    console.log(prefix, message);
            }
        }
    }
    
    /**
     * Update player status display
     */
    function updateStatus(message, type = 'info') {
        playerStatusContent.textContent = message;
        
        // Add visual cue for status type
        playerStatusContent.className = '';
        playerStatusContent.classList.add(type);
        
        log(message, type === 'error' ? 'error' : 'info');
    }
    
    /**
     * Update connection status indicator
     */
    function updateConnectionStatus(status) {
        connectionStatus.textContent = status;
        connectionIndicator.className = 'indicator';
        
        switch (status.toLowerCase()) {
            case 'connected':
                connectionIndicator.classList.add('connected');
                break;
            case 'connecting':
            case 'buffering':
                connectionIndicator.classList.add('connecting');
                break;
            case 'error':
                connectionIndicator.classList.add('error');
                break;
            default:
                // Default 'idle' state uses default styling
                break;
        }
    }
    
    /**
     * Start streaming time counter
     */
    function startStreamTimeCounter() {
        if (streamTimeInterval) {
            clearInterval(streamTimeInterval);
        }
        
        streamStartTime = Date.now();
        
        streamTimeInterval = setInterval(() => {
            const elapsedSeconds = Math.floor((Date.now() - streamStartTime) / 1000);
            streamTime.textContent = formatTime(elapsedSeconds);
        }, config.streamTimeUpdateInterval);
    }
    
    /**
     * Stop streaming time counter
     */
    function stopStreamTimeCounter() {
        if (streamTimeInterval) {
            clearInterval(streamTimeInterval);
            streamTimeInterval = null;
        }
    }
    
    /**
     * Update buffer health visualization
     */
    function updateBufferHealth(percentage) {
        // Update buffer fill display
        bufferFill.style.width = `${percentage}%`;
        bufferAmount.textContent = `${Math.round(percentage)}%`;
        
        // Update health indicator
        healthIndicator.className = 'health-indicator';
        
        if (percentage >= config.bufferHealthThreshold.good * 100) {
            healthIndicator.classList.add('good');
        } else if (percentage >= config.bufferHealthThreshold.fair * 100) {
            healthIndicator.classList.add('fair');
        } else {
            healthIndicator.classList.add('poor');
        }
    }
    
    /**
     * Show or hide buffering overlay
     */
    function toggleBufferingOverlay(show) {
        bufferingOverlay.hidden = !show;
        
        if (show) {
            updateConnectionStatus('Buffering');
        } else {
            updateConnectionStatus('Connected');
        }
    }
    
    /**
     * Set play/pause button state
     */
    function updatePlayButton(isPlaying) {
        if (isPlaying) {
            playButton.classList.add('playing');
            playButton.setAttribute('aria-label', 'Pause Stream');
        } else {
            playButton.classList.remove('playing');
            playButton.setAttribute('aria-label', 'Play Stream');
        }
    }
    
    /**
     * Set volume for all media elements
     */
    function setVolume(volume) {
        // Ensure volume is between 0 and 1
        volume = Math.max(0, Math.min(1, volume));
        
        video.volume = volume;
        audioPlayer.volume = volume;
        currentVolume = volume;
        
        // Update UI
        volumeSlider.value = volume * 100;
        
        // Store the setting
        saveVolumeToStorage(volume);
        
        return volume;
    }
    
    /**
     * Handle mute toggle
     */
    function toggleMute() {
        isMuted = !isMuted;
        
        video.muted = isMuted;
        audioPlayer.muted = isMuted;
        
        if (isMuted) {
            muteButton.classList.add('muted');
        } else {
            muteButton.classList.remove('muted');
        }
        
        saveMuteToStorage(isMuted);
    }
    
    // Tab handling
    tabs.forEach(tab => {
        tab.addEventListener('click', function() {
            // Update tab states
            tabs.forEach(t => {
                t.classList.remove('active');
                t.setAttribute('aria-selected', 'false');
                t.setAttribute('tabindex', '-1');
            });
            
            // Hide all tab contents
            tabContents.forEach(tc => {
                tc.classList.remove('active');
                tc.setAttribute('hidden', '');
            });
            
            // Activate clicked tab
            this.classList.add('active');
            this.setAttribute('aria-selected', 'true');
            this.setAttribute('tabindex', '0');
            
            // Show corresponding content
            const tabId = this.getAttribute('data-tab') + '-tab';
            const tabContent = document.getElementById(tabId);
            tabContent.classList.add('active');
            tabContent.removeAttribute('hidden');
        });
        
        // Keyboard navigation for tabs
        tab.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                this.click();
            }
        });
    });
    
    // Segment type handling
    segmentType.addEventListener('change', function() {
        timestampGroup.hidden = true;
        sequenceGroup.hidden = true;
        
        if (this.value === 'timestamp') {
            timestampGroup.hidden = false;
            // Set default to current time minus 8 hours
            const date = new Date();
            date.setHours(date.getHours() - 8);
            timestamp.value = date.toISOString().slice(0, 19);
        } else if (this.value === 'sequence') {
            sequenceGroup.hidden = false;
            if (!sequence.value) {
                sequence.value = '0';
            }
        }
    });
    
    /**
     * Cancel any active reconnection attempts
     */
    function cancelReconnect() {
        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }
        reconnectAttempts = 0;
    }
    
    /**
     * Handle reconnection logic
     */
    function handleReconnect() {
        if (reconnectAttempts >= maxReconnectAttempts) {
            updateStatus(`Maximum reconnection attempts reached (${maxReconnectAttempts}). Please try refreshing manually.`, 'error');
            updateConnectionStatus('Error');
            cancelReconnect();
            return;
        }
        
        reconnectAttempts++;
        
        const delay = Math.min(1000 * Math.pow(1.5, reconnectAttempts), 10000); // Exponential backoff with 10s max
        updateStatus(`Connection lost. Reconnecting in ${Math.round(delay/1000)}s (attempt ${reconnectAttempts}/${maxReconnectAttempts})...`, 'warn');
        updateConnectionStatus('Connecting');
        
        reconnectTimer = setTimeout(() => {
            updateStatus(`Attempting to reconnect (${reconnectAttempts}/${maxReconnectAttempts})...`);
            initPlayer();
        }, delay);
    }
    
    /**
     * Initialize and play the HLS stream
     */
    function initPlayer() {
        updateStatus('Initializing player...');
        updateConnectionStatus('Connecting');
        cancelReconnect();
        stopStreamTimeCounter();
        toggleBufferingOverlay(false);
        
        // If an HLS instance exists, destroy it first
        if (hls) {
            hls.destroy();
            hls = null;
        }
        
        // Set initial volume
        setVolume(currentVolume);
        video.muted = isMuted;
        audioPlayer.muted = isMuted;
        
        // Reset buffer health display
        updateBufferHealth(0);
        
        // Check if HLS.js is supported
        if (Hls.isSupported()) {
            log('HLS.js is supported by this browser', 'debug');
            
            hls = new Hls(config.hlsConfig);
            
            // Register all HLS.js event handlers for debugging and UI updates
            hls.on(Hls.Events.MEDIA_ATTACHED, function() {
                log('Media element attached', 'debug');
                updateStatus('HLS.js attached to media element');
            });
            
            hls.on(Hls.Events.MEDIA_DETACHED, function() {
                log('Media element detached', 'debug');
            });
            
            hls.on(Hls.Events.MANIFEST_LOADING, function() {
                toggleBufferingOverlay(true);
                updateStatus('Loading stream manifest...');
            });
            
            hls.on(Hls.Events.MANIFEST_LOADED, function(event, data) {
                log('Manifest loaded', 'debug');
                updateStatus('Stream manifest loaded. Parsing...');
            });
            
            hls.on(Hls.Events.MANIFEST_PARSED, function(event, data) {
                log(`Manifest parsed. ${data.levels.length} quality levels found.`, 'debug');
                updateStatus(`Stream ready. ${data.levels.length} quality levels available.`);
                toggleBufferingOverlay(false);
                
                if (config.autoPlay) {
                    video.play().then(() => {
                        updateStatus('Playback started automatically');
                        updatePlayButton(true);
                        startStreamTimeCounter();
                    }).catch(error => {
                        updateStatus(`Autoplay prevented: ${error.message}. Click play to start.`, 'warn');
                    });
                } else {
                    updateStatus('Stream ready. Click play to start.');
                }
            });
            
            hls.on(Hls.Events.LEVEL_LOADED, function(event, data) {
                log(`Level ${data.level} loaded. ${data.details.totalduration}s duration.`, 'debug');
                updateConnectionStatus('Connected');
            });
            
            hls.on(Hls.Events.LEVEL_SWITCHED, function(event, data) {
                log(`Switched to quality level ${data.level}`, 'debug');
            });
            
            hls.on(Hls.Events.FRAG_LOADING, function(event, data) {
                log(`Loading fragment ${data.frag.sn}`, 'debug');
            });
            
            hls.on(Hls.Events.FRAG_LOADED, function(event, data) {
                log(`Fragment ${data.frag.sn} loaded`, 'debug');
                toggleBufferingOverlay(false);
            });
            
            hls.on(Hls.Events.FRAG_CHANGED, function(event, data) {
                log(`Fragment changed to ${data.frag.sn}`, 'debug');
            });
            
            hls.on(Hls.Events.BUFFER_CREATED, function(event, data) {
                log('Buffer created', 'debug');
            });
            
            hls.on(Hls.Events.BUFFER_APPENDING, function(event, data) {
                log(`Buffer appending ${data.type}`, 'debug');
            });
            
            hls.on(Hls.Events.BUFFER_APPENDED, function(event, data) {
                log(`Buffer appended ${data.type}`, 'debug');
                // Update buffer health
                const bufferInfo = hls.mainForwardBufferInfo || { len: 0 };
                const bufferPercentage = Math.min(100, (bufferInfo.len / 30) * 100); // 30 seconds as 100%
                updateBufferHealth(bufferPercentage);
            });
            
            hls.on(Hls.Events.ERROR, function(event, data) {
                if (data.fatal) {
                    switch (data.type) {
                        case Hls.ErrorTypes.NETWORK_ERROR:
                            log(`Fatal network error: ${data.details}`, 'error');
                            updateStatus(`Network error: ${data.details}. Attempting to recover...`, 'error');
                            updateConnectionStatus('Error');
                            
                            // Try to recover network error or schedule reconnect
                            if (data.details === Hls.ErrorDetails.MANIFEST_LOAD_ERROR || 
                                data.details === Hls.ErrorDetails.MANIFEST_LOAD_TIMEOUT) {
                                handleReconnect();
                            } else {
                                hls.startLoad();
                            }
                            break;
                            
                        case Hls.ErrorTypes.MEDIA_ERROR:
                            log(`Fatal media error: ${data.details}`, 'error');
                            updateStatus(`Media error: ${data.details}. Attempting to recover...`, 'error');
                            hls.recoverMediaError();
                            break;
                            
                        default:
                            log(`Fatal error: ${data.type} - ${data.details}`, 'error');
                            updateStatus(`Fatal error: ${data.details}. Cannot recover.`, 'error');
                            updateConnectionStatus('Error');
                            hls.destroy();
                            break;
                    }
                } else {
                    log(`Non-fatal error: ${data.type} - ${data.details}`, 'warn');
                }
            });
            
            // Bind HLS to the video element
            hls.loadSource(streamUrl);
            hls.attachMedia(video);
            
            // Add player event listeners
            video.addEventListener('play', function() {
                updateStatus('Playback started');
                updatePlayButton(true);
                updateConnectionStatus('Connected');
                startStreamTimeCounter();
            });
            
            video.addEventListener('pause', function() {
                updateStatus('Playback paused');
                updatePlayButton(false);
                stopStreamTimeCounter();
            });
            
            video.addEventListener('waiting', function() {
                updateStatus('Buffering...', 'warn');
                toggleBufferingOverlay(true);
            });
            
            video.addEventListener('playing', function() {
                toggleBufferingOverlay(false);
            });
            
            video.addEventListener('ended', function() {
                updateStatus('Playback ended');
                updatePlayButton(false);
                stopStreamTimeCounter();
            });
            
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            // HLS is natively supported on Safari
            log('Using native HLS support', 'debug');
            updateStatus('Using native HLS support for playback');
            
            video.src = streamUrl;
            
            video.addEventListener('loadedmetadata', function() {
                updateStatus('Stream loaded successfully. Ready to play.');
                updateConnectionStatus('Connected');
                toggleBufferingOverlay(false);
                
                if (config.autoPlay) {
                    video.play().then(() => {
                        updateStatus('Playback started automatically');
                        updatePlayButton(true);
                        startStreamTimeCounter();
                    }).catch(error => {
                        updateStatus(`Autoplay prevented: ${error.message}. Click play to start.`, 'warn');
                    });
                }
            });
            
            video.addEventListener('progress', function() {
                // Calculate buffer health for native players
                if (video.buffered.length > 0) {
                    const bufferedEnd = video.buffered.end(video.buffered.length - 1);
                    const duration = video.duration || 30; // fallback to 30s if duration unknown
                    const bufferPercentage = Math.min(100, (bufferedEnd / Math.min(duration, 30)) * 100);
                    updateBufferHealth(bufferPercentage);
                }
            });
            
            video.addEventListener('error', function() {
                const errorCode = video.error ? video.error.code : 'unknown';
                const errorMessage = video.error ? video.error.message : 'Unknown error';
                
                log(`Video playback error: ${errorCode} - ${errorMessage}`, 'error');
                updateStatus(`Playback error: ${errorMessage}`, 'error');
                updateConnectionStatus('Error');
                
                // Handle reconnection
                handleReconnect();
            });
            
            // Add event listeners for play/pause state
            video.addEventListener('play', function() {
                updateStatus('Playback started');
                updatePlayButton(true);
                updateConnectionStatus('Connected');
                startStreamTimeCounter();
            });
            
            video.addEventListener('pause', function() {
                updateStatus('Playback paused');
                updatePlayButton(false);
                stopStreamTimeCounter();
            });
            
            video.addEventListener('waiting', function() {
                updateStatus('Buffering...', 'warn');
                toggleBufferingOverlay(true);
            });
            
            video.addEventListener('playing', function() {
                toggleBufferingOverlay(false);
            });
            
            video.addEventListener('ended', function() {
                updateStatus('Playback ended');
                updatePlayButton(false);
                stopStreamTimeCounter();
            });
        } else {
            // HLS is not supported at all
            log('HLS playback is not supported in this browser', 'error');
            updateStatus('HLS playback is not supported in your browser. Please try a different browser like Chrome, Firefox, or Safari.', 'error');
            updateConnectionStatus('Error');
        }
    }
    
    /**
     * Toggle playback status
     */
    function togglePlayback() {
        if (!hls && Hls.isSupported()) {
            initPlayer();
            return;
        }
        
        if (video.paused) {
            video.play().then(() => {
                updateStatus('Playback started');
                updatePlayButton(true);
                startStreamTimeCounter();
            }).catch(error => {
                updateStatus(`Playback error: ${error.message}`, 'error');
            });
        } else {
            video.pause();
            updateStatus('Playback paused');
            updatePlayButton(false);
            stopStreamTimeCounter();
        }
    }
    
    /**
     * Load a specific segment
     */
    function loadSegment() {
        updateStatus('Loading segment...');
        
        let segmentUrl;
        
        switch (segmentType.value) {
            case 'current':
                segmentUrl = '/segments/current';
                break;
                
            case 'timestamp':
                if (!timestamp.value) {
                    updateStatus('Please enter a valid timestamp', 'error');
                    return;
                }
                const ts = new Date(timestamp.value).getTime();
                segmentUrl = `/segments/${ts}`;
                break;
                
            case 'sequence':
                if (!sequence.value) {
                    updateStatus('Please enter a valid sequence number', 'error');
                    return;
                }
                currentSequence = parseInt(sequence.value, 10);
                segmentUrl = `/segments/${currentSequence}`;
                break;
        }
        
        log(`Loading segment from URL: ${segmentUrl}`, 'debug');
        
        audioPlayer.src = segmentUrl;
        audioPlayer.load();
        
        audioPlayer.addEventListener('canplaythrough', function onCanPlay() {
            updateStatus('Segment loaded successfully');
            audioPlayer.play();
            audioPlayer.removeEventListener('canplaythrough', onCanPlay);
        }, { once: true });
        
        audioPlayer.addEventListener('error', function() {
            const errorMessage = audioPlayer.error ? audioPlayer.error.message : 'Unknown error';
            log(`Error loading segment: ${errorMessage}`, 'error');
            updateStatus(`Error loading segment: ${errorMessage}`, 'error');
        }, { once: true });
    }
    
    /**
     * Load the next segment in sequence
     */
    function loadNextSegment() {
        currentSequence++;
        sequence.value = currentSequence;
        segmentType.value = 'sequence';
        segmentType.dispatchEvent(new Event('change'));
        loadSegment();
    }
    
    /**
     * Check API status
     */
    async function checkStreamStatus() {
        try {
            statusContent.textContent = 'Checking stream status...';
            log('Requesting stream status', 'debug');
            
            const response = await fetch('/stream/status');
            
            if (!response.ok) {
                throw new Error(`HTTP error ${response.status}`);
            }
            
            const data = await response.json();
            log('Stream status received', 'debug');
            statusContent.textContent = JSON.stringify(data, null, 2);
        } catch (error) {
            log(`Error checking stream status: ${error.message}`, 'error');
            statusContent.textContent = 'Error checking stream status: ' + error.message;
        }
    }
    
    /**
     * Toggle keyboard shortcuts display
     */
    function toggleKeyboardShortcuts() {
        keyboardShortcuts.hidden = !keyboardShortcuts.hidden;
    }
    
    /**
     * Handle touch-based volume control (swipe up/down on player)
     */
    function setupMobileGestures() {
        const videoContainer = document.querySelector('.video-container');
        
        videoContainer.addEventListener('touchstart', function(e) {
            if (e.touches.length === 1) {
                // Store the starting Y position for vertical swipe detection
                swipeStartY = e.touches[0].clientY;
            }
        }, { passive: true });
        
        videoContainer.addEventListener('touchmove', function(e) {
            // Only process for single touch point
            if (e.touches.length !== 1) return;
            
            // Calculate vertical displacement
            const deltaY = swipeStartY - e.touches[0].clientY;
            
            // If significant vertical movement detected, adjust volume
            if (Math.abs(deltaY) > 20) {
                e.preventDefault(); // Prevent page scrolling
                
                // Calculate volume adjustment - sensitivity factor makes it less aggressive
                const sensitivity = 0.005; 
                const volumeChange = deltaY * sensitivity;
                
                // Apply the volume change
                setVolume(currentVolume + volumeChange);
                
                // Update starting position to make the gesture continuous
                swipeStartY = e.touches[0].clientY;
            }
        }, { passive: false });
    }
    
    // Set the timestamp input to current time minus 8 hours
    const defaultDate = new Date();
    defaultDate.setHours(defaultDate.getHours() - 8);
    timestamp.value = defaultDate.toISOString().slice(0, 19);
    
    // Initialize UI elements
    updatePlayButton(false);
    updateConnectionStatus('Idle');
    toggleBufferingOverlay(false);
    if (isMuted) {
        muteButton.classList.add('muted');
    }
    
    // Event listeners for player controls
    playButton.addEventListener('click', togglePlayback);
    
    refreshButton.addEventListener('click', function() {
        updateStatus('Refreshing stream...');
        initPlayer();
    });
    
    muteButton.addEventListener('click', toggleMute);
    
    volumeSlider.addEventListener('input', function() {
        const volume = parseInt(this.value, 10) / 100;
        setVolume(volume);
    });
    
    settingsButton.addEventListener('click', toggleKeyboardShortcuts);
    
    loadSegmentButton.addEventListener('click', loadSegment);
    nextSegmentButton.addEventListener('click', loadNextSegment);
    checkStatusButton.addEventListener('click', checkStreamStatus);
    
    // Handle audio player ended event to auto-load next segment
    audioPlayer.addEventListener('ended', function() {
        if (segmentType.value === 'sequence') {
            loadNextSegment();
        }
    });
    
    // Global keyboard shortcuts
    document.addEventListener('keydown', function(e) {
        // Only handle shortcuts when not inside an input field
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
            return;
        }
        
        switch (e.key) {
            case ' ': // Space
                e.preventDefault();
                togglePlayback();
                break;
                
            case 'ArrowUp': // Up arrow
                e.preventDefault();
                setVolume(currentVolume + config.volumeStep);
                break;
                
            case 'ArrowDown': // Down arrow
                e.preventDefault();
                setVolume(currentVolume - config.volumeStep);
                break;
                
            case 'm': // M key
            case 'M': // Shift+M
                e.preventDefault();
                toggleMute();
                break;
                
            case 'r': // R key
            case 'R': // Shift+R
                e.preventDefault();
                initPlayer();
                break;
                
            case 'k': // K key
            case 'K': // Shift+K
                e.preventDefault();
                toggleKeyboardShortcuts();
                break;
                
            case 'd': // D key (Debug mode toggle)
            case 'D': // Shift+D
                if (e.ctrlKey && e.shiftKey) {
                    e.preventDefault();
                    config.debugMode = !config.debugMode;
                    log(`Debug mode ${config.debugMode ? 'enabled' : 'disabled'}`, 'info');
                    updateStatus(`Debug mode ${config.debugMode ? 'enabled' : 'disabled'}`);
                }
                break;
        }
    });
    
    // Setup mobile/touch gestures
    setupMobileGestures();
    
    // Initialize player if auto-play is enabled
    if (config.autoPlay) {
        initPlayer();
    } else {
        updateStatus('Player ready. Click play to start streaming.');
    }
}); 