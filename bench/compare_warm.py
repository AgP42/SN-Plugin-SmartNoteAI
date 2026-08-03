#!/usr/bin/env python3
# Duel aveugle : Small + prompt chaleureux  VS  Ministral brut (sortie deja produite).
import os, json, time, hashlib, random, urllib.request, urllib.error
from harness import ITEMS, PRICES, cost_of  # reutilise les prompts EXACTS du banc

API = "https://api.mistral.ai/v1/chat/completions"
KEY = os.environ["MISTRAL_API_KEY"]
HERE = os.path.dirname(os.path.abspath(__file__))
RUNS = os.path.join(HERE, "runs")            # sorties originales (Ministral dedans)
WARM = os.path.join(HERE, "runs_warm")
os.makedirs(WARM, exist_ok=True)

# Prompt systeme "chaleureux facon Ministral" MAIS discipline preservee
SYS_WARM = (
    "Tu es un assistant francophone chaleureux, humain et engageant. "
    "Adopte un ton bienveillant (une breve formule d'accueil quand c'est naturel) et sois genereux : "
    "quand c'est utile, propose une variante ou explique brievement tes choix. "
    "IMPERATIF cependant : (1) respecte scrupuleusement les contraintes explicites de format et de longueur "
    "de la demande ; (2) francais impeccable, PAS de majuscule a chaque mot, PAS d'anglicismes. "
    "La justesse et le respect de la consigne priment toujours sur le style."
)
SMALL = "mistral-small-latest"

def call(prompt, max_tokens, retries=6):
    body = json.dumps({
        "model": SMALL, "temperature": 0.3, "max_tokens": max_tokens,
        "messages": [{"role": "system", "content": SYS_WARM}, {"role": "user", "content": prompt}],
    }).encode()
    last = None
    for a in range(retries):
        try:
            req = urllib.request.Request(API, data=body, headers={
                "Authorization": f"Bearer {KEY}", "Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=90) as r:
                d = json.load(r)
            u = d["usage"]
            return d["choices"][0]["message"]["content"], cost_of(SMALL, u)
        except urllib.error.HTTPError as e:
            last = f"HTTP {e.code}"; time.sleep(6*(a+1) if e.code == 429 else 2*(a+1))
        except Exception as e:
            last = str(e); time.sleep(2*(a+1))
    return f"[ERREUR: {last}]", 0.0

c_items = [(iid, p, mt) for (iid, p, mt) in ITEMS if iid.startswith("c")]
total = 0.0
sheet = ["# Duel aveugle — chat : Option X vs Option Y\n",
         "Pour chaque item, dis juste **X** ou **Y** (celle que tu preferes), et un mot pourquoi si tu veux.\n",
         "Une des deux est Small avec un prompt chaleureux, l'autre est Ministral brut — tu ne sais pas laquelle.\n",
         "```", *[f"{iid.split('_')[0]}: " for iid, _, _ in c_items], "```\n---\n"]
keymap = {}

for iid, prompt, mt in c_items:
    warm_txt, c = call(prompt, mt); total += c
    open(os.path.join(WARM, f"{iid}__small_warm.txt"), "w").write(warm_txt)
    mini_txt = open(os.path.join(RUNS, f"{iid}__ministral-14b-latest.txt")).read().strip()
    pair = [("small_warm", warm_txt.strip()), ("ministral", mini_txt)]
    rng = random.Random(int(hashlib.sha256((iid+"warm").encode()).hexdigest(), 16))
    rng.shuffle(pair)
    keymap[iid] = {"X": pair[0][0], "Y": pair[1][0]}
    short = iid.split("_")[0]
    sheet.append(f"## {short}\n")
    sheet.append("**Demande :**\n\n> " + prompt.replace("\n", "\n> ") + "\n")
    sheet.append(f"**Option X :**\n\n{pair[0][1]}\n")
    sheet.append(f"**Option Y :**\n\n{pair[1][1]}\n")
    sheet.append(f"➡️ **{short}: X ou Y ?**\n\n---\n")
    print(f"  done {iid}", flush=True)

json.dump(keymap, open(os.path.join(HERE, "key_warm.json"), "w"), indent=2)
open(os.path.join(HERE, "RATING_WARM.md"), "w").write("\n".join(sheet))
print(f"\nCout Small-warm (10 items): {total:.4f} EUR")
print("Feuille: RATING_WARM.md  |  cle cachee: key_warm.json")
