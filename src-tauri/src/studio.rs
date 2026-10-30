use crate::{storage::Result, Backend};
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    io::{Cursor, Read, Write},
    path::Path,
};
use zip::{write::SimpleFileOptions, ZipArchive, ZipWriter};
fn matches(pattern: &str, text: &str) -> bool {
    regex::Regex::new(pattern)
        .expect("Static expression")
        .is_match(text)
}
fn value<'a>(doc: &'a Value, key: &str) -> &'a str {
    doc[key].as_str().unwrap_or("")
}
pub fn check(doc: &Value) -> Value {
    let name = value(doc, "name");
    let description = value(doc, "description");
    let body = value(doc, "body");
    let mut issues = Vec::new();
    let mut warnings = Vec::new();
    if name.len() > 64 || !matches(r"^[a-z0-9]+(?:-[a-z0-9]+)*$", name) {
        issues.push("Name must be kebab-case: lowercase letters, digits and single hyphens, up to 64 characters.".to_string());
    }
    if matches(
        "(?i)claude|anthropic|openai|chatgpt|gpt|gemini|google|copilot",
        name,
    ) {
        issues.push("Name must not contain AI brand names.".into());
    }
    if description.is_empty() || description.chars().count() > 1024 {
        issues.push("Description must have 1–1024 characters.".into());
    }
    if description.contains(['<', '>']) {
        issues.push("Description must not contain < or >.".into());
    }
    if !matches(r"(?i)\b(use|when|whenever)\b", description) {
        warnings.push("Description should say when to use the skill.".into());
    }
    if !matches(r"(?i)\b(do not|don't|not for|never)\b", description) {
        warnings.push("Description has no negative boundary.".into());
    }
    if body.trim().is_empty() {
        issues.push("The body (procedure) is empty.".into());
    }
    if body.lines().count() > 500 {
        warnings.push("SKILL.md body has more than 500 lines; move details to references/.".into());
    }
    let mut all = body.to_string();
    if let Some(files) = doc["files"].as_array() {
        for file in files {
            let path = value(file, "path");
            all.push_str(value(file, "content"));
            if !matches(r"^(references|scripts|assets)/[^/]+$", path) {
                warnings.push(format!("{path}: support files should sit one level deep."));
            }
            if !body.contains(path) {
                warnings.push(format!("{path} is not mentioned in SKILL.md."));
            }
        }
    }
    if matches(
        r#"(?i)(?:api[_-]?key|secret|password|token)\s*[:=]\s*['"]?[A-Za-z0-9_./+\-]{12,}"#,
        &all,
    ) {
        issues.push("Possible secret or key found; remove it.".into());
    }
    let reference = regex::Regex::new(r"\b(references|scripts|assets)/[\w.\-]+").unwrap();
    for path in reference.find_iter(body) {
        if !doc["files"]
            .as_array()
            .is_some_and(|files| files.iter().any(|file| file["path"] == path.as_str()))
        {
            warnings.push(format!(
                "SKILL.md mentions {}, which does not exist.",
                path.as_str()
            ));
        }
    }
    warnings.sort();
    warnings.dedup();
    let source: Value =
        serde_json::from_str(include_str!("../resources/studio.json")).expect("Studio resources");
    let mut rows = Vec::new();
    let mut sum = 0.0;
    for rubric in source["rubric"].as_array().unwrap() {
        let key = rubric[0].as_str().unwrap();
        let mut score = doc["audit"][key].as_f64().unwrap_or(3.0).clamp(1.0, 5.0);
        let mut evidence = "Model self-review".to_string();
        let cap = match key {
            "triggering" if !matches(r"(?i)\b(use|when)\b", description) => {
                Some((2.0, "Description does not say when to use it."))
            }
            "triggering" if !matches(r"(?i)\b(do not|not for|never)\b", description) => {
                Some((3.0, "No negative boundary."))
            }
            "progressive" if body.lines().count() > 500 => Some((2.0, "Body over 500 lines.")),
            "examples" if !body.to_lowercase().contains("example") => {
                Some((2.0, "No examples section."))
            }
            "robustness"
                if !matches("(?i)ambiguous|missing|incomplete|malformed|if .* not", body) =>
            {
                Some((3.0, "Missing ambiguous-input handling."))
            }
            "reliability" if !matches("(?i)verify|check|validate|re-?run", body) => {
                Some((3.0, "No verification step."))
            }
            "portability"
                if doc["files"].as_array().is_some_and(|files| {
                    files
                        .iter()
                        .any(|f| value(f, "path").starts_with("scripts/"))
                }) && !matches("(?i)fallback|manual|if .*cannot run|without", body) =>
            {
                Some((3.0, "Scripts without a manual fallback."))
            }
            "security" if issues.iter().any(|i| i.contains("secret")) => {
                Some((1.0, "Possible secret found."))
            }
            "maintainability" if value(doc, "version").is_empty() => Some((3.0, "No version.")),
            "testability"
                if doc["tests"]["positive"].as_array().map_or(0, Vec::len) < 5
                    || doc["tests"]["negative"].as_array().map_or(0, Vec::len) < 3
                    || doc["tests"]["cases"].as_array().map_or(0, Vec::len) < 3 =>
            {
                Some((
                    3.0,
                    "Tests below the 5 positive / 3 negative / 3 case target.",
                ))
            }
            _ => None,
        };
        if let Some((limit, reason)) = cap {
            if score > limit {
                score = limit;
                evidence = reason.into();
            }
        }
        sum += score;
        rows.push(json!({"key":key,"label":rubric[1],"score":score,"evidence":evidence}));
    }
    let average = if rows.is_empty() {
        0.0
    } else {
        sum / rows.len() as f64
    };
    json!({"validation":{"ok":issues.is_empty(),"issues":issues,"warnings":warnings},"audit":{"rows":rows,"average":average,"passed":average>=4.0&&issues.is_empty(),"notes":doc["audit"]["notes"].as_str().unwrap_or("")}})
}
pub fn markdown(doc: &Value, author: &str) -> Result<String> {
    let metadata = json!({"name":doc["name"],"description":doc["description"],"license":doc["license"].as_str().filter(|s|!s.is_empty()).unwrap_or("MIT"),"compatibility":doc["compatibility"],"metadata":{"author":doc["author"].as_str().filter(|s|!s.is_empty()).unwrap_or(author),"version":doc["version"].as_str().filter(|s|!s.is_empty()).unwrap_or("1.0.0")}});
    let yaml = serde_yaml::to_string(&metadata).map_err(|e| e.to_string())?;
    Ok(format!("---\n{yaml}---\n\n{}\n", value(doc, "body").trim()))
}
fn parse_markdown(text: &str) -> Result<Value> {
    let text = text.trim_start_matches('\u{feff}').replace("\r\n", "\n");
    let rest = text
        .strip_prefix("---\n")
        .ok_or("SKILL.md must start with YAML frontmatter")?;
    let (yaml, body) = rest
        .split_once("\n---")
        .ok_or("Missing frontmatter closing delimiter")?;
    let metadata: Value = serde_yaml::from_str(yaml).map_err(|e| e.to_string())?;
    Ok(
        json!({"name":metadata["name"],"description":metadata["description"],"license":metadata["license"],"compatibility":metadata["compatibility"],"author":metadata["metadata"]["author"],"version":metadata["metadata"]["version"].as_str().unwrap_or("1.0.0"),"body":body.trim_start_matches('\n'),"files":[]}),
    )
}
fn safe_zip_path(path: &str) -> bool {
    !path.is_empty()
        && !path.contains('\\')
        && Path::new(path)
            .components()
            .all(|part| matches!(part, std::path::Component::Normal(_)))
}
fn zip_entries(entries: &BTreeMap<String, Vec<u8>>) -> Result<Vec<u8>> {
    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    for (path, bytes) in entries {
        if !safe_zip_path(path) {
            return Err("Unsafe package path".into());
        }
        writer
            .start_file(path, SimpleFileOptions::default())
            .map_err(|e| e.to_string())?;
        writer.write_all(bytes).map_err(|e| e.to_string())?;
    }
    writer
        .finish()
        .map(|c| c.into_inner())
        .map_err(|e| e.to_string())
}
fn read_zip(bytes: Vec<u8>) -> Result<BTreeMap<String, Vec<u8>>> {
    if bytes.len() > 32 * 1024 * 1024 {
        return Err("Package exceeds 32 MB".into());
    }
    let mut archive = ZipArchive::new(Cursor::new(bytes)).map_err(|e| e.to_string())?;
    if archive.len() > 250 {
        return Err("Package contains too many files".into());
    }
    let mut entries = BTreeMap::new();
    let mut total = 0;
    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
        if file.is_dir() {
            continue;
        }
        let name = file.name().to_string();
        if !safe_zip_path(&name)
            || file.enclosed_name().is_none()
            || file.unix_mode().is_some_and(|m| m & 0o170000 == 0o120000)
        {
            return Err("Unsafe path or symbolic link in ZIP package".into());
        }
        total += file.size();
        if total > 16 * 1024 * 1024 {
            return Err("Unpacked package exceeds 16 MB".into());
        }
        let mut content = Vec::new();
        file.read_to_end(&mut content).map_err(|e| e.to_string())?;
        entries.insert(name, content);
    }
    Ok(entries)
}
fn document(row: &Value) -> Value {
    let parse = |key: &str, fallback: Value| {
        row[key]
            .as_str()
            .and_then(|s| serde_json::from_str(s).ok())
            .unwrap_or_else(|| {
                if row[key].is_null() {
                    fallback
                } else {
                    row[key].clone()
                }
            })
    };
    let meta = parse("meta", json!({}));
    json!({"name":row["name"],"description":row["description"],"body":row["instructions"],"files":parse("files",json!([])),"tests":parse("tests",json!({})),"license":meta["license"],"version":meta["version"],"compatibility":meta["compatibility"],"author":meta["author"],"audit":meta["audit"]})
}
fn parse_model_json(text: &str) -> Result<Value> {
    let offset = text
        .find('{')
        .ok_or("The model did not return a JSON object")?;
    serde_json::Deserializer::from_str(&text[offset..])
        .into_iter::<Value>()
        .next()
        .ok_or("No JSON object returned")?
        .map_err(|e| e.to_string())
}
async fn completion(backend: &Backend, p: &Value, system: &str, prompt: &str) -> Result<Value> {
    let response=backend.cloud.call("/v1/chat/completions",Some(json!({"model":p["model"],"stream":false,"max_tokens":16000,"messages":[{"role":"system","content":system},{"role":"user","content":prompt}]}))).await?;
    parse_model_json(
        response["choices"][0]["message"]["content"]
            .as_str()
            .ok_or("No generated text")?,
    )
}
pub async fn handle(backend: &Backend, channel: &str, args: &[Value]) -> Option<Result<Value>> {
    if !channel.starts_with("studio:") && channel != "conversations:export" {
        return None;
    }
    let a = args.first().cloned().unwrap_or(Value::Null);
    Some(async{let author=backend.db.setting("userName",json!("Orbi user"))?.as_str().unwrap_or("Orbi user").to_string();match channel{
        "studio:check"=>Ok(check(&a)),
        "studio:skillMd"=>Ok(json!(markdown(&a,&author)?)),
        "studio:ask"|"studio:build"=>{let resources:Value=serde_json::from_str(include_str!("../resources/studio.json")).unwrap();let kind=value(&a,"kind");let phase=if channel=="studio:ask"{"questions"}else{"build"};let template=&resources["prompts"][kind][phase];if template.is_null(){return Err("Unknown Creator Studio kind".into());}let system=value(template,"system");let prompt=format!("{}\n\nAnswers: {}\nCurrent: {}",value(template,"prompt").replace("{{brief}}",value(&a,"brief")),a["answers"],a["current"]);let item=completion(backend,&a,system,&prompt).await?;if phase=="questions"{Ok(item)}else{let mut result=json!({"item":item});if kind=="skill"{let check=check(&result["item"]);result["validation"]=check["validation"].clone();result["audit"]=check["audit"].clone();}Ok(result)}},
        "studio:exportSkill"=>{if check(&a)["validation"]["ok"]!=true{return Err("Fix validation issues before exporting this skill.".into());}let root=value(&a,"name");let mut entries=BTreeMap::new();entries.insert(format!("{root}/SKILL.md"),markdown(&a,&author)?.into_bytes());if let Some(files)=a["files"].as_array(){for file in files{let path=value(file,"path");if !safe_zip_path(path){return Err("Unsafe skill support-file path".into());}entries.insert(format!("{root}/{path}"),value(file,"content").as_bytes().to_vec());}}if !a["tests"].is_null(){entries.insert(format!("{root}/evals/tests.yaml"),serde_yaml::to_string(&a["tests"]).map_err(|e|e.to_string())?.into_bytes());}let data=zip_entries(&entries)?;if let Some(target)=rfd::AsyncFileDialog::new().set_file_name(format!("{root}.zip")).save_file().await{std::fs::write(target.path(),data).map_err(|e|e.to_string())?;Ok(json!(target.path()))}else{Ok(Value::Null)}},
        "studio:importSkill"=>{let Some(file)=rfd::AsyncFileDialog::new().add_filter("Agent Skill",&["zip","md","skill"]).pick_file().await else{return Ok(Value::Null);};if std::fs::metadata(file.path()).map_err(|e|e.to_string())?.len()>32*1024*1024{return Err("Package exceeds 32 MB".into());}let bytes=std::fs::read(file.path()).map_err(|e|e.to_string())?;if file.path().extension().is_some_and(|e|e=="md"){return parse_markdown(std::str::from_utf8(&bytes).map_err(|_|"Skill text must be UTF-8")?);}let entries=read_zip(bytes)?;let name=entries.keys().filter(|name|name.to_lowercase().ends_with("skill.md")).min_by_key(|s|s.len()).ok_or("No SKILL.md in package")?;let mut doc=parse_markdown(std::str::from_utf8(&entries[name]).map_err(|_|"SKILL.md must be UTF-8")?)?;let root=name.trim_end_matches("SKILL.md");let mut files=Vec::new();for(path,bytes)in &entries{if path!=name&&path.starts_with(root)&&bytes.len()<400000{let path=&path[root.len()..];if ["references/","scripts/","assets/","evals/"].iter().any(|prefix|path.starts_with(prefix)){if let Ok(content)=std::str::from_utf8(bytes){files.push(json!({"path":path,"content":content}));}}}}doc["files"]=json!(files);Ok(doc)},
        "studio:exportBundle"=>{let mut bundle=json!({"orbi":"bundle","version":1,"author":author,"agents":[],"teams":[],"harnesses":[],"skills":[]});for table in ["agents","teams","harnesses","skills"]{let mut rows=backend.db.query(&format!("SELECT * FROM {table} ORDER BY created_at"),&[])?;if let Some(ids)=a["ids"].as_array().filter(|v|!v.is_empty()){let wanted=match value(&a,"kind"){"agent"=>"agents","team"=>"teams","harness"=>"harnesses",_=>"skills"};if table==wanted{rows.retain(|row|ids.contains(&row["id"]));}}if table=="skills"{rows=rows.iter().map(document).collect();}bundle[table]=json!(rows);}let mut entries=BTreeMap::new();entries.insert("orbi-bundle/orbi-bundle.json".into(),serde_json::to_vec_pretty(&bundle).map_err(|e|e.to_string())?);for table in ["agents","teams","harnesses"]{if let Some(rows)=bundle[table].as_array(){for row in rows{let name=value(row,"id");if !safe_zip_path(name){return Err("Unsafe saved resource ID".into());}entries.insert(format!("orbi-bundle/{table}/{name}/README.md"),format!("# {}\n\n{}\n\n{}\n",value(row,"name"),value(row,"description"),value(row,"instructions")).into_bytes());}}}if let Some(rows)=bundle["skills"].as_array(){for doc in rows{let name=value(doc,"name");if !safe_zip_path(name){return Err("Unsafe skill name".into());}entries.insert(format!("orbi-bundle/skills/{name}/SKILL.md"),markdown(doc,&author)?.into_bytes());}}let data=zip_entries(&entries)?;if let Some(target)=rfd::AsyncFileDialog::new().set_file_name("orbi-bundle.zip").save_file().await{std::fs::write(target.path(),data).map_err(|e|e.to_string())?;Ok(json!(target.path()))}else{Ok(Value::Null)}},
        "studio:importBundle"=>{let Some(file)=rfd::AsyncFileDialog::new().add_filter("Orbi Bundle",&["zip"]).pick_file().await else{return Ok(Value::Null);};let entries=read_zip(std::fs::read(file.path()).map_err(|e|e.to_string())?)?;let (_,content)=entries.iter().find(|(name,_)|name.ends_with("orbi-bundle.json")).ok_or("No Orbi bundle metadata")?;let bundle:Value=serde_json::from_slice(content).map_err(|e|e.to_string())?;if bundle["orbi"]!="bundle"{return Err("Invalid bundle type".into());}let mut counts=json!({"agents":0,"teams":0,"harnesses":0,"skills":0});for table in ["agents","teams","harnesses","skills"]{if let Some(rows)=bundle[table].as_array(){for row in rows{let channel=match table{"agents"=>"agents:save","teams"=>"teams:save","harnesses"=>"harness:save",_=>"skills:save"};let mut input=row.clone();input["id"]=json!(crate::storage::uid());if table=="skills"{input["instructions"]=row["body"].clone();input["enabled"]=json!(0);input["meta"]=json!({"author":row["author"],"version":row["version"],"license":row["license"],"audit":row["audit"]});}crate::crud::handle(&backend.db,channel,&[input]).ok_or("Missing import handler")??;}counts[table]=json!(rows.len());}}Ok(counts)},
        "conversations:export"=>{let row=backend.db.query("SELECT * FROM conversations WHERE id=?",&[a.clone()])?.into_iter().next().ok_or("Conversation not found")?;let messages=backend.db.query("SELECT * FROM messages WHERE conversation_id=? ORDER BY created_at",&[a])?;let output=format!("# {}\n\n{}",value(&row,"title"),messages.iter().map(|message|format!("## {}\n\n{}\n",value(message,"role"),value(message,"content"))).collect::<Vec<_>>().join("\n"));if let Some(target)=rfd::AsyncFileDialog::new().set_file_name("conversation.md").save_file().await{std::fs::write(target.path(),output).map_err(|e|e.to_string())?;Ok(json!(true))}else{Ok(json!(false))}},
        _=>Err("Unknown Creator Studio operation".into())
    }}.await)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn skill_roundtrip_preserves_unicode_and_yaml_punctuation() {
        let doc = json!({"name":"test-skill","description":"Use when writing: examples #1","body":"# Olá\n\nVerify examples.","files":[]});
        let parsed = parse_markdown(&markdown(&doc, "Daniel").unwrap()).unwrap();
        assert_eq!(parsed["description"], doc["description"]);
        assert_eq!(parsed["body"], "# Olá\n\nVerify examples.\n");
    }
    #[test]
    fn archives_reject_parent_paths() {
        let mut entries = BTreeMap::new();
        entries.insert("../unsafe".into(), vec![1]);
        assert!(zip_entries(&entries).is_err());
    }
    #[test]
    fn invalid_skills_are_not_accepted() {
        assert_eq!(
            check(&json!({"name":"../../bad","description":"","body":""}))["validation"]["ok"],
            false
        );
    }
}
