/**
 * Embedded browser controller script for the standalone dashboard.
 * Uses plain ES5 syntax and string concatenation so nothing resembles template
 * interpolation (`AGENTS.md #14`). Zero external network calls.
 */
import type { Labels } from './labels.js';
export declare function renderClientScript(token: string, t: Labels, budget: string): string;
