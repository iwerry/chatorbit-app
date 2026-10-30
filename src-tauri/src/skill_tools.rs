use crate::storage::{Result, Storage};
use serde_json::{json, Value};

pub fn definitions() -> Vec<Value> {
    vec![
        json!({"name":"orbi-skills__load_skill","description":"Load the full instructions of an available skill before using it.","parameters":{"type":"object","properties":{"name":{"type":"string"}},"required":["name"]}}),
        json!({"name":"orbi-skills__read_skill_file","description":"Read a support file of an available skill when its instructions say so.","parameters":{"type":"object","properties":{"name":{"type":"string"},"path":{"type":"string"}},"required":["name","path"]}}),
    ]
}

pub fn call(db: &Storage, allowed: &[Value], tool: &str, args: &Value) -> Result<String> {
    let requested = args["name"].as_str().ok_or("Missing skill name")?;
    let rows = db.query("SELECT * FROM skills WHERE name=?", &[json!(requested)])?;
    let row = rows
        .iter()
        .find(|row| allowed.contains(&row["id"]))
        .ok_or("This skill is not available in the current conversation.")?;
    let files: Vec<Value> = row["files"]
        .as_str()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_default();
    match tool {
        "orbi-skills__load_skill" => Ok(json!({"name":row["name"],"instructions":row["instructions"],"files":files.iter().map(|f|f["path"].clone()).collect::<Vec<_>>()} ).to_string()),
        "orbi-skills__read_skill_file" => files.iter().find(|file|file["path"]==args["path"])
            .map(|file|json!({"path":file["path"],"content":file["content"]}).to_string())
            .ok_or("No such support file in this skill.".into()),
        _ => Err("Unknown skill tool".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn skill_reads_are_limited_to_the_selected_catalog() {
        let db = Storage::open(std::path::Path::new(":memory:")).unwrap();
        db.execute(
            "INSERT INTO skills(id,name,instructions,created_at,files) VALUES(?,?,?,?,?)",
            &[
                json!("a"),
                json!("Writing"),
                json!("Write clearly."),
                json!(1),
                json!([{ "path":"references/style.md","content":"Style" }]),
            ],
        )
        .unwrap();
        let args = json!({"name":"Writing","path":"references/style.md"});
        assert!(call(&db, &[], "orbi-skills__load_skill", &args).is_err());
        assert!(
            call(&db, &[json!("a")], "orbi-skills__read_skill_file", &args)
                .unwrap()
                .contains("Style")
        );
        assert!(call(
            &db,
            &[json!("a")],
            "orbi-skills__read_skill_file",
            &json!({"name":"Writing","path":"../../private"})
        )
        .is_err());
    }
}
