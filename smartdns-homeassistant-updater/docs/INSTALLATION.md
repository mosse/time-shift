# Installation Guide

Complete step-by-step installation instructions for SmartDNS Home Assistant Updater.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Installation Methods](#installation-methods)
  - [Method 1: File Editor (Easiest)](#method-1-file-editor-easiest)
  - [Method 2: Terminal & SSH](#method-2-terminal--ssh)
  - [Method 3: Samba Share](#method-3-samba-share)
- [Configuration](#configuration)
- [Setting Up Automations](#setting-up-automations)
- [Optional: Sensors](#optional-sensors)
- [Optional: Dashboard Cards](#optional-dashboard-cards)
- [Verification](#verification)

---

## Prerequisites

### Required Software

Before starting, ensure you have:

1. **Home Assistant** installed and running
   - Version 2021.12.0 or later recommended
   - Home Assistant OS, Green, Supervised, or Container

2. **SmartDNSProxy Account**
   - Active subscription at [smartdnsproxy.com](https://www.smartdnsproxy.com/)
   - API key from your account settings

3. **At least one of these Home Assistant add-ons**:
   - File Editor (recommended for beginners)
   - Terminal & SSH (for advanced users)
   - Samba Share (for editing from your computer)

### Getting Your SmartDNSProxy API Key

1. Log in to [SmartDNSProxy](https://www.smartdnsproxy.com/)
2. Navigate to **My Account** or **Settings**
3. Look for **API** or **API Key** section
4. Copy your API key (usually a long alphanumeric string)
5. Save it somewhere safe - you'll need it during setup

### Installing Required Add-ons

#### Installing File Editor

1. In Home Assistant, go to **Settings** → **Add-ons**
2. Click **Add-on Store** (bottom right)
3. Search for **File Editor**
4. Click **File Editor** → **Install**
5. Wait for installation to complete
6. Toggle **Start on boot** and **Show in sidebar**
7. Click **Start**

#### Installing Terminal & SSH (Optional)

1. Go to **Settings** → **Add-ons** → **Add-on Store**
2. Search for **Terminal & SSH**
3. Click **Terminal & SSH** → **Install**
4. Configure password in the **Configuration** tab
5. Click **Start**

---

## Installation Methods

Choose the method that works best for you. **Method 1 (File Editor)** is recommended for most users.

---

## Method 1: File Editor (Easiest)

### Step 1: Download the Script

First, get the update script from this repository:

1. Visit [smartdns-homeassistant-updater/scripts/smartdns_update.sh](../scripts/smartdns_update.sh)
2. Click **Raw** button
3. Copy all the text (Ctrl+A, Ctrl+C)

### Step 2: Create the Scripts Directory

1. In Home Assistant, click **File Editor** in the sidebar
2. Click the folder icon (📁) in the top left
3. Navigate to the root (`config/`)
4. Click the folder icon with + to create a new folder
5. Name it: `scripts`
6. Press Enter

### Step 3: Create the Script File

1. Inside the `scripts` folder, click the file icon with +
2. Name it: `smartdns_update.sh`
3. Paste the script content you copied in Step 1
4. Click the **Save** icon (💾)

### Step 4: Add Your API Key to Secrets

1. In File Editor, navigate to the root (`config/`)
2. Open `secrets.yaml` (create it if it doesn't exist)
3. Add this line at the end:
   ```yaml
   smartdns_api_key: "YOUR_ACTUAL_API_KEY_HERE"
   ```
4. Replace `YOUR_ACTUAL_API_KEY_HERE` with your SmartDNSProxy API key
5. Save the file

**Example secrets.yaml:**
```yaml
# Existing secrets (don't remove these!)
http_password: "my_password"

# SmartDNS API Key
smartdns_api_key: "abcd1234efgh5678ijkl9012mnop3456qrst7890"
```

### Step 5: Configure Shell Command

1. In File Editor, open `configuration.yaml`
2. Find the `shell_command:` section (or add it if missing)
3. Add this under `shell_command:`:
   ```yaml
   shell_command:
     smartdns_update: "bash /config/scripts/smartdns_update.sh {{ smartdns_api_key }}"
   ```
4. Save the file

**Example configuration.yaml:**
```yaml
# ... other configuration ...

shell_command:
  smartdns_update: "bash /config/scripts/smartdns_update.sh {{ smartdns_api_key }}"

# ... more configuration ...
```

### Step 6: Check Configuration

1. Go to **Developer Tools** (in sidebar or Settings)
2. Click **YAML** tab
3. Click **Check Configuration**
4. Wait for validation
5. If you see "Configuration valid!", proceed
6. If errors appear, review the error message and fix the issue

### Step 7: Restart Home Assistant

1. Go to **Settings** → **System**
2. Click **Restart** (top right)
3. Click **Restart Home Assistant**
4. Wait for Home Assistant to restart (1-2 minutes)

### Step 8: Test the Script

1. After restart, go to **Developer Tools** → **Services**
2. In the **Service** dropdown, search for `shell_command.smartdns_update`
3. Click **Call Service**
4. Check for errors in the notification area

### Step 9: View Logs

1. In File Editor, navigate to `config/logs/`
2. Open `smartdns_updates.log`
3. You should see log entries like:
   ```
   [2024-11-25 10:15:32] [INFO] SmartDNS IP Updater Starting
   [2024-11-25 10:15:33] [INFO] Detected public IP: 123.45.67.89
   ```

**Success!** If you see logs and no errors, the script is working. Proceed to [Setting Up Automations](#setting-up-automations).

---

## Method 2: Terminal & SSH

For advanced users comfortable with the command line.

### Step 1: Connect via SSH

1. Open Terminal & SSH add-on from Home Assistant sidebar
2. Or use an SSH client (like PuTTY) to connect to your Home Assistant IP

### Step 2: Create Scripts Directory

```bash
mkdir -p /config/scripts
cd /config/scripts
```

### Step 3: Download the Script

**Option A: Using wget**
```bash
wget https://raw.githubusercontent.com/yourusername/smartdns-homeassistant-updater/main/scripts/smartdns_update.sh
```

**Option B: Using curl**
```bash
curl -o smartdns_update.sh https://raw.githubusercontent.com/yourusername/smartdns-homeassistant-updater/main/scripts/smartdns_update.sh
```

**Option C: Create manually**
```bash
nano smartdns_update.sh
# Paste the script content
# Press Ctrl+X, then Y, then Enter to save
```

### Step 4: Make Script Executable (Optional - HAOS handles this)

```bash
chmod +x smartdns_update.sh
```

### Step 5: Add API Key to Secrets

```bash
nano /config/secrets.yaml
```

Add this line:
```yaml
smartdns_api_key: "YOUR_ACTUAL_API_KEY_HERE"
```

Save: Ctrl+X, Y, Enter

### Step 6: Configure Shell Command

```bash
nano /config/configuration.yaml
```

Add:
```yaml
shell_command:
  smartdns_update: "bash /config/scripts/smartdns_update.sh {{ smartdns_api_key }}"
```

Save: Ctrl+X, Y, Enter

### Step 7: Validate and Restart

```bash
# Check configuration
ha core check

# Restart Home Assistant
ha core restart
```

### Step 8: Test the Script

```bash
# Wait for Home Assistant to restart, then test manually
bash /config/scripts/smartdns_update.sh "YOUR_API_KEY"

# Check logs
tail -f /config/logs/smartdns_updates.log
```

---

## Method 3: Samba Share

For users who prefer editing files from their computer.

### Step 1: Install Samba Share Add-on

1. Go to **Settings** → **Add-ons** → **Add-on Store**
2. Search for **Samba Share**
3. Install and configure with a username/password
4. Start the add-on

### Step 2: Connect to Samba Share

**On Windows:**
1. Open File Explorer
2. In address bar, type: `\\YOUR_HA_IP\config`
3. Enter Samba credentials when prompted

**On macOS:**
1. Open Finder
2. Press Cmd+K
3. Enter: `smb://YOUR_HA_IP/config`
4. Connect with Samba credentials

**On Linux:**
1. Open file manager
2. Connect to server: `smb://YOUR_HA_IP/config`

### Step 3: Create Scripts Folder

1. In the `config` share, create a new folder named `scripts`

### Step 4: Copy Script File

1. Download `smartdns_update.sh` from this repository
2. Copy it to `config/scripts/smartdns_update.sh`

### Step 5: Edit Configuration Files

Using your preferred text editor (VS Code, Notepad++, etc.):

**Edit secrets.yaml:**
```yaml
smartdns_api_key: "YOUR_ACTUAL_API_KEY_HERE"
```

**Edit configuration.yaml:**
```yaml
shell_command:
  smartdns_update: "bash /config/scripts/smartdns_update.sh {{ smartdns_api_key }}"
```

### Step 6: Restart Home Assistant

1. Go to **Settings** → **System** → **Restart**

### Step 7: Test

Follow verification steps in [Method 1, Step 8-9](#step-8-test-the-script)

---

## Configuration

Now that the basic installation is complete, let's configure automations.

---

## Setting Up Automations

Automations run the IP check automatically at regular intervals.

### Option A: Create via UI (Recommended)

1. Go to **Settings** → **Automations & Scenes**
2. Click **+ Create Automation** (bottom right)
3. Click **Create new automation**
4. Click the three dots (⋮) → **Edit in YAML**
5. Paste this configuration:

```yaml
alias: "SmartDNS: Check IP Every 5 Minutes"
description: Periodically checks public IP and updates SmartDNSProxy when it changes
trigger:
  - platform: time_pattern
    minutes: "/5"
condition: []
action:
  - service: shell_command.smartdns_update
    data: {}
mode: single
```

6. Click **Save**
7. Name it: "SmartDNS IP Check"

### Option B: Add to automations.yaml

1. Open File Editor
2. Navigate to `config/automations.yaml`
3. Add the automation from Option A
4. Save the file
5. Go to **Developer Tools** → **YAML** → **Automations** → **Reload Automations**

### Additional Automation: Check on Startup

This ensures SmartDNS is updated when Home Assistant restarts:

```yaml
alias: "SmartDNS: Check IP on Home Assistant Start"
description: Updates SmartDNSProxy when Home Assistant starts
trigger:
  - platform: homeassistant
    event: start
condition: []
action:
  - delay:
      hours: 0
      minutes: 1
      seconds: 0
  - service: shell_command.smartdns_update
    data: {}
mode: single
```

### Adjusting Check Frequency

Change the `minutes:` value in the time_pattern trigger:

- Every 5 minutes: `minutes: "/5"`
- Every 10 minutes: `minutes: "/10"`
- Every 15 minutes: `minutes: "/15"`
- Every 30 minutes: `minutes: "/30"`

**Recommendation**: Start with 5 minutes, adjust based on how often your IP changes.

---

## Optional: Sensors

Sensors let you track your public IP in Home Assistant.

### Step 1: Create sensors.yaml

1. In File Editor, create file: `config/sensors.yaml`
2. Add this content:

```yaml
# Current Public IP
- platform: file
  name: "SmartDNS Current IP"
  file_path: /config/smartdns_last_ip.txt
  icon: mdi:ip-network
  scan_interval: 60

# Last update time (using command line)
- platform: command_line
  name: "SmartDNS Last Update"
  command: "stat -c %y /config/smartdns_last_ip.txt 2>/dev/null | cut -d'.' -f1 || echo 'Never'"
  icon: mdi:clock-outline
  scan_interval: 60

# Last log entry
- platform: command_line
  name: "SmartDNS Update Status"
  command: "tail -n 1 /config/logs/smartdns_updates.log 2>/dev/null || echo 'No logs yet'"
  icon: mdi:information-outline
  scan_interval: 300
```

3. Save the file

### Step 2: Include sensors in configuration.yaml

1. Open `configuration.yaml`
2. Add this line (usually near the top):

```yaml
sensor: !include sensors.yaml
```

3. Save the file

### Step 3: Reload Configuration

1. **Developer Tools** → **YAML** → **Check Configuration**
2. If valid: **Developer Tools** → **YAML** → **Sensors** → **Reload**

### Step 4: Verify Sensors

1. Go to **Developer Tools** → **States**
2. Search for `sensor.smartdns`
3. You should see:
   - `sensor.smartdns_current_ip`
   - `sensor.smartdns_last_update`
   - `sensor.smartdns_update_status`

---

## Optional: Dashboard Cards

Add visual status display to your Home Assistant dashboard.

### Simple Status Card

1. Go to your dashboard
2. Click three dots (⋮) → **Edit Dashboard**
3. Click **+ Add Card**
4. Click **Manual Card** (bottom)
5. Paste this YAML:

```yaml
type: entities
title: SmartDNS Proxy Status
icon: mdi:ip-network
entities:
  - entity: sensor.smartdns_current_ip
    name: Current Public IP
  - entity: sensor.smartdns_last_update
    name: Last Updated
  - entity: sensor.smartdns_update_status
    name: Status
```

6. Click **Save**

For more card examples, see [lovelace/dashboard-card.yaml](../lovelace/dashboard-card.yaml).

---

## Verification

Let's verify everything is working correctly.

### ✅ Checklist

1. **Script exists**: `/config/scripts/smartdns_update.sh`
2. **API key stored**: Check `/config/secrets.yaml`
3. **Shell command configured**: Check `configuration.yaml`
4. **Automation created**: Check **Settings** → **Automations**
5. **Logs created**: Check `/config/logs/smartdns_updates.log`

### Test Manually

1. **Developer Tools** → **Services**
2. Service: `shell_command.smartdns_update`
3. Click **Call Service**
4. Check logs at `/config/logs/smartdns_updates.log`

**Expected log output:**
```
[2024-11-25 10:15:32] [INFO] ========================================
[2024-11-25 10:15:32] [INFO] SmartDNS IP Updater Starting
[2024-11-25 10:15:32] [INFO] ========================================
[2024-11-25 10:15:33] [INFO] Detected public IP: 123.45.67.89 (via https://icanhazip.com)
[2024-11-25 10:15:33] [INFO] No previous IP found. This appears to be the first run.
[2024-11-25 10:15:33] [INFO] Current IP: 123.45.67.89
[2024-11-25 10:15:33] [INFO] Updating SmartDNSProxy...
[2024-11-25 10:15:34] [INFO] SmartDNSProxy updated successfully (HTTP 200)
[2024-11-25 10:15:34] [INFO] Initial setup complete
```

### Wait for Automation

Wait 5-10 minutes for the automation to trigger automatically, then check logs again.

### Verify SmartDNS Website

1. Log in to [SmartDNSProxy](https://www.smartdnsproxy.com/)
2. Check your current IP in account settings
3. It should match the IP in your logs

---

## Troubleshooting

If you encounter issues, see [TROUBLESHOOTING.md](TROUBLESHOOTING.md) or:

**Common Issues:**

- **"Command not found"**: Check file path is `/config/scripts/smartdns_update.sh`
- **"API key invalid"**: Verify API key in `secrets.yaml` matches SmartDNSProxy
- **No logs created**: Check automation is enabled and triggering
- **IP detection fails**: Check internet connectivity

**Getting Help:**

- Check logs: `/config/logs/smartdns_updates.log`
- Home Assistant logs: **Settings** → **System** → **Logs**
- Open an issue on GitHub with your logs (remove API key!)

---

## Next Steps

Now that installation is complete:

1. ✅ Monitor logs for the first 24 hours
2. ✅ Add dashboard cards (optional)
3. ✅ Set up notifications (optional)
4. ✅ Adjust automation frequency if needed
5. ✅ Star this repository if it helps you! ⭐

---

**Installation complete! Your SmartDNSProxy should now update automatically.** 🎉

Need help? [Open an issue](https://github.com/yourusername/smartdns-homeassistant-updater/issues)
