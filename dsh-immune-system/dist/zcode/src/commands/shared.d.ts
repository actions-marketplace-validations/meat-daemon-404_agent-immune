/** Terminal columns a string occupies; CJK glyphs are double width. */
export declare function width(text: string): number;
export declare function pad(value: string, columns: number): string;
/** Clamp to a column budget without splitting a double-width glyph. */
export declare function clamp(value: string, columns: number): string;
export declare function parseSeedCliArgs(args: string[], valueFlags: string[]): {
    positional: string[];
    values: Map<string, string>;
    booleans: Set<string>;
};
/** Read `--flag value` or `--flag=value`; stops scanning past `--` separator. */
export declare function flagValue(args: readonly string[], flag: string): string | undefined;
/**
 * Extract positional arguments while skipping known value-taking flags
 * (`--flag value` and `--flag=value`) and honoring `--` end-of-options.
 */
export declare function positionalArgs(args: readonly string[], valueFlags?: readonly string[]): string[];
export declare function hasHelpFlag(args: readonly string[]): boolean;
export declare const style: {
    bold: (s: string) => string;
    dim: (s: string) => string;
    cyan: (s: string) => string;
    green: (s: string) => string;
    yellow: (s: string) => string;
};
export declare function renderCommandHelp(command: string): string | null;
export declare function renderMainHelp(version: string): string;
