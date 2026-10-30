use crate::{storage::Result, Backend};
use serde_json::{json, Value};

// Cloud-only builds do not advertise Electron's local-engine binaries or ASAR updater.
pub async fn handle(backend: &Backend, channel: &str) -> Option<Result<Value>> {
    Some(match channel {
        "local:status" => {
            let mut engines = serde_json::Map::new();
            for name in ["llama", "sd", "whisper", "piper", "sherpa"] {
                engines.insert(name.into(), json!({"name":name,"tag":"","supported":false,"installed":false,"downloading":null}));
            }
            Ok(
                json!({"hardware":null,"engines":engines,"engineInstalled":false,"engineTag":"","running":null,"starting":false,"models":[],"recommended":{},"engineDownloading":null,"paths":null,"queue":[],"clones":[]}),
            )
        }
        "voice:clones" => Ok(json!([])),
        "voice:systemList" => Ok(
            json!({"voices":[],"platform":std::env::consts::OS,"hint":"System voices are not yet available in the native preview. Use Orbi Cloud voices."}),
        ),
        "update:activeWork" => {
            let mut work = Vec::new();
            for _ in backend.chats.lock().await.values() {
                work.push(json!({"kind":"chat","label":"Answer being written"}));
            }
            for _ in backend.renders.lock().await.values() {
                work.push(json!({"kind":"video","label":"Video being generated"}));
            }
            for _ in backend.jobs.0.lock().await.values() {
                work.push(json!({"kind":"terminal","label":"Terminal task"}));
            }
            Ok(json!(work))
        }
        _ => return None,
    })
}
