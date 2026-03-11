#!/bin/bash
set -e

rm -rf dist_capacitor
mkdir -p dist_capacitor

VERSION=$(node -p "require('./package.json').version")
if [ -n "$GIT_HASH" ]; then
    IPA_NAME="Stapxs.QQ.Lite-$VERSION-$GIT_HASH.ipa"
else
    IPA_NAME="Stapxs.QQ.Lite-$VERSION.ipa"
fi
EXPORT_PATH="dist_capacitor/$IPA_NAME"

# 1. 编译并归档项目 (跳过签名)
echo "--- Step 1: Archiving iOS App (Skipping Signing) ---"
xcodebuild clean archive \
    -workspace src/mobile/ios/App/App.xcworkspace \
    -scheme App \
    -archivePath dist_capacitor/App.xcarchive \
    -sdk iphoneos \
    -configuration Release \
    CODE_SIGNING_ALLOWED=NO \
    CODE_SIGNING_REQUIRED=NO \
    CODE_SIGN_IDENTITY="" \
    AD_HOC_CODE_SIGNING_ALLOWED=YES

# 2. 找到生成的 .app 文件夹
# .xcarchive 内部路径通常是 Products/Applications/*.app
APP_PATH=$(find dist_capacitor/App.xcarchive -name "*.app" -type d | head -n 1)

if [ -z "$APP_PATH" ]; then
    echo "Error: Could not find .app in xcarchive."
    exit 1
fi

echo "Found App: $APP_PATH"

# 3. 手动构造 IPA 结构 (Payload 模式)
echo "--- Step 2: Packaging Manual IPA (Payload) ---"
mkdir -p dist_capacitor/Payload
cp -r "$APP_PATH" dist_capacitor/Payload/

# 进入目录进行压缩，避免 zip 中包含冗余路径
cd dist_capacitor
zip -r "App.ipa" Payload/
mv "App.ipa" "$IPA_NAME"
rm -rf Payload

echo "--- iOS Build Finished: $EXPORT_PATH ---"
