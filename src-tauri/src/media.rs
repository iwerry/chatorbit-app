use crate::{
    storage::{now, uid, Result},
    Backend,
};
use base64::Engine;
use serde_json::{json, Value};
use std::path::PathBuf;

const LIMIT: usize = 512 * 1024 * 1024;
fn extension(mime: &str) -> &'static str {
    match mime.split(';').next().unwrap_or("") {
        "image/png" => "png",
        "image/jpeg" => "jpg",
        "image/webp" => "webp",
        "image/gif" => "gif",
        "video/mp4" => "mp4",
        "video/webm" => "webm",
        "audio/mpeg" => "mp3",
        "audio/wav" | "audio/x-wav" => "wav",
        "audio/ogg" => "ogg",
        "audio/flac" => "flac",
        "application/pdf" => "pdf",
        "audio/aac" => "aac",
        "audio/mp4" => "m4a",
        _ => "bin",
    }
}
fn decode_data_url(text: &str) -> Result<(Vec<u8>, String)> {
    let (header, data) = text.split_once(',').ok_or("Invalid file data")?;
    if !header.starts_with("data:") || !header.ends_with(";base64") {
        return Err("Expected base64 file data".into());
    }
    if data.len() > LIMIT * 4 / 3 + 4 {
        return Err("This file exceeds the 512 MB import limit.".into());
    }
    let mime = header[5..header.len() - 7].to_string();
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|_| "Invalid base64 file data")?;
    Ok((bytes, mime))
}
pub fn record(backend: &Backend, id: &Value) -> Result<Value> {
    backend
        .db
        .query("SELECT * FROM media WHERE id=?", &[id.clone()])?
        .into_iter()
        .next()
        .ok_or("File not found in the library.".into())
}
pub fn checked_path(backend: &Backend, row: &Value) -> Result<PathBuf> {
    let path = PathBuf::from(row["file"].as_str().ok_or("Invalid media path")?)
        .canonicalize()
        .map_err(|_| "This media file is missing.")?;
    let root = backend
        .root
        .join("media")
        .canonicalize()
        .map_err(|e| e.to_string())?;
    if !path.starts_with(root) {
        return Err("The file is outside Orbi's media directory.".into());
    }
    Ok(path)
}
pub fn save(backend: &Backend, data: &[u8], mime: &str, meta: &Value, kind: &str) -> Result<Value> {
    if data.len() > LIMIT {
        return Err("The result exceeds the 512 MB file limit.".into());
    }
    let id = uid();
    let filename = format!("{id}.{}", extension(mime));
    let file = backend.root.join("media").join(&filename);
    let temporary = file.with_extension("partial");
    std::fs::write(&temporary, data).map_err(|e| e.to_string())?;
    std::fs::rename(&temporary, &file).map_err(|e| e.to_string())?;
    let row = json!({"id":id,"kind":kind,"name":meta["name"].as_str().unwrap_or(&filename),"file":file,"prompt":meta["prompt"].as_str().unwrap_or(""),"model":meta["model"].as_str().unwrap_or(""),"source":meta["source"].as_str().unwrap_or("creative"),"board":meta["board"].as_str().unwrap_or(""),"params":meta.to_string(),"created_at":now()});
    if let Err(error)=backend.db.execute("INSERT INTO media(id,kind,name,file,prompt,model,source,board,params,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)", &[row["id"].clone(),row["kind"].clone(),row["name"].clone(),row["file"].clone(),row["prompt"].clone(),row["model"].clone(),row["source"].clone(),row["board"].clone(),row["params"].clone(),row["created_at"].clone()]) {let _=std::fs::remove_file(file);return Err(error);}
    Ok(row)
}
async fn bytes(mut response: reqwest::Response) -> Result<(Vec<u8>, String)> {
    if !response.status().is_success() {
        return Err(format!("Media download failed ({})", response.status()));
    }
    let mime = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_string();
    let mut output = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Media download was interrupted.")?
    {
        if output.len() + chunk.len() > LIMIT {
            return Err("Media download exceeded 512 MB.".into());
        }
        output.extend_from_slice(&chunk);
    }
    Ok((output, mime))
}
pub async fn handle(backend: &Backend, channel: &str, args: &[Value]) -> Option<Result<Value>> {
    let a = args.first().cloned().unwrap_or(Value::Null);
    let b = args.get(1).cloned().unwrap_or(Value::Null);
    let matches = matches!(
        channel,
        "media:list"
            | "media:delete"
            | "media:open"
            | "media:reveal"
            | "media:saveAs"
            | "media:import"
            | "media:dataUrl"
            | "media:saveCanvas"
            | "image:generate"
            | "ai:speech"
            | "cloud:speak"
            | "cloud:music"
            | "cloud:video"
    );
    if !matches {
        return None;
    }
    Some(async {
        match channel {
            "media:list"=>Ok(json!(backend.db.query("SELECT * FROM media ORDER BY created_at DESC", &[])?)),
            "media:dataUrl"=>{
                let row=record(backend,&a)?;let path=checked_path(backend,&row)?;
                let size=std::fs::metadata(&path).map_err(|e|e.to_string())?.len();
                if size>LIMIT as u64 {return Err("File is too large to use as a reference.".into());}
                let data=std::fs::read(path).map_err(|e|e.to_string())?;
                let mime=match row["file"].as_str().unwrap_or("").rsplit('.').next().unwrap_or("") {"jpg"|"jpeg"=>"image/jpeg","webp"=>"image/webp","mp4"=>"video/mp4",_=>"image/png"};
                Ok(json!(format!("data:{mime};base64,{}",base64::engine::general_purpose::STANDARD.encode(data))))
            },
            "media:open"|"media:reveal"=>{let row=record(backend,&a)?;let path=checked_path(backend,&row)?;open::that_detached(if channel=="media:reveal" {path.parent().ok_or("Missing directory")?.to_path_buf()} else {path}).map_err(|e|e.to_string())?;Ok(Value::Null)},
            "media:delete"=>{let row=record(backend,&a)?;let path=checked_path(backend,&row)?;std::fs::remove_file(path).map_err(|e|e.to_string())?;backend.db.execute("DELETE FROM media WHERE id=?", &[a])?;Ok(Value::Null)},
            "media:saveAs"=>{
                let row=record(backend,&a)?;let path=checked_path(backend,&row)?;
                if let Some(target)=rfd::AsyncFileDialog::new().set_file_name(row["name"].as_str().unwrap_or("orbi-media")).save_file().await {std::fs::copy(path,target.path()).map_err(|e|e.to_string())?;return Ok(json!(true));}Ok(json!(false))
            },
            "media:import"|"media:saveCanvas"=>{
                let (text,meta)=if channel=="media:import" {(a["dataUrl"].as_str().unwrap_or(""),a.clone())} else {(a.as_str().unwrap_or(""),b)};
                let (data,mime)=decode_data_url(text)?;
                let kind=if mime.starts_with("image/") {"image"} else if mime.starts_with("video/") {"video"} else if mime.starts_with("audio/") {"audio"} else {"file"};
                save(backend,&data,&mime,&meta,kind)
            },
            "image:generate"=>{
                let mut body=json!({"model":a["model"],"prompt":a["prompt"],"aspect_ratio":a["aspect"],"resolution":a["resolution"]});
                if let Some(refs)=a["refImages"].as_array(){body["input_references"]=json!(refs.iter().map(|url|json!({"type":"image_url","image_url":{"url":url}})).collect::<Vec<_>>());}
                let result=backend.cloud.call("/v1/images",Some(body)).await?;
                let image=result["data"].get(0).ok_or("No image came back.")?;
                let (data,mime)=if let Some(encoded)=image["b64_json"].as_str(){(base64::engine::general_purpose::STANDARD.decode(encoded).map_err(|_|"Invalid generated image")?,image["media_type"].as_str().unwrap_or("image/png").to_string())} else {
                    let url=url::Url::parse(image["url"].as_str().ok_or("No image URL came back")?).map_err(|_|"Invalid image URL")?;
                    if url.scheme()!="https" {return Err("Generated media URL must use HTTPS.".into());}
                    bytes(backend.cloud.http.get(url).send().await.map_err(|_|"Image download failed")?).await?
                };
                save(backend,&data,&mime,&a,"image")
            },
            "ai:speech"|"cloud:speak"=>{
                let pref=backend.db.setting("cloudVoice",json!({}))?;
                let preferred=|key:&str|a[key].as_str().filter(|s|!s.is_empty()).or_else(||pref[key].as_str()).unwrap_or("").to_string();
                let body=json!({"model":preferred("model"),"input":a["text"].as_str().unwrap_or("").chars().take(4000).collect::<String>(),"voice":preferred("voice"),"purpose":a["purpose"],"response_format":"mp3"});
                let (data,mime)=bytes(backend.cloud.request("/v1/audio/speech",Some(body)).await?).await?;
                if channel=="cloud:speak" {Ok(json!(format!("data:{mime};base64,{}",base64::engine::general_purpose::STANDARD.encode(data))))}
                else {save(backend,&data,&mime,&a,"audio")}
            },
            "cloud:music"=>{
                let response=backend.cloud.request("/v1/music",Some(a.clone())).await?;
                let lyrics=response.headers().get("x-orbi-lyrics").and_then(|v|v.to_str().ok()).unwrap_or("").to_string();
                let lyrics=url::form_urlencoded::parse(format!("lyrics={}",lyrics.replace('+',"%2B")).as_bytes()).find(|(key,_)|key=="lyrics").map(|(_,v)|v.into_owned()).unwrap_or_default();
                let (data,mime)=bytes(response).await?;
                let mut item=save(backend,&data,&mime,&a,"audio")?;item["lyrics"]=json!(lyrics);Ok(item)
            },
            "cloud:video"=>{
                let mut body=json!({"model":a["model"],"prompt":a["prompt"],"duration":a["duration"],"resolution":a["resolution"],"aspect_ratio":a["aspect"],"generate_audio":a["audio"]});
                if let Some(frame)=a["frameImage"].as_str(){body["frame_images"]=json!([{"type":"image_url","image_url":{"url":frame},"frame_type":"first_frame"}]);}
                let job=backend.cloud.call("/v1/videos",Some(body)).await?;
                let id=job["id"].as_str().ok_or("Video job ID is missing")?;
                let escaped=url::form_urlencoded::byte_serialize(id.as_bytes()).collect::<String>();
                for _ in 0..360 {
                    tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                    let status=backend.cloud.call(&format!("/v1/videos/{escaped}"),None).await?;
                    if status["status"]=="failed" {return Err(status["error"]["message"].as_str().unwrap_or("Video generation failed.").to_string());}
                    if status["status"]=="completed" {let (data,mime)=bytes(backend.cloud.request(&format!("/v1/videos/{escaped}/content?index=0"),None).await?).await?;return save(backend,&data,&mime,&a,"video");}
                }
                Err("Video generation exceeded 30 minutes.".into())
            },
            _=>unreachable!(),
        }
    }.await)
}
