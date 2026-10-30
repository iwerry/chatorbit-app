use crate::{
    storage::{uid, Result},
    Backend,
};
use serde_json::{json, Value};
use tauri::Manager;

pub async fn handle(
    backend: &Backend,
    window: &tauri::WebviewWindow,
    channel: &str,
    args: &[Value],
) -> Option<Result<Value>> {
    if !(channel.starts_with("window:")
        || matches!(
            channel,
            "app:quit"
                | "shell:openExternal"
                | "data:reveal"
                | "edit:command"
                | "find:start"
                | "find:stop"
        ))
    {
        return None;
    }
    let a = args.first().cloned().unwrap_or(Value::Null);
    Some((|| {
        match channel {
            "window:new" => {
                tauri::WebviewWindowBuilder::new(
                    window.app_handle(),
                    format!("orbi-{}", uid()),
                    tauri::WebviewUrl::App("index.html".into()),
                )
                .title("Orbi")
                .inner_size(1280.0, 860.0)
                .min_inner_size(800.0, 600.0)
                .build()
                .map_err(|e| e.to_string())?;
            }
            "window:close" => window.close().map_err(|e| e.to_string())?,
            "window:minimize" => window.minimize().map_err(|e| e.to_string())?,
            "window:fullscreen" => window
                .set_fullscreen(!window.is_fullscreen().map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?,
            "window:reload" => window.reload().map_err(|e| e.to_string())?,
            "window:devtools" => {
                #[cfg(debug_assertions)]
                window.open_devtools();
            }
            "window:overlay" => {}
            "window:zoom" => {
                let key = format!("nativeZoom:{}", window.label());
                let old = backend
                    .db
                    .setting(&key, json!(1.0))?
                    .as_f64()
                    .unwrap_or(1.0);
                let direction = a.as_i64().unwrap_or(0);
                let factor = if direction == 0 {
                    1.0
                } else {
                    (old + direction.signum() as f64 * 0.1).clamp(0.5, 2.0)
                };
                window.set_zoom(factor).map_err(|e| e.to_string())?;
                backend.db.set_setting(&key, &json!(factor))?;
            }
            "app:quit" => window.app_handle().exit(0),
            "shell:openExternal" => {
                let url =
                    url::Url::parse(a.as_str().ok_or("Missing URL")?).map_err(|_| "Invalid URL")?;
                if !matches!(url.scheme(), "https" | "http") {
                    return Err("Only web URLs can be opened externally.".into());
                }
                open::that_detached(url.as_str()).map_err(|e| e.to_string())?;
            }
            "data:reveal" => open::that_detached(&backend.root).map_err(|e| e.to_string())?,
            "edit:command" => {
                let command = a.as_str().ok_or("Missing edit command")?;
                if ![
                    "undo",
                    "redo",
                    "cut",
                    "copy",
                    "paste",
                    "selectAll",
                    "delete",
                ]
                .contains(&command)
                {
                    return Err("Unsupported edit command".into());
                }
                window
                    .eval(format!("document.execCommand({})", json!(command)))
                    .map_err(|e| e.to_string())?;
            }
            "find:start" => {
                let backwards = args
                    .get(1)
                    .and_then(|v| v["forward"].as_bool())
                    .is_some_and(|v| !v);
                let sensitive = args
                    .get(1)
                    .and_then(|v| v["matchCase"].as_bool())
                    .unwrap_or(false);
                window
                    .eval(format!(
                        "window.find && window.find({}, {}, {}, true)",
                        a, sensitive, backwards
                    ))
                    .map_err(|e| e.to_string())?;
            }
            "find:stop" => window
                .eval("window.getSelection()?.removeAllRanges()")
                .map_err(|e| e.to_string())?,
            _ => return Err("Unsupported window action".into()),
        }
        Ok(Value::Null)
    })())
}
