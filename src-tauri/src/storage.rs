use rusqlite::{params_from_iter, types::Value as SqlValue, Connection};
use serde_json::{json, Map, Value};
use std::{path::Path, sync::Mutex};

pub type Result<T> = std::result::Result<T, String>;
pub struct Storage(Mutex<Connection>);
pub fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
pub fn uid() -> String {
    uuid::Uuid::new_v4().to_string()
}
fn sql_value(value: &Value) -> SqlValue {
    match value {
        Value::Null => SqlValue::Null,
        Value::Bool(b) => SqlValue::Integer(i64::from(*b)),
        Value::Number(n) => n
            .as_i64()
            .map(SqlValue::Integer)
            .unwrap_or_else(|| SqlValue::Real(n.as_f64().unwrap_or(0.0))),
        Value::String(s) => SqlValue::Text(s.clone()),
        other => SqlValue::Text(other.to_string()),
    }
}
impl Storage {
    pub fn open(path: &Path) -> Result<Self> {
        let db = Connection::open(path).map_err(|e| e.to_string())?;
        db.busy_timeout(std::time::Duration::from_secs(10))
            .map_err(|e| e.to_string())?;
        db.execute_batch(include_str!("schema.sql"))
            .map_err(|e| e.to_string())?;
        let migrations: std::collections::BTreeMap<
            String,
            std::collections::BTreeMap<String, String>,
        > = serde_json::from_str(include_str!("columns.json")).map_err(|e| e.to_string())?;
        for (table, columns) in migrations {
            let present: Vec<String> = {
                let mut statement = db
                    .prepare(&format!("PRAGMA table_info({table})"))
                    .map_err(|e| e.to_string())?;
                let names = statement
                    .query_map([], |row| row.get(1))
                    .map_err(|e| e.to_string())?;
                names
                    .collect::<std::result::Result<Vec<_>, _>>()
                    .map_err(|e| e.to_string())?
            };
            for (column, declaration) in columns {
                if !present.contains(&column) {
                    db.execute_batch(&format!(
                        "ALTER TABLE {table} ADD COLUMN {column} {declaration}"
                    ))
                    .map_err(|e| e.to_string())?;
                }
            }
        }
        db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
            .map_err(|e| e.to_string())?;
        Ok(Self(Mutex::new(db)))
    }
    pub fn query(&self, sql: &str, values: &[Value]) -> Result<Vec<Value>> {
        let guard = self.0.lock().map_err(|e| e.to_string())?;
        let mut statement = guard.prepare(sql).map_err(|e| e.to_string())?;
        let names: Vec<String> = statement
            .column_names()
            .iter()
            .map(|s| s.to_string())
            .collect();
        let parameters: Vec<SqlValue> = values.iter().map(sql_value).collect();
        let rows = statement
            .query_map(params_from_iter(parameters), |row| {
                let mut object = Map::new();
                for (i, name) in names.iter().enumerate() {
                    let value = match row.get_ref(i)? {
                        rusqlite::types::ValueRef::Null => Value::Null,
                        rusqlite::types::ValueRef::Integer(v) => json!(v),
                        rusqlite::types::ValueRef::Real(v) => json!(v),
                        rusqlite::types::ValueRef::Text(v) => json!(String::from_utf8_lossy(v)),
                        rusqlite::types::ValueRef::Blob(_) => {
                            return Err(rusqlite::Error::InvalidQuery)
                        }
                    };
                    object.insert(name.clone(), value);
                }
                Ok(Value::Object(object))
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }
    pub fn execute(&self, sql: &str, values: &[Value]) -> Result<usize> {
        let guard = self.0.lock().map_err(|e| e.to_string())?;
        let parameters: Vec<SqlValue> = values.iter().map(sql_value).collect();
        guard
            .execute(sql, params_from_iter(parameters))
            .map_err(|e| e.to_string())
    }
    pub fn setting(&self, key: &str, fallback: Value) -> Result<Value> {
        let rows = self.query("SELECT value FROM settings WHERE key = ?", &[json!(key)])?;
        Ok(rows
            .first()
            .and_then(|r| r["value"].as_str())
            .and_then(|s| serde_json::from_str(s).ok())
            .unwrap_or(fallback))
    }
    pub fn set_setting(&self, key: &str, value: &Value) -> Result<Value> {
        self.execute("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", &[json!(key), json!(value.to_string())])?;
        Ok(Value::Null)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn settings_roundtrip_preserves_types_and_quotes() {
        let db = Storage::open(Path::new(":memory:")).unwrap();
        let data = json!({"prompt":"user's prompt; DROP TABLE settings;", "flag":true,"count":3});
        db.set_setting("draft", &data).unwrap();
        assert_eq!(db.setting("draft", Value::Null).unwrap(), data);
        assert_eq!(db.setting("absent", json!(false)).unwrap(), json!(false));
    }
    #[test]
    fn independent_workflows_have_distinct_rows() {
        let db = Storage::open(Path::new(":memory:")).unwrap();
        for id in ["flow", "flow-two"] {
            db.execute(
                "INSERT INTO workflows VALUES(?,?,?,?)",
                &[json!(id), json!(id), json!("{}"), json!(now())],
            )
            .unwrap();
        }
        assert_eq!(db.query("SELECT * FROM workflows", &[]).unwrap().len(), 2);
    }
}
