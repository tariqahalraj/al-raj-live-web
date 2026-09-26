#!/usr/bin/env bash
set -e

SDK_DIR="/home/imaginer04/Android/Sdk"
mkdir -p "$SDK_DIR/cmdline-tools"
cd "$SDK_DIR/cmdline-tools"

if [ ! -d "latest" ]; then
  if [ ! -f "commandlinetools.zip" ]; then
    echo "Downloading Android Commandline Tools (official Google repository)..."
    curl -fsSL https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip -o commandlinetools.zip
  fi
  echo "Extracting commandline-tools..."
  unzip -q -o commandlinetools.zip
  rm -rf latest
  mv cmdline-tools latest
  rm -f commandlinetools.zip
fi

export ANDROID_HOME="$SDK_DIR"
export PATH="$SDK_DIR/cmdline-tools/latest/bin:$PATH"

echo "Accepting Android SDK licenses..."
yes | sdkmanager --licenses > /dev/null 2>&1 || true

echo "Installing platforms;android-34 and build-tools;34.0.0..."
yes | sdkmanager "platforms;android-34" "build-tools;34.0.0"

echo "Configuring android/local.properties..."
echo "sdk.dir=$SDK_DIR" > "/home/imaginer04/al-Raj Live/al-Raj Live Apps/android/local.properties"

echo "Android SDK setup complete!"
