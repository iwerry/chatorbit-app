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
// A shell installed on this machine that the terminal can open.
#[derive(Clone)]
struct ShellInfo {
    id: &'static str,
    name: &'static str,
    path: String,
    args: Vec<&'static str>,
}
fn existing(path: impl Into<std::path::PathBuf>) -> Option<String> {
    let path = path.into();
    path.is_file().then(|| path.to_string_lossy().into_owned())
}
// Looks a program up on PATH (like `where`/`which`), without running it.
fn on_path(program: &str) -> Option<String> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path).find_map(|dir| existing(dir.join(program)))
}
#[cfg(windows)]
fn detect() -> Vec<ShellInfo> {
    use std::path::PathBuf;
    let mut list = Vec::new();
    let system = PathBuf::from(std::env::var("SystemRoot").unwrap_or_else(|_| String::from("C:/Windows")));
    let ps = existing(system.join("System32").join("WindowsPowerShell").join("v1.0").join("powershell.exe")).unwrap_or_else(|| "powershell.exe".into());
    list.push(ShellInfo { id: "powershell", name: "PowerShell", path: ps, args: vec!["-NoLogo"] });
    let program_files = PathBuf::from(std::env::var("ProgramFiles").unwrap_or_else(|_| String::from("C:/Program Files")));
    if let Some(path) = on_path("pwsh.exe").or_else(|| existing(program_files.join("PowerShell").join("7").join("pwsh.exe"))) {
        list.push(ShellInfo { id: "pwsh", name: "PowerShell 7", path, args: vec!["-NoLogo"] });
    }
    let cmd = std::env::var("ComSpec").ok().and_then(existing).unwrap_or_else(|| "cmd.exe".into());
    list.push(ShellInfo { id: "cmd", name: "Command Prompt", path: cmd, args: vec![] });
    let git_bash = existing(program_files.join("Git").join("bin").join("bash.exe")).or_else(|| {
        // Git installed elsewhere: <git>/cmd/git.exe -> <git>/bin/bash.exe
        on_path("git.exe").and_then(|git| {
            let root = std::path::Path::new(&git).parent()?.parent()?.to_path_buf();
            existing(root.join("bin").join("bash.exe"))
        })
    });
    if let Some(path) = git_bash {
        list.push(ShellInfo { id: "gitbash", name: "Git Bash", path, args: vec!["--login", "-i"] });
    }
    // WSL counts only when a Linux distribution is installed (wsl.exe exists on many machines without one).
    if let Some(path) = existing(system.join("System32").join("wsl.exe")) {
        let has_distro = {
            use std::os::windows::process::CommandExt;
            std::process::Command::new(&path)
                .args(["--list", "--quiet"])
                .creation_flags(0x0800_0000)
                .output()
                .map(|o| o.status.success() && o.stdout.iter().any(|b| b.is_ascii_alphanumeric()))
                .unwrap_or(false)
        };
        if has_distro {
            list.push(ShellInfo { id: "wsl", name: "WSL (Linux)", path, args: vec![] });
        }
    }
    list
}
#[cfg(not(windows))]
fn detect() -> Vec<ShellInfo> {
    let mut list = Vec::new();
    let default = std::env::var("SHELL").ok();
    let known: [(&'static str, &'static str, &'static str); 4] = [("zsh", "zsh", "zsh"), ("bash", "Bash", "bash"), ("fish", "fish", "fish"), ("sh", "sh", "sh")];
    for (id, name, program) in known {
        let path = ["/bin", "/usr/bin", "/usr/local/bin", "/opt/homebrew/bin"].iter().find_map(|d| existing(format!("{d}/{program}"))).or_else(|| on_path(program));
        if let Some(path) = path {
            list.push(ShellInfo { id, name, path, args: vec!["-l"] });
        }
    }
    // The person's login shell first.
    if let Some(default) = default {
        if let Some(i) = list.iter().position(|s| default.ends_with(&format!("/{}", s.id))) {
            let s = list.remove(i);
            list.insert(0, s);
        }
    }
    if list.is_empty() {
        list.push(ShellInfo { id: "sh", name: "sh", path: "/bin/sh".into(), args: vec![] });
    }
    list
}
fn shells() -> &'static [ShellInfo] {
    static SHELLS: std::sync::OnceLock<Vec<ShellInfo>> = std::sync::OnceLock::new();
    SHELLS.get_or_init(detect)
}
fn shell_for(id: Option<&str>) -> ShellInfo {
    let list = shells();
    id.and_then(|id| list.iter().find(|s| s.id == id)).unwrap_or(&list[0]).clone()
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
                let list: Vec<Value> = shells().iter().map(|s| json!({"id":s.id,"name":s.name,"path":s.path})).collect();
                return Ok(
                    json!({"shell":shells()[0].name,"shells":list,"platform":std::env::consts::OS,"available":true,"error":null}),
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
                let chosen = shell_for(a["shell"].as_str());
                let executable = chosen.name.to_string();
                let mut command = CommandBuilder::new(&chosen.path);
                for arg in &chosen.args {
                    command.arg(arg);
                }
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
