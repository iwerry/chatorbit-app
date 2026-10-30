use crate::storage::{now, uid, Result, Storage};
use serde_json::{json, Value};

fn upsert(db: &Storage, table: &str, fields: &[&str], input: &Value) -> Result<Value> {
    let mut row = input.as_object().cloned().ok_or("Expected an object")?;
    let id = row
        .get("id")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(String::from)
        .unwrap_or_else(uid);
    row.insert("id".into(), json!(id));
    row.entry("created_at").or_insert(json!(now()));
    row.insert("updated_at".into(), json!(now()));
    let columns: Vec<&str> = fields
        .iter()
        .copied()
        .filter(|key| row.contains_key(*key))
        .collect();
    let values: Vec<Value> = columns.iter().map(|key| row[*key].clone()).collect();
    let updates = columns
        .iter()
        .filter(|key| **key != "id" && **key != "created_at")
        .map(|key| format!("{key}=excluded.{key}"))
        .collect::<Vec<_>>()
        .join(",");
    let sql = format!(
        "INSERT INTO {table}({}) VALUES({}) ON CONFLICT(id) DO UPDATE SET {updates}",
        columns.join(","),
        vec!["?"; columns.len()].join(",")
    );
    db.execute(&sql, &values)?;
    Ok(db
        .query(&format!("SELECT * FROM {table} WHERE id=?"), &[json!(id)])?
        .into_iter()
        .next()
        .unwrap_or(Value::Null))
}

pub fn handle(db: &Storage, channel: &str, args: &[Value]) -> Option<Result<Value>> {
    let a = args.first().cloned().unwrap_or(Value::Null);
    let b = args.get(1).cloned().unwrap_or(Value::Null);
    let result = (|| -> Result<Value> {
        match channel {
            "conversations:create" => {
                let mut input = json!({"title":"New chat","project_id":null,"pinned":0,"model":""});
                if let Some(object) = a.as_object() {
                    for key in ["title", "project_id", "model"] {
                        if let Some(value) = object.get(key) {
                            input[key] = value.clone();
                        }
                    }
                }
                upsert(
                    db,
                    "conversations",
                    &[
                        "id",
                        "title",
                        "project_id",
                        "pinned",
                        "model",
                        "created_at",
                        "updated_at",
                    ],
                    &input,
                )
            }
            "conversations:update" | "messages:update" => {
                let (table, allowed): (&str, &[&str]) = if channel == "messages:update" {
                    ("messages", &["content", "tools", "attachments"])
                } else {
                    (
                        "conversations",
                        &["title", "project_id", "pinned", "model", "updated_at"],
                    )
                };
                let object = b.as_object().ok_or("Expected an update object")?;
                for key in allowed {
                    if let Some(value) = object.get(*key) {
                        db.execute(
                            &format!("UPDATE {table} SET {key}=? WHERE id=?"),
                            &[value.clone(), a.clone()],
                        )?;
                    }
                }
                Ok(Value::Null)
            }
            "messages:add" => {
                let mut input = json!({"role":"user","content":"","model":"","attachments":[],"tools":[],"bookmarked":0});
                if let Some(object) = a.as_object() {
                    for (key, value) in object {
                        input[key] = value.clone();
                    }
                }
                upsert(
                    db,
                    "messages",
                    &[
                        "id",
                        "conversation_id",
                        "role",
                        "content",
                        "model",
                        "attachments",
                        "tools",
                        "bookmarked",
                        "created_at",
                    ],
                    &input,
                )
            }
            "messages:bookmark" => {
                db.execute("UPDATE messages SET bookmarked=? WHERE id=?", &[b, a])?;
                Ok(Value::Null)
            }
            "skills:toggle" => {
                db.execute(
                    "UPDATE skills SET enabled=? WHERE id=?",
                    &[json!(b.as_bool().unwrap_or(false)), a],
                )?;
                Ok(Value::Null)
            }
            "boards:rename" => {
                db.execute("UPDATE boards SET name=? WHERE id=?", &[b, a])?;
                Ok(Value::Null)
            }
            "media:setBoard" => {
                db.execute("UPDATE media SET board=? WHERE id=?", &[b, a])?;
                Ok(Value::Null)
            }
            "agents:save" | "skills:save" | "teams:save" | "harness:save" => {
                let (table, fields): (&str, &[&str]) = match channel {
                    "agents:save" => (
                        "agents",
                        &[
                            "id",
                            "handle",
                            "instructions",
                            "name",
                            "description",
                            "model",
                            "category",
                            "tools",
                            "skills_mode",
                            "skills",
                            "starters",
                            "support_name",
                            "support_email",
                            "color",
                            "created_at",
                        ],
                    ),
                    "skills:save" => (
                        "skills",
                        &[
                            "id",
                            "name",
                            "description",
                            "instructions",
                            "enabled",
                            "created_at",
                            "library_id",
                            "files",
                            "tests",
                            "meta",
                        ],
                    ),
                    "teams:save" => (
                        "teams",
                        &[
                            "id",
                            "handle",
                            "name",
                            "description",
                            "mode",
                            "members",
                            "synthesizer",
                            "created_at",
                        ],
                    ),
                    _ => (
                        "harnesses",
                        &["id", "name", "description", "config", "created_at"],
                    ),
                };
                let saved = upsert(db, table, fields, &a)?;
                Ok(saved["id"].clone())
            }
            "projects:delete" => {
                db.execute(
                    "UPDATE conversations SET project_id=NULL WHERE project_id=?",
                    &[a.clone()],
                )?;
                db.execute("DELETE FROM projects WHERE id=?", &[a])?;
                Ok(Value::Null)
            }
            "boards:delete" => {
                db.execute("UPDATE media SET board='' WHERE board=?", &[a.clone()])?;
                db.execute("DELETE FROM boards WHERE id=?", &[a])?;
                Ok(Value::Null)
            }
            "conversations:delete" => {
                db.execute("DELETE FROM messages WHERE conversation_id=?", &[a.clone()])?;
                db.execute("DELETE FROM conversations WHERE id=?", &[a])?;
                Ok(Value::Null)
            }
            "messages:delete" | "memories:delete" | "agents:delete" | "skills:delete"
            | "teams:delete" | "harness:delete" => {
                let table = match channel {
                    "messages:delete" => "messages",
                    "memories:delete" => "memories",
                    "agents:delete" => "agents",
                    "skills:delete" => "skills",
                    "teams:delete" => "teams",
                    _ => "harnesses",
                };
                db.execute(&format!("DELETE FROM {table} WHERE id=?"), &[a])?;
                Ok(Value::Null)
            }
            _ => return Err("not handled".into()),
        }
    })();
    if result
        .as_ref()
        .err()
        .is_some_and(|message| message == "not handled")
    {
        None
    } else {
        Some(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn conversation_and_message_survive_roundtrip() {
        let db = Storage::open(std::path::Path::new(":memory:")).unwrap();
        let conversation = handle(
            &db,
            "conversations:create",
            &[json!({"title":"native chat"})],
        )
        .unwrap()
        .unwrap();
        let message=handle(&db,"messages:add", &[json!({"conversation_id":conversation["id"],"content":"quote ' remains data","attachments":[]})]).unwrap().unwrap();
        assert_eq!(message["content"], "quote ' remains data");
        handle(&db, "conversations:delete", &[conversation["id"].clone()])
            .unwrap()
            .unwrap();
        assert!(db.query("SELECT * FROM messages", &[]).unwrap().is_empty());
    }
}
