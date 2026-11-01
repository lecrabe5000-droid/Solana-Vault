// French for the app, without touching every string in dapp.js: after each render, text nodes and a few
// attributes are swapped for their French version, either word for word (EXACT) or by pattern (RULES, for text
// with numbers, coins, dates and durations). Anything not listed stays in English, so a missing line is never
// an empty one. The language is the FR / EN choice (localStorage "ecrin-lang", shared with the landing page),
// else English.

export const LANG = (() => {
  try { const s = localStorage.getItem("ecrin-lang"); if (s === "fr" || s === "en") return s; } catch (_) {}
  return "en"; // English unless you picked French (FR button, the French landing page, or the account menu)
})();
/** Locale for numbers and dates (undefined = the device's own, as before). */
export const LOCALE = LANG === "fr" ? "fr-CA" : undefined;

export function setLang(l) { try { localStorage.setItem("ecrin-lang", l); } catch (_) {} location.reload(); }

// ------------------------------------------------------------------ words

const LEVEL = { Gentle: "Douce", Strong: "Forte", Locked: "Verrouillée", Custom: "Personnalisée" };
/** "3 days", "1 day", "24 h", "72 hours", "6 months", "1 year", "1 hour", "7d 23h" → French. */
function dur(s) {
  return String(s)
    .replace(/(\d+) days?/g, (_, n) => `${n} jour${n === "1" ? "" : "s"}`)
    .replace(/(\d+) hours?/g, (_, n) => `${n} heure${n === "1" ? "" : "s"}`)
    .replace(/(\d+) months?/g, (_, n) => `${n} mois`)
    .replace(/(\d+) years?/g, (_, n) => `${n} an${n === "1" ? "" : "s"}`)
    .replace(/(\d+)d (\d+)h/g, "$1 j $2 h")
    .replace(/(\d+)d (\d)/g, "$1 j $2");
}

