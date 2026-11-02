// One-time import of the Electron data folder (%APPDATA%\Orbi, ~/Library/Application Support/Orbi, ~/.config/Orbi).
// The Electron folder is only read: the database is copied with the SQLite backup API, media files are copied without
// overwriting, and an existing native database with user data is never replaced.
use crate::storage::{now, Result};
use rusqlite::{Connection, DatabaseName, OpenFlags};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

const MARKER: &str = "electron-migration.json";
// Electron keeps these encrypted with its own safeStorage key (or base64 when encryption was unavailable).
// The native app cannot use them and must not keep a second copy: sign-in and MCP servers live in the OS credential store.
const DROPPED_SETTINGS: &str =
    "DELETE FROM settings WHERE key IN ('cloudRefresh','mcpServers') OR key LIKE 'provider:%'";
const USER_TABLES: [&str; 6] = [
    "conversations",
    "media",
    "memories",
    "workflows",
    "boards",
    "projects",
];

fn io(e: impl std::fmt::Display) -> String {
    e.to_string()
}
fn count(db: &Connection, table: &str) -> i64 {
    db.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
        row.get(0)
    })
    .unwrap_or(0)
}
fn has_user_data(path: &Path) -> Result<bool> {
    let db = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(io)?;
    Ok(USER_TABLES.iter().any(|table| count(&db, table) > 0))
}
fn set_aside(path: &Path, backups: &Path, stamp: u64) -> Result<()> {
    for suffix in ["", "-wal", "-shm"] {
        let file = PathBuf::from(format!("{}{suffix}", path.display()));
        if file.exists() {
            std::fs::rename(
                &file,
                backups.join(format!("orbi-empty-{stamp}.db{suffix}")),
            )
            .map_err(io)?;
        }
    }
    Ok(())
}
// Electron stores the bare file name; the native app stores the absolute path inside its own media folder.
fn rebase_media(db: &Connection, legacy_media: &Path, media: &Path) -> Result<()> {
    let rows: Vec<(String, String)> = {
        let mut statement = db.prepare("SELECT id, file FROM media").map_err(io)?;
        let rows = statement
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .map_err(io)?;
        rows.collect::<std::result::Result<_, _>>().map_err(io)?
    };
    for (id, file) in rows {
        let path = Path::new(&file);
        let name = match path.file_name() {
            Some(name) if path.is_relative() && path.components().count() == 1 => name,
            Some(name) if path.starts_with(legacy_media) => name,
            _ => continue,
        };
        let target = media.join(name);
        db.execute(
            "UPDATE media SET file=? WHERE id=?",
            [target.to_string_lossy().as_ref(), id.as_str()],
        )
        .map_err(io)?;
    }
    Ok(())
}
fn copy_media(from: &Path, to: &Path) -> Result<(u64, u64)> {
    let (mut copied, mut kept) = (0, 0);
    let Ok(entries) = std::fs::read_dir(from) else {
        return Ok((0, 0));
    };
    for entry in entries {
        let entry = entry.map_err(io)?;
        if !entry.file_type().map_err(io)?.is_file() {
            continue;
        }
        let target = to.join(entry.file_name());
        if target.exists() {
            kept += 1;
            continue;
        }
        let partial = to.join(format!("{}.migrating", entry.file_name().to_string_lossy()));
        std::fs::copy(entry.path(), &partial).map_err(io)?;
        std::fs::rename(&partial, &target).map_err(io)?;
        copied += 1;
    }
    Ok((copied, kept))
}
fn write_marker(root: &Path, report: &Value) -> Result<()> {
    std::fs::write(
        root.join(MARKER),
        serde_json::to_vec_pretty(report).map_err(io)?,
    )
    .map_err(io)
}

