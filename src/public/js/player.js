/**
 * Time-Shifted Radio Player JavaScript
 * This file contains all the functionality for the time-shifted radio player interface
 */

document.addEventListener('DOMContentLoaded', function() {
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
    
    // Initialize and play the HLS stream
    function initPlayer() {
        playerStatusContent.textContent = 'Initializing player...';
        
        // If an HLS instance exists, destroy it first
        if (hls) {
            hls.destroy();
        }
        
        // Check if HLS.js is supported
        if (Hls.isSupported()) {
            hls = new Hls({
                debug: false,
                manifestLoadingMaxRetry: 3,
                manifestLoadingRetryDelay: 1000,
                manifestLoadingMaxRetryTimeout: 10000
            });
            
            // Bind HLS to the video element
            hls.loadSource(streamUrl);
            hls.attachMedia(video);
            
            // Handle HLS events
            hls.on(Hls.Events.MANIFEST_PARSED, function() {
                playerStatusContent.textContent = 'Stream loaded successfully. Playback starting...';
                video.play().catch(error => {
                    playerStatusContent.textContent = 'Playback error: ' + error.message;
                });
            });
            
            hls.on(Hls.Events.ERROR, function(event, data) {
                playerStatusContent.textContent = 'Player error: ' + data.type + ' - ' + data.details;
                console.error('HLS.js error:', data);
                
                if (data.fatal) {
                    switch (data.type) {
                        case Hls.ErrorTypes.NETWORK_ERROR:
                            // Try to recover network error
                            playerStatusContent.textContent = 'Network error. Attempting to recover...';
                            hls.startLoad();
                            break;
                            
                        case Hls.ErrorTypes.MEDIA_ERROR:
                            // Try to recover media error
                            playerStatusContent.textContent = 'Media error. Attempting to recover...';
                            hls.recoverMediaError();
                            break;
                            
                        default:
                            // Cannot recover
                            playerStatusContent.textContent = 'Fatal error: ' + data.details + '. Cannot recover.';
                            hls.destroy();
                            break;
                    }
                }
            });
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            // HLS is natively supported on Safari
            video.src = streamUrl;
            video.addEventListener('loadedmetadata', function() {
                playerStatusContent.textContent = 'Stream loaded successfully. Playback starting...';
                video.play().catch(error => {
                    playerStatusContent.textContent = 'Playback error: ' + error.message;
                });
            });
        } else {
            playerStatusContent.textContent = 'HLS playback is not supported in your browser.';
        }
    }
    
    // Load a specific segment
    function loadSegment() {
        playerStatusContent.textContent = 'Loading segment...';
        
        let segmentUrl;
        
        switch (segmentType.value) {
            case 'current':
                segmentUrl = '/segments/current';
                break;
                
            case 'timestamp':
                if (!timestamp.value) {
                    playerStatusContent.textContent = 'Please enter a valid timestamp';
                    return;
                }
                const ts = new Date(timestamp.value).getTime();
                segmentUrl = `/segments/${ts}`;
                break;
                
            case 'sequence':
                if (!sequence.value) {
                    playerStatusContent.textContent = 'Please enter a valid sequence number';
                    return;
                }
                currentSequence = parseInt(sequence.value, 10);
                segmentUrl = `/segments/${currentSequence}`;
                break;
        }
        
        audioPlayer.src = segmentUrl;
        audioPlayer.load();
        
        audioPlayer.addEventListener('canplaythrough', function onCanPlay() {
            playerStatusContent.textContent = 'Segment loaded successfully';
            audioPlayer.play();
            audioPlayer.removeEventListener('canplaythrough', onCanPlay);
        }, { once: true });
        
        audioPlayer.addEventListener('error', function() {
            playerStatusContent.textContent = 'Error loading segment: ' + (audioPlayer.error ? audioPlayer.error.message : 'Unknown error');
        }, { once: true });
    }
    
    // Load the next segment in sequence
    function loadNextSegment() {
        currentSequence++;
        sequence.value = currentSequence;
        segmentType.value = 'sequence';
        segmentType.dispatchEvent(new Event('change'));
        loadSegment();
    }
    
    // Check API status
    async function checkStreamStatus() {
        try {
            statusContent.textContent = 'Checking stream status...';
            const response = await fetch('/stream/status');
            
            if (!response.ok) {
                throw new Error(`HTTP error ${response.status}`);
            }
            
            const data = await response.json();
            statusContent.textContent = JSON.stringify(data, null, 2);
        } catch (error) {
            statusContent.textContent = 'Error checking stream status: ' + error.message;
        }
    }
    
    // Set the timestamp input to current time minus 8 hours
    const defaultDate = new Date();
    defaultDate.setHours(defaultDate.getHours() - 8);
    timestamp.value = defaultDate.toISOString().slice(0, 19);
    
    // Event listeners
    playButton.addEventListener('click', initPlayer);
    
    refreshButton.addEventListener('click', function() {
        playerStatusContent.textContent = 'Refreshing stream...';
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
}); 