# Regenerates app/fr/index.html from app/index.html with the French strings below. Run after editing the English page:
#   python3 scripts/translate-landing-fr.py
# It prints any English string it couldn't find; add or fix those pairs. A few strings are patched after the run (see the end).
import re, html, os
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
FR = {
"Ecrin · Crypto that can't be taken in a hurry": "Ecrin · Des cryptos qu'on ne peut pas vous prendre en vitesse",
"An on-chain vault for Solana and Ethereum. Every way out takes time, and you can cancel any time.": "Un coffre on-chain pour Solana et Ethereum. Chaque sortie prend du temps, et vous pouvez annuler en tout temps.",
"An on-chain vault for Solana and Ethereum. Every way out waits, and you can cancel any time.": "Un coffre on-chain pour Solana et Ethereum. Chaque sortie attend, et vous pouvez annuler en tout temps.",
"Sections": "Sections", "Threats": "Menaces", "How it works": "Fonctionnement", "Coins": "Jetons", "Security": "Sécurité", "Roadmap": "Feuille de route", "FAQ": "FAQ",
"Switch theme": "Changer de thème", "Open app": "Ouvrir l'app", "Menu": "Menu", "Coins and networks": "Jetons et réseaux", "A bad day, with Ecrin": "Une mauvaise journée, avec Ecrin",
"Open the app": "Ouvrir l'app", "Try the demo, no wallet": "Essayer la démo, sans portefeuille", "Dark mode": "Mode sombre", "Light mode": "Mode clair", "· testnet beta": "· bêta sur testnet",
"The vault with a delay · Solana and Ethereum": "Le coffre avec un délai · Solana et Ethereum",
"Your savings, out of reach of anyone in a hurry.": "Vos économies, hors de portée de quiconque est pressé.",
"Nothing leaves without a delay you choose. A drainer, a phishing signature, a stolen key or a bad night all hit the same wall: time. You see it coming, and you cancel.": "Rien ne sort sans un délai que vous choisissez. Un drainer, une signature d'hameçonnage, une clé volée ou une mauvaise soirée frappent le même mur : le temps. Vous le voyez venir, et vous annulez.",
"Try the demo": "Essayer la démo", "Someone just asked to withdraw": "Quelqu'un vient de demander un retrait", "Try it": "Essayez", "to": "vers",
"a drainer you signed by mistake": "un drainer signé par erreur", "can leave in": "peut sortir dans", "Cancel and keep it": "Annuler et le garder",
"Kept safe. 24 SOL never left.": "En sécurité. Les 24 SOL ne sont jamais sortis.", "The thief got a queued request and nothing else.": "Le voleur a obtenu une demande en attente, rien d'autre.",
"0 attacks stopped": "0 attaque bloquée", "Real vaults work exactly like this.": "Les vrais coffres fonctionnent exactement comme ça.",
"Testnet beta · not audited · test coins only": "Bêta sur testnet · pas encore audité · jetons de test seulement",
"Not just thieves.": "Pas seulement les voleurs.", "Also": "Aussi", "urges.": "les pulsions.", "Urges": "Pulsions",
"Gambling urges, revenge trades, panic sells, FOMO. They all want the money now, and they fade in hours. Ecrin makes your money wait days, so the urge is gone before the money can leave.": "Envies de jouer, trades de revanche, ventes de panique, peur de rater. Elles veulent toutes l'argent tout de suite, et elles passent en quelques heures. Ecrin fait attendre votre argent des jours : l'envie est partie avant que l'argent puisse sortir.",
"The urge to gamble passes. The delay doesn't.": "L'envie de jouer passe. Le délai, non.", "Just one more bet. I'll win it back.": "Encore une mise. Je vais me refaire.", "Cancelled the next morning.": "Annulé le lendemain matin.",
"Revenge trading needs money now. It gets it in 3 days.": "Le trade de revanche veut l'argent maintenant. Il l'aura dans 3 jours.", "Long enough for the anger to pass.": "Assez longtemps pour que la colère passe.",
"Chasing a pump? It's over before your money can move.": "Vous courez après une hausse? Elle est finie avant que votre argent puisse bouger.", "leaves in 71:59:12": "part dans 71:59:12", "Changed my mind": "J'ai changé d'idée",
"Locked mode: nothing leaves before your date. Not even for you.": "Mode verrouillé : rien ne sort avant votre date. Même pas pour vous.", "Withdraw now": "Retirer maintenant", "locked until March 1": "verrouillé jusqu'au 1er mars", "Shorten the lock": "Raccourcir le verrou", "not possible": "impossible", "Lock it longer": "Verrouiller plus longtemps",
"Decide when you're calm. Ecrin holds you to it.": "Décidez à tête reposée. Ecrin vous y tient.", "Set your delay or a lock date on a good day. Ecrin is a tool, not treatment: if gambling is hurting you, talk to someone you trust or a local helpline.": "Choisissez votre délai ou une date de verrou un bon jour. Ecrin est un outil, pas un traitement : si le jeu vous fait du tort, parlez-en à une personne de confiance ou à une ligne d'aide de votre région.", "Set it up": "Le configurer",
"Gambling urges": "Envies de jouer", "Revenge trades": "Trades de revanche", "Panic sells": "Ventes de panique",
"Protection from": "Protégé contre", "every": "chaque", "threat": "menace", "See it happen": "Voir en action", "Previous": "Précédent", "Next": "Suivant",
"A drainer gets your signature. It still has to wait.": "Un drainer obtient votre signature. Il doit quand même attendre.",
"Withdrawal requested": "Retrait demandé", "leaves in 71:59:48": "sort dans 71:59:48",
"Phishing tricks you once. You have days to notice.": "L'hameçonnage vous piège une fois. Vous avez des jours pour le voir.",
"Verify your wallet to claim 500 USDC": "Vérifiez votre portefeuille pour réclamer 500 USDC", "Queued · can leave in 3 days": "En attente · peut sortir dans 3 jours", "Cancelled. It never left.": "Annulé. Rien n'est sorti.",
"A stolen key can only make the rules stricter.": "Une clé volée ne peut que rendre les règles plus strictes.",
"Shorter delay": "Délai plus court", "waits 7 days": "attend 7 jours", "Thief's address as trusted": "Adresse du voleur en confiance", "Thief as guardian": "Voleur comme gardien", "Stricter rule": "Règle plus stricte", "applies now": "immédiat",
"Someone forcing you gets the same answer you would.": "Quelqu'un qui vous force obtient la même réponse que vous.",
"No one can make it faster. Not even you.": "Personne ne peut aller plus vite. Pas même vous.",
"Your own 3 a.m. Sleep on it.": "Votre propre 3 h du matin. Dormez là-dessus.", "Cancelled at 9:14 am": "Annulé à 9 h 14",
"See it for yourself.": "Voyez par vous-même.", "Request a withdrawal with test coins, watch the clock, then cancel it.": "Demandez un retrait avec des jetons de test, regardez le compte à rebours, puis annulez-le.",
"Delay, cancel,": "Attendre, annuler,", "keep": "garder", "Questions": "Questions", "Three ways out": "Trois façons de sortir",
"Pay your own addresses instantly.": "Payez vos propres adresses instantanément.",
"Your exchange, your bank off-ramp, your cold wallet. Adding a new one waits days, or needs your guardian.": "Votre plateforme d'échange, votre sortie vers la banque, votre portefeuille froid. En ajouter une nouvelle prend des jours, ou votre gardien.",
"Bank off-ramp": "Sortie vers la banque", "Instant": "Instantané", "Cold wallet": "Portefeuille froid", "New address": "Nouvelle adresse", "Waits 7 days": "Attend 7 jours",
"Anything else waits. Cancel any time.": "Tout le reste attend. Annulez en tout temps.",
"From an hour to a year: you choose. Every withdrawal shows a countdown, and cancelling is free.": "D'une heure à un an : vous choisissez. Chaque retrait affiche un compte à rebours, et annuler est gratuit.",
"until it can leave": "avant de pouvoir sortir",
"Loosening a rule waits days. Tightening is instant.": "Assouplir une règle prend des jours. La resserrer est immédiat.",
"A shorter delay, a higher limit, a new trusted address, any guardian change: all of these wait.": "Un délai plus court, une limite plus haute, une nouvelle adresse de confiance, tout changement de gardien : tout ça attend.",
"Withdrawal delay": "Délai de retrait", "Daily limit": "Limite quotidienne", "Raise limit · applies in 7 days": "Hausse de limite · dans 7 jours",
"Create a vault.": "Créez un coffre.", "An account on the chain that only your wallet controls. Ecrin never touches your keys.": "Un compte sur la blockchain que seul votre portefeuille contrôle. Ecrin ne touche jamais à vos clés.",
"Pick your protection.": "Choisissez votre protection.", "Gentle, Strong or Locked; add trusted addresses and, if you like, a guardian.": "Douce, Forte ou Verrouillée; ajoutez des adresses de confiance et, si vous voulez, un gardien.",
"Live normally.": "Vivez normalement.", "Pay your own accounts instantly. Everything else waits, and you can always change your mind.": "Payez vos propres comptes instantanément. Tout le reste attend, et vous pouvez toujours changer d'idée.",
"Every coin.": "Chaque jeton.", "Every": "Chaque", "chain.": "réseau.",
"One vault per network, the same rules everywhere. USDC sits next to your SOL, ETH or POL, with its own daily limit.": "Un coffre par réseau, les mêmes règles partout. Les USDC côtoient vos SOL, ETH ou POL, avec leur propre limite quotidienne.",
"Networks": "Réseaux", "Assets": "Actifs", "same rules for every coin": "mêmes règles pour chaque jeton",
"12.40 protected · 0.85 in wallet": "12,40 protégés · 0,85 dans le portefeuille", "1,500.00 protected · 120.00 in wallet": "1 500,00 protégés · 120,00 dans le portefeuille", "250.00 leaving in 2d 23h": "250,00 sortent dans 2 j 23 h", "Cancel": "Annuler",
"The attack works.": "L'attaque réussit.", "The money": "L'argent", "stays.": "reste.",
"Before": "Avant", "All quiet.": "Tout est calme.", "Your savings sit in the vault. Your own trusted addresses can be paid instantly; everything else has to wait.": "Vos économies dorment dans le coffre. Vos adresses de confiance sont payées instantanément; tout le reste doit attendre.",
"Your key leaks.": "Votre clé fuit.", "A thief signs a withdrawal of everything to their own address. On a normal wallet, this is the end of the story. Here, Solana itself queues it for your delay, and it shows up with a countdown.": "Un voleur signe un retrait de tout vers sa propre adresse. Sur un portefeuille normal, c'est la fin de l'histoire. Ici, Solana elle-même le met en attente pour votre délai, avec un compte à rebours.",
"You press Cancel.": "Vous appuyez sur Annuler.", "Free and instant. Then you get out on your terms: pay your own trusted address, or request a withdrawal to a fresh wallet and have your guardian release it on the spot.": "Gratuit et instantané. Ensuite, vous sortez selon vos conditions : payez votre adresse de confiance, ou demandez un retrait vers un nouveau portefeuille et votre gardien le libère sur-le-champ.",
"Nothing was taken.": "Rien n'a été pris.", "The thief can't shorten the delay, add their address as trusted, or name their own guardian without waiting days. A key can make the rules stricter, never looser: at worst it freezes the vault, it never empties it.": "Le voleur ne peut pas raccourcir le délai, ajouter son adresse en confiance ou se nommer gardien sans attendre des jours. Une clé peut rendre les règles plus strictes, jamais plus souples : au pire elle gèle le coffre, elle ne le vide jamais.",
"Your vault": "Votre coffre", "Strong · 72 h": "Forte · 72 h", "All quiet. Nothing waiting to leave.": "Tout est calme. Rien en attente de sortie.", "· 31.40 SOL to 9cRt…X2pa": "· 31,40 SOL vers 9cRt…X2pa",
"Cancelled": "Annulé", "· it never left": "· rien n'est sorti", "Still yours": "Toujours à vous", "· 72 hours later": "· 72 heures plus tard", "hours": "heures", "min": "min", "sec": "s",
"Cancel and keep 31.40 SOL safe": "Annuler et garder 31,40 SOL en sécurité", "31.40 SOL never left.": "Les 31,40 SOL ne sont jamais sortis.",
"Controlled by you,": "Contrôlé par vous,", "guarded": "gardé", "by": "par", "time.": "le temps.",
"The rules live on the chain, not in an app. Close the website, import your key somewhere else: every delay still holds.": "Les règles vivent sur la blockchain, pas dans une app. Fermez le site, importez votre clé ailleurs : chaque délai tient toujours.",
"Your security": "Votre sécurité", "Non-custodial. Ecrin never holds your keys or your money.": "Non custodial. Ecrin ne détient jamais vos clés ni votre argent.", "Only your wallet can ask for a withdrawal.": "Seul votre portefeuille peut demander un retrait.",
"Alerts within a minute, on Telegram or by email.": "Des alertes en moins d'une minute, sur Telegram ou par courriel.", "⏳ Withdrawal requested · 25 USDC": "⏳ Retrait demandé · 25 USDC", "Not you? Cancel it. It's free.": "Pas vous? Annulez. C'est gratuit.",
"A guardian can help in an emergency, never take your money.": "Un gardien peut aider en urgence, jamais prendre votre argent.", "Release a withdrawal you asked for": "Libérer un retrait que vous avez demandé", "yes": "oui",
"Start a withdrawal": "Lancer un retrait", "never": "jamais", "Choose where money goes": "Choisir où va l'argent",
"Open source, tested on every change.": "Code ouvert, testé à chaque changement.", "✓ Solana program tests": "✓ tests du programme Solana", "✓ Ethereum contract tests": "✓ tests du contrat Ethereum", "✓ browser app, end to end": "✓ app web, de bout en bout",
"Not audited yet.": "Pas encore audité.", "Test networks and test coins only. Mainnet comes after an independent security audit, with deposit caps at first.": "Réseaux de test et jetons de test seulement. Le mainnet viendra après un audit de sécurité indépendant, avec des plafonds de dépôt au début.",
"Every shortcut we know of, and why it fails": "Chaque raccourci qu'on connaît, et pourquoi il échoue",
"Wallet drainers": "Drainers de portefeuille", "Phishing signatures": "Signatures d'hameçonnage", "Leaked seed phrases": "Phrases secrètes divulguées", "Address poisoning": "Empoisonnement d'adresse",
"Fake support pages": "Faux soutien technique", "Stolen phones": "Téléphones volés", "Someone forcing you": "Quelqu'un qui vous force", "3 a.m. impulses": "Impulsions à 3 h du matin", "all hit the same wall: time": "frappent tous le même mur : le temps",
"Live on test networks": "En direct sur les réseaux de test", "vaults": "coffres", "SOL protected": "SOL protégés", "networks": "réseaux",
"Coming next": "Bientôt", "Wallet.": "Wallet.", "Wallet": "Wallet", "Ecrin Wallet": "Ecrin Wallet",
"A wallet where your savings sit in a vault by default and only a small allowance is spendable. Every outgoing transaction explained before you sign. Chrome extension first, then iPhone and Android.": "Un portefeuille où votre épargne est dans un coffre par défaut, avec seulement une petite allocation disponible. Chaque transaction sortante est expliquée avant que vous signiez. Extension Chrome d'abord, puis iPhone et Android.",
"Join the waitlist": "Rejoindre la liste d'attente", "One email when it opens. Nothing else.": "Un courriel à l'ouverture. Rien d'autre.", "Email": "Courriel",
"Every shortcut we know of, and why it fails ·": "Chaque raccourci qu'on connaît, et pourquoi il échoue ·", "full security page": "page sécurité complète", "Security page": "Page sécurité", "Way around it": "Contournement", "Why it fails": "Pourquoi ça échoue",
"Import your key into another wallet": "Importer votre clé dans un autre portefeuille", "The key can only request a withdrawal. The program still enforces the wait.": "La clé ne peut que demander un retrait. Le programme impose toujours l'attente.",
"Turn the rules off": "Désactiver les règles", "Loosening any rule waits days, and never before a lock ends.": "Assouplir une règle prend des jours, et jamais avant la fin d'un verrou.",
"Add the attacker's address as trusted": "Mettre l'adresse de l'attaquant en confiance", "New trusted addresses wait days, or need your guardian's approval.": "Les nouvelles adresses de confiance attendent des jours, ou l'accord de votre gardien.",
"Name a second wallet as guardian": "Nommer un deuxième portefeuille gardien", "Any guardian change waits days, so no one can approve their own withdrawal.": "Tout changement de gardien attend des jours, donc personne ne peut approuver son propre retrait.",
"Sell a receipt token for instant SOL": "Vendre un jeton reçu contre des SOL instantanés", "Unlike liquid staking, there is no token to sell.": "Contrairement au staking liquide, il n'y a aucun jeton à vendre.",
"The developer changes the code": "Le développeur change le code", "The program will be made immutable after its audit.": "Le programme sera rendu immuable après son audit.",
"A hardware wallet protects your key.": "Un portefeuille matériel protège votre clé.", "protects": "protège", "your money.": "votre argent.",
"They work best together: sign for your vault with a hardware wallet, and both have to fail before you lose anything.": "Ils sont meilleurs ensemble : signez pour votre coffre avec un portefeuille matériel, et les deux doivent échouer avant que vous perdiez quoi que ce soit.",
"Hot wallet": "Portefeuille chaud", "Hardware wallet": "Portefeuille matériel", "Ecrin vault": "Coffre Ecrin", "You sign a drainer by mistake": "Vous signez un drainer par erreur", "Lost": "Perdu", "Cancel it": "Annulez",
"Your seed phrase leaks": "Votre phrase secrète fuit", "Time to react": "Le temps de réagir", "Someone forces a transfer": "Quelqu'un force un transfert", "Days away": "Dans des jours",
"A 3 a.m. impulse": "Une impulsion à 3 h", "Sleep on it": "Dormez là-dessus", "Paying your own accounts": "Payer vos propres comptes", "Instant to trusted": "Instantané vers la confiance",
"Undo a mistake": "Réparer une erreur", "Never": "Jamais", "Any time before it runs": "En tout temps avant l'exécution",
"Choose how strong.": "Choisissez la force.", "Change": "Modifiez", "it": "la", "slowly.": "lentement.",
"Gentle": "Douce", "Everyday savings with a safety net.": "L'épargne de tous les jours, avec un filet.", "Withdrawals wait 24 hours": "Les retraits attendent 24 heures", "Looser rules wait 3 days": "Les assouplissements attendent 3 jours", "Guardian optional": "Gardien optionnel",
"Recommended": "Recommandé", "Strong": "Forte", "For the money you really can't lose.": "Pour l'argent que vous ne pouvez vraiment pas perdre.", "Withdrawals wait 72 hours": "Les retraits attendent 72 heures", "Looser rules wait 7 days": "Les assouplissements attendent 7 jours", "Guardian for emergencies": "Gardien pour les urgences",
"Locked": "Verrouillée", "For savings that must not move.": "Pour l'épargne qui ne doit pas bouger.", "Nothing leaves before your date": "Rien ne sort avant votre date", "Emergency exit with your guardian": "Sortie d'urgence avec votre gardien", "Looser rules wait until the date": "Les assouplissements attendent la date",
"Security first.": "La sécurité d'abord.", "Then": "Puis", "yield.": "le rendement.", "Now": "Maintenant", "Testnet beta": "Bêta sur testnet",
"SOL, ETH, POL and USDC vaults on six test networks": "Coffres SOL, ETH, POL et USDC sur six réseaux de test", "Delays, trusted addresses, guardian, lock and daily limits": "Délais, adresses de confiance, gardien, verrou et limites quotidiennes", "Telegram and email alerts, WalletConnect, home-screen app": "Alertes Telegram et courriel, WalletConnect, app sur l'écran d'accueil",
"Audit": "Audit", "Independent security audit of the program and the contract": "Audit de sécurité indépendant du programme et du contrat", "Fixes, then a public report": "Corrections, puis un rapport public", "More stablecoins": "Plus de stablecoins",
"Later": "Plus tard", "Mainnet and yield": "Mainnet et rendement", "Mainnet with deposit caps at first": "Mainnet avec plafonds de dépôt au début", "Staking inside the vault: earn yield, keep every delay": "Staking dans le coffre : du rendement, sans perdre aucun délai", "Opt-in lending, only after its own audit": "Prêt optionnel, seulement après son propre audit",
"Who it's for": "Pour qui", "Anyone whose savings shouldn't be one tap away.": "Quiconque dont l'épargne ne devrait pas être à un clic de distance.", "Long-term holders": "Détenteurs à long terme", "People stepping back from gambling, where Ecrin started": "Les gens qui prennent du recul face au jeu, là où Ecrin a commencé", "Families and small teams": "Familles et petites équipes",
"If gambling is hurting you right now, you're not alone. Search for your country's gambling helpline; most are free, confidential and open all night.": "Si le jeu vous fait du mal en ce moment, vous n'êtes pas seul. Au Québec, Jeu : aide et référence répond 24 h sur 24, gratuitement et en toute confidentialité.",
"Questions, answered.": "Vos questions, nos réponses.",
"Is my money safe? Who holds it?": "Mon argent est-il en sécurité? Qui le détient?",
"Your funds sit in a program account on Solana tied to your wallet. Ecrin never has your keys and can't move your funds. Only your wallet can request a withdrawal, and only the program's rules decide when it can run.": "Vos fonds sont dans un compte de programme lié à votre portefeuille. Ecrin n'a jamais vos clés et ne peut pas déplacer vos fonds. Seul votre portefeuille peut demander un retrait, et seules les règles du programme décident quand il peut s'exécuter.",
"What if someone steals my key?": "Et si quelqu'un vole ma clé?",
"They can only ask to withdraw, and that waits your full delay, so cancel each request before it runs (Telegram and email alerts tell you within a minute). To move out, pay one of your trusted addresses, or request a withdrawal to a fresh wallet and have your guardian release it at once. A stolen key can make your rules stricter but never looser: it can't add its own trusted address, shorten a delay or name a guardian without waiting days, so at worst your funds are frozen, not taken. That's why we recommend a guardian on Strong.": "Il peut seulement demander un retrait, qui attend votre délai complet : annulez chaque demande avant qu'elle s'exécute (les alertes Telegram et courriel vous préviennent en moins d'une minute). Pour sortir, payez une de vos adresses de confiance, ou demandez un retrait vers un nouveau portefeuille et votre gardien le libère tout de suite. Une clé volée peut rendre vos règles plus strictes, jamais plus souples : elle ne peut pas ajouter sa propre adresse, raccourcir un délai ou nommer un gardien sans attendre des jours. Au pire, vos fonds sont gelés, pas pris. C'est pourquoi on recommande un gardien avec la protection Forte.",
"What if I have a real emergency?": "Et si j'ai une vraie urgence?",
"Your guardian can co-sign a withdrawal you already requested so it runs immediately. They can't start one, change the amount or pick where it goes. You can also always pay your trusted addresses instantly.": "Votre gardien peut cosigner un retrait que vous avez déjà demandé pour qu'il s'exécute immédiatement. Il ne peut pas en lancer un, changer le montant ni choisir la destination. Vous pouvez aussi toujours payer vos adresses de confiance instantanément.",
"Can my guardian take my money?": "Mon gardien peut-il prendre mon argent?",
"No. A guardian can only approve something you asked for: an emergency release of your own withdrawal, or a trusted address you proposed.": "Non. Un gardien peut seulement approuver ce que vous avez demandé : la libération d'urgence de votre propre retrait, ou une adresse de confiance que vous avez proposée.",
"Will I be able to earn yield?": "Pourrai-je obtenir du rendement?",
"That's the plan: native SOL staking where the stake stays inside the vault, so you earn rewards without creating a fast way out. It comes after the audit.": "C'est le plan : du staking SOL natif où la mise reste dans le coffre, pour gagner des récompenses sans créer de sortie rapide. Ça viendra après l'audit.",
"What can I store?": "Que puis-je y garder?",
"During the beta: SOL and USDC on Solana devnet, and ETH (POL on Polygon) and USDC on Ethereum Sepolia, Base, Arbitrum, Optimism and Polygon test networks. Each coin has its own balance and daily limit under the same rules.": "Pendant la bêta : des SOL et des USDC sur Solana devnet, et des ETH (POL sur Polygon) et des USDC sur les réseaux de test Ethereum Sepolia, Base, Arbitrum, Optimism et Polygon. Chaque jeton a son propre solde et sa limite quotidienne, sous les mêmes règles.",
"Does it cost anything?": "Est-ce que ça coûte quelque chose?",
"The devnet beta is free, using test coins. You only pay normal network fees, a fraction of a cent.": "La bêta est gratuite, avec des jetons de test. Vous payez seulement les frais de réseau normaux, une fraction de cent.",
"Is it live on mainnet?": "Est-ce en ligne sur le mainnet?",
"Not yet. Ecrin runs on test networks while it's being tested. Mainnet comes after an independent security audit, with deposit caps at first.": "Pas encore. Ecrin roule sur des réseaux de test pendant les essais. Le mainnet viendra après un audit de sécurité indépendant, avec des plafonds de dépôt au début.",
'Why "Ecrin"?': "Pourquoi « Ecrin »?",
"An écrin is the case that keeps something precious safe. That's the whole idea.": "Un écrin, c'est l'étui qui garde une chose précieuse en sécurité. C'est toute l'idée.",
"Free on test networks · takes a minute": "Gratuit sur les réseaux de test · une minute suffit",
"Get started.": "Commencez.", "Open": "Ouvrez", "Ecrin.": "Ecrin.", "App": "App", "Demo": "Démo", "GitHub": "GitHub",
"An écrin is the case that keeps something precious safe. Open source · testnet beta · not audited: don't use real funds.": "Un écrin, c'est l'étui qui garde une chose précieuse en sécurité. Code ouvert · bêta sur testnet · pas audité : n'utilisez pas de vrais fonds.",
}
s = open(__import__('os').path.join(ROOT, 'app/index.html')).read()
missing = []
for en, fr in sorted(FR.items(), key=lambda kv: -len(kv[0])):
    e = html.escape(en, quote=False)
    pat = re.compile(r'(>\s*)' + re.escape(e).replace("'", "(?:'|&#39;)") + r'(\s*<)')
    s2, n = pat.subn(lambda m: m.group(1) + html.escape(fr, quote=False) + m.group(2), s)
    for attr in ('content', 'aria-label', 'title'):
        s2, k = re.subn(rf'{attr}="{re.escape(html.escape(en))}"', f'{attr}="{html.escape(fr)}"', s2); n += k
    if n == 0: missing.append(en)
    s = s2
