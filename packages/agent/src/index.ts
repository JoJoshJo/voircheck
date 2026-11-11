// @voircheck/agent — the shopping agent (spec 5.3 / 5.13): model interface, loop, tools, prompts, Channel3 search.
export * from './search';
export * from './model';
export * from './anthropic-model';
export * from './failover-model';
export * from './fake-model';
export * from './loop';
export * from './prompt';
export * from './quick-replies';
export * from './tools';
export * from './paypal-toolkit';
// The agent takes VoirCheck order references (VC-7K2F); re-exported for the scripts that wire its tools.
export { parsePaymentRef } from '@voircheck/shared';
