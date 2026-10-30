use crate::{
    storage::{uid, Result},
    Backend,
};
use rmcp::{
    service::RunningService,
    transport::{
        streamable_http_client::StreamableHttpClientTransportConfig, StreamableHttpClientTransport,
        TokioChildProcess,
    },
    RoleClient, ServiceExt,
};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::Arc,
};
use tauri::Emitter;
use tokio::sync::{oneshot, Mutex};

type Client = RunningService<RoleClient, ()>;
#[derive(Default)]
pub struct Mcp {
    clients: Mutex<HashMap<String, Arc<Client>>>,
    errors: Mutex<HashMap<String, String>>,
    approvals: Mutex<HashMap<String, (String, oneshot::Sender<bool>)>>,
}
fn defaults() -> Vec<Value> {
    vec![
        json!({"id":"orbi-core","name":"Orbi Core","type":"builtin","enabled":true,"description":"Time, web pages and memory"}),
        json!({"id":"orbi-files","name":"Workspace Files","type":"builtin","enabled":true,"description":"Files inside your selected workspace"}),
        json!({"id":"orbi-terminal","name":"Terminal Commands","type":"builtin","enabled":true,"description":"Shell commands; asks before execution"}),
        json!({"id":"deepwiki","name":"DeepWiki","type":"http","url":"https://mcp.deepwiki.com/mcp","enabled":true}),
        json!({"id":"context7","name":"Context7","type":"http","url":"https://mcp.context7.com/mcp","enabled":true}),
    ]
}
fn profiles() -> Result<Vec<Value>> {
    match keyring::Entry::new("com.orbix.orbi", "mcp-servers")
        .map_err(|_| "Credential store is unavailable")?
        .get_password()
    {
        Ok(text) => {
            serde_json::from_str(&text).map_err(|_| "Saved MCP configuration is invalid".into())
        }
        Err(keyring::Error::NoEntry) => Ok(defaults()),
        Err(_) => Err("Unable to open secure MCP configuration.".into()),
    }
}
fn save_profiles(profiles: &[Value]) -> Result<()> {
    keyring::Entry::new("com.orbix.orbi", "mcp-servers")
        .map_err(|_| "Credential store is unavailable")?
        .set_password(&serde_json::to_string(profiles).map_err(|e| e.to_string())?)
        .map_err(|_| "Unable to save MCP configuration securely.".into())
}
fn qualified(server: &str, name: &str) -> String {
    format!("{server}__{name}")
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '_' || c == '-' {
                c
            } else {
                '_'
            }
        })
        .take(64)
        .collect()
}
fn tool(name: &str, description: &str, properties: Value, required: Vec<&str>) -> Value {
    json!({"name":name,"description":description,"inputSchema":{"type":"object","properties":properties,"required":required}})
}
fn builtin(id: &str) -> Vec<Value> {
    match id {
        "orbi-core" => vec![
            tool(
                "current_time",
                "Get the current UTC time",
                json!({}),
                vec![],
            ),
            tool(
                "read_webpage",
                "Read a public HTTPS web page",
                json!({"url":{"type":"string"}}),
                vec!["url"],
            ),
            tool(
                "save_memory",
                "Save a user-requested memory",
                json!({"content":{"type":"string"}}),
                vec!["content"],
            ),
        ],
        "orbi-files" => vec![
            tool(
                "list_files",
                "List files in the workspace",
                json!({"path":{"type":"string"}}),
                vec![],
            ),
            tool(
                "read_file",
                "Read a UTF-8 workspace file",
                json!({"path":{"type":"string"}}),
                vec!["path"],
            ),
            tool(
                "write_file",
                "Write a workspace file, with approval",
                json!({"path":{"type":"string"},"content":{"type":"string"}}),
                vec!["path", "content"],
            ),
        ],
        "orbi-terminal" => vec![tool(
            "run_command",
            "Run a shell command after user approval",
            json!({"command":{"type":"string"},"cwd":{"type":"string","description":"Relative directory inside the Orbi workspace"},"timeoutSeconds":{"type":"integer","minimum":1,"maximum":1800}}),
            vec!["command"],
        )],
        _ => vec![],
    }
}
pub fn workspace(backend: &Backend) -> Result<PathBuf> {
    let saved = backend.db.setting("workspaceDir", Value::Null)?;
    let root = saved
        .as_str()
        .map(PathBuf::from)
        .or_else(|| {
            directories::UserDirs::new().and_then(|d| d.document_dir().map(|p| p.join("Orbi")))
        })
        .unwrap_or_else(|| backend.root.join("workspace"));
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    root.canonicalize().map_err(|e| e.to_string())
}
fn safe_path(root: &Path, path: &str, write: bool) -> Result<PathBuf> {
    let input = Path::new(path);
    if input.components().any(|c| {
        matches!(
            c,
            std::path::Component::ParentDir
                | std::path::Component::RootDir
                | std::path::Component::Prefix(_)
        )
    }) {
        return Err("Use a relative path inside the workspace.".into());
    }
    let candidate = root.join(input);
    let resolved = if write && !candidate.exists() {
        let parent = candidate
            .parent()
            .ok_or("Missing file parent")?
            .canonicalize()
            .map_err(|e| e.to_string())?;
        parent.join(candidate.file_name().ok_or("Missing file name")?)
    } else {
        candidate.canonicalize().map_err(|e| e.to_string())?
    };
    if !resolved.starts_with(root) {
        return Err("The path resolves outside the workspace.".into());
    }
    Ok(resolved)
}

