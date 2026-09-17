/*
 * @FileDescription: 消息处理模块
 * @Author: Stapxs
 * @Date:
 *      2022/11/1
 *      2022/12/7
 *      2024/9/2
 * @Version:
 *      1.0 - 初始版本
 *      2.0 - 重构为 ts 版本，修改 Vue3 相关变更
 *      3.0 - 优化更优雅的代码结构
 * @Description: 此模块用于拆分和保存/处理 bot 返回的各类信息，整个运行时数据也保存在这儿。
 */
import qed from '@renderer/assets/qed.txt?raw'

import app from '@renderer/main'
import Option from './option'

import Umami from '@stapxs/umami-logger-typescript'

import {
    buildMsgList,
    getMsgData,
    parseMsgList,
    getMsgRawTxt,
    updateLastestHistory,
    sendMsgAppendInfo,
} from '@renderer/function/utils/msgUtil'
import {
    delay,
    getInch,
    getViewTime,
    randomNum,
} from '@renderer/function/utils/systemUtil'
import {
    reloadUsers,
    reloadCookies,
    updateMenu,
    loadJsonMap,
    sendIdentifyData,
    sendStatEvent,
} from '@renderer/function/utils/appUtil'
import { reactive, markRaw, defineAsyncComponent } from 'vue'
import { PopInfo, PopType, Logger, LogType } from './base'
import { Connector, login } from './connect'
import {
    GroupFileElem,
    GroupFileFolderElem,
    GroupMemberInfoElem,
    UserFriendElem,
    UserGroupElem,
    MsgItemElem,
    RunTimeDataElem,
    BotMsgType,
} from './elements/information'
import { NotifyInfo } from './elements/system'
import { Notify } from './notify'
import { backend } from '@renderer/runtime/backend'
import { addDownloadTask } from '@renderer/components/FileManager.vue'
import { dbRevokeMessage, saveMessagesWithSideEffects } from './utils/localHistoryUtil'
import { refreshFavicon } from './favicon'
import { Img } from './model/img'
import { getPinyin } from './utils/pinyin'

const popInfo = new PopInfo()
// eslint-disable-next-line
const msgPaths = import.meta.glob("@renderer/assets/pathMap/*.yaml", { eager: true })
// 取出包含 Lagrange.OneBot.yaml 的那条
const msgPathAt = Object.keys(msgPaths).find((item) => {
    return item.indexOf('Lagrange.OneBot.yaml') > 0
})
let msgPath = {} as { [key: string]: any }
if (msgPathAt != undefined) {
    msgPath = (msgPaths[msgPathAt] as any).default
}
// 其他 tag
let listLoadTimes = 0
const logger = new Logger()
let firstHeartbeatTime = -1
let heartbeatTime = -1

function isFailedResponse(msg: any): boolean {
    if (!msg || typeof msg !== 'object') return true
    if (msg.status === 'failed') return true
    return msg.retcode !== undefined && Number(msg.retcode) !== 0
}

function isCurrentHistoryResponse(echoList?: string[]): boolean {
    const token = echoList?.[1]
    return !token || token === runtimeData.tags.historyLoadToken
}

export function dispatch(raw: string | { [k: string]: any }, echo?: string) {
    let msg: any

    // 1) 如有需要先 parse
    if (typeof raw === 'string') {
        try {
            msg = JSON.parse(raw)
        } catch {
            if (!raw.includes('"meta_event_type":"heartbeat"')) {
                logger.add(LogType.WS, 'GET：消息不是有效 JSON')
            }
            return
        }
    } else {
        msg = raw
    }
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return

    // 2) 决定 name/key。OneBot 的 notice_type 才是事件主类型，只有
    // notify 需要再使用 sub_type（例如 poke）；否则 group_msg_emoji_like
    // 会被错误路由成 add/remove。
    const echoName = typeof echo === 'string' && echo !== ''
        ? echo.split('_')[0]
        : undefined
    let name = echoName ?? (
        msg.post_type === 'notice'
            ? msg.notice_type === 'notify' ? msg.sub_type ?? msg.notice_type : msg.notice_type
            : msg.post_type
    )

    // 3) 安全调用 handler
    try {
        let fn = typeof name === 'string' ? handlers[name] : undefined
        // 兼容旧版 OneBot：group_decrease/group_increase 等事件的具体动作
        // 可能只注册在 sub_type（kick/approve）上；只有主类型没有 handler
        // 时才回退，避免 group_msg_emoji_like 被误路由成 add/remove。
        if (!fn && !echoName && msg.post_type === 'notice' && typeof msg.sub_type === 'string') {
            name = msg.sub_type
            fn = handlers[name]
        }
        if (!fn) throw new Error(`No handler for "${name ?? 'undefined'}"`)
        const metaArgs = echoName ? echo!.split('_') : undefined
        fn(msg, metaArgs)
    } catch (e) {
        // 不把事件原文写入错误日志，避免联系人、Cookie 等字段被带出。
        logger.error(e as Error, `事件处理失败 - ${name ?? 'undefined'}`)
    }
}

// ==============================================================
const noticeFunctions = {
    /**
     * 心跳包
     */
    meta_event: (_: string, msg: { [key: string]: any }) => {
        if (firstHeartbeatTime == -1) {
            firstHeartbeatTime = 0
            runtimeData.watch.heartbeatTime = 0
            return
        }
        if (firstHeartbeatTime == 0) {
            firstHeartbeatTime = msg.time
            runtimeData.watch.lastHeartbeatTime = msg.time
            return
        }
        if (firstHeartbeatTime != -1 && heartbeatTime == -1) {
            // 计算心跳时间
            heartbeatTime = msg.time - firstHeartbeatTime
        }
        // 记录心跳状态
        if (heartbeatTime != -1) {
            runtimeData.watch.heartbeatTime = heartbeatTime
            runtimeData.watch.oldHeartbeatTime =
                runtimeData.watch.lastHeartbeatTime
            runtimeData.watch.lastHeartbeatTime = msg.time
        }
    },

    /**
     * 新消息
     */
    message_sent: newMsg,
    message: newMsg,

    /**
     * 请求
     */
    request: (_: string, msg: { [key: string]: any }) => {
        if (runtimeData.systemNoticesList) {
            runtimeData.systemNoticesList.push(msg)
        } else {
            runtimeData.systemNoticesList = [msg]
        }
    },

    /**
     * 好友变动
     */
    friend: (_: string, msg: { [key: string]: any }) => {
        // 重新加载联系人列表
        reloadUsers()
        switch (msg.sub_type) {
            case 'increase': {
                // 添加系统通知
                new PopInfo().add(
                    PopType.INFO,
                    app.config.globalProperties.$t('添加好友 {name} 成功！', {
                        name: msg.nickname,
                    }),
                )
                break
            }
            case 'decrease': {
                logger.debug('好友列表发生减少')
                break
            }
        }
    },

    /**
     * 消息撤回
     */
    group_recall: revokeMsg,
    friend_recall: revokeMsg,
    recall: revokeMsg,

    /**
     * 表情回应
     */
    group_msg_emoji_like: (_: string, msg: { [key: string]: any }) => {
        const msgId = msg.message_id
        const isAdd = msg.is_add
        const emojiList = Array.isArray(msg.likes) ? msg.likes : []
        // 推送事件里发回应的人，NapCat 用 operator_id，部分框架用 user_id
        const operatorId = msg.operator_id ?? msg.user_id
        const isMe = operatorId !== undefined && Number(operatorId) === Number(runtimeData.loginInfo.uin)
        // 寻找消息
        runtimeData.messageList.forEach((item, index) => {
            if (String(item.message_id) === String(msgId)) {
                if (!Array.isArray(runtimeData.messageList[index].emoji_like)) {
                    runtimeData.messageList[index].emoji_like = []
                }

                emojiList.forEach((like: any) => {
                    const id = Number(like?.emoji_id)
                    const count = Number(like?.count)
                    if (!Number.isFinite(id) || !Number.isFinite(count) || count <= 0) return

                    let hasAdd = false
                    runtimeData.messageList[index].emoji_like.forEach((existLike: any) => {
                        if (existLike.emoji_id == id) {
                            if (isAdd) {
                                existLike.count += count
                                if (isMe) existLike.liked = true
                            } else {
                                existLike.count -= count
                                if (isMe) existLike.liked = false
                            }
                            hasAdd = true
                        }
                    })
                    
                    if (!hasAdd && isAdd) {
                        runtimeData.messageList[index].emoji_like.push({
                            emoji_id: id,
                            count: count,
                            liked: isMe,
                        })
                    }
                })

                // 清理数量 <= 0 的表情
                runtimeData.messageList[index].emoji_like = runtimeData.messageList[index].emoji_like.filter(
                    (item: any) => item.count > 0
                )
                
                if (runtimeData.messageList[index].emoji_like.length === 0) {
                    delete runtimeData.messageList[index].emoji_like
                }
                
                // 将被回应者的 user_id 附加到 notice 消息上，以便渲染时区分
                if (runtimeData.messageList[index].sender) {
                    msg.target_user_id = runtimeData.messageList[index].sender.user_id
                }
            }
        })

        // 仅在当前群聊显示，且只处理新增操作
        if (String(msg.group_id ?? '') === String(runtimeData.chatInfo.show.id ?? '') && isAdd) {
            runtimeData.messageList.push(msg)
        }
    },

    /**
     * 群禁言
     */
    group_ban: (_: string, msg: { [key: string]: any }) => {
        const groupId = msg.group_id
        const userId = msg.user_id
        const status = msg.sub_type === 'ban' ? true : false
        const duration = msg.duration ?? 0 // 秒

        // 如果是自己，更新禁言时间
        if (
            userId == runtimeData.loginInfo.uin &&
            groupId == runtimeData.chatInfo.show.id &&
            runtimeData.chatInfo.info.me_info
        ) {
            if (status)
                runtimeData.chatInfo.info.me_info.shut_up_timestamp =
                    (new Date().getTime() + duration * 1000) / 1000
            else runtimeData.chatInfo.info.me_info.shut_up_timestamp = 0
        }

        // 只有在当前群才会显示
        if (groupId == runtimeData.chatInfo.show.id)
            runtimeData.messageList.push(msg)
    },

    /**
     * 踢人
     */
    kick: (_: string, msg: { [key: string]: any }) => {
        const groupId = msg.group_id
        if (groupId == runtimeData.chatInfo.show.id) {
            // 稍微等一下再刷新成员列表
            delay(1000).then(() => {
                Connector.send(
                    'get_group_member_list',
                    { group_id: runtimeData.chatInfo.show.id, no_cache: true },
                    'getGroupMemberList',
                )
                return delay(1000)
            }).then(() => {
                Connector.send(
                    'get_group_member_list',
                    { group_id: runtimeData.chatInfo.show.id, no_cache: true },
                    'getGroupMemberList',
                )
            })
        }
    },

    /**
     * 戳一戳
     */
    poke: (_: string, msg: { [key: string]: any }) => {
        const { $t } = app.config.globalProperties

        const groupId = msg.group_id
        const userIds = [msg.user_id, msg.target_id]
        const info = Array.isArray(msg.raw_info) ? msg.raw_info : []

        // 如果的当前打开的会话
        if (groupId == runtimeData.chatInfo.show.id) {
            let str = ''
            const userInfo = [] as { txt: string; isMe: boolean }[]
            const groupMembers = Array.isArray(runtimeData.chatInfo.info.group_members)
                ? runtimeData.chatInfo.info.group_members
                : []
            // 用户列表
            userIds.forEach((id) => {
                if (id == runtimeData.loginInfo.uin) {
                    userInfo.push({
                        txt: $t('你'),
                        isMe: true,
                    })
                } else {
                    // 到群成员列表中去找这个人
                    const user = groupMembers.find(
                        (item) => {
                            return item.user_id == id
                        },
                    )
                    if (user)
                        userInfo.push({
                            txt: `<span>${user.nickname}</span>`,
                            isMe: false,
                        })
                }
            })
            // 遍历内容段
            let getQQTimes = 0
            info.forEach((item: any) => {
                switch (item.type) {
                    case 'img':
                        if (typeof item.src === 'string') str += `<img src="${backend.proxyUrl(item.src)}"/>`
                        break
                    case 'nor':
                        str += String(item.txt ?? '')
                        break
                    case 'qq': {
                        str += userInfo[getQQTimes]?.txt ?? ''
                        getQQTimes++
                    }
                }
            })
            // 插入系统消息
            msg.str = str
            msg.pokeMe = userInfo[1]?.isMe === true
            runtimeData.messageList.push(msg)
        }
    },

    approve: (_: string, msg: { [key: string]: any }) => {
        const { $t } = app.config.globalProperties

        const groupId = msg.group_id
        const userId = msg.user_id

        // 如果的当前打开的会话
        if (groupId == runtimeData.chatInfo.show.id) {
            // 刷新群成员列表
            Connector.send(
                'get_group_member_list',
                { group_id: groupId, no_cache: true },
                'getGroupMemberList',
            )
            // 获取到用户信息
            const groupMembers = Array.isArray(runtimeData.chatInfo.info.group_members)
                ? runtimeData.chatInfo.info.group_members
                : []
            const user = groupMembers.find(
                (item) => {
                    return item.user_id == userId
                },
            )
            // 插入入群通知
            if (user) {
                const str = $t('{name} 加入了群聊', {
                    name: user.nickname,
                })
                msg.str = str
                runtimeData.messageList.push(msg)
            }
        }
    },

    input_status: (_: string, msg: { [key: string]: any }) => {
        const { $t } = app.config.globalProperties
        const sender = msg.user_id
        if (runtimeData.chatInfo.show.id == sender) {
            runtimeData.chatInfo.show.appendInfo = $t('对方正在输入……')
            setTimeout(() => {
                runtimeData.chatInfo.show.appendInfo = undefined
            }, 10000)
        }
    },
} as { [key: string]: (name: string, msg: { [key: string]: any }) => void }

