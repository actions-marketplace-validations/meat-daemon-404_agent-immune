const WIDE = /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]/;
/** Terminal columns a string occupies; CJK glyphs are double width. */
export function width(text) {
    let total = 0;
    for (const ch of text)
        total += WIDE.test(ch) ? 2 : 1;
    return total;
}
export function pad(value, columns) {
    const used = width(value);
    return used >= columns ? value : value + ' '.repeat(columns - used);
}
/** Clamp to a column budget without splitting a double-width glyph. */
export function clamp(value, columns) {
    if (width(value) <= columns)
        return value;
    let out = '';
    let used = 0;
    for (const ch of value) {
        const w = WIDE.test(ch) ? 2 : 1;
        if (used + w > columns - 1)
            break;
        out += ch;
        used += w;
    }
    return `${out}…`;
}
export function parseSeedCliArgs(args, valueFlags) {
    const valueSet = new Set(valueFlags);
    const positional = [];
    const values = new Map();
    const booleans = new Set();
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === undefined)
            continue;
        if (!arg.startsWith('--')) {
            positional.push(arg);
            continue;
        }
        const eq = arg.indexOf('=');
        if (eq > 0) {
            const flag = arg.slice(0, eq);
            if (valueSet.has(flag))
                values.set(flag, arg.slice(eq + 1));
            continue;
        }
        if (valueSet.has(arg) && i + 1 < args.length) {
            const nextVal = args[++i];
            if (nextVal !== undefined)
                values.set(arg, nextVal);
            continue;
        }
        booleans.add(arg);
    }
    return { positional, values, booleans };
}
