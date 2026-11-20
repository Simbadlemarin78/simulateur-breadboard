"""Génère les montages de test au format diagram.json de Wokwi.

Usage (depuis la racine du dépôt) : python outils/generer_montages.py

Produit :
- montages/base-roulante.diagram.json : le brochage proposé dans CLAUDE.md, tel quel
  (sans condensateurs 100 µF ni tirage de EN) ;
- montages/base-roulante-corrigee.diagram.json : le même, avec un condensateur de 100 µF 35 V
  par driver, un tirage de 10 kΩ de EN vers 3,3 V et des fils d'alim doublés : aucune alerte
  attendue, au démarrage comme drivers actifs ;
- montages/cas/*.diagram.json : les 10 cas de test de CLAUDE.md (le cas 2 en deux montages).
  Chaque cas part du montage corrigé et n'y change qu'une chose, sauf les cas 2a et 2b, qui
  isolent un driver branché à l'envers.

Disposition : 4 drivers enfichés sur bb1 à cheval sur la rainure (J3 rangée d en haut, J4 rangée
g en bas, 0,5 pouce plus bas, comme les broches d'un vrai module), ESP32 à droite de la
breadboard, câblé par fils Dupont. Rails : tp = 3V3, tn = GND logique (haut) ; bp = VM 12 V,
bn = GND puissance (bas).
"""
import copy
import json
import os
import sys

J3 = ["EN", "MS1", "MS2", "PDN_UART", "PDN_UART.2", "CLK", "STEP", "DIR"]
J4 = ["VM", "GND.1", "A2", "A1", "B1", "B2", "VDD", "GND.2"]
# (nom, STEP, DIR, MS1 haut, MS2 haut) : adresses MS1-MS2 0-0, 1-0, 0-1, 1-1 ; 0 = laissée en l'air.
DRIVERS = [
    ("avant gauche", "32", "33", False, False),
    ("avant droite", "25", "26", True, False),
    ("arrière gauche", "27", "14", False, True),
    ("arrière droite", "18", "19", True, True),
]


def colonne_depart(k):
    return 3 + 12 * k


def colonnes(k):
    c = colonne_depart(k)
    return {b: c + i for i, b in enumerate(J3)} | {b: c + i for i, b in enumerate(J4)}