const msgFunctions = {
    /**
     * 修改群成员信息回调
     */
    updateGroupMemberInfo: () => {
        const { $t } = app.config.globalProperties
        const popInfo = {
            title: $t('操作'),
            html: `<span>${$t('正在确认操作……')}</span>`
        }
        runtimeData.popBoxList.push(popInfo)
        // 稍微等一下再刷新成员列表
        delay(1000).then(() => {
            Connector.send(
                'get_group_member_list',
                { group_id: runtimeData.chatInfo.show.id, no_cache: true },
                'getGroupMemberList',
            )
            return delay(1000)
        }).then(() => {
            Connector.send(
                'get_group_member_list',
                { group_id: runtimeData.chatInfo.show.id, no_cache: true },
                'getGroupMemberList',
            )
            runtimeData.popBoxList.shift()
        })
    },

    /**
     * 保存 Bot 信息
     */
    getVersionInfo: (_: string, msg: { [key: string]: any }) => {
        const data = getMsgData('version_info', msg, msgPath.version_info)?.[0]

        if (data) {
            // 如果 runtime 存在（即不是第一次连接），且 app_name 不同，重置 runtime
            resetRimtime(
                runtimeData.botInfo.app_name != data.app_name && !login.status,
            )

            runtimeData.botInfo = data
            if (Option.get('open_ga_bot') !== false) {
                const appVersion = data.app_version ? ',' + data.app_version : ''
                const appInfo = data.app_name ? data.app_name + appVersion : '（未知）'

                sendStatEvent('connect', { method: data.app_name })
                sendIdentifyData({ bot_version: appInfo })
            }
            if (!login.status) {
                // 尝试动态载入对应的 pathMap
                if (data.app_name !== undefined) {
                    const getMap = loadJsonMap(data.app_name)
                    if (getMap != null) msgPath = getMap
                    else runtimeData.jsonMap = msgPath
                }
                // 继续获取后续内容
                Connector.send('get_login_info', {}, 'getLoginInfo')
            }
        }
    },

    /**
     * 保存账号信息
     */
    getLoginInfo: (_: string, msg: { [key: string]: any }) => {
        const data = getMsgData('login_info', msg, msgPath.login_info)?.[0]
        if (data?.uin != undefined) {
            // 如果 runtime 存在（即不是第一次连接），且 uin 不同，重置 runtime
            resetRimtime(runtimeData.loginInfo.uin != data.uin && !login.status)

            // 完成登陆初始化
            runtimeData.loginInfo = data
            login.status = true
            // 显示账户菜单
            updateMenu({
                parent: 'account',
                id: 'userName',
                action: 'label',
                value: data.nickname,
            })
            if (!Option.get('opt_title_text_custom')) {
                const title = `${data.nickname} `
                if (backend.platform == 'web') {
                    document.title = title + '- Stapxs QQ Lite'
                } else {
                    document.title = title
                    backend.call(undefined, 'win:setTitle', false, title)
                }
            }
            // 结束登录页面的水波动画
            clearInterval(runtimeData.tags.loginWaveTimer)
            // 跳转标签卡
            const barMsg = document.getElementById('bar-msg')
            if (barMsg != null) barMsg.click()
            // 加载列表消息
            reloadUsers()
            reloadCookies()
        }
    },

    /**
     * 补充登录信息
     * @deprecated 功能在后期更新中未被重构检查，可能存在问题
     */
    getMoreLoginInfo: (_: string, msg: { [key: string]: any }) => {
        const info = msg?.data?.data?.result?.buddy?.info_list?.[0]
        if (info) runtimeData.loginInfo.info = info
    },

    /**
     * 保存好友列表
     */
    getGroupList: (_: string, msg: { [key: string]: any }) => {
        saveUser(msg, 'group')
    },
    getFriendList: (_: string, msg: { [key: string]: any }) => {
        saveUser(msg, 'friend')
    },

    /**
     * 保存分组信息（独立保存）
     */
    getFriendCategory: (_: string, msg: { [key: string]: any }) => {
        const list = getMsgData(
            'friend_category',
            msg,
            msgPath.friend_category,
        ) as {
            class_id: number
            class_name: string
            sort_id: number
            users: number[]
        }[]
        if (!Array.isArray(list) || list.length === 0) return
        saveClassInfo(list)
        // 刷新用户列表的分类信息
        list.forEach((item) => {
            if (!Array.isArray(item?.users)) return
            item.users.forEach((id) => {
                runtimeData.userList.forEach((user) => {
                    if (user.user_id == id && user.class_id == undefined) {
                        user.class_id = item.class_id
                        user.class_name = item.class_name
                    }
                })
            })
        })
    },

    /**
     * 获取群成员信息
     */
    getUserInfoInGroup: (_: string, msg: { [key: string]: any }) => {
        const data = getMsgData(
            'group_member_info',
            msg,
            msgPath.group_member_info,
        )
        if (data && data[0]) {
            const info = data[0]
            // 单独判断下 shut_up_timestamp
            if (info.shut_up_timestamp * 1000 < Date.now()) {
                info.shut_up_timestamp = 0
            }
            runtimeData.chatInfo.info.me_info = info
        }
    },

    /**
     * 保存群成员列表
     */
    getGroupMemberList: (_: string, msg: { [key: string]: any }) => {
        const data = msg?.data
        if (!Array.isArray(data)) return
        const members = data.filter((item: any) => item && typeof item === 'object')
        members.forEach((item: any) => {
            let name: string
            if (item.card != undefined && item.card != '') {
                name = item.card
            } else if (item.nickname != undefined && item.nickname != '') {
                name = item.nickname
            } else {
                name = String(item.user_id ?? '')
            }

            // 获取拼音首字母
            const first = name.substring(0, 1)
            item.py_start = getPinyin(first)
                .main
                .at(0)
                ?.substring(0, 1)
                .toUpperCase() ?? ' '
        })
        // 筛选列表
        const adminList = members.filter((item: GroupMemberInfoElem) => {
            return item.role === 'admin'
        })
        adminList.sort((a, b) => {
            if (a.py_start && b.py_start) {
                return a.py_start.charCodeAt(0) - b.py_start.charCodeAt(0)
            }
            return 0
        })
        const createrList = members.filter((item: GroupMemberInfoElem) => {
            return item.role === 'owner'
        })
        const memberList = members.filter((item: GroupMemberInfoElem) => {
            return item.role !== 'admin' && item.role !== 'owner'
        })
        memberList.sort((a, b) => {
            if (a.py_start && b.py_start) {
                return a.py_start.charCodeAt(0) - b.py_start.charCodeAt(0)
            }
            return 0
            // return a.user_id - b.user_id
        })
        // 拼接列表
        const back = createrList.concat(adminList.concat(memberList))
        runtimeData.chatInfo.info.group_members = back
    },

    /**
     * 保存聊天记录
     */
    getChatHistoryFist: (
        _: string,
        msg: { [key: string]: any },
        echoList?: string[],
    ) => {
        if (!isCurrentHistoryResponse(echoList)) return
        if (isFailedResponse(msg) || msg.data == null) {
            new PopInfo().add(
                PopType.ERR,
                app.config.globalProperties.$t('获取历史记录失败'),
            )
            runtimeData.tags.loadHistoryFail = true
            return
        }
        void saveMsg(msg, 'top').catch((error) => {
            runtimeData.tags.loadHistoryFail = true
            logger.error(error as Error, '历史消息解析失败')
        })
    },
    getChatHistory: (
        _: string,
        msg: { [key: string]: any },
        echoList?: string[],
    ) => {
        if (!isCurrentHistoryResponse(echoList)) return
        if (isFailedResponse(msg) || msg.data == null) {
            new PopInfo().add(
                PopType.ERR,
                app.config.globalProperties.$t('获取历史记录失败'),
            )
            runtimeData.tags.loadHistoryFail = true
            return
        }
        void saveMsg(msg, 'top').catch((error) => {
            runtimeData.tags.loadHistoryFail = true
            logger.error(error as Error, '历史消息解析失败')
        })
    },

    getChatHistoryOnMsg: (
        _: string,
        msg: { [key: string]: any },
        echoList: string[],
    ) => {
        const id = Number(echoList[1])
        if (id) {
            try {
                // 对消息进行一次格式化处理
                let list = getMsgData('message_list', msg, msgPath.message_list)
                if (Array.isArray(list) && list.length > 0) {
                    list = parseMsgList(
                        list,
                        msgPath.message_list.type,
                        msgPath.message_value,
                    )
                    const first = list[0]
                    if (!first) return
                    const raw = getMsgRawTxt(first)
                    const { time } = first
                    // 更新消息列表
                    const onmsg = runtimeData.baseOnMsgList.get(Number(id))
                    if (onmsg) {
                        if (onmsg.group_id) {
                            const name = first.sender?.card && first.sender.card !== ''
                                ? first.sender.card
                                : first.sender?.nickname ?? ''
                            onmsg.raw_msg = name ? `<span class="reply-name">${name}</span>: ${raw}` : raw
                        } else {
                            onmsg.raw_msg = raw
                        }
                        onmsg.time = getViewTime(Number(time))
                        runtimeData.baseOnMsgList.set(id, onmsg)
                    }
                }
            } catch (e) {
                // do nothing
            }
        }
    },

    /**
     * 发送消息后处理
     */
    sendMsgBack: (
        _: string,
        msg: { [key: string]: any },
        echoList: string[],
    ) => {
        if (isFailedResponse(msg)) {
            logger.error(null, `发送消息 API 返回失败：${String(msg?.retcode ?? 'unknown')}`)
            return
        }
        if (msg.message_id == undefined && msg.data?.message_id != undefined) {
            msg.message_id = msg.data.message_id
        }
        if (echoList[1] == 'forward') {
            // PS：这儿写是写了转发成功，事实上不确定消息有没有真的发送出去（x
            popInfo.add(
                PopType.INFO,
                app.config.globalProperties.$t('消息已转发'),
            )
        } else if (echoList[1] == 'uuid') {
            if (msg.message_id == undefined) {
                logger.error(null, '发送消息响应缺少 message_id')
                return
            }
            const messageId = echoList[2]
            // 去消息列表里找到预发送消息；部分回显先于发送响应到达，
            // 此时需要同时使用 message_id 和 fake_message_id 匹配。
            const sentItem = runtimeData.messageList.find((item) => {
                return String(item?.message_id ?? '') === String(messageId) ||
                    String(item?.fake_message_id ?? '') === String(messageId)
            })
            if (sentItem) {
                sentItem.message_id = msg.message_id
                sentItem.fake_msg = false
            }
            // 请求消息内容
            // PS：其实有消息通知的情况下不需要再去主动获取了
            // 但是为了兼容没有开启自身消息通知的情况，还是保留了这个功能
            Connector.send(
                runtimeData.jsonMap.get_message.name ?? 'get_msg',
                { message_id: msg.message_id },
                'getSendMsg_' + msg.message_id,
            )
        }
    },
    sendFileBack: (
        _: string,
        msg: { [key: string]: any },
        echoList: string[],
    ) => {
        runtimeData.popBoxList.shift()
        msgFunctions['sendMsgBack'](_, msg, echoList)
    },

    /**
     * 获取收藏表情
     */
    getRoamingStamp: (
        _: string,
        msg: { [key: string]: any },
        echoList: string[],
    ) => {
        const getCount = Number(echoList[1])
        const data = Array.isArray(msg?.data) ? msg.data : []
        if (msgPath.roaming_stamp.reverse) {
            data.reverse()
        }
        if (runtimeData.stickerCache == undefined) {
            runtimeData.stickerCache = data
        } else if (runtimeData.jsonMap.roaming_stamp.pagerType == 'full') {
            // 全量分页模式下不追加
            if (getCount > runtimeData.stickerCache.length + 48) {
                // 已经获取到所有内容了
                data.push('end')
            }
            runtimeData.stickerCache = data
        } else {
            runtimeData.stickerCache = runtimeData.stickerCache.concat(data)
        }
    },

    /**
     * 保存群补充信息
     * @deprecated 功能在后期更新中未被重构检查，可能存在问题
     */
    getMoreGroupInfo: (_: string, msg: { [key: string]: any }) => {
        const info = msg?.data?.data
        if (info) runtimeData.chatInfo.info.group_info = info
    },

    /**
     * 保存好友补充信息
     * @deprecated 功能在后期更新中未被重构检查，可能存在问题
     */
    getMoreUserInfo: (_: string, msg: { [key: string]: any }) => {
        // runtimeData.chatInfo.info.user_info =
        //     msg.data.data.result.buddy.info_list[0]
        const data = getMsgData('friend_info', msg, msgPath.friend_info)?.[0]
        if (!data) return
        if (data.reg_time != undefined) data.regTime = new Date(data.reg_time).getTime()
        runtimeData.chatInfo.info.user_info = data
    },

    /**
     * 获取群通知
     */
    getGroupNotices: (_: string, msg: { [key: string]: any }) => {
        const list = getMsgData('group_notices', msg, msgPath.group_notices)
        if (!Array.isArray(list)) return

        // 组装img信息
        let lastImg: Img | undefined
        for (const notice of list) {
            const imgId = String(notice?.img_id ?? '')
            if (imgId.length === 0) continue
            const img = markRaw(new Img(
                `https://p.qlogo.cn/gdynamic/${imgId}/0/`
            ))
            if (lastImg) img.insertPrev(lastImg)
            notice.img = img
            lastImg = img
        }
        runtimeData.chatInfo.info.group_notices = list
    },

    /**
     * 获取群文件列表
     */
    getGroupFiles: (_: string, msg: { [key: string]: any }) => {
        const list = getMsgData('group_files', msg, msgPath.group_files) as (GroupFileElem & GroupFileFolderElem)[] | undefined
        if (!Array.isArray(list)) return
        // 排序；文件夹在前，文件在后
        const folderList = list.filter((item) => {
            return item.folder_id
        })
        const fileList = list.filter((item) => {
            return item.file_id
        })
        // 对它们各自排序，文件夹按照 create_time 降序，文件按照 upload_time 降序
        folderList.sort((a, b) => {
            return b.create_time - a.create_time
        })
        fileList.sort((a, b) => {
            return b.upload_time - a.upload_time
        })
        // 合并
        runtimeData.chatInfo.info.group_files = folderList.concat(fileList)
    },

    /**
     * 获取群文件文件夹文件
     */
    getGroupDirFiles: (_: string, msg: { [key: string]: any }, echoList: string[]) => {
        // TODO: 有分页

        // 默认使用主目录相同的结构，如果存在子目录结构的定义则使用子目录的结构
        let map = msgPath.group_files
        if (msgPath.group_folder_files.source) {
            map = msgPath.group_folder
        }
        const list = getMsgData('group_files', msg, map) as (GroupFileElem & GroupFileFolderElem)[] | undefined
        if (!Array.isArray(list)) return
        // 排序；文件夹在前，文件在后
        const folderList = list.filter((item) => {
            return item.folder_id
        })
        const fileList = list.filter((item) => {
            return item.file_id
        })
        // 对它们各自排序，文件夹按照 create_time 降序，文件按照 upload_time 降序
        folderList.sort((a, b) => {
            return b.create_time - a.create_time
        })
        fileList.sort((a, b) => {
            return b.upload_time - a.upload_time
        })
        // 寻找 item
        const folderId = echoList[1]
        const folder = runtimeData.chatInfo.info.group_files.find((item) => {
            return item.folder_id == folderId
        })
        if (folder) {
            folder.items = fileList
        }
    },

    /**
     * 下载文件（聊天中）
     */
    downloadFile: (_: string, msg: { [key: string]: any }, echoList: string[]) => {
        const data = getMsgData('file_download', msg, msgPath.file_download)?.[0]
        if (!data?.file_url) return
        const url = data.file_url

        const msgId = echoList[1]
        const fileName = decodeURIComponent(atob(echoList[2]))

        // 寻找消息（逆序）
        const msgItem = runtimeData.messageList.find((item) => {
            return item.message_id == msgId
        })
        // 寻找 file 类型消息（一般是第一个）
        let bodyIndex = -1
        if (msgItem && Array.isArray(msgItem.message)) {
            msgItem.message.forEach((item, index) => {
                if (item.type == 'file') {
                    bodyIndex = index
                }
            })
        }

        if (msgItem && bodyIndex != -1) {
            addDownloadTask({
                fileName,
                fileSize: data.file_size || 0,
                filePath: '',
                url,
                onProgress: (percent) => {
                    msgItem.message[bodyIndex].download_percent = percent
                },
                onComplete: () => {
                    msgItem.message[bodyIndex].download_percent = undefined
                },
                onError: () => {
                    msgItem.message[bodyIndex].download_percent = undefined
                },
            })
        }
    },

    /**
     * 下载文件（群文件）
     */
    downloadGroupFile: (_: string, msg: { [key: string]: any }, echoList: string[]) => {
        const data = getMsgData('file_download', msg, msgPath.file_download)?.[0]
        if (!data?.file_url) return
        const url = data.file_url

        const fileId = echoList[1]
        const fileName = decodeURIComponent(atob(echoList[2]))

        const fileList = runtimeData.chatInfo.info.group_files as (GroupFileElem & GroupFileFolderElem)[] | undefined
        if (!Array.isArray(fileList)) return

        let listItem = undefined as GroupFileElem | undefined
        // 寻找文件列表位置
        fileList.forEach((item, index) => {
            if (item.file_id == fileId) {
                listItem = fileList[index]
            }
            if (item.items) {
                item.items.forEach((subItem, subIndex) => {
                    if (subItem.file_id == fileId && fileList[index]?.items) {
                        listItem = fileList[index].items[subIndex]
                    }
                })
            }
        })

        addDownloadTask({
            fileName,
            fileSize: data.file_size || 0,
            filePath: '',
            url,
            onProgress: (percent) => {
                if (listItem) {
                    if (listItem.download_percent == undefined) {
                        listItem.download_percent = 0
                    }
                    listItem.download_percent = percent
                }
            },
            onComplete: () => {
                if (listItem) {
                    listItem.download_percent = undefined
                }
            },
            onError: () => {
                if (listItem) {
                    listItem.download_percent = undefined
                }
            },
        })
    },

    /**
     * 文件预览下载
     */
    loadFileBase: (
        _: string,
        msg: { [key: string]: any },
        echoList: string[],
    ) => {
        const data = getMsgData('file_download', msg, msgPath.file_download)?.[0]
        if (!data) return
        let url = data.file_url
        const msgId = echoList[1]
        const ext = echoList[2]
        if (url) {
            // 寻找消息
            const msg = runtimeData.messageList.find((item) => {
                return item.message_id == msgId
            })
            if (msg) {
                if (document.location.protocol == 'https:') {
                    // 判断文件 URL 的协议
                    // PS：Chrome 不会对 http 文件进行协议升级
                    if (url.toLowerCase().startsWith('http:')) {
                        url = 'https' + url.substring(url.indexOf('://'))
                    }
                }
                msg.fileView.url = url
                msg.fileView.ext = ext
            }
        }
    },

    /**
     * 保存精华消息
     */
    getJin: (_: string, msg: { [key: string]: any }) => {
        const jinList = getMsgData('group_essence', msg, msgPath.group_essence)
        const is_end = getMsgData(
            'is_end',
            msg,
            msgPath.group_essence.is_end,
        ) ?? [true]
        if (jinList && is_end) {
            if (runtimeData.chatInfo.info.jin_info.list.length == 0) {
                runtimeData.chatInfo.info.jin_info.list = jinList
            } else {
                const now_page = runtimeData.chatInfo.info.jin_info.pages ?? 0

                runtimeData.chatInfo.info.jin_info.list =
                    runtimeData.chatInfo.info.jin_info.list.concat(jinList)
                runtimeData.chatInfo.info.jin_info.pages = now_page + 1
            }
            runtimeData.chatInfo.info.jin_info.is_end = is_end[0]
        }
    },

    /**
     * 获取发送的消息（消息发送后处理）
     * @deprecated 功能已被遗弃，暂时保留方法
     */
    getSendMsg: (
        _: string,
        msg: { [key: string]: any },
        echoList: string[],
    ) => {
        const responseData = msg?.data && typeof msg.data === 'object' ? msg.data : {}
        const msgInfo = getMsgData('message_info', responseData, msgPath.message_info)
        const info = msgInfo?.[0]
        if (info?.message_id != undefined) {
            if (echoList[1] !== String(info.message_id)) {
                // 返回的不是这条消息，重新请求
                setTimeout(() => {
                    Connector.send(
                        runtimeData.jsonMap.get_message.name ?? 'get_msg',
                        { message_id: echoList[1] },
                        'getSendMsg_' + echoList[1]
                    )
                }, 5000)
            } else {
                // 优先按真实 message_id 查找；回显先到时仍兼容 fake_msg。
                let fakeMsg = null as any
                for (let i = runtimeData.messageList.length - 1; i >= 0; i--) {
                    const msg = runtimeData.messageList[i]
                    if (
                        String(msg?.message_id ?? '') === String(info.message_id) ||
                        (msg?.fake_msg != undefined && info.sender == runtimeData.loginInfo.uin)
                    ) {
                        fakeMsg = msg
                        break
                    }
                }
                // 预发送消息刷新
                if (fakeMsg != null) {
                    // 将这条消息直接替换掉
                    const trueMsg = getMsgData(
                        'message_list',
                        buildMsgList([msg.data]),
                        msgPath.message_list,
                    )
                    getMessageList(trueMsg).then((trueMsg) => {
                        if (trueMsg?.length == 1) {
                            // 使用消息对象引用直接更新，避免索引问题。若回包仍缺少图片 URL，
                            // 保留预发送消息中的可显示图片。
                            fakeMsg.message = mergeSentMessageSegments(fakeMsg.message, trueMsg[0].message)
                            fakeMsg.raw_message = trueMsg[0].raw_message
                            fakeMsg.time = trueMsg[0].time
                            fakeMsg.fake_msg = undefined
                            fakeMsg.revoke = false
                            // 消息内容（含图片 URL）已变，通知图片列表重建
                            runtimeData.watch.chatImgVersion++
                        }
                    })
                }
            }
        }
    },

    /**
     * 设置消息已读
     */
    readMemberMessage: (_: string, msg: { [key: string]: any }) => {
        const data = Array.isArray(msg?.data) ? msg.data[0] : msg?.data
        const readMap = runtimeData.jsonMap.set_message_read
        const msgName = readMap?.name ?? readMap?.private_name
        const private_name = readMap?.private_name ?? msgName
        if (!data || !msgName || !private_name) return
        if (data.group_id != undefined) {
            Connector.send(
                msgName,
                {
                    message_id: data.message_id,
                    group_id: data.group_id,
                },
                'setMessageRead',
            )
        } else {
            Connector.send(
                private_name,
                {
                    message_id: data.message_id,
                    user_id: data.self_id,
                },
                'setMessageRead',
            )
        }
        // 关闭所有通知
        new Notify().closeAll(data.group_id ?? data.self_id)
    },

    /**
     * 系统通知后处理
     */
    setFriendAdd: updateSysInfo,
    setGroupAdd: updateSysInfo,

    /**
     * 获取会话历史
     */
    getRecentContact: (_: string, data: any) => {
        const list = getMsgData('recent_contact', data, msgPath.recent_contact)
        if (list != undefined) {
            // user_id: /peerUin
            // time: /msgTime
            // chat_type: /chatType
            // 过滤掉 chatType 不是 1 和 2 的
            let back = list.filter((item) => {
                return item.chat_type == 1 || item.chat_type == 2
            })
            // 排除掉在置顶列表里的
            const topList = runtimeData.sysConfig.top_info as {
                [key: string]: number[]
            } | null
            if (topList != null) {
                const top = topList[runtimeData.loginInfo.uin]
                if (top != undefined) {
                    back = back.filter((item) => {
                        return top.indexOf(Number(item.user_id)) == -1
                    })
                }
            }
            // 去重
            back = back.filter((item, index, arr) => {
                return (
                    arr.findIndex((item2) => {
                        return item2.user_id == item.user_id
                    }) == index
                )
            })
            back.forEach((item) => {
                // 去消息列表里找一下它
                const user = runtimeData.userList.find((user) => {
                    return user.user_id == item.user_id || user.group_id == item.user_id
                })
                if (user) {
                    runtimeData.baseOnMsgList.set(Number(item.user_id), user)
                    updateLastestHistory(user)
                }
            })
        }
    },

    /**
     * 表情回应后处理
     * echoList: [0]=SendRespondBack [1]=msgId [2]=emojiId [3]='remove'(optional)
     * 添加时：不做乐观更新，等待 group_msg_emoji_like 推送来更新（避免双重计数）
     * 取消时：NapCat 取消不一定有推送，手动更新本地状态
     */
    SendRespondBack: (
        _: string,
        __: { [key: string]: any },
        echoList: string[],
    ) => {
        const msgId = echoList[1]
        const id = Number(echoList[2])
        const isRemove = echoList[3] === 'remove'
        if (!isRemove) {
            // 添加回应：不做乐观更新，等 group_msg_emoji_like 推送
            return
        }
        // 取消回应：手动更新本地状态（取消不一定有推送）
        runtimeData.messageList.forEach((item, index) => {
            if (item.message_id == msgId) {
                if (runtimeData.messageList[index].emoji_like) {
                    runtimeData.messageList[index].emoji_like.forEach(
                        (entry: { emoji_id: number; count: number; liked?: boolean }) => {
                            if (entry.emoji_id == id) {
                                entry.count = Math.max(0, entry.count - 1)
                                entry.liked = false
                            }
                        },
                    )
                    // 清理数量 <= 0 的表情
                    runtimeData.messageList[index].emoji_like = runtimeData.messageList[index].emoji_like.filter(
                        (entry: any) => entry.count > 0
                    )
                    if (runtimeData.messageList[index].emoji_like.length === 0) {
                        delete runtimeData.messageList[index].emoji_like
                    }
                }
            }
        })
    },

    /**
     * 获取 cookie
     * @deprecated 暂时没用到他
     */
    getCookies: (
        _: string,
        msg: { [key: string]: any },
        echoList: string[],
    ) => {
        const cookieString = msg?.data?.cookies
        // get_cookies 失败时 SnowLuma 会返回 data: null；不要让登录初始化
        // 因为缺少可选的 Web API Cookie 而中断。
        if (typeof cookieString !== 'string') return

        // 拆分 cookie，值本身可能包含 '='。
        const cookieObject = {} as { [key: string]: string }
        cookieString.split(';').forEach((item: string) => {
            const separator = item.indexOf('=')
            if (separator <= 0) return
            const key = item.substring(0, separator).trim()
            const value = item.substring(separator + 1).trim()
            if (key) cookieObject[key] = value
        })
        // 计算 bkn
        const skey = cookieObject['skey'] || ''
        let hash = 5381

        for (let i = 0; i < skey.length; i++) {
            hash += (hash << 5) + skey.charCodeAt(i)
        }
        // 保存 cookie 和 bkn
        const domain = echoList?.[1] ?? 'qun.qq.com'
        if (!runtimeData.loginInfo.webapi) runtimeData.loginInfo.webapi = {}
        if (!runtimeData.loginInfo.webapi[domain])
            runtimeData.loginInfo.webapi[domain] = {}
        runtimeData.loginInfo.webapi[domain].cookie = cookieObject
        runtimeData.loginInfo.webapi[domain].bkn = (
            hash & 0x7fffffff
        ).toString()
    },

    /**
     * 设置消息已读回调
     */
    setMessageRead() {
        // do nothing
    },
} as {
    [key: string]: (
        name: string,
        msg: { [key: string]: any },
        echoList?: string[],
    ) => void
}

