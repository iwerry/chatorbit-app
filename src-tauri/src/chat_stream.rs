use crate::{
    storage::{uid, Result},
    Backend,
};
use futures_util::StreamExt;
use serde_json::{json, Value};
use std::collections::BTreeMap;
use tauri::Emitter;
use tokio_util::sync::CancellationToken;

#[derive(Default)]
struct Decoder {
    pending: Vec<u8>,
    done: bool,
}
impl Decoder {
    fn feed(&mut self, chunk: &[u8]) -> Result<Vec<Value>> {
        self.pending.extend_from_slice(chunk);
        if self.pending.len() > 4 * 1024 * 1024 {
            return Err("Chat event exceeded its size limit.".into());
        }
        let mut events = Vec::new();
        while let Some(end) = self.pending.iter().position(|c| *c == b'\n') {
            let bytes = self.pending.drain(..=end).collect::<Vec<_>>();
            let line = std::str::from_utf8(&bytes)
                .map_err(|_| "Invalid UTF-8 chat event")?
                .trim();
            let Some(data) = line.strip_prefix("data:").map(str::trim) else {
                continue;
            };
            if data == "[DONE]" {
                self.done = true;
                break;
            }
            if data.is_empty() {
                continue;
            }
            events.push(serde_json::from_str(data).map_err(|_| "Invalid JSON chat event")?);
        }
        Ok(events)
    }
}

