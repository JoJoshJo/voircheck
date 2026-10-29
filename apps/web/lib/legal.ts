import type { Lang } from './i18n';

/**
 * Privacy + Terms content (EN + FR). Written from what the code actually does (data inventory, Oct 29 2026):
 * keep it in sync when data flows change. Plain text only (rendered as text, never HTML).
 */

/** The one place the contact address lives (privacy, terms, deletion requests). */
export const CONTACT_EMAIL = 'lawsgamer213@gmail.com';
export const LEGAL_LAST_UPDATED = '2026-10-29';

export interface LegalSection {
  heading: string;
  paragraphs?: string[];
  items?: string[];
}
export interface LegalPage {
  title: string;
  lastUpdated: string;
  intro: string[];
  sections: LegalSection[];
}

const privacyEn: LegalPage = {
  title: 'Privacy',
  lastUpdated: `Last updated: ${LEGAL_LAST_UPDATED}`,
  intro: [
    'VoirCheck is a hackathon project built for the PayPal AI Hackathon 2026. It checks an online store before an AI shopping agent pays it.',
    'All payments use PayPal’s sandbox: test accounts and test money only. No real money moves, and card or bank details never reach our servers. PayPal handles them.',
  ],
  sections: [
    {
      heading: 'What we store',
      items: [
        'Your account: your email address and name. If you sign in with Google, Google shares your name, email address and profile picture link, and our sign-in provider keeps the sign-in tokens Google returns. “Try the demo” accounts use a random, made-up email address.',
        'Sign-in sessions: for each session, our sign-in provider records the IP address and browser type (user agent) to keep you signed in securely.',
        'Your settings: language, whether Auto-pay is on, and your Auto-pay limit.',
        'What you check: the store links you paste, when you checked them, and the scan results with their evidence (taken from the store’s public pages).',
        'Sandbox payments: the amount, the store, PayPal sandbox order, authorization and capture IDs, and their status. If you use Auto-pay, the reference ID of your saved sandbox PayPal wallet (never a login, password or card number).',
        'PayPal notifications: the messages PayPal’s sandbox sends us about payments, kept as received. They can include the sandbox buyer account’s name and email address.',
        'Trust Receipts: the store, verdict, evidence summary and what happened to the payment. Receipts contain no personal information.',
        'An audit log of every payment decision, allowed or refused. It is linked to a random account ID, not your name or email address, and entries are never edited.',
      ],
    },
    {
      heading: 'Cookies',
      paragraphs: [
        'We use only the cookies VoirCheck needs to work: the sign-in session cookies set by our sign-in provider (names starting with __Secure-neon-auth), vc_lang (your language) and vc_demo (whether Demo mode is on).',
        'No advertising, analytics or tracking cookies. The PayPal checkout window is PayPal’s own site and follows PayPal’s policies.',
      ],
    },
    {
      heading: 'Who processes data for us',
      items: [
        'Neon: our database and sign-in (Neon Auth). It stores everything listed above.',
        'Render: hosts the app. It keeps standard server logs (time, page requested, IP address).',
        'PayPal (sandbox): processes the test payments and saved test wallets.',
        'Resend: sends your Trust Receipt emails. It receives your account email address and the receipt content.',
        'KERNEL: opens the store pages you check in an isolated cloud browser. It receives store links, not your account data. The live view you watch is streamed from KERNEL to your browser.',
        'Google Safe Browsing: receives the store links you check, to look them up on threat lists.',
        'Domain registries (RDAP): receive a store’s domain name, to look up when it was registered.',
        'The store itself: our server connects to the store’s server to check its security certificate, and KERNEL visits its pages.',
        'Google: only if you choose “Continue with Google”, to sign you in.',
        'Channel3: will receive your product search queries once product search is switched on (not live yet).',
        'Anthropic: will receive the text of store pages for AI analysis once that feature is switched on (not live yet). It will not receive your account data.',
      ],
    },
    {
      heading: 'Store links and public receipts',
      paragraphs: [
        'The store links you check are sent to the services above so the store can be checked. Scan results are shared between users who check the same link.',
        'Trust Receipt pages (/r/…) are public to anyone who has the link. The links are long and random, and receipts never include your name, email address or PayPal IDs.',
      ],
    },
    {
      heading: 'What we don’t do',
      items: ['We don’t sell your data.', 'We don’t show ads.', 'We don’t use tracking cookies.', 'We don’t share your data beyond the services listed above.'],
    },
    {
      heading: 'Google user data',
      paragraphs: [
        'If you sign in with Google, we use your Google account information only to sign you in and to show your account name and email address in VoirCheck. We don’t use it for ads, don’t sell it, don’t use it to train AI models, and don’t share it except with the services needed to run sign-in.',
        'VoirCheck’s use and transfer of information received from Google APIs adheres to the Google API Services User Data Policy, including the Limited Use requirements.',
      ],
    },
    {
      heading: 'How long we keep it',
      paragraphs: [
        'We keep data through the hackathon judging period (until 15 December 2026). After that, we will delete account data 90 days after it was created, keeping only anonymous scan statistics. You can ask us to delete your data sooner at any time.',
      ],
    },
    {
      heading: 'Delete your data or ask a question',
      paragraphs: [`Email ${CONTACT_EMAIL}. We’ll delete your account and the data linked to it. Audit log entries are kept, but they hold only a random account ID, not your name or email address.`],
    },
  ],
};

