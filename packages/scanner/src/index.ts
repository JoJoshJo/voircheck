// @voircheck/scanner — six signals + scoring + hard rules (spec 5.5 / 5.6 / 5.17 / 5.18).
export * from './schema';
export { scanStore, type ScannerDeps, type ScanReport, type ScanProgress } from './scan';
export { WEIGHTS, THRESHOLDS, HARD_RULE_LIMITS, score, hardRules, verdictForScore } from './scoring';
export { kernelVisitor, browserCreateParams, ensureIspProxy, ISP_PROXY_COUNTRIES, WAKING_RE, type PageVisitor, type KernelVisit, type PageSnapshot, type VisitHooks } from './kernel';
export { placeholderAnalyzer, wrapUntrustedPageText, buildUntrustedPageInput, type PageAnalyzer, type PageForAnalysis } from './signals/ai-page';
export { filterHiddenText, INJECTION_RE, HiddenText, HiddenCandidate, type HiddenReason } from './hidden-text';
export { domainInfo, type DomainInfo } from './domain';
export { CollectedEvidence, CollectedFacts, EvidencePage, extractFacts, pickEvidenceLinks, EVIDENCE_BUDGET_MS, type EvidenceKind } from './evidence-pages';
export { detectBlockedPage, type BlockedReason } from './blocked-page';
export { TRANCO, trancoLookup, trancoRanks, popularity, type RankLookup } from './reputation';
export { SsrfError, assertSafeUrlShape, resolvePublicHost, isPublicIp, type Resolver } from './ssrf';
export type { SignalOutcome, ScanFacts } from './signals/types';
