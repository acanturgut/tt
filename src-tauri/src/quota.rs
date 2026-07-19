// Account-level quota ("how much of my plan is left"), per provider.
//
// Deliberately NOT part of claude_watch.rs: that watches ONE session's jsonl for
// that agent's cumulative tokens and dies with the agent. This is account-global,
// covers two providers, and stays alive with zero agents running. They share
// nothing but the word "usage".
//
// Both providers expose the same thing — percent USED per named window + a reset
// time — so both normalize onto Window. Neither exposes absolute token budgets.
use std::path::{Path, PathBuf};

#[derive(Clone, Debug, PartialEq, serde::Serialize)]
pub struct Window {
    pub provider: &'static str, // "claude" | "codex"
    pub key: String,            // "session" | "weekly_all" | "weekly_scoped:Fable" | "5h" | "7d"
    pub label: String,          // human: "Session" | "Weekly" | "Weekly · Fable"
    pub percent_used: f32,
    pub resets_at: i64,  // epoch seconds
    pub fetched_at: i64, // epoch seconds — how current this reading is (differs wildly per provider)
}

pub fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

// Days since 1970-01-01 from a civil date (Howard Hinnant's algorithm).
// ponytail: 6 lines beats adding chrono for one timestamp format.
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719468
}

// "2026-07-19T13:49:59.688421+00:00" or "...Z" -> epoch seconds.
// Both providers' timestamps are fixed-shape, so parse by position, not regex.
pub fn parse_iso_epoch(s: &str) -> Option<i64> {
    let b = s.as_bytes();
    if b.len() < 19 || b[4] != b'-' || b[7] != b'-' || (b[10] != b'T' && b[10] != b' ') {
        return None;
    }
    let n = |a: usize, z: usize| s.get(a..z)?.parse::<i64>().ok();
    let (y, mo, d) = (n(0, 4)?, n(5, 7)?, n(8, 10)?);
    let (h, mi, sec) = (n(11, 13)?, n(14, 16)?, n(17, 19)?);
    // Range-check before trusting the arithmetic: days_from_civil happily turns
    // month 13 or hour 99 into a real epoch, and a corrupt provider timestamp
    // becoming a plausible reset time is worse than treating it as unknown.
    // ponytail: range check only — 2025-02-29 still slips through as Mar 1, which
    // costs a day on a date that shouldn't exist. Full leap validation if it ever matters.
    if !(1..=12).contains(&mo) || !(1..=31).contains(&d) || h > 23 || mi > 59 || sec > 60 {
        return None;
    }
    let mut t = days_from_civil(y, mo, d) * 86400 + h * 3600 + mi * 60 + sec;
    // Trailing offset: Z (or absent) = UTC; otherwise ±HH:MM, which we subtract to get UTC.
    let tail = &s[19..];
    if let Some(i) = tail.rfind(['+', '-']) {
        let off = &tail[i..];
        if off.len() >= 6 {
            let sign = if off.starts_with('-') { -1 } else { 1 };
            let oh: i64 = off.get(1..3)?.parse().ok()?;
            let om: i64 = off.get(4..6)?.parse().ok()?;
            t -= sign * (oh * 3600 + om * 60);
        }
    }
    Some(t)
}

fn home() -> PathBuf {
    PathBuf::from(std::env::var("HOME").unwrap_or_default())
}

