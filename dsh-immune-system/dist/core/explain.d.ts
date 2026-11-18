import type { ImmuneStore } from './store/index.js';
export interface ExplainedCandidate {
    id: number;
    source: 'project' | 'shared';
    trigger_pattern: string;
    symptom: string;
    prescription: string;
    tool_name: string | null;
    project_scope: string;
    quality_grade: string;
    rubric_score: number;
    hit_count: number;
    breakdown: {
        bm25Rank: number;
        baseRelevance: number;
        hitMultiplier: number;
        pathAffinityBoost: number;
        lexicalAffinity: number;
        lexicalMultiplier: number;
        rubricMultiplier: number;
        sharedDiscount: number;
        timeDecay: number;
        finalScore: number;
    };
    matchedTokens: string[];
    matchedBigrams: string[];
}
export interface ExplainRecallReport {
    query: string;
    expandedQuery: string;
    addedConcepts: string[];
    projectScope: string;
    candidates: ExplainedCandidate[];
    renderedBlock: string;
}
export declare function explainRecall(store: ImmuneStore, query: string, opts?: {
    limit?: number;
    cwd?: string;
    toolName?: string;
}): ExplainRecallReport;
