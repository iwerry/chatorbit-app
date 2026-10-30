use crate::{storage::Result, Backend};

use serde_json::{json, Value};
use tauri::Emitter;
use tokio_util::sync::CancellationToken;

pub(crate) fn messages(payload: &Value) -> Vec<Value> {
    let mut output = Vec::new();
    if let Some(system) = payload["system"].as_str().filter(|s| !s.is_empty()) {
        output.push(json!({"role":"system","content":system}));
    }
    if let Some(messages) = payload["messages"].as_array() {
        for message in messages {
            let mut content = message["content"].clone();
            if message["role"] == "user" {
                if let Some(images) = message["images"].as_array().filter(|v| !v.is_empty()) {
                    let mut parts = vec![json!({"type":"text","text":message["content"]})];
                    parts.extend(
                        images
                            .iter()
                            .map(|url| json!({"type":"image_url","image_url":{"url":url}})),
                    );
                    content = json!(parts);
                }
            }
            output.push(json!({"role":message["role"],"content":content}));
        }
    }
    output
}
pub async fn handle(
    backend: &Backend,
    window: &tauri::WebviewWindow,
    channel: &str,
    args: &[Value],
) -> Option<Result<Value>> {
    if !matches!(
        channel,
        "models:list"
            | "providers:list"
            | "chat:send"
            | "chat:abort"
            | "ai:complete"
            | "chat:title"
            | "voice:transcribe"
    ) {
        return None;
    }
    let a = args.first().cloned().unwrap_or(Value::Null);
    let b = args.get(1).cloned().unwrap_or(Value::Null);
    Some(async {
        match channel {
            "providers:list"=>Ok(json!([{"id":"orbicloud","name":"Orbi Cloud","kind":"openai","baseUrl":"","needsKey":false,"mode":"API","hint":"","enabled":true,"customBaseUrl":"","hasKey":true}])),
            "models:list"=>{
                let catalog=backend.cloud.call("/v1/catalog",None).await?;
                let mut models=Vec::new();
                for kind in ["chat","image"] {if let Some(rows)=catalog[kind].as_array(){for row in rows {
                    let id=row["id"].as_str().ok_or("Invalid model catalog entry")?;
                    models.push(json!({"id":id,"key":format!("orbicloud::{id}"),"name":row["name"],"provider":"orbicloud","providerName":"Orbi Cloud","mode":"API","image":kind=="image","featured":row["featured"],"vision":row["input"].as_array().is_some_and(|v|v.iter().any(|x|x=="image"))}));
                }}}
                Ok(json!({"models":models,"errors":[]}))
            },
            "chat:abort"=>{let key=format!("{}:{}",window.label(),a.as_str().ok_or("Missing request ID")?);if let Some(token)=backend.chats.lock().await.get(&key){token.cancel();}Ok(Value::Null)},
            "ai:complete"|"chat:title"=>{
                let mut payload=a;
                if channel=="chat:title" {payload["system"]=json!("Write a short title (max 6 words) for this conversation. Reply with only the title, in the user's language.");}
                else {payload["messages"]=json!([{"role":"user","content":payload["prompt"]}]);}
                let body=json!({"model":payload["model"],"messages":messages(&payload),"stream":false,"max_tokens":payload["maxTokens"].as_u64().unwrap_or(if channel=="chat:title" {64} else {4096})});
                let response=backend.cloud.call("/v1/chat/completions",Some(body)).await?;
                let content=response["choices"][0]["message"]["content"].as_str().ok_or("No text was returned by the model.")?;
                Ok(json!(content.trim()))
            },
            "voice:transcribe"=>{
                let wav=a["wav"].as_str().ok_or("Missing audio recording")?;
                let encoded=wav.split_once(',').map(|(_,data)|data).unwrap_or(wav);
                let response=backend.cloud.call("/v1/audio/transcriptions",Some(json!({"model":a["mode"]["model"],"input_audio":{"data":encoded,"format":"wav"},"language":a["language"]}))).await?;
                Ok(json!(response["text"].as_str().unwrap_or("")))
            },
            "chat:send"=>{
                let id=a.as_str().ok_or("Missing request ID")?;
                let key=format!("{}:{id}",window.label());
                let token=CancellationToken::new();
                backend.chats.lock().await.insert(key.clone(),token.clone());
                let result=stream(backend,window,id,&b,&token).await;
                backend.chats.lock().await.remove(&key);
                let done=match result {Ok(())=>json!({"ok":true,"aborted":token.is_cancelled()}),Err(error)=>json!({"ok":false,"error":error})};
                window.emit("chat:delta",json!([id,{"done":done}])).map_err(|e|e.to_string())?;
                Ok(done)
            },
            _=>unreachable!(),
        }
    }.await)
}

async fn stream(
    backend: &Backend,
    window: &tauri::WebviewWindow,
    id: &str,
    payload: &Value,
    cancel: &CancellationToken,
) -> Result<()> {
    crate::chat_stream::run(backend, window, id, payload, cancel).await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn image_attachments_and_system_prompt_are_kept() {
        let result = messages(
            &json!({"system":"instructions","messages":[{"role":"user","content":"look","images":["data:image/png;base64,eA=="]}]}),
        );
        assert_eq!(result.len(), 2);
        assert_eq!(
            result[1]["content"][1]["image_url"]["url"],
            "data:image/png;base64,eA=="
        );
    }
}
