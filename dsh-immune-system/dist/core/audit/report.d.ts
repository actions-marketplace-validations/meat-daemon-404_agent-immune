import type { ImmuneStore } from '../store/index.js';
import { type AuditReport, type AuditSession, type AuditSourceName, type AuditSourceReport } from './types.js';
export declare function runSource(source: AuditSourceName, sessions: AuditSession[], store: ImmuneStore, opts: {
    cap: number | null;
    dryRun: boolean;
    selfMarkers: string[];
}): AuditSourceReport;
export declare function renderAuditReport(report: AuditReport, days: number, dryRun: boolean): string;
