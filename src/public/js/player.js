/**
 * Time-Shifted Radio Player JavaScript
 * This file contains all the functionality for the time-shifted radio player interface
 */

document.addEventListener('DOMContentLoaded', function() {
    // Configuration
    const config = {
        autoPlay: false,                // Auto-play disabled by default
        debugMode: false,               // Debug logging
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
    
    // Stream URLs
    const streamUrl = '/stream.m3u8';
    let hls = null;
    let currentSequence = 0;
    let reconnectTimer = null;
    let reconnectAttempts = 0;
    const maxReconnectAttempts = 5;
    
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
            cancelReconnect();
            return;
        }
        
        reconnectAttempts++;
        
        const delay = Math.min(1000 * Math.pow(1.5, reconnectAttempts), 10000); // Exponential backoff with 10s max
        updateStatus(`Connection lost. Reconnecting in ${Math.round(delay/1000)}s (attempt ${reconnectAttempts}/${maxReconnectAttempts})...`, 'warn');
        
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
        cancelReconnect();
        
        // If an HLS instance exists, destroy it first
        if (hls) {
            hls.destroy();
            hls = null;
        }
        
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
            
            hls.on(Hls.Events.MANIFEST_LOADED, function(event, data) {
                log('Manifest loaded', 'debug');
                updateStatus('Stream manifest loaded. Parsing...');
            });
            
            hls.on(Hls.Events.MANIFEST_PARSED, function(event, data) {
                log(`Manifest parsed. ${data.levels.length} quality levels found.`, 'debug');
                updateStatus(`Stream ready. ${data.levels.length} quality levels available.`);
                
                if (config.autoPlay) {
                    video.play().then(() => {
                        updateStatus('Playback started automatically');
                    }).catch(error => {
                        updateStatus(`Autoplay prevented: ${error.message}. Click play to start.`, 'warn');
                    });
                } else {
                    updateStatus('Stream ready. Click play to start.');
                }
            });
            
            hls.on(Hls.Events.LEVEL_LOADED, function(event, data) {
                log(`Level ${data.level} loaded. ${data.details.totalduration}s duration.`, 'debug');
            });
            
            hls.on(Hls.Events.LEVEL_SWITCHED, function(event, data) {
                log(`Switched to quality level ${data.level}`, 'debug');
            });
            
            hls.on(Hls.Events.FRAG_LOADING, function(event, data) {
                log(`Loading fragment ${data.frag.sn}`, 'debug');
            });
            
            hls.on(Hls.Events.FRAG_LOADED, function(event, data) {
                log(`Fragment ${data.frag.sn} loaded`, 'debug');
            });
            
            hls.on(Hls.Events.FRAG_CHANGED, function(event, data) {
                log(`Fragment changed to ${data.frag.sn}`, 'debug');
            });
            
            hls.on(Hls.Events.ERROR, function(event, data) {
                if (data.fatal) {
                    switch (data.type) {
                        case Hls.ErrorTypes.NETWORK_ERROR:
                            log(`Fatal network error: ${data.details}`, 'error');
                            updateStatus(`Network error: ${data.details}. Attempting to recover...`, 'error');
                            
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
            });
            
            video.addEventListener('pause', function() {
                updateStatus('Playback paused');
            });
            
            video.addEventListener('waiting', function() {
                updateStatus('Buffering...', 'warn');
            });
            
            video.addEventListener('ended', function() {
                updateStatus('Playback ended');
            });
            
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            // HLS is natively supported on Safari
            log('Using native HLS support', 'debug');
            updateStatus('Using native HLS support for playback');
            
            video.src = streamUrl;
            
            video.addEventListener('loadedmetadata', function() {
                updateStatus('Stream loaded successfully. Ready to play.');
                
                if (config.autoPlay) {
                    video.play().then(() => {
                        updateStatus('Playback started automatically');
                    }).catch(error => {
                        updateStatus(`Autoplay prevented: ${error.message}. Click play to start.`, 'warn');
                    });
                }
            });
            
            video.addEventListener('error', function() {
                const errorCode = video.error ? video.error.code : 'unknown';
                const errorMessage = video.error ? video.error.message : 'Unknown error';
                
                log(`Video playback error: ${errorCode} - ${errorMessage}`, 'error');
                updateStatus(`Playback error: ${errorMessage}`, 'error');
                
                // Handle reconnection
                handleReconnect();
            });
        } else {
            // HLS is not supported at all
            log('HLS playback is not supported in this browser', 'error');
            updateStatus('HLS playback is not supported in your browser. Please try a different browser like Chrome, Firefox, or Safari.', 'error');
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
                playButton.textContent = 'Pause Stream';
            }).catch(error => {
                updateStatus(`Playback error: ${error.message}`, 'error');
            });
        } else {
            video.pause();
            updateStatus('Playback paused');
            playButton.textContent = 'Play Stream';
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
    
    // Set the timestamp input to current time minus 8 hours
    const defaultDate = new Date();
    defaultDate.setHours(defaultDate.getHours() - 8);
    timestamp.value = defaultDate.toISOString().slice(0, 19);
    
    // Event listeners
    playButton.addEventListener('click', togglePlayback);
    
    refreshButton.addEventListener('click', function() {
        updateStatus('Refreshing stream...');
        initPlayer();
    });
    
    loadSegmentButton.addEventListener('click', loadSegment);
    nextSegmentButton.addEventListener('click', loadNextSegment);
    checkStatusButton.addEventListener('click', checkStreamStatus);
    
    // Handle audio player ended event to auto-load next segment
    audioPlayer.addEventListener('ended', function() {
        if (segmentType.value === 'sequence') {
            loadNextSegment();
        }
    });
    
    // Debug mode toggle (using keyboard shortcut Ctrl+Shift+D)
    document.addEventListener('keydown', function(e) {
        if (e.ctrlKey && e.shiftKey && e.key === 'D') {
            config.debugMode = !config.debugMode;
            log(`Debug mode ${config.debugMode ? 'enabled' : 'disabled'}`, 'info');
            updateStatus(`Debug mode ${config.debugMode ? 'enabled' : 'disabled'}`);
        }
    });
    
    // Initialize player if auto-play is enabled
    if (config.autoPlay) {
        initPlayer();
    } else {
        updateStatus('Player ready. Click play to start streaming.');
    }
}); 