import type { AgentMessage, ModelClient, ModelRequest, ModelTurn, ToolCall } from './model';

/**
 * Scripted, deterministic stand-in for the real model (no Anthropic key yet). It reads only what the real model would
 * read (the user's words and our tool results as JSON) and follows the system prompt's rules in code:
 * search → check every store → trust first, then price → prepare the order at the best SAFE store → let the gate decide.
 * "What happened to my order?" reads the latest order's status with get_order (read only).
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
interface OrderStatus {
  status?: string;
  orderStatus?: string;
  amount?: { value: string; currency: string } | null;
  authorizationStatus?: string | null;
  captureStatus?: string | null;
}
interface Verdict {
  storeId: string;
  verdict?: 'SAFE' | 'HOLD' | 'BLOCK';
  score?: number;
  pageTriedToInstructAgents?: boolean;
  signals?: Array<{ id: string; status: string; meaning: string }>;
  /** The compact view (scanForModel): checks that didn't pass. */
  checks?: Array<{ id: string; status: string; meaning: string }>;
}

const T = {
  en: {
    ask: 'What are you shopping for? Tell me the item and, if you like, a budget.',
    searching: (q: string) => `Looking for ${q}.`,
    none: (q: string) => `I couldn't find ${q} at a store I can check. Try a different wording.`,
    searchDown: "Product search isn't available right now, so I can't look this up.",
    checking: (n: number) => `Found ${n} store${n === 1 ? '' : 's'}. Checking each one before I suggest anything.`,
    pick: (s: Store, others: string) => `${s.storeName} looks safe to buy: ${s.productTitle} for ${money(s, 'en')}.${others} I've prepared the order: tap the PayPal button to say yes, nothing is charged before that.`,
    skip: (s: Store, v: Verdict) => ` ${s.storeName} looks like a fake shop${reasonEn(v)}, so I won't pay it, even at ${money(s, 'en')}.`,
    injection: ' Its page also hid instructions aimed at shopping helpers like me, a strong warning sign.',
    alt: (s: Store) => ` ${s.storeName} also looks safe to buy, with a different product: ${s.productTitle} for ${money(s, 'en')}.`,
    noSafe: 'None of these shops looks safe enough, so I haven\'t prepared an order. Tap “Why?” on a card to see what I found.',
    holdOnly: (s: Store) => `Something looks a bit off at ${s.storeName}, so I won't buy there on my own. Buy anyway, or see why?`,
    refused: (s: string, r: string) => `I can't pay ${s}: ${r}. That's VoirCheck's rule, and I can't change it.`,
    reasons: { block: 'it looks like a fake shop', unverified: "I couldn't check this shop right now", no_price: "I don't know its price", not_found: "that shop isn't in this search", other: 'the payment check said no' },
    unknownStore: "Which shop do you mean? Tap “Buy this” on the one you want.",
    waiting: 'The order is waiting for your approval in PayPal.',
    settled: (st: string) => (st === 'captured' ? 'Done, you paid. I’ll keep your receipt in History.' : st === 'authorized' ? 'PayPal is holding your money; nothing is taken yet. You decide on the shop’s card.' : st === 'voided' ? 'PayPal gave the money back; nothing was charged.' : 'That payment didn’t go through. Nothing was charged.'),
    noOrder: "There's no order waiting yet.",
    failed: "That didn't work. Try again in a moment.",
    orderState: (o: OrderStatus) => {
      const amt = orderMoney(o, 'en');
      if (o.captureStatus === 'COMPLETED') return `PayPal shows your order as completed: ${amt} was paid.`;
      if (o.authorizationStatus === 'VOIDED') return `PayPal gave the ${amt} back; nothing was charged.`;
      if (o.authorizationStatus === 'CREATED') return `PayPal shows ${amt} held, not taken yet.`;
      if (o.orderStatus === 'APPROVED') return `You said yes to the ${amt} order in PayPal. Tell me when you're done and I'll finish it.`;
      if (o.orderStatus === 'PAYER_ACTION_REQUIRED' || o.orderStatus === 'CREATED') return `Your ${amt} order is waiting for your approval in PayPal.`;
      return `PayPal shows the order as ${o.orderStatus}.`;
    },
    orderUnknown: "I couldn't look up that order right now.",
  },
  fr: {
    ask: 'Que cherchez-vous ? Dites-moi l’article et, si vous voulez, un budget.',
    searching: (q: string) => `Je cherche ${q}.`,
    none: (q: string) => `Je n’ai pas trouvé ${q} dans une boutique que je peux vérifier. Essayez une autre formulation.`,
    searchDown: 'La recherche de produits n’est pas disponible pour l’instant.',
    checking: (n: number) => `${n} boutique${n === 1 ? '' : 's'} trouvée${n === 1 ? '' : 's'}. Je vérifie chacune avant de proposer quoi que ce soit.`,
    pick: (s: Store, others: string) => `${s.storeName} semble sûr pour acheter : ${s.productTitle} à ${money(s, 'fr')}.${others} J’ai préparé la commande : validez-la avec le bouton PayPal, rien n’est prélevé avant.`,
    skip: (s: Store) => ` ${s.storeName} ressemble à une fausse boutique, je ne la paierai pas, même à ${money(s, 'fr')}.`,
    injection: ' Sa page cachait aussi des consignes destinées aux assistants d’achat comme moi : un signal d’alerte fort.',
    alt: (s: Store) => ` ${s.storeName} semble sûr aussi, avec un autre produit : ${s.productTitle} à ${money(s, 'fr')}.`,
    noSafe: 'Aucune de ces boutiques ne semble assez sûre, donc je n’ai pas préparé de commande. Touchez « Pourquoi ? » sur une carte pour voir ce que j’ai trouvé.',
    holdOnly: (s: Store) => `Quelque chose cloche un peu chez ${s.storeName}, donc je n’achèterai pas seul. Acheter quand même, ou voir pourquoi ?`,
    refused: (s: string, r: string) => `Je ne peux pas payer ${s} : ${r}. C’est la règle de VoirCheck, je ne peux pas la changer.`,
    reasons: { block: 'elle ressemble à une fausse boutique', unverified: 'je n’ai pas pu vérifier cette boutique pour l’instant', no_price: 'je ne connais pas son prix', not_found: 'cette boutique n’est pas dans cette recherche', other: 'le contrôle de paiement a refusé' },
    unknownStore: 'De quelle boutique parlez-vous ? Touchez « Acheter » sur celle que vous voulez.',
    waiting: 'La commande attend votre validation dans PayPal.',
    settled: (st: string) => (st === 'captured' ? 'C’est fait, vous avez payé. Je garde votre reçu dans l’Historique.' : st === 'authorized' ? 'PayPal garde votre argent de côté, rien n’est prélevé. Vous décidez sur la carte de la boutique.' : st === 'voided' ? 'PayPal vous a rendu l’argent ; rien n’a été prélevé.' : 'Ce paiement n’est pas passé. Rien n’a été prélevé.'),
    noOrder: 'Aucune commande n’attend pour l’instant.',
    failed: 'Ça n’a pas marché. Réessayez dans un instant.',
    orderState: (o: OrderStatus) => {
      const amt = orderMoney(o, 'fr');
      if (o.captureStatus === 'COMPLETED') return `PayPal indique que votre commande est terminée : ${amt} ont été payés.`;
      if (o.authorizationStatus === 'VOIDED') return `PayPal vous a rendu les ${amt} ; rien n’a été prélevé.`;
      if (o.authorizationStatus === 'CREATED') return `PayPal indique que ${amt} sont bloqués, pas encore prélevés.`;
      if (o.orderStatus === 'APPROVED') return `Vous avez validé la commande de ${amt} dans PayPal. Dites-moi quand c’est fait et je la termine.`;
      if (o.orderStatus === 'PAYER_ACTION_REQUIRED' || o.orderStatus === 'CREATED') return `Votre commande de ${amt} attend votre validation dans PayPal.`;
      return `PayPal indique le statut : ${o.orderStatus}.`;
    },
    orderUnknown: 'Je n’ai pas pu consulter cette commande pour l’instant.',
  },
} as const;

