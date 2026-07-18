# Source this before ANY node/npm/npx/cargo command in this repo:
#   source scripts/dev-env.sh
#
# Why: this Mac loads node via an nvm lazy-loader that only exists in
# interactive shells. In the non-interactive shells that tools/agents use, the
# `node`/`npm` names resolve to a stub that errors with `_load_nvm: not found`.
# We drop the stubs and point PATH straight at the real node + cargo binaries.
unset -f node npm npx nvm 2>/dev/null || true
export PATH="$HOME/.cargo/bin:$HOME/.nvm/versions/node/v20.19.6/bin:$PATH"