const EXACT = {
  // shell
  "Portfolio": "Portefeuille", "Vault": "Coffre", "Activity": "Activité", "Guardian": "Gardien",
  "Testnet beta (Solana devnet and Ethereum test networks) with test coins. Not audited: never send real funds.": "Bêta sur réseaux de test (Solana devnet et réseaux Ethereum) avec des jetons de test. Pas audité : n'envoyez jamais de vrais fonds.",
  "Program": "Programme", "Contract": "Contrat", "on Solana Devnet · Not audited: test coins only": "sur Solana Devnet · Pas audité : jetons de test seulement",
  "Network": "Réseau", "Each network has its own vault with the same rules. Test coins only.": "Chaque réseau a son propre coffre, avec les mêmes règles. Jetons de test seulement.",
  "Ethereum and its networks": "Ethereum et ses réseaux", "Devnet testnet": "Réseau de test Devnet", "Sepolia testnet": "Réseau de test Sepolia", "Amoy testnet": "Réseau de test Amoy", "Coming soon": "Bientôt",
  "to": "vers", "Range": "Période", "Coin": "Jeton", "Close": "Fermer", "Confirm": "Confirmer", "view": "voir", "Show": "Voir",
  // connect and create
  "Your crypto, out of reach of anyone in a hurry.": "Vos cryptos, hors de portée de quiconque est pressé.",
  "Connect the wallet you already use. Ecrin never holds your keys: your wallet signs, the Solana program enforces the rules.": "Connectez le portefeuille que vous utilisez déjà. Ecrin ne détient jamais vos clés : votre portefeuille signe, le programme Solana applique les règles.",
  "Connect the wallet you already use. Ecrin never holds your keys: your wallet signs, the Ethereum contract enforces the rules.": "Connectez le portefeuille que vous utilisez déjà. Ecrin ne détient jamais vos clés : votre portefeuille signe, le contrat Ethereum applique les règles.",
  "Create your vault and try a withdrawal. Watch the clock, then cancel it.": "Créez votre coffre et essayez un retrait. Regardez le compte à rebours, puis annulez-le.",
  "Get free test SOL at": "Obtenez des SOL de test gratuits sur", "Get free test ETH at": "Obtenez des ETH de test gratuits sur", "Get free test POL at": "Obtenez des POL de test gratuits sur",
  "In Phantom: Settings → Developer Settings → turn on": "Dans Phantom : Paramètres → Paramètres développeur → activez", "and pick": "et choisissez",
  "Phone browsers can't reach wallet apps directly, so Ecrin opens inside your wallet's own browser. Don't have it yet?": "Les navigateurs de téléphone ne peuvent pas joindre les apps de portefeuille, alors Ecrin s'ouvre dans le navigateur de votre portefeuille. Vous ne l'avez pas encore?",
  "Or just watch your vault": "Ou surveillez simplement votre coffre", "View": "Voir", "View mode shows your vault, countdowns and alerts. Signing opens your wallet app.": "Le mode lecture montre votre coffre, les comptes à rebours et les alertes. Pour signer, votre app de portefeuille s'ouvre.",
  "Create your vault": "Créez votre coffre", "One vault per wallet on Solana. You can make it stricter any time; loosening it always waits.": "Un coffre par portefeuille sur Solana. Vous pouvez le rendre plus strict en tout temps; l'assouplir attend toujours.",
  "Everyday savings": "Épargne courante", "Recommended": "Recommandé", "Must not move": "Ne doit pas bouger",
  "Gentle": "Douce", "Strong": "Forte", "Locked": "Verrouillée",
  "Withdrawals wait 24 h": "Les retraits attendent 24 h", "Withdrawals wait 72 h": "Les retraits attendent 72 h", "Looser rules wait 3 days": "Les assouplissements attendent 3 jours", "Looser rules wait 7 days": "Les assouplissements attendent 7 jours",
  "Guardian optional": "Gardien optionnel", "Guardian for emergencies": "Gardien pour les urgences", "Guardian required": "Gardien requis", "Nothing leaves before your date": "Rien ne sort avant votre date", "Emergency exit with your guardian": "Sortie d'urgence avec votre gardien",
  "Guardian wallet address (optional)": "Adresse du portefeuille du gardien (optionnel)", "Guardian wallet address (required)": "Adresse du portefeuille du gardien (requis)", "Locked until": "Verrouillé jusqu'au",
  "Create vault": "Créer le coffre", "Confirm in your wallet…": "Confirmez dans votre portefeuille…",
  "Creating the vault costs a small amount of devnet SOL for the account's rent.": "Créer le coffre coûte un peu de SOL devnet pour le loyer du compte.",
  // portfolio
  "Total balance": "Solde total", "Protected": "Protégé", "Wallet": "Portefeuille", "Spendable · instant": "Disponible · instantané", "Portfolio value": "Valeur du portefeuille",
  "Prices unavailable right now.": "Prix indisponibles pour le moment.", "Loading the chart…": "Chargement du graphique…", "Assets": "Actifs", "same rules for every coin": "mêmes règles pour chaque jeton",
  "Recent": "Récent", "See all": "Tout voir", "Nothing yet. Deposits, withdrawals and rule changes show up here.": "Rien encore. Les dépôts, retraits et changements de règles apparaissent ici.",
  "Sealed · nothing waiting to leave": "Scellé · rien en attente de sortie", "leaving": "sortent", "leaving in": "sortent dans", "protected": "protégé",
  "1D": "1J", "1W": "1S", "1M": "1M", "1Y": "1A",
  "Add Ecrin to your home screen": "Ajoutez Ecrin à votre écran d'accueil", "Your vault, one tap away. Opens like an app.": "Votre coffre, à un toucher. S'ouvre comme une app.", "Install": "Installer",
  "View mode": "Mode lecture", "· signing opens your wallet app": "· signer ouvre votre app de portefeuille", "Exit": "Quitter",
  // actions
  "Deposit": "Déposer", "Withdraw": "Retirer", "Send": "Envoyer", "Rules": "Règles", "Freeze": "Geler",
  "Deposit SOL": "Déposer des SOL", "Deposit USDC": "Déposer des USDC", "Deposit ETH": "Déposer des ETH", "Deposit POL": "Déposer des POL",
  "Withdraw SOL": "Retirer des SOL", "Withdraw USDC": "Retirer des USDC", "Withdraw ETH": "Retirer des ETH", "Withdraw POL": "Retirer des POL",
  "Send to a trusted address": "Envoyer à une adresse de confiance", "Send SOL to a trusted address": "Envoyer des SOL à une adresse de confiance", "Send USDC to a trusted address": "Envoyer des USDC à une adresse de confiance",
  "To address": "Vers l'adresse", "To": "Vers", "Address": "Adresse",
  // vault
  "Available": "Disponible", "Leaving": "En sortie", "No guardian": "Aucun gardien", "View on-chain": "Voir sur la blockchain",
  "Waiting to leave": "En attente de sortie", "cancel any time": "annulez en tout temps", "Rule changes waiting": "Changements de règles en attente",
  "Nothing waiting to leave. Every withdrawal shows up here with a countdown, and you can cancel it until it runs.": "Rien en attente de sortie. Chaque retrait apparaît ici avec un compte à rebours, et vous pouvez l'annuler jusqu'à son exécution.",
  "Free, instant, and nobody else is told.": "Gratuit, instantané, et personne d'autre n'est averti.", "Not you? Freeze everything": "Pas vous? Gelez tout", "Send it now": "L'envoyer maintenant",
  "Ready. It only leaves if you press send.": "Prêt. Il ne sort que si vous appuyez sur Envoyer.", "until it can leave": "avant de pouvoir sortir",
  "Cancel change": "Annuler le changement", "Apply": "Appliquer", "Guardians can't speed this up.": "Les gardiens ne peuvent pas accélérer ceci.", "Approve now": "Approuver maintenant", "Approve emergency release": "Approuver la sortie d'urgence",
  "Trusted addresses": "Adresses de confiance", "Add": "Ajouter",
  "None yet. Money sent to a trusted address arrives instantly, so adding one takes time. Trusted addresses apply to every coin.": "Aucune pour l'instant. L'argent envoyé à une adresse de confiance arrive instantanément, alors en ajouter une prend du temps. Les adresses de confiance valent pour chaque jeton.",
  "Trust an address": "Faire confiance à une adresse",
  // policy
  "Protection policy": "Politique de protection", "Adjust": "Ajuster", "Adjust your protection": "Ajustez votre protection",
  "Withdrawal delay": "Délai de retrait", "Rule-change delay": "Délai de changement de règle", "Daily limit": "Limite quotidienne", "Time lock": "Verrou temporel",
  "Daily limit · SOL": "Limite quotidienne · SOL", "Daily limit · USDC": "Limite quotidienne · USDC", "Daily limit · ETH": "Limite quotidienne · ETH", "Daily limit · POL": "Limite quotidienne · POL",
  "Every withdrawal to an address that isn't trusted waits this long.": "Chaque retrait vers une adresse qui n'est pas de confiance attend ce délai.",
  "Every withdrawal to an address that isn't trusted waits this long. You can cancel it at any moment.": "Chaque retrait vers une adresse qui n'est pas de confiance attend ce délai. Vous pouvez l'annuler à tout moment.",
  "Loosening any rule, adding a trusted address or changing the guardian waits this long.": "Assouplir une règle, ajouter une adresse de confiance ou changer de gardien attend ce délai.",
  "Loosening any rule, adding a trusted address or changing the guardian waits this long. Tightening is instant.": "Assouplir une règle, ajouter une adresse de confiance ou changer de gardien attend ce délai. Resserrer est immédiat.",
  "The most that can leave in one day, sends to trusted addresses included.": "Le maximum qui peut sortir en une journée, envois de confiance compris.",
  "The most that can leave in one day, sends to trusted addresses included. Each coin has its own.": "Le maximum qui peut sortir en une journée, envois de confiance compris. Chaque jeton a la sienne.",
  "Nothing leaves before this date, except an emergency your guardian co-signs.": "Rien ne sort avant cette date, sauf une urgence que votre gardien cosigne.",
  "Nothing leaves before this date, except an emergency your guardian co-signs. Ending a lock early can't happen before it ends anyway.": "Rien ne sort avant cette date, sauf une urgence que votre gardien cosigne. Un verrou ne peut pas prendre fin avant sa date.",
  "Someone you trust who can approve an emergency release or a new trusted address early.": "Une personne de confiance qui peut approuver une sortie d'urgence ou une nouvelle adresse de confiance plus tôt.",
  "Someone you trust who can approve an emergency release or a new trusted address early. A guardian can never start a withdrawal or choose where money goes.": "Une personne de confiance qui peut approuver une sortie d'urgence ou une nouvelle adresse de confiance plus tôt. Un gardien ne peut jamais lancer un retrait ni choisir où va l'argent.",
  "No limit": "Aucune limite", "None": "Aucun", "Current": "Actuel", "Applies now": "Immédiat", "Choose an option": "Choisissez une option", "Apply now": "Appliquer maintenant",
  "End the lock": "Mettre fin au verrou", "New guardian address": "Nouvelle adresse du gardien", "Remove the current guardian": "Retirer le gardien actuel", "Now:": "Actuel :",
  "1 hour": "1 heure", "24 hours": "24 heures", "72 hours": "72 heures", "7 days": "7 jours", "30 days": "30 jours", "3 days": "3 jours", "14 days": "14 jours", "90 days": "90 jours", "6 months": "6 mois", "1 year": "1 an",
  "Any guardian change waits 7 days: a guardian can release money early, so nobody holding your key can name one on the spot.": "Tout changement de gardien attend 7 jours : un gardien peut libérer de l'argent plus tôt, alors personne qui détient votre clé ne peut en nommer un sur-le-champ.",
  "Any guardian change waits 3 days: a guardian can release money early, so nobody holding your key can name one on the spot.": "Tout changement de gardien attend 3 jours : un gardien peut libérer de l'argent plus tôt, alors personne qui détient votre clé ne peut en nommer un sur-le-champ.",
  // freeze
  "Freeze your vault": "Gelez votre coffre", "Freeze now": "Geler maintenant", "Applies the moment you confirm": "S'applique dès que vous confirmez", "Already locked longer": "Déjà verrouillé plus longtemps",
  "For when something feels wrong: a withdrawal you didn't make, a signature you regret, a stolen phone. Until the date you pick,": "Pour quand quelque chose cloche : un retrait que vous n'avez pas fait, une signature regrettée, un téléphone volé. Jusqu'à la date choisie,",
  "nothing leaves": "rien ne sort", ", and sends to trusted addresses stop too.": ", et les envois aux adresses de confiance s'arrêtent aussi.",
  "You can still cancel anything, and your guardian can still release a real emergency. A freeze can't be ended early, so pick the shortest time that gives you room to think.": "Vous pouvez toujours tout annuler, et votre gardien peut toujours libérer une vraie urgence. Un gel ne peut pas être levé plus tôt : choisissez le temps le plus court qui vous laisse réfléchir.",
  "Stop everything from leaving, now": "Empêcher toute sortie, maintenant",
  "Nothing can leave before then, withdrawals already waiting included. You can still cancel anything.": "Rien ne peut sortir d'ici là, retraits en attente compris. Vous pouvez toujours tout annuler.",
  // alerts card
  "Alerts": "Alertes", "On": "Activées", "Email me": "M'écrire", "Sending…": "Envoi…", "Or by email": "Ou par courriel", "Get alerts on Telegram": "Recevoir les alertes sur Telegram",
  "Waiting for Telegram… press Start there": "En attente de Telegram… appuyez sur Démarrer là-bas", "Add another chat": "Ajouter une autre conversation",
  "A delay only protects you if you notice. Get a Telegram message or an email within a minute of anything happening to this vault.": "Un délai ne vous protège que si vous le remarquez. Recevez un message Telegram ou un courriel en moins d'une minute dès qu'il se passe quelque chose dans ce coffre.",
  "Telegram messages you within a minute of any withdrawal, deposit or rule change on this vault. Send": "Telegram vous écrit en moins d'une minute à chaque retrait, dépôt ou changement de règle sur ce coffre. Envoyez",
  "to the bot to turn them off.": "au bot pour les désactiver.", "We sent a confirmation link to": "Nous avons envoyé un lien de confirmation à", ". Alerts start once you click it.": ". Les alertes commencent dès que vous cliquez.",
  // activity and guardian
  "from this browser": "depuis ce navigateur", "Your transactions from this browser show up here.": "Vos transactions faites depuis ce navigateur apparaissent ici.",
  "Look up a vault you guard": "Trouver un coffre que vous gardez", "Look up": "Chercher",
  "Guardians can approve an emergency release of a withdrawal the owner requested, or a trusted address the owner proposed. Nothing else.": "Les gardiens peuvent approuver la sortie d'urgence d'un retrait demandé par le propriétaire, ou une adresse de confiance qu'il a proposée. Rien d'autre.",
  "You're the guardian": "Vous êtes le gardien", "You're not this vault's guardian": "Vous n'êtes pas le gardien de ce coffre", "Nothing waiting to leave.": "Rien en attente de sortie.",
  // sign elsewhere, install
  "You're in view mode": "Vous êtes en mode lecture", "Connect with WalletConnect": "Se connecter avec WalletConnect", "Install Ecrin": "Installer Ecrin", "Takes ten seconds": "Ça prend dix secondes", "Copy link": "Copier le lien",
  // toasts
  "Add a trusted address first": "Ajoutez d'abord une adresse de confiance", "That address isn't valid": "Cette adresse n'est pas valide", "That guardian address isn't valid": "L'adresse du gardien n'est pas valide",
  "Your guardian must be someone else's wallet": "Votre gardien doit être le portefeuille de quelqu'un d'autre", "Locked needs a guardian for emergencies": "Verrouillée exige un gardien pour les urgences",
  "Pick a lock date in the future": "Choisissez une date de verrou future", "Pick an option": "Choisissez une option", "Pick how long": "Choisissez la durée", "Pick someone else's valid address": "Choisissez une adresse valide de quelqu'un d'autre",
  "Enter an address, or choose to remove the guardian": "Entrez une adresse, ou choisissez de retirer le gardien", "Link copied": "Lien copié", "Copy failed: press and hold the link": "La copie a échoué : maintenez le doigt sur le lien",
  "Alerts are on. Telegram will message you.": "Les alertes sont activées. Telegram vous écrira.", "Check your inbox to confirm.": "Vérifiez vos courriels pour confirmer.", "Email alerts are already on for this address.": "Les alertes par courriel sont déjà activées pour cette adresse.",
  "Connected with WalletConnect": "Connecté avec WalletConnect", "That withdrawal isn't waiting anymore: it was already cancelled or sent.": "Ce retrait n'est plus en attente : il a déjà été annulé ou envoyé.", "That rule change isn't waiting anymore.": "Ce changement de règle n'est plus en attente.",
  "Disconnect your wallet?": "Déconnecter votre portefeuille?", "Kept safe": "En sécurité", "It never left your vault.": "Rien n'est sorti de votre coffre.",
  "From your alert": "Depuis votre alerte", "Cancel and keep it safe": "Annuler et le garder en sécurité", "Cancel the change": "Annuler le changement",
  "Name it": "Nommer", "Rename": "Renommer", "Name (only on this device)": "Nom (sur cet appareil seulement)", "Bank off-ramp": "Sortie vers la banque",
  "Name for this address (only on this device):": "Nom pour cette adresse (sur cet appareil seulement) :",
  "Careful:": "Attention :", "this looks like": "cette adresse ressemble à",
  "but it is a different address. Scammers send tiny amounts from lookalike addresses so you copy the wrong one. Check every character.": "mais c'est une autre adresse. Les fraudeurs envoient de petits montants depuis des adresses semblables pour que vous copiiez la mauvaise. Vérifiez chaque caractère.",
  "On this device": "Sur cet appareil", "On this phone": "Sur ce téléphone", "Notify this device": "Notifier cet appareil", "Turning on…": "Activation…", "Turn off": "Désactiver",
  "Notifications are on for this device.": "Les notifications sont activées sur cet appareil.",
  "To get notifications on iPhone, add Ecrin to your home screen first, then open it from there.": "Pour recevoir des notifications sur iPhone, ajoutez d'abord Ecrin à votre écran d'accueil, puis ouvrez-le de là.",
  "Notifications are blocked for this site. Allow them in your browser settings, then try again.": "Les notifications sont bloquées pour ce site. Autorisez-les dans les réglages du navigateur, puis réessayez.",
  "Notifications aren't available right now.": "Les notifications ne sont pas disponibles pour le moment.",
  "Your protection": "Votre protection", "Fully set up. Nicely done.": "Configuré au complet. Bravo.", "Good. A few taps make it stronger.": "Bien. Quelques touches de plus la renforcent.", "Just getting started.": "C'est un début.",
  "Withdrawals wait at least 3 days": "Les retraits attendent au moins 3 jours", "Make withdrawals wait longer": "Faire attendre les retraits plus longtemps",
  "A guardian for emergencies": "Un gardien pour les urgences", "Add a guardian": "Ajouter un gardien", "Alerts are on": "Les alertes sont activées", "Turn on alerts": "Activer les alertes",
  "A trusted address for instant payments": "Une adresse de confiance pour les paiements instantanés", "Add a trusted address": "Ajouter une adresse de confiance", "A daily limit": "Une limite quotidienne", "Set a daily limit": "Fixer une limite quotidienne",
  "in your vault": "dans votre coffre", "in your wallet": "dans votre portefeuille", "Unnamed": "Sans nom", "No guardian · add one": "Aucun gardien · en ajouter un",
  "Sealed": "Scellé", "A delay only protects you if you notice.": "Un délai ne vous protège que si vous le remarquez.", "Email": "Courriel", "This device": "Cet appareil", "Off": "Désactivé", "Turn on": "Activer", "Change": "Changer", "Add chat": "Ajouter", "Waiting…": "En attente…",
  "Messages within a minute": "Messages en moins d'une minute", "Press Start in Telegram…": "Appuyez sur Démarrer dans Telegram…", "Notifications on": "Notifications activées", "Add Ecrin to your home screen first": "Ajoutez d'abord Ecrin à l'écran d'accueil", "How": "Comment",
  "Email alerts": "Alertes par courriel", "Double opt-in: we send a link first": "Double confirmation : on envoie d'abord un lien", "Every alert email has an unsubscribe link. Nothing else is ever sent.": "Chaque courriel d'alerte a un lien de désabonnement. Rien d'autre n'est envoyé.",
  "Copy": "Copier", "Hide balances": "Masquer les soldes", "Language": "Langue", "Appearance": "Apparence", "Dark": "Sombre", "Light": "Clair", "View wallet on the explorer": "Voir le portefeuille dans l'explorateur", "Add to home screen": "Ajouter à l'écran d'accueil", "Disconnect": "Déconnecter", "Exit view mode": "Quitter le mode lecture",
  // errors (chain.js / evm.js)
  "Only the vault owner can do that.": "Seul le propriétaire du coffre peut faire ça.", "Only the guardian can do that.": "Seul le gardien peut faire ça.", "This vault has no guardian.": "Ce coffre n'a pas de gardien.",
  "Enter an amount above zero.": "Entrez un montant supérieur à zéro.", "Not enough funds that aren't already queued.": "Pas assez de fonds qui ne sont pas déjà en attente.", "That address isn't trusted yet.": "Cette adresse n'est pas encore de confiance.",
  "The vault is locked until its date.": "Le coffre est verrouillé jusqu'à sa date.", "Not yet: the waiting time hasn't passed.": "Pas encore : le délai n'est pas écoulé.", "That's over today's limit.": "Ça dépasse la limite d'aujourd'hui.",
  "That item is gone.": "Cet élément n'existe plus.", "Too many things are already waiting.": "Trop de choses sont déjà en attente.", "You can trust up to 8 addresses.": "Vous pouvez faire confiance à 8 adresses au maximum.",
  "That value isn't allowed.": "Cette valeur n'est pas permise.", "That amount is too large.": "Ce montant est trop grand.", "That isn't where this withdrawal goes.": "Ce n'est pas la destination de ce retrait.",
  "You cancelled it in your wallet.": "Vous l'avez annulé dans votre portefeuille.", "Your wallet doesn't have enough SOL for this (and the fee).": "Votre portefeuille n'a pas assez de SOL pour ça (et les frais).",
  "Your wallet doesn't have enough test coins for this (and the gas).": "Votre portefeuille n'a pas assez de jetons de test pour ça (et les frais).", "This wallet already has a vault.": "Ce portefeuille a déjà un coffre.",
  "The destination refused the transfer.": "La destination a refusé le transfert.", "That call was refused.": "Cet appel a été refusé.",
  // wallet ⇄ vault hero, card studio
  "Spendable now": "Disponible maintenant", "Instant": "Instantané", "One signature moves it": "Une signature suffit à le déplacer", "Protect": "Protéger",
  "protected in your vault": "protégé dans votre coffre", "protect more": "en protéger davantage", "Customize card": "Personnaliser la carte", "Customize your card": "Personnaliser votre carte",
  "Your card": "Votre carte", "Surprise me": "Surprenez-moi", "Reset": "Réinitialiser", "Look": "Allure", "Pattern": "Motif", "Details": "Détails", "Effects": "Effets", "Save card": "Enregistrer la carte", "Card saved": "Carte enregistrée",
  "Material": "Matière", "Accent": "Accent", "Engraving": "Gravure", "Depth": "Profondeur", "Name on the card": "Nom sur la carte", "Emblem": "Emblème", "Numbers": "Chiffres", "Corners": "Coins",
  "Obsidian": "Obsidienne", "Midnight": "Minuit", "Carbon": "Carbone", "Titanium": "Titane", "Champagne": "Champagne", "Rose gold": "Or rose", "Ceramic": "Céramique", "Paper": "Papier", "Emerald": "Émeraude", "Bordeaux": "Bordeaux", "Deep sea": "Grands fonds", "Lava": "Lave", "Sunset": "Coucher de soleil", "Glass": "Verre", "Aurora": "Aurore", "Holographic": "Holographique",
  "Guilloché": "Guilloché", "Waves": "Vagues", "Contours": "Courbes", "Sunburst": "Soleil", "Grid": "Grille", "Monogram": "Monogramme", "Dots": "Points", "Plain": "Uni", "Network": "Réseau", "None": "Aucun",
  "Display": "Affiche", "Sans": "Sans", "Serif": "Serif", "Mono": "Mono", "Sharp": "Vifs", "Soft": "Doux", "Round": "Ronds",
  "Holographic foil": "Feuille holographique", "a rainbow sheen that moves": "un reflet arc-en-ciel qui bouge", "Shine sweep": "Éclat", "a slow glint across the card": "un reflet lent qui traverse la carte",
  "Pointer light": "Lumière du pointeur", "the card catches your cursor": "la carte capte votre curseur", "3D tilt": "Inclinaison 3D", "leans toward the pointer": "penche vers le pointeur",
  "Grain": "Grain", "a fine, printed texture": "une fine texture imprimée", "Accent edge": "Bordure d'accent", "a thin line in your accent": "un mince trait de votre couleur",
  "Hide the balance": "Masquer le solde", "on the card only": "sur la carte seulement", "Saved on this device, for this wallet. Only you see it.": "Enregistré sur cet appareil, pour ce portefeuille. Vous seul le voyez.",
  "English": "English", "Français": "Français",
  "That's your vault's own address. Pick the wallet the money should go to.": "C'est l'adresse de votre propre coffre. Choisissez le portefeuille où l'argent doit aller.",
  "Covers this address on every network.": "Couvre cette adresse sur tous les réseaux.", "Covers this wallet.": "Couvre ce portefeuille.",
  "Covers this address on every network and your other wallet on this device.": "Couvre cette adresse sur tous les réseaux et votre autre portefeuille sur cet appareil.",
  "Covers this wallet and your other wallet on this device.": "Couvre ce portefeuille et votre autre portefeuille sur cet appareil.",
};

