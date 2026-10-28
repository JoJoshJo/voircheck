// @voircheck/scanner — six signals + scoring + hard rules (spec 5.5 / 5.6 / 5.17 / 5.18).
export * from './schema';
export { scanStore, type ScannerDeps, type ScanReport, type ScanProgress } from './scan';
export { WEIGHTS, THRESHOLDS, HARD_RULE_LIMITS, score, hardRules, verdictForScore } from './scoring';
export { kernelVisitor, type PageVisitor, type KernelVisit, type PageSnapshot } from './kernel';
export { placeholderAnalyzer, wrapUntrustedPageText, type PageAnalyzer, type PageForAnalysis } from './signals/ai-page';
export { SsrfError, assertSafeUrlShape, resolvePublicHost, isPublicIp } from './ssrf';
export type { SignalOutcome, ScanFacts } from './signals/types';
