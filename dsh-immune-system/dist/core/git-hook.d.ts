export interface GitHookOptions {
    cwd?: string;
    warnOnly?: boolean;
}
export interface GitHookStatus {
    gitCommonDir: string | null;
    hookPath: string | null;
    installed: boolean;
    mode: 'strict' | 'warn-only' | 'none';
    coexistsWithUserHook: boolean;
}
/** Resolve the active Git hooks directory (supports worktrees and `core.hooksPath` default). */
export declare function resolveGitDir(startDir?: string): string | null;
export declare function gitHookStatus(cwd?: string): GitHookStatus;
export declare function installGitHook(opts?: GitHookOptions): GitHookStatus;
export declare function removeGitHook(cwd?: string): {
    removed: boolean;
    hookPath: string | null;
    fileDeleted: boolean;
};
