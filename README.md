# 🇫🇷 France Fire Tracker | Live Tactical HUD

![Licence MIT](https://img.shields.io/badge/Licence-MIT-blue.svg)
![Python](https://img.shields.io/badge/Python-3.10%2B-yellow.svg)
![Flask](https://img.shields.io/badge/Flask-2.x-green.svg)
![Leaflet](https://img.shields.io/badge/Leaflet-1.9.4-orange.svg)
![PWA Ready](https://img.shields.io/badge/PWA-Ready-brightgreen.svg)
![Maintenance](https://img.shields.io/badge/Maintained-Yes-cyan.svg)

**France Fire Tracker** est une application web de **supervision tactique en temps réel** (Live Tactical HUD) dédiée au suivi des incendies de forêt en France métropolitaine et en Corse. Conçue avec une interface sombre, fluide et immersive inspirée des centres de commandement opérationnels (SDIS / Sécurité Civile), elle intègre et croise en direct les données satellites de la NASA, les flux radar aéronautiques et les prévisions météorologiques locales.

---

## 🌐 Aperçu Opérationnel & Démo

* **Accès au direct :** [https://francefiretracker.me](https://francefiretracker.me)

L'application est **100 % responsive** et installable en tant que **Progressive Web App (PWA)** native sur smartphones (iOS et Android) pour un affichage plein écran sans barre de navigation.

---

## ⚡ Fonctionnalités Clés

### 🔥 1. Détection Satellite (NASA FIRMS) & Suivi des Foyers
* Acquisition continue des détections thermiques des satellites **VIIRS (Suomi-NPP, NOAA-20, NOAA-21)** et **MODIS**.
* Filtrage géographique précis sur la France métropolitaine et la Corse.
* Affichage sous forme de marqueurs tactiques (`🔥`) avec lueur dynamique selon le niveau de rayonnement thermique (FRP - *Fire Radiative Power*).
* Indication des horaires de passage satellites (dernier survol et prochain passage estimé).

### ✈️ 2. Radar Tactique Aérien (ADS-B Live)
* Suivi en temps réel des aéronefs d'intervention dans un rayon de **600 km** via **ADSB.fi**, **adsb.lol** et **OpenSky Network**.
* **Identification et priorisation des moyens tactiques :**
  * Bombardier d'eau Canadair CL-415 (`PELIC`)
  * Bombardier Dash 8 Q400 MR (`MILAN`)
  * Air Tractor AT-802 (`TRACT`)
  * Hélicoptères de secours Dragon (`DRAG`), Super Puma (`PUMA`), SAMU / Secours (`RESCU`)
  * Avions de transport tactique A400M Atlas (`BLADE`), C-130, etc.
* Trace GPS des trajectoires en vol avec surbrillance interactive.
* Fiche technique instantanée : altitude barométrique, vitesse sol, vario (ft/min), cap, immatriculation et squawk radar.

### 🛡️ 3. Cartographie & Périmètres Brûlés
* Rendu haute performance via **Leaflet avec accélération GPU (`preferCanvas: true`)** pour une fluidité à 60 FPS sans ralentissement, même lors de pics d'activité géospatiale.
* Algorithme de clustering géométrique pour modéliser les surfaces brûlées (estimation des hectares impactés).
* Calque interactif répertoriant **les bases aériennes, pélicandromes et aéroports stratégiques** de la Sécurité Civile (Nîmes-Garons, Marignane, Mérignac, Ajaccio, Bastia, Istres, etc.).

### 🌦️ 4. Module Météorologique Avancé
* **Flux de vent en temps réel :** Modélisation sur toile Canvas HTML5 des particules aérodynamiques selon la direction et la force du vent (API Open-Meteo).
* **Nuages & Radar Pluie satellitaire :** Intégration en direct des masses nuageuses et des précipitations via l'API **RainViewer** avec étirage automatique et gestion intelligente du zoom (`maxNativeZoom: 7`).
* Prévisions horaires glissantes sur 6 heures (température, humidité, vent, millimètres de pluie).

---

## 🛠️ Architecture & Technologies

* **Backend :** Python 3, Flask, Requests, ThreadPoolExecutor (traitements asynchrones des API externes).
* **Frontend :** HTML5, CSS3 (variables root, flexbox/grid, animations GPU), Javascript ES6+.
* **Cartographie :** Leaflet.js, tuiles CartoDB Dark Matter et Esri World Imagery (mode Satellite HD).
* **PWA :** Service Worker custom, manifest.json, cache offline-first pour les ressources statiques.
* **SEO :** Balises Open Graph, Twitter Cards, sitemap.xml, robots.txt et données structurées JSON-LD (`WebApplication`).

---

## 🚀 Installation & Déploiement Local

### Prérequis
* **Python 3.10** ou supérieur.
* Un navigateur web moderne avec support Canvas et Service Workers.

### 1. Cloner le dépôt
```bash
git clone https://github.com/ZeroxarZ/francefiretracker.git
cd france-fire-tracker