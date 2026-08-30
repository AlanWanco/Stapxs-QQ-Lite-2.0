use base64::{engine::general_purpose, Engine as _};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use log::{debug, info};
use rand::RngCore;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_store::StoreBuilder;

pub struct DbState(pub Mutex<DbStateInner>);

pub struct DbStateInner {
    pub data_dir: PathBuf,
    pub enabled: bool,
    pub conn: Option<Connection>,
}

impl DbState {
    pub fn new(data_dir: PathBuf, enabled: bool) -> Self {
        Self(Mutex::new(DbStateInner {
            data_dir,
            enabled,
            conn: None,
        }))
    }

    fn with_conn<T, F>(&self, f: F) -> Result<T, String>
    where
        F: FnOnce(&Connection) -> Result<T, String>,
    {
        let mut inner = self.0.lock().map_err(|e| e.to_string())?;

        if !inner.enabled {
            return Err("本地历史消息存储未启用".to_string());
        }

        if inner.conn.is_none() {
            let conn = open_db(inner.data_dir.clone()).map_err(|e| e.to_string())?;
            inner.conn = Some(conn);
            info!("SQLite 数据库懒加载初始化完成");
        }

        let conn = inner
            .conn
            .as_ref()
            .ok_or_else(|| "无法获取数据库连接".to_string())?;

        f(conn)
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MsgRecord {
    pub message_id: String,
    pub chat_id: i64,
    pub chat_type: String,
    pub sender_id: i64,
    pub sender_name: Option<String>,
    pub seq: Option<i64>,
    pub time: i64,
    pub message: String,
    pub raw_message: Option<String>,
    pub revoked: bool,
}

fn get_db_key(db_path: &std::path::Path) -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        match crate::commands::keychain::get_or_create_db_key() {
            Ok(key) => return Ok(key),
            Err(e) => log::warn!("钥匙串读取失败，尝试本地回退密钥：{}", e),
        }
    }
    #[cfg(target_os = "windows")]
    {
        match crate::commands::keychain::get_or_create_db_key() {
            Ok(key) => return Ok(key),
            Err(e) => log::warn!("Windows 凭据管理器读取失败，尝试本地回退密钥：{}", e),
        }
    }
    #[cfg(target_os = "linux")]
    {
        match crate::commands::keychain::get_or_create_db_key() {
            Ok(key) => return Ok(key),
            Err(e) => log::warn!("Linux Secret Service 读取失败，尝试本地回退密钥：{}", e),
        }
    }

    let fallback_path = db_path.with_extension("dbkey");
    get_or_create_fallback_db_key(&fallback_path)
}

fn get_or_create_fallback_db_key(path: &std::path::Path) -> Result<String, String> {
    if let Ok(existing) = fs::read_to_string(path) {
        let key = existing.trim().to_string();
        if !key.is_empty() {
            return Ok(key);
        }
    }

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("创建密钥目录失败：{}", e))?;
    }

    let mut buf = [0u8; 32];
    rand::rng().fill_bytes(&mut buf);
    let key: String = buf.iter().map(|b| format!("{:02x}", b)).collect();
    fs::write(path, &key).map_err(|e| format!("写入回退密钥失败：{}", e))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
    }

    Ok(key)
}

pub fn open_db(data_dir: PathBuf) -> rusqlite::Result<Connection> {
    std::fs::create_dir_all(&data_dir).ok();
    let db_path = data_dir.join("messages.db");
    open_or_recreate(db_path)
}

fn open_or_recreate(db_path: std::path::PathBuf) -> rusqlite::Result<Connection> {
    match try_open_encrypted(&db_path) {
        Ok(conn) => Ok(conn),
        Err(e) => {
            log::warn!("无法以加密模式打开 {:?}（{}）", db_path, e);
            std::process::exit(1);
        }
    }
}

fn try_open_encrypted(db_path: &std::path::Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(db_path)?;
    let key = get_db_key(db_path)
        .map_err(|e| rusqlite::Error::InvalidParameterName(format!("数据库密钥不可用：{}", e)))?;
    conn.execute_batch(&format!("PRAGMA key = '{}';", key))?;
    conn.execute_batch("SELECT count(*) FROM sqlite_master;")?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;

    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS messages (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            self_id     TEXT    NOT NULL,
            message_id  TEXT    NOT NULL,
            chat_id     INTEGER NOT NULL,
            chat_type   TEXT    NOT NULL,
            sender_id   INTEGER NOT NULL,
            sender_name TEXT,
            seq         INTEGER,
            time        INTEGER NOT NULL,
            message     TEXT    NOT NULL,
            raw_message TEXT,
            revoked     INTEGER NOT NULL DEFAULT 0,
            created_at  INTEGER NOT NULL,
            UNIQUE(self_id, message_id)
        );

        CREATE INDEX IF NOT EXISTS idx_messages_chat
            ON messages(self_id, chat_id, time, id);",
    )?;

    let _ = conn.execute_batch("ALTER TABLE messages ADD COLUMN seq INTEGER;");

    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS images (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            self_id    TEXT    NOT NULL,
            url_hash   TEXT    NOT NULL,
            mime_type  TEXT    NOT NULL DEFAULT 'image/jpeg',
            data       BLOB    NOT NULL,
            created_at INTEGER NOT NULL,
            UNIQUE(self_id, url_hash)
        );",
    )?;

    Ok(conn)
}