const privacyFr: LegalPage = {
  title: 'Confidentialité',
  lastUpdated: `Dernière mise à jour : ${LEGAL_LAST_UPDATED}`,
  intro: [
    'VoirCheck est un projet de hackathon créé pour le PayPal AI Hackathon 2026. Il vérifie une boutique en ligne avant qu’un agent d’achat IA ne la paie.',
    'Tous les paiements passent par le sandbox de PayPal : comptes de test et argent fictif uniquement. Aucun argent réel n’est débité, et vos données de carte ou bancaires n’arrivent jamais sur nos serveurs : PayPal s’en charge.',
  ],
  sections: [
    {
      heading: 'Ce que nous conservons',
      items: [
        'Votre compte : votre adresse e-mail et votre nom. Si vous vous connectez avec Google, Google nous transmet votre nom, votre adresse e-mail et le lien de votre photo de profil, et notre service de connexion conserve les jetons de connexion renvoyés par Google. Les comptes « Essayer la démo » utilisent une adresse e-mail aléatoire et fictive.',
        'Sessions de connexion : pour chaque session, notre service de connexion enregistre l’adresse IP et le type de navigateur (user agent) afin de vous garder connecté en toute sécurité.',
        'Vos réglages : la langue, l’activation du paiement automatique et son plafond.',
        'Ce que vous vérifiez : les liens de boutiques que vous collez, la date de vérification, et les résultats d’analyse avec leurs preuves (issues des pages publiques de la boutique).',
        'Paiements sandbox : le montant, la boutique, les identifiants de commande, d’autorisation et d’encaissement PayPal sandbox, et leur statut. Si vous utilisez le paiement automatique, la référence de votre portefeuille PayPal sandbox enregistré (jamais d’identifiant, de mot de passe ni de numéro de carte).',
        'Notifications PayPal : les messages que le sandbox PayPal nous envoie sur les paiements, conservés tels quels. Ils peuvent contenir le nom et l’adresse e-mail du compte acheteur sandbox.',
        'Reçus de confiance : la boutique, le verdict, le résumé des preuves et ce qu’il est advenu du paiement. Les reçus ne contiennent aucune information personnelle.',
        'Un journal d’audit de chaque décision de paiement, autorisée ou refusée. Il est lié à un identifiant de compte aléatoire, pas à votre nom ni à votre e-mail, et ses entrées ne sont jamais modifiées.',
      ],
    },
    {
      heading: 'Cookies',
      paragraphs: [
        'Nous utilisons uniquement les cookies nécessaires au fonctionnement de VoirCheck : les cookies de session de connexion posés par notre service de connexion (noms commençant par __Secure-neon-auth), vc_lang (votre langue) et vc_demo (si le mode démo est activé).',
        'Aucun cookie publicitaire, de mesure d’audience ni de pistage. La fenêtre de paiement PayPal est le site de PayPal et suit les règles de PayPal.',
      ],
    },
    {
      heading: 'Qui traite des données pour nous',
      items: [
        'Neon : notre base de données et la connexion (Neon Auth). Il conserve tout ce qui est listé ci-dessus.',
        'Render : héberge l’application. Il conserve des journaux serveur standard (heure, page demandée, adresse IP).',
        'PayPal (sandbox) : traite les paiements de test et les portefeuilles de test enregistrés.',
        'Resend : envoie vos reçus de confiance par e-mail. Il reçoit l’adresse e-mail de votre compte et le contenu du reçu.',
        'KERNEL : ouvre les pages des boutiques que vous vérifiez dans un navigateur cloud isolé. Il reçoit les liens des boutiques, pas les données de votre compte. La vue en direct que vous regardez est diffusée de KERNEL vers votre navigateur.',
        'Google Safe Browsing : reçoit les liens de boutiques que vous vérifiez, pour les comparer aux listes de menaces.',
        'Registres de noms de domaine (RDAP) : reçoivent le nom de domaine d’une boutique, pour connaître sa date d’enregistrement.',
        'La boutique elle-même : notre serveur se connecte au serveur de la boutique pour vérifier son certificat de sécurité, et KERNEL visite ses pages.',
        'Google : uniquement si vous choisissez « Continuer avec Google », pour vous connecter.',
        'Channel3 : recevra vos recherches de produits une fois la recherche activée (pas encore en ligne).',
        'Anthropic : recevra le texte des pages des boutiques pour l’analyse par IA une fois cette fonction activée (pas encore en ligne). Il ne recevra pas les données de votre compte.',
      ],
    },
    {
      heading: 'Liens de boutiques et reçus publics',
      paragraphs: [
        'Les liens de boutiques que vous vérifiez sont envoyés aux services ci-dessus pour que la boutique puisse être vérifiée. Les résultats d’analyse sont partagés entre les utilisateurs qui vérifient le même lien.',
        'Les pages de reçu (/r/…) sont publiques pour toute personne qui a le lien. Ces liens sont longs et aléatoires, et les reçus n’incluent jamais votre nom, votre adresse e-mail ni vos identifiants PayPal.',
      ],
    },
    {
      heading: 'Ce que nous ne faisons pas',
      items: [
        'Nous ne vendons pas vos données.',
        'Nous n’affichons pas de publicité.',
        'Nous n’utilisons pas de cookies de pistage.',
        'Nous ne partageons pas vos données au-delà des services listés ci-dessus.',
      ],
    },
    {
      heading: 'Données des utilisateurs Google',
      paragraphs: [
        'Si vous vous connectez avec Google, nous utilisons les informations de votre compte Google uniquement pour vous connecter et pour afficher le nom et l’adresse e-mail de votre compte dans VoirCheck. Nous ne les utilisons pas pour la publicité, ne les vendons pas, ne les utilisons pas pour entraîner des modèles d’IA et ne les partageons qu’avec les services nécessaires à la connexion.',
        'L’utilisation et le transfert par VoirCheck des informations reçues des API Google respectent la Google API Services User Data Policy, y compris les exigences de Limited Use (utilisation limitée).',
      ],
    },
    {
      heading: 'Durée de conservation',
      paragraphs: [
        'Nous conservons les données pendant la période d’évaluation du hackathon (jusqu’au 15 décembre 2026). Ensuite, nous supprimerons les données de compte 90 jours après leur création, en ne gardant que des statistiques d’analyse anonymes. Vous pouvez nous demander de supprimer vos données plus tôt à tout moment.',
      ],
    },
    {
      heading: 'Supprimer vos données ou poser une question',
      paragraphs: [`Écrivez à ${CONTACT_EMAIL}. Nous supprimerons votre compte et les données qui y sont liées. Les entrées du journal d’audit sont conservées, mais elles ne contiennent qu’un identifiant de compte aléatoire, ni votre nom ni votre adresse e-mail.`],
    },
  ],
};

