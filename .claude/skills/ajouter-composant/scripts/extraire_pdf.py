"""Texte d'un PDF page par page, avec son empreinte sha256, pour écrire une fiche sourcée.

Usage : python -I extraire_pdf.py <fichier.pdf> <sortie.txt> [dossier de bibliothèques]

La sortie contient des marqueurs « === PAGE n === » : le numéro est celui du lecteur PDF
(celui à noter dans le champ « page » d'une source). Essaie pypdf, puis pypdfium2 (qui lit
aussi les PDF chiffrés). Si aucun n'est installé, installer l'un des deux dans le dossier
temporaire de la session (pip install --target <dossier> pypdf pypdfium2), en l'annonçant à
Jean, puis passer ce dossier en troisième argument.
"""
import hashlib
import sys

sys.stdout.reconfigure(encoding="utf-8")
if len(sys.argv) < 3:
    sys.exit(__doc__)
pdf, sortie = sys.argv[1], sys.argv[2]
if len(sys.argv) > 3:
    sys.path.insert(0, sys.argv[3])

with open(pdf, "rb") as f:
    empreinte = hashlib.sha256(f.read()).hexdigest()

pages: list[str] = []
try:
    from pypdf import PdfReader

    lecteur = PdfReader(pdf)
    pages = [page.extract_text() or "" for page in lecteur.pages]
except Exception as erreur_pypdf:  # PDF chiffré, pypdf absent...
    try:
        import pypdfium2 as pdfium

        document = pdfium.PdfDocument(pdf)
        pages = [page.get_textpage().get_text_range() for page in document]
    except Exception as erreur_pdfium:
        sys.exit(f"Lecture impossible : pypdf ({erreur_pypdf}), pypdfium2 ({erreur_pdfium})")

with open(sortie, "w", encoding="utf-8") as f:
    for i, texte in enumerate(pages, start=1):
        f.write(f"\n=== PAGE {i} ===\n{texte}")

vides = sum(1 for t in pages if not t.strip())
print(f"{len(pages)} pages, texte dans {sortie}")
print(f"sha256 {empreinte}")
if vides:
    print(f"{vides} pages sans texte : PDF scanné ? Demander à Jean une version texte, ou lire ces pages en image.")