const handlers: Record<string, (payload: any, metaArgs?: string[]) => void> = {
    ...(Object.entries(msgFunctions).reduce((acc, [key, fn]) => ({
        ...acc,
        [key]: (payload: any, metaArgs?: string[]) => fn(key, payload, metaArgs)
    }), {})),
    ...(Object.entries(noticeFunctions).reduce((acc, [key, fn]) => ({
        ...acc,
        [key]: (payload: any) => fn(key, payload)
    }), {}))
};

// ==========================================

function saveUser(msg: { [key: string]: any }, type: string) {
    listLoadTimes++
    let list: any[] | undefined
    if (msgPath.user_list)
        list = getMsgData('user_list', msg, msgPath.user_list)
    else {
        switch (type) {
            case 'friend':
                list = getMsgData('friend_list', msg, msgPath.friend_list)
                if (list)
                    // 根据 user_id 去重
                    list = list.filter((item, index, arr) => {
                        return (
                            arr.findIndex((item2) => {
                                return item2.user_id == item.user_id
                            }) == index
                        )
                    })
                break
            case 'group':
                list = getMsgData('group_list', msg, msgPath.group_list)
                if (list)
                    // 根据 group_id 去重
                    list = list.filter((item, index, arr) => {
                        return (
                            arr.findIndex((item2) => {
                                return item2.group_id == item.group_id
                            }) == index
                        )
                    })
                break
        }
    }
    if (Array.isArray(list)) {
        const groupNames = {} as { [key: number]: string }
        list.forEach((item, index) => {
            if (item.group_name == null || item.group_name == undefined) {
                item.group_name = ''
            }
            // 为所有项目追加拼音名称
            let pyMatchName = ''
            if (item.group_id) {
                pyMatchName = item.group_name
            } else {
                pyMatchName = `${item.nickname},${item.remark}`
            }
            if (list?.[index]) {
                list[index].py_name = getPinyin(pyMatchName)
                list[index].py_start = list[index]
                    .py_name
                    .main.at(0)
                    ?.substring(0, 1)
                    .toUpperCase() ?? ' '
            }
            // 构建分类
            if (type == 'friend') {
                if (item.class_id != undefined && item.class_name) {
                    if (typeof item.class_name == 'string') {
                        groupNames[item.class_id] = item.class_name
                    } else {
                        groupNames[item.class_id] = item.class_name[0]
                    }
                }
                delete item.group_name
            } else {
                delete item.class_id
                delete item.class_name
            }
        })
        if (Object.keys(groupNames).length > 0) {
            // 把 groupNames 处理为 { class_id: number, class_name: string }[]
            const groupNamesList = [] as {
                class_id: number
                class_name: string
            }[]
            for (const key in groupNames) {
                groupNamesList.push({
                    class_id: Number(key),
                    class_name: groupNames[key],
                })
            }
            saveClassInfo(groupNamesList)
        }
        // 按照首字母排序
        list.sort((a, b) => {
            if (a.py_start && b.py_start) {
                return a.py_start.charCodeAt(0) - b.py_start.charCodeAt(0)
            }
            return 0
        })
        runtimeData.userList = runtimeData.userList.concat(list)
        // 刷新置顶列表
        const info = runtimeData.sysConfig.top_info as {
            [key: string]: number[]
        } | null
        if (info != null) {
            const topList = info[runtimeData.loginInfo.uin]
            if (topList !== undefined) {
                list.forEach((item) => {
                    const id = Number(
                        item.user_id ? item.user_id : item.group_id,
                    )
                    if (topList.indexOf(id) >= 0) {
                        item.always_top = true
                        // 判断它在不在消息列表里
                        if (runtimeData.baseOnMsgList.get(id) == undefined) {
                            runtimeData.baseOnMsgList.set(id, item)
                            // 给它获取一下最新的一条消息
                            // 给置顶的用户刷新最新一条的消息用于显示
                            runtimeData.userList.forEach((item) => {
                                if (item.always_top) {
                                    updateLastestHistory(item)
                                }
                            })
                        }
                    }
                })
            }
        }
        // 更新菜单
        updateMenu({
            parent: 'account',
            id: 'userList',
            action: 'label',
            value: app.config.globalProperties.$t('用户列表（{count}）', {
                count: runtimeData.userList.length,
            }),
        })
    }
    // 如果获取次数大于 0 并且是双数，刷新一下历史会话
    if (listLoadTimes > 0 && listLoadTimes % 2 == 0) {
        // 获取最近的会话
        if (runtimeData.jsonMap.recent_contact)
            Connector.send(
                runtimeData.jsonMap.recent_contact.name,
                {},
                'getRecentContact',
            )
    }
    // 如果是分离式的好友列表，继续获取分类信息
    if (type == 'friend' && runtimeData.jsonMap.friend_category) {
        Connector.send(
            runtimeData.jsonMap.friend_category.name,
            {},
            'getFriendCategory',
        )
    }
}