s = s.replace('<html lang="en" data-default-theme="light">', '<html lang="fr" data-default-theme="light">')
s = s.replace('<title>Ecrin · Crypto that can&#x27;t be taken in a hurry</title>', '')
s = re.sub(r'<title>.*?</title>', '<title>Ecrin · Des cryptos qu\'on ne peut pas vous prendre en vitesse</title>', s, flags=re.S)
s = re.sub(r'<meta name="description" content="[^"]*" />', '<meta name="description" content="Ecrin est un coffre on-chain pour Solana et Ethereum. Rien ne sort sans un délai que vous choisissez : un drainer, une signature d\'hameçonnage, une clé volée ou une mauvaise soirée frappent le même mur, le temps. Vous le voyez venir, et vous annulez." />', s)
s = re.sub(r'<meta property="og:title" content="[^"]*" />', '<meta property="og:title" content="Ecrin · Des cryptos qu\'on ne peut pas vous prendre en vitesse" />', s)
s = re.sub(r'<meta name="twitter:title" content="[^"]*" />', '<meta name="twitter:title" content="Ecrin · Des cryptos qu\'on ne peut pas vous prendre en vitesse" />', s)
s = s.replace('<link rel="canonical" href="https://ecrinprotocol.app/" />', '<link rel="canonical" href="https://ecrinprotocol.app/fr/" />')
s = s.replace('<meta property="og:url" content="https://ecrinprotocol.app/" />', '<meta property="og:url" content="https://ecrinprotocol.app/fr/" /><meta property="og:locale" content="fr_CA" />')
for a in ('site.css', 'theme.js', 'site.js'):
    s = s.replace(f'"{a}"', f'"/{a}"')
