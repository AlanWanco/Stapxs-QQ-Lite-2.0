#[cfg(target_os = "macos")]
pub use macos::get_or_create_db_key;

#[cfg(target_os = "windows")]
pub use windows_cred::get_or_create_db_key;

#[cfg(target_os = "linux")]
pub use linux_secret::get_or_create_db_key;

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
#[allow(dead_code)]
pub fn get_or_create_db_key() -> Result<String, String> {
    unreachable!("平台不支持安全存储密钥方案")
}

#[cfg(target_os = "windows")]
mod windows_cred {
    use windows::Win32::Security::Credentials::{
        CredFree, CredReadW, CredWriteW, CREDENTIALW,
        CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC,
    };
    use windows::core::PWSTR;

    const TARGET: &str = "cn.stapxs.qqweb/db_encryption_key";
    const USERNAME: &str = "stapxs-qq-lite";
    const ERROR_NOT_FOUND_HR: i32 = 0x80070490u32 as i32;

    pub fn get_or_create_db_key() -> Result<String, String> {
        match read_credential() {
            Ok(key) => return Ok(key),
            Err(e) => {
                if !e.starts_with("NOT_FOUND:") {
                    return Err(format!("凭据管理器读取失败：{}", e));
                }
            }
        }

        let key = generate_key();
        write_credential(&key)?;
        Ok(key)
    }

    fn read_credential() -> Result<String, String> {
        let target_wide: Vec<u16> = TARGET.encode_utf16().chain(std::iter::once(0)).collect();
        let mut pcred: *mut CREDENTIALW = std::ptr::null_mut();

        unsafe {
            CredReadW(
                windows::core::PCWSTR(target_wide.as_ptr()),
                CRED_TYPE_GENERIC,
                Some(0),
                &mut pcred,
            )
            .map_err(|e| {
                if e.code().0 == ERROR_NOT_FOUND_HR {
                    format!("NOT_FOUND:{}", e)
                } else {
                    format!("CredReadW 失败（HRESULT {:#010x}）：{}", e.code().0, e)
                }
            })?;

            if pcred.is_null() {
                return Err("NOT_FOUND:凭据指针为空".to_string());
            }

            let cred = &*pcred;
            let blob_size = cred.CredentialBlobSize as usize;
            let blob = std::slice::from_raw_parts(cred.CredentialBlob, blob_size);
            let key = String::from_utf8(blob.to_vec())
                .map_err(|e| format!("密钥编码无效：{}", e))?;

            CredFree(pcred as *const _);
            Ok(key)
        }
    }

    fn write_credential(key: &str) -> Result<(), String> {
        let target_wide: Vec<u16> = TARGET.encode_utf16().chain(std::iter::once(0)).collect();
        let username_wide: Vec<u16> = USERNAME.encode_utf16().chain(std::iter::once(0)).collect();
        let blob = key.as_bytes();

        let cred = CREDENTIALW {
            Flags: windows::Win32::Security::Credentials::CRED_FLAGS(0),
            Type: CRED_TYPE_GENERIC,
            TargetName: PWSTR(target_wide.as_ptr() as *mut u16),
            Comment: PWSTR::null(),
            LastWritten: windows::Win32::Foundation::FILETIME::default(),
            CredentialBlobSize: blob.len() as u32,
            CredentialBlob: blob.as_ptr() as *mut u8,
            Persist: CRED_PERSIST_LOCAL_MACHINE,
            AttributeCount: 0,
            Attributes: std::ptr::null_mut(),
            TargetAlias: PWSTR::null(),
            UserName: PWSTR(username_wide.as_ptr() as *mut u16),
        };

        unsafe {
            CredWriteW(&cred, 0)
                .map_err(|e| format!("CredWriteW 失败（HRESULT {:#010x}）：{}", e.code().0, e))?;
        }
        Ok(())
    }