function money(s: Store, lang: Lang): string {
  if (!s.price) return lang === 'fr' ? 'un prix inconnu' : 'an unknown price';
  return new Intl.NumberFormat(lang === 'fr' ? 'fr-FR' : 'en-US', { style: 'currency', currency: s.currency }).format(Number(s.price));
}

function orderMoney(o: OrderStatus, lang: Lang): string {
  if (!o.amount) return lang === 'fr' ? 'la commande' : 'the order';
  return new Intl.NumberFormat(lang === 'fr' ? 'fr-FR' : 'en-US', { style: 'currency', currency: o.amount.currency }).format(Number(o.amount.value));
}

function reasonEn(v: Verdict): string {
  const failed = (v.checks ?? v.signals ?? []).filter((s) => s.status === 'fail').map((s) => s.meaning);
  return failed.length ? ` (${failed.slice(0, 2).join(', ')})` : '';
}

const PRICE_RE = /(?:\s(?:for|à)\s+)?\b(?:under|below|less than|max(?:imum)?|up to|moins de|sous|max\.?|jusqu['’]à)\s*(?:\$|€|usd\s*)?(\d+(?:[.,]\d+)?)\s*(?:\$|€|dollars?|euros?)?/i;
const LEAD_RE = /^(?:please\s+)?(?:can you\s+|could you\s+)?(?:find|search(?: for)?|look(?:ing)? for|buy|get|show)(?:\s+me)?\s+|^(?:trouve|cherche|achète)(?:[- ]moi)?\s+(?:des\s+|un\s+|une\s+)?/i;
const BUY_OTHER_RE = /\b(buy|order|pay|get it|achète|commande|paye)\b.*\b(from|at|chez|à)\b|\b(cheaper|cheapest|moins cher)\b/i;
const FOLLOW_UP_RE = /\b(cheaper|cheapest|instead|that one|this one|moins cher|plutôt|celle-ci|celle-là)\b/i;
// No trailing \b: it never matches after an accented letter ("validé").
const APPROVED_RE = /\b(approved|i paid|paid it|done|j['’]ai (payé|validé|approuvé)|c['’]est validé)(?=$|[\s.,;:!?])/i;

const STATUS_RE = /\b(what happened to my order|where(?: is|'s) my order|order status|status of my order|où en est ma commande|qu['’]est-il arrivé à ma commande|statut de (?:ma|la) commande)/i;

export function parseShoppingRequest(text: string): { query: string; maxPrice: number | null } | null {
  const m = text.match(PRICE_RE);
  const maxPrice = m ? Number(m[1]!.replace(',', '.')) : null;
  const query = text.replace(PRICE_RE, '').replace(LEAD_RE, '').replace(/[?.!]+$/, '').replace(/\s+/g, ' ').trim();
  return query.length >= 2 ? { query: query.slice(0, 120), maxPrice } : null;
}

/** Lifts the store's own words back out of their `untrusted` object (searchForModel / recentOrdersForModel). */
const unframe = (v: unknown): unknown => {
  if (!v || typeof v !== 'object') return v;
  const o = v as Record<string, unknown>;
  const lift = (x: unknown) => (x && typeof x === 'object' && 'untrusted' in x ? { ...(x as object), ...((x as { untrusted: object }).untrusted ?? {}) } : x);
  if (Array.isArray(o.stores)) return { ...o, stores: o.stores.map(lift) };
  if (Array.isArray(o.orders)) return { ...o, orders: o.orders.map(lift) };
  return o;
};

const parse = <T>(s: string): T | null => {
  try {
    return unframe(JSON.parse(s)) as T;
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
    // The latest order that exists (a later refusal doesn't replace it).
    const latestOrder = () => [...history].reverse().find((h) => h.name === 'create_order' && !h.isError && (h.result as { paymentId?: string } | null)?.paymentId)?.result as { paymentId?: string } | undefined;

    if (!last) return say(t.ask);

    if (last.role === 'user') {
      const text = last.text;
      if (STATUS_RE.test(text)) {
        const order = latestOrder();
        return order?.paymentId ? { text: '', toolCalls: [call('get_order', { order: order.paymentId })] } : say(t.noOrder);
      }
      if (APPROVED_RE.test(text)) {
        const order = latestOrder();
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

    if (names[0] === 'get_order') {
      const r = results[0]?.data as OrderStatus | null;
      return say(!results[0]?.isError && r?.status === 'ok' && r.orderStatus ? t.orderState(r) : t.orderUnknown);
    }
    return say(t.ask);
  }
}