def base_roulante(corrigee=False):
    """Pièces et connexions de la base roulante ; corrigee ajoute condensateurs et tirage de EN."""
    parts = [
        {"type": "wokwi-breadboard", "id": "bb1", "top": 0, "left": 0, "attrs": {}},
        {"type": "board-esp32-devkit-c-v4", "id": "esp", "top": -20, "left": 720, "attrs": {}},
        {"type": "alim-labo", "id": "alim", "top": 250, "left": -170, "attrs": {"tension": "12", "limite_courant": "3"}},
        {"type": "wokwi-resistor", "id": "r1", "top": -70, "left": 700, "attrs": {"value": "1000"}},
    ]
    connexions = []

    def fil(a, b, couleur):
        connexions.append([a, b, couleur, []])

    # Alimentations et masses.
    fil("alim:+", "bb1:bp.1", "red")
    fil("alim:-", "bb1:bn.1", "black")
    fil("esp:3V3", "bb1:tp.1", "orange")
    fil("esp:GND.1", "bb1:tn.1", "black")
    fil("bb1:tn.50", "bb1:bn.50", "black")  # masse commune ESP32 / alim moteurs

    # UART : TX IO17 via 1 kΩ, RX IO16, sur PDN_UART des 4 drivers.
    fil("esp:17", "r1:1", "violet")

    for k, (_nom, step, dir_, ms1, ms2) in enumerate(DRIVERS):
        c = colonne_depart(k)
        drv, mot = f"drv{k + 1}", f"mot{k + 1}"
        parts.append({"type": "tmc2209-module", "id": drv, "top": 60, "left": 30 + 115 * k, "attrs": {}})
        parts.append({"type": "wokwi-stepper-motor", "id": mot, "top": 260, "left": 30 + 115 * k, "attrs": {}})
        # Enfichage : une colonne par broche du module.
        for i, broche in enumerate(J3):
            connexions.append([f"{drv}:{broche}", f"bb1:{c + i}t.d", "", []])
        for i, broche in enumerate(J4):
            connexions.append([f"{drv}:{broche}", f"bb1:{c + i}b.g", "", []])
        col = colonnes(k)
        # Puissance et logique.
        fil(f"bb1:{col['VM']}b.j", f"bb1:bp.{col['VM']}", "red")
        fil(f"bb1:{col['GND.1']}b.j", f"bb1:bn.{col['GND.1']}", "black")
        fil(f"bb1:{col['VDD']}b.j", f"bb1:tp.{col['VDD']}", "orange")
        fil(f"bb1:{col['GND.2']}b.j", f"bb1:tn.{col['GND.2']}", "black")
        # STEP / DIR.
        fil(f"esp:{step}", f"bb1:{col['STEP']}t.a", "green")
        fil(f"esp:{dir_}", f"bb1:{col['DIR']}t.a", "blue")
        # EN commun sur IO13, chaîné d'un driver au suivant ; même chose pour PDN_UART.
        if k == 0:
            fil("esp:13", f"bb1:{col['EN']}t.a", "yellow")
            fil("r1:2", f"bb1:{col['PDN_UART']}t.a", "violet")
            fil("esp:16", f"bb1:{col['PDN_UART']}t.b", "gray")
        else:
            precedent = colonne_depart(k - 1)
            fil(f"bb1:{precedent}t.b", f"bb1:{col['EN']}t.a", "yellow")
            fil(f"bb1:{precedent + 3}t.c", f"bb1:{col['PDN_UART']}t.a", "violet")
        # Adresse UART par MS1 / MS2 (1 = relié au 3V3).
        if ms1:
            fil(f"bb1:{col['MS1']}t.a", f"bb1:tp.{col['MS1']}", "orange")
        if ms2:
            fil(f"bb1:{col['MS2']}t.a", f"bb1:tp.{col['MS2']}", "orange")
        # Bobines du moteur : A1 -> A+, A2 -> A-, B1 -> B+, B2 -> B-.
        for sortie, entree in (("A1", "A+"), ("A2", "A-"), ("B1", "B+"), ("B2", "B-")):
            fil(f"bb1:{col[sortie]}b.j", f"{mot}:{entree}", "gold")

    if corrigee:
        for k in range(len(DRIVERS)):
            col = colonnes(k)
            cond = f"c{k + 1}"
            # Sous la breadboard, sous VM et GND.1 de son driver, relié à leurs bandes par deux fils courts.
            x_vm = 20 + (col["VM"] - 1) * 10
            parts.append({"type": "condensateur-electrolytique", "id": cond, "top": 205, "left": x_vm - 10, "attrs": {"capacite": 100, "tension_nominale": 35}})
            fil(f"bb1:{col['VM']}b.i", f"{cond}:+", "red")
            fil(f"bb1:{col['GND.1']}b.i", f"{cond}:-", "black")
        # Tirage de EN vers 3,3 V : les drivers restent coupés tant que le programme ne les active pas.
        parts.append({"type": "wokwi-resistor", "id": "r2", "top": -50, "left": 20, "attrs": {"value": "10000"}})
        fil(f"bb1:{colonnes(0)['EN']}t.c", "r2:1", "yellow")
        fil("r2:2", "bb1:tp.2", "orange")
        # Fils d'alim doublés : drivers actifs, 4 × 0,25 A = 1,02 A arrivent sur le rail VM ;
        # deux fils et deux trous en parallèle en portent chacun la moitié, sous le 1 A d'un contact.
        fil("alim:+", "bb1:bp.5", "red")
        fil("alim:-", "bb1:bn.5", "black")

    return {"version": 1, "author": "simulateur-breadboard", "editor": "wokwi", "parts": parts, "connections": connexions, "dependencies": {}}


def sans_connexions(d, predicat):
    d["connections"] = [c for c in d["connections"] if not predicat(c)]
    return d


def touche(c, *points):
    return c[0] in points or c[1] in points


def piece(d, id_):
    return next(p for p in d["parts"] if p["id"] == id_)


def driver_inverse(source):
    """Un module seul, VM et GND.1 inversés, sur la source donnée (cas 2a et 2b)."""
    return {
        "version": 1,
        "author": "simulateur-breadboard",
        "editor": "wokwi",
        "parts": [source, {"type": "tmc2209-module", "id": "drv1", "top": 0, "left": 0, "attrs": {}}],
        "connections": [
            [f"{source['id']}:+", "drv1:GND.1", "red", []],
            [f"{source['id']}:-", "drv1:VM", "black", []],
        ],
        "dependencies": {},
    }


