# Spectra

(English below)

Spectra je spektrálno/mikrotonálne hudobné prostredie, ktoré umožňuje objavovať hudobné vzťahy a skutočnosti, ktoré by boli ťažko až takmer nedosiahnuteľné tradičnými nástrojmi.

Softvér je založený na jednoduchom princípe tvorby hudby od samotného zvuku k notám než opačne.

Pôvodný nápad vznikol v roku 2022 a prvý prototyp programu bol vytvorený počas leta 2024 v Helsinkách. V budúcnosti nie je vylúčené, že softvér by sa opäť prepísal do iného jazyku (ako Rust) pre zvýšenie stability a výkonu. Tým, že je založený na webovom rozhraní, je ho možné otvoriť priamo vo webových prehliadačoch.

### Funkcie

- Aditívna syntéza v reálnom čase
- Mikrotonálna podpora - vlastné ladiace systémy a vlastné spektrá
- Ladenie a časové delenie je nezávislé pre každú stopu a ich zmena v priebehu skladby je kedykoľvek možná
- Export do WAV a MusicXML pre notačné programy
- MIDI podpora
- OSC podpora pre vstup/výstup externých zariadení a programov

### Požiadavky

- Windows 10+, macOS 11+
- Node.js 18+ a npm (pre vývoj)

### Inštalácia

#### Zo súboru

Stiahnite inštalátor pre váš konkrétny operačný systém zo stránky [Releases](../../releases) a nainštalujte.

#### Z terminálu

Nutné nainštalovať Electron, a potom:

```bash
npm install
npm start
```

### Spustenie bez inštalácie

Ak už `npm install` v tomto adresári prebehol, potom:

```bash
npm start
```




---

## EN

Spectra is a spectral/microtonal music environment that lets you discover musical relationships and phenomena that would be difficult or nearly impossible to achieve with traditional tools.

The software is based on a simple premise of making music from sound itself to notes rather than the other way around.

The original idea came in 2022 and the first prototype was made during summer 2024 in Helsinki. In the future, it is not out of question that the software would be rewritten in another language (such as Rust) for increased stability and performance. Being based on web technologies, it can also be technically opened directly in web browsers.

### Features

- Real-time additive synthesis
- Microtonal support — custom tuning systems and custom spectra
- Tuning and time division are independent per track and can be changed at any point during a composition
- Export to WAV and MusicXML for notation software
- MIDI support
- OSC support for input/output of external devices and software

### Requirements

- Windows 10+, macOS 11+
- Node.js 18+ and npm (for development)

### Installation

#### From installer

Download the installer for your operating system from the [Releases](../../releases) page and install.

#### From terminal

First install Electron. Then:

```bash
npm install
npm start
```

### Running without installation

If `npm install` has already been run in this directory:

```bash
npm start
```


---

## Licencia / License

Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International (CC BY-NC-SA 4.0).
Copyright (c) 2024–2026 Patrik Herman.

Full terms in [LICENSE](LICENSE).

## Autor / Author

Patrik Herman
