#!/usr/bin/env python3
# Banc d'essai aveugle Mistral — 4 modeles chat.
# Appels API reels, sorties verbatim, anonymisation + shuffle par item.
# Aucun score genere ici : la notation est faite par l'utilisateur a l'aveugle.
import os, sys, json, time, hashlib, random, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor

API = "https://api.mistral.ai/v1/chat/completions"
KEY = os.environ["MISTRAL_API_KEY"]
HERE = os.path.dirname(os.path.abspath(__file__))
RUNS = os.path.join(HERE, "runs")
os.makedirs(RUNS, exist_ok=True)

MODELS = ["ministral-14b-latest", "mistral-small-latest", "mistral-large-latest", "mistral-medium-latest"]
# prix EUR /M tokens (in, out) fournis par l'utilisateur
PRICES = {
    "ministral-14b-latest": (0.18, 0.18),
    "mistral-small-latest":  (0.12, 0.50),
    "mistral-large-latest":  (0.44, 1.30),
    "mistral-medium-latest": (1.25, 6.40),
}
SYS = ("Tu es un assistant francophone. Reponds de facon precise, utile et concise. "
       "Si une information demandee n'est pas presente dans le texte fourni, dis-le clairement "
       "au lieu d'inventer.")

# ---- Note-texts (materiel de test, style OCR de notes manuscrites) ----
N_REU = """Reunion projet Manta - 12 mars
Present: Loic, Sarah, Karim. Absent: Ben (conge).
- Sarah: finir maquette ecran d'accueil -> avant vendredi
- Karim: corriger bug export PDF, bloquant pour la demo
- Loic: relire specs API et renvoyer commentaires a Sarah
- decision: on repousse la beta au 2 avril (au lieu du 25 mars)
- Ben devra preparer les notes de version a son retour lundi
budget restant ~ 3400 EUR, prevoir achat 2 tablettes de test"""

N_BIO = """Cours SVT - la photosynthese
- se produit dans les chloroplastes, pigment = chlorophylle (vert)
- entrees: CO2 (air) + H2O (racines) + lumiere
- sorties: glucose (sucre) + O2 rejete
- equation simplifiee: 6 CO2 + 6 H2O -> C6H12O6 + 6 O2
- surtout dans les feuilles, face aux stomates
- phase claire (besoin lumiere) puis cycle de Calvin"""

N_CMD = """Commande materiel
- passee le 3 mars
- fournisseur annonce livraison sous 6 semaines ouvrees
- acompte 30% paye, solde a la livraison
- reference: BON-2291, montant total 1290 EUR HT"""

N_INCO = """Suivi ventes T1
- janvier: 42 unites
- fevrier: 55 unites
- mars: 48 unites
- total trimestre note en bas: 135 unites
- objectif etait 150, prime si atteint
NB: revoir chiffre fevrier, doute sur la saisie"""

N_JOUR = """Journal
lun: dormi 5h, journee dure, cafe x4, humeur basse
mar: dormi 6h, mieux, sport le soir
mer: dormi 5h30, stress reunion, saute le sport
jeu: dormi 7h, bonne journee, humeur ok
ven: dormi 6h30, fatigue accumulee mais moral correct"""

N_BUD = """Budget week-end rando
- location gite: 180 EUR
- essence (aller-retour): 60 EUR
- nourriture 3 pers: 95 EUR
- location materiel: 45 EUR
- peages: 28 EUR
on partage tout en 3"""

N_REC = """Liste courses gateau
- 400g farine
- 6 oeufs
- 300g sucre
- 250g beurre
- 2 sachets levure
-> recette dit "pour un grand moule, environ 12 parts" """

N_MIX = """Idees feature - backlog
- add a "focus mode" that hides the toolbar
- synchro cloud: risque de conflits, a creuser
- export en .md pour Obsidian users
- widget batterie sur l'ecran d'accueil
- "quick capture" depuis n'importe quel ecran (like a floating bubble)"""

N_BRAIN = """Brainstorm appli notes
- reconnaissance ecriture
- rappels par date
- tags couleur
- recherche plein texte
- partage PDF
- mode sombre
- backup auto
- raccourcis clavier
- import photos
- statistiques d'usage"""

N_PLAN = """Contraintes planning atelier
- dispo salle: mar/jeu uniquement, 9h-17h
- Karim indispo le jeudi
- l'atelier dure 3h d'affilee
- pause dejeuner bloquee 12h-13h30
- Sarah part a 15h le mardi"""

