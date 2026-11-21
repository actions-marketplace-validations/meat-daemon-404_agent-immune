import type { DiagnosableRule } from './diagnose.js';
import { type TeamRuleImportStore } from './team-sync.js';
export type DetectedPackageManager = 'pnpm' | 'yarn' | 'bun' | 'npm' | 'uv' | 'cargo' | 'go' | 'unknown';
export interface VaccineAntibodySpec {
    readonly hash: string;
    readonly trigger_pattern: string;
    readonly symptom: string;
    readonly prescription: string;
    readonly tool_name: string | null;
    readonly origin: 'workspace-dna' | 'proven-scar';
}
export interface WorkspaceDNA {
    readonly detectedMarkers: ReadonlyArray<string>;
    readonly packageManager: DetectedPackageManager;
    readonly stacks: ReadonlyArray<string>;
    readonly recommendedPacks: ReadonlyArray<string>;
    readonly riskTerritories: ReadonlyArray<string>;
}
export interface VaccineLockfile {
    readonly schemaVersion: '3.0.0';
    readonly dna: WorkspaceDNA;
    readonly antibodies: ReadonlyArray<VaccineAntibodySpec>;
    readonly integrityHash: string;
}
export interface VaccineVerificationReport {
    readonly valid: boolean;
    readonly schemaVersion: string | null;
    readonly antibodyCount: number;
    readonly expectedHash: string | null;
    readonly actualHash: string | null;
    readonly reason: string;
}
export declare function detectWorkspaceDNA(workspaceDir: string): WorkspaceDNA;
export declare function computeVaccineIntegrityHash(dna: WorkspaceDNA, antibodies: ReadonlyArray<VaccineAntibodySpec>): string;
export declare function compileVaccineLockfile(workspaceDir: string, learnedRules?: ReadonlyArray<DiagnosableRule>, opts?: {
    minHits?: number;
}): VaccineLockfile;
export declare function writeVaccineLockfile(workspaceDir: string, learnedRules?: ReadonlyArray<DiagnosableRule>, opts?: {
    lockfilePath?: string;
    minHits?: number;
}): {
    readonly lockfilePath: string;
    readonly lockfile: VaccineLockfile;
};
export declare function verifyVaccineLockfile(rawJson: string): VaccineVerificationReport;
export declare function applyVaccineLockfile(store: TeamRuleImportStore, lockfile: VaccineLockfile): {
    readonly applied: number;
    readonly total: number;
};
export declare function renderVaccineTerminal(lockfile: VaccineLockfile, lockfilePath?: string): string;
export declare function renderVaccineMarkdown(lockfile: VaccineLockfile): string;
