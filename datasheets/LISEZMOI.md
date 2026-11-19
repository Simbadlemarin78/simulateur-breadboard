# Datasheets

Dépose ici les PDF des fabricants : datasheet TMC2209, datasheet ESP32 d'Espressif, fiche du 17HS4401...

Ce dossier est ignoré par git, sauf ce fichier : les PDF restent sur ta machine, car ils appartiennent à leurs fabricants.

Nomme chaque fichier avec la puce et la révision, par exemple `tmc2209-datasheet-rev1.09.pdf`.

Dans la fiche JSON, la section `documents` garde l'URL officielle et l'empreinte du PDF. L'empreinte permet de savoir de quelle version viennent les numéros de page. Pour la calculer :

- macOS ou Linux : `shasum -a 256 nom-du-fichier.pdf`
- Windows (PowerShell) : `Get-FileHash nom-du-fichier.pdf -Algorithm SHA256`
