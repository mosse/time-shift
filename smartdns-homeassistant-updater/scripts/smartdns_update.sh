#!/bin/bash
#
# SmartDNSProxy IP Updater for Home Assistant
#
# This script automatically detects your public IP address and updates
# SmartDNSProxy when it changes. Designed for Home Assistant OS.
#
# Usage: smartdns_update.sh <API_KEY> [--test]
#
# Arguments:
#   API_KEY - Your SmartDNSProxy API key
#   --test  - Optional: Test mode, don't actually call the API
#
# Exit codes:
#   0 - Success
#   1 - Error occurred
#
# Author: SmartDNS Home Assistant Updater Project
# License: MIT

set -o pipefail

# ============================================================================
# CONFIGURATION
# ============================================================================

# File paths (all in /config for persistence across reboots)
readonly CONFIG_DIR="/config"
readonly LOG_DIR="${CONFIG_DIR}/logs"
readonly LAST_IP_FILE="${CONFIG_DIR}/smartdns_last_ip.txt"
readonly LOCK_FILE="${CONFIG_DIR}/smartdns_update.lock"
readonly LOG_FILE="${LOG_DIR}/smartdns_updates.log"

# Timeout settings (script must complete within 60 seconds for HAOS)
readonly CURL_TIMEOUT=10
readonly SCRIPT_TIMEOUT=55

# API endpoint (without API key for security)
readonly API_BASE_URL="https://www.smartdnsproxy.com/api/IP/update"

# IP detection services (fallbacks for reliability)
readonly IP_SERVICES=(
    "https://icanhazip.com"
    "https://api.ipify.org"
    "https://ifconfig.me/ip"
)

# ============================================================================
# LOGGING FUNCTIONS
# ============================================================================

# Ensure log directory exists
mkdir -p "${LOG_DIR}"

# Log with timestamp
log() {
    local level="$1"
    shift
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [${level}] $*" | tee -a "${LOG_FILE}"
}

log_info() {
    log "INFO" "$@"
}

log_error() {
    log "ERROR" "$@"
}

log_warn() {
    log "WARN" "$@"
}

log_debug() {
    log "DEBUG" "$@"
}

# ============================================================================
# FILE LOCKING
# ============================================================================

# Acquire lock to prevent concurrent executions
acquire_lock() {
    local max_wait=30
    local waited=0

    while [ -f "${LOCK_FILE}" ]; do
        if [ $waited -ge $max_wait ]; then
            log_error "Could not acquire lock after ${max_wait} seconds. Another instance may be stuck."
            # Check if lock file is stale (older than 5 minutes)
            if [ -f "${LOCK_FILE}" ]; then
                local lock_age=$(($(date +%s) - $(stat -c %Y "${LOCK_FILE}" 2>/dev/null || echo 0)))
                if [ "$lock_age" -gt 300 ]; then
                    log_warn "Lock file is stale (${lock_age}s old). Removing it."
                    rm -f "${LOCK_FILE}"
                    break
                fi
            fi
            return 1
        fi
        log_debug "Waiting for lock... (${waited}s)"
        sleep 1
        waited=$((waited + 1))
    done

    # Create lock file
    echo $$ > "${LOCK_FILE}"
    log_debug "Lock acquired (PID: $$)"
    return 0
}

# Release lock
release_lock() {
    rm -f "${LOCK_FILE}"
    log_debug "Lock released"
}

# Ensure lock is released on exit
trap release_lock EXIT

# ============================================================================
# IP DETECTION
# ============================================================================

# Get current public IP with fallback mechanisms
get_public_ip() {
    local ip=""

    # Try curl-based services first
    for service in "${IP_SERVICES[@]}"; do
        log_debug "Trying IP detection service: ${service}"
        ip=$(curl -sf --max-time "${CURL_TIMEOUT}" "${service}" 2>/dev/null | tr -d '[:space:]')

        if [ -n "$ip" ] && validate_ip "$ip"; then
            log_info "Detected public IP: ${ip} (via ${service})"
            echo "$ip"
            return 0
        fi
        log_debug "Service ${service} failed or returned invalid IP"
    done

    # Fallback to DNS-based detection using dig
    if command -v dig &> /dev/null; then
        log_debug "Trying DNS-based IP detection (OpenDNS)"
        ip=$(dig +short +time=5 +tries=1 myip.opendns.com @resolver1.opendns.com 2>/dev/null | tail -n1 | tr -d '[:space:]')

        if [ -n "$ip" ] && validate_ip "$ip"; then
            log_info "Detected public IP: ${ip} (via DNS)"
            echo "$ip"
            return 0
        fi
    fi

    log_error "Failed to detect public IP from all services"
    return 1
}

# Validate IP address format
validate_ip() {
    local ip="$1"

    # Basic IPv4 validation regex
    if [[ $ip =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$ ]]; then
        # Check each octet is 0-255
        IFS='.' read -ra OCTETS <<< "$ip"
        for octet in "${OCTETS[@]}"; do
            if [ "$octet" -gt 255 ]; then
                return 1
            fi
        done
        return 0
    fi

    # Basic IPv6 validation (simple check for colons)
    if [[ $ip =~ : ]]; then
        # This is a simplified IPv6 check
        return 0
    fi

    return 1
}