const termsEn: LegalPage = {
  title: 'Terms',
  lastUpdated: `Last updated: ${LEGAL_LAST_UPDATED}`,
  intro: ['VoirCheck is a hackathon demo built for the PayPal AI Hackathon 2026. By using it, you agree to these terms.'],
  sections: [
    { heading: 'Provided as is', paragraphs: ['VoirCheck is provided as is, without any warranty. It may be unavailable, change or be reset at any time.'] },
    { heading: 'Sandbox only', paragraphs: ['All payments use PayPal’s sandbox with test accounts and test money. No real money moves. Never enter real payment details.'] },
    {
      heading: 'Verdicts are risk signals, not guarantees',
      paragraphs: ['SAFE, HOLD and BLOCK are based on automated checks. A store marked SAFE can still turn out to be dishonest, and a BLOCK can be wrong. The decision to buy is yours.'],
    },
    { heading: 'Demo stores are fictional', paragraphs: ['The demo stores are made up and clearly labelled. Any resemblance to a real business is unintended.'] },
    {
      heading: 'Fair use',
      paragraphs: ['Use VoirCheck to check stores you are thinking of buying from. Don’t use it to attack, overload, probe or scrape websites, or to get around its limits. We may block accounts that misuse it.'],
    },
    { heading: 'Open source', paragraphs: ['VoirCheck’s code is released under the MIT License.'] },
    { heading: 'Contact', paragraphs: [`Questions: ${CONTACT_EMAIL}.`] },
  ],
};

