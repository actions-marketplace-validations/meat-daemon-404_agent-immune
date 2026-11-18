import type { ImmuneStore } from './store/index.js';
import { type AuditOptions, type AuditReport } from './audit/types.js';
export type { AuditFailureFamily, AuditOptions, AuditReport, AuditSourceName, AuditSourceReport, AuditToolStat, } from './audit/types.js';
export { renderAuditReport } from './audit/report.js';
export declare function auditHistory(store: ImmuneStore, opts?: AuditOptions): AuditReport;
