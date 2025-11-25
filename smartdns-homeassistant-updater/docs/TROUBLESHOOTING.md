# Troubleshooting Guide

Common issues and solutions for SmartDNS Home Assistant Updater.

---

## Table of Contents

- [General Debugging](#general-debugging)
- [Installation Issues](#installation-issues)
- [Configuration Issues](#configuration-issues)
- [Script Execution Issues](#script-execution-issues)
- [API Issues](#api-issues)
- [Automation Issues](#automation-issues)
- [Sensor Issues](#sensor-issues)
- [Log Issues](#log-issues)
- [Getting Help](#getting-help)

---

## General Debugging

### How to Check Logs

**SmartDNS Update Logs:**
```bash
# View latest entries
tail /config/logs/smartdns_updates.log

# Follow logs in real-time
tail -f /config/logs/smartdns_updates.log

# View full log
cat /config/logs/smartdns_updates.log
```

**Via File Editor:**
1. Open File Editor
2. Navigate to `config/logs/`
3. Open `smartdns_updates.log`

**Home Assistant System Logs:**
1. Go to **Settings** → **System** → **Logs**
2. Look for errors related to `shell_command.smartdns_update`

### Enable Debug Logging

The script logs at INFO level by default. For more details, manually run with test mode:

```bash
bash /config/scripts/smartdns_update.sh "YOUR_API_KEY" --test
```

---

## Installation Issues

### ❌ Script File Not Found

**Error:**
```
/bin/bash: /config/scripts/smartdns_update.sh: No such file or directory
```

**Solutions:**

1. **Verify file exists:**
   ```bash
   ls -la /config/scripts/smartdns_update.sh
   ```

2. **Check directory exists:**
   ```bash
   ls -la /config/scripts/
   ```

3. **Create directory if missing:**
   ```bash
   mkdir -p /config/scripts
   ```

4. **Re-download or re-create the script**

### ❌ Permission Denied

**Error:**
```
Permission denied: /config/scripts/smartdns_update.sh
```

**Solutions:**

1. **Make script executable:**
   ```bash
   chmod +x /config/scripts/smartdns_update.sh
   ```

2. **Check file permissions:**
   ```bash
   ls -l /config/scripts/smartdns_update.sh
   ```
   Should show: `-rwxr-xr-x` or similar

### ❌ Can't Create Logs Directory

**Error in logs:**
```
mkdir: can't create directory '/config/logs': Permission denied
```

**Solutions:**

1. **Manually create directory:**
   ```bash
   mkdir -p /config/logs
   ```

2. **Check /config is writable:**
   ```bash
   ls -ld /config
   ```

---

## Configuration Issues

### ❌ Configuration Invalid

**Error:**
```
Invalid config for [shell_command]: ...
```

**Solutions:**

1. **Check YAML syntax:**
   - Indentation must be exact (2 spaces, not tabs)
   - Colons followed by space
   - No extra quotes in template

2. **Verify configuration structure:**
   ```yaml
   shell_command:
     smartdns_update: "bash /config/scripts/smartdns_update.sh {{ smartdns_api_key }}"
   ```

3. **Use YAML validator:**
   - Developer Tools → YAML → Check Configuration

### ❌ Secret Not Found

**Error:**
```
UndefinedError: 'smartdns_api_key' is undefined
```

**Solutions:**

1. **Verify secrets.yaml exists:**
   ```bash
   ls -la /config/secrets.yaml
   ```

2. **Check secret name matches exactly:**
   - In `secrets.yaml`: `smartdns_api_key: "..."`
   - In `configuration.yaml`: `{{ smartdns_api_key }}`
   - Names are case-sensitive!

3. **Check YAML syntax in secrets.yaml:**
   ```yaml
   smartdns_api_key: "your-key-here"
   ```
   - No extra spaces before/after
   - Quote the key value

4. **Reload configuration after editing secrets**

### ❌ Shell Command Not Available

**Error:**
Service `shell_command.smartdns_update` not found

**Solutions:**

1. **Verify configuration.yaml includes shell_command:**
   ```bash
   grep -A 1 "shell_command:" /config/configuration.yaml
   ```

2. **Restart Home Assistant:**
   Settings → System → Restart

3. **Check for YAML errors:**
   Developer Tools → YAML → Check Configuration

---

## Script Execution Issues

### ❌ Script Times Out

**Error:**
```
Timeout running script
```

**Solutions:**

1. **Check network connectivity:**
   ```bash
   ping -c 4 icanhazip.com
   ```

2. **Test IP services manually:**
   ```bash
   curl -v https://icanhazip.com
   curl -v https://api.ipify.org
   ```

3. **Check script timeout setting** (in script):
   ```bash
   readonly SCRIPT_TIMEOUT=55
   ```
   Should be under 60 seconds for HAOS

4. **Reduce curl timeout** (in script):
   ```bash
   readonly CURL_TIMEOUT=10
   ```

### ❌ Failed to Detect Public IP

**Error in logs:**
```
[ERROR] Failed to detect public IP from all services
```

**Solutions:**

1. **Test IP detection manually:**
   ```bash
   curl https://icanhazip.com
   curl https://api.ipify.org
   curl https://ifconfig.me/ip
   ```

2. **Check DNS resolution:**
   ```bash
   nslookup icanhazip.com
   ```

3. **Test DNS-based detection:**
   ```bash
   dig +short myip.opendns.com @resolver1.opendns.com
   ```

4. **Check firewall/network restrictions:**
   - Home Assistant may be blocked from accessing external services
   - Check router/firewall settings

5. **Verify internet connection:**
   ```bash
   ping -c 4 8.8.8.8
   ```

### ❌ Lock File Issues

**Error in logs:**
```
[ERROR] Could not acquire lock after 30 seconds
```

**Solutions:**

1. **Check for running instances:**
   ```bash
   ps aux | grep smartdns_update.sh
   ```

2. **Remove stale lock file:**
   ```bash
   rm /config/smartdns_update.lock
   ```

3. **Check lock file age:**
   ```bash
   ls -l /config/smartdns_update.lock
   ```
   If older than 5 minutes, safe to delete

4. **Prevent multiple simultaneous runs:**
   - Ensure automation has `mode: single`
   - Check for duplicate automations

---

## API Issues

### ❌ API Key Invalid

**Error in logs:**
```
[ERROR] API key appears invalid (too short)
```

**Solutions:**

1. **Verify API key length:**
   - Should be 30+ characters
   - Check for copy/paste errors

2. **Check for extra spaces:**
   ```yaml
   # Wrong:
   smartdns_api_key: " YOUR_KEY "

   # Correct:
   smartdns_api_key: "YOUR_KEY"
   ```

3. **Verify key is active:**
   - Log in to SmartDNSProxy
   - Check account status
   - Regenerate API key if necessary

4. **Test API key manually:**
   ```bash
   curl "https://www.smartdnsproxy.com/api/IP/update/YOUR_API_KEY"
   ```

### ❌ API Call Failed

**Error in logs:**
```
[ERROR] API call failed (curl exit code: 6)
```

**Common curl exit codes:**
- `6` - Couldn't resolve host (DNS issue)
- `7` - Failed to connect (network issue)
- `28` - Timeout
- `35` - SSL/TLS error

**Solutions:**

1. **Check internet connectivity:**
   ```bash
   ping www.smartdnsproxy.com
   ```

2. **Test API endpoint:**
   ```bash
   curl -v "https://www.smartdnsproxy.com/api/IP/update/YOUR_API_KEY"
   ```

3. **Check SSL certificates:**
   ```bash
   curl -v https://www.smartdnsproxy.com
   ```

4. **Increase timeout:**
   Edit script, change:
   ```bash
   readonly CURL_TIMEOUT=15  # Increase from 10
   ```

### ❌ API Returns Error

**Error in logs:**
```
[ERROR] SmartDNSProxy API returned HTTP 401
```

**HTTP status codes:**
- `401` - Unauthorized (invalid API key)
- `403` - Forbidden (account issue)
- `404` - Not found (wrong endpoint)
- `429` - Too many requests (rate limited)
- `500` - Server error

**Solutions:**

1. **401/403 - Check API key:**
   - Verify in SmartDNSProxy account
   - Regenerate if necessary

2. **429 - Reduce check frequency:**
   - Change automation to run less often
   - Wait for rate limit to reset

3. **500 - SmartDNS server issue:**
   - Wait and retry later
   - Check SmartDNS status page

---

## Automation Issues

### ❌ Automation Not Triggering

**Symptoms:**
- No logs created
- IP never updates

**Solutions:**

1. **Check automation is enabled:**
   - Settings → Automations & Scenes
   - Find your automation
   - Toggle should be ON (blue)

2. **Verify trigger configuration:**
   ```yaml
   trigger:
     - platform: time_pattern
       minutes: "/5"
   ```

3. **Check automation mode:**
   ```yaml
   mode: single
   ```

4. **View automation traces:**
   - Settings → Automations → [Your Automation]
   - Click **Traces** tab
   - Check for errors

5. **Manually trigger:**
   - Open automation
   - Click three dots → Run

### ❌ Automation Runs But Script Doesn't Execute

**Solutions:**

1. **Check service call:**
   ```yaml
   action:
     - service: shell_command.smartdns_update
       data: {}
   ```

2. **Test service manually:**
   - Developer Tools → Services
   - Call `shell_command.smartdns_update`

3. **Check Home Assistant logs:**
   - Settings → System → Logs
   - Look for shell_command errors

### ❌ Multiple Instances Running

**Error in logs:**
```
[WARN] Waiting for lock...
```

**Solutions:**

1. **Set automation mode to single:**
   ```yaml
   mode: single
   max_exceeded: silent
   ```

2. **Check for duplicate automations:**
   - Settings → Automations
   - Disable duplicates

3. **Increase script timeout:**
   - If script takes too long, locks may conflict

---

## Sensor Issues

### ❌ Sensor Shows "Unknown"

**Solutions:**

1. **Verify file exists:**
   ```bash
   ls -la /config/smartdns_last_ip.txt
   ```

2. **Run script at least once:**
   - Developer Tools → Services
   - Call `shell_command.smartdns_update`

3. **Check sensor configuration:**
   ```yaml
   - platform: file
     name: "SmartDNS Current IP"
     file_path: /config/smartdns_last_ip.txt
   ```

4. **Reload sensors:**
   - Developer Tools → YAML → Sensors

### ❌ Sensor Not Updating

**Solutions:**

1. **Check scan_interval:**
   ```yaml
   scan_interval: 60  # Seconds
   ```

2. **Manually update file:**
   ```bash
   echo "test" > /config/smartdns_last_ip.txt
   ```
   Check if sensor updates

3. **Restart Home Assistant**

---

## Log Issues

### ❌ Logs Not Created

**Solutions:**

1. **Create logs directory:**
   ```bash
   mkdir -p /config/logs
   ```

2. **Check write permissions:**
   ```bash
   touch /config/logs/test.txt
   rm /config/logs/test.txt
   ```

3. **Run script manually:**
   ```bash
   bash /config/scripts/smartdns_update.sh "YOUR_API_KEY"
   ```

### ❌ Logs Too Large

**Solutions:**

1. **Rotate logs manually:**
   ```bash
   mv /config/logs/smartdns_updates.log /config/logs/smartdns_updates.log.old
   ```

2. **Clear old logs:**
   ```bash
   rm /config/logs/smartdns_updates.log
   ```

3. **Implement log rotation** (future feature)

---

## Getting Help

### Before Asking for Help

1. **Check logs:**
   - `/config/logs/smartdns_updates.log`
   - Settings → System → Logs

2. **Verify configuration:**
   - Developer Tools → YAML → Check Configuration

3. **Test manually:**
   - Developer Tools → Services
   - Call `shell_command.smartdns_update`

4. **Try test mode:**
   ```bash
   bash /config/scripts/smartdns_update.sh "YOUR_KEY" --test
   ```

### Information to Provide

When opening an issue, include:

1. **Home Assistant version:**
   ```
   Settings → System → About
   ```

2. **Installation type:**
   - Home Assistant OS
   - Home Assistant Green
   - Supervised
   - Container
   - Core

3. **Error logs:**
   ```bash
   # Last 50 lines from script log
   tail -n 50 /config/logs/smartdns_updates.log
   ```
   **⚠️ REMOVE YOUR API KEY FROM LOGS BEFORE SHARING!**

4. **Configuration (sanitized):**
   - Your `shell_command` configuration
   - Your automation configuration
   - **Remove API key!**

5. **Steps to reproduce:**
   - What you did
   - What you expected
   - What actually happened

### Where to Get Help

- **GitHub Issues**: [Open an issue](https://github.com/yourusername/smartdns-homeassistant-updater/issues)
- **Home Assistant Community**: [community.home-assistant.io](https://community.home-assistant.io/)
- **SmartDNS Support**: For API-related issues

---

## Advanced Debugging

### Test IP Detection Services

```bash
# Test all IP services
for service in https://icanhazip.com https://api.ipify.org https://ifconfig.me/ip; do
    echo "Testing: $service"
    curl -v --max-time 10 "$service"
    echo ""
done
```

### Test DNS-based Detection

```bash
dig +short myip.opendns.com @resolver1.opendns.com
```

### Test API Endpoint

```bash
# Replace YOUR_API_KEY with actual key
curl -v "https://www.smartdnsproxy.com/api/IP/update/YOUR_API_KEY"
```

### Monitor Script Execution

```bash
# Run script with verbose output
bash -x /config/scripts/smartdns_update.sh "YOUR_API_KEY" 2>&1 | tee debug.log
```

### Check Home Assistant Shell Environment

```bash
# Check available commands
which curl
which dig
which bash

# Check curl version
curl --version

# Check bash version
bash --version
```

---

## Still Having Issues?

If you've tried everything and still need help:

1. **Open a GitHub issue**: [Create Issue](https://github.com/yourusername/smartdns-homeassistant-updater/issues)
2. **Include all relevant information** (see above)
3. **Be patient** - maintainers are volunteers

---

**Remember**: Remove your API key from any logs or configuration you share publicly!
