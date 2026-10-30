mod chat;
mod chat_stream;
mod cloud;
mod crud;
mod library;
mod mcp;
mod media;
mod runtime;
mod storage;
mod studio;
mod terminal;
mod web;
mod window;
use serde_json::{json, Value};
use storage::{now, uid, Result, Storage};
use tauri::{Manager, State};

struct Backend {
    mcp: mcp::Mcp,
    terminals: terminal::Terminals,
    db: Storage,
    cloud: cloud::Cloud,
    chats:
        tokio::sync::Mutex<std::collections::HashMap<String, tokio_util::sync::CancellationToken>>,
    root: std::path::PathBuf,
    renders:
        tokio::sync::Mutex<std::collections::HashMap<String, tokio_util::sync::CancellationToken>>,
}

#[tauri::command]
async fn dispatch(
    channel: String,
    args: Vec<Value>,
    backend: State<'_, Backend>,
    window: tauri::WebviewWindow,
) -> Result<Value> {
    let a = args.first().cloned().unwrap_or(Value::Null);
    let b = args.get(1).cloned().unwrap_or(Value::Null);
    let db = &backend.db;
    if let Some(result) = runtime::handle(&backend, &channel).await {
        return result;
    }
    if let Some(result) = studio::handle(&backend, &channel, &args).await {
        return result;
    }
    if let Some(result) = library::handle(&backend, &channel, &args) {
        return result;
    }
    if channel == "web:search" {
        return web::search(
            &backend,
            a.as_str().ok_or("Missing search query")?,
            b["read"].as_u64().unwrap_or(3) as usize,
        )
        .await;
    }
    if channel == "cloud:cancelVideo" {
        let key = format!(
            "{}:{}",
            window.label(),
            a.as_str().ok_or("Missing render ID")?
        );
        if let Some(token) = backend.renders.lock().await.get(&key) {
            token.cancel();
        }
        return Ok(Value::Null);
    }
    if channel == "cloud:video" {
        let id = a["jobId"].as_str().map(String::from).unwrap_or_else(uid);
        let key = format!("{}:{id}", window.label());
        let cancel = tokio_util::sync::CancellationToken::new();
        backend
            .renders
            .lock()
            .await
            .insert(key.clone(), cancel.clone());
        let result = tokio::select! {_=cancel.cancelled()=>Err("Stopped.".into()),result=media::handle(&backend,&channel,&args)=>result.unwrap_or_else(||Err("Video handler unavailable".into()))};
        backend.renders.lock().await.remove(&key);
        return result;
    }
    if let Some(result) = backend.mcp.handle(&backend, &window, &channel, &args).await {
        return result;
    }
    if let Some(result) = window::handle(&backend, &window, &channel, &args).await {
        return result;
    }
    if let Some(result) = backend.terminals.handle(&window, &channel, &args) {
        return result;
    }
    if let Some(result) = chat::handle(&backend, &window, &channel, &args).await {
        return result;
    }
    if let Some(result) = media::handle(&backend, &channel, &args).await {
        return result;
    }
    if let Some(result) = backend.cloud.handle(&channel, &a).await {
        return result;
    }
    if let Some(result) = crud::handle(db, &channel, &args) {
        return result;
    }
    match channel.as_str() {
        "app:info" => Ok(json!({"version":env!("CARGO_PKG_VERSION"), "platform":if cfg!(target_os="macos") {"darwin"} else if cfg!(windows) {"win32"} else {"linux"},"userName":db.setting("userName", json!("there"))?,"dataDir":backend.root,"author":"Daniel Rodrigues","company":"Draft Creative Studio Ltda","tagline":"Creative Design & Software Development"})),
        "settings:get" => db.setting(a.as_str().ok_or("Setting key must be text")?, b),
        "settings:set" => db.set_setting(a.as_str().ok_or("Setting key must be text")?, &b),
        "workflows:get" => {
            let rows = db.query("SELECT data FROM workflows WHERE id=?", &[a])?;
            rows.first().and_then(|r| r["data"].as_str()).map(|s| serde_json::from_str(s).map_err(|e| e.to_string())).unwrap_or(Ok(Value::Null))
        },
        "workflows:save" => {
            db.execute("INSERT INTO workflows(id,name,data,updated_at) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,data=excluded.data,updated_at=excluded.updated_at", &[a,b,json!(args.get(2).unwrap_or(&Value::Null).to_string()),json!(now())])?;
            Ok(Value::Null)
        },
        "projects:list" | "conversations:list" | "memories:list" | "agents:list" | "skills:list" | "boards:list" | "teams:list" | "harness:list" => {
            let table = match channel.as_str() { "projects:list"=>"projects", "conversations:list"=>"conversations", "memories:list"=>"memories", "agents:list"=>"agents", "skills:list"=>"skills", "boards:list"=>"boards", "teams:list"=>"teams", _=>"harnesses" };
            let mut rows = db.query(&format!("SELECT * FROM {table} ORDER BY created_at DESC"), &[])?;
            if table == "skills" {
                for row in &mut rows {
                    for (key, fallback) in [("files", json!([])), ("tests", json!({})), ("meta", json!({}))] {
                        row[key] = row[key].as_str().and_then(|text| serde_json::from_str(text).ok()).unwrap_or(fallback);
                    }
                }
            }
            Ok(json!(rows))
        },
        "projects:create" | "boards:create" | "memories:add" => {
            let (table, field) = match channel.as_str() { "projects:create"=>("projects","name"),"boards:create"=>("boards","name"), _=>("memories","content") };
            let id = uid(); let timestamp = now();
            db.execute(&format!("INSERT INTO {table}(id,{field},created_at) VALUES(?,?,?)"), &[json!(id),a.clone(),json!(timestamp)])?;
            let mut row = json!({"id":id,"created_at":timestamp}); row[field]=a; Ok(row)
        },
        "messages:list" => Ok(json!(db.query("SELECT * FROM messages WHERE conversation_id=? ORDER BY created_at ASC", &[a])?)),
        "bookmarks:list" => Ok(json!(db.query("SELECT * FROM messages WHERE bookmarked=1 ORDER BY created_at DESC", &[])?)),
        _ => Err(format!("Native migration incomplete: {channel}. This build must not be distributed as a complete replacement yet.")),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let root = app.path().app_data_dir()?;
            std::fs::create_dir_all(root.join("media"))?;
            let db = Storage::open(&root.join("orbi.db")).map_err(std::io::Error::other)?;
            app.manage(Backend {
                db,
                root,
                cloud: cloud::Cloud::new(),
                chats: tokio::sync::Mutex::new(std::collections::HashMap::new()),
                renders: tokio::sync::Mutex::new(std::collections::HashMap::new()),
                terminals: terminal::Terminals::default(),
                mcp: mcp::Mcp::default(),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![dispatch])
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                if let Some(state) = window.try_state::<Backend>() {
                    state.terminals.close_window(window.label());
                    let label = format!("{}:", window.label());
                    let handle = window.app_handle().clone();
                    tauri::async_runtime::spawn(async move {
                        let state = handle.state::<Backend>();
                        for tasks in [&state.chats, &state.renders] {
                            let tasks = tasks.lock().await;
                            for (key, token) in tasks.iter() {
                                if key.starts_with(&label) {
                                    token.cancel();
                                }
                            }
                        }
                    });
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("Unable to start Orbi native runtime");
}