ITEMS = [
    # ---- Q&R sur notes ----
    ("q01_actions", f"{N_REU}\n\nQuestion: Liste chaque action a faire, avec le responsable et l'echeance.", 500),
    ("q02_absent",  f"{N_BIO}\n\nQuestion: D'apres ces notes, quel est le rendement energetique de la photosynthese en pourcentage ?", 400),
    ("q03_datemath",f"{N_CMD}\n\nQuestion: Vers quelle date la livraison est-elle attendue ? Explique brievement ton calcul.", 400),
    ("q04_incohere",f"{N_INCO}\n\nQuestion: Y a-t-il une incoherence dans ces chiffres ? Si oui, laquelle, et l'objectif est-il atteint ?", 400),
    ("q05_tendance",f"{N_JOUR}\n\nQuestion: Quelle tendance ressort sur mon sommeil et mon humeur cette semaine ?", 400),
    ("q06_budget",  f"{N_BUD}\n\nQuestion: Quel est le total, le poste le plus cher, et combien chacun doit-il payer ?", 400),
    ("q07_portions",f"{N_REC}\n\nQuestion: Pour combien de personnes cette recette est-elle prevue, et comment le sais-tu ?", 300),
    ("q08_mix",     f"{N_MIX}\n\nQuestion: Parmi ces idees, laquelle ressemble a une bulle flottante deja evoquee ailleurs, et quelles idees presentent un risque technique ?", 400),
    ("q09_themes",  f"{N_BRAIN}\n\nQuestion: Regroupe ces idees en 3 ou 4 grands themes coherents.", 400),
    ("q10_creneau", f"{N_PLAN}\n\nQuestion: Propose un creneau qui respecte toutes les contraintes, ou explique si c'est impossible.", 400),
    # ---- Chat / redaction ----
    ("c01_reformule", "Reformule ce passage en francais clair et simple, sans jargon:\n\"La mise en oeuvre de la solution susmentionnee implique une reconsideration holistique des paradigmes operationnels afin d'optimiser les synergies inter-departementales.\"", 300),
    ("c02_resume3",   "Resume ce texte en exactement 3 puces:\nLe papier electronique consomme de l'energie surtout lors du rafraichissement de l'image. Une fois l'image affichee, elle reste visible sans consommer d'electricite. C'est pourquoi les liseuses tiennent des semaines. En revanche, le taux de rafraichissement est lent, ce qui rend ces ecrans peu adaptes a la video.", 300),
    ("c03_email",     "Redige un email de relance poli et bref a partir de ces points:\n- devis envoye il y a 2 semaines\n- pas de reponse\n- on reste disponible pour en discuter\n- proposer un appel cette semaine", 350),
    ("c04_ton",       "Reecris ce message dans un ton chaleureux et courtois sans en changer le fond:\n\"Votre demande est refusee. Le formulaire est incomplet. Renvoyez-le.\"", 300),
    ("c05_explique",  "Explique a un enfant de 10 ans comment fonctionne un ecran d'encre electronique (e-ink), en 4 phrases maximum.", 300),
    ("c06_correction","Corrige toutes les fautes d'orthographe et de grammaire, et rends juste le texte corrige:\n\"Les utilisateur on remarquer que l'apli plante quand il ouvre plusieur note en meme temp, se qui est tres genant pour leurs travail quotidient.\"", 300),
    ("c07_titres",    "Propose 5 titres accrocheurs pour un article de blog sur l'ecriture manuscrite a l'ere du numerique.", 300),
    ("c08_traduc",    "Traduis ce paragraphe en anglais naturel et fluide:\n\"Notre nouvelle fonctionnalite permet de capturer une idee en un geste, depuis n'importe quel ecran, sans interrompre ce que vous etes en train de faire.\"", 300),
    ("c09_cadeaux",   "Propose 5 idees de cadeau pour quelqu'un qui aime la lecture, la randonnee et le minimalisme, budget max 50 EUR chacune. Une ligne par idee.", 350),
    ("c10_plan",      "Transforme ces notes en vrac en un plan hierarchique clair:\nlancer produit - faire teaser reseaux, contacter 3 influenceurs, preparer page d'atterrissage, definir prix, ecrire FAQ, tester paiement, planifier date, email a la liste d'attente, prevoir support jour J", 400),
]

def cost_of(model, u):
    pin, pout = PRICES[model]
    return u["prompt_tokens"]/1e6*pin + u["completion_tokens"]/1e6*pout