function saveClassInfo(
    list: { class_id: number; class_name: string; sort_id?: number }[],
) {
    if (!Array.isArray(list) || list.length === 0) return
    if (list[0].sort_id != undefined) {
        // 如果有 sort_id，按 sort_id 排序，从小到大
        list.sort((a, b) => {
            if (a.sort_id && b.sort_id) return a.sort_id - b.sort_id
            else return 0
        })
    } else {
        // 按 class_id 排序
        list.sort((a, b) => {
            return a.class_id - b.class_id
        })
    }

    runtimeData.tags.classes = list
}

async function saveMsg(msg: any, append = undefined as undefined | string) {
    let list = await normalizeMessagesFromPayload(msg)
    if (!Array.isArray(list) || list.length === 0) {
        if (append === 'top') {
            runtimeData.watch.historyLoadSummaryEvent = {
                token: (runtimeData.tags as any).historyLoadToken ?? '',
                chatId: runtimeData.chatInfo.show.id,
                serverMessages: 0,
                serverImages: 0,
            }
            runtimeData.tags.canLoadHistory = false
            runtimeData.tags.historyBeforeTime = undefined
        }
        return
    }

    const unfilteredList = [...list]
    const historyBeforeTime = Number(runtimeData.tags.historyBeforeTime)
    const hasHistoryBeforeTime = Number.isFinite(historyBeforeTime)
    // 检查消息是否是当前聊天的消息
    const firstMsg = list[0]
    const infoList = getMsgData(
        'message_info',
        firstMsg,
        msgPath.message_info,
    )
    if (infoList?.[0]) {
        const info = infoList[0]
        const id = info.group_id ?? info.private_id
        if (id != undefined && id != runtimeData.chatInfo.show.id) {
            return
        }
    }
    // 将消息中 message 字段为空数组或缺失的消息过滤掉
    list = list.filter((item: any) => {
        return Array.isArray(item?.message) && item.message.length > 0
    })

    if (hasHistoryBeforeTime && append === 'top') {
        list = list.filter((item: any) => {
            const t = Number(item?.time)
            return Number.isFinite(t) && t <= historyBeforeTime
        })
    }

    if (hasHistoryBeforeTime && append === 'top' && list.length < 1) {
        list = unfilteredList
    }

    if (append === 'top') {
        runtimeData.watch.historyLoadSummaryEvent = {
            token: (runtimeData.tags as any).historyLoadToken ?? '',
            chatId: runtimeData.chatInfo.show.id,
            serverMessages: list.length,
            serverImages: countImagesInMessages(list),
        }
    }
    void saveMessagesWithSideEffects(runtimeData.loginInfo.uin, list).catch((error) => {
        logger.error(error as Error, '本地历史保存失败')
    })
    // 如果分页不是增量的，就不使用追加
    if (
        append == 'top' &&
        runtimeData.jsonMap.message_list?.pagerType == 'full'
    ) {
        append = undefined
    }
    // 追加处理
    if (append != undefined) {
        // 没有更旧的消息能加载了，禁用允许加载标志
        if (list.length < 1) {
            runtimeData.tags.canLoadHistory = false
            runtimeData.tags.historyBeforeTime = undefined
            return
        }
        replaceMessageListInPlace(
            mergeMessagesByIdAndTime(runtimeData.messageList, list),
        )
    } else {
        if (
            runtimeData.sysConfig.enable_local_history &&
            runtimeData.sysConfig.mixed_load_messages !== false
        ) {
            replaceMessageListInPlace(
                mergeMessagesByIdAndTime(runtimeData.messageList, list),
            )
        } else {
            replaceMessageListInPlace(list)
        }
    }
    // 消息后处理
    // PS: 部分消息类型可能需要获取附加内容，在此处进行处理
    runtimeData.messageList.forEach((item) => {
        sendMsgAppendInfo(item)
    })
    // 将消息列表的最后一条 raw_message 保存到用户列表中
    const lastMsg =
        runtimeData.messageList[runtimeData.messageList.length - 1]
    if (lastMsg) {
        const user = runtimeData.userList.find((item) => {
            return (
                item.group_id == runtimeData.chatInfo.show.id ||
                item.user_id == runtimeData.chatInfo.show.id
            )
        })
        if (user) {
            if (runtimeData.chatInfo.show.type == 'group') {
                const senderName = lastMsg.sender?.card || lastMsg.sender?.nickname || ''
                user.raw_msg = senderName
                    ? `<span class="reply-name">${senderName}</span>: ` + getMsgRawTxt(lastMsg)
                    : getMsgRawTxt(lastMsg)
            } else {
                user.raw_msg = getMsgRawTxt(lastMsg)
            }
            user.time = getViewTime(Number(lastMsg.time))
        }
    }
    if (hasHistoryBeforeTime) {
        runtimeData.tags.historyBeforeTime = undefined
    }
}

