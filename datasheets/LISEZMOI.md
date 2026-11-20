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
| `velleman-vtbb2n-breadboard.pdf` | Breadboard 830 points Velleman VTBB2N, fiche produit (2 pages, 05/02/2026) | [RS Components](https://docs.rs-online.com/f7a1/A700000015716504.pdf) | `0d274df06e76219a783a06edb5d1901eb8be43f193b937c08738c511bc4c79b6` | Téléchargé le 19/11/2026 ; ordre de grandeur pour la fiche `breadboard-830` |
| `velleman-labps3005d-manuel-v05.pdf` | Alim de labo Velleman LABPS3005D, manuel V. 05 (60 pages, 27/05/2015) | [ELV](https://media.elv.com/file/109993_labps3005da5v05_um.pdf) | `b2a53aef15be90c03fbeb3aaa22f20b59946ccf108be4dfdf2f7830bb264a644` | Téléchargé le 19/11/2026 ; source de la fiche `alim-labo` (ton alim est peut-être d'un autre modèle) |
| `maxamps-670-1s-lipo.pdf` | Élément LiPo MaxAmps 670 1S, data sheet (1 page) | [MaxAmps](https://cdn.shopify.com/s/files/1/0609/0811/0079/files/MaxAmps_670_1S_LiPo_Data_Sheet.pdf) | `4a69e44bce9c11bda460c99e3a86bfe1377511be20bd7063a9a8c6eaad4ea0af` | Téléchargé le 19/11/2026 ; source de la fiche `lipo-4s` |
| `adafruit-li-ion-lipo-guide.pdf` | Li-Ion & LiPoly Batteries, guide Adafruit (19 pages, 08/07/2025) | [Adafruit](https://cdn-learn.adafruit.com/downloads/pdf/li-ion-and-lipoly-batteries.pdf) | `302de31064b349a2fbe42567226f123033204615b3ea689029ec0b504a8ee70c` | Téléchargé le 19/11/2026 ; source de la fiche `lipo-4s` |
| `chemicon-precautions-electrolytiques.pdf` | Precautions and Guidelines (Aluminum Electrolytic Capacitors), Chemi-Con CAT. No. E1001A (4 pages) | [Nippon Chemi-Con](https://www.chemi-con.co.jp/products/relatedfiles/capacitor/catalog/al-precaution-e.pdf) | `90174cd4fefbdae9e846a9ba29f172ee636eacf43be2ebd739a0b792ff3cf39c` | Téléchargé le 19/11/2026 ; source de la fiche `condensateur-electrolytique` |
| `samtec-dwct-28-01.pdf` | Câble 28 AWG Samtec DWCT-28-01, datasheet (1 page, PDF chiffré : se lit avec pypdfium2) | [Samtec](https://suddendocs.samtec.com/notesandwhitepapers/dwct-28-01_datasheet.pdf) | `eb6dfba9244ebbca8ca9e28cd71a821b3bad4413ec1ccd5dcf0524b4cda9525a` | Téléchargé le 19/11/2026 ; ordre de grandeur pour la fiche `fil-dupont` |
| `nxp-an4731-injection-courant-rev2.pdf` | Understanding Injection Current on NXP Automotive Microcontrollers, note d'application AN4731 rév. 2 (23 pages, 12/2017) | [NXP](https://www.nxp.com/docs/en/application-note/AN4731.pdf) | `93aa8f927a0c9233970c632e2d09de2c40494b20964f856fbffad419fd99c047` | Téléchargé le 19/11/2026 ; chute de tension des diodes de protection des broches (fiches `esp32` et `tmc2209`), faute de donnée chez Espressif et Trinamic |
| `rpi5-product-brief.pdf` | Raspberry Pi 5 Product Brief (7 pages, novembre 2026) | [Raspberry Pi](https://datasheets.raspberrypi.com/rpi5/raspberry-pi-5-product-brief.pdf) | `f1ca525452e6fa4e9592a6705e41fb811bf12709d0605fd7cc2099c1b25534f3` | Téléchargé le 20/11/2026 ; source de la fiche `raspberry-pi-5` (alimentation, température) |
| `cm5-datasheet-rev7.pdf` | Raspberry Pi Compute Module 5 Datasheet (38 pages) | [Raspberry Pi](https://datasheets.raspberrypi.com/cm5/cm5-datasheet.pdf) | `80070fefd8db6e8abc6e146c8b7b5fb318ba129cc1e28826936d547fde79c863` | Téléchargé le 20/11/2026 ; limites et niveaux des GPIO de la fiche `raspberry-pi-5` (même puce RP1 que la Pi 5 : la Pi 5 n'a pas de datasheet électrique publiée) |
| `rp1-peripherals.pdf` | Raspberry Pi RP1 Peripherals (93 pages) | [Raspberry Pi](https://datasheets.raspberrypi.com/rp1/rp1-peripherals.pdf) | `87fb7b24e8d9add075b849d095a107827610c0409ea194785af624c1ea986c3d` | Téléchargé le 20/11/2026 ; plots des GPIO (fiche `raspberry-pi-5`) |
| `ti-lmd18245-snvs110e.pdf` | LMD18245 3A, 55V DMOS Full-Bridge Motor Driver, SNVS110E (30 pages, rév. 04/2013) | [Texas Instruments](https://www.ti.com/lit/ds/symlink/lmd18245.pdf) | `3b05f4e2c11e92e302dd8be0dd6db4412b8344e5caaf9887f8828b31c7f866d3` | Téléchargé le 19/11/2026 ; chute de tension des diodes internes d'un pont en H (fiche `tmc2209`), faute de donnée chez Trinamic |