# ============================================================================
# IP STORAGE & COMPARISON
# ============================================================================

# Get last known IP from file
get_last_ip() {
    if [ -f "${LAST_IP_FILE}" ]; then
        cat "${LAST_IP_FILE}"
    else
        echo ""
    fi
}

# Save current IP to file
save_current_ip() {
    local ip="$1"
    echo "$ip" > "${LAST_IP_FILE}"
    log_debug "Saved IP to ${LAST_IP_FILE}"
}

# ============================================================================
# SMARTDNS API
# ============================================================================

# Update SmartDNSProxy with new IP
update_smartdns() {
    local api_key="$1"
    local current_ip="$2"
    local test_mode="${3:-false}"

    if [ "$test_mode" = "true" ]; then
        log_info "[TEST MODE] Would update SmartDNSProxy with IP: ${current_ip}"
        return 0
    fi

    local api_url="${API_BASE_URL}/${api_key}"

    log_info "Updating SmartDNSProxy..."
    log_debug "Calling API endpoint (key hidden for security)"

    # Call API (don't log the full URL with API key)
    local response
    local http_code

    response=$(curl -sf --max-time "${CURL_TIMEOUT}" -w "\n%{http_code}" "${api_url}" 2>&1)
    local curl_exit=$?

    # Extract HTTP code from last line
    http_code=$(echo "$response" | tail -n1)
    response=$(echo "$response" | head -n-1)

    if [ $curl_exit -ne 0 ]; then
        log_error "API call failed (curl exit code: ${curl_exit})"
        return 1
    fi

    # Check HTTP response code
    if [ "$http_code" = "200" ] || [ "$http_code" = "201" ]; then
        log_info "SmartDNSProxy updated successfully (HTTP ${http_code})"
        log_debug "API response: ${response}"
        return 0
    else
        log_error "SmartDNSProxy API returned HTTP ${http_code}"
        log_debug "API response: ${response}"
        return 1
    fi
}

# ============================================================================
# MAIN LOGIC
# ============================================================================

main() {
    local api_key="$1"
    local test_mode=false

    # Parse arguments
    if [ "$2" = "--test" ]; then
        test_mode=true
        log_info "Running in TEST MODE - no API calls will be made"
    fi

    log_info "========================================"
    log_info "SmartDNS IP Updater Starting"
    log_info "========================================"

    # Validate API key argument
    if [ -z "$api_key" ]; then
        log_error "Usage: $0 <API_KEY> [--test]"
        log_error "API key is required as first argument"
        return 1
    fi

    # Basic API key validation (should be non-empty and reasonable length)
    if [ ${#api_key} -lt 10 ]; then
        log_error "API key appears invalid (too short)"
        return 1
    fi

    log_debug "API key provided (length: ${#api_key} chars)"

    # Acquire lock
    if ! acquire_lock; then
        log_error "Failed to acquire lock. Exiting."
        return 1
    fi

    # Get current public IP
    local current_ip
    if ! current_ip=$(get_public_ip); then
        log_error "Failed to detect public IP. Exiting."
        return 1
    fi

    # Get last known IP
    local last_ip
    last_ip=$(get_last_ip)

    if [ -z "$last_ip" ]; then
        log_info "No previous IP found. This appears to be the first run."
        log_info "Current IP: ${current_ip}"

        # Update SmartDNS on first run
        if update_smartdns "$api_key" "$current_ip" "$test_mode"; then
            save_current_ip "$current_ip"
            log_info "Initial setup complete"
            return 0
        else
            log_error "Failed to update SmartDNSProxy on first run"
            return 1
        fi
    fi

    # Compare IPs
    if [ "$current_ip" = "$last_ip" ]; then
        log_info "IP unchanged: ${current_ip}"
        log_info "No update needed. Exiting."
        return 0
    fi

    # IP has changed
    log_info "IP CHANGED!"
    log_info "  Old IP: ${last_ip}"
    log_info "  New IP: ${current_ip}"

    # Update SmartDNS
    if update_smartdns "$api_key" "$current_ip" "$test_mode"; then
        save_current_ip "$current_ip"
        log_info "IP update completed successfully"
        return 0
    else
        log_error "Failed to update SmartDNSProxy"
        log_error "Will retry on next run"
        return 1
    fi
}

# ============================================================================
# SCRIPT ENTRY POINT
# ============================================================================

# Set overall script timeout
(
    sleep "${SCRIPT_TIMEOUT}"
    log_error "Script timeout reached (${SCRIPT_TIMEOUT}s). Killing script."
    kill $$ 2>/dev/null
) &
timeout_pid=$!

# Run main function
main "$@"
exit_code=$?

# Kill timeout process if still running
kill $timeout_pid 2>/dev/null
wait $timeout_pid 2>/dev/null

log_info "Script finished with exit code: ${exit_code}"
log_info "========================================"

exit $exit_code
