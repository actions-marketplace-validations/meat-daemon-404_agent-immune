/**
 * Target signatures for failure/recovery pairing.
 *
 * A failure and a later success are only an episode when they are about the SAME
 * thing. Pairing by tool name alone conflates unrelated calls: `npm run build`
 * failing and then `git status` succeeding would distil a rule that teaches
 * nothing.
 *
 * Two additional guards:
 *  - read-only probes (`ls`, `git status`, …) must never close an episode: they
 *    cannot have fixed anything, and they are extremely common between an error
 *    and its real fix.
 *  - paths are normalised to a project-relative form so a failure in
 *    `./src/a.ts` and a success in `<cwd>/src/a.ts` still match.
 */
export interface TargetSignature {
    /** Stable identity used for compatibility checks. */
    signature: string;
    /** True when the call only inspects state and cannot fix anything. */
    probeOnly: boolean;
}
/**
 * Normalise a path to a project-relative, forward-slash form.
 *
 * Works on both platforms: drive-letter paths are absolute everywhere (the
 * check is explicit, because POSIX `isAbsolute` does not recognise `C:/…`), and
 * a path inside `cwd` is made relative to it so the same file matches across
 * machines and checkouts.
 */
export declare function normaliseTargetPath(rawPath: string, cwd?: string): string;
/**
 * Split a shell command into `program` and its first non-flag subcommand.
 *
 * For chained commands (`cd packages/api && npm test`, `echo building && cargo check`),
 * skips leading probe/navigation segments (`cd`, `echo`, `pwd`, ...) so the real
 * action determines both signature and `probeOnly` — a chain is probe-only only
 * when EVERY segment is a probe (`cd /repo && git status`).
 */
export declare function parseCommand(command: string): {
    program: string;
    sub: string;
};
/** Compute the pairing signature for one tool call. */
export declare function targetSignature(toolName: string, input: unknown, cwd?: string): TargetSignature;
/**
 * Whether an incoming success may close a stored failure's episode.
 *
 * The rule is "same kind of work on the same target":
 *  - a read-only probe never closes anything (it cannot have fixed it);
 *  - file tools must name the same file;
 *  - commands must belong to the same PROGRAM FAMILY (npm/npx/pnpm are one
 *    family: a build failing under npm and succeeding under npx is the same
 *    task's fix), while `npm …` then `git …` is not;
 *  - a missing target on either side is tolerated, since some tools omit it.
 */
export declare function canCloseEpisode(failedSignature: string, incoming: TargetSignature): boolean;