/// Runs before the native database is opened. Returns the report when this launch did something,
/// `None` when there was nothing to do. On error nothing is marked, so the next launch tries again.
pub fn migrate(legacy: &Path, root: &Path) -> Result<Option<Value>> {
    let source = legacy.join("orbi.db");
    if root.join(MARKER).exists() || !source.is_file() || legacy == root {
        return Ok(None);
    }
    let target = root.join("orbi.db");
    let backups = root.join("backups");
    let media = root.join("media");
    std::fs::create_dir_all(&backups).map_err(io)?;
    std::fs::create_dir_all(&media).map_err(io)?;
    let stamp = now();
    if target.exists() {
        if has_user_data(&target)? {
            let report = json!({"status":"skipped","reason":"The native database already has user data.","from":legacy,"at":stamp});
            write_marker(root, &report)?;
            return Ok(Some(report));
        }
        set_aside(&target, &backups, stamp)?;
    }
    std::fs::copy(&source, backups.join(format!("electron-orbi-{stamp}.db"))).map_err(io)?;
    let partial = root.join("orbi.db.migrating");
    let _ = std::fs::remove_file(&partial);
    let result = (|| -> Result<Value> {
        Connection::open_with_flags(&source, OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(io)?
            .backup(DatabaseName::Main, &partial, None)
            .map_err(io)?;
        let mut db = Connection::open(&partial).map_err(io)?;
        let check: String = db
            .query_row("PRAGMA integrity_check", [], |row| row.get(0))
            .map_err(io)?;
        if check != "ok" {
            return Err(format!(
                "The Electron database failed the integrity check: {check}"
            ));
        }
        let tx = db.transaction().map_err(io)?;
        tx.execute_batch(DROPPED_SETTINGS).map_err(io)?;
        rebase_media(&tx, &legacy.join("media"), &media)?;
        tx.commit().map_err(io)?;
        let rows: serde_json::Map<String, Value> = USER_TABLES
            .iter()
            .chain(&["messages"])
            .map(|t| (t.to_string(), json!(count(&db, t))))
            .collect();
        drop(db);
        let (copied, kept) = copy_media(&legacy.join("media"), &media)?;
        std::fs::rename(&partial, &target).map_err(io)?;
        Ok(
            json!({"status":"migrated","from":legacy,"at":stamp,"rows":rows,"mediaCopied":copied,"mediaKept":kept}),
        )
    })();
    match result {
        Ok(report) => {
            write_marker(root, &report)?;
            Ok(Some(report))
        }
        Err(error) => {
            let _ = std::fs::remove_file(&partial);
            Err(error)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn dirs(name: &str) -> (PathBuf, PathBuf) {
        let base =
            std::env::temp_dir().join(format!("orbi-legacy-{name}-{}", crate::storage::uid()));
        let (legacy, root) = (base.join("Orbi"), base.join("com.orbix.orbi"));
        std::fs::create_dir_all(legacy.join("media")).unwrap();
        std::fs::create_dir_all(&root).unwrap();
        (legacy, root)
    }
    fn electron_db(legacy: &Path) {
        let db = Connection::open(legacy.join("orbi.db")).unwrap();
        db.execute_batch(include_str!("schema.sql")).unwrap();
        db.execute_batch(
            "INSERT INTO conversations(id,title,created_at,updated_at) VALUES('c1','Olá',1,1);
             INSERT INTO messages(id,conversation_id,role,content,created_at) VALUES('m1','c1','user','ação',1);
             INSERT INTO media(id,kind,name,file,created_at) VALUES('p1','image','a','p1.png',1);
             INSERT INTO settings VALUES('cloudRefresh','\"enc:abc\"'),('provider:openai','{}'),('mcpServers','[]'),('userName','\"Daniel\"');",
        )
        .unwrap();
        std::fs::write(legacy.join("media").join("p1.png"), b"png").unwrap();
    }

    #[test]
    fn electron_data_is_copied_and_media_paths_rebased() {
        let (legacy, root) = dirs("copy");
        electron_db(&legacy);
        let report = migrate(&legacy, &root).unwrap().unwrap();
        assert_eq!(report["status"], "migrated");
        assert_eq!(report["mediaCopied"], 1);
        let db = crate::storage::Storage::open(&root.join("orbi.db")).unwrap();
        assert_eq!(
            db.query("SELECT content FROM messages", &[]).unwrap()[0]["content"],
            "ação"
        );
        let file = db.query("SELECT file FROM media", &[]).unwrap()[0]["file"]
            .as_str()
            .unwrap()
            .to_string();
        assert_eq!(Path::new(&file), root.join("media").join("p1.png"));
        assert_eq!(std::fs::read(&file).unwrap(), b"png");
        let keys: Vec<Value> = db
            .query("SELECT key FROM settings ORDER BY key", &[])
            .unwrap()
            .into_iter()
            .map(|r| r["key"].clone())
            .collect();
        assert_eq!(keys, vec![json!("userName")]);
        assert!(legacy.join("orbi.db").exists() && legacy.join("media").join("p1.png").exists());
        assert!(migrate(&legacy, &root).unwrap().is_none(), "runs only once");
    }

    #[test]
    fn native_database_with_user_data_is_never_replaced() {
        let (legacy, root) = dirs("keep");
        electron_db(&legacy);
        let native = crate::storage::Storage::open(&root.join("orbi.db")).unwrap();
        native
            .execute("INSERT INTO memories VALUES('n1','nativa',1)", &[])
            .unwrap();
        drop(native);
        assert_eq!(
            migrate(&legacy, &root).unwrap().unwrap()["status"],
            "skipped"
        );
        let db = crate::storage::Storage::open(&root.join("orbi.db")).unwrap();
        assert_eq!(db.query("SELECT id FROM memories", &[]).unwrap().len(), 1);
        assert!(db
            .query("SELECT id FROM conversations", &[])
            .unwrap()
            .is_empty());
    }

    #[test]
    fn empty_native_database_is_set_aside_and_existing_media_is_kept() {
        let (legacy, root) = dirs("empty");
        electron_db(&legacy);
        drop(crate::storage::Storage::open(&root.join("orbi.db")).unwrap());
        std::fs::create_dir_all(root.join("media")).unwrap();
        std::fs::write(root.join("media").join("p1.png"), b"native").unwrap();
        let report = migrate(&legacy, &root).unwrap().unwrap();
        assert_eq!(
            (report["mediaCopied"].as_u64(), report["mediaKept"].as_u64()),
            (Some(0), Some(1))
        );
        assert_eq!(
            std::fs::read(root.join("media").join("p1.png")).unwrap(),
            b"native"
        );
        let backups: Vec<_> = std::fs::read_dir(root.join("backups"))
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().to_string())
            .collect();
        assert!(
            backups.iter().any(|n| n.starts_with("orbi-empty-"))
                && backups.iter().any(|n| n.starts_with("electron-orbi-"))
        );
    }

    #[test]
    fn nothing_happens_without_an_electron_database() {
        let (legacy, root) = dirs("none");
        assert!(migrate(&legacy, &root).unwrap().is_none());
        assert!(!root.join(MARKER).exists());
    }

    // Manual check against a copy of a real Electron folder:
    // ORBI_MIGRATION_SOURCE=<copy of %APPDATA%\Orbi> cargo test --lib real_copy -- --ignored --nocapture
    #[test]
    #[ignore]
    fn real_copy_of_electron_folder_opens_in_native_storage() {
        let legacy = PathBuf::from(std::env::var("ORBI_MIGRATION_SOURCE").unwrap());
        let root = legacy.with_file_name(format!("orbi-native-{}", crate::storage::uid()));
        let report = migrate(&legacy, &root).unwrap().unwrap();
        println!("{report:#}\ntarget: {}", root.display());
        let db = crate::storage::Storage::open(&root.join("orbi.db")).unwrap();
        for row in db.query("SELECT file FROM media", &[]).unwrap() {
            assert!(Path::new(row["file"].as_str().unwrap()).is_file(), "{row}");
        }
    }
}