    fn generate_key() -> String {
        use rand::RngCore;
        let mut buf = [0u8; 32];
        rand::rng().fill_bytes(&mut buf);
        buf.iter().map(|b| format!("{:02x}", b)).collect()
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use security_framework::passwords::{get_generic_password, set_generic_password};

    const SERVICE: &str = "cn.stapxs.qqweb";
    const ACCOUNT: &str = "db_encryption_key";

    pub fn get_or_create_db_key() -> Result<String, String> {
        match get_generic_password(SERVICE, ACCOUNT) {
            Ok(bytes) => {
                let key = String::from_utf8(bytes)
                    .map_err(|e| format!("钥匙串密钥编码无效：{}", e))?;
                return Ok(key);
            }
            Err(e) => {
                if e.code() != -25300 {
                    return Err(format!("钥匙串读取失败（code {}）：{}", e.code(), e));
                }
            }
        }

        let key = generate_key();
        set_generic_password(SERVICE, ACCOUNT, key.as_bytes())
            .map_err(|e| format!("写入钥匙串失败（code {}）：{}", e.code(), e))?;
        Ok(key)
    }

    fn generate_key() -> String {
        use rand::RngCore;
        let mut buf = [0u8; 32];
        rand::rng().fill_bytes(&mut buf);
        buf.iter().map(|b| format!("{:02x}", b)).collect()
    }
}

#[cfg(target_os = "linux")]
mod linux_secret {
    use secret_service::{EncryptionType, SecretService};
    use std::collections::HashMap;

    const LABEL: &str = "Stapxs QQ Lite 数据库密钥";
    const ATTR_APP: &str = "application";
    const ATTR_APP_VAL: &str = "cn.stapxs.qqweb";
    const ATTR_KEY: &str = "key_type";
    const ATTR_KEY_VAL: &str = "db_encryption_key";

    pub fn get_or_create_db_key() -> Result<String, String> {
        match tokio::runtime::Handle::try_current() {
            Ok(handle) => tokio::task::block_in_place(|| handle.block_on(inner())),
            Err(_) => {
                let rt = tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                    .map_err(|e| format!("创建临时 runtime 失败：{}", e))?;
                rt.block_on(inner())
            }
        }
    }

    async fn inner() -> Result<String, String> {
        let ss = SecretService::connect(EncryptionType::Dh)
            .await
            .map_err(|e| format!("连接 Secret Service 失败：{}", e))?;

        let collection = ss
            .get_default_collection()
            .await
            .map_err(|e| format!("获取默认密钥集合失败：{}", e))?;

        if collection
            .is_locked()
            .await
            .map_err(|e| format!("检查锁定状态失败：{}", e))?
        {
            collection
                .unlock()
                .await
                .map_err(|e| format!("解锁密钥集合失败：{}", e))?;
        }

        let attrs: HashMap<&str, &str> = [
            (ATTR_APP, ATTR_APP_VAL),
            (ATTR_KEY, ATTR_KEY_VAL),
        ]
        .iter()
        .cloned()
        .collect();

        let items = collection
            .search_items(attrs.clone())
            .await
            .map_err(|e| format!("搜索密钥条目失败：{}", e))?;
        if let Some(item) = items.first() {
            let secret = item.get_secret().await
                .map_err(|e| format!("读取密钥失败：{}", e))?;
            return String::from_utf8(secret)
                .map_err(|e| format!("密钥编码无效：{}", e));
        }

        let key = generate_key();
        collection
            .create_item(
                LABEL,
                attrs,
                key.as_bytes(),
                true,
                "text/plain",
            )
            .await
            .map_err(|e| format!("创建密钥条目失败：{}", e))?;
        Ok(key)
    }

    fn generate_key() -> String {
        use rand::RngCore;
        let mut buf = [0u8; 32];
        rand::rng().fill_bytes(&mut buf);
        buf.iter().map(|b| format!("{:02x}", b)).collect()
    }
}
