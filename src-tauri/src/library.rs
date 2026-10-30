use crate::{
    storage::{now, uid, Result},
    Backend,
};
use serde_json::{json, Value};
use std::sync::OnceLock;
fn data() -> &'static Value {
    static DATA: OnceLock<Value> = OnceLock::new();
    DATA.get_or_init(|| {
        serde_json::from_str(include_str!("../resources/library.json"))
            .expect("Bundled library JSON")
    })
}
pub fn plugins() -> Value {
    serde_json::from_str(include_str!("../resources/plugins.json")).expect("Bundled plugin JSON")
}
pub fn catalog() -> Value {
    serde_json::from_str(include_str!("../resources/catalog.json"))
        .expect("Bundled MCP catalog JSON")
}
fn install(backend: &Backend, id: &str, agent: bool) -> Result<Value> {
    let kind = if agent { "agents" } else { "skills" };
    let row = data()[kind]
        .as_array()
        .and_then(|rows| rows.iter().find(|row| row["id"] == id))
        .ok_or("Library item not found")?;
    if agent {
        if !backend
            .db
            .query(
                "SELECT id FROM agents WHERE handle=?",
                &[row["handle"].clone()],
            )?
            .is_empty()
        {
            return Ok(json!(true));
        }
        crate::crud::handle(&backend.db,"agents:save",&[json!({"id":uid(),"handle":row["handle"],"name":row["name"],"description":row["description"],"instructions":row["instructions"],"category":row["category"],"starters":row["starters"]})]).ok_or("Missing agent storage")??;
    } else {
        if !backend
            .db
            .query(
                "SELECT id FROM skills WHERE library_id=? OR name=?",
                &[row["id"].clone(), row["name"].clone()],
            )?
            .is_empty()
        {
            return Ok(json!(true));
        }
        let result=crate::crud::handle(&backend.db,"skills:save",&[json!({"id":uid(),"name":row["name"],"description":row["description"],"instructions":row["instructions"],"enabled":0,"created_at":now(),"library_id":row["id"],"files":row["files"].as_array().cloned().unwrap_or_default(),"tests":row["tests"].as_object().cloned().unwrap_or_default(),"meta":{"author":row["author"],"license":row["license"]}})]).ok_or("Missing skill storage")??;
        let _ = result;
    }
    Ok(json!(true))
}
pub fn handle(backend: &Backend, channel: &str, args: &[Value]) -> Option<Result<Value>> {
    let a = args.first().cloned().unwrap_or(Value::Null);
    let b = args.get(1).cloned().unwrap_or(Value::Null);
    if !channel.starts_with("library:") && !channel.starts_with("plugins:") {
        return None;
    }
    Some((|| match channel {
        "library:get" => {
            let mut library = data().clone();
            let skills = backend
                .db
                .query("SELECT library_id,name FROM skills", &[])?;
            let agents = backend.db.query("SELECT handle FROM agents", &[])?;
            if let Some(rows) = library["skills"].as_array_mut() {
                for row in rows {
                    row["installed"] = json!(skills
                        .iter()
                        .any(|s| s["library_id"] == row["id"] || s["name"] == row["name"]));
                }
            }
            if let Some(rows) = library["agents"].as_array_mut() {
                for row in rows {
                    row["installed"] = json!(agents.iter().any(|a| a["handle"] == row["handle"]));
                }
            }
            if let Some(rows) = library["kits"].as_array_mut() {
                for row in rows {
                    row["installed"] = json!(row["skills"].as_array().is_some_and(|ids| ids
                        .iter()
                        .all(|id| skills
                            .iter()
                            .any(|s| s["library_id"] == *id || s["name"] == *id))));
                }
            }
            Ok(library)
        }
        "library:installSkill" => install(backend, a.as_str().ok_or("Missing skill ID")?, false),
        "library:installAgent" => install(backend, a.as_str().ok_or("Missing agent ID")?, true),
        "library:installKit" => {
            let kit = data()["kits"]
                .as_array()
                .and_then(|rows| rows.iter().find(|row| row["id"] == a))
                .ok_or("Unknown kit")?;
            for kind in ["skills", "agents"] {
                if let Some(ids) = kit[kind].as_array() {
                    for id in ids {
                        install(
                            backend,
                            id.as_str().ok_or("Invalid library ID")?,
                            kind == "agents",
                        )?;
                    }
                }
            }
            Ok(json!(true))
        }
        "plugins:list" | "plugins:set" => {
            let mut active: Vec<String> =
                serde_json::from_value(backend.db.setting("plugins", json!([]))?)
                    .map_err(|_| "Invalid plugin settings")?;
            if channel == "plugins:set" {
                let id = a.as_str().ok_or("Missing plugin ID")?;
                let source = plugins();
                let plugin = source
                    .as_array()
                    .and_then(|rows| rows.iter().find(|p| p["id"] == id))
                    .ok_or("Unknown plugin")?;
                active.retain(|item| item != id);
                if b.as_bool().unwrap_or(false) {
                    active.push(id.into());
                    if let Some(skills) = plugin["skills"].as_array() {
                        for name in skills {
                            backend.db.execute(
                                "UPDATE skills SET enabled=1 WHERE name=?",
                                &[name.clone()],
                            )?;
                        }
                    }
                    if let Some(agents) = plugin["agents"].as_array() {
                        for agent in agents {
                            if backend
                                .db
                                .query(
                                    "SELECT id FROM agents WHERE handle=?",
                                    &[agent["handle"].clone()],
                                )?
                                .is_empty()
                            {
                                crate::crud::handle(&backend.db, "agents:save", &[agent.clone()])
                                    .ok_or("Missing agent handler")??;
                            }
                        }
                    }
                }
                backend.db.set_setting("plugins", &json!(active))?;
            }
            let mut result = plugins();
            if let Some(rows) = result.as_array_mut() {
                for row in rows {
                    row["enabled"] = json!(row["id"]
                        .as_str()
                        .is_some_and(|id| active.iter().any(|a| a == id)));
                }
            }
            Ok(result)
        }
        _ => Err("Unknown library operation".into()),
    })())
}
