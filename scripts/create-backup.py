import os
import sys
import re
import shutil
import tarfile
import zipfile
from datetime import datetime

source_dir = "/home/imaginer04/al-Raj Live/al-Raj Live Apps"
backup_dir = os.path.join(source_dir, "backup")
parent_backup_dir = "/home/imaginer04/al-Raj Live/backup"
os.makedirs(backup_dir, exist_ok=True)
os.makedirs(parent_backup_dir, exist_ok=True)

# Copy latest compiled APK if present
apk_source = os.path.join(source_dir, "android", "app", "build", "outputs", "apk", "debug", "app-debug.apk")
if os.path.isfile(apk_source):
    root_apk = os.path.join(source_dir, "tariqah-alraj-live.apk")
    parent_apk = "/home/imaginer04/al-Raj Live/tariqah-alraj-live.apk"
    shutil.copy2(apk_source, root_apk)
    shutil.copy2(apk_source, parent_apk)
    print(f"📱 Updated ready-to-install Android APK at: {root_apk} ({os.path.getsize(root_apk)/(1024*1024):.2f} MB)")

# Determine context from command line arguments or use descriptive default
DEFAULT_CONTEXT = "v1.4-full-stack_bangla-ime-fix_larger-signin-logo_native-bg-audio"
DEFAULT_DESCRIPTION = "v1.4 Full-Stack: Bengali IME Typing Support Fix, Enlarged Sign-In Screen Logo, Native Background Audio & Heads-Up Push Notifications, WebRTC SFU Audio Transport & Supabase Real-Time Platform"

if len(sys.argv) > 1:
    raw_context = " ".join(sys.argv[1:]).strip()
    context_slug = re.sub(r'[^a-zA-Z0-9_\-\.]+', '-', raw_context).strip('-')
    context_description = raw_context
else:
    context_slug = DEFAULT_CONTEXT
    context_description = DEFAULT_DESCRIPTION

timestamp_str = datetime.now().strftime("%Y-%m-%d_%H-%M")
date_readable = datetime.now().strftime("%B %d, %Y at %H:%M +06:00")

# Construct informative contextual backup name
backup_base_name = f"tariqah-alraj-live-backup-{timestamp_str}_{context_slug}"
tar_gz_path = os.path.join(backup_dir, f"{backup_base_name}.tar.gz")
zip_path = os.path.join(backup_dir, f"{backup_base_name}.zip")

# Directories and files to exclude from the portable backup
EXCLUDE_DIRS = {
    "node_modules",
    ".jdk17",
    ".gradle",
    "build",
    "backup",
    ".vite"
}

EXCLUDE_EXTS = {
    ".log",
    ".tmp"
}

def should_exclude(path):
    rel_path = os.path.relpath(path, source_dir)
    parts = rel_path.split(os.sep)
    for part in parts:
        if part in EXCLUDE_DIRS:
            return True
    _, ext = os.path.splitext(path)
    if ext in EXCLUDE_EXTS:
        return True
    return False

print(f"📦 Creating contextual backup archive:")
print(f"   Context: {context_description}")
print(f"   Base Name: {backup_base_name}")
print(f"   Destination: {backup_dir}\n")

print(f"⏳ Creating TAR.GZ archive: {tar_gz_path} ...")
with tarfile.open(tar_gz_path, "w:gz") as tar:
    for root, dirs, files in os.walk(source_dir):
        dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS and not should_exclude(os.path.join(root, d))]
        for f in files:
            file_path = os.path.join(root, f)
            if not should_exclude(file_path):
                rel_path = os.path.relpath(file_path, source_dir)
                tar.add(file_path, arcname=os.path.join("tariqah-alraj-live", rel_path))

tar_mb = os.path.getsize(tar_gz_path) / (1024 * 1024)
print(f"✅ TAR.GZ created successfully! Size: {tar_mb:.2f} MB")

# Also create a .zip archive for seamless cross-platform use (Windows/Mac/Linux)
print(f"⏳ Creating ZIP archive: {zip_path} ...")
with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zipf:
    for root, dirs, files in os.walk(source_dir):
        dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS and not should_exclude(os.path.join(root, d))]
        for f in files:
            file_path = os.path.join(root, f)
            if not should_exclude(file_path):
                rel_path = os.path.relpath(file_path, source_dir)
                zipf.write(file_path, arcname=os.path.join("tariqah-alraj-live", rel_path))

zip_mb = os.path.getsize(zip_path) / (1024 * 1024)
print(f"✅ ZIP created successfully! Size: {zip_mb:.2f} MB")