def call(model, prompt, max_tokens, retries=6):
    # cache disque : ne rappelle pas un couple (item,modele) deja reussi
    jpath = None  # set by caller via closure? simpler: handled in run_item
    body = json.dumps({
        "model": model,
        "temperature": 0.3,
        "max_tokens": max_tokens,
        "messages": [{"role": "system", "content": SYS}, {"role": "user", "content": prompt}],
    }).encode()
    last = None
    for a in range(retries):
        try:
            req = urllib.request.Request(API, data=body, headers={
                "Authorization": f"Bearer {KEY}", "Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=90) as r:
                d = json.load(r)
            msg = d["choices"][0]["message"]["content"]
            u = d["usage"]
            return {"content": msg, "usage": u, "cost_eur": cost_of(model, u)}
        except urllib.error.HTTPError as e:
            last = f"HTTP {e.code}: {e.read().decode()[:200]}"
            time.sleep(6*(a+1) if e.code == 429 else 2*(a+1))  # back-off long sur 429
            continue
        except Exception as e:
            last = f"{type(e).__name__}: {e}"
            time.sleep(2*(a+1))
    return {"content": f"[ERREUR: {last}]", "usage": {"prompt_tokens":0,"completion_tokens":0}, "cost_eur": 0.0}

def get(model, iid, prompt, mt):
    jpath = os.path.join(RUNS, f"{iid}__{model}.json")
    if os.path.exists(jpath):
        r = json.load(open(jpath))
        if not r["content"].startswith("[ERREUR"):
            return r  # cache hit
    r = call(model, prompt, mt)
    if not r["content"].startswith("[ERREUR"):
        json.dump(r, open(jpath, "w"))
        with open(os.path.join(RUNS, f"{iid}__{model}.txt"), "w") as fh:
            fh.write(r["content"])
    return r

def run_item(item):
    iid, prompt, mt = item
    out = {}
    with ThreadPoolExecutor(max_workers=2) as ex:  # concurrence reduite pour eviter 429
        futs = {ex.submit(get, m, iid, prompt, mt): m for m in MODELS}
        for f in futs:
            out[futs[f]] = f.result()
    bad = [m for m in MODELS if out[m]["content"].startswith("[ERREUR")]
    print(f"  done {iid}" + (f"  !! ECHEC: {bad}" if bad else ""), flush=True)
    return iid, prompt, out

def main():
    results = []
    print(f"Running {len(ITEMS)} items x {len(MODELS)} models = {len(ITEMS)*len(MODELS)} calls...", flush=True)
    with ThreadPoolExecutor(max_workers=3) as ex:
        for r in ex.map(run_item, ITEMS):
            results.append(r)
    # ordre stable par id
    results.sort(key=lambda x: x[0])

    key_map = {}   # iid -> {label: model}
    sheet = []
    total_cost = 0.0
    cost_by_model = {m: 0.0 for m in MODELS}
    for iid, prompt, out in results:
        rng = random.Random(int(hashlib.sha256(iid.encode()).hexdigest(), 16))
        labels = ["A", "B", "C", "D"]
        shuffled = MODELS[:]
        rng.shuffle(shuffled)
        mapping = dict(zip(labels, shuffled))
        key_map[iid] = mapping
        for m in MODELS:
            total_cost += out[m]["cost_eur"]
            cost_by_model[m] += out[m]["cost_eur"]
        sheet.append((iid, prompt, mapping, out))

    with open(os.path.join(HERE, "key.json"), "w") as fh:
        json.dump(key_map, fh, indent=2)

    # feuille de notation anonymisee
    lines = ["# Feuille de notation a l'aveugle — 20 items\n",
             "Pour CHAQUE item: classe les 4 reponses de la meilleure a la pire.",
             "Ecris juste l'ordre des lettres, ex: `q01: B D A C`.",
             "Ajoute `| fail: C` si une reponse est factuellement fausse ou inutilisable (autant de lettres que besoin).",
             "Tu ne sais pas quel modele est quelle lettre — c'est voulu.\n",
             "---\n"]
    for iid, prompt, mapping, out in sheet:
        lines.append(f"## {iid}\n")
        lines.append("**Prompt :**\n")
        lines.append("> " + prompt.replace("\n", "\n> ") + "\n")
        for lab in ["A", "B", "C", "D"]:
            m = mapping[lab]
            lines.append(f"**Reponse {lab} :**\n")
            lines.append(out[m]["content"].strip() + "\n")
        lines.append(f"`{iid}: _ _ _ _   | fail:`\n")
        lines.append("---\n")
    with open(os.path.join(HERE, "RATING_SHEET.md"), "w") as fh:
        fh.write("\n".join(lines))

    # recap cout (visible, factuel — pas un score de qualite)
    print("\n=== COUT DU BANC (reel, EUR) ===")
    for m in MODELS:
        print(f"  {m:24s} {cost_by_model[m]:.4f} EUR")
    print(f"  {'TOTAL':24s} {total_cost:.4f} EUR")
    print(f"\nFeuille: {os.path.join(HERE,'RATING_SHEET.md')}")
    print(f"Cle cachee: {os.path.join(HERE,'key.json')}")

if __name__ == "__main__":
    main()
