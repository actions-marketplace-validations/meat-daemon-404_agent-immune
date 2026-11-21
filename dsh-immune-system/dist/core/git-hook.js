/**
 * Local Git `pre-commit` hook installer (`immune git-hook`).
 *
 * Brings the stateless `ci-check` pitfall scanner (which reads the repository's
 * committed `<!-- immune:generated -->` block in AGENTS.md / CLAUDE.md) directly
 * to `git commit`, catching known repo pitfalls in <40 ms before a commit is
 * even created.
 *
 * Non-destructive by contract:
 *  - Supports both standard `.git/` directories and worktree `.git` gitdir files.
 *  - Wraps its snippet in `# --- immune:git-hook start/end ---` markers so any
 *    existing user / lint-staged / custom pre-commit logic is preserved untouched.
 *  - Gracefully no-ops if a contributor has not installed node/agent-immune locally.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
const HOOK_START = '# --- immune:git-hook start ---';
const HOOK_END = '# --- immune:git-hook end ---';
/** Resolve the active Git hooks directory (supports worktrees and `core.hooksPath` default). */
export function resolveGitDir(startDir = process.cwd()) {
    let current = resolve(startDir);
    for (let depth = 0; depth < 32; depth += 1) {
        const dotGit = join(current, '.git');
        if (existsSync(dotGit)) {
            try {
                const st = statSync(dotGit);
                if (st.isDirectory())
                    return dotGit;
                if (st.isFile()) {
                    const content = readFileSync(dotGit, 'utf8').trim();
                    const m = content.match(/^gitdir:\s*(.+)$/i);
                    if (m?.[1]) {
                        const gitDir = resolve(current, m[1].trim());
                        // Worktree `.git` files point to `.git/worktrees/<name>`, whose hooks
                        // live in the shared common dir named by `<gitdir>/commondir`.
                        const commonFile = join(gitDir, 'commondir');
                        if (existsSync(commonFile)) {
                            try {
                                const relCommon = readFileSync(commonFile, 'utf8').trim();
                                if (relCommon)
                                    return resolve(gitDir, relCommon);
                            }
                            catch {
                                // Fall back to gitDir if commondir cannot be read.
                            }
                        }
                        return gitDir;
                    }
                }
            }
            catch {
                return null;
            }
        }
        const parent = dirname(current);
        if (parent === current)
            break;
        current = parent;
    }
    return null;
}
function buildHookBlock(warnOnly) {
    const modeFlag = warnOnly ? ' --warn-only' : '';
    return [
        HOOK_START,
        '# Managed by agent-immune (dsh-immune-system). Remove with: immune git-hook --remove',
        'if command -v node >/dev/null 2>&1; then',
        '  if [ -f "$HOME/.dsh-immune/dist/zcode/src/cli.js" ]; then',
        `    git diff --cached | node "$HOME/.dsh-immune/dist/zcode/src/cli.js" ci-check${modeFlag} || exit $?`,
        '  elif command -v immune >/dev/null 2>&1; then',
        `    git diff --cached | immune ci-check${modeFlag} || exit $?`,
        '  elif command -v dsh-immune-system >/dev/null 2>&1; then',
        `    git diff --cached | dsh-immune-system ci-check${modeFlag} || exit $?`,
        '  fi',
        'fi',
        HOOK_END,
    ].join('\n');
}
function stripManagedHook(content) {
    const start = content.indexOf(HOOK_START);
    const end = content.indexOf(HOOK_END);
    if (start < 0 || end < start)
        return content;
    const before = content.slice(0, start).replace(/\n+$/, '');
    const after = content.slice(end + HOOK_END.length).replace(/^\n+/, '');
    if (before && after)
        return `${before}\n\n${after}\n`;
    if (before)
        return `${before}\n`;
    if (after)
        return `#!/bin/sh\n${after}\n`;
    return '';
}
export function gitHookStatus(cwd = process.cwd()) {
    const gitDir = resolveGitDir(cwd);
    if (!gitDir) {
        return { gitCommonDir: null, hookPath: null, installed: false, mode: 'none', coexistsWithUserHook: false };
    }
    const hookPath = join(gitDir, 'hooks', 'pre-commit');
    if (!existsSync(hookPath)) {
        return { gitCommonDir: gitDir, hookPath, installed: false, mode: 'none', coexistsWithUserHook: false };
    }
    const raw = readFileSync(hookPath, 'utf8');
    const start = raw.indexOf(HOOK_START);
    const end = raw.indexOf(HOOK_END);
    const installed = start >= 0 && end > start;
    const block = installed ? raw.slice(start, end + HOOK_END.length) : '';
    const mode = !installed
        ? 'none'
        : block.includes('--warn-only')
            ? 'warn-only'
            : 'strict';
    const remainder = stripManagedHook(raw)
        .replace(/^#!\/bin\/(?:sh|bash|env\s+\S+)\s*/m, '')
        .trim();
    return {
        gitCommonDir: gitDir,
        hookPath,
        installed,
        mode,
        coexistsWithUserHook: remainder.length > 0,
    };
}
export function installGitHook(opts = {}) {
    const cwd = opts.cwd ?? process.cwd();
    const gitDir = resolveGitDir(cwd);
    if (!gitDir) {
        throw new Error(`No .git directory found from ${cwd}`);
    }
    const hooksDir = join(gitDir, 'hooks');
    mkdirSync(hooksDir, { recursive: true });
    const hookPath = join(hooksDir, 'pre-commit');
    const block = buildHookBlock(Boolean(opts.warnOnly));
    let nextContent;
    if (existsSync(hookPath)) {
        const existing = readFileSync(hookPath, 'utf8').replace(/\r\n/g, '\n');
        const cleaned = stripManagedHook(existing).trimEnd();
        if (!cleaned || /^#!\/bin\/(?:sh|bash|env\s+\S+)\s*$/.test(cleaned)) {
            const shebang = cleaned.startsWith('#!') ? cleaned : '#!/bin/sh';
            nextContent = `${shebang}\n\n${block}\n`;
        }
        else {
            const withShebang = cleaned.startsWith('#!') ? cleaned : `#!/bin/sh\n\n${cleaned}`;
            nextContent = `${withShebang}\n\n${block}\n`;
        }
    }
    else {
        nextContent = `#!/bin/sh\n\n${block}\n`;
    }
    writeFileSync(hookPath, nextContent, 'utf8');
    try {
        chmodSync(hookPath, 0o755);
    }
    catch {
        // Windows filesystems ignore POSIX mode bits.
    }
    return gitHookStatus(cwd);
}
export function removeGitHook(cwd = process.cwd()) {
    const gitDir = resolveGitDir(cwd);
    if (!gitDir) {
        throw new Error(`No .git directory found from ${cwd}`);
    }
    const hookPath = join(gitDir, 'hooks', 'pre-commit');
    if (!existsSync(hookPath)) {
        return { removed: false, hookPath, fileDeleted: false };
    }
    const existing = readFileSync(hookPath, 'utf8').replace(/\r\n/g, '\n');
    if (!existing.includes(HOOK_START)) {
        return { removed: false, hookPath, fileDeleted: false };
    }
    const stripped = stripManagedHook(existing);
    const meaningful = stripped.replace(/^#!\/bin\/(?:sh|bash|env\s+\S+)\s*/m, '').trim();
    if (!meaningful) {
        unlinkSync(hookPath);
        return { removed: true, hookPath, fileDeleted: true };
    }
    writeFileSync(hookPath, stripped, 'utf8');
    return { removed: true, hookPath, fileDeleted: false };
}
