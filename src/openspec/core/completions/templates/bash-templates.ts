/**
 * Static template strings for Bash completion scripts.
 * These are Bash-specific helper functions that never change.
 */

export const BASH_DYNAMIC_HELPERS = `# Dynamic completion helpers

_hubspec_complete_changes() {
  local changes
  changes=$(hubspec __complete changes 2>/dev/null | cut -f1)
  COMPREPLY=($(compgen -W "$changes" -- "$cur"))
}

_hubspec_complete_specs() {
  local specs
  specs=$(hubspec __complete specs 2>/dev/null | cut -f1)
  COMPREPLY=($(compgen -W "$specs" -- "$cur"))
}

_hubspec_complete_items() {
  local items
  items=$(hubspec __complete changes 2>/dev/null | cut -f1; hubspec __complete specs 2>/dev/null | cut -f1)
  COMPREPLY=($(compgen -W "$items" -- "$cur"))
}

_hubspec_complete_schemas() {
  local schemas
  schemas=$(hubspec __complete schemas 2>/dev/null | cut -f1)
  COMPREPLY=($(compgen -W "$schemas" -- "$cur"))
}`;