def cas():
    corrigee = base_roulante(corrigee=True)
    col1 = colonnes(0)
    montages = {}

    # 1. 12 V sur une broche de l'ESP32 : le rail VM relié à IO4, sans résistance.
    d = copy.deepcopy(corrigee)
    d["connections"].append(["bb1:bp.2", "esp:4", "red", []])
    montages["cas-01-12v-sur-broche"] = d

    # 2a et 2b. VM et GND inversés : sur une LiPo 4S chargée, puis sur l'alim limitée à 1 A.
    montages["cas-02a-vm-inverse-lipo"] = driver_inverse({"type": "lipo-4s", "id": "batt", "top": 0, "left": -200, "attrs": {"tension_element": 4.2}})
    montages["cas-02b-vm-inverse-alim-1a"] = driver_inverse({"type": "alim-labo", "id": "alim", "top": 0, "left": -200, "attrs": {"tension": 12, "limite_courant": 1}})

    # 3. Moteur débranché alors que VM est alimenté : les quatre fils de mot1 retirés.
    montages["cas-03-moteur-debranche"] = sans_connexions(copy.deepcopy(corrigee), lambda c: "mot1:" in c[0] or "mot1:" in c[1])

    # 4. Pas de condensateur de 100 µF près de drv1.
    d = sans_connexions(copy.deepcopy(corrigee), lambda c: "c1:" in c[0] or "c1:" in c[1])
    d["parts"] = [p for p in d["parts"] if p["id"] != "c1"]
    montages["cas-04-sans-condensateur"] = d

    # 5. EN qui flotte au démarrage : pas de tirage de 10 kΩ, et IO13 ne commande que drv1.
    #    Face aux 45 kΩ de IO13 vers la masse, les 20 kΩ du seul module mettent EN vers 2,3 V.
    d = sans_connexions(copy.deepcopy(corrigee), lambda c: "r2:" in c[0] or "r2:" in c[1])
    d["parts"] = [p for p in d["parts"] if p["id"] != "r2"]
    autres_en = {f"bb1:{colonnes(k)['EN']}t.a" for k in range(1, len(DRIVERS))}
    montages["cas-05-en-flotte"] = sans_connexions(d, lambda c: c[2] == "yellow" and touche(c, *autres_en))

    # 6. STEP de drv1 sur IO34, une entrée seule.
    d = copy.deepcopy(corrigee)
    for c in d["connections"]:
        if c[0] == "esp:32" and c[1] == f"bb1:{col1['STEP']}t.a":
            c[0] = "esp:34"
    montages["cas-06-step-sur-io34"] = d

    # 7. MS1/MS2 différents d'un driver à l'autre, sans UART : fils de l'UART et r1 retirés.
    d = sans_connexions(copy.deepcopy(corrigee), lambda c: c[2] in ("violet", "gray"))
    d["parts"] = [p for p in d["parts"] if p["id"] != "r1"]
    montages["cas-07-micro-pas-sans-uart"] = d

    # 8. Masses ESP32 et alim moteurs non reliées : ni fil tn-bn, ni GND.2 des modules vers tn.
    gnd2 = {f"bb1:{colonnes(k)['GND.2']}b.j" for k in range(len(DRIVERS))}
    montages["cas-08-masses-separees"] = sans_connexions(copy.deepcopy(corrigee), lambda c: touche(c, "bb1:tn.50") or touche(c, *gnd2))

    # 9. Plus de 1 A dans un contact : drivers activés (IO13 en sortie basse), VREF à 1,35 V, et un
    #    seul fil d'alim par borne (pas de doublement) : 0,95 A par bobine (sous 1 A), mais
    #    4 × 0,32 A arrivent par ce seul fil sur le rail VM.
    d = sans_connexions(copy.deepcopy(corrigee), lambda c: touche(c, "bb1:bp.5", "bb1:bn.5"))
    piece(d, "esp")["attrs"]["etats"] = {"13": "sortie_basse"}
    for k in range(len(DRIVERS)):
        piece(d, f"drv{k + 1}")["attrs"]["vref"] = 1.35
    montages["cas-09-contact-surcharge"] = d

    # 10. Courant moteur réglé au-dessus de 1,7 A : drivers activés, 1,75 A réglés par l'UART sur drv1.
    d = copy.deepcopy(corrigee)
    piece(d, "esp")["attrs"]["etats"] = {"13": "sortie_basse"}
    piece(d, "drv1")["attrs"]["courant_uart"] = 1.75
    montages["cas-10-courant-moteur"] = d
    return montages


def ecrire(chemin, diagramme):
    os.makedirs(os.path.dirname(chemin), exist_ok=True)
    with open(chemin, "w", encoding="utf-8", newline="\n") as f:
        json.dump(diagramme, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"{chemin} : {len(diagramme['parts'])} pièces, {len(diagramme['connections'])} connexions")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    ecrire("montages/base-roulante.diagram.json", base_roulante())
    ecrire("montages/base-roulante-corrigee.diagram.json", base_roulante(corrigee=True))
    for nom, d in cas().items():
        ecrire(f"montages/cas/{nom}.diagram.json", d)
