/**
 * 本地历史消息工具（Tauri 平台）
 */

import { backend } from '@renderer/runtime/backend'
import { getMsgRawTxt } from './msgUtil'
import { Logger } from '../base'
import { runtimeData } from '../msg'

const logger = new Logger()

export interface LocalMsgRecord {
    message_id: string
    chat_id: number
    chat_type: string
    sender_id: number
    sender_name: string | null
    seq: number | null
    time: number
    message: string
    raw_message: string | null
    revoked: boolean
}

function isTauriHistoryAvailable(): boolean {
    return backend.type === 'tauri' && runtimeData.sysConfig.enable_local_history === true
}

async function callDbRecordList(
    selfId: string | number,
    command: string,
    payload: Record<string, any>,
    errorTag: string,
): Promise<any[]> {
    if (!isTauriHistoryAvailable()) return []
    try {
        const records: LocalMsgRecord[] = await backend.call(
            undefined,
            command,
            true,
            { selfId: String(selfId), ...payload },
        )
        return (records ?? []).map(deserializeRecord)
    } catch (e) {
        logger.error(e as Error, errorTag)
        return []
    }
}

async function callDb(
    selfId: string | number,
    command: string,
    payload: Record<string, any>,
    fallback: any,
    errorTag: string,
): Promise<any> {
    if (!isTauriHistoryAvailable()) return fallback
    try {
        return await backend.call(
            undefined,
            command,
            true,
            { selfId: String(selfId), ...payload },
        )
    } catch (e) {
        logger.error(e as Error, errorTag)
        return fallback
    }
}

function serializeMsgSegments(segments: any[] | undefined): string {
    try {
        return JSON.stringify(segments ?? [])
    } catch {
        return '[]'
    }
}

function deserializeMsgSegments(serialized: string): any[] {
    try {
        return JSON.parse(serialized)
    } catch {
        return []
    }
}

function computeRawMessage(msg: any): string | null {
    try {
        return getMsgRawTxt(msg) || msg.raw_message || null
    } catch {
        return msg.raw_message ?? null
    }
}

function deriveChatId(selfId: string | number, msgs: any[]): number | undefined {
    const firstMsg = msgs[0]
    let chatId: number | undefined =
        firstMsg?.infoList?.group_id ??
        firstMsg?.group_id ??
        firstMsg?.infoList?.target_id ??
        firstMsg?.target_id
    if (chatId != null) return Number(chatId)

    for (const item of msgs) {
        const senderId = item?.infoList?.sender ?? item?.sender?.user_id ?? item?.user_id
        if (senderId != null && String(senderId) !== String(selfId)) {
            chatId = Number(senderId)
            break
        }
    }
    return chatId
}

export function ensureChatIdOnMsgs(selfId: string | number, msgs: any[]): any[] {
    const chatId = deriveChatId(selfId, msgs)
    if (chatId == null) return msgs

    return msgs.map((item: any) => {
        const nextInfoList = item?.infoList ?? {}
        if (nextInfoList.group_id != null || nextInfoList.target_id != null || item?.group_id != null || item?.target_id != null) {
            return item
        }
        return {
            ...item,
            infoList: {
                ...nextInfoList,
                target_id: chatId,
            },
        }
    })
}

export function msgToRecord(msg: any): LocalMsgRecord | null {
    const messageId = msg.message_id
    if (!messageId) return null

    const chatId: number =
        msg.infoList?.group_id ??
        msg.group_id ??
        msg.infoList?.target_id ??
        msg.target_id
    if (chatId == null) return null

    const chatType: string =
        msg.message_type ?? (msg.group_id != null ? 'group' : 'private')
    const senderId: number =
        msg.infoList?.sender ??
        msg.sender?.user_id ??
        msg.user_id
    if (senderId == null) return null

    const senderName: string | null =
        (msg.sender?.card && msg.sender.card !== '') ? msg.sender.card : (msg.sender?.nickname ?? null)

    return {
        message_id: String(messageId),
        chat_id: Number(chatId),
        chat_type: chatType,
        sender_id: Number(senderId),
        sender_name: senderName,
        seq: msg.seq_id != null ? Number(msg.seq_id) : null,
        time: Number(msg.time),
        message: serializeMsgSegments(msg.message),
        raw_message: computeRawMessage(msg),
        revoked: false,
    }
}

