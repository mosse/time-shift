# SmartDNS Home Assistant Updater

**Automatically update SmartDNSProxy when your dynamic IP changes on Home Assistant**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Home Assistant](https://img.shields.io/badge/Home%20Assistant-Compatible-blue.svg)](https://www.home-assistant.io/)
[![Bash](https://img.shields.io/badge/Bash-5.0+-green.svg)](https://www.gnu.org/software/bash/)

---

## 📋 Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Detailed Installation](#detailed-installation)
- [Configuration](#configuration)
- [Usage](#usage)
- [Dashboard Integration](#dashboard-integration)
- [Troubleshooting](#troubleshooting)
- [Security](#security)
- [Contributing](#contributing)
- [License](#license)
- [Support](#support)

---

## 🎯 Overview

This project provides a complete, production-ready solution for automatically updating [SmartDNSProxy](https://www.smartdnsproxy.com/) with your current public IP address when it changes. Designed specifically for **Home Assistant OS** (including Home Assistant Green), it handles the unique constraints of running in a containerized environment.

### Why This Project?

If you have a dynamic IP address from your ISP (like Sonic), SmartDNSProxy needs to know your current IP to work properly. This automation:

- ✅ Monitors your IP every 5-10 minutes
- ✅ Only updates SmartDNS when your IP actually changes (minimizes API calls)
- ✅ Survives Home Assistant restarts (persists data in `/config`)
- ✅ Handles network failures gracefully with fallback IP detection services
- ✅ Provides detailed logging for debugging
- ✅ Never exposes your API key in logs or the UI
- ✅ Runs reliably within Home Assistant OS's 60-second timeout

### Platform Compatibility

- ✅ **Home Assistant OS** (Recommended)
- ✅ **Home Assistant Green**
- ✅ **Home Assistant Supervised**
- ✅ **Home Assistant Container** (Docker)
- ⚠️ **Home Assistant Core** (requires manual path adjustments)

---

## ✨ Features

### Essential Features

- **Automatic IP Detection**: Uses multiple services with intelligent fallbacks
  - icanhazip.com
  - api.ipify.org
  - ifconfig.me
  - OpenDNS (DNS-based fallback)

- **Smart Updates**: Only calls the SmartDNS API when IP actually changes

- **Robust Error Handling**:
  - Network timeout protection
  - Concurrent execution prevention (file locking)
  - Stale lock detection and recovery
  - Comprehensive error logging

- **Persistent Storage**: All data stored in `/config` to survive reboots

- **Security First**:
  - API keys stored in Home Assistant's `secrets.yaml`
  - Never logged or exposed in UI
  - Proper file permissions

### Optional Features

- **Dashboard Integration**: Beautiful Lovelace cards showing current IP and status
- **Notifications**: Get alerts when your IP changes
- **Manual Trigger**: Update SmartDNS on-demand from the UI
- **Status Sensors**: Track IP changes, update history, and API health
- **Enable/Disable Toggle**: Pause automatic updates from the dashboard

---

## 📦 Prerequisites

### Required

1. **Home Assistant OS** (or compatible variant)
2. **SmartDNSProxy Account** with API access
   - Sign up at [smartdnsproxy.com](https://www.smartdnsproxy.com/)
   - Obtain your API key from account settings

3. **Home Assistant Add-ons** (at least one):
   - **File Editor** (for editing config files via UI)
   - OR **Terminal & SSH** (for command-line access)
   - OR **Samba Share** (for editing files from your computer)

### Optional

- **Home Assistant Mobile App** (for IP change notifications)
- **HACS** (Home Assistant Community Store) - for advanced dashboard cards

### Technical Requirements

- Home Assistant version **2021.12.0** or later
- Internet connectivity
- Dynamic or static public IP address

---

## 🚀 Quick Start

### 1️⃣ Download Files

Clone or download this repository:

```bash
git clone https://github.com/yourusername/smartdns-homeassistant-updater.git
cd smartdns-homeassistant-updater
```

### 2️⃣ Copy Script to Home Assistant

Using **File Editor** add-on:
1. In Home Assistant, go to **File Editor**
2. Create directory: `/config/scripts/` (if it doesn't exist)
3. Create new file: `/config/scripts/smartdns_update.sh`
4. Copy contents from `scripts/smartdns_update.sh`
5. Save the file

### 3️⃣ Add API Key to Secrets

1. Edit `/config/secrets.yaml`
2. Add this line:
   ```yaml
   smartdns_api_key: "YOUR_API_KEY_HERE"
   ```
3. Replace `YOUR_API_KEY_HERE` with your actual SmartDNSProxy API key
4. Save the file

### 4️⃣ Configure Shell Command

1. Edit `/config/configuration.yaml`
2. Add:
   ```yaml
   shell_command:
     smartdns_update: "bash /config/scripts/smartdns_update.sh {{ smartdns_api_key }}"
   ```
3. Save and check configuration: **Developer Tools** > **YAML** > **Check Configuration**
4. If valid, restart Home Assistant

### 5️⃣ Create Automation

1. Go to **Settings** > **Automations & Scenes**
2. Click **+ Create Automation**
3. Choose **Create new automation** > **Start with an empty automation**
4. Set up:
   - **Trigger**: Time pattern - every 5 minutes (`/5`)
   - **Action**: Call service `shell_command.smartdns_update`
5. Save as "SmartDNS IP Check"

### 6️⃣ Test It!

1. Go to **Developer Tools** > **Services**
2. Select service: `shell_command.smartdns_update`
3. Click **Call Service**
4. Check logs: `/config/logs/smartdns_updates.log`

**Done!** Your IP will now update automatically. 🎉

---

## 📚 Detailed Installation

For step-by-step installation with screenshots and detailed explanations, see **[INSTALLATION.md](docs/INSTALLATION.md)**.

Topics covered:
- Installing via File Editor, SSH, or Samba
- Detailed configuration options
- Setting up optional sensors and dashboard cards
- Configuring notifications
- Advanced automation options

---

## ⚙️ Configuration

### API Key Storage (Required)

**Method 1: Home Assistant Secrets (Recommended)**

Edit `/config/secrets.yaml`:
```yaml
smartdns_api_key: "your-actual-api-key-here"
```

Reference in `/config/configuration.yaml`:
```yaml
shell_command:
  smartdns_update: "bash /config/scripts/smartdns_update.sh {{ smartdns_api_key }}"
```

**Method 2: Direct in Configuration (Not Recommended)**

```yaml
shell_command:
  smartdns_update: "bash /config/scripts/smartdns_update.sh YOUR_API_KEY_HERE"
```

⚠️ **Warning**: Less secure, key may appear in logs or backups.

### Automation Frequency

Edit the automation's time pattern trigger:

```yaml
trigger:
  - platform: time_pattern
    minutes: "/5"  # Every 5 minutes
    # minutes: "/10"  # Every 10 minutes
    # minutes: "/15"  # Every 15 minutes
```

**Recommendations**:
- **5 minutes**: Best for frequently changing IPs
- **10 minutes**: Good balance for most users
- **15 minutes**: Minimal load, suitable for stable IPs

### Optional Sensors

To track IP and status in Home Assistant, create `/config/sensors.yaml`:

```yaml
- platform: file
  name: "SmartDNS Current IP"
  file_path: /config/smartdns_last_ip.txt
  icon: mdi:ip-network
```

Add to `/config/configuration.yaml`:
```yaml
sensor: !include sensors.yaml
```

See `config-examples/sensors.yaml.example` for complete sensor setup.

### Optional Dashboard

Add beautiful cards to your Lovelace dashboard. See `lovelace/dashboard-card.yaml` for 10+ card examples.

Simple example:
```yaml
type: entities
title: SmartDNS Status
entities:
  - entity: sensor.smartdns_current_ip
    name: Public IP
  - entity: sensor.smartdns_last_update
    name: Last Updated
```

---

## 🎮 Usage

### Manual Update

**Via Services:**
1. Go to **Developer Tools** > **Services**
2. Select `shell_command.smartdns_update`
3. Click **Call Service**

**Via Automation Button** (requires setup):
```yaml
script:
  smartdns_manual_update:
    alias: Update SmartDNS Now
    sequence:
      - service: shell_command.smartdns_update
```

### View Logs

**Via File Editor:**
1. Open **File Editor**
2. Navigate to `/config/logs/smartdns_updates.log`

**Via SSH:**
```bash
tail -f /config/logs/smartdns_updates.log
```

**Log Format:**
```
[2024-11-25 10:15:32] [INFO] ========================================
[2024-11-25 10:15:32] [INFO] SmartDNS IP Updater Starting
[2024-11-25 10:15:33] [INFO] Detected public IP: 123.45.67.89 (via https://icanhazip.com)
[2024-11-25 10:15:33] [INFO] IP unchanged: 123.45.67.89
[2024-11-25 10:15:33] [INFO] No update needed. Exiting.
```

### Test Mode

Test IP detection without calling the API:

```yaml
shell_command:
  smartdns_update_test: "bash /config/scripts/smartdns_update.sh {{ smartdns_api_key }} --test"
```

This detects your IP and logs what it would do, but doesn't actually call SmartDNS API.

---

## 📊 Dashboard Integration

### Simple Status Card

```yaml
type: entities
title: SmartDNS Proxy
icon: mdi:ip-network
entities:
  - entity: sensor.smartdns_current_ip
    name: Public IP
  - entity: sensor.smartdns_last_update
    name: Last Check
```

### Full Dashboard Example

See `lovelace/dashboard-card.yaml` for 10+ complete card examples including:
- Simple status displays
- Manual update buttons
- IP change history graphs
- API health monitoring
- Enable/disable toggles

---

## 🐛 Troubleshooting

### Common Issues

**Script doesn't run / No logs created**
- Check file path: `/config/scripts/smartdns_update.sh`
- Verify file is executable (should be by default in HAOS)
- Check configuration syntax in `configuration.yaml`
- Restart Home Assistant after config changes

**"API key appears invalid" error**
- Verify API key in `secrets.yaml` is correct
- Check for extra spaces or quotes
- Ensure API key is active in SmartDNSProxy account
- Test API key manually: `curl "https://www.smartdnsproxy.com/api/IP/update/YOUR_KEY"`

**IP detection fails**
- Check internet connectivity
- Try alternative IP services manually
- Check Home Assistant firewall settings
- Verify DNS resolution is working

**Automation doesn't trigger**
- Verify automation is enabled
- Check automation logs: **Settings** > **Automations** > **[Your Automation]** > **Traces**
- Ensure Home Assistant time is correct
- Reload automations: **Developer Tools** > **YAML** > **Automations**

**Logs show "Could not acquire lock"**
- Another instance may be running
- Stale lock file: delete `/config/smartdns_update.lock`
- Check for multiple automations triggering the same script

For more detailed troubleshooting, see **[TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)**.

---

## 🔒 Security

### Best Practices

✅ **DO:**
- Store API key in `secrets.yaml`
- Keep this file secure and never share it
- Use Home Assistant's built-in backup encryption
- Regularly rotate your API key

❌ **DON'T:**
- Commit `secrets.yaml` to version control (already in `.gitignore`)
- Share your API key publicly
- Hard-code API key in configuration files
- Disable Home Assistant's authentication

### What Gets Logged

✅ **Logged:**
- IP addresses (current and previous)
- API call success/failure
- Timestamp of operations
- Error messages

❌ **Never Logged:**
- Your SmartDNSProxy API key
- Full API URLs (key is hidden)

### File Permissions

All files are created within `/config` which is:
- Only accessible to Home Assistant
- Included in encrypted backups
- Not exposed via web interface

---

## 🤝 Contributing

Contributions are welcome! Here's how you can help:

### Reporting Issues

Found a bug? [Open an issue](https://github.com/yourusername/smartdns-homeassistant-updater/issues) with:
- Home Assistant version
- Setup details (HAOS, Green, etc.)
- Error messages from logs
- Steps to reproduce

### Suggesting Features

Have an idea? [Open a feature request](https://github.com/yourusername/smartdns-homeassistant-updater/issues) describing:
- The feature you'd like
- Use case / why it's useful
- Proposed implementation (optional)

### Pull Requests

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Make your changes
4. Test thoroughly on Home Assistant
5. Commit: `git commit -m 'Add amazing feature'`
6. Push: `git push origin feature/amazing-feature`
7. Open a Pull Request

### Development Guidelines

- Follow existing code style
- Add comments for complex logic
- Update documentation for user-facing changes
- Test on Home Assistant OS before submitting
- Ensure shellcheck passes for bash scripts

---

## 📄 License

This project is licensed under the **MIT License** - see the [LICENSE](LICENSE) file for details.

### What This Means

✅ Commercial use
✅ Modification
✅ Distribution
✅ Private use

❌ Liability
❌ Warranty

---

## 💬 Support

### Getting Help

- **Documentation**: Check [INSTALLATION.md](docs/INSTALLATION.md) and [TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)
- **Issues**: [GitHub Issues](https://github.com/yourusername/smartdns-homeassistant-updater/issues)
- **Discussions**: [GitHub Discussions](https://github.com/yourusername/smartdns-homeassistant-updater/discussions)

### Related Projects

- [Home Assistant](https://www.home-assistant.io/) - Open source home automation
- [SmartDNSProxy](https://www.smartdnsproxy.com/) - Smart DNS service
- [Home Assistant Community](https://community.home-assistant.io/) - Forums and help

### Acknowledgments

- Home Assistant community for inspiration
- SmartDNSProxy for providing the API
- Contributors who help improve this project

---

## 📈 Changelog

See [CHANGELOG.md](docs/CHANGELOG.md) for version history and updates.

---

## ⭐ Star This Project

If this project helps you, please consider giving it a ⭐ on GitHub! It helps others discover it.

---

**Made with ❤️ for the Home Assistant community**

*Have questions? [Open an issue](https://github.com/yourusername/smartdns-homeassistant-updater/issues) and I'll help!*
