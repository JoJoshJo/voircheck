import type { AgentMessage, ModelClient, ModelRequest, ModelTurn, ToolCall } from './model';

/**
 * Scripted, deterministic stand-in for the real model (no Anthropic key yet). It reads only what the real model would
 * read (the user's words and our tool results as JSON) and follows the system prompt's rules in code:
 * search → check every store → trust first, then price → prepare the order at the best SAFE store → let the gate decide.
 * Same conversation in, same turn out. Tool-call IDs are numbered from the conversation length, never random.
 */

type Lang = 'en' | 'fr';
interface Store {
  storeId: string;
  storeName: string;
  productTitle: string;
  price: string | null;
  currency: string;
}
interface Verdict {
  storeId: string;
  verdict?: 'SAFE' | 'HOLD' | 'BLOCK';
  score?: number;
  pageTriedToInstructAgents?: boolean;
  signals?: Array<{ id: string; status: string; meaning: string }>;
}

const T = {
  en: {
    ask: 'What are you shopping for? Tell me the item and, if you like, a budget.',
    searching: (q: string) => `Looking for ${q}.`,
    none: (q: string) => `I couldn't find ${q} at a store I can check. Try a different wording.`,
    searchDown: "Product search isn't available right now, so I can't look this up.",
    checking: (n: number) => `Found ${n} store${n === 1 ? '' : 's'}. Checking each one before I suggest anything.`,
    pick: (s: Store, others: string) => `${s.storeName} looks safe and has ${s.productTitle} for ${money(s, 'en')}.${others} I've prepared the order; approve it in PayPal when you're ready.`,
    skip: (s: Store, v: Verdict) => ` I'd skip ${s.storeName} (${v.verdict}${reasonEn(v)}), even though it's ${money(s, 'en')}.`,
    injection: ' Its page also hid text aimed at AI shopping agents.',
    alt: (s: Store) => ` ${s.storeName} also looks safe, with a different product: ${s.productTitle} for ${money(s, 'en')}.`,
    noSafe: 'None of these stores checked out as safe, so I haven\'t prepared an order. You can see the evidence on each card.',
    holdOnly: (s: Store) => `${s.storeName} is on hold: some checks were unclear. Look at the evidence and decide; I won't buy there on my own.`,
    refused: (s: string, r: string) => `VoirCheck won't let me buy from ${s}: ${r}. That's the server's rule, not mine to change.`,
    reasons: { block: 'its scan says BLOCK', unverified: "the store can't be verified right now", no_price: 'there is no known price', not_found: "that store isn't in this search", other: 'the payment check said no' },
    unknownStore: "I don't know which store you mean. Pick one from the results.",
    waiting: 'The order is waiting for your approval in PayPal.',
    settled: (st: string) => (st === 'captured' ? 'Paid. VoirCheck captured the payment.' : st === 'authorized' ? 'The money is held, not taken. You decide on the store card.' : st === 'voided' ? 'VoirCheck released the hold; nothing was charged.' : `The payment is ${st}.`),
    noOrder: "There's no order waiting yet.",
    failed: "That didn't work. Try again in a moment.",
  },
  fr: {
    ask: 'Que cherchez-vous ? Dites-moi l’article et, si vous voulez, un budget.',
    searching: (q: string) => `Je cherche ${q}.`,
    none: (q: string) => `Je n’ai pas trouvé ${q} dans une boutique que je peux vérifier. Essayez une autre formulation.`,
    searchDown: 'La recherche de produits n’est pas disponible pour l’instant.',
    checking: (n: number) => `${n} boutique${n === 1 ? '' : 's'} trouvée${n === 1 ? '' : 's'}. Je vérifie chacune avant de proposer quoi que ce soit.`,
    pick: (s: Store, others: string) => `${s.storeName} semble fiable et propose ${s.productTitle} à ${money(s, 'fr')}.${others} J’ai préparé la commande ; validez-la dans PayPal quand vous voulez.`,
    skip: (s: Store, v: Verdict) => ` J’éviterais ${s.storeName} (${v.verdict}), même à ${money(s, 'fr')}.`,
    injection: ' Sa page cachait aussi du texte destiné aux agents d’achat IA.',
    alt: (s: Store) => ` ${s.storeName} semble fiable aussi, avec un autre produit : ${s.productTitle} à ${money(s, 'fr')}.`,
    noSafe: 'Aucune de ces boutiques n’est jugée sûre, donc je n’ai pas préparé de commande. Les preuves sont sur chaque carte.',
    holdOnly: (s: Store) => `${s.storeName} est en attente : certains contrôles sont incertains. Regardez les preuves et décidez ; je n’achèterai pas seul.`,
    refused: (s: string, r: string) => `VoirCheck refuse que j’achète chez ${s} : ${r}. C’est la règle du serveur, je ne peux pas la changer.`,
    reasons: { block: 'son analyse dit BLOQUER', unverified: 'la boutique ne peut pas être vérifiée pour l’instant', no_price: 'aucun prix connu', not_found: 'cette boutique n’est pas dans cette recherche', other: 'le contrôle de paiement a refusé' },
    unknownStore: 'Je ne sais pas de quelle boutique vous parlez. Choisissez-en une dans les résultats.',
    waiting: 'La commande attend votre validation dans PayPal.',
    settled: (st: string) => (st === 'captured' ? 'Payé. VoirCheck a encaissé le paiement.' : st === 'authorized' ? 'L’argent est bloqué, pas prélevé. Vous décidez sur la carte de la boutique.' : st === 'voided' ? 'VoirCheck a libéré le blocage ; rien n’a été prélevé.' : `Le paiement est : ${st}.`),
    noOrder: 'Aucune commande n’attend pour l’instant.',
    failed: 'Ça n’a pas marché. Réessayez dans un instant.',
  },
} as const;

