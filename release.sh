#!/bin/bash
# 自动打标签并发布脚本

set -e

# 1. 确保在最新的 next 分支
git pull origin next

# 2. 读取 package.json 中的版本号
VERSION=$(node -p "require('./package.json').version")

# 3. 获取 Git 短哈希 (前6位)
GIT_HASH=$(git rev-parse --short=6 HEAD)

# 4. 拼接完整标签名称 (v3.3.5-dev-abc123)
TAG="v${VERSION}-${GIT_HASH}"

echo "🚀 即将创建并推送标签: $TAG"

# 5. 打标签并推送到远程
git tag "$TAG"
git push origin "$TAG"

echo "✅ 标签 $TAG 已成功推送，GitHub Actions 将自动开始构建。"