export async function dbSaveMessages(selfId: string | number, msgs: any[]): Promise<void> {
    if (!isTauriHistoryAvailable()) return

    const persistableMsgs = ensureChatIdOnMsgs(selfId, msgs)
    const records: LocalMsgRecord[] = persistableMsgs
        .map(msgToRecord)
        .filter((item): item is LocalMsgRecord => item !== null)

    if (records.length === 0) return

    try {
        await backend.call(undefined, 'db:saveMessages', true, {
            selfId: String(selfId),
            messages: records,
        })
    } catch (e) {
        logger.error(e as Error, '[LocalHistory] dbSaveMessages 失败')
    }
}

export async function saveMessagesWithSideEffects(selfId: string | number, msgs: any[]): Promise<void> {
    const persistableMsgs = ensureChatIdOnMsgs(selfId, msgs)
    await dbSaveMessages(selfId, persistableMsgs)
    if (runtimeData.sysConfig.disable_local_history_image_cache === true) return
    cacheImagesFromMsgs(selfId, persistableMsgs).catch(() => undefined)
}

export async function dbGetLatest(selfId: string | number, chatId: number, n: number): Promise<any[]> {
    return callDbRecordList(selfId, 'db:getLatest', { chatId, n }, '[LocalHistory] dbGetLatest 失败')
}

export async function dbGetBefore(selfId: string | number, chatId: number, messageId: string, n: number): Promise<any[]> {
    return callDbRecordList(selfId, 'db:getBefore', { chatId, messageId, n }, '[LocalHistory] dbGetBefore 失败')
}

export async function dbGetBeforeByTime(selfId: string | number, chatId: number, beforeTime: number, n: number): Promise<any[]> {
    return callDbRecordList(selfId, 'db:getBeforeByTime', { chatId, beforeTime, n }, '[LocalHistory] dbGetBeforeByTime 失败')
}

export async function dbGetAfter(selfId: string | number, chatId: number, messageId: string, n: number): Promise<any[]> {
    return callDbRecordList(selfId, 'db:getAfter', { chatId, messageId, n }, '[LocalHistory] dbGetAfter 失败')
}

export async function dbRevokeMessage(selfId: string | number, messageId: string): Promise<boolean> {
    return callDb(selfId, 'db:revokeMessage', { messageId }, false, '[LocalHistory] dbRevokeMessage 失败')
}

export async function dbSearchMessages(selfId: string | number, chatId: number, query: string): Promise<any[]> {
    if (!isTauriHistoryAvailable() || !query) return []
    return callDbRecordList(selfId, 'db:searchMessages', { chatId, query }, '[LocalHistory] dbSearchMessages 失败')
}

export async function dbGetStats(selfId: string | number): Promise<{ totalMessages: number; imageCount: number; imageCacheBytes: number; dbSizeBytes: number } | null> {
    return callDb(selfId, 'db:getStats', {}, null, '[LocalHistory] dbGetStats 失败')
}

