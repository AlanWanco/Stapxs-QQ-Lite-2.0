> 改了原版很多bug 你们写新功能不调试的？
---

## 🛠 近期优化与修复记录
- **界面体验优化 (UI/UX)**:
    - **修复了触控设备上无法滑动消息页面的问题**
    - 修复了撤回消息的重新编辑链接不生效、右键菜单在特定情况下的崩溃问题。
    - 优化了合并转发面板的右键菜单、图片预览显示及点击/触控兼容性。
    - 修复了启动延迟、长文本显示及密码 URL 编码错误。
    - 处理了 display: inline-block 把链接强行变成了一个不可分割的块级元素，导致选择文本时很难精确选中的问题
    - 修复右键菜单坐标偏移问题 (改用 fixed 定位)
    - **自定义界面缩放**
    - 修复了图片预览在缩放模式下的滚动条偏移
    - 修复了右键菜单后，在空白处再次右键无法正确触发新菜单的问题 (带自动关闭动画)
    - 自定义CSS无法自动加载的问题
    - 把图片压缩功能改为了WebSocket base64文件传输上限30MB（OnebotV11ws协议传输大于50MB就会崩溃 改为base64后求稳改为30MB）
    - 修改输入框宽度逻辑
    - CI流程优化
      - 优化了 GitHub Actions 的构建性能（增加了 Rust 和 Gradle 缓存）
      - 将 CI 流程中的依赖安装改为 `yarn install --immutable` 以确保一致性
    - **2026-03-11 dev-43130a**
      - 当输入ws地址符合http(s)://x.x.x.x:xxxx时 不会因为忘记加结尾的/而无法连接
      - ~~[iOS]iOS最低版本下调至15.0 好像没效果~~
      - [Electron/tauri]右键图片添加到本地表情文件夹
      - 本地表情栏表情按照修改时间倒序 保证最新表情在最前
      - 新增本地表情栏点击外部空白区域关闭
    - **2026-03-11 dev-9e7de8**
      - 修改QQ表情为本地[安装包也因此膨胀力 悲]
      - 打开本地表情时自动重新加载
      - 在群聊里右键用户可以发起私聊
    - **2026-03-11 dev-f31dca**
      - 修复了 Android 端重连时需要点击两次才能成功的问题
    - **2026-03-11 dev-fix**
      - 修复了 Android 端在缩放模式下键盘弹出导致的布局缩进问题
      - 修复了全平台按下 Tab 键导致界面向上偏移错位的问题（实现了手动焦点管理与禁止原生滚动）
      - 修复了表情块和外部框架没有对齐的问题

## TODO feats
- 使用新版onebot ws流式协议传输文件
- [Electron/tauri/web]剪贴板里有文件时在聊天窗口粘贴文件可以调用onebot ws流式协议传输文件
- [Android]安卓版icon符合Google制定的APK ICON规范
- [Android]自动重连
- [Electron/tauri/web]按shift+↑/↓切换上一条下一条发送消息 只有当前session可用（防止记录文件太长）F5或者重开就用不了了 可以在设置里打开关闭
- [Electron/tauri/web]ctrl+↑/↓切换聊天框

## 已发现的问题
- [低优先级/tauri]字体缩放功能在tauri客户端上好像没起作用
- [低优先级]单条回复有点问题（图片太高？寻求更多错误样本）

---

<p align="center">
  <a href="https://blog.stapxs.cn" target="blank">
    <img src="src/renderer/public/img/icons/icon.svg" alt="Logo" width="156" height="156">
  </a>
  <h2 align="center" style="font-weight: 600">Stapxs QQ Lite</h2>
 <p align="center">
  <img src="README/gitcode.png" width="400">
 </p>
  <p align="center">
    一个兼容 OneBot 的非官方网页 QQ 客户端
    <br />
    <a href="https://stapxs.github.io/Stapxs-QQ-Lite-2.0/" target="blank"><strong>🌎 访问 DEMO</strong></a>&nbsp;&nbsp;|&nbsp;&nbsp;
    <a href="https://github.com/Stapxs/Stapxs-QQ-Lite-2.0/releases" target="blank"><strong>📦️ 下载程序</strong></a>&nbsp;&nbsp;|&nbsp;&nbsp;
    <a href="https://github.com/Stapxs/Stapxs-QQ-Lite-2.0/issues/new?assignees=Stapxs&labels=%3Abug%3A+%E9%94%99%E8%AF%AF&template=----.md&title=%5B%E9%94%99%E8%AF%AF%5D" target="blank"><strong>💬 反馈问题</strong></a>
    <br />
    <br />
    <strong>本网页应用仅供学习交流使用，请勿用于其他用途</strong><br>
    <strong>版权争议请提出 issue 协商</strong>
  </p>
