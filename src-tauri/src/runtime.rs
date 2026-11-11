use crate::{storage::Result, Backend};
use serde_json::{json, Value};

// Orbi runs only on Orbi Cloud: there are no local AI engines to report.
pub async fn handle(backend: &Backend, channel: &str) -> Option<Result<Value>> {
    Some(match channel {
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