const RULES = [
  [/^Amount \((\w+)\)$/, "Montant ($1)"],
  [/^Available: (.+?) (\w+)\. This waits (.+?)( and until the lock ends)?\. You can cancel any time\.$/, (m) => `Disponible : ${m[1]} ${m[2]}. Ce retrait attend ${dur(m[3])}${m[4] ? " et la fin du verrou" : ""}. Vous pouvez l'annuler en tout temps.`],
  [/^Wallet: (.+?) (\w+)\. Deposits go straight in\.(.*)$/, (m) => `Portefeuille : ${m[1]} ${m[2]}. Les dépôts entrent directement.${m[3].replace(" Your wallet asks you to allow the amount first, then to deposit it.", " Votre portefeuille demande d'abord d'autoriser le montant, puis de le déposer.")}`],
  [/^Arrives instantly(, up to (.+) a day)?\.$/, (m) => `Arrive instantanément${m[1] ? `, jusqu'à ${m[2]} par jour` : ""}.`],
  [/^(Gentle|Strong|Locked|Custom) · (.+)$/, (m) => `${LEVEL[m[1]]} · ${dur(m[2]).replace("tightening is instant, loosening waits", "resserrer est immédiat, assouplir attend")}`],
  [/^Withdrawals wait (.+)$/, (m) => `Les retraits attendent ${dur(m[1])}`],
  [/^Looser rules wait (.+)$/, (m) => `Les assouplissements attendent ${dur(m[1])}`],
  [/^looser rules wait (.+)$/, (m) => `les assouplissements attendent ${dur(m[1])}`],
  [/^Waits (.+)$/, (m) => `Attend ${dur(m[1])}`],
  [/^Request change · waits (.+)$/, (m) => `Demander le changement · attend ${dur(m[1])}`],
  [/^Pick a rule\. Tightening applies at once; loosening waits (.+)\.$/, (m) => `Choisissez une règle. Resserrer s'applique tout de suite; assouplir attend ${dur(m[1])}.`],
  [/^Money sent here will arrive instantly, so trusting it waits (.+?)(, unless your guardian approves it sooner)?\.$/, (m) => `L'argent envoyé ici arrivera instantanément, alors lui faire confiance attend ${dur(m[1])}${m[2] ? ", sauf si votre gardien l'approuve plus tôt" : ""}.`],
  [/^(\d+) leaving$/, "$1 en sortie"],
  [/^Until (.+)$/, "Jusqu'au $1"],
  [/^Unlocks (.+)$/, "Se déverrouille le $1"], [/^Unlocked (.+)$/, "Déverrouillé le $1"],
  [/^Frozen until (.+)\.$/, "Gelé jusqu'au $1."],
  [/^Locked until (.+)$/, "Verrouillé jusqu'au $1"],
  [/^Cancel and keep (.+) safe$/, "Annuler et garder $1 en sécurité"],
  [/^Guardian (\S+…\S+)$/, "Gardien $1"], [/^Trust (.+…\S+)$/, "Faire confiance à $1"], [/^Stop trusting (.+…\S+)$/, "Ne plus faire confiance à $1"],
  [/^Vault of (.+)$/, "Coffre de $1"],
  [/^(.+) is waiting to leave\.$/, "$1 attend de sortir."], [/^(\d+) withdrawals in other coins are waiting to leave\.$/, "$1 retraits dans d'autres jetons attendent de sortir."],
  [/^(.+) protected · (.+) in wallet$/, "$1 protégé · $2 dans le portefeuille"], [/^Sent to (.+)$/, "Envoyé à $1"], [/^(\d+)% in your wallet$/, "$1 % dans votre portefeuille"], [/^(\d+)% in your wallet ·$/, "$1 % dans votre portefeuille ·"], [/^waits (.+)$/, (m) => `attend ${dur(m[1])}`],
  [/^Nothing (\w+ )?is waiting to leave\. Every withdrawal shows up here with a countdown, and you can cancel it until it runs\.$/, "Rien n'attend de sortir. Chaque retrait apparaît ici avec un compte à rebours, et vous pouvez l'annuler jusqu'à son exécution."],
  [/^, including the (\d+) withdrawals? already waiting, and sends to trusted addresses stop too\.$/, (m) => `, y compris ${m[1] === "1" ? "le retrait déjà en attente" : `les ${m[1]} retraits déjà en attente`}, et les envois aux adresses de confiance s'arrêtent aussi.`],
  [/^Your wallet has (.+) on (\w+)\. Get free test (\w+) at$/, "Votre portefeuille a $1 sur $2. Obtenez des $3 de test gratuits sur"],
  [/^Daily limit (.+)$/, "Limite quotidienne $1"], [/^Remove the (\w+) daily limit$/, "Retirer la limite quotidienne $1"], ["Remove the daily limit", "Retirer la limite quotidienne"],
  [/^Lock until (.+)$/, "Verrouiller jusqu'au $1"], ["End the lock", "Mettre fin au verrou"], ["Remove the guardian", "Retirer le gardien"],
  [/^Changed a rule: (.+?)( ·)?$/, (m) => `Règle modifiée : ${tr(m[1])}${m[2] || ""}`],
  [/^Deposited (.+?)( ·)?$/, "Dépôt de $1$2"], [/^Asked to withdraw (.+?)( ·)?$/, "Retrait demandé : $1$2"],
  [/^Sent (.+) to a trusted address( ·)?$/, "Envoi de $1 à une adresse de confiance$2"], [/^Asked to trust an address( ·)?$/, "Demande de confiance envoyée$1"],
  [/^Created a (\w+) vault( ·)?$/, (m) => `Coffre ${(LEVEL[m[1][0].toUpperCase() + m[1].slice(1)] || m[1]).toLowerCase()} créé${m[2] || ""}`],
  [/^Cancelled\. (.+) stays in your vault\. That's a win\.( ·)?$/, "Annulé. $1 reste dans votre coffre. Bravo.$2"],
  [/^Sent a withdrawal( ·)?$/, "Retrait envoyé$1"], [/^Cancelled a rule change( ·)?$/, "Changement de règle annulé$1"], [/^Applied a rule change( ·)?$/, "Changement de règle appliqué$1"],
  [/^Approved an emergency release( ·)?$/, "Sortie d'urgence approuvée$1"], [/^Approved a trusted address( ·)?$/, "Adresse de confiance approuvée$1"],
  [/^Froze the vault until (.+?)( ·)?$/, "Coffre gelé jusqu'au $1$2"],
  [/^Connect (Phantom|Solflare|Backpack|MetaMask|Wallet|.+)$/, "Connecter $1"], [/^Open in (.+)$/, "Ouvrir dans $1"], [/^Get (Phantom|MetaMask)$/, "Obtenir $1"],
  [/^Your (\w+) wallet address$/, "Votre adresse de portefeuille $1"], [/^The vault owner's (\w+) address$/, "L'adresse $1 du propriétaire du coffre"], [/^A friend's (\w+) address$/, "L'adresse $1 d'un proche"],
  [/^No Ecrin vault for that wallet on (\w+)\.$/, "Aucun coffre Ecrin pour ce portefeuille sur $1."],
  [/^Reading your vault from (.+)…$/, "Lecture de votre coffre sur $1…"], [/^Couldn't reach (.+)\. Retrying…$/, "Impossible de joindre $1. Nouvel essai…"],
  [/^Ecrin isn't on (.+) yet$/, "Ecrin n'est pas encore sur $1"],
  [/^This wallet has no vault on (\w+)\. Connect the wallet that owns it\.$/, "Ce portefeuille n'a pas de coffre sur $1. Connectez le portefeuille qui le possède."],
  [/^That alert is about vault (.+)\. Connect that wallet to cancel it\.$/, "Cette alerte concerne le coffre $1. Connectez ce portefeuille pour l'annuler."],
  [/^Cancel this (withdrawal|rule change)\?$/, (m) => (m[1] === "withdrawal" ? "Annuler ce retrait?" : "Annuler ce changement de règle?")],
  [/^(.+)\. Cancelling is free and instant, and the money stays in your vault\.$/, "$1. Annuler est gratuit et instantané, et l'argent reste dans votre coffre."],
  [/^(\d+)d (\d\d:\d\d)$/, "$1 j $2"], [/^(\d+)d (\d+)h$/, "$1 j $2 h"], [/^(\d+)h (\d+)m$/, "$1 h $2 min"], [/^(\d+)m$/, "$1 min"],
  [/^Time left before this can leave: (.+)$/, "Temps restant avant la sortie : $1"],
  [/^Network: (.+)\. Change network$/, "Réseau : $1. Changer de réseau"], [/^(Show|Hide) balances$/, (m) => (m[1] === "Show" ? "Afficher les soldes" : "Masquer les soldes")],
  [/^Switch to (dark|light) mode$/, (m) => (m[1] === "dark" ? "Passer au mode sombre" : "Passer au mode clair")],
  [/^(.+) · click to disconnect$/, "$1 · cliquer pour déconnecter"], [/^View on the explorer$/, "Voir dans l'explorateur"], [/^Where it should go$/, "Où ça doit aller"],
  [/^Your bank off-ramp, your rent…$/, "Votre sortie vers la banque, votre loyer…"], [/^Something is waiting to leave$/, "Quelque chose attend de sortir"],
  [/^([\d\s.,]+) in wallet$/, "$1 dans le portefeuille"], [/^([\d\s.,]+) in vault$/, "$1 dans le coffre"],
  [/^That's over your daily limit of (.+?) (\w+)\. Split it into withdrawals of (.+?) or less\.$/, "C'est plus que votre limite quotidienne de $1 $2. Divisez-le en retraits de $3 ou moins."],
];

/** Translates one string (trimmed); returns it unchanged when there is no French for it. */
export function tr(s) {
  if (LANG !== "fr" || !s) return s;
  if (EXACT[s]) return EXACT[s];
  for (const [re, to] of RULES) {
    if (typeof re === "string") { if (s === re) return to; continue; }
    const m = s.match(re);
    if (!m) continue;
    if (to === null) return s;
    return typeof to === "function" ? to(m) : s.replace(re, to);
  }
  return s;
}

function swapText(node) {
  const v = node.nodeValue, t = v.trim();
  if (!t || !/[A-Za-z]/.test(t)) return;
  const f = tr(t.replace(/\s+/g, " "));
  if (f !== t) node.nodeValue = v.replace(t, f);
}
function swapTree(root) {
  if (root.nodeType === 3) return swapText(root);
  if (root.nodeType !== 1 || root.closest?.("script,style,code")) return;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n; while ((n = w.nextNode())) if (!n.parentElement?.closest("script,style,code")) swapText(n);
  for (const el of [root, ...root.querySelectorAll("[placeholder],[title],[aria-label]")])
    for (const a of ["placeholder", "title", "aria-label"]) { const v = el.getAttribute?.(a); if (v) { const f = tr(v); if (f !== v) el.setAttribute(a, f); } }
}

/** Keeps the page in French: translates it now and every change after. */
export function startTranslating() {
  if (LANG !== "fr") return;
  document.documentElement.lang = "fr";
  swapTree(document.body);
  new MutationObserver((ms) => {
    for (const m of ms) {
      if (m.type === "characterData") swapText(m.target);
      else m.addedNodes.forEach(swapTree);
    }
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
}
