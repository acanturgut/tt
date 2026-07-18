use std::path::{Path, PathBuf};

#[derive(Clone, Debug, Default, PartialEq)]
pub struct ClaudeStatus {
    pub title: Option<String>,
    pub tokens: u64,
}

pub fn read_status(path: &Path) -> ClaudeStatus {
    let mut out = ClaudeStatus::default();
    let content = match std::fs::read_to_string(path) {
        Ok(c) => c,
        Err(_) => return out,
    };
    for line in content.lines() {
        let v: serde_json::Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        match v.get("type").and_then(|t| t.as_str()) {
            Some("ai-title") => {
                if let Some(t) = v.get("aiTitle").and_then(|x| x.as_str()) {
                    out.title = Some(t.to_string());
                }
            }
            Some("assistant") => {
                if let Some(u) = v.pointer("/message/usage") {
                    let g = |k: &str| u.get(k).and_then(|x| x.as_u64()).unwrap_or(0);
                    out.tokens = g("input_tokens")
                        + g("cache_creation_input_tokens")
                        + g("cache_read_input_tokens")
                        + g("output_tokens");
                }
            }
            _ => {}
        }
    }
    out
}

pub fn slug_for(dir: &str) -> String {
    dir.chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect()
}

// The exact session file for a tt-spawned claude agent. We pass claude
// `--session-id <sid>`, so its jsonl is deterministically `<slug>/<sid>.jsonl` —
// no guessing "newest file", which would cross two claudes in the same folder.
pub fn session_file(projects_root: &Path, dir: &str, session_id: &str) -> PathBuf {
    projects_root
        .join(slug_for(dir))
        .join(format!("{session_id}.jsonl"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn slug_replaces_non_alnum_with_dash() {
        assert_eq!(slug_for("/Users/x/p"), "-Users-x-p");
        assert_eq!(slug_for("/a/.claude/w"), "-a--claude-w");
    }

    #[test]
    fn read_status_extracts_latest_title_and_token_sum() {
        let mut f = tempfile::NamedTempFile::new().unwrap();
        writeln!(f, r#"{{"type":"ai-title","aiTitle":"old title"}}"#).unwrap();
        writeln!(
            f,
            r#"{{"type":"assistant","message":{{"role":"assistant","usage":{{"input_tokens":2,"cache_creation_input_tokens":31,"cache_read_input_tokens":100,"output_tokens":10}}}}}}"#
        )
        .unwrap();
        writeln!(f, r#"{{"type":"ai-title","aiTitle":"Fixing pane colors"}}"#).unwrap();

        let st = read_status(f.path());
        assert_eq!(st.title.as_deref(), Some("Fixing pane colors"));
        assert_eq!(st.tokens, 2 + 31 + 100 + 10);
    }
}