#[tauri::command]
pub fn db_save_messages(state: State<DbState>, self_id: String, messages: Vec<MsgRecord>) -> Result<usize, String> {
    state.with_conn(|conn| {
        let now = chrono::Utc::now().timestamp_millis();
        let mut inserted = 0usize;

        for msg in &messages {
            let n = conn.execute(
                "INSERT INTO messages
                    (self_id, message_id, chat_id, chat_type,
                     sender_id, sender_name, seq, time, message,
                     raw_message, revoked, created_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)
                 ON CONFLICT(self_id, message_id) DO UPDATE SET
                    chat_id=excluded.chat_id,
                    chat_type=excluded.chat_type,
                    sender_id=excluded.sender_id,
                    sender_name=excluded.sender_name,
                    seq=excluded.seq,
                    time=excluded.time,
                    message=excluded.message,
                    raw_message=excluded.raw_message,
                    revoked=excluded.revoked",
                params![
                    self_id,
                    msg.message_id,
                    msg.chat_id,
                    msg.chat_type,
                    msg.sender_id,
                    msg.sender_name,
                    msg.seq,
                    msg.time,
                    msg.message,
                    msg.raw_message,
                    msg.revoked as i32,
                    now,
                ],
            ).map_err(|e| e.to_string())?;
            inserted += n;
        }
        debug!("成功保存 {} 条消息", inserted);
        Ok(inserted)
    })
}

#[tauri::command]
pub fn db_get_latest(state: State<DbState>, self_id: String, chat_id: i64, n: i64) -> Result<Vec<MsgRecord>, String> {
    state.with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT message_id, chat_id, chat_type, sender_id, sender_name,
                    seq, time, message, raw_message, revoked
             FROM messages
             WHERE self_id = ?1 AND chat_id = ?2 AND revoked = 0
             ORDER BY time DESC, id DESC
             LIMIT ?3",
        ).map_err(|e| e.to_string())?;

        let mut list: Vec<MsgRecord> = stmt.query_map(params![self_id, chat_id, n], row_to_record)
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        list.reverse();
        Ok(list)
    })
}

#[tauri::command]
pub fn db_get_before(state: State<DbState>, self_id: String, chat_id: i64, message_id: String, n: i64) -> Result<Vec<MsgRecord>, String> {
    state.with_conn(|conn| {
        let anchor = get_anchor(conn, &self_id, &message_id)
            .ok_or_else(|| format!("message_id '{}' not found in local db", message_id))?;
        let mut stmt = conn.prepare(
            "SELECT message_id, chat_id, chat_type, sender_id, sender_name,
                    seq, time, message, raw_message, revoked
             FROM messages
             WHERE self_id = ?1 AND chat_id = ?2 AND revoked = 0
               AND (time < ?3 OR (time = ?3 AND id < ?4))
             ORDER BY time DESC, id DESC
             LIMIT ?5",
        ).map_err(|e| e.to_string())?;

        let mut list: Vec<MsgRecord> = stmt.query_map(params![self_id, chat_id, anchor.0, anchor.1, n], row_to_record)
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        list.reverse();
        Ok(list)
    })
}

#[tauri::command]
pub fn db_get_before_by_time(state: State<DbState>, self_id: String, chat_id: i64, before_time: i64, n: i64) -> Result<Vec<MsgRecord>, String> {
    if before_time <= 0 || n <= 0 {
        return Ok(vec![]);
    }
    state.with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT message_id, chat_id, chat_type, sender_id, sender_name,
                    seq, time, message, raw_message, revoked
             FROM messages
             WHERE self_id = ?1 AND chat_id = ?2 AND revoked = 0
               AND time <= ?3
             ORDER BY time DESC, id DESC
             LIMIT ?4",
        ).map_err(|e| e.to_string())?;

        let mut list: Vec<MsgRecord> = stmt.query_map(params![self_id, chat_id, before_time, n], row_to_record)
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        list.reverse();
        Ok(list)
    })
}