// ---------------------------------------------------------------- claude
//
// ~/.claude.json (the $HOME dotfile, NOT ~/.claude/) -> cachedUsageUtilization.
// This is a CACHE that Claude Code refreshes on its own schedule; we cannot force
// it (no usage subcommand, headless -p doesn't refresh it, token is in Keychain).
// So fetched_at is load-bearing, not decoration — see displayState in quota.ts.
//
// Read utilization.limits[], not the legacy five_hour/seven_day keys: limits[] is
// the generalized shape and carries the per-model (scope) entries the others can't.
pub fn parse_claude(json: &str) -> Vec<Window> {
    let v: serde_json::Value = match serde_json::from_str(json) {
        Ok(v) => v,
        Err(_) => return vec![],
    };
    let c = match v.get("cachedUsageUtilization") {
        Some(c) => c,
        None => return vec![],
    };
    let fetched_at = c
        .get("fetchedAtMs")
        .and_then(|x| x.as_i64())
        .unwrap_or(0)
        / 1000;
    let limits = match c.pointer("/utilization/limits").and_then(|l| l.as_array()) {
        Some(l) => l,
        None => return vec![],
    };

    let mut out = vec![];
    for l in limits {
        let kind = l.get("kind").and_then(|k| k.as_str()).unwrap_or("");
        let percent = match l.get("percent").and_then(|p| p.as_f64()) {
            Some(p) => p as f32,
            None => continue,
        };
        let resets_at = l
            .get("resets_at")
            .and_then(|r| r.as_str())
            .and_then(parse_iso_epoch)
            .unwrap_or(0);
        // scope.model.display_name marks a per-model allowance (e.g. weekly, Opus only).
        let model = l
            .pointer("/scope/model/display_name")
            .and_then(|m| m.as_str());
        let (key, label) = match (kind, model) {
            ("session", _) => ("session".to_string(), "Session".to_string()),
            ("weekly_all", _) => ("weekly_all".to_string(), "Weekly".to_string()),
            (k, Some(m)) => (format!("{k}:{m}"), format!("Weekly · {m}")),
            (k, None) => (k.to_string(), k.replace('_', " ")),
        };
        out.push(Window {
            provider: "claude",
            key,
            label,
            percent_used: percent,
            resets_at,
            fetched_at,
        });
    }
    out
}

pub fn read_claude() -> Vec<Window> {
    std::fs::read_to_string(home().join(".claude.json"))
        .map(|s| parse_claude(&s))
        .unwrap_or_default()
}

// ---------------------------------------------------------------- codex
//
// ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl, written once per turn (so it's
// genuinely live, unlike claude's cache). Take the LAST token_count event.
pub fn parse_codex(jsonl: &str) -> Vec<Window> {
    let mut last: Option<serde_json::Value> = None;
    for line in jsonl.lines() {
        let v: serde_json::Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        if v.pointer("/payload/type").and_then(|t| t.as_str()) == Some("token_count") {
            last = Some(v);
        }
    }
    let v = match last {
        Some(v) => v,
        None => return vec![],
    };
    let fetched_at = v
        .get("timestamp")
        .and_then(|t| t.as_str())
        .and_then(parse_iso_epoch)
        .unwrap_or(0);
    let rl = match v.pointer("/payload/rate_limits") {
        Some(r) => r,
        None => return vec![],
    };

    let mut out = vec![];
    // NOT keyed by field name: primary/secondary are not stable roles — primary has
    // been observed as the 5h window in one session and the WEEKLY window in another
    // (with secondary null). Keying off the name silently swaps the two numbers.
    for slot in ["primary", "secondary"] {
        let w = match rl.get(slot) {
            Some(w) if !w.is_null() => w,
            _ => continue,
        };
        let percent = match w.get("used_percent").and_then(|p| p.as_f64()) {
            Some(p) => p as f32,
            None => continue,
        };
        let mins = w.get("window_minutes").and_then(|m| m.as_i64()).unwrap_or(0);
        let (key, label) = match mins {
            300 => ("session".to_string(), "Session (5h)".to_string()),
            10080 => ("weekly_all".to_string(), "Weekly".to_string()),
            // Real and common on free plans (100 occurrences across this machine's
            // rollouts) — name it rather than letting it fall through to "30d window".
            43200 => ("monthly".to_string(), "Monthly".to_string()),
            m if m % 1440 == 0 => (format!("{}d", m / 1440), format!("{}d window", m / 1440)),
            m if m % 60 == 0 => (format!("{}h", m / 60), format!("{}h window", m / 60)),
            m => (format!("{m}m"), format!("{m}m window")),
        };
        out.push(Window {
            provider: "codex",
            key,
            label,
            percent_used: percent,
            resets_at: w.get("resets_at").and_then(|r| r.as_i64()).unwrap_or(0),
            fetched_at,
        });
    }
    out
}

// Newest rollout, walking back day-dirs until one has a session.
//
// Not just today/yesterday: codex windows outlive a quiet spell — weekly (10080m)
// and monthly (43200m, real: 100 occurrences on this machine) stay binding for days
// after your last session. Stopping at yesterday makes quota vanish after two idle
// days while the weekly cap is still very much in force.
//
// 31 days covers the longest observed window; older than that the reading is dead
// regardless. Cost is bounded: one read_dir per empty day, and we stop at the first
// hit, so an active user does exactly one.
const MAX_LOOKBACK_DAYS: i64 = 31;

