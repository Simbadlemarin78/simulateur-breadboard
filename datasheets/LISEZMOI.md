# Datasheets

Dépose ici les PDF des fabricants : datasheet TMC2209, datasheet ESP32 d'Espressif, fiche du 17HS4401...

Ce dossier est ignoré par git, sauf ce fichier : les PDF restent sur ta machine, car ils appartiennent à leurs fabricants.

Nomme chaque fichier avec la puce et la révision, par exemple `tmc2209-datasheet-rev1.09.pdf`.

Dans la fiche JSON, la section `documents` garde l'URL officielle et l'empreinte du PDF. L'empreinte permet de savoir de quelle version viennent les numéros de page. Pour la calculer :

- macOS ou Linux : `shasum -a 256 nom-du-fichier.pdf`
- Windows (PowerShell) : `Get-FileHash nom-du-fichier.pdf -Algorithm SHA256`

## Documents attendus

Ce tableau dit quel PDF chercher, où le prendre et quelle empreinte il doit avoir. Si ton fichier n'a pas la même empreinte, ce n'est pas la même version : les numéros de page des fiches ne s'appliquent plus.

| Fichier | Document | Source officielle | SHA-256 | État |
| --- | --- | --- | --- | --- |
| `esp32-datasheet-v5.3.pdf` | ESP32 Series Datasheet, version 5.3 (78 pages) | [Espressif](https://www.espressif.com/sites/default/files/documentation/esp32_datasheet_en.pdf) | `a7917e6b47528c9dcab06837a49d452e582751335797db879f1cf2d17cd29adf` | Téléchargé le 19/11/2026 ; source de la fiche `esp32` |
| `esp32-wroom-32-datasheet-v3.8.pdf` | ESP32-WROOM-32 Datasheet, version 3.8 (46 pages) | [Espressif](https://www.espressif.com/sites/default/files/documentation/esp32-wroom-32_datasheet_en.pdf) | `fe7dced2f6077f983dcd7df0e72b6f6c8b7b77fd6de2ff1a0efceffe3fd1e1fa` | Téléchargé le 19/11/2026 ; source de la fiche `esp32-devkitc` ; à confirmer : le module de ta carte est-il un WROOM-32, 32D ou 32E ? |
| `esp32-devkitc-v4-schema-2020-02-25.pdf` | Schéma de l'ESP32-DevKitC V4 (1 page, 25/02/2020) | [Espressif](https://dl.espressif.com/dl/schematics/esp32_devkitc_v4_sch.pdf) | `ea500de5a3bfa97633f32ddb88fabd2d680637225190ea9c3f81e91b7d8bb7f6` | Téléchargé le 19/11/2026 ; source de la fiche `esp32-devkitc` ; ta carte Keyestudio est « compatible DevKitC », son propre schéma serait mieux |
| `tmc2209-datasheet-rev1.08.pdf` | TMC2209 Datasheet, rév. 1.08 du 25/05/2022 (86 pages) | [DigiKey](https://media.digikey.com/pdf/Data%20Sheets/Trinamic%20Motion%20Control%20PDFs/TMC2209_Rev.1.08.pdf) (copie du PDF Trinamic) | `24d6fe363ff4e5898c0c3fa2ed06e9d8a04e34481a5ad5cc9e4555e7403fdd44` | Téléchargé le 19/11/2026 ; source des fiches `tmc2209` et `tmc2209-module` |
| `tmc2209-datasheet-rev1.09.pdf` | TMC2209 Datasheet, rév. 1.09 | [Analog Devices](https://www.analog.com/media/en/technical-documentation/data-sheets/tmc2209_datasheet_rev1.09.pdf) | à calculer | Facultatif : dernière révision, mais le site bloque les téléchargements automatiques, à télécharger à la main |
| `btt-tmc2209-v1.2-schema.pdf` | Schéma du module BIGTREETECH TMC2209 V1.2 (1 page, 05/08/2019) | [GitHub BIGTREETECH](https://github.com/bigtreetech/BIGTREETECH-TMC2209-V1.2/blob/master/Schematic/TMC2209-V1.2.pdf) | `fdd52843290527a5c0117fac0083412b6dad52b9e32efb0e6ba1178c6586d03f` | Téléchargé le 19/11/2026 ; modèle de référence, tes modules sont peut-être d'une autre marque |
| — | Fiche du moteur 17HS4401 | Pas de datasheet officielle | — | Pas de PDF : valeurs prises sur trois pages web concordantes, citées dans `fiches/17hs4401.json` (19/11/2026). La fiche du vendeur reste la bienvenue. |
