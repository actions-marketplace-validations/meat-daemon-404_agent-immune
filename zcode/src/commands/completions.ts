/**
 * Shell tab-completion generators (`immune completions <bash|zsh|fish|powershell>`).
 */
import { HOSTS } from '../../../core/connect.js';
import { BUILTIN_PACKS } from '../../../core/packs.js';

const SUBCOMMANDS = [
  'demo',
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
        `    seed) COMPREPLY=( $(compgen -W "${packs} --baseline --remove --json --help" -- "$cur") ) ;;`,
        '    git-hook) COMPREPLY=( $(compgen -W "--install --remove --status --warn-only --json --help" -- "$cur") ) ;;',
        '    explain) COMPREPLY=( $(compgen -W "--tool --limit --json --help" -- "$cur") ) ;;',
        '    wrapped) COMPREPLY=( $(compgen -W "--out --hosts --stdout --json --help" -- "$cur") ) ;;',
        '    team-sync) COMPREPLY=( $(compgen -W "--import --check --dedupe --badge --markdown --path --min-hits --json --help" -- "$cur") ) ;;',
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
        "    seed) _arguments '--baseline=[level]:(widely newly)' '--remove' '--json' '--help' '*:pack:($packs)' ;;",
        "    git-hook) _arguments '--install' '--remove' '--status' '--warn-only' '--json' '--help' ;;",
        "    wrapped) _arguments '--out=[file]' '--hosts=[list]' '--stdout' '--json' '--help' ;;",
        "    team-sync) _arguments '--import --check --dedupe --badge --markdown' '--path=[file]' '--min-hits=[count]' '--json' '--help' ;;",
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
        `  complete -c $bin -n "__fish_seen_subcommand_from seed" -a "${packs} --baseline --remove --json"`,
        '  complete -c $bin -n "__fish_seen_subcommand_from git-hook" -a "--install --remove --status --warn-only --json"',
        '  complete -c $bin -n "__fish_seen_subcommand_from wrapped" -a "--out --hosts --stdout --json --help"',
        '  complete -c $bin -n "__fish_seen_subcommand_from team-sync" -a "--import --check --dedupe --badge --markdown --path --min-hits --json --help"',
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
        `  $packs = @(${BUILTIN_PACKS.map((p) => `'${p.id}'`).join(', ')}, '--baseline', '--remove', '--json')`,
        '  $candidates = if ($tokens.Count -le 2 -and ($wordToComplete -eq "" -and $tokens.Count -eq 1 -or $wordToComplete -ne "" -and $tokens.Count -eq 2)) {',
        '    $subcmds',
        '  } elseif ($tokens[1] -eq "connect") {',
        '    $hosts',
        '  } elseif ($tokens[1] -eq "seed") {',
        '    $packs',
        '  } elseif ($tokens[1] -eq "git-hook") {',
        "    @('--install', '--remove', '--status', '--warn-only', '--json')",
        '  } elseif ($tokens[1] -eq "wrapped") {',
        "    @('--out', '--hosts', '--stdout', '--json', '--help')",
        '  } elseif ($tokens[1] -eq "team-sync") {',
        "    @('--import --check --dedupe --badge --markdown', '--path', '--min-hits', '--json', '--help')",
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