</p>


## 社区版本
以下是一些社区支持的版本，非常推荐大家试用：
- [Stapxs QQ Lite X](https://github.com/Chzxxuanzheng/Stapxs-QQ-Lite-X)：扩展了更多功能的社区版本，支持更多接近原版 QQ 的功能
- [Stapxs QQ Lite Pre Preview](https://github.com/dev-soragoto/Stapxs-QQ-Lite-2.0-pre-release)：Stapxs QQ Lite 的预览版本，跟随 dev 分支更新，可体验最新功能

## ✨ 特性支持

- ✅ 使用 Vue.js 全家桶开发，快乐前后端分离
- 🎨 自适应布局，竖版也能使用
- 🖥️ 支持 PWA（都有 Electron 了（小声））
- 🌚 Light/Dark Mode 自动切换
- 🍱 该有的都有（虽然比不过官方端）
  - 复杂消息显示、转发、回复、撤回
  - 群文件、群公告、群设置（一小部分）、精华消息
  - 图片、收藏表情、文件发送
- 📦️ 支持多种 bot，我就是要用！
- 🔥 水深火热但是更好看的 Electron 客户端
- 🥚 彩蛋！来更多的彩蛋！
- 🛠 更多特性开发中

## ♿️ 快速使用

### > 运行服务

Stapxs QQ Lite 需要一个 QQ Bot 后端提供服务。由于 QQ Bot 的部署较为复杂，请移步 [Bot 适配情况](https://github.com/Stapxs/Stapxs-QQ-Lite-2.0/issues/76) issue 查看目前支持的 Bot 并选择一个查阅其部署文档。

<img alt="image" src="https://github.com/Stapxs/Stapxs-QQ-Lite-2.0/assets/42486439/c92ebf66-e11e-41bd-9faa-7399aac2d1a8">

### > 访问网页

本仓库开启了 GitHub Pages，所有向主分支提交的代码将会自动构建并发布。你可以直接访问 [🌎 这个页面](https://stapxs.github.io/Stapxs-QQ-Lite-2.0) 来使用已构建并部署的在线版本。

### > 安装客户端

除了直接使用本仓库的构建页面，你也可以下载使用 Electron 打包的功能**稍稍**更丰富的客户端版本，访问 [📦️ 这里](https://github.com/Stapxs/Stapxs-QQ-Lite-2.0/releases) 查看版本发布列表。

你也可以使用包管理器来安装，这样可以更方便地更新 Stapxs QQ Lite 而无需每次都从 GitHub 手动下载，访问 [💬 这里](https://github.com/Stapxs/Stapxs-QQ-Lite-2.0/issues/99) 查看目前支持的包管理器。

### > 在 Napcat 中安装
Stapxs QQ Lite 也可以作为 Napcat 的插件运行，点击下面的快速安装按钮在 Napcat 插件商店中安装：

<a href="https://napneko.github.io/napcat-plugin-index?pluginId=napcat-plugin-ssqq" target="_blank">
<img src="https://github.com/NapNeko/napcat-plugin-index/blob/pages/button.png?raw=true" alt="Logo" width="160">
</a>

### > 自行部署网页

Stapxs QQ Lite 在版本发布时会构建 Web 文件，你可以在 [📦️ 这里](https://github.com/Stapxs/Stapxs-QQ-Lite-2.0/releases) 找到它，通常命名为 `Stapxs.QQ.Lite-<版本>-web.zip`，下载后解压并放置到你的网页服务器中即可。

不会部署网页服务器？Stapxs QQ Lite 网页版已经发布到了 [npm](https://www.npmjs.com/package/ssqq-web)！你可以使用 npx 工具快速启动：

``` bash
npx ssqq-web hostname=127.0.0.1 port=8081
```

### > 使用 Docker 部署网页

Stapxs QQ Lite 已经原生支持了 Docker 部署，使用命令
``` bash
docker pull ghcr.io/stapxs/stapxs-qq-lite-2.0:latest
```
来拉取最新的镜像，如果您无法使用或者GHCR速度很慢，可以使用命令
``` bash
docker pull ghcr.nju.edu.cn/stapxs/stapxs-qq-lite-2.0:latest
```
来从镜像站拉取镜像，使用时请将容器内的```8080```端口对外开放，```80```端口可以忽略。
## 💬 提醒和问题
以下是关于使用 QQ Bot 和第三方客户端的常见疑问，你也可以查看 [常见问题](https://github.com/Stapxs/Stapxs-QQ-Lite-2.0/issues/117) issue 获取更多使用和部署相关的问题解答。

### > 我能使用其他 QQ HTTP Bot 吗

- 如果它兼容 [OneBot 11 协议](https://github.com/botuniverse/onebot-11)，你可以尝试连接，但由于消息体格式和接口扩展的差异，大部分情况下可能无法完全正常使用。
  已兼容的 Bot 列表可以在 [这里](https://github.com/Stapxs/Stapxs-QQ-Lite-2.0/wiki) 查看。

### > 使用 Bot 是否有风险

- 使用 QQ Bot 服务可能存在一定风险，此风险并非由 Stapxs QQ Lite 造成，而是使用 QQ Bot 服务本身的风险。请自行查阅你所使用的 QQ Bot 相关文档以了解风险信息。

### > 我遇到了问题

- 如果遇到任何问题，欢迎发起 [issue](https://github.com/Stapxs/Stapxs-QQ-Lite-2.0/issues) 询问！发现 BUG 或有优化建议也欢迎反馈。

## 📦️ 构建应用

为了规范对其他仓库的引用，Stapxs QQ Lite 仓库包含一些 Git 子模块，这意味着你需要在克隆仓库时包含子模块：

``` bash
git clone https://github.com/Stapxs/Stapxs-QQ-Lite-2.0.git --recursive
```

如果你已经克隆了仓库，可以使用以下命令补全子模块：

``` bash
git submodule update --init
```

在开始构建之前，请先安装依赖。请确保已安装 `yarn`：

``` bash
# 安装依赖
yarn install
```

> [!TIP]
> **依赖维护建议**：由于项目使用 Yarn 4 (Berry)，在删除或更换依赖库后，建议按照以下步骤操作以确保 `yarn.lock` 的整洁：
> 1. `yarn dedupe`（清理冗余依赖版本）
> 2. `yarn install`（更新锁定文件）
> 3. `git add yarn.lock`（提交更新）

另外，Stapxs QQ Lite 使用了高德地图 API 来显示位置共享地图。`.env` 文件中提供了一个默认的高德地图 API Key，如果你打算自行部署，建议在 [这里](https://lbs.amap.com/dev/key/app) 申请属于你自己的 API Key 并替换默认值。

我们强烈建议使用自己的 API Key，因为默认 Key 有使用次数限制。

### > 构建 Web 页面

Stapxs QQ Lite 是一个基于 Vue 的单页应用，如果你想自行部署到网页服务器需要进行构建。你也可以直接前往 [这里](https://github.com/Stapxs/Stapxs-QQ-Lite-2.0/releases) 下载预构建好的文件包。

以下是构建该项目的命令，构建结果将输出在 `dist` 目录下：

``` bash
# 运行本地调试
yarn dev

# 代码检查和自动格式化
yarn lint

# 构建应用
yarn build
```

#### SSE 模式
Stapxs QQ Lite 支持 SSE 模式。在此模式下，应用将以 HTTP SSE + HTTP API 的方式连接到 QQ Bot 后端，提供更快速和轻量化的连接；甚至可以直接禁用 SSE 通知推送，仅使用 HTTP API 进行通信。

SSE 模式不支持动态切换，需要在构建前修改 `.env` 环境变量中 `VITE_APP_SSE` 开头的配置项来启用。启用 SSE 模式后，页面将无法使用其他连接模式。

~~~ ini
VITE_APP_SSE_MODE=true
VITE_APP_SSE_SUPPORT=true
VITE_APP_SSE_EVENT_ADDRESS=api/_events
VITE_APP_SSE_HTTP_ADDRESS=api
~~~
`SSE_MODE` 指定了 SSE 模式的主开关；

`SSE_SUPPORT` 指定了是否支持 SSE 事件推送。设为 false 时将仅使用 HTTP API 进行通信，这将无法接收 QQ Bot 的主动推送消息，导致以下功能缺失：
- 无法接收新消息推送、通知推送
- 聊天面板新消息不会自动更新，但仍可通过重新加载面板来获取新消息

剩余两项指定了 SSE 模式的地址，可根据需求修改。

### > 构建 Electron 客户端

自 `2.3.0` 版本起，Stapxs QQ Lite 支持构建为 Electron 应用并提供部分平台特性功能，你也可以自行构建。

> 如果 Electron CLI 无法找到 Python，可以将 `PYTHON_PATH` 导出到环境变量中，指向 Python 可执行文件路径。

以下是构建 Electron 应用的命令，构建结果将输出在 `dist_electron/out` 目录下：

``` bash
# Electron 运行本地调试
yarn dev:electron

# Electron 构建应用
yarn build:electron
```

### > 构建 Tauri 应用

自 `3.2.0` 版本起，Stapxs QQ Lite 支持构建为 Tauri 应用并提供部分平台特性功能，你也可以自行构建。

以下是构建 Tauri 应用的命令，构建结果将输出在 `src/tauri/target/release/bundle` 目录下：

``` bash
# Tauri 运行本地调试
yarn dev:tauri

# Tauri 构建应用
yarn build:tauri

# Tauri 构建指定架构
yarn build:tauri -t x86_64-apple-darwin -b dmg

# 查看支持的架构
rustup target list
```

注意：Tauri 不支持跨平台构建，需要在对应平台上进行构建。

### > 构建 Capacitor 应用
自 `3.0.0` 版本起，Stapxs QQ Lite 支持通过 Capacitor 构建为移动端应用并提供部分平台特性功能，你也可以自行构建。

#### Android
> 如果 Capacitor CLI 无法找到 Android Studio 和 Android SDK，可以将 `CAPACITOR_ANDROID_STUDIO_PATH` 和 `ANDROID_HOME` 导出到环境变量中，它们分别指向 Android Studio 可执行文件路径和 Android SDK 路径。

你可以使用 `yarn open:android` 打开 Android Studio，通过 Build -> Generate Signed Bundle or APK 来构建 APK 文件。

你也可以直接使用 `yarn build:android` 构建 APK 文件。请检查并修改 `capacitor.config.ts` 文件中 `android.buildOptions` 的 keyStore 配置。

构建结果将输出在 `src/mobile/android/app/build/outputs/apk/release` 目录下。

#### iOS
你可以使用 `yarn open:ios` 打开 Xcode，通过 Product -> Archive 来构建 IPA 文件。

你也可以直接使用 `yarn build:ios` 构建 IPA 文件。此构建方式将执行 `scripts/build-export-ipa.sh` 脚本，构建将使用钥匙串中的默认开发者证书，请确保已配置开发者证书。

Xcode 的构建结果将输出在 `src/mobile/ios/build` 目录下，脚本构建结果将输出在 `dist_capacitor` 目录下。

### > 命令列表
以下是本项目的完整命令列表，你可以使用这些命令来快速构建和调试 Stapxs QQ Lite。

**命令格式为 `yarn <命令>`，其中 `<命令>` 为列表中的一个：**

| 命令           | 描述                |
| -------------- | ------------------ |
| install        | 安装依赖            |
| lint           | 代码检查和自动格式化  |
| update:icon    | 更新移动端应用图标集  |
| update:version | 更新移动端应用版本号  |
| dev            | 网页调试            |
| dev:electron   | Electron 调试      |
| dev:tauri      | Tauri 调试          |
| dev:ios        | iOS 调试           |
| dev:android    | Android 调试        |
| open:ios       | 在 Xcode 中打开项目  |
| open:android   | 在 Android Studio 中打开项目  |
| build          | 网页构建            |
| build:electron | 构建当前平台的 Electron 应用    |
| build:tauri    | 构建 Tauri 应用     |
| build:ios      | 构建 iOS 应用       |
| build:android  | 构建 Android 应用   |

## 📜 额外依赖声明
Stapxs QQ Lite 的 Tauri 版本使用了来自 [DeltaChat](https://github.com/deltachat/deltachat-desktop) 项目的 user-notify 代码，用于提供跨平台系统通知功能。由于这部分代码没有独立发布，我们将其源码复制到了 `src/tauri/crates/user-notify` 目录下。此部分代码已通过 .gitattributes 文件排除在语言统计之外。

## 🎉 鸣谢

感谢以下小伙伴在开发和文档中提供的支持 ——

<a href="https://github.com/Logic-Accepted"><img src="https://avatars.githubusercontent.com/u/36406453?s=48&v=4"></a>
<a href="https://github.com/doodlehuang"><img src="https://avatars.githubusercontent.com/u/25525621?s=48&v=4"></a>
