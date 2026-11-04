// @voircheck/scanner — six signals + scoring + hard rules (spec 5.5 / 5.6 / 5.17 / 5.18).
export * from './schema';
export { scanStore, type ScannerDeps, type ScanReport, type ScanProgress } from './scan';
export { WEIGHTS, THRESHOLDS, HARD_RULE_LIMITS, score, hardRules, verdictForScore } from './scoring';
export { cantVerifyOnly, type CantVerify, type CantVerifyReason } from './cant-verify';
export { kernelVisitor, browserCreateParams, ensureIspProxy, ISP_PROXY_COUNTRIES, WAKING_RE, type PageVisitor, type KernelVisit, type PageSnapshot, type VisitHooks } from './kernel';
export {
  placeholderAnalyzer,
  anthropicAnalyzer,
  confirmedInjection,
  quoteFound,
  verifyQuotes,
  memoryAiCache,
  aiCacheKey,
  buildAnalysisInput,
  outcomeFromAnalysis,
  riskToStatus,
  costUsd,
  wrapUntrustedPageText,
  buildUntrustedPageInput,
  AiAnalysis,
  AI_SYSTEM_PROMPT,
  AI_PROMPT_VERSION,
  DEFAULT_SCAN_MODEL,
  HAIKU_PRICE,
  MODEL_PRICES,
  type AiResultCache,
  type MessagesParser,
  type PageAnalyzer,
  type PageForAnalysis,
} from './signals/ai-page';
export { ADDRESS_RE, filterHiddenText, INJECTION_CANDIDATE_RE, INSTRUCTION_RE, looksLikeInjection, ORDER_RE, HiddenText, HiddenCandidate, type HiddenReason } from './hidden-text';
export { domainInfo, type DomainInfo } from './domain';
export { CollectedEvidence, CollectedFacts, EvidencePage, extractFacts, pickEvidenceLinks, EVIDENCE_BUDGET_MS, type EvidenceKind } from './evidence-pages';
export { detectBlockedPage, type BlockedReason } from './blocked-page';
export { TRANCO, trancoLookup, trancoRanks, popularity, type RankLookup } from './reputation';
export { SsrfError, assertSafeUrlShape, resolvePublicHost, isPublicIp, type Resolver } from './ssrf';
export type { SignalOutcome, ScanFacts, AiUsage } from './signals/types';
export { BRAND, SHOP_WORDS, brandIndex, brandInDomain, brandOf, defaultBrandLookup, withBrandHit, type Brand, type BrandHit, type BrandLookup } from './signals/brand-domain';
