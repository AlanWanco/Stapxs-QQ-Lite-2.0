use std::collections::HashMap;
use tauri::{command, AppHandle, State};
use tauri_plugin_store::StoreBuilder;
use serde_json::Value as JsonValue;
use crate::commands::db::DbState;

#[command]
pub fn opt_get_system_info() -> HashMap<String, [String; 2]> {
    let tauri_version = tauri::VERSION.to_string();
    let mut data = HashMap::new();
    data.insert(String::from("tauri"), [String::from("Tauri Version   "), tauri_version]);
    return data;
}

#[command]
pub fn opt_store(app: AppHandle, state: State<DbState>, key: String, value: String) -> Result<(), String> {
    let store =
        StoreBuilder::new(&app, ".settings.dat").build().map_err(|e| e.to_string())?;
    store.set(key, value);
    sync_local_history_state(&state, store.get("enable_local_history"));
    Ok(())
}

#[command]
pub fn opt_save_all(app: AppHandle, state: State<DbState>, data: HashMap<String, JsonValue>) -> Result<(), String> {
    let store =
        StoreBuilder::new(&app, ".settings.dat").build().map_err(|e| e.to_string())?;
    for (key, value) in data {
        store.set(key, value);
    }
    sync_local_history_state(&state, store.get("enable_local_history"));
    Ok(())
}

#[command]
pub fn opt_get_all(app: AppHandle) -> Result<HashMap<String, String>, String> {
    let store =
        StoreBuilder::new(&app, ".settings.dat").build().map_err(|e| e.to_string())?;
    let data = store.entries();
    let mut result = HashMap::new();
    for (key, value) in data {
        result.insert(key, value.to_string());
    }
    Ok(result)
}

#[command]
pub fn opt_get(app: AppHandle, data: String) -> Result<String, String> {
    let store =
        StoreBuilder::new(&app, ".settings.dat").build().map_err(|e| e.to_string())?;
    let entries = store.entries();
    let value = entries
        .iter()
        .find(|(key, _)| key == &data)
        .map(|(_, v)| v.to_string())
        .unwrap_or_default();
    Ok(value)
}

#[command]
pub fn opt_clear_all(app: AppHandle, state: State<DbState>) -> Result<(), String> {
    let store =
        StoreBuilder::new(&app, ".settings.dat").build().map_err(|e| e.to_string())?;
    store.clear();
    sync_local_history_state(&state, store.get("enable_local_history"));
    Ok(())
}

fn sync_local_history_state(state: &State<DbState>, value: Option<serde_json::Value>) {
    let enabled = value
        .as_ref()
        .and_then(|v| v.as_bool().or_else(|| v.as_str().map(|s| s == "true")))
        .unwrap_or(false);

    if let Ok(mut inner) = state.0.lock() {
        inner.enabled = enabled;
        if !enabled {
            inner.conn = None;
        }
    }
}