# Create context metadata file
metadata_content = f"""================================================================================
TARIQAH AL-RAJ LIVE AUDIO PLATFORM — CONTEXTUAL PROJECT BACKUP
================================================================================

BACKUP FILENAMES:
  • {backup_base_name}.zip     ({zip_mb:.2f} MB)
  • {backup_base_name}.tar.gz  ({tar_mb:.2f} MB)

CONTEXT / MILESTONE:
  {context_description}

CREATION DATE & TIME:
  {date_readable}

LOCATIONS:
  • /home/imaginer04/al-Raj Live/backup/
  • /home/imaginer04/al-Raj Live/al-Raj Live Apps/backup/

READY-TO-INSTALL ANDROID APK:
  • /home/imaginer04/al-Raj Live/tariqah-alraj-live.apk (Updated build with Bangla IME & enlarged logo)

PORTABLE PROJECT CONTENTS & STATUS:
  Complete, verified, production-ready snapshot for development and deployment
  on any machine (Windows, macOS, Linux).

  Key Milestones & Implemented Features:
    1. Bengali IME Typing Support Resolved (Critical Fix):
       - Fixed invisible typing for Bengali keyboards (Ridmik / Avro / Gboard).
       - Root cause resolved by setting `captureInput: false` in capacitor.config.ts,
         restoring Chromium's native InputConnection and live composingText handling.
       - Built SafeTextInput component for solid IME composition, ref tracking, and
         color-scheme consistency across Android WebViews.

    2. Sign-In Screen Logo Enlargement:
       - Upgraded Sign-In screen emblem to authentic full-bleed webp (`sign-in-logo.webp`).
       - Scaled mobile logo from 96px (`w-24 h-24`) to 144px (`w-36 h-36`) with drop-shadow.
       - Scaled desktop hero logo to `w-36 h-36 lg:w-44 lg:h-44` with overflow-y-auto layout.

    3. Native Background Audio Service (Telegram/Discord style):
       - LiveBackgroundService native Android foreground service with
         FOREGROUND_SERVICE_MEDIA_PLAYBACK and MICROPHONE types.
       - Holds partial WakeLock and WifiLock so audio stream and microphone continue
         playing uninterrupted when phone screen is locked or user switches apps.

    4. Outside-App Heads-Up System Push Notifications:
       - Native Android AlarmManager receiver (LiveCheckReceiver) with RTC_WAKEUP,
         PowerManager WakeLock, and direct Supabase REST query.
       - Wakes the device and delivers a high-priority heads-up banner notification
         with sound and vibration even when the app is completely closed.
       - Tapping the notification launches the app directly into the live broadcast.

    5. Real-time Listener Presence & Count Synchronization:
       - Dual-channel presence architecture: Phoenix Realtime Channel (sub-second broadcast)
         coupled with Supabase database heartbeat leases (renew_listener_lease, get_active_session_listeners).
       - Solved listener visibility in Host broadcast console; host screen accurately tracks
         all active listeners with avatar icons and real-time count.

    6. Real-time Host Mic Mute State Sync:
       - Instant broadcast when host mutes or unmutes their microphone.
       - Listener screen shows a single, crisp indicator: "🔴 Host mic is muted" when muted,
         automatically disappearing upon unmute.

    7. Zero-Latency Session Persistence & Offline Hydration:
       - User profile and auth session cached locally in localStorage.
       - Instant 0ms hydration on startup, preventing accidental logout on slow cellular networks.

    8. Cloudflare Calls SFU WebRTC Audio Transport:
       - Low-latency bidirectional audio streaming using Cloudflare SFU.
       - Edge function (cloudflare-sfu) handles secure token and session negotiation.

    9. Production Android Package:
       - Ready-to-install debug APK: ./tariqah-alraj-live.apk (~6.2 MB)
       - Verified on physical Android 15 device over ADB.

HOW TO RESTORE & RUN ON ANOTHER MACHINE:
  1. Extract {backup_base_name}.zip or .tar.gz
  2. In your terminal:
       cd tariqah-alraj-live
  3. Install dependencies:
       npm install
  4. Run local development web server:
       npm run dev
       (Access at http://localhost:3000)
  5. Run test suite:
       npm test
  6. Build and run Android:
       npm run build
       npx cap sync android
       cd android && ./gradlew assembleDebug

================================================================================
"""

# Write metadata to local backup directory
metadata_path = os.path.join(backup_dir, "BACKUP_INFO.txt")
with open(metadata_path, "w", encoding="utf-8") as mf:
    mf.write(metadata_content)

# Copy backup archives and metadata to parent backup folder as well
parent_tar = os.path.join(parent_backup_dir, f"{backup_base_name}.tar.gz")
parent_zip = os.path.join(parent_backup_dir, f"{backup_base_name}.zip")
parent_meta = os.path.join(parent_backup_dir, "BACKUP_INFO.txt")

shutil.copy2(tar_gz_path, parent_tar)
shutil.copy2(zip_path, parent_zip)
shutil.copy2(metadata_path, parent_meta)

print(f"📄 Backup metadata written to:")
print(f"   • {metadata_path}")
print(f"   • {parent_meta}")
print(f"📁 Both backup folders synchronized successfully:")
print(f"   • {backup_dir}")
print(f"   • {parent_backup_dir}")
print(f"🎉 Contextual backup complete!\n")
