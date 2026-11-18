export interface WorkspaceFingerprint {
    /** Short hash over lockfile contents + Node major. */
    key: string;
    /** The inputs that produced the hash (for display). */
    parts: string[];
}
/** Pure: hash one workspace's lockfiles + the runtime major. */
export declare function computeFingerprint(cwd: string, nodeMajor?: string): WorkspaceFingerprint;
/** The current process's workspace fingerprint (cached per process). */
export declare function currentFingerprint(cwd?: string): WorkspaceFingerprint;
/**
 * SessionStart metabolism: fingerprint-mismatched rules enter probation,
 * matching rules are re-validated (probation cleared). Returns the counts so
 * the caller can log one line.
 */
export declare function applyEnvMetabolism(db: import('node:sqlite').DatabaseSync, cwd: string): {
    probation: number;
    revalidated: number;
};