fn newest_rollout(root: &Path, now: i64) -> Option<PathBuf> {
    let mut best: Option<(std::time::SystemTime, PathBuf)> = None;
    // Start at -1, i.e. TOMORROW in UTC: codex names these dirs from LOCAL time, so for
    // any UTC+N user the dir it is actively writing to is a day ahead of the UTC date
    // between midnight and N:00 — invisible to a scan that starts at today.
    for day_off in -1..=MAX_LOOKBACK_DAYS {
        let days = (now - day_off * 86400) / 86400;
        let dir = root.join(ymd_path(days));
        let rd = match std::fs::read_dir(&dir) {
            Ok(rd) => rd,
            Err(_) => continue,
        };
        for e in rd.flatten() {
            let p = e.path();
            if p.extension().and_then(|x| x.to_str()) != Some("jsonl") {
                continue;
            }
            let m = match e.metadata().and_then(|m| m.modified()) {
                Ok(m) => m,
                Err(_) => continue,
            };
            if best.as_ref().is_none_or(|(bm, _)| m > *bm) {
                best = Some((m, p));
            }
        }
        if best.is_some() {
            return best.map(|(_, p)| p);
        }
    }
    best.map(|(_, p)| p)
}

// days-since-epoch -> "YYYY/MM/DD" (inverse of days_from_civil).
fn ymd_path(days: i64) -> String {
    let z = days + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!("{y:04}/{m:02}/{d:02}")
}

pub fn read_codex() -> Vec<Window> {
    let root = home().join(".codex/sessions");
    match newest_rollout(&root, now_secs()) {
        // ponytail: whole-file read (worst seen ~1 MB, once per 60s ≈ free).
        // Seek-from-end if rollouts ever reach tens of MB.
        Some(p) => std::fs::read_to_string(p)
            .map(|s| parse_codex(&s))
            .unwrap_or_default(),
        None => vec![],
    }
}

