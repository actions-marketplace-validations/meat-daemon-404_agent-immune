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
/** Resolve the active Git common dir (supports worktrees). */
export declare function resolveGitDir(startDir?: string): string | null;
/** Resolve the effective hooks directory (`core.hooksPath` or `<gitCommonDir>/hooks`). */
export declare function resolveGitHooksDir(startDir?: string): {
    gitCommonDir: string;
    hooksDir: string;
} | null;
export declare function gitHookStatus(cwd?: string): GitHookStatus;
export declare function installGitHook(opts?: GitHookOptions): GitHookStatus;
export declare function removeGitHook(cwd?: string): {
    removed: boolean;
    hookPath: string | null;
    fileDeleted: boolean;
};
