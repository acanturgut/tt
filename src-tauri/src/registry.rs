#[derive(Clone, Debug, PartialEq)]
pub struct AgentCommand {
    pub program: String,
    pub args: Vec<String>,
}

pub fn command_for(agent_id: &str) -> Option<AgentCommand> {
    let s = |v: &[&str]| v.iter().map(|x| x.to_string()).collect::<Vec<_>>();
    match agent_id {
        "claude" => Some(AgentCommand {
            // model/effort are appended by spawn_agent from the frontend catalog.
            program: "claude".into(),
            args: s(&["--permission-mode", "auto"]),
        }),
        "codex" => Some(AgentCommand {
            program: "codex".into(),
            args: s(&["--sandbox", "workspace-write", "--ask-for-approval", "never"]),
        }),
        "cursor" => Some(AgentCommand {
            program: "cursor-agent".into(),
            args: vec![],
        }),
        "gemini" => Some(AgentCommand {
            program: "gemini".into(),
            args: vec![],
        }),
        "opencode" => Some(AgentCommand {
            program: "opencode".into(),
            args: vec![],
        }),
        "antigravity" => Some(AgentCommand {
            program: "antigravity".into(),
            args: vec![],
        }),
        // Local runtimes: the model is appended positionally by spawn_agent from
        // the frontend catalog (`ollama run <model>`, `lms chat <model>`).
        "ollama" => Some(AgentCommand {
            program: "ollama".into(),
            args: s(&["run"]),
        }),
        "lmstudio" => Some(AgentCommand {
            program: "lms".into(),
            args: s(&["chat"]),
        }),
        "terminal" => Some(AgentCommand {
            program: std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string()),
            args: vec!["-l".to_string()], // login shell → their aliases/prompt/env
        }),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn claude_maps_to_its_command() {
        let c = command_for("claude").unwrap();
        assert_eq!(c.program, "claude");
        assert_eq!(c.args, vec!["--permission-mode", "auto"]);
    }

    #[test]
    fn codex_maps_to_its_command() {
        let c = command_for("codex").unwrap();
        assert_eq!(c.program, "codex");
        assert_eq!(
            c.args,
            vec!["--sandbox", "workspace-write", "--ask-for-approval", "never"]
        );
    }

    #[test]
    fn local_runtimes_leave_room_for_a_positional_model() {
        assert_eq!(command_for("ollama").unwrap().args, vec!["run"]);
        let c = command_for("lmstudio").unwrap();
        assert_eq!(c.program, "lms"); // the CLI is `lms`, not `lmstudio`
        assert_eq!(c.args, vec!["chat"]);
    }

    #[test]
    fn unknown_agent_is_none() {
        assert!(command_for("nope").is_none());
    }
}