pub fn read_all() -> Vec<Window> {
    let mut v = read_claude();
    v.extend(read_codex());
    v
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_iso_with_offset_and_z() {
        // 2026-07-19T13:49:59Z
        let a = parse_iso_epoch("2026-07-19T13:49:59.688421+00:00").unwrap();
        let b = parse_iso_epoch("2026-07-19T13:49:59.688Z").unwrap();
        assert_eq!(a, b);
        assert_eq!(parse_iso_epoch("1970-01-01T00:00:00Z"), Some(0));
        // a +02:00 stamp is 2h EARLIER in UTC than the same wall clock at Z
        let off = parse_iso_epoch("2026-07-19T13:49:59+02:00").unwrap();
        assert_eq!(off, b - 7200);
        assert_eq!(parse_iso_epoch("nonsense"), None);
    }

    #[test]
    fn ymd_path_roundtrips() {
        let d = days_from_civil(2026, 7, 19);
        assert_eq!(ymd_path(d), "2026/07/19");
        assert_eq!(ymd_path(days_from_civil(2026, 1, 1)), "2026/01/01");
    }

    #[test]
    fn claude_limits_include_per_model_scope() {
        let json = r#"{"cachedUsageUtilization":{"fetchedAtMs":1784460805760,"utilization":{
          "limits":[
            {"kind":"session","percent":26,"resets_at":"2026-07-19T13:49:59.688421+00:00","scope":null},
            {"kind":"weekly_all","percent":10,"resets_at":"2026-07-22T23:59:59.688442+00:00","scope":null},
            {"kind":"weekly_scoped","percent":15,"resets_at":"2026-07-22T23:59:59.688764+00:00",
             "scope":{"model":{"display_name":"Fable"}}}
          ]}}}"#;
        let w = parse_claude(json);
        assert_eq!(w.len(), 3);
        assert_eq!(w[0].label, "Session");
        assert_eq!(w[0].percent_used, 26.0);
        assert_eq!(w[0].fetched_at, 1784460805); // ms -> s
        assert_eq!(w[1].label, "Weekly");
        // the per-model allowance must stay distinguishable from the account-wide weekly
        assert_eq!(w[2].key, "weekly_scoped:Fable");
        assert_eq!(w[2].label, "Weekly · Fable");
    }

    #[test]
    fn claude_missing_key_is_empty_not_panic() {
        assert!(parse_claude("{}").is_empty());
        assert!(parse_claude("not json").is_empty());
    }

    // The trap: primary/secondary are NOT stable roles. Same field name, different
    // window in each sample — so we key off window_minutes.
    #[test]
    fn codex_windows_keyed_by_minutes_not_field_name() {
        // sample A: primary IS the weekly window, secondary null.
        // One object per line — these files are real jsonl, so fixtures must be too.
        let a = r#"{"timestamp":"2026-07-19T16:19:08.623Z","type":"event_msg","payload":{"type":"token_count","rate_limits":{"primary":{"used_percent":3.0,"window_minutes":10080,"resets_at":1785058408},"secondary":null}}}"#;
        let wa = parse_codex(a);
        assert_eq!(wa.len(), 1);
        assert_eq!(wa[0].key, "weekly_all"); // NOT "session", despite being `primary`
        assert_eq!(wa[0].percent_used, 3.0);
        assert_eq!(wa[0].fetched_at, parse_iso_epoch("2026-07-19T16:19:08Z").unwrap());

        // sample B: primary is the 5h window, secondary is weekly
        let b = r#"{"timestamp":"2026-07-19T16:19:08.623Z","payload":{"type":"token_count","rate_limits":{"primary":{"used_percent":2.0,"window_minutes":300,"resets_at":1782441820},"secondary":{"used_percent":4.0,"window_minutes":10080,"resets_at":1782944185}}}}"#;
        let wb = parse_codex(b);
        assert_eq!(wb.len(), 2);
        assert_eq!(wb[0].key, "session");
        assert_eq!(wb[1].key, "weekly_all");
        assert_eq!(wb[1].percent_used, 4.0);
    }

    #[test]
    fn codex_takes_last_token_count_event() {
        let s = r#"{"payload":{"type":"token_count","rate_limits":{"primary":{"used_percent":1.0,"window_minutes":300,"resets_at":1}}}}
{"payload":{"type":"other"}}
not json at all
{"payload":{"type":"token_count","rate_limits":{"primary":{"used_percent":9.0,"window_minutes":300,"resets_at":2}}}}"#;
        let w = parse_codex(s);
        assert_eq!(w.len(), 1);
        assert_eq!(w[0].percent_used, 9.0); // latest wins, junk lines skipped
    }

    // 43200-minute windows are real free-plan data (100 occurrences on this machine).
    #[test]
    fn codex_names_the_monthly_window() {
        let s = r#"{"payload":{"type":"token_count","rate_limits":{"primary":{"used_percent":7.0,"window_minutes":43200,"resets_at":1786223244}}}}"#;
        let w = parse_codex(s);
        assert_eq!(w[0].key, "monthly");
        assert_eq!(w[0].label, "Monthly");
    }

    // Both slots null is real (8 of 260 newest events — free plan, no premium
    // allowance). No window means no percentage exists, so we report nothing
    // rather than inventing a pill; see the note in quota.ts.
    #[test]
    fn codex_null_slots_yield_no_windows() {
        let s = r#"{"payload":{"type":"token_count","rate_limits":{"limit_id":"premium","plan_type":"free","primary":null,"secondary":null}}}"#;
        assert!(parse_codex(s).is_empty());
    }

    #[test]
    fn rejects_impossible_timestamps_instead_of_inventing_epochs() {
        // a corrupt reset time that parses is worse than one that doesn't
        assert_eq!(parse_iso_epoch("2026-13-40T99:99:99Z"), None);
        assert_eq!(parse_iso_epoch("2026-00-10T00:00:00Z"), None);
        assert_eq!(parse_iso_epoch("2026-07-19T24:00:00Z"), None);
        assert_eq!(parse_iso_epoch("2026-07-19T12:60:00Z"), None);
        // still accepts the real shapes, including a leap second
        assert!(parse_iso_epoch("2026-07-19T13:49:59.688421+00:00").is_some());
        assert!(parse_iso_epoch("2016-12-31T23:59:60Z").is_some());
    }

    #[test]
    fn codex_no_events_is_empty() {
        assert!(parse_codex("").is_empty());
        assert!(parse_codex(r#"{"payload":{"type":"agent_message"}}"#).is_empty());
    }
}
