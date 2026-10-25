# Installation Guide

This guide covers all available methods to install and run **anycode** across different operating systems.

---

## Desktop Application

Download the prebuilt native installer for your operating system from [GitHub Releases](https://github.com/anycode-ade/anycode/releases).

### 🍏 macOS

1. Download the `.dmg` matching your Mac architecture:
   - **Apple Silicon** (M-series / ARM64): `anycode-desktop-macos-arm64.dmg`
   - **Intel**: `anycode-desktop-macos-x64.dmg`
2. Open the `.dmg` and drag `anycode.app` to your **Applications** folder.
3. **First launch (Gatekeeper approval):**  
   Because community builds are not notarized through Apple's paid program, macOS may show a *"cannot be opened because the developer cannot be verified"* warning.
   - **Quick fix via Terminal:**
     ```bash
     xattr -cr /Applications/anycode.app
     ```
   - **Or via Finder:** Right-click (or Control-click) `anycode.app` in `/Applications`, click **Open**, then click **Open** in the confirmation prompt.

---

### 🪟 Windows (10 / 11)

1. Download `anycode-desktop-windows-x64-setup.exe`.
2. Double-click the installer and follow the setup wizard.
3. **Microsoft Defender SmartScreen prompt:**  
   Windows Defender may show a blue prompt stating *"Windows protected your PC"*.
   - Click **More info** (*Подробнее*).
   - Click **Run anyway** (*Выполнить в любом случае*).
   *(Anycode utilizes Microsoft Edge WebView2, which is already built into modern Windows 10/11).*

---

### 🐧 Linux

#### Option 1: Debian / Ubuntu / Mint / Pop!_OS (`.deb`)

1. Download `anycode-desktop-linux-amd64.deb`.
2. Install via terminal:
   ```bash
   sudo dpkg -i anycode-desktop-linux-amd64.deb
   sudo apt-get install -f # ensures system webkit2gtk dependency is satisfied
   ```
   Or double-click the `.deb` file in your desktop file manager to install through the Software Center.

#### Option 2: Arch / Fedora / Generic Linux (`.tar.gz`)

1. Download `anycode-desktop-linux-x86_64.tar.gz`.
2. Extract and run anywhere:
   ```bash
   tar -xzf anycode-desktop-linux-x86_64.tar.gz
   ./anycode-desktop
   ```
3. **Requirement:** Ensure WebKitGTK is installed on your distribution:
   - **Arch / Manjaro:** `sudo pacman -S webkit2gtk-4.1`
   - **Fedora / RHEL:** `sudo dnf install webkit2gtk4.1`

---

## CLI & Server

Run anycode as a lightweight local or remote web server.

### macOS & Linux (One-shot script)

```bash
curl -fsSL https://raw.githubusercontent.com/anycode-ade/anycode/main/install.sh | sh
```

### Windows (PowerShell x64)

```powershell
irm https://raw.githubusercontent.com/anycode-ade/anycode/main/install.ps1 | iex
```

#### Windows installer details:
- Installs `anycode.exe` into `%USERPROFILE%\AppData\Local\anycode\bin` by default.
- Automatically adds that directory to user `PATH`.
- Supports overrides via environment variables:
  - `ANYCODE_VERSION`: specific version tag (e.g. `v0.1.0`)
  - `ANYCODE_INSTALL_DIR`: custom installation directory
  - `ANYCODE_REPO`: custom repository mirror
- Current release installer targets Windows x64; Windows ARM64 can build from source.
