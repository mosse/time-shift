# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Planned Features
- Configuration file support for customizable settings
- Automatic log rotation
- Built-in notification system
- API retry mechanism with exponential backoff
- IPv6 support detection and handling
- Web UI for configuration (via Home Assistant panel)
- Statistics tracking (uptime, IP change frequency)
- Multi-provider support (CloudFlare, DuckDNS, etc.)

---

## [1.0.0] - 2024-11-25

### 🎉 Initial Release

First stable release of SmartDNS Home Assistant Updater.

### Added

#### Core Features
- **Automatic IP detection** with multiple fallback services
  - icanhazip.com
  - api.ipify.org
  - ifconfig.me
  - OpenDNS resolver (DNS-based fallback)
- **Smart update logic** - only calls API when IP actually changes
- **File locking mechanism** to prevent concurrent executions
- **Comprehensive error handling** for network failures and timeouts
- **Detailed logging** with timestamps and log levels
- **60-second timeout compliance** for Home Assistant OS
- **Persistent storage** in `/config` directory

#### Security
- **API key protection** - never logged or exposed
- **secrets.yaml integration** for secure key storage
- **Input validation** for API keys and IP addresses
- **Stale lock detection** and automatic recovery

#### Home Assistant Integration
- **Shell command** configuration for easy integration
- **Time-based automations** for periodic IP checking
- **Optional sensors** for tracking IP and status
- **Lovelace dashboard cards** (10+ examples)
- **Startup automation** to update on Home Assistant restart

#### Documentation
- Comprehensive README with quick start guide
- Step-by-step installation guide (3 methods)
- Detailed troubleshooting guide
- Configuration examples for all features
- Security best practices
- Contributing guidelines

#### Examples & Templates
- `configuration.yaml.example` - shell command setup
- `automations.yaml.example` - 5 automation templates
- `secrets.yaml.example` - API key storage template
- `sensors.yaml.example` - 5 sensor configurations
- `smartdns_settings.yaml` - settings reference (future use)
- `dashboard-card.yaml` - 10 Lovelace card examples

#### Developer Tools
- Production-ready bash script (shellcheck compliant)
- MIT License for open-source sharing
- `.gitignore` for security
- Complete repository structure for GitHub

### Technical Specifications
- **Language**: Bash 5.0+
- **Platform**: Home Assistant OS, Green, Supervised, Container
- **Dependencies**: curl (included in HAOS)
- **API**: SmartDNSProxy IP Update API v1
- **Timeout**: 55 seconds (within HAOS 60s limit)
- **Check Interval**: Configurable (default: 5 minutes)

### Compatibility
- ✅ Home Assistant OS 2021.12.0+
- ✅ Home Assistant Green
- ✅ Home Assistant Supervised
- ✅ Home Assistant Container
- ⚠️ Home Assistant Core (requires path adjustments)

---

## Version History

### Version Numbering

This project uses [Semantic Versioning](https://semver.org/):
- **MAJOR** version for incompatible API changes
- **MINOR** version for added functionality (backwards compatible)
- **PATCH** version for backwards compatible bug fixes

### Upgrade Guide

#### From Future Versions
When new versions are released, upgrade instructions will appear here.

---

## Release Notes Template

For future releases, use this template:

```markdown
## [X.Y.Z] - YYYY-MM-DD

### Added
- New features

### Changed
- Changes to existing functionality

### Deprecated
- Features that will be removed in future versions

### Removed
- Features that have been removed

### Fixed
- Bug fixes

### Security
- Security improvements or vulnerability fixes
```

---

## Feedback & Suggestions

Have ideas for future versions?
- [Open a feature request](https://github.com/yourusername/smartdns-homeassistant-updater/issues/new?labels=enhancement)
- [Join discussions](https://github.com/yourusername/smartdns-homeassistant-updater/discussions)

---

## Links

- [GitHub Repository](https://github.com/yourusername/smartdns-homeassistant-updater)
- [Issue Tracker](https://github.com/yourusername/smartdns-homeassistant-updater/issues)
- [Pull Requests](https://github.com/yourusername/smartdns-homeassistant-updater/pulls)

---

**Thank you for using SmartDNS Home Assistant Updater!**

[Unreleased]: https://github.com/yourusername/smartdns-homeassistant-updater/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/yourusername/smartdns-homeassistant-updater/releases/tag/v1.0.0