async function normalizeMessagesFromPayload(payload: any): Promise<any[] | undefined> {
    const rawList = getMsgData('message_list', payload, msgPath.message_list)
    return getMessageList(rawList)
}

function summarizeRecordSegment(segment: any): Record<string, boolean> {
    const nested = segment?.data && typeof segment.data === 'object' ? segment.data : {}
    const value = (key: string) => segment?.[key] ?? nested[key]
    return {
        hasFile: Boolean(value('file')),
        hasPath: Boolean(value('path')),
        hasUrl: Boolean(value('url')),
        hasBase64: Boolean(value('base64') || value('audio') || value('content')),
    }
}

function normalizeNewIncomingMessage(data: any): any[] {
    // parseMsgList 会原地修改消息段（并删除 seg.data）。
    // newMsg() 后面还要再用原始 payload 调 saveMsg() 解析一遍，
    // 所以这里必须先 clone，避免第一次 parse 把 record 的 file/path/url 删掉。
    let cloned: any
    try {
        cloned = typeof structuredClone === 'function'
            ? structuredClone(data)
            : JSON.parse(JSON.stringify(data))
    } catch {
        return []
    }
    let list = getMsgData('message_list', buildMsgList([cloned]), msgPath.message_list)
    if (!Array.isArray(list)) return []
    list = parseMsgList(list, msgPath.message_list.type, msgPath.message_value)
    return list
}