#[tauri::command]
pub fn db_get_after(state: State<DbState>, self_id: String, chat_id: i64, message_id: String, n: i64) -> Result<Vec<MsgRecord>, String> {
    state.with_conn(|conn| {
        let anchor = get_anchor(conn, &self_id, &message_id)
            .ok_or_else(|| format!("message_id '{}' not found in local db", message_id))?;
        let mut stmt = conn.prepare(
            "SELECT message_id, chat_id, chat_type, sender_id, sender_name,
                    seq, time, message, raw_message, revoked
             FROM messages
             WHERE self_id = ?1 AND chat_id = ?2 AND revoked = 0
               AND (time > ?3 OR (time = ?3 AND id > ?4))
             ORDER BY time ASC, id ASC
             LIMIT ?5",
        ).map_err(|e| e.to_string())?;

        let list: Vec<MsgRecord> = stmt.query_map(params![self_id, chat_id, anchor.0, anchor.1, n], row_to_record)
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        Ok(list)
    })
}

#[tauri::command]
pub fn db_search_messages(state: State<DbState>, self_id: String, chat_id: i64, query: String) -> Result<Vec<MsgRecord>, String> {
    state.with_conn(|conn| {
        let pattern = format!("%{}%", query);
        let mut stmt = conn.prepare(
            "SELECT message_id, chat_id, chat_type, sender_id, sender_name,
                    seq, time, message, raw_message, revoked
             FROM messages
             WHERE self_id = ?1 AND chat_id = ?2 AND revoked = 0
               AND raw_message LIKE ?3
             ORDER BY time ASC, id ASC",
        ).map_err(|e| e.to_string())?;

        let list: Vec<MsgRecord> = stmt.query_map(params![self_id, chat_id, pattern], row_to_record)
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        Ok(list)
    })
}