impl Mcp {
    async fn connect(&self, server: &Value) -> Result<Arc<Client>> {
        let id = server["id"].as_str().ok_or("Missing server ID")?;
        if let Some(client) = self.clients.lock().await.get(id).cloned() {
            return Ok(client);
        }
        let connect = async {
            let service = if server["type"] == "stdio" {
                let executable = server["command"].as_str().ok_or("Missing MCP command")?;
                let mut command = tokio::process::Command::new(executable);
                command.kill_on_drop(true);
                if let Some(args) = server["args"].as_array() {
                    for arg in args {
                        command.arg(arg.as_str().ok_or("MCP arguments must be text")?);
                    }
                }
                if let Some(env) = server["env"].as_object() {
                    for (key, value) in env {
                        command.env(
                            key,
                            value
                                .as_str()
                                .ok_or("MCP environment values must be text")?,
                        );
                    }
                }
                #[cfg(windows)]
                command.creation_flags(0x08000000);
                ().serve(TokioChildProcess::new(command).map_err(|e| e.to_string())?)
                    .await
                    .map_err(|e| e.to_string())?
            } else {
                let url = server["url"].as_str().ok_or("Missing MCP URL")?;
                let parsed = url::Url::parse(url).map_err(|_| "Invalid MCP URL")?;
                if !matches!(parsed.scheme(), "https" | "http") {
                    return Err("MCP URL must use HTTP or HTTPS".into());
                }
                let mut config = StreamableHttpClientTransportConfig::default();
                config.uri = Arc::from(url);
                if let Some(headers) = server["headers"].as_object() {
                    for (key, value) in headers {
                        config.custom_headers.insert(
                            key.parse().map_err(|_| "Invalid MCP header")?,
                            value
                                .as_str()
                                .ok_or("Invalid MCP header value")?
                                .parse()
                                .map_err(|_| "Invalid MCP header value")?,
                        );
                    }
                }
                ().serve(StreamableHttpClientTransport::from_config(config))
                    .await
                    .map_err(|e| e.to_string())?
            };
            Ok::<_, String>(Arc::new(service))
        };
        let result = tokio::time::timeout(std::time::Duration::from_secs(20), connect)
            .await
            .map_err(|_| "MCP connection timed out".to_string())?;
        match result {
            Ok(client) => {
                self.clients
                    .lock()
                    .await
                    .insert(id.to_string(), client.clone());
                self.errors.lock().await.remove(id);
                Ok(client)
            }
            Err(error) => {
                self.errors
                    .lock()
                    .await
                    .insert(id.to_string(), error.clone());
                Err(error)
            }
        }
    }
    pub async fn tools(&self, allowed: Option<&Vec<Value>>) -> Result<Vec<Value>> {
        let mut output = Vec::new();
        for server in profiles()? {
            let id = server["id"].as_str().ok_or("Invalid server ID")?;
            if !server["enabled"].as_bool().unwrap_or(false)
                || allowed.is_some_and(|a| !a.iter().any(|x| x == id))
            {
                continue;
            }
            let list = if server["type"] == "builtin" {
                builtin(id)
            } else {
                match self.connect(&server).await {
                    Ok(client) => client
                        .list_all_tools()
                        .await
                        .map_err(|e| e.to_string())?
                        .iter()
                        .map(|tool| serde_json::to_value(tool).unwrap_or(Value::Null))
                        .collect(),
                    Err(_) => continue,
                }
            };
            for item in list {
                let name = item["name"].as_str().ok_or("Invalid MCP tool name")?;
                output.push(json!({"server":id,"original":name,"name":qualified(id,name),"description":item["description"],"parameters":item["inputSchema"]}));
            }
        }
        Ok(output)
    }
    async fn status(&self) -> Result<Value> {
        let mut result = Vec::new();
        for mut server in profiles()? {
            let id = server["id"].as_str().unwrap_or("").to_string();
            let enabled = server["enabled"].as_bool().unwrap_or(false);
            let connected =
                server["type"] == "builtin" || self.clients.lock().await.contains_key(&id);
            server["status"] = json!(if !enabled {
                "disabled"
            } else if connected {
                "connected"
            } else {
                "error"
            });
            server["error"] = if !enabled || connected {
                Value::Null
            } else {
                json!(self
                    .errors
                    .lock()
                    .await
                    .get(&id)
                    .cloned()
                    .unwrap_or_else(|| "Connect this server before use.".into()))
            };
            let tools = if server["type"] == "builtin" {
                builtin(&id)
            } else if let Some(client) = self.clients.lock().await.get(&id).cloned() {
                client
                    .list_all_tools()
                    .await
                    .map(|v| {
                        v.iter()
                            .map(|t| serde_json::to_value(t).unwrap_or(Value::Null))
                            .collect()
                    })
                    .unwrap_or_default()
            } else {
                vec![]
            };
            server["tools"] = json!(tools);
            result.push(server);
        }
        Ok(json!(result))
    }
    async fn approve(
        &self,
        backend: &Backend,
        window: &tauri::WebviewWindow,
        server: &str,
        name: &str,
        args: &Value,
        cancel: &tokio_util::sync::CancellationToken,
    ) -> Result<()> {
        if name != "run_command"
            && backend
                .db
                .setting("autoApproveTools", json!(false))?
                .as_bool()
                .unwrap_or(false)
        {
            return Ok(());
        }
        let id = uid();
        let (tx, rx) = oneshot::channel();
        self.approvals
            .lock()
            .await
            .insert(id.clone(), (window.label().into(), tx));
        window.emit("tool:approve",json!([id,{"server":server,"tool":name,"message":format!("{name}\n{}",args),"args":args}])).map_err(|e|e.to_string())?;
        let response = tokio::select! {_=cancel.cancelled()=>None, result=tokio::time::timeout(std::time::Duration::from_secs(180), rx)=>Some(result)};
        let approved = response
            .and_then(|result| result.ok())
            .and_then(|r| r.ok())
            .unwrap_or(false);
        self.approvals.lock().await.remove(&id);
        let _ = window.emit("tool:approvalClosed", json!([id]));
        if approved {
            Ok(())
        } else {
            Err("The user declined this action or approval expired.".into())
        }
    }
    pub async fn call(
        &self,
        backend: &Backend,
        window: &tauri::WebviewWindow,
        tool: &Value,
        args: Value,
        cancel: &tokio_util::sync::CancellationToken,
    ) -> Result<String> {
        let id = tool["server"].as_str().ok_or("Missing tool server")?;
        let name = tool["original"].as_str().ok_or("Missing tool name")?;
        if !(id.starts_with("orbi-")
            && ["current_time", "read_webpage", "list_files", "read_file"].contains(&name))
        {
            self.approve(backend, window, id, name, &args, cancel)
                .await?;
        }
        let result = if id.starts_with("orbi-") {
            match name {
                "current_time" => {
                    json!({"utc":time::OffsetDateTime::now_utc().format(&time::format_description::well_known::Rfc3339).map_err(|e|e.to_string())?})
                }
                "save_memory" => {
                    let content = args["content"].as_str().ok_or("Missing memory")?;
                    backend.db.execute(
                        "INSERT INTO memories(id,content,created_at) VALUES(?,?,?)",
                        &[json!(uid()), json!(content), json!(crate::storage::now())],
                    )?;
                    json!({"saved":true})
                }
                "read_webpage" => {
                    let url = url::Url::parse(args["url"].as_str().ok_or("Missing URL")?)
                        .map_err(|_| "Invalid URL")?;
                    if url.scheme() != "https" {
                        return Err("Web pages must use HTTPS.".into());
                    }
                    let text = backend
                        .cloud
                        .http
                        .get(url)
                        .send()
                        .await
                        .map_err(|_| "Web page is unreachable")?
                        .text()
                        .await
                        .map_err(|_| "Unable to read page")?;
                    let plain = scraper::Html::parse_document(&text)
                        .root_element()
                        .text()
                        .collect::<Vec<_>>()
                        .join(" ");
                    json!(plain.chars().take(24000).collect::<String>())
                }
                "list_files" => {
                    let root = workspace(backend)?;
                    let path = safe_path(&root, args["path"].as_str().unwrap_or("."), false)?;
                    let entries = std::fs::read_dir(path)
                        .map_err(|e| e.to_string())?
                        .take(1000)
                        .map(|entry| {
                            entry
                                .map(|e| e.file_name().to_string_lossy().into_owned())
                                .map_err(|e| e.to_string())
                        })
                        .collect::<Result<Vec<_>>>()?;
                    json!(entries)
                }
                "read_file" => {
                    let root = workspace(backend)?;
                    let path =
                        safe_path(&root, args["path"].as_str().ok_or("Missing path")?, false)?;
                    if std::fs::metadata(&path).map_err(|e| e.to_string())?.len() > 1024 * 1024 {
                        return Err("File exceeds the 1 MB tool reading limit.".into());
                    }
                    json!(std::fs::read_to_string(path).map_err(|e| e.to_string())?)
                }
                "write_file" => {
                    let root = workspace(backend)?;
                    let path =
                        safe_path(&root, args["path"].as_str().ok_or("Missing path")?, true)?;
                    std::fs::write(path, args["content"].as_str().ok_or("Missing content")?)
                        .map_err(|e| e.to_string())?;
                    json!({"written":true})
                }
                "run_command" => {
                    let command = args["command"].as_str().ok_or("Missing command")?;
                    let root = workspace(backend)?;
                    let cwd = safe_path(&root, args["cwd"].as_str().unwrap_or("."), false)?;
                    return crate::command_jobs::run(
                        backend,
                        window,
                        command,
                        cwd,
                        args["timeoutSeconds"].as_u64().unwrap_or(900),
                        cancel,
                    )
                    .await;
                }
                _ => return Err("Unknown builtin tool".into()),
            }
        } else {
            let server = profiles()?
                .into_iter()
                .find(|s| s["id"] == id && s["enabled"] == true)
                .ok_or("Server is disabled")?;
            let client = self.connect(&server).await?;
            let request = serde_json::from_value(json!({"name":name,"arguments":args}))
                .map_err(|e| e.to_string())?;
            serde_json::to_value(client.call_tool(request).await.map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?
        };
        Ok(result.to_string())
    }
    pub async fn handle(
        &self,
        backend: &Backend,
        window: &tauri::WebviewWindow,
        channel: &str,
        args: &[Value],
    ) -> Option<Result<Value>> {
        if !channel.starts_with("mcp:") && channel != "tool:approveReply" {
            return None;
        }
        let a = args.first().cloned().unwrap_or(Value::Null);
        let b = args.get(1).cloned().unwrap_or(Value::Null);
        Some(
            async {
                match channel {
                    "mcp:status" => self.status().await,
                    "mcp:catalog" => Ok(crate::library::catalog()),
                    "mcp:workspace" => Ok(json!(workspace(backend)?)),
                    "mcp:chooseWorkspace" => {
                        if let Some(folder) = rfd::AsyncFileDialog::new().pick_folder().await {
                            backend
                                .db
                                .set_setting("workspaceDir", &json!(folder.path()))?;
                        }
                        Ok(json!(workspace(backend)?))
                    }
                    "mcp:save" => {
                        let id = a["id"].as_str().ok_or("Missing server ID")?;
                        let mut servers = profiles()?;
                        servers.retain(|s| s["id"] != id);
                        servers.push(a.clone());
                        save_profiles(&servers)?;
                        self.clients.lock().await.remove(id);
                        if a["enabled"] == true && a["type"] != "builtin" {
                            let _ = self.connect(&a).await;
                        }
                        self.status().await
                    }
                    "mcp:remove" => {
                        let id = a.as_str().ok_or("Missing server ID")?;
                        let mut servers = profiles()?;
                        servers.retain(|s| s["id"] != id || s["type"] == "builtin");
                        save_profiles(&servers)?;
                        self.clients.lock().await.remove(id);
                        self.status().await
                    }
                    "mcp:reconnect" => {
                        let id = a.as_str().ok_or("Missing server ID")?;
                        self.clients.lock().await.remove(id);
                        if let Some(server) = profiles()?.into_iter().find(|s| s["id"] == id) {
                            if server["type"] != "builtin" {
                                let _ = self.connect(&server).await;
                            }
                        }
                        self.status().await
                    }
                    "tool:approveReply" => {
                        let id = a.as_str().ok_or("Missing approval ID")?;
                        let mut approvals = self.approvals.lock().await;
                        if approvals
                            .get(id)
                            .is_some_and(|(owner, _)| owner == window.label())
                        {
                            if let Some((_, sender)) = approvals.remove(id) {
                                let _ = sender.send(b.as_bool().unwrap_or(false));
                            }
                        }
                        Ok(Value::Null)
                    }
                    _ => Err("Unknown MCP operation".into()),
                }
            }
            .await,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn workspace_rejects_parent_and_absolute_paths() {
        let root = std::env::temp_dir();
        assert!(safe_path(&root, "../secret", false).is_err());
        assert!(safe_path(&root, "/etc/passwd", false).is_err());
    }
    #[test]
    fn qualified_tool_names_are_provider_safe() {
        assert_eq!(qualified("my.server", "read/path"), "my_server__read_path");
    }
}