function money(s: Store, lang: Lang): string {
  if (!s.price) return lang === 'fr' ? 'un prix inconnu' : 'an unknown price';
  return new Intl.NumberFormat(lang === 'fr' ? 'fr-FR' : 'en-US', { style: 'currency', currency: s.currency }).format(Number(s.price));
}

function reasonEn(v: Verdict): string {
  const failed = (v.signals ?? []).filter((s) => s.status === 'fail').map((s) => s.meaning);
  return failed.length ? `: ${failed.slice(0, 2).join(', ')}` : '';
}

const PRICE_RE = /(?:\s(?:for|à)\s+)?\b(?:under|below|less than|max(?:imum)?|up to|moins de|sous|max\.?|jusqu['’]à)\s*(?:\$|€|usd\s*)?(\d+(?:[.,]\d+)?)\s*(?:\$|€|dollars?|euros?)?/i;
const LEAD_RE = /^(?:please\s+)?(?:can you\s+|could you\s+)?(?:find|search(?: for)?|look(?:ing)? for|buy|get|show)(?:\s+me)?\s+|^(?:trouve|cherche|achète)(?:[- ]moi)?\s+(?:des\s+|un\s+|une\s+)?/i;
const BUY_OTHER_RE = /\b(buy|order|pay|get it|achète|commande|paye)\b.*\b(from|at|chez|à)\b|\b(cheaper|cheapest|moins cher)\b/i;
const FOLLOW_UP_RE = /\b(cheaper|cheapest|instead|that one|this one|moins cher|plutôt|celle-ci|celle-là)\b/i;
const APPROVED_RE = /\b(approved|i paid|paid it|done|j['’]ai (payé|validé|approuvé)|c['’]est validé)\b/i;

export function parseShoppingRequest(text: string): { query: string; maxPrice: number | null } | null {
  const m = text.match(PRICE_RE);
  const maxPrice = m ? Number(m[1]!.replace(',', '.')) : null;
  const query = text.replace(PRICE_RE, '').replace(LEAD_RE, '').replace(/[?.!]+$/, '').replace(/\s+/g, ' ').trim();
  return query.length >= 2 ? { query: query.slice(0, 120), maxPrice } : null;
}

const parse = <T>(s: string): T | null => {
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
};

/** Every tool call in the conversation with its parsed result. */
function toolHistory(messages: readonly AgentMessage[]) {
  const out: Array<{ name: string; input: unknown; result: unknown; isError: boolean }> = [];
  const calls = new Map<string, ToolCall>();
  for (const m of messages) {
    if (m.role === 'assistant') m.toolCalls.forEach((c) => calls.set(c.id, c));
    if (m.role === 'tool') for (const r of m.results) out.push({ name: calls.get(r.toolCallId)?.name ?? '', input: calls.get(r.toolCallId)?.input, result: parse(r.content), isError: !!r.isError });
  }
  return out;
}

const VERDICT_RANK = { SAFE: 0, HOLD: 1, BLOCK: 2 } as const;

export class FakeModel implements ModelClient {
  readonly id = 'fake-scripted';

  async respond(req: ModelRequest): Promise<ModelTurn> {
    return this.next(req.messages, req.lang);
  }

  private next(messages: readonly AgentMessage[], lang: Lang): ModelTurn {
    const t = T[lang];
    const last = messages[messages.length - 1];
    const n = messages.length;
    const call = (name: string, input: unknown, i = 0): ToolCall => ({ id: `fake_${n}_${i}`, name, input });
    const say = (text: string): ModelTurn => ({ text, toolCalls: [] });
    const history = toolHistory(messages);
    const latest = <R>(name: string) => [...history].reverse().find((h) => h.name === name && !h.isError)?.result as R | undefined;
    const stores = latest<{ status: string; stores?: Store[] }>('search_products')?.stores ?? [];

    if (!last) return say(t.ask);

    if (last.role === 'user') {
      const text = last.text;
      if (APPROVED_RE.test(text)) {
        const order = latest<{ status: string; paymentId?: string }>('create_order');
        return order?.paymentId ? { text: '', toolCalls: [call('request_payment', { paymentId: order.paymentId })] } : say(t.noOrder);
      }
      // A follow-up about earlier results ("the cheaper one", "instead") with no results in this chat: ask, don't search.
      if (!stores.length && FOLLOW_UP_RE.test(text)) return say(t.unknownStore);
      if (stores.length && BUY_OTHER_RE.test(text)) {
        const named = stores.find((s) => text.toLowerCase().includes(s.storeName.toLowerCase()));
        const cheapest = [...stores].filter((s) => s.price).sort((a, b) => Number(a.price) - Number(b.price))[0];
        const target = named ?? (/\b(cheaper|cheapest|moins cher)\b/i.test(text) ? cheapest : undefined);
        return target ? { text: '', toolCalls: [call('create_order', { storeId: target.storeId })] } : say(t.unknownStore);
      }
      const req = parseShoppingRequest(text);
      if (!req) return say(t.ask);
      return { text: t.searching(req.query), toolCalls: [call('search_products', req)] };
    }

    if (last.role !== 'tool') return say(t.ask);
    const prev = messages[n - 2];
    const names = prev?.role === 'assistant' ? prev.toolCalls.map((c) => c.name) : [];
    const results = last.results.map((r) => ({ ...r, data: parse<Record<string, unknown>>(r.content) }));

    if (names[0] === 'search_products') {
      const r = results[0]?.data as { status?: string; stores?: Store[] } | null;
      const q = (history.at(-1)?.input as { query?: string } | undefined)?.query ?? '';
      if (results[0]?.isError || r?.status === 'unavailable') return say(t.searchDown);
      if (!r?.stores?.length) return say(t.none(q));
      return { text: t.checking(r.stores.length), toolCalls: r.stores.map((s, i) => call('get_scan_verdict', { storeId: s.storeId }, i)) };
    }

    if (names[0] === 'get_scan_verdict') {
      const verdicts = results.filter((r) => !r.isError).map((r) => r.data as unknown as Verdict).filter((v) => v.verdict);
      const ranked = verdicts
        .map((v) => ({ v, s: stores.find((s) => s.storeId === v.storeId)! }))
        .filter((x) => x.s)
        .sort((a, b) => VERDICT_RANK[a.v.verdict!] - VERDICT_RANK[b.v.verdict!] || Number(a.s.price ?? Infinity) - Number(b.s.price ?? Infinity));
      // Compare stores for ONE item (spec 5.3): the product most stores sell (first result breaks a tie). A SAFE store
      // with a different product is mentioned as an alternative, never ranked against it on price.
      const key = (s: Store) => s.productTitle.trim().toLowerCase();
      const count = (k: string) => stores.filter((s) => key(s) === k).length;
      const item = stores.map(key).reduce((a, k) => (count(k) > count(a) ? k : a), stores[0] ? key(stores[0]) : '');
      const safe = ranked.filter((x) => x.v.verdict === 'SAFE' && x.s.price);
      const best = safe.find((x) => key(x.s) === item) ?? safe[0];
      const blocked = ranked.filter((x) => x.v.verdict === 'BLOCK');
      const alts = best ? safe.filter((x) => x !== best && key(x.s) !== key(best.s)).map((x) => t.alt(x.s)) : [];
      const notes = blocked.map((x) => t.skip(x.s, x.v) + (x.v.pageTriedToInstructAgents ? t.injection : '')).join('') + alts.join('');
      if (best) return { text: t.pick(best.s, notes), toolCalls: [call('create_order', { storeId: best.s.storeId })] };
      const hold = ranked.find((x) => x.v.verdict === 'HOLD');
      return say(hold ? t.holdOnly(hold.s) + notes : t.noSafe + notes);
    }

    if (names[0] === 'create_order') {
      const r = results[0]?.data as { status?: string; storeId?: string; reason?: string } | null;
      if (results[0]?.isError || !r) return say(t.failed);
      const name = stores.find((s) => s.storeId === r.storeId)?.storeName ?? '';
      if (r.status === 'refused') return say(t.refused(name, t.reasons[(r.reason ?? 'other') as keyof typeof t.reasons] ?? t.reasons.other));
      // The order text was already said when the order was requested after the scans; this is the follow-up turn.
      return say(prev?.role === 'assistant' && prev.text ? '' : t.waiting);
    }

    if (names[0] === 'request_payment') {
      const r = results[0]?.data as { status?: string } | null;
      if (results[0]?.isError || !r?.status) return say(t.failed);
      return say(r.status === 'waiting_for_buyer' ? t.waiting : t.settled(r.status));
    }
    return say(t.ask);
  }
}
