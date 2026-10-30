use crate::{
    storage::{uid, Result},
    Backend,
};
use serde_json::{json, Value};
use std::{collections::HashMap, path::PathBuf, process::Stdio};
use tauri::Emitter;
use tokio::{
    io::{AsyncRead, AsyncReadExt},
    sync::Mutex,
};
use tokio_util::sync::CancellationToken;

#[derive(Default)]
pub struct Jobs(pub Mutex<HashMap<String, CancellationToken>>);

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn shell_preserves_unicode_errors_and_exit_status() {
        let script = if cfg!(windows) {
            "Write-Output 'olá café'; [Console]::Error.WriteLine('diagnóstico'); exit 7"
        } else {
            "printf 'olá café\\n'; printf 'diagnóstico\\n' >&2; exit 7"
        };
        let output = command_process(script).output().await.unwrap();
        assert_eq!(output.status.code(), Some(7));
        assert!(String::from_utf8_lossy(&output.stdout).contains("olá café"));
        assert!(String::from_utf8_lossy(&output.stderr).contains("diagnóstico"));
    }
    #[tokio::test]
    async fn running_shell_can_be_stopped_without_waiting_for_completion() {
        let mut child = command_process(if cfg!(windows) {
            "Start-Sleep -Seconds 60"
        } else {
            "sleep 60"
        })
        .kill_on_drop(true)
        .spawn()
        .unwrap();
        stop_tree(child.id()).await;
        let _ = child.start_kill();
        let status = tokio::time::timeout(std::time::Duration::from_secs(5), child.wait())
            .await
            .unwrap()
            .unwrap();
        assert!(!status.success());
    }
}
async fn read_output<R: AsyncRead + Unpin>(
    mut input: R,
    window: tauri::WebviewWindow,
    id: String,
    stream: &'static str,
) -> String {
    let mut output = Vec::new();
    let mut pending = Vec::new();
    let mut chunk = [0; 8192];
    while let Ok(n) = input.read(&mut chunk).await {
        if n == 0 {
            break;
        }
        output.extend_from_slice(&chunk[..n]);
        pending.extend_from_slice(&chunk[..n]);
        let end = match std::str::from_utf8(&pending) {
            Ok(_) => pending.len(),
            Err(error) if error.error_len().is_none() => error.valid_up_to(),
            Err(_) => pending.len(),
        };
        if end > 0 {
            let text = String::from_utf8_lossy(&pending[..end]).into_owned();
            pending.drain(..end);
            let _ = window.emit(
                "term:job",
                json!([{"id":id,"phase":"data","stream":stream,"text":text}]),
            );
        }
        if output.len() > 64000 {
            output.drain(..output.len() - 64000);
        }
    }
    if !pending.is_empty() {
        let _=window.emit("term:job",json!([{"id":id,"phase":"data","stream":stream,"text":String::from_utf8_lossy(&pending)}]));
    }
    String::from_utf8_lossy(&output).into_owned()
}
fn command_process(command: &str) -> tokio::process::Command {
    let shell = if cfg!(windows) {
        "powershell.exe"
    } else if cfg!(target_os = "macos") {
        "/bin/zsh"
    } else {
        "/bin/bash"
    };
    let mut process = tokio::process::Command::new(shell);
    if cfg!(windows) {
        use base64::Engine;
        let script=format!("$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false); $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User') + ';' + $env:Path; $global:LASTEXITCODE = 0; & {{\n{command}\n}}; if (-not $?) {{ exit 1 }}; exit $LASTEXITCODE");
        let bytes = script
            .encode_utf16()
            .flat_map(u16::to_le_bytes)
            .collect::<Vec<_>>();
        process.args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-EncodedCommand",
            &base64::engine::general_purpose::STANDARD.encode(bytes),
        ]);
    } else {
        process.args(["-lc", command]);
    }
    #[cfg(windows)]
    process.creation_flags(0x08000000);
    #[cfg(unix)]
    process.process_group(0);
    process
}

