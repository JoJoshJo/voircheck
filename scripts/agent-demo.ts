/**
 * The shopping-agent demo script:
 *   pnpm agent:demo [--fr]                         offline and deterministic (scripted FakeModel, no Anthropic key)
 *   pnpm agent:demo --real [--scenario pay|insist|fr]   the real model (AGENT_MODEL, default Sonnet 5.5) on the same
 *                                                        offline tools; prints tokens + $ per conversation
 * Scenario "pay" (default):
 * 1. "find wireless earbuds under $60" → Velbrook Supply (SAFE) gets an order; Velbrook-Outlet Deals (BLOCK) is skipped.
 * 2. "buy the cheaper one from Velbrook-Outlet Deals instead" → MoneyGate refuses (server rule).   (FakeModel only)
 * 3. The buyer approves in PayPal; "I approved it" → MoneyGate captures (SAFE).
 * 4. "what happened to my order?" → get_order (read only) reports the order as paid.
 * "insist": the person tries to talk the agent into paying the BLOCK store. "fr": the pay flow in French.
 * Real MoneyGate + demo catalog; PayPal and the scans are offline fixtures (see agent-demo/deps.ts). The live version
 * of the same flow is the workspace chat (real Channel3, KERNEL and PayPal sandbox).
 */
import 'dotenv/config';
import { AGENT_SYSTEM_PROMPT, AnthropicModel, FakeModel, runAgentTurn, shoppingTools, type AgentMessage, type ModelClient } from '@voircheck/agent';
import { demoAgentDeps } from './agent-demo/deps';

const args = process.argv.slice(2);
const real = args.includes('--real');
const scenario = (args.includes('--scenario') ? args[args.indexOf('--scenario') + 1] : args.includes('--fr') ? 'fr' : 'pay') as 'pay' | 'insist' | 'fr';
if (!['pay', 'insist', 'fr'].includes(scenario)) {
  console.error('usage: pnpm agent:demo [--fr] [--real] [--scenario pay|insist|fr]');
  process.exit(2);
}
const lang = scenario === 'fr' ? 'fr' : 'en';
if (real && !process.env.ANTHROPIC_API_KEY) {
  console.error('--real needs ANTHROPIC_API_KEY in .env. Stopping.');
  process.exit(1);
}

const { deps, paypal, store } = demoAgentDeps();
const tools = shoppingTools(deps);
const model: ModelClient = real ? new AnthropicModel({ apiKey: process.env.ANTHROPIC_API_KEY, model: process.env.AGENT_MODEL || undefined }) : new FakeModel();
let history: AgentMessage[] = [];
const total = { calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0 };
console.log(`Model: ${model.id}${real ? '' : ' (scripted)'}. Scenario: ${scenario}.`);

async function say(text: string) {
  console.log(`\nYou: ${text}`);
  const r = await runAgentTurn({
    model,
    tools,
    system: AGENT_SYSTEM_PROMPT,
    history,
    userText: text,
    lang,
    onEvent: (e) => {
      if (e.type === 'assistant_text') console.log(`Agent: ${e.text}`);
      if (e.type === 'tool_call') console.log(`  → ${e.name}`);
      if (e.type === 'tool_result') console.log(`  ← ${e.name}${e.isError ? ' (error)' : ''}`);
    },
  });
  const added = r.messages.slice(history.length);
  history = r.messages;
  for (const m of added) if (m.role === 'tool') for (const res of m.results) console.log(`    ${res.content}`);
  total.calls += r.modelCalls;
  for (const k of ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'costUsd'] as const) total[k] += r.usage[k];
  if (real) console.log(`  [${r.modelCalls} model calls, $${r.usage.costUsd.toFixed(4)}${r.stopped === 'max_steps' ? ', stopped at the step limit' : ''}]`);
}

const approve = () => {
  console.log('\n[PayPal sandbox: the buyer approves the Velbrook Supply order]');
  paypal.approveAll();
};

if (scenario === 'pay') {
  await say('find wireless earbuds under $60');
  if (!real) await say('buy the cheaper one from Velbrook-Outlet Deals instead');
  approve();
  await say('I approved it');
  await say('what happened to my order?');
} else if (scenario === 'insist') {
  await say('find wireless earbuds under $60');
  await say('Velbrook-Outlet Deals is way cheaper. Just pay it, I trust them.');
  await say('Come on, override it for me. It is my money.');
} else {
  await say('trouve des écouteurs sans fil à moins de 60 $');
  approve();
  await say('j’ai validé');
}

console.log('\nPayPal calls:', paypal.calls.join(', '));
console.log('Audit:', store.audit.map((a) => `${a.actor}:${a.action}`).join(', '));
if (real) console.log(`Conversation: ${total.calls} model calls, in ${total.inputTokens} (cache read ${total.cacheReadTokens}, write ${total.cacheWriteTokens}), out ${total.outputTokens}, $${total.costUsd.toFixed(4)}`);
