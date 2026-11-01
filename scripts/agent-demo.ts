/**
 * The shopping-agent demo script, offline and deterministic (scripted FakeModel, no Anthropic key needed):
 *   pnpm agent:demo [--fr]
 * 1. "find wireless earbuds under $60" → Velbrook Supply (SAFE) gets an order; Velbrook-Outlet Deals (BLOCK) is skipped.
 * 2. "buy the cheaper one from Velbrook-Outlet Deals instead" → MoneyGate refuses (server rule).
 * 3. The buyer approves in PayPal; "I approved it" → MoneyGate captures (SAFE).
 * 4. "what happened to my order?" → get_order (read only) reports the order as paid.
 * Real MoneyGate + demo catalog; PayPal and the scans are offline fixtures (see agent-demo/deps.ts). The live version
 * of the same flow is the workspace chat (real Channel3, KERNEL and PayPal sandbox).
 */
import { AGENT_SYSTEM_PROMPT, FakeModel, runAgentTurn, shoppingTools, type AgentMessage } from '@voircheck/agent';
import { demoAgentDeps } from './agent-demo/deps';

const lang = process.argv.includes('--fr') ? 'fr' : 'en';
const { deps, paypal, store } = demoAgentDeps();
const tools = shoppingTools(deps);
const model = new FakeModel();
let history: AgentMessage[] = [];

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
  history = r.messages;
  const last = history.at(-2);
  if (last?.role === 'tool') for (const res of last.results) console.log(`    ${res.content}`);
}

await say(lang === 'fr' ? 'trouve des écouteurs sans fil à moins de 60 $' : 'find wireless earbuds under $60');
await say(lang === 'fr' ? 'achète plutôt le moins cher chez Velbrook-Outlet Deals' : 'buy the cheaper one from Velbrook-Outlet Deals instead');
console.log('\n[PayPal sandbox: the buyer approves the Velbrook Supply order]');
paypal.approveAll();
await say(lang === 'fr' ? "j'ai validé" : 'I approved it');
await say(lang === 'fr' ? 'qu’est-il arrivé à ma commande ?' : 'what happened to my order?');

console.log('\nPayPal calls:', paypal.calls.join(', '));
console.log('Audit:', store.audit.map((a) => `${a.actor}:${a.action}`).join(', '));