function normalizeMessageId(id: unknown): string {
    if (id === null || id === undefined) return ''
    return String(id)
}

function getImageDisplayUrl(segment: any): string {
    const directUrl = segment?.url ?? segment?.data?.url
    if (typeof directUrl === 'string' && directUrl) return directUrl
    const file = segment?.file ?? segment?.data?.file
    if (typeof file === 'string' && (file.startsWith('data:') || /^https?:\/\//i.test(file))) return file
    return ''
}

function mergeSentMessageSegments(previous: any, incoming: any): any[] {
    if (!Array.isArray(incoming)) return Array.isArray(previous) ? previous : []
    if (!Array.isArray(previous)) return incoming

    return incoming.map((segment: any, index: number) => {
        const oldSegment = previous[index]
        if (segment?.type !== 'image' || oldSegment?.type !== 'image') return segment
        if (getImageDisplayUrl(segment)) return segment
        const oldUrl = getImageDisplayUrl(oldSegment)
        if (!oldUrl) return segment
        return {
            ...oldSegment,
            ...segment,
            url: oldUrl,
        }
    })
}

function getMessageTimestamp(msg: any): number {
    const t = Number(msg?.time)
    return Number.isFinite(t) ? t : 0
}

function buildFallbackMessageKey(msg: any): string {
    const seq = msg?.message_seq ?? msg?.seq_id ?? msg?.seq ?? ''
    const sender = msg?.sender?.user_id ?? msg?.user_id ?? msg?.sender_id ?? ''
    return `${getMessageTimestamp(msg)}|${sender}|${seq}`
}

function compareMessageOrder(a: any, b: any): number {
    const ta = getMessageTimestamp(a)
    const tb = getMessageTimestamp(b)
    if (ta !== tb) return ta - tb

    const sa = Number(a?.message_seq ?? a?.seq_id ?? a?.seq)
    const sb = Number(b?.message_seq ?? b?.seq_id ?? b?.seq)
    if (Number.isFinite(sa) && Number.isFinite(sb) && sa !== sb) {
        return sa - sb
    }

    const ia = normalizeMessageId(a?.message_id)
    const ib = normalizeMessageId(b?.message_id)
    if (ia === ib) return 0
    return ia.localeCompare(ib)
}

function getImageSegments(msg: any): any[] {
    if (!Array.isArray(msg?.message)) return []
    return msg.message.filter((seg: any) => seg?.type === 'image')
}

function hasImageMessage(msg: any): boolean {
    return getImageSegments(msg).length > 0
}

function countImagesInMessages(msgs: any[]): number {
    let count = 0
    const walk = (items: any[]) => {
        for (const item of items) {
            if (!Array.isArray(item?.message)) continue
            for (const seg of item.message) {
                if (seg?.type === 'image') count++
                if (Array.isArray(seg?.content)) walk(seg.content)
            }
        }
    }
    walk(msgs)
    return count
}

function hasResolvableImageSource(msg: any): boolean {
    const imgs = getImageSegments(msg)
    if (imgs.length === 0) return false
    return imgs.every((seg: any) => {
        const url = typeof seg?.url === 'string' ? seg.url : ''
        const file = typeof seg?.file === 'string' ? seg.file : ''
        return url.length > 0 || file.length > 0
    })
}

const MAX_FORWARD_DEPTH = 8

function hasLoadedForwardContent(msg: any): boolean {
    if (!Array.isArray(msg?.message)) return false
    return msg.message.some((seg: any) => {
        return seg?.type === 'forward' && Array.isArray(seg.content) && seg.content.length > 0
    })
}

function shouldReplaceDuplicateMessage(existing: any, incoming: any): boolean {
    if (existing?._from_local_db !== true) return false
    if (hasLoadedForwardContent(incoming) && !hasLoadedForwardContent(existing)) return true
    if (!hasImageMessage(incoming)) return false
    if (runtimeData.sysConfig.disable_local_history_image_cache === true) {
        return true
    }
    return !hasResolvableImageSource(existing) && hasResolvableImageSource(incoming)
}

function mergeMessagesByIdAndTime(current: any[], incoming: any[]): any[] {
    if (incoming.length === 0) return [...current]
    if (current.length === 0) {
        const firstPass = [...incoming]
        firstPass.sort(compareMessageOrder)
        return firstPass
    }

    const idSet = new Set<string>()
    const idIndexMap = new Map<string, number>()
    const fallbackSet = new Set<string>()
    const merged = [] as any[]

    for (const msg of current) {
        merged.push(msg)
        const id = normalizeMessageId(msg?.message_id)
        if (id) {
            idSet.add(id)
            idIndexMap.set(id, merged.length - 1)
        } else {
            fallbackSet.add(buildFallbackMessageKey(msg))
        }
    }

    for (const msg of incoming) {
        const id = normalizeMessageId(msg?.message_id)
        if (id) {
            if (idSet.has(id)) {
                const idx = idIndexMap.get(id)
                if (idx !== undefined && shouldReplaceDuplicateMessage(merged[idx], msg)) {
                    merged[idx] = msg
                }
                continue
            }
            idSet.add(id)
            merged.push(msg)
            idIndexMap.set(id, merged.length - 1)
            continue
        }

        const fallbackKey = buildFallbackMessageKey(msg)
        if (fallbackSet.has(fallbackKey)) continue
        fallbackSet.add(fallbackKey)
        merged.push(msg)
    }

    merged.sort(compareMessageOrder)
    return merged
}

function replaceMessageListInPlace(next: any[]) {
    runtimeData.messageList.splice(0, runtimeData.messageList.length, ...next)
}

export async function getMessageList(list: any[] | undefined, forwardDepth = 0) {
    if (!Array.isArray(list) || list.length === 0) return []

    list = parseMsgList(
        list,
        msgPath.message_list.type,
        msgPath.message_value,
    )
    // 倒序处理
    if (msgPath.message_list.order === 'reverse') {
        list.reverse()
    }
    // 检查必要字段
    list.forEach((item: any) => {
        if (!item.post_type) {
            item.post_type = 'message'
        }
    })
    return Promise.all(list.map((item) => msgPreprocess(item, forwardDepth)))
}

/**
 * 消息预处理
 * @param msg 要处理的消息
 */
async function msgPreprocess(msg: any, forwardDepth = 0): Promise<any> {
    if (!msg || typeof msg !== 'object') return msg
    if (!Array.isArray(msg.message)) {
        msg.message = Array.isArray(msg.content) ? msg.content : []
    }
    const sender = msg.sender && typeof msg.sender === 'object' && !Array.isArray(msg.sender)
        ? msg.sender
        : {}
    msg.sender = sender
    if (sender.user_id == null) sender.user_id = msg.user_id ?? 0
    if (sender.card == null) sender.card = ''
    if (sender.nickname == null) sender.nickname = sender.card || String(sender.user_id ?? '')

    //#region == json 合并转发 ============================
    if (msg.message[0]?.type === 'json') {
        try {
            const rawData = msg.message[0].data
            const nestedData = rawData && typeof rawData === 'object' && 'data' in rawData
                ? rawData.data
                : rawData
            const data = typeof nestedData === 'string' ? JSON.parse(nestedData) : nestedData
            if (data?.['app'] === 'com.tencent.multimsg') {
                const resid = data?.['meta']?.['detail']?.['resid']
                if (resid) {
                    msg.message = [{
                        type: 'forward',
                        id: resid,
                    }]
                }
            }
        } catch {/**/ }
    }
    //#endregion

    //#region == 合并转发解析 ==============================
    // 转发段不一定是消息的第一个 segment；逐段处理也能覆盖嵌套转发。
    const forwardSegments = msg.message.filter((segment: any) => segment?.type === 'forward')
    for (const forwardSeg of forwardSegments) {
        const forwardData = forwardSeg.data && typeof forwardSeg.data === 'object'
            ? forwardSeg.data
            : {}
        const forwardId = forwardSeg.id
            ?? forwardSeg.res_id
            ?? forwardSeg.forward_id
            ?? forwardData.id
            ?? forwardData.res_id
            ?? forwardData.forward_id
        if (forwardId && !forwardSeg.id) forwardSeg.id = forwardId
        forwardSeg.forward_source = msg?._from_local_db
            ? 'local-db'
            : String(runtimeData.botInfo.app_name ?? 'OneBot')
        if (forwardId) {
            try {
                if (forwardDepth >= MAX_FORWARD_DEPTH) {
                    throw new Error('合并转发嵌套层级过深')
                }
                let data: any[]
                if (Array.isArray(forwardSeg.content) && forwardSeg.content.length > 0) {
                    // 如果 content 里已经有内容了就直接用 content 里的内容
                    data = await getMessageList(forwardSeg.content, forwardDepth + 1)
                } else {
                    // 否则调用接口获取。callApi 返回 null/undefined 时不能当作空转发，
                    // 否则会把 API 失败误标记为成功。
                    const originData = await Connector.callApi('forward_msg', { id: forwardId })
                    if (!Array.isArray(originData)) throw new Error('合并转发 API 未返回消息数组')
                    data = await getMessageList(originData, forwardDepth + 1)
                }
                if (!Array.isArray(data) || data.length === 0) {
                    throw new Error('合并转发 API 未返回消息节点')
                }
                forwardSeg.content = data
                forwardSeg.forward_error_code = undefined
                forwardSeg.forward_error_detail = undefined
            } catch (e) {
                forwardSeg.forward_error_code = 'forward-load-failed'
                forwardSeg.forward_error_detail = 'forward content unavailable'
                logger.error(e as unknown as Error, '合并转发解析失败')
            }
        } else {
            forwardSeg.content = []
            forwardSeg.forward_error_code = 'missing-forward-id'
            forwardSeg.forward_error_detail = 'forward segment has no id'
        }
    }
    //#endregion

    //#region == lgr 商场表情 =============================
    // 过滤掉mface后面尾随的字符串
    const filter: any[] = []
    for (let id = 0; id < msg.message.length; id++) {
        const seg = msg.message[id]
        if (!seg || typeof seg !== 'object') continue
        filter.push(seg)
        if (seg.type === 'mface') id++
    }
    msg.message = filter
    //#endregion
    return msg
}

function revokeMsg(_: string, msg: any) {
    // 清除通知
    const noticeType = typeof msg?.notice_type === 'string' ? msg.notice_type : ''
    const chatId = noticeType.includes('group') ? msg.group_id : msg.user_id
    new Notify().closeAll(chatId)

    // 寻找消息
    const msgId = msg.message_id
    dbRevokeMessage(runtimeData.loginInfo.uin, String(msgId))
    let msgGet = null as { [key: string]: any } | null
    let msgIndex!: number
    for (const [index, msg] of runtimeData.messageList.entries()) {
        if (msg.message_id === msgId) {
            msgGet = msg
            msgIndex = index
        }
    }

    if (!msgGet) {
        logger.add(LogType.UI, '没有找到这条被撤回的消息')
        return
    }

    // 移除消息
    runtimeData.messageList.splice(msgIndex, 1)

    if (msgGet.sender?.user_id === runtimeData.loginInfo.uin)
        msg.originMsg = msgGet

    // 显示撤回提示
    const list = runtimeData.messageList
    list.splice(msgIndex + 1, 0, msg)
}

let qed_try_times = 0
function newMsg(_: string, data: any) {
    const { $t } = app.config.globalProperties
    // 没有对频道的支持计划
    if (data.detail_type == 'guild') {
        return
    }

    // [VoiceDebug] 打印实时消息中的 record 段原始结构
    try {
        const rawSegs = data?.message
        if (Array.isArray(rawSegs)) {
            rawSegs.forEach((seg: any) => {
                if (seg?.type === 'record') {
                    logger.debug('[VoiceDebug] 实时 record 段：' + JSON.stringify(summarizeRecordSegment(seg)))
                }
            })
        }
    } catch { /* ignore */ }

    const infoList = getMsgData('message_info', data, msgPath.message_info)
    if (Array.isArray(infoList) && infoList[0]) {
        // 消息基础信息 ============================================
        const info = infoList[0]
        const id = info.group_id ?? info.private_id
        const loginId = runtimeData.loginInfo.uin
        const showId = runtimeData.chatInfo.show.id
        const sender = info.sender
        // 在好友列表里找一下他
        const senderInfo = runtimeData.userList.find((item) => {
            return item.user_id == sender
        })
        const isImportant = senderInfo?.class_id == 9999

        // 预发送消息填充 ============================================
        // 列表内最近的一条 fake_msg（倒序查找）
        let fakeMsg = null as any
        for (let i = runtimeData.messageList.length - 1; i >= 0; i--) {
            const msg = runtimeData.messageList[i]
            if (
                sender == loginId &&
                (msg.fake_msg != undefined || (
                    info.message_id != null &&
                    String(msg.message_id) === String(info.message_id)
                ))
            ) {
                fakeMsg = msg
                break
            }
        }
        // 预发送消息刷新
        if (fakeMsg != null) {
            // 将这条消息直接替换掉
            const trueMsg = getMsgData(
                'message_list',
                buildMsgList([data]),
                msgPath.message_list,
            )
            getMessageList(trueMsg).then((trueMsg) => {
                if (trueMsg?.length == 1) {
                    // 使用消息对象引用直接更新，避免索引问题。若回显缺少图片 URL，
                    // 保留预发送消息中的可显示图片，等待 get_msg 完整回包。
                    fakeMsg.message = mergeSentMessageSegments(fakeMsg.message, trueMsg[0].message)
                    fakeMsg.raw_message = trueMsg[0].raw_message
                    fakeMsg.time = trueMsg[0].time
                    fakeMsg.fake_msg = undefined
                    fakeMsg.revoke = false
                }
            })
            // fake 消息已经通过引用更新，不应删除列表顶部的历史消息。
            return
        }

        // 刷新 favicon
        refreshFavicon()

        const normalizedIncoming = normalizeNewIncomingMessage(data)
        if (normalizedIncoming.length > 0) {
            void saveMessagesWithSideEffects(runtimeData.loginInfo.uin, normalizedIncoming).catch((error) => {
                logger.error(error as Error, '本地历史保存失败')
            })
        }

        // 显示消息 ============================================
        if (id === showId || info.target_id == showId) {
            // 如果有正在输入的提示，清除它
            runtimeData.chatInfo.show.appendInfo = undefined
            // 保存消息
            void saveMsg(buildMsgList([data]), 'bottom').catch((error) => {
                logger.error(error as Error, '实时消息解析失败')
            })
            // 抽个签
            const num = randomNum(0, 10000)
            if (num >= 400 && num <= 500) {
                logger.add(
                    LogType.INFO,
                    num.toString() + '，这只是个神秘的数字...',
                    undefined,
                    true,
                )
            }
            if (num === 495) {  // QED怎么能和芙兰无关？(◣_◢)吃我一发 QED [495年的波纹]
                const popInfo = {
                    html: qed,
                    button: [
                        {
                            text: '确定(O)',
                            fun: () => {
                                runtimeData.popBoxList.shift()
                            },
                        },
                    ],
                }
                runtimeData.popBoxList.push(popInfo)
                Umami.trackEvent('show_qed', { times: qed_try_times })
            }
            qed_try_times++
        }

        // 对消息进行一次格式化处理
        const list = normalizedIncoming
        if (list.length > 0) {
            data = list[0]
        } else {
            let parsed = getMsgData(
                'message_list',
                buildMsgList([data]),
                msgPath.message_list,
            )
            if (Array.isArray(parsed) && parsed.length > 0) {
                parsed = parseMsgList(
                    parsed,
                    msgPath.message_list.type,
                    msgPath.message_value,
                )
                data = parsed[0]
            }
        }

        // 异常/空事件不应继续进入通知、会话预览等逻辑。
        if (!data || typeof data !== 'object' || !Array.isArray(data.message) || data.message.length === 0) return
        if (!data.sender || typeof data.sender !== 'object') data.sender = {}

        // [Voice] 实时推送的 record 段可能缺 file（NapCat 只给 file_size）。
        // 用历史接口拉最近几条完整消息，按 message_id 补全 record 的 file/url。
        if (data?.message && data.message.some((s: any) => s?.type === 'record' && !s?.file)) {
            const msgId = data.message_id
            const type = data.message_type
            const chatId = data.group_id ?? data.user_id
            if (msgId && chatId) {
                const echo = 'voiceHistoryFill_' + msgId + '_' + Date.now()
                const apiName = type === 'group'
                    ? runtimeData.jsonMap.message_list?.name
                    : runtimeData.jsonMap.message_list?.private_name ?? runtimeData.jsonMap.message_list?.name
                Connector.send(
                    apiName ?? 'get_chat_history',
                    {
                        group_id: type === 'group' ? chatId : undefined,
                        user_id: type !== 'group' ? chatId : undefined,
                        message_id: 0,
                        count: 5,
                    },
                    echo,
                )
                Connector.waitReturn(echo)
                    .then(async (raw: any) => {
                        const parsed = getMsgData('message_list', raw, msgPath.message_list)
                        const list = await getMessageList(parsed)
                        const fullMsg = list?.find((m: any) => String(m.message_id) === String(msgId))
                        const fullRec = fullMsg?.message?.find((s: any) => s?.type === 'record')
                        if (fullRec?.file && data?.message) {
                            data.message.forEach((s: any) => {
                                if (s?.type === 'record' && !s?.file) {
                                    s.file = fullRec.file
                                    s.url = fullRec.url ?? s.url
                                    s.path = fullRec.path ?? s.path
                                    s.base64 = fullRec.base64 ?? s.base64
                                }
                            })
                            logger.debug('[Voice] 已补全 record 字段')
                        } else {
                            logger.debug(`[Voice] 历史补全失败：消息数 ${Array.isArray(list) ? list.length : 0}`)
                        }
                    })
                    .catch(() => {
                        logger.debug('[Voice] 历史补全异常')
                    })
            }
        }

        // 通知判定预处理 ============================================
        // 对于其他不在消息里标记 atme、atall 的处理
        if (data.atme == undefined || data.atall == undefined) {
            data.message.forEach((item: any) => {
                if (item.type == 'at' && item.qq == loginId) {
                    data.atme = true
                }
            })
        }
        // 临时会话名字的特殊处理
        if (data.sub_type === 'group') {
            data.sender.nickname = data.sender.user_id
        }
        // 检查群组有没有开启通知
        let isGroupNotice = false
        if (data.message_type === 'group') {
            const noticeInfo = Option.get('notice_group') ?? {}
            const list = noticeInfo[runtimeData.loginInfo.uin]
            if (list) {
                isGroupNotice = list.indexOf(id) >= 0
            }
        }

        // 群收纳箱 ============================================
        if (runtimeData.sysConfig.bubble_sort_user) {
            // 刷新群收纳箱列表
            let getGroup = runtimeData.baseOnMsgList.get(Number(id))
            // ( 如果 是群组消息 && 群组没有开启通知 && 不是置顶的 ) 这种情况下将群消息添加到群收纳盒中
            if (!getGroup) {
                const getList = runtimeData.userList.filter((item) => {
                    return item.group_id === id
                })
                getGroup = getList[0]
            }
            if (getGroup) {
                getGroup.message_id = data.message_id
                const name = data.sender.card && data.sender.card !== '' ? data.sender.card : data.sender.nickname
                getGroup.raw_msg = `<span class="reply-name">${name}</span>: ${getMsgRawTxt(data)}`
                getGroup.raw_msg_base = getMsgRawTxt(data, false)
                getGroup.time = getViewTime(Number(data.time))
                runtimeData.baseOnMsgList.set(Number(id), getGroup)
            }
        }

        const get = [...runtimeData.baseOnMsgList.keys()].filter((item) => {
            return (
                Number(id) === item || Number(info.target_id) === item
            )
        })

        // 通知判定 ============================================
        // eslint-disable-next-line max-len
        // (发送者不是自己 && (在特别关心列表里 || 发送者不是群组 || 开启了群组通知模式 || 群组 AT
        //      || 群组 AT 全体 || 群组开启了通知)) 这些情况需要进行新消息处理
        if (
            sender != loginId &&
            sender != 0 &&
            (isImportant ||
                data.message_type !== 'group' ||
                runtimeData.sysConfig.group_notice_type != 'none' ||
                data.atme ||
                data.atall ||
                isGroupNotice)
        ) {
            logger.add(LogType.DEBUG, '通知判定：', {
                notShow: id !== showId,
                notFocus: !document.hasFocus(),
                hidden: document.hidden,
                isImportant: isImportant
            })
            // (发送者没有被打开 || 窗口没有焦点 || 窗口被最小化 || 在特别关心列表里) 这些情况需要进行消息通知
            if (
                runtimeData.sysConfig.group_notice_type == 'all' ||
                id !== showId ||
                !document.hasFocus() ||
                document.hidden ||
                isImportant
            ) {
                // 准备消息内容
                let raw = getMsgRawTxt(data, false)
                raw = raw === '' ? data.raw_message : raw
                logger.add(
                    LogType.INFO,
                    `新消息通知（${data.message_type ?? 'unknown'}，${Array.isArray(data.message) ? data.message.length : 0} 个消息段）`,
                    undefined,
                    true,
                )
                if (data.group_name === undefined) {
                    // 检查消息内是否有群名，去列表里寻找
                    runtimeData.userList.forEach((item) => {
                        if (item.group_id == data.group_id) {
                            data.group_name = item.group_name
                        }
                    })
                }
                const msgInfo = {
                    base_type: 'msg',

                    title: data.group_name ?? data.sender.nickname,
                    body:
                        data.message_type === 'group' ? data.sender.nickname + ':' + raw : raw,
                    tag: `${id}/${data.message_id}`,
                    icon:
                        data.message_type === 'group' ? `https://p.qlogo.cn/gh/${id}/${id}/0` : `https://q1.qlogo.cn/g?b=qq&s=0&nk=${id}`,
                    image: undefined as any,
                    type: data.group_id ? 'group' : 'user',
                    is_important: isImportant,
                } as NotifyInfo
                data.message.forEach((item: MsgItemElem) => {
                    // 如果消息有图片，追加第一张图片
                    if (item.type === 'image' && msgInfo.image === undefined) {
                        msgInfo.image = item.url
                    }
                })
                // 发送消息
                if (Option.get('close_notice') !== true) {
                    new Notify().notify(msgInfo)
                }
            }
            // 如果发送者不在消息列表里，将它添加到消息列表里
            if (get.length > 0) {
                // 如果消息子类是 group，那么是临时消息，需要进行特殊处理
                if (data.sub_type === 'group') {
                    // 手动创建一个用户信息，因为临时消息的用户不在用户列表里
                    const user = {
                        user_id: sender,
                        // 因为临时消息没有返回昵称
                        nickname: app.config.globalProperties.$t('临时会话'),
                        remark: data.sender.user_id,
                        new_msg: true,
                        message_id: data.message_id,
                        raw_msg: data.raw_message,
                        time: data.time,
                        group_id: data.sender.group_id,
                        group_name: '',
                    } as UserFriendElem & UserGroupElem
                    runtimeData.baseOnMsgList.set(Number(sender), user)
                } else {
                    const getList = runtimeData.userList.filter((item) => {
                        return item.user_id === id || item.group_id === id
                    })

                    const showUser = getList[0]
                    const formatted = formatMessageData(data, data.message_type === 'group')
                    Object.assign(showUser, formatted)
                    runtimeData.baseOnMsgList.set(Number(id), showUser)
                }
            }
            if (id !== showId) {
                const user = runtimeData.baseOnMsgList.get(id)
                if (user) {
                    if (!user.new_msg) {
                        user.new_msg = true
                        runtimeData.newMsgCount++
                    }
                    runtimeData.baseOnMsgList.set(id, user)
                }
            }
        }



        // 消息列表 ============================================
        // 刷新消息列表
        if (!runtimeData.sysConfig.bubble_sort_user && data.message_type === 'group') {
            const getList = runtimeData.userList.filter((item) => {
                return item.group_id === id
            })
            if (getList.length === 1) {
                const showGroup = getList[0]
                const formatted = formatMessageData(data, true)
                Object.assign(showGroup, formatted)
                runtimeData.baseOnMsgList.set(Number(id), showGroup)
            }
        }
        // 刷新消息
        if (get.length > 0) {
            const item = runtimeData.baseOnMsgList.get(Number(id))
            if (item) {
                item.message_id = data.message_id
                if (data.message_type === 'group') {
                    const name =
                        data.sender.card && data.sender.card !== '' ? data.sender.card : data.sender.nickname
                    item.raw_msg = `<span class="reply-name">${name}</span>: ${getMsgRawTxt(data)}`
                } else {
                    item.raw_msg = getMsgRawTxt(data)
                }
                item.time = getViewTime(Number(data.time))
                if (id != showId) {
                    if (data.atme) { item.highlight = $t('[有人@你]') }
                    if (data.atall) { item.highlight = $t('[@全体]') }
                    if (isImportant) { item.highlight = $t('[特別关心]') }
                }
                runtimeData.baseOnMsgList.set(Number(id), item)
            }
        }
    }
}

/**
 * 刷新系统通知和其他内容，给系统通知响应用的
 */
function updateSysInfo(
    _: string,
    __: { [key: string]: any },
    echoList: string[],
) {
    const flag = echoList[1]
    // 从系统通知列表里删除这条消息
    if (flag !== undefined) {
        const index = runtimeData.systemNoticesList?.findIndex((item: any) => {
            return item.flag == flag
        })
        if (index !== -1) {
            runtimeData.systemNoticesList?.splice(index, 1)
        }
    }
}

// ==============================================================

function formatMessageData(data: any, isGroup: boolean) {
    const sender = data?.sender ?? {}
    const name = sender.card && sender.card !== '' ? sender.card : sender.nickname ?? ''

    return {
        message_id: data?.message_id,
        raw_msg: isGroup && name ? `<span class="reply-name">${name}</span>: ${getMsgRawTxt(data)}` : getMsgRawTxt(data),
        time: getViewTime(Number(data?.time)),
        raw_msg_base: getMsgRawTxt(data, false)
    }
}

const baseRuntime = {
    plantform: {} as any,
    tags: {
        firstLoad: false,
        canLoadHistory: true,
        loadHistoryFail: false,
        historyBeforeTime: undefined,
        historyLoadToken: '',
        openSideBar: true,
        showGroupAssist: false,
        viewer: { index: 0 },
        msgType: BotMsgType.Array,
        isElectron: false,
        isCapacitor: false,
        connectSsl: false,
        classes: [],
        darkMode: false,
        deeperDarkMode: false,
        default_face_path: '',
    },
    watch: {
        backTimes: 0,
        chatImgVersion: 0,
        historyLoadSummaryEvent: undefined as undefined | {
            token: string
            chatId: number
            serverMessages: number
            serverImages: number
        },
    },
    chatInfo: {
        show: { type: '', id: 0, name: '', avatar: '' },
        info: {
            group_info: {},
            user_info: {},
            me_info: {},
            group_members: [],
            group_files: {},
            group_sub_files: {},
            jin_info: {
                list: [] as { [key: string]: any }[],
                pages: 0,
            },
        },
    },
    pageView: {
        chatView: markRaw(
            defineAsyncComponent(() => import('@renderer/pages/Chat.vue')),
        ),
        msgView: markRaw(
            defineAsyncComponent(
                () => import('@renderer/components/MsgBody.vue'),
            ),
        ),
    },
    userList: [],
    showList: [],
    systemNoticesList: undefined,
    baseOnMsgList: new Map<number, UserFriendElem & UserGroupElem>(),
    newMsgCount: 0,
    onMsgList: [],
    groupAssistList: [],
    loginInfo: {},
    botInfo: {},
    sysConfig: {},
    messageList: [],
    composerDrafts: new Map(),
    popBoxList: [],
    mergeMsgStack: [],
    fileUploadPending: null,
    fileUploadChatId: -1,
    fileUploadProgress: -1,
    fileUploadName: '',
    inch: getInch(),
}

export const runtimeData: RunTimeDataElem = reactive(baseRuntime)

// 重置 Runtime，但是保留应用设置之类已经加载好的应用内容
export function resetRimtime(resetAll = false) {
    runtimeData.botInfo = reactive([])
    runtimeData.watch = reactive(baseRuntime.watch)
    firstHeartbeatTime = -1
    heartbeatTime = -1
    if (resetAll) {
        runtimeData.chatInfo = reactive(baseRuntime.chatInfo)
        runtimeData.userList = reactive([])
        runtimeData.showList = reactive([])
        runtimeData.systemNoticesList = reactive([])
        runtimeData.baseOnMsgList = reactive(new Map())
        runtimeData.onMsgList = reactive([])
        runtimeData.groupAssistList = reactive([])
        runtimeData.loginInfo = reactive([])
        runtimeData.messageList = reactive([])
        runtimeData.composerDrafts = reactive(new Map())
    }
}