s = s.replace('href="fonts/', 'href="/fonts/')
# language switch points back to English
s = s.replace('class="lang" href="/fr/" hreflang="fr" lang="fr" aria-label="Lire en français">FR</a>', 'class="lang" href="/" hreflang="en" lang="en" aria-label="Read in English">EN</a>')
s = s.replace('<a class="btn ghost lg" href="/fr/" hreflang="fr" lang="fr">Français</a>', '<a class="btn ghost lg" href="/" hreflang="en" lang="en">English</a>')
for en, fr in [('&nbsp;· 31.40 SOL to 9cRt…X2pa', '&nbsp;· 31,40 SOL vers 9cRt…X2pa'), ('&nbsp;· 72 hours later', '&nbsp;· 72 heures plus tard'), ('&nbsp;· it never left', "&nbsp;· rien n'est sorti"),
               ('href="/security/"', 'href="/fr/securite/"'),
               ('<b class="mi-big">24.00 <small>SOL</small></b>', '<b class="mi-big">24,00 <small>SOL</small></b>'), ('<b class="num" data-pl-amt>24.00</b>', '<b class="num" data-pl-amt>24,00</b>')]:
    s = s.replace(en, fr)
open(os.path.join(ROOT, 'app/fr/index.html'), 'w').write(s)
print("missing:", missing)