export async function hashUrl(url: string): Promise<string> {
    const data = new TextEncoder().encode(url)
    const buf = await crypto.subtle.digest('SHA-256', data)
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function dbCacheImage(selfId: string | number, urlHash: string, mimeType: string, data: string): Promise<void> {
    if (!isTauriHistoryAvailable()) return
    try {
        await backend.call(undefined, 'db:cacheImage', true, {
            selfId: String(selfId),
            urlHash,
            mimeType,
            data,
        })
    } catch (e) {
        logger.error(e as Error, '[LocalHistory] dbCacheImage 失败')
    }
}

export async function dbGetImage(selfId: string | number, urlHash: string): Promise<{ mimeType: string; data: string } | null> {
    return callDb(selfId, 'db:getImage', { urlHash }, null, '[LocalHistory] dbGetImage 失败')
}

export interface DbClearImagesProgress {
    selfId: string
    total: number
    deleted: number
    batchDeleted: number
    progress: number
    done: boolean
}

export interface DbClearImagesResult {
    total: number
    deleted: number
    batches: number
}

export interface DbExportBackupResult {
    dbPath: string
    deltaMessages: number
    deltaImages: number
    totalMessages: number
    totalImages: number
}

export interface DbImportBackupResult {
    dbPath: string
    importedMessages: number
    importedImages: number
    totalMessages: number
    totalImages: number
}

export async function dbClearImages(
    selfId: string | number,
    onProgress?: (progress: DbClearImagesProgress) => void,
): Promise<DbClearImagesResult> {
    if (!isTauriHistoryAvailable()) {
        return { total: 0, deleted: 0, batches: 0 }
    }

    let unlisten: undefined | (() => void | Promise<void>)
    if (onProgress && backend.type === 'tauri') {
        const { listen } = await import('@tauri-apps/api/event')
        unlisten = await listen<DbClearImagesProgress>('db:clearImagesProgress', (event) => {
            const payload = event.payload
            if (!payload) return
            if (String(payload.selfId) !== String(selfId)) return
            onProgress(payload)
        })
    }

    try {
        const result = await callDb(
            selfId,
            'db:clearImages',
            {},
            { total: 0, deleted: 0, batches: 0 },
            '[LocalHistory] dbClearImages 失败',
        )
        return {
            total: Number(result?.total ?? 0),
            deleted: Number(result?.deleted ?? 0),
            batches: Number(result?.batches ?? 0),
        }
    } finally {
        if (unlisten) await unlisten()
    }
}

export async function dbExportBackup(selfId: string | number, backupDir: string): Promise<DbExportBackupResult | null> {
    if (!isTauriHistoryAvailable() || !backupDir) return null
    return callDb(
        selfId,
        'db:exportBackup',
        { backupDir },
        null,
        '[LocalHistory] dbExportBackup 失败',
    )
}

export async function dbImportBackup(selfId: string | number, backupDbPath: string): Promise<DbImportBackupResult | null> {
    if (!isTauriHistoryAvailable() || !backupDbPath) return null
    return callDb(
        selfId,
        'db:importBackup',
        { backupDbPath },
        null,
        '[LocalHistory] dbImportBackup 失败',
    )
}

async function cacheImagesFromMsgs(selfId: string | number, msgs: any[]): Promise<void> {
    if (!isTauriHistoryAvailable()) return
    const urls = extractImageUrlsFromMsgs(msgs)
    for (const url of urls) {
        try {
            await cacheSingleImage(selfId, url)
        } catch {
            // ignore single image cache error
        }
    }
}

function extractImageUrlsFromMsgs(msgs: any[]): string[] {
    const urls: string[] = []
    for (const msg of msgs) {
        if (!Array.isArray(msg.message)) continue
        for (const seg of msg.message) {
            if (seg.type === 'image' && seg.url && seg.url.startsWith('http')) {
                urls.push(seg.url)
            }
        }
    }
    return urls
}

async function downloadImageViaProxy(url: string): Promise<{ mimeType: string; base64: string } | null> {
    const fetchUrl = backend.proxy ? `http://localhost:${backend.proxy}/proxy?url=${encodeURIComponent(url)}` : url
    const resp = await fetch(fetchUrl)
    if (!resp.ok) return null

    const mimeType = resp.headers.get('Content-Type')?.split(';')[0]?.trim() ?? 'image/jpeg'
    const buffer = await resp.arrayBuffer()
    const bytes = new Uint8Array(buffer)
    let binary = ''
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
    return { mimeType, base64: btoa(binary) }
}

async function cacheSingleImage(selfId: string | number, url: string): Promise<void> {
    const urlHash = await hashUrl(url)
    const existing = await dbGetImage(selfId, urlHash)
    if (existing) return

    const downloaded = await downloadImageViaProxy(url)
    if (!downloaded) return
    await dbCacheImage(selfId, urlHash, downloaded.mimeType, downloaded.base64)
}

function deserializeRecord(record: LocalMsgRecord): any {
    const message = deserializeMsgSegments(record.message)
    const isSelf = record.sender_id === Number(runtimeData.loginInfo.uin)
    const postType = isSelf ? 'message_sent' : 'message'
    const isGroup = record.chat_type === 'group'
    const sender = isGroup
        ? { user_id: record.sender_id, card: record.sender_name ?? '', nickname: record.sender_name ?? '' }
        : { user_id: record.sender_id, card: '', nickname: record.sender_name ?? '' }
    const infoList = {
        message_id: record.message_id,
        private_id: isGroup ? undefined : record.chat_id,
        group_id: isGroup ? record.chat_id : undefined,
        target_id: isGroup ? undefined : record.chat_id,
        sender: record.sender_id,
    }

    return {
        post_type: postType,
        message_id: record.message_id,
        message_type: record.chat_type,
        ...(isGroup ? { group_id: record.chat_id } : { user_id: record.chat_id }),
        sender,
        time: record.time,
        message,
        infoList,
        raw_message: record.raw_message ?? '',
        revoke: record.revoked,
        ...(record.seq != null ? { message_seq: record.seq, seq_id: record.seq } : {}),
        _from_local_db: true,
    }
}
