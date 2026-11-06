// Ecrin Wallet in French. The screens are written in English; once drawn, this swaps each piece of text for its
// French version: exact phrases first, then patterns for phrases with numbers or names in them. Anything not
// listed stays in English rather than being guessed.
const FR = {
  // home
  "Net worth": "Valeur totale", "Wallet": "Wallet", "Safe": "Safe", "Spend instantly": "Dépense immédiate", "Not set up": "Pas encore ouvert",
  "Send": "Envoyer", "Receive": "Recevoir", "Swap": "Échanger", "Protect": "Protéger", "Withdraw": "Retirer", "Buy": "Acheter",
  "Tokens": "Jetons", "Collectibles": "Collection", "Activity": "Activité", "Safety score": "Score de sécurité",
  "Every network · testnet beta": "Tous les réseaux · bêta testnet", "Reading every network… · testnet beta": "Lecture des réseaux… · bêta testnet",
  "Add a token": "Ajouter un jeton", "Details": "Détails", "Status": "Statut", "Confirmed": "Confirmé", "Date": "Date", "Website": "Site", "Transaction": "Transaction", "Contacts": "Contacts", "Add contact": "Ajouter un contact", "No contacts yet": "Aucun contact", "Export private key": "Exporter la clé privée", "Private key": "Clé privée", "Show private key": "Afficher la clé privée", "Save this address as a contact": "Enregistrer cette adresse comme contact", "Monthly report": "Rapport mensuel", "Moved into your Safe": "Mis dans votre Safe", "Received": "Reçu", "Sent": "Envoyé", "Left the Safe": "Sorti du Safe", "Moments Ecrin stepped in": "Quand Ecrin est intervenu", "Cooling-off pauses": "Pauses de réflexion", "Sends stopped by your limit": "Envois bloqués par votre limite", "Withdrawals you cancelled": "Retraits annulés", "Permissions you revoked": "Autorisations révoquées", "Website requests you approved": "Demandes de sites approuvées", "Security": "Sécurité", "Preferences": "Préférences", "Home screen": "Écran d'accueil", "About": "À propos", "Currency": "Devise", "Recovery phrase": "Phrase de récupération", "How the Safe works": "Comment fonctionne le Safe", "Security and audits": "Sécurité et audits", "Help and feedback": "Aide et suggestions", "Hide small balances": "Masquer les petits soldes", "Prices and totals show in this currency at today's rate. Your coins don't change.": "Les prix et totaux s'affichent dans cette devise au taux du jour. Vos jetons ne changent pas.", "Network": "Réseau", "Token contract": "Contrat du jeton", "Reading the token…": "Lecture du jeton…", "What brings you to Ecrin?": "Qu'est-ce qui vous amène chez Ecrin ?", "We'll suggest the right protections first. You can change everything later.": "Nous vous suggérerons d'abord les bonnes protections. Vous pourrez tout changer plus tard.", "Protect my savings": "Protéger mes économies", "From scams, drainers and stolen keys.": "Contre les arnaques, les drainers et les clés volées.", "Help me stay in control": "M'aider à garder le contrôle", "Limits and pauses against impulsive trading or gambling.": "Des limites et des pauses contre le trading impulsif ou le jeu.", "Both": "Les deux", "Protection from others, and from myself.": "Protection contre les autres, et contre moi-même.", "Market": "Marché", "Live": "En direct", "Your wallet is empty": "Votre wallet est vide", "Get test coins": "Obtenir des jetons de test",
  "Get free test coins to try Ecrin. They're not worth anything.": "Obtenez des jetons de test gratuits pour essayer Ecrin. Ils n'ont aucune valeur.",
  "Nothing here yet": "Rien pour l'instant", "Receive your first coins": "Recevez vos premiers jetons",
  "Sends, receives, Safe moves and website approvals show up here.": "Envois, réceptions, mouvements du Safe et autorisations de sites apparaissent ici.",
  "Search names, addresses, sites": "Rechercher un nom, une adresse, un site", "No collectibles yet": "Aucun objet de collection",
  "NFTs you own on Solana show up here.": "Vos NFT sur Solana apparaissent ici.", "Likely spam": "Probablement une arnaque",
  "Check your backup": "Vérifiez votre sauvegarde", "Check": "Vérifier", "Later": "Plus tard",
  "Make sure your 12 words are written down correctly. It takes 20 seconds.": "Assurez-vous que vos 12 mots sont bien notés. Ça prend 20 secondes.",
  // onboarding
  "A wallet for spending.": "Un wallet pour dépenser.", "A safe nobody can rush.": "Un coffre que personne ne peut presser.",
  "Create a new wallet": "Créer un nouveau wallet", "I have a recovery phrase": "J'ai une phrase de récupération", "Skip": "Passer", "Next": "Suivant", "Get started": "Commencer",
  "Two places for your money": "Deux endroits pour votre argent", "Nothing leaves the Safe in a hurry": "Rien ne quitte le Safe dans la précipitation", "Scams, caught before you sign": "Les arnaques, repérées avant de signer",
  "Testnet beta · not audited · test coins only": "Bêta testnet · non audité · jetons de test uniquement",
  "Unlock": "Déverrouiller", "Password": "Mot de passe", "Wrong password": "Mot de passe incorrect", "Welcome back": "Bon retour",
  // panels
  "Settings": "Réglages", "Accounts": "Comptes", "Add account": "Ajouter un compte", "Import key": "Importer une clé", "Import private key": "Importer une clé privée",
  "Name": "Nom", "Import": "Importer", "Save": "Enregistrer", "Remove": "Retirer", "Hide": "Masquer", "Show in list": "Afficher",
  "Review": "Vérifier", "Hold to send": "Maintenir pour envoyer", "Sending…": "Envoi…", "Done": "Terminé", "Back": "Retour",
  "From": "De", "To": "À", "Network fee": "Frais de réseau", "Amount": "Montant", "Send to": "Envoyer à", "Review and send": "Vérifier et envoyer",
  "Max": "Max", "View on the explorer": "Voir dans l'explorateur", "Explorer": "Explorateur", "Token address": "Adresse du jeton",
  "Your balance": "Votre solde", "Info": "Infos", "Price": "Prix", "24h change": "Variation 24 h", "By network": "Par réseau",
  "Wait for the pause": "Attendez la fin de la pause", "Approve": "Approuver", "Reject": "Refuser", "Sign": "Signer", "Connect": "Connecter",
  "What leaves your wallet": "Ce qui quitte votre wallet", "What you receive": "Ce que vous recevez", "Simulated": "Simulé",
  "Approve a transaction": "Approuver une transaction", "Sign a message": "Signer un message",
  // safe
  "Open your Safe": "Ouvrez votre Safe", "Open vault": "Ouvrir le Safe", "Gentle": "Souple", "Strong": "Fort", "Recommended": "Recommandé", "Lighter protection": "Protection légère",
  "Protected": "Protégé", "Every network": "Tous les réseaux", "Rules and alerts": "Règles et alertes", "Earn on your Safe": "Gagner avec votre Safe", "Coming soon": "Bientôt",
  "Coming soon · opens with mainnet": "Bientôt · arrive avec le mainnet", "Cancel": "Annuler", "Release": "Libérer",
  // safety
  "Safety": "Sécurité", "Well protected": "Bien protégé", "Getting there": "En bonne voie", "At risk": "À risque",
  "Each step makes a drainer's job harder.": "Chaque étape complique la tâche des voleurs.",
  "Recovery phrase checked": "Phrase de récupération vérifiée", "Safe set up": "Safe ouvert", "Set up your Safe": "Ouvrez votre Safe",
  "Most of your money is in the Safe": "L'essentiel de votre argent est dans le Safe", "Safe alerts on": "Alertes du Safe activées", "Turn on Telegram or email alerts": "Activez les alertes Telegram ou e-mail",
  "Auto-lock in 15 minutes or less": "Verrouillage auto en 15 minutes ou moins", "Lock the wallet sooner": "Verrouillez le wallet plus tôt",
  "No open token permissions": "Aucune autorisation ouverte", "Spending limit or cooling-off on": "Limite de dépense ou pause activée", "Add a spending limit": "Ajoutez une limite de dépense",
  "Check your 12 words are written down": "Vérifiez que vos 12 mots sont notés", "You're well protected": "Vous êtes bien protégé",
  "Freeze my Safe now": "Geler mon Safe maintenant", "Protect automatically": "Protéger automatiquement", "Daily spending limit": "Limite de dépense quotidienne",
  "Cooling-off pause": "Pause de réflexion", "Off": "Désactivé", "On": "Activé", "None": "Aucune",
  "Nothing leaves your Safe on any network for 24 hours. Use it the moment something feels wrong.": "Rien ne quitte votre Safe, sur aucun réseau, pendant 24 heures. À utiliser dès que quelque chose cloche.",
  // permissions & tokens
  "Permissions": "Autorisations", "Token permissions": "Autorisations des jetons", "Revoke": "Révoquer", "Checking every network…": "Vérification de tous les réseaux…",
  "Nobody can move your tokens without asking you first.": "Personne ne peut déplacer vos jetons sans vous demander.",
  "Collectible": "Objet de collection", "Token": "Jeton", "No market price on test networks": "Pas de prix sur les réseaux de test",
  "Buy crypto with a card": "Acheter des cryptos par carte",
  // settings
  "Auto-lock": "Verrouillage auto", "Appearance": "Apparence", "Light": "Clair", "Dark": "Sombre", "Always": "Toujours", "Numbers": "Chiffres", "Language": "Langue",
  "Connected sites": "Sites connectés", "Notify when I receive coins": "Me prévenir quand je reçois", "Hide balances under $1": "Masquer les soldes sous 1 $", "Show collectibles (NFTs)": "Afficher la collection (NFT)",
  "Order coins by": "Trier les jetons par", "Value": "Valeur", "Show recovery phrase": "Afficher la phrase de récupération", "Lock now": "Verrouiller",
  "Remove wallet from this browser": "Retirer le wallet de ce navigateur", "Safety: limits, auto-protect, freeze": "Sécurité : limites, protection auto, gel",
  "Vault rules and alerts": "Règles et alertes du Safe", "Move to Safe": "Mettre dans le Safe", "Start withdrawal": "Lancer le retrait", "Hold to protect": "Maintenir pour protéger",
  "Accounts you add come from your recovery phrase, so your backup covers them. Imported keys are not in your recovery phrase: keep their own backup.": "Les comptes ajoutés viennent de votre phrase de récupération : votre sauvegarde les couvre. Les clés importées n'y sont pas : gardez-en une sauvegarde à part.",
  "Imported private key": "Clé privée importée", "From your recovery phrase": "Depuis votre phrase de récupération", "Ethereum and its networks": "Ethereum et ses réseaux", "same address on each": "même adresse partout",
  "Your Solana address": "Votre adresse Solana", "Share address": "Partager l'adresse", "Buy with a card": "Acheter par carte", "Name this address (optional)": "Nommer cette adresse (facultatif)",
  "All assets": "Tous les actifs", "Across every network": "Sur tous les réseaux", "Show": "Afficher", "Copy": "Copier", "Copy address": "Copier l'adresse", "Addresses": "Adresses", "Ethereum-style networks": "Réseaux de type Ethereum", "SOL, USDC and Solana tokens": "SOL, USDC et jetons Solana", "TRX and USDT": "TRX et USDT", "Only send coins to the matching network. Coins sent to the right address on the wrong network may be lost.": "N'envoyez des jetons que sur le bon réseau. Des jetons envoyés à la bonne adresse sur le mauvais réseau peuvent être perdus.", "Face ID": "Face ID", "Biometric unlock": "Déverrouillage biométrique",
};
// Phrases with numbers or names: [pattern, replacement].
const FR_RE = [
  [/^Sent to (.+)$/, "Envoyé à $1"], [/^Received from (.+)$/, "Reçu de $1"], [/^Received$/, "Reçu"], [/^Moved to Safe$/, "Déplacé dans le Safe"],
  [/^Withdrawal started$/, "Retrait lancé"], [/^Released to Wallet$/, "Libéré vers le Wallet"], [/^Withdrawal cancelled$/, "Retrait annulé"], [/^Safe opened$/, "Safe ouvert"],
  [/^Protected automatically$/, "Protégé automatiquement"], [/^Safe frozen$/, "Safe gelé"], [/^Connected to (.+)$/, "Connecté à $1"],
  [/^Signed a message on (.+)$/, "Message signé sur $1"], [/^Approved a transaction on (.+)$/, "Transaction approuvée sur $1"], [/^Approved spending on (.+)$/, "Dépense autorisée sur $1"],
  [/^Removed a token permission$/, "Autorisation retirée"], [/^Gave a token permission$/, "Autorisation donnée"],
  [/^(\d+) hidden tokens? · Show$/, "$1 jeton(s) masqué(s) · Afficher"], [/^(\d+) hidden tokens? · Hide them$/, "$1 jeton(s) masqué(s) · Masquer"],
  [/^Move more into your Safe \((\d+)% now\)$/, "Mettez plus dans votre Safe ($1 % aujourd'hui)"], [/^Revoke (\d+) token permissions?$/, "Révoquez $1 autorisation(s)"],
  [/^(\d+)% of net worth$/, "$1 % de la valeur totale"], [/^(\d+)% of each payment$/, "$1 % de chaque paiement"], [/^Addresses of (.+)$/, "Adresses de $1"],
  [/^Get free test (\w+)$/, "Obtenir des $1 de test"], [/^(.+) leaving$/, "$1 en sortie"], [/^Account (\d+)$/, "Compte $1"], [/^One address for all (\d+)$/, "Une adresse pour les $1"], [/^Addresses of Account (\d+)$/, "Adresses du Compte $1"], [/^on (\w+)$/, "sur $1"], [/^(\d+) networks?$/, "$1 réseau(x)"],
];
export const LANGS = [["en", "English"], ["fr", "Français"]];
export function translate(root, lang) {
  if (lang !== "fr" || !root) return;
  const tr = (t) => { const k = t.trim(); if (!k) return null; if (FR[k]) return t.replace(k, FR[k]); for (const [re, to] of FR_RE) if (re.test(k)) return t.replace(k, k.replace(re, to)); return null; };
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.parentElement?.closest("script,style,.mono,code,pre,[data-notr]") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
  const nodes = []; while (w.nextNode()) nodes.push(w.currentNode);
  for (const n of nodes) { const v = tr(n.nodeValue); if (v != null) n.nodeValue = v; }
  root.querySelectorAll("[placeholder],[aria-label],[title]").forEach((el) => { for (const a of ["placeholder", "aria-label", "title"]) { const v = el.getAttribute(a); const t = v && tr(v); if (t != null) el.setAttribute(a, t); } });
}
