/**
 * `immune doctor` — installation health checks.
 *
 * Borrowed from pro-workflow's /doctor: "confirms SQLite store, hooks, skills
 * load". Support begins with the machine answering its own questions, so each
 * check names the concrete fix instead of just failing.
 *
 * Every check returns a row; the CLI prints them and exits non-zero when any
 * check failed, so it can gate a script.
 */
import { ImmuneStore } from '../../core/store/index.js';
export interface CheckResult {
    name: string;
    ok: boolean;
    detail: string;
}
export interface DoctorOptions {
    /** Overrides for probe contexts (tests). */
    pluginRoot?: string;
}
/** The package's engines bar, as a pure predicate so tests can pin it. */
export declare function nodeVersionSatisfied(version: string): boolean;
export declare function runDoctor(store: ImmuneStore, options?: DoctorOptions): CheckResult[];
/** Resolve the database the same way hooks do, for doctor's own store. */
export declare function doctorDbPath(): string;
