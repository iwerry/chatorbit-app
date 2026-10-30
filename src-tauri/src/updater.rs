use crate::{storage::Result, Backend};
use serde_json::{json, Value};
use std::sync::Mutex;
use tauri::{Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};
use tokio_util::sync::CancellationToken;

const FEED: &str =
    "https://github.com/iwerry/chatorbit-app/releases/download/native-channel/latest.json";
const KEY: &str = env!("ORBI_UPDATER_PUBLIC_KEY");
struct Data {
    state: Value,
    update: Option<Update>,
    bytes: Vec<u8>,
    cancel: Option<CancellationToken>,
}
pub struct Updater {
    data: Mutex<Data>,
    operation: tokio::sync::Mutex<()>,
}
impl Default for Updater {
    fn default() -> Self {
        Self {
            data: Mutex::new(Data {
                state: json!({"status":"idle","current":env!("CARGO_PKG_VERSION"),"latest":null,"progress":null,"error":null}),
                update: None,
                bytes: Vec::new(),
                cancel: None,
            }),
            operation: tokio::sync::Mutex::new(()),
        }
    }
}
fn newer(current: &str, remote: &str, published: Option<i64>, built: i64) -> bool {
    current != remote && published.is_some_and(|date| date > built)
}
impl Updater {
    fn state(&self) -> Value {
        self.data.lock().unwrap().state.clone()
    }
    fn set(&self, app: &tauri::AppHandle, patch: Value) -> Value {
        let state = {
            let mut data = self.data.lock().unwrap();
            for (key, value) in patch.as_object().unwrap() {
                data.state[key] = value.clone();
            }
            data.state.clone()
        };
        let _ = app.emit("update:state", json!([state]));
        state
    }
    pub async fn check(&self, app: &tauri::AppHandle) -> Result<Value> {
        let Ok(_operation) = self.operation.try_lock() else {
            return Ok(self.state());
        };
        if KEY.trim().is_empty() {
            return Ok(self.set(app,json!({"status":"error","error":"Native update signing has not been configured for this build. Install the signed transition build first."})));
        }
        self.set(app, json!({"status":"checking","error":null}));
        let built = env!("ORBI_BUILD_UNIX").parse::<i64>().unwrap_or(i64::MAX);
        let result = async {
            let updater = app
                .updater_builder()
                .pubkey(KEY)
                .endpoints(vec![url::Url::parse(FEED).map_err(|e| e.to_string())?])
                .map_err(|e| e.to_string())?
                .version_comparator(move |current, release| {
                    newer(
                        &current.to_string(),
                        &release.version.to_string(),
                        release.pub_date.map(|d| d.unix_timestamp()),
                        built,
                    )
                })
                .timeout(std::time::Duration::from_secs(30 * 60))
                .build()
                .map_err(|e| e.to_string())?;
            tokio::time::timeout(std::time::Duration::from_secs(30), updater.check())
                .await
                .map_err(|_| "Update check timed out".to_string())?
                .map_err(|e| e.to_string())
        }
        .await;
        match result {
            Ok(Some(update)) => {
                if update.download_url.scheme() != "https" {
                    return Err("Update packages must use HTTPS".into());
                }
                let latest = json!({"version":update.version,"name":format!("Orbi {}",update.version),"notes":update.body,"publishedAt":update.date.and_then(|d|d.format(&time::format_description::well_known::Rfc3339).ok()),"url":"https://github.com/iwerry/chatorbit-app/releases","asset":{"name":"Orbi native update","url":update.download_url,"size":0}});
                {
                    let mut data = self.data.lock().unwrap();
                    data.update = Some(update);
                    data.bytes.clear();
                }
                Ok(self.set(
                    app,
                    json!({"status":"available","latest":latest,"progress":null,"error":null}),
                ))
            }
            Ok(None) => {
                let mut data = self.data.lock().unwrap();
                data.update = None;
                data.bytes.clear();
                drop(data);
                Ok(self.set(app, json!({"status":"current","latest":null,"error":null})))
            }
            Err(error) => Ok(self.set(app, json!({"status":"error","error":error}))),
        }
    }
    pub async fn handle(
        &self,
        backend: &Backend,
        window: &tauri::WebviewWindow,
        channel: &str,
    ) -> Option<Result<Value>> {
        if !matches!(
            channel,
            "update:state"
                | "update:check"
                | "update:download"
                | "update:cancel"
                | "update:install"
        ) {
            return None;
        }
        let app = window.app_handle();
        Some(async {match channel {
            "update:state"=>Ok(self.state()),
            "update:check"=>self.check(app).await,
            "update:cancel"=>{if let Some(cancel)=&self.data.lock().unwrap().cancel {cancel.cancel();}Ok(self.state())},
            "update:download"=>{
                let _operation=self.operation.try_lock().map_err(|_|"Another update operation is running")?;
                let update=self.data.lock().unwrap().update.clone().ok_or("Check for updates first")?;
                let cancel=CancellationToken::new();self.data.lock().unwrap().cancel=Some(cancel.clone());
                self.set(app,json!({"status":"downloading","progress":{"received":0,"total":0},"error":null}));
                let mut received=0u64;let mut last=std::time::Instant::now();
                let result=tokio::select! {_=cancel.cancelled()=>Err("Download cancelled".to_string()),result=update.download(|chunk,total|{received+=chunk as u64;if received>512*1024*1024 {cancel.cancel();}if last.elapsed().as_millis()>250 {last=std::time::Instant::now();self.set(app,json!({"progress":{"received":received,"total":total.unwrap_or(0)}}));}},||{})=>result.map_err(|e|e.to_string())};
                self.data.lock().unwrap().cancel=None;
                let oversized=received>512*1024*1024;
                match result {Ok(bytes)=>{self.data.lock().unwrap().bytes=bytes;Ok(self.set(app,json!({"status":"ready","progress":null})))},Err(error)=>Ok(self.set(app,json!({"status":if cancel.is_cancelled()&&!oversized{"available"}else{"error"},"progress":null,"error":if oversized{json!("Update exceeds the 512 MB package limit")}else if cancel.is_cancelled(){Value::Null}else{json!(error)}})))}
            },
            "update:install"=>{
                let _operation=self.operation.try_lock().map_err(|_|"Another update operation is running")?;
                let (update,bytes)={let mut data=self.data.lock().unwrap();if data.state["status"]!="ready"||data.bytes.is_empty(){return Err("Download the update first".into());}(data.update.clone().ok_or("No update prepared")?,std::mem::take(&mut data.bytes))};
                self.set(app,json!({"status":"installing","error":null}));
                for tasks in [&backend.chats,&backend.renders,&backend.jobs.0]{for token in tasks.lock().await.values(){token.cancel();}}
                for _ in 0..100 {if backend.jobs.0.lock().await.is_empty(){break;}tokio::time::sleep(std::time::Duration::from_millis(100)).await;}
                if !backend.jobs.0.lock().await.is_empty(){self.data.lock().unwrap().bytes=bytes;return Ok(self.set(app,json!({"status":"error","error":"A terminal task is still stopping. Wait and retry the update."})));}
                for window in app.webview_windows().values(){backend.terminals.close_window(window.label());}
                match update.install(&bytes){Ok(())=>{app.restart();},Err(error)=>{self.data.lock().unwrap().bytes=bytes;Ok(self.set(app,json!({"status":"error","error":error.to_string()})))}}
            },_=>unreachable!()
        }}.await)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn day_based_versions_use_publication_time() {
        assert!(newer("0.1.30-3", "0.1.1-1", Some(200), 100));
        assert!(!newer("0.1.1-1", "0.1.1-1", Some(200), 100));
        assert!(!newer("0.1.30-3", "0.1.29-1", Some(50), 100));
        assert!(!newer("0.1.30-3", "0.1.1-1", None, 100));
    }
}
