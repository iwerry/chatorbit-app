use crate::storage::Result;
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    io::{Read, Write},
    sync::{Arc, Mutex},
};
use tauri::Emitter;

struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
}
#[derive(Default)]
pub struct Terminals {
    sessions: Arc<Mutex<HashMap<String, Session>>>,
}
fn shell() -> String {
    if cfg!(windows) {
        "powershell.exe".into()
    } else {
        std::env::var("SHELL").unwrap_or_else(|_| {
            if cfg!(target_os = "macos") {
                "/bin/zsh".into()
            } else {
                "/bin/bash".into()
            }
        })
    }
}
fn size(value: &Value) -> PtySize {
    PtySize {
        rows: value["rows"].as_u64().unwrap_or(24).clamp(1, 500) as u16,
        cols: value["cols"].as_u64().unwrap_or(100).clamp(1, 1000) as u16,
        pixel_width: 0,
        pixel_height: 0,
    }
}
impl Terminals {
    pub fn handle(
        &self,
        window: &tauri::WebviewWindow,
        channel: &str,
        args: &[Value],
    ) -> Option<Result<Value>> {
        if !channel.starts_with("term:") {
            return None;
        }
        let a = args.first().cloned().unwrap_or(Value::Null);
        Some((|| {
            if channel == "term:info" {
                return Ok(
                    json!({"shell":shell(),"platform":std::env::consts::OS,"available":true,"error":null}),
                );
            }
            if channel == "term:create" {
                let id = a["id"].as_str().ok_or("Missing terminal ID")?.to_string();
                let key = format!("{}:{id}", window.label());
                let mut sessions = self.sessions.lock().map_err(|e| e.to_string())?;
                if sessions.contains_key(&key) {
                    return Err("Terminal already exists.".into());
                }
                let pty = native_pty_system()
                    .openpty(size(&a))
                    .map_err(|e| e.to_string())?;
                let executable = shell();
                let mut command = CommandBuilder::new(&executable);
                command.arg(if cfg!(windows) { "-NoLogo" } else { "-l" });
                command.env("TERM", "xterm-256color");
                command.env("COLORTERM", "truecolor");
                command.env("TERM_PROGRAM", "Orbi");
                let cwd = a["cwd"]
                    .as_str()
                    .map(std::path::PathBuf::from)
                    .filter(|p| p.is_dir())
                    .or_else(|| directories::BaseDirs::new().map(|d| d.home_dir().to_path_buf()))
                    .ok_or("No home directory")?;
                command.cwd(&cwd);
                let mut child = pty
                    .slave
                    .spawn_command(command)
                    .map_err(|e| e.to_string())?;
                let pid = child.process_id();
                let killer = child.clone_killer();
                let mut reader = pty.master.try_clone_reader().map_err(|e| e.to_string())?;
                let writer = pty.master.take_writer().map_err(|e| e.to_string())?;
                drop(pty.slave);
                sessions.insert(
                    key.clone(),
                    Session {
                        master: pty.master,
                        writer,
                        killer,
                    },
                );
                drop(sessions);
                let output_window = window.clone();
                let output_id = id.clone();
                std::thread::spawn(move || {
                    let mut chunk = [0u8; 8192];
                    let mut pending = Vec::new();
                    loop {
                        let count = match reader.read(&mut chunk) {
                            Ok(0) | Err(_) => break,
                            Ok(n) => n,
                        };
                        pending.extend_from_slice(&chunk[..count]);
                        let valid = match std::str::from_utf8(&pending) {
                            Ok(_) => pending.len(),
                            Err(error) => error.valid_up_to(),
                        };
                        if valid > 0 {
                            let text = String::from_utf8_lossy(&pending[..valid]).to_string();
                            pending.drain(..valid);
                            if output_window
                                .emit("term:data", json!([output_id, text]))
                                .is_err()
                            {
                                break;
                            }
                        }
                        if pending.len() > 4 {
                            let text = String::from_utf8_lossy(&pending).to_string();
                            pending.clear();
                            let _ = output_window.emit("term:data", json!([output_id, text]));
                        }
                    }
                });
                let sessions = self.sessions.clone();
                let exit_window = window.clone();
                std::thread::spawn(move || {
                    let code = child.wait().map(|s| s.exit_code()).unwrap_or(1);
                    if let Ok(mut map) = sessions.lock() {
                        map.remove(&key);
                    }
                    let _ = exit_window.emit("term:exit", json!([id, code]));
                });
                return Ok(json!({"pid":pid,"shell":executable,"cwd":cwd}));
            }
            let id = a.as_str().ok_or("Missing terminal ID")?;
            let key = format!("{}:{id}", window.label());
            let mut sessions = self.sessions.lock().map_err(|e| e.to_string())?;
            let session = sessions.get_mut(&key).ok_or("Terminal session not found")?;
            match channel {
                "term:write" => {
                    let data = args
                        .get(1)
                        .and_then(Value::as_str)
                        .ok_or("Missing terminal input")?;
                    session
                        .writer
                        .write_all(data.as_bytes())
                        .map_err(|e| e.to_string())?;
                    session.writer.flush().map_err(|e| e.to_string())?;
                }
                "term:resize" => {
                    let value = json!({"cols":args.get(1),"rows":args.get(2)});
                    session
                        .master
                        .resize(size(&value))
                        .map_err(|e| e.to_string())?;
                }
                "term:kill" => {
                    session.killer.kill().map_err(|e| e.to_string())?;
                }
                _ => return Err("Unsupported terminal operation".into()),
            }
            Ok(Value::Null)
        })())
    }
    pub fn close_window(&self, label: &str) {
        if let Ok(mut sessions) = self.sessions.lock() {
            let prefix = format!("{label}:");
            for (key, session) in sessions.iter_mut() {
                if key.starts_with(&prefix) {
                    let _ = session.killer.kill();
                }
            }
        }
    }
}