#[tauri::command]
pub fn db_revoke_message(state: State<DbState>, self_id: String, message_id: String) -> Result<bool, String> {
    state.with_conn(|conn| {
        let n = conn.execute(
            "UPDATE messages SET revoked = 1 WHERE self_id = ?1 AND message_id = ?2",
            params![self_id, message_id],
        ).map_err(|e| e.to_string())?;
        Ok(n > 0)
    })
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbStats {
    pub total_messages: i64,
    pub image_count: i64,
    pub image_cache_bytes: i64,
    pub db_size_bytes: u64,
}

#[tauri::command]
pub fn db_get_stats(state: State<DbState>, _app_handle: tauri::AppHandle, self_id: String) -> Result<DbStats, String> {
    // 先取 data_dir（with_conn 会持锁，不能在里面再锁 state.0，否则死锁）
    let data_dir = {
        let inner = state.0.lock().map_err(|e| e.to_string())?;
        inner.data_dir.clone()
    };

    state.with_conn(|conn| {
        let total: i64 = conn.query_row(
            "SELECT COUNT(*) FROM messages WHERE self_id = ?1 AND revoked = 0",
            params![self_id],
            |r| r.get(0),
        ).unwrap_or(0);

        let (image_count, image_cache_bytes): (i64, i64) = conn.query_row(
            "SELECT COUNT(*), COALESCE(SUM(LENGTH(data)), 0) FROM images WHERE self_id = ?1",
            params![self_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        ).unwrap_or((0, 0));

        let db_size = std::fs::metadata(data_dir.join("messages.db")).map(|m| m.len()).unwrap_or(0);

        Ok(DbStats {
            total_messages: total,
            image_count,
            image_cache_bytes,
            db_size_bytes: db_size,
        })
    })
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CachedImage {
    pub mime_type: String,
    pub data: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DbClearImagesProgress {
    pub self_id: String,
    pub total: i64,
    pub deleted: i64,
    pub batch_deleted: i64,
    pub progress: f64,
    pub done: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbClearImagesResult {
    pub total: i64,
    pub deleted: i64,
    pub batches: i64,
}

#[tauri::command]
pub fn db_cache_image(state: State<DbState>, self_id: String, url_hash: String, mime_type: String, data: String) -> Result<(), String> {
    state.with_conn(|conn| {
        let bytes = general_purpose::STANDARD.decode(&data).map_err(|e| e.to_string())?;
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;
        conn.execute(
            "INSERT OR IGNORE INTO images (self_id, url_hash, mime_type, data, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![self_id, url_hash, mime_type, bytes, now],
        ).map_err(|e| e.to_string())?;
        Ok(())
    })
}

#[tauri::command]
pub fn db_get_image(state: State<DbState>, self_id: String, url_hash: String) -> Result<Option<CachedImage>, String> {
    state.with_conn(|conn| {
        let result: rusqlite::Result<(String, Vec<u8>)> = conn.query_row(
            "SELECT mime_type, data FROM images WHERE self_id = ?1 AND url_hash = ?2",
            params![self_id, url_hash],
            |row| Ok((row.get(0)?, row.get(1)?)),
        );
        match result {
            Ok((mime_type, bytes)) => Ok(Some(CachedImage {
                mime_type,
                data: general_purpose::STANDARD.encode(&bytes),
            })),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    })
}

#[tauri::command]
pub fn db_clear_images(state: State<DbState>, app_handle: AppHandle, self_id: String) -> Result<DbClearImagesResult, String> {
    state.with_conn(|conn| {
        let batch_size = 500i64;
        let total: i64 = conn.query_row(
            "SELECT COUNT(*) FROM images WHERE self_id = ?1",
            params![self_id],
            |r| r.get(0),
        ).unwrap_or(0);

        let _ = app_handle.emit(
            "db:clearImagesProgress",
            DbClearImagesProgress {
                self_id: self_id.clone(),
                total,
                deleted: 0,
                batch_deleted: 0,
                progress: if total == 0 { 100.0 } else { 0.0 },
                done: total == 0,
            },
        );

        let mut deleted = 0i64;
        let mut batches = 0i64;

        while deleted < total {
            let batch_deleted = conn.execute(
                "DELETE FROM images WHERE id IN (SELECT id FROM images WHERE self_id = ?1 LIMIT ?2)",
                params![self_id, batch_size],
            ).map_err(|e| e.to_string())? as i64;
            if batch_deleted == 0 {
                break;
            }

            deleted += batch_deleted;
            batches += 1;
            let progress = if total > 0 {
                ((deleted as f64 / total as f64) * 100.0).min(100.0)
            } else {
                100.0
            };

            let _ = app_handle.emit(
                "db:clearImagesProgress",
                DbClearImagesProgress {
                    self_id: self_id.clone(),
                    total,
                    deleted,
                    batch_deleted,
                    progress,
                    done: false,
                },
            );
        }

        let _ = app_handle.emit(
            "db:clearImagesProgress",
            DbClearImagesProgress {
                self_id: self_id.clone(),
                total,
                deleted,
                batch_deleted: 0,
                progress: 100.0,
                done: true,
            },
        );

        Ok(DbClearImagesResult { total, deleted, batches })
    })
}

fn get_anchor(conn: &Connection, self_id: &str, message_id: &str) -> Option<(i64, i64)> {
    conn.query_row(
        "SELECT time, id FROM messages WHERE self_id = ?1 AND message_id = ?2",
        params![self_id, message_id],
        |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
    ).ok()
}

fn row_to_record(row: &rusqlite::Row) -> rusqlite::Result<MsgRecord> {
    Ok(MsgRecord {
        message_id: row.get(0)?,
        chat_id: row.get(1)?,
        chat_type: row.get(2)?,
        sender_id: row.get(3)?,
        sender_name: row.get(4)?,
        seq: row.get(5)?,
        time: row.get(6)?,
        message: row.get(7)?,
        raw_message: row.get(8)?,
        revoked: row.get::<_, i64>(9)? != 0,
    })
}

/// 设置本地历史存储目录，并把现有数据库文件迁移过去。
/// 仅由用户主动触发，不掺入 opt_save_all。
#[tauri::command]
pub fn db_set_storage_path(app: AppHandle, state: State<DbState>, new_dir: String) -> Result<String, String> {
    let new_dir = PathBuf::from(new_dir.trim());
    if new_dir.as_os_str().is_empty() {
        return Err("存储目录不能为空".to_string());
    }
    fs::create_dir_all(&new_dir).map_err(|e| format!("创建存储目录失败：{}", e))?;

    let migrated = {
        let mut inner = state.0.lock().map_err(|e| e.to_string())?;
        let old_dir = inner.data_dir.clone();
        if old_dir == new_dir {
            return Ok(new_dir.join("messages.db").to_string_lossy().to_string());
        }
        // 关闭现有连接，避免文件被占用
        inner.conn = None;

        // 迁移数据库相关文件
        for name in ["messages.db", "messages.db-wal", "messages.db-shm", "messages.dbkey"] {
            let src = old_dir.join(name);
            if !src.exists() {
                continue;
            }
            let dst = new_dir.join(name);
            if dst.exists() {
                continue;
            }
            match fs::rename(&src, &dst) {
                Ok(_) => {}
                Err(_) => {
                    fs::copy(&src, &dst).map_err(|e| format!("迁移文件 {} 失败：{}", name, e))?;
                    fs::remove_file(&src).ok();
                }
            }
        }
        inner.data_dir = new_dir.clone();
        true
    };

    if migrated {
        // 保存配置，下次启动沿用
        let store = StoreBuilder::new(&app, ".settings.dat").build().map_err(|e| e.to_string())?;
        store.set("local_history_path", serde_json::Value::String(new_dir.to_string_lossy().to_string()));
        store.save().map_err(|e| format!("保存配置失败：{}", e))?;
        info!("本地历史存储目录已迁移到 {:?}", new_dir);
    }

    Ok(new_dir.join("messages.db").to_string_lossy().to_string())
}