pub async fn run(
    backend: &Backend,
    window: &tauri::WebviewWindow,
    id: &str,
    payload: &Value,
    cancel: &CancellationToken,
) -> Result<()> {
    let use_tools =
        payload["useTools"] != false && backend.db.setting("toolsEnabled", json!(true))? != false;
    let catalog = payload["skillCatalog"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    let mut tools = if use_tools {
        backend.mcp.tools(payload["toolServers"].as_array()).await?
    } else {
        Vec::new()
    };
    if use_tools && !catalog.is_empty() {
        tools.extend(crate::skill_tools::definitions());
    }
    let mut messages = crate::chat::messages(payload);
    let mut include_tools = !tools.is_empty();
    for round in 0..if payload["goal"] == true {
        usize::MAX
    } else {
        8
    } {
        let mut body = json!({"model":payload["model"],"messages":messages,"stream":true});
        if include_tools {
            body["tools"]=json!(tools.iter().map(|tool|json!({"type":"function","function":{"name":tool["name"],"description":tool["description"],"parameters":tool["parameters"]}})).collect::<Vec<_>>());
        }
        if payload["thinking"].as_bool().unwrap_or(false) {
            body["reasoning"] =
                json!({"effort":payload["effort"].as_str().unwrap_or("medium").to_lowercase()});
        }
        let response = tokio::select! {_=cancel.cancelled()=>return Ok(()),result=backend.cloud.request("/v1/chat/completions",Some(body))=>result};
        let response = match response {
            Ok(response) => response,
            Err(error) if include_tools && round == 0 && error.to_lowercase().contains("tool") => {
                include_tools = false;
                continue;
            }
            Err(error) => return Err(error),
        };
        let mut stream = response.bytes_stream();
        let mut decoder = Decoder::default();
        let mut text = String::new();
        let mut calls: BTreeMap<u64, Value> = BTreeMap::new();
        loop {
            let chunk =
                tokio::select! {_=cancel.cancelled()=>return Ok(()),next=stream.next()=>next};
            let events = match chunk {
                Some(Ok(bytes)) => decoder.feed(&bytes)?,
                Some(Err(_)) => return Err("Chat connection was interrupted.".into()),
                None => {
                    decoder.done = true;
                    decoder.feed(b"\n")?
                }
            };
            for event in events {
                if let Some(error) = event["error"]["message"].as_str() {
                    return Err(error.to_string());
                }
                let delta = &event["choices"][0]["delta"];
                let mut output = json!({});
                if let Some(part) = delta["content"].as_str() {
                    text.push_str(part);
                    output["text"] = json!(part);
                }
                if let Some(part) = delta["reasoning"]
                    .as_str()
                    .or(delta["reasoning_content"].as_str())
                {
                    output["reasoning"] = json!(part);
                }
                if !output.as_object().unwrap().is_empty() {
                    window
                        .emit("chat:delta", json!([id, output]))
                        .map_err(|e| e.to_string())?;
                }
                if let Some(parts) = delta["tool_calls"].as_array() {
                    for part in parts {
                        let index = part["index"].as_u64().unwrap_or(calls.len() as u64);
                        let call = calls
                            .entry(index)
                            .or_insert_with(|| json!({"id":"","name":"","arguments":""}));
                        if let Some(value) = part["id"].as_str() {
                            call["id"] = json!(value);
                        }
                        for key in ["name", "arguments"] {
                            if let Some(value) = part["function"][key].as_str() {
                                call[key] =
                                    json!(format!("{}{}", call[key].as_str().unwrap_or(""), value));
                            }
                        }
                    }
                }
            }
            if decoder.done {
                break;
            }
        }
        if calls.is_empty() {
            return Ok(());
        }
        let calls: Vec<Value> = calls
            .into_values()
            .map(|mut call| {
                if call["id"].as_str().unwrap_or("").is_empty() {
                    call["id"] = json!(uid());
                }
                call
            })
            .collect();
        messages.push(json!({"role":"assistant","content":text,"tool_calls":calls.iter().map(|call|json!({"id":call["id"],"type":"function","function":{"name":call["name"],"arguments":call["arguments"]}})).collect::<Vec<_>>()}));
        for call in calls {
            let name = call["name"].as_str().ok_or("Missing tool name")?;
            let call_id = &call["id"];
            let args: Value = serde_json::from_str(
                call["arguments"]
                    .as_str()
                    .filter(|s| !s.is_empty())
                    .unwrap_or("{}"),
            )
            .map_err(|_| "The model supplied invalid tool arguments.")?;
            window
                .emit(
                    "chat:delta",
                    json!([id,{"tool":{"id":call_id,"name":name,"args":args,"status":"running"}}]),
                )
                .map_err(|e| e.to_string())?;
            let result = if let Some(tool) = tools.iter().find(|tool| tool["name"] == name) {
                if name.starts_with("orbi-skills__") {
                    crate::skill_tools::call(&backend.db, &catalog, name, &args)
                } else {
                    if tool["original"] == "run_command" {
                        backend
                            .mcp
                            .call(backend, window, tool, args.clone(), cancel)
                            .await
                    } else {
                        tokio::select! {_=cancel.cancelled()=>return Ok(()),result=backend.mcp.call(backend,window,tool,args.clone(),cancel)=>result}
                    }
                }
            } else {
                Err("The requested tool is outside the allowed tool list.".into())
            };
            let ok = result.is_ok()
                && !result
                    .as_ref()
                    .ok()
                    .and_then(|text| serde_json::from_str::<Value>(text).ok())
                    .is_some_and(|value| value["error"].is_string());
            let text = result.unwrap_or_else(|error| json!({"error":error}).to_string());
            let stopped = serde_json::from_str::<Value>(&text)
                .ok()
                .is_some_and(|value| {
                    value["cancelled"] == true
                        || value["error"]
                            .as_str()
                            .is_some_and(|error| error.contains("user declined"))
                });
            let text = text.chars().take(64000).collect::<String>();
            window.emit("chat:delta",json!([id,{"tool":{"id":call_id,"name":name,"args":args,"status":if ok{"done"}else{"error"},"result":text}}])).map_err(|e|e.to_string())?;
            messages.push(json!({"role":"tool","tool_call_id":call_id,"content":text}));
            if stopped {
                window
                    .emit(
                        "chat:delta",
                        json!([id,{"text":"\n\nExecution paused. Waiting for your instructions."}]),
                    )
                    .map_err(|e| e.to_string())?;
                return Ok(());
            }
        }
    }
    Err("The model reached the eight-round tool limit; send a follow-up to continue.".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn fragmented_utf8_and_multiple_sse_events_are_reassembled() {
        let data =
            "data: {\"choices\":[{\"delta\":{\"content\":\"olá\"}}]}\n\ndata: [DONE]\n".as_bytes();
        let mut decoder = Decoder::default();
        let mut events = Vec::new();
        for chunk in data.chunks(3) {
            events.extend(decoder.feed(chunk).unwrap());
        }
        assert_eq!(events[0]["choices"][0]["delta"]["content"], "olá");
        assert!(decoder.done);
    }
    #[test]
    fn invalid_sse_json_does_not_report_success() {
        assert!(Decoder::default().feed(b"data: {broken}\n").is_err());
    }
}
