/**
 * Shell tab-completion generators (`immune completions <bash|zsh|fish|powershell>`).
 */
import { HOSTS } from '../../../core/connect.js';
import { BUILTIN_PACKS } from '../../../core/packs.js';

const SUBCOMMANDS = [
  'demo',
  'mcp',
  'connect',
  'git-hook',
  'completions',
  'doctor',
  'ui',
  'list',
  'search',
  'explain',
  'learn',
  'forget',
  'prune',
  'stats',
  'hygiene',
  'triage',
  'receipts',
  'models',
  'coverage',
  'detours',
  'rewrite',
  'consolidate',
  'seed',
  'ingest-skill',
  'ingest-disk',
  'workspaces',
  'audit',
  'backfill',
  'export',
  'export-json',
  'import-json',
  'sync-doc',
  'guard',
  'vaccinate',
  'federate',
  'diagnose',
  'autopsy',
  'compile-rules',
  'wrapped',
  'team-sync',
  'ci-check',
  'backup',
  'help',
  'version',
];

export function renderCompletions(shell: string): string | null {
  const hostIds = Object.keys(HOSTS);
  const hosts = hostIds.join(' ');
  const packs = BUILTIN_PACKS.map((p) => p.id).join(' ');
  const cmds = SUBCOMMANDS.join(' ');

  switch (shell.toLowerCase()) {
    case 'bash':
      return [
        '# bash completion for immune / dsh-immune-system',
        '_immune_completions() {',
        '  local cur prev',
        '  cur="${COMP_WORDS[COMP_CWORD]}"',
        '  prev="${COMP_WORDS[COMP_CWORD-1]}"',
        '  if [ "$COMP_CWORD" -eq 1 ]; then',
        `    COMPREPLY=( $(compgen -W "${cmds} --help --version" -- "$cur") )`,
        '    return 0',
        '  fi',
        '  case "${COMP_WORDS[1]}" in',
        `    connect) COMPREPLY=( $(compgen -W "${hosts} --status --refresh --remove --json --help" -- "$cur") ) ;;`,
        `    seed) COMPREPLY=( $(compgen -W "${packs} --baseline --remove --help" -- "$cur") ) ;;`,
        '    git-hook) COMPREPLY=( $(compgen -W "--install --remove --status --warn-only --json --help" -- "$cur") ) ;;',
        '    explain) COMPREPLY=( $(compgen -W "--tool --limit --json --help" -- "$cur") ) ;;',
        '    guard) COMPREPLY=( $(compgen -W "--log --limit --tool --strict --hook --hook-host --markdown --json --help" -- "$cur") ) ;;',
        '    vaccinate) COMPREPLY=( $(compgen -W "--check --apply --refresh --lockfile --markdown --json --help" -- "$cur") ) ;;',
        '    federate) COMPREPLY=( $(compgen -W "--out --min-consensus --svg --markdown --json --help" -- "$cur") ) ;;',
        '    diagnose) COMPREPLY=( $(compgen -W "--svg --out --markdown --json --help" -- "$cur") ) ;;',
        '    autopsy) COMPREPLY=( $(compgen -W "--markdown --json --help" -- "$cur") ) ;;',
        '    compile-rules) COMPREPLY=( $(compgen -W "--target --min-hits --dry-run --json --help" -- "$cur") ) ;;',
        '    wrapped) COMPREPLY=( $(compgen -W "--out --hosts --badge --markdown --stdout --json --help" -- "$cur") ) ;;',
        '    team-sync) COMPREPLY=( $(compgen -W "--import --check --dedupe --path --min-hits --json --help" -- "$cur") ) ;;',
        '    ci-check) COMPREPLY=( $(compgen -W "--diff --doc --github --warn-only --json --help" -- "$cur") ) ;;',
        '    completions) COMPREPLY=( $(compgen -W "bash zsh fish powershell" -- "$cur") ) ;;',
        '    *) COMPREPLY=( $(compgen -W "--dry-run --json --all --help" -- "$cur") ) ;;',
        '  esac',
        '}',
        'complete -F _immune_completions immune dsh-immune-system',
        '',
      ].join('\n');

    case 'zsh':
      return [
        '#compdef immune dsh-immune-system',
        '_immune() {',
        `  local -a subcmds=(${SUBCOMMANDS.map((c) => `'${c}'`).join(' ')})`,
        `  local -a hosts=(${hostIds.map((id) => `'${id}'`).join(' ')})`,
        `  local -a packs=(${BUILTIN_PACKS.map((p) => `'${p.id}'`).join(' ')})`,
        '  if (( CURRENT == 2 )); then',
        "    _describe 'command' subcmds",
        '    return',
        '  fi',
        '  case "$words[2]" in',
        "    connect) _arguments '--status' '--refresh' '--remove' '--json' '--help' '*:host:($hosts)' ;;",
        "    seed) _arguments '--baseline=[level]:(widely newly)' '--remove' '--help' '*:pack:($packs)' ;;",
        "    git-hook) _arguments '--install' '--remove' '--status' '--warn-only' '--json' '--help' ;;",
        "    explain) _arguments '--tool=[tool]' '--limit=[count]' '--json' '--help' ;;",
        "    guard) _arguments '--log' '--limit=[count]' '--tool=[tool]' '--strict' '--hook' '--hook-host=[host]:(claude-code cursor antigravity gemini-cli generic)' '--markdown' '--json' '--help' ;;",
        "    vaccinate) _arguments '--check' '--apply' '--refresh' '--lockfile=[file]' '--markdown' '--json' '--help' ;;",
        "    federate) _arguments '--out=[file]' '--min-consensus=[score]' '--svg' '--markdown' '--json' '--help' ;;",
        "    diagnose) _arguments '--svg' '--out=[file]' '--markdown' '--json' '--help' ;;",
        "    autopsy) _arguments '--markdown' '--json' '--help' ;;",
        "    compile-rules) _arguments '--target=[target]:(all cursor copilot windsurf cline claude)' '--min-hits=[count]' '--dry-run' '--json' '--help' ;;",
        "    wrapped) _arguments '--out=[file]' '--hosts=[list]' '--badge' '--markdown' '--stdout' '--json' '--help' ;;",
        "    team-sync) _arguments '--import' '--check' '--dedupe' '--path=[file]' '--min-hits=[count]' '--json' '--help' ;;",
        "    ci-check) _arguments '--diff=[file]' '--doc=[file]' '--github' '--warn-only' '--json' '--help' ;;",
        "    completions) _arguments '1:shell:(bash zsh fish powershell)' ;;",
        "    *) _arguments '--dry-run' '--json' '--all' '--help' ;;",
        '  esac',
        '}',
        'compdef _immune immune dsh-immune-system',
        '',
      ].join('\n');

    case 'fish':
      return [
        '# fish completion for immune / dsh-immune-system',
        'for bin in immune dsh-immune-system',
        '  complete -c $bin -f',
        `  complete -c $bin -n "__fish_use_subcommand" -a "${cmds}"`,
        `  complete -c $bin -n "__fish_seen_subcommand_from connect" -a "${hosts} --status --refresh --remove --json"`,
        `  complete -c $bin -n "__fish_seen_subcommand_from seed" -a "${packs} --baseline --remove"`,
        '  complete -c $bin -n "__fish_seen_subcommand_from git-hook" -a "--install --remove --status --warn-only --json"',
        '  complete -c $bin -n "__fish_seen_subcommand_from explain" -a "--tool --limit --json --help"',
        '  complete -c $bin -n "__fish_seen_subcommand_from guard" -a "--log --limit --tool --strict --hook --hook-host --markdown --json --help"',
        '  complete -c $bin -n "__fish_seen_subcommand_from vaccinate" -a "--check --apply --refresh --lockfile --markdown --json --help"',
        '  complete -c $bin -n "__fish_seen_subcommand_from federate" -a "--out --min-consensus --svg --markdown --json --help"',
        '  complete -c $bin -n "__fish_seen_subcommand_from diagnose" -a "--svg --out --markdown --json --help"',
        '  complete -c $bin -n "__fish_seen_subcommand_from autopsy" -a "--markdown --json --help"',
        '  complete -c $bin -n "__fish_seen_subcommand_from compile-rules" -a "--target --min-hits --dry-run --json --help"',
        '  complete -c $bin -n "__fish_seen_subcommand_from wrapped" -a "--out --hosts --badge --markdown --stdout --json --help"',
        '  complete -c $bin -n "__fish_seen_subcommand_from team-sync" -a "--import --check --dedupe --path --min-hits --json --help"',
        '  complete -c $bin -n "__fish_seen_subcommand_from ci-check" -a "--diff --doc --github --warn-only --json --help"',
        '  complete -c $bin -n "__fish_seen_subcommand_from completions" -a "bash zsh fish powershell"',
        'end',
        '',
      ].join('\n');

    case 'powershell':
    case 'pwsh':
      return [
        '# PowerShell completion for immune / dsh-immune-system',
        'Register-ArgumentCompleter -Native -CommandName immune,dsh-immune-system -ScriptBlock {',
        '  param($wordToComplete, $commandAst, $cursorPosition)',
        '  $tokens = $commandAst.CommandElements | ForEach-Object { $_.ToString() }',
        `  $subcmds = @(${SUBCOMMANDS.map((c) => `'${c}'`).join(', ')})`,
        `  $hosts = @(${hostIds.map((id) => `'${id}'`).join(', ')}, '--status', '--refresh', '--remove', '--json')`,
        `  $packs = @(${BUILTIN_PACKS.map((p) => `'${p.id}'`).join(', ')}, '--baseline', '--remove')`,
        '  $candidates = if ($tokens.Count -le 2 -and ($wordToComplete -eq "" -and $tokens.Count -eq 1 -or $wordToComplete -ne "" -and $tokens.Count -eq 2)) {',
        '    $subcmds',
        '  } elseif ($tokens[1] -eq "connect") {',
        '    $hosts',
        '  } elseif ($tokens[1] -eq "seed") {',
        '    $packs',
        '  } elseif ($tokens[1] -eq "git-hook") {',
        "    @('--install', '--remove', '--status', '--warn-only', '--json')",
        '  } elseif ($tokens[1] -eq "explain") {',
        "    @('--tool', '--limit', '--json', '--help')",
        '  } elseif ($tokens[1] -eq "guard") {',
        "    @('--log', '--limit', '--tool', '--strict', '--hook', '--hook-host', '--markdown', '--json', '--help')",
        '  } elseif ($tokens[1] -eq "vaccinate") {',
        "    @('--check', '--apply', '--refresh', '--lockfile', '--markdown', '--json', '--help')",
        '  } elseif ($tokens[1] -eq "federate") {',
        "    @('--out', '--min-consensus', '--svg', '--markdown', '--json', '--help')",
        '  } elseif ($tokens[1] -eq "diagnose") {',
        "    @('--svg', '--out', '--markdown', '--json', '--help')",
        '  } elseif ($tokens[1] -eq "autopsy") {',
        "    @('--markdown', '--json', '--help')",
        '  } elseif ($tokens[1] -eq "compile-rules") {',
        "    @('--target', '--min-hits', '--dry-run', '--json', '--help')",
        '  } elseif ($tokens[1] -eq "wrapped") {',
        "    @('--out', '--hosts', '--badge', '--markdown', '--stdout', '--json', '--help')",
        '  } elseif ($tokens[1] -eq "team-sync") {',
        "    @('--import', '--check', '--dedupe', '--path', '--min-hits', '--json', '--help')",
        '  } elseif ($tokens[1] -eq "ci-check") {',
        "    @('--diff', '--doc', '--github', '--warn-only', '--json', '--help')",
        '  } elseif ($tokens[1] -eq "completions") {',
        "    @('bash', 'zsh', 'fish', 'powershell')",
        '  } else {',
        "    @('--dry-run', '--json', '--all', '--help')",
        '  }',
        '  $candidates | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {',
        "    [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)",
        '  }',
        '}',
        '',
      ].join('\n');

    default:
      return null;
  }
}

export function cmdCompletions(args: string[]): number {
  const shell = args.find((a) => !a.startsWith('-')) ?? '';
  if (!shell) {
    process.stderr.write('usage: immune completions <bash|zsh|fish|powershell>\n');
    return 2;
  }
  const script = renderCompletions(shell);
  if (!script) {
    process.stderr.write(`unknown shell "${shell}". Supported shells: bash, zsh, fish, powershell.\n`);
    return 2;
  }
  process.stdout.write(script);
  return 0;
}