pub async fn run(
    backend: &Backend,
    window: &tauri::WebviewWindow,
    command: &str,
    cwd: PathBuf,
    seconds: u64,
    parent: &CancellationToken,
) -> Result<String> {
    if parent.is_cancelled() {
        return Err("Stopped.".into());
    }
    if command.trim().is_empty() || command.len() > 64000 {
        return Err("Command must contain 1–64000 characters.".into());
    }
    let id = uid();
    let key = format!("{}:{id}", window.label());
    let cancel = CancellationToken::new();
    let mut process = command_process(command);
    let shell = process
        .as_std()
        .get_program()
        .to_string_lossy()
        .into_owned();
    process
        .current_dir(&cwd)
        .env("TERM", "dumb")
        .env("NO_COLOR", "1")
        .env("PYTHONIOENCODING", "utf-8")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let mut child = process.spawn().map_err(|e| e.to_string())?;
    let pid = child.id();
    backend
        .jobs
        .0
        .lock()
        .await
        .insert(key.clone(), cancel.clone());
    let _ = window.emit(
        "term:job",
        json!([{"id":id,"phase":"start","shell":shell,"cwd":cwd,"command":command}]),
    );
    let stdout = tokio::spawn(read_output(
        child.stdout.take().ok_or("No stdout")?,
        window.clone(),
        id.clone(),
        "stdout",
    ));
    let stderr = tokio::spawn(read_output(
        child.stderr.take().ok_or("No stderr")?,
        window.clone(),
        id.clone(),
        "stderr",
    ));
    let mut timed_out = false;
    let mut cancelled = false;
    let status = tokio::select! {
        s=child.wait()=>s,
        _=async {tokio::select!{_=cancel.cancelled()=>(),_=parent.cancelled()=>()}}=>{cancelled=true;stop_tree(pid).await;let _=child.start_kill();child.wait().await},
        _=tokio::time::sleep(std::time::Duration::from_secs(seconds.clamp(1,1800)))=>{timed_out=true;stop_tree(pid).await;let _=child.start_kill();child.wait().await}
    };
    backend.jobs.0.lock().await.remove(&key);
    let code = status.ok().and_then(|s| s.code()).unwrap_or(1);
    let stdout = tokio::time::timeout(std::time::Duration::from_secs(5), stdout)
        .await
        .ok()
        .and_then(|r| r.ok())
        .unwrap_or_default();
    let stderr = tokio::time::timeout(std::time::Duration::from_secs(5), stderr)
        .await
        .ok()
        .and_then(|r| r.ok())
        .unwrap_or_default();
    let _ = window.emit(
        "term:job",
        json!([{"id":id,"phase":"exit","code":code,"cancelled":cancelled,"timedOut":timed_out}]),
    );
    let mut result = json!({"jobId":id,"exit_code":code,"stdout":stdout,"stderr":stderr,"cancelled":cancelled,"timedOut":timed_out});
    if cancelled || timed_out || code != 0 {
        result["error"] = json!(if timed_out {
            "Command timed out.".to_string()
        } else if cancelled {
            "Stopped by the user.".to_string()
        } else {
            format!("Command exited with code {code}.")
        });
    }
    Ok(result.to_string())
}
async fn stop_tree(pid: Option<u32>) {
    if let Some(pid) = pid {
        #[cfg(windows)]
        {
            let mut p = tokio::process::Command::new("taskkill.exe");
            p.args(["/PID", &pid.to_string(), "/T", "/F"])
                .creation_flags(0x08000000);
            let _ = p.output().await;
        }
        #[cfg(unix)]
        {
            // Every task creates its own group; cancel that group's descendants too.
            unsafe {
                libc::kill(-(pid as libc::pid_t), libc::SIGKILL);
            }
        }
    }
}
pub async fn cancel(backend: &Backend, window: &tauri::WebviewWindow, id: &str) -> Result<Value> {
    if let Some(token) = backend
        .jobs
        .0
        .lock()
        .await
        .get(&format!("{}:{id}", window.label()))
    {
        token.cancel();
    }
    Ok(Value::Null)
}