const termsFr: LegalPage = {
  title: 'Conditions d’utilisation',
  lastUpdated: `Dernière mise à jour : ${LEGAL_LAST_UPDATED}`,
  intro: ['VoirCheck est une démo de hackathon créée pour le PayPal AI Hackathon 2026. En l’utilisant, vous acceptez ces conditions.'],
  sections: [
    { heading: 'Fourni en l’état', paragraphs: ['VoirCheck est fourni en l’état, sans aucune garantie. Il peut être indisponible, modifié ou réinitialisé à tout moment.'] },
    { heading: 'Sandbox uniquement', paragraphs: ['Tous les paiements passent par le sandbox de PayPal, avec des comptes de test et de l’argent fictif. Aucun argent réel n’est débité. N’entrez jamais de vraies données de paiement.'] },
    {
      heading: 'Les verdicts sont des signaux de risque, pas des garanties',
      paragraphs: ['Fiable, En attente et Bloquée reposent sur des vérifications automatiques. Une boutique jugée fiable peut malgré tout se révéler malhonnête, et un blocage peut être une erreur. La décision d’acheter vous appartient.'],
    },
    { heading: 'Les boutiques de démo sont fictives', paragraphs: ['Les boutiques de démo sont inventées et clairement signalées. Toute ressemblance avec une entreprise réelle est involontaire.'] },
    {
      heading: 'Usage loyal',
      paragraphs: ['Utilisez VoirCheck pour vérifier des boutiques où vous envisagez d’acheter. Ne l’utilisez pas pour attaquer, surcharger, sonder ou aspirer des sites web, ni pour contourner ses limites. Nous pouvons bloquer les comptes qui en font un mauvais usage.'],
    },
    { heading: 'Open source', paragraphs: ['Le code de VoirCheck est publié sous licence MIT.'] },
    { heading: 'Contact', paragraphs: [`Questions : ${CONTACT_EMAIL}.`] },
  ],
};

export const PRIVACY: Record<Lang, LegalPage> = { en: privacyEn, fr: privacyFr };
export const TERMS: Record<Lang, LegalPage> = { en: termsEn, fr: termsFr };
