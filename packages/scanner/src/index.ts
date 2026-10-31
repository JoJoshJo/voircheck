// @voircheck/scanner — six signals + scoring + hard rules (spec 5.5 / 5.6 / 5.17 / 5.18).
export * from './schema';
export { scanStore, type ScannerDeps, type ScanReport, type ScanProgress } from './scan';
export { WEIGHTS, THRESHOLDS, HARD_RULE_LIMITS, score, hardRules, verdictForScore } from './scoring';
export { kernelVisitor, WAKING_RE, type PageVisitor, type KernelVisit, type PageSnapshot } from './kernel';
export { placeholderAnalyzer, wrapUntrustedPageText, type PageAnalyzer, type PageForAnalysis } from './signals/ai-page';
export { domainInfo, type DomainInfo } from './domain';
export { SsrfError, assertSafeUrlShape, resolvePublicHost, isPublicIp, type Resolver } from './ssrf';
export type { SignalOutcome, ScanFacts } from './signals/types';
