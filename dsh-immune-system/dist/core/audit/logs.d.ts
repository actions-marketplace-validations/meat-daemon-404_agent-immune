import { type AuditSession } from './types.js';
export declare function loadCodexSessions(dir: string, since: number): {
    sessions: AuditSession[];
    present: boolean;
    note?: string;
};
export declare function loadClaudeSessions(dir: string, since: number): {
    sessions: AuditSession[];
    present: boolean;
    note?: string;
};
export declare function loadAntigravitySessions(dir: string, since: number): {
    sessions: AuditSession[];
    present: boolean;
    note?: string;
};
