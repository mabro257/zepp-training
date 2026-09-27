# Trainingssteuerung – Zepp-Daten auf Netlify

Holt täglich deine Workouts aus der **inoffiziellen** Zepp/Huami-Cloud-API, speichert sie in Netlify Blobs und zeigt ein Dashboard für Laufen, Laufband, Rad draußen und Indoor-Cycling.

## Aufbau

| Teil | Datei | Aufgabe |
|---|---|---|
| Täglicher Sync | `netlify/functions/sync-scheduled.mjs` | 04:00 UTC, holt Workouts, Pulsverläufe sowie Schlaf, Ruhepuls und Schritte je Tag |
| Manueller Sync | `netlify/functions/sync-now.mjs` | `/api/sync?key=<SYNC_KEY>`, für den Erstimport |
| Daten-API | `netlify/functions/data.mjs` | `/api/data`, öffentlich, nur Kennzahlen (kein GPS, kein Ort) |
| App | `public/index.html` | Mobile-first mit 4 Reitern: Heute, Einheiten (inkl. Detailansicht), Fortschritt, Analyse |
| Zepp-Client | `lib/zepp.mjs` | API-Aufrufe, Normalisierung, Pulsverlauf-Parser |

## Einrichtung

1. Repo auf GitHub pushen, in Netlify „Add new site → Import from Git“.
2. **Environment Variables** (Site configuration → Environment variables):

   | Variable | Pflicht | Wert |
   |---|---|---|
   | `ZEPP_APP_TOKEN` | ja | Cookie `apptoken` (siehe unten) |
   | `SYNC_KEY` | ja | beliebiger langer Zufallsstring, schützt `/api/sync` |
   | `ZEPP_USER_ID` | nein | wird beim ersten Sync automatisch ermittelt |
   | `ZEPP_API_HOST` | nein | Standard `https://api-mifit.huami.com` |

3. Deploy auslösen.
4. Erstimport: `https://<deine-site>.netlify.app/api/sync?key=<SYNC_KEY>` aufrufen. Pro Aufruf werden die Workout-Liste komplett und die Pulsverläufe für ca. 20 Sekunden geladen. So oft wiederholen, bis `detailsPending` = 0 ist. Danach reicht der tägliche Sync.

### apptoken holen

1. https://user.huami.com/privacy2/index.html öffnen und mit dem Zepp-Account einloggen.
2. DevTools → Application → Cookies → Wert von `apptoken` kopieren.

Das Token läuft nach einiger Zeit ab. Das Dashboard zeigt dann einen Hinweis. Neues Token eintragen, neu deployen (Env-Änderungen greifen erst nach Deploy), `/api/sync?key=…` aufrufen.

## Reiter

- **Heute:** Bereitschaft (Ruhepuls, Schlaf, Form, Akut/Chronisch), konkrete Trainingsempfehlung mit Pulsbereichen, Ausblick auf die nächsten 3 Tage, persönliche Leitplanken, eigene Pulszonen, Wochenvergleich.
- **Einheiten:** Liste nach Wochen, Filter je Sportart. Antippen öffnet die Detailansicht: Kennzahlen, Pulsverlauf mit Zonen, Zeit in Zonen, Zustand am Tag (Ruhepuls, Schlaf, Form) und Vergleich mit ähnlichen Einheiten plus automatische Einordnung.
- **Fortschritt:** Fitness/Ermüdung/Form, Wochenumfang, Laufökonomie, VO₂max, Intensitätsverteilung, Fitness vs. Ruhepuls.
- **Analyse:** Zusammenhänge, Belastung und Ruhepuls, Schlaf, Erholung nach harten Tagen, Einflüsse auf die Laufökonomie.

Laufband (Sporttyp 8/11) ist kein Trainingsfokus: Es zählt zur Gesamtbelastung, erscheint aber nur unter „Sonstiges“.

## Trainingsempfehlung

Die Empfehlung für heute kombiniert:
- **Bereitschaft** (Ruhepuls und Schlaf gegen deinen Basiswert, Form, Belastungssprung)
- **Abstand zur letzten harten Einheit** gegen deine **persönliche Erholungszeit** (aus dem Ruhepuls nach harten Tagen)
- **Harte Einheiten der Woche** (max. 2) und **Wochenziel** (Belastung 8 % über Fitnessniveau, Entlastung bei Belastungssprung, stark negativer Form oder steigendem Ruhepuls)
- **Laufumfang** gegen die 10-%-Grenze und Beinbelastung der letzten 3 Tage → Laufen oder Rad
- **Intensitätsverteilung und Ökonomie-Trend** → Art der Qualitätseinheit (Schwelle, VO₂max, Tempo)
- **Deine typischen Einheitsdauern** der letzten 8 Wochen und **deine Pulszonen in bpm**

Die Pulszonen beziehen sich auf den Maximalpuls. Die Empfehlung ersetzt kein Körpergefühl.

## Pulsparameter (automatisch aus Messwerten)

- **Max. Puls:** höchster plausibler Workout-Maximalpuls der letzten 2 Jahre. Ein Wert zählt nur, wenn ein zweiter Wert höchstens 5 bpm darunter liegt, einzelne Sensor-Ausreißer fallen so raus. Getrennt für Laufen und Rad, sobald je Sportart mindestens 8 Einheiten vorliegen (Rad-HRmax liegt meist 5–10 bpm unter Lauf-HRmax).
- **Ruhepuls:** Median des Nacht-Ruhepulses der Uhr über die 30 Tage vor dem jeweiligen Workout. Die Belastung historischer Einheiten wird also mit dem damaligen Ruhepuls berechnet.
- Einschränkung: Wer nie ans Limit geht, bekommt einen zu niedrigen Max. Puls, Zonen erscheinen dann zu hoch.

## Kombinierte Auswertungen

| Auswertung | Kombiniert | Aussage |
|---|---|---|
| Bereitschaft heute | Ruhepuls und Schlaf vs. eigener 30-Tage-Basiswert, Form, Akut/Chronisch | Empfehlung: hart, normal, locker oder Ruhetag, mit Begründung |
| Erholung nach harten Tagen | Tagesbelastung (oberste 20 %) × Ruhepuls der 1.–3. Folgenacht vs. Ruhetage | Wie lange du zur Erholung brauchst, Mindestabstand harter Einheiten |
| Schlaf nach harten Tagen | Tagesbelastung × Schlafdauer der Folgenacht | Ob Training den Schlaf stört |
| Schlaf / Ruhepuls / Form → Laufökonomie | Zustand am Lauftag × Ökonomie relativ zum eigenen Trend | Welche Faktoren deine Laufleistung messbar senken |
| Anpassung über 6 Wochen | Fitness-Entwicklung × Ruhepuls-Entwicklung | Anpassung, Überlastung, Stress/Infekt oder Detraining |
| Monotonie | Streuung der Tagesbelastung × Ruhepuls | Zu gleichförmige Wochen ohne echte Ruhetage |
| Intensität und Fortschritt | Zonenverteilung × Entwicklung der Laufökonomie | Ob die Intensitätsverteilung Fortschritt bringt |

Jeder Zusammenhang wird mit einem Welch-Test geprüft und als **belastbar** (|t| ≥ 2, ca. 95 %) oder **Tendenz** markiert, inklusive Fallzahl. Unter 4–5 Fällen je Gruppe wird nichts angezeigt.

## Kennzahlen

- **Belastung:** TRIMP nach Banister (Männer-Koeffizient 1,92) mit den oben abgeleiteten Pulsparametern. Mit Pulsverlauf sekundengenau, sonst aus Ø-Puls geschätzt (in der Tabelle mit * markiert).
- **Fitness / Ermüdung / Form:** exponentiell gleitende Mittel der Tagesbelastung über 42 bzw. 7 Tage, Form = Fitness − Ermüdung (Vortag).
- **Akut/Chronisch:** Ø Belastung 7 Tage / Ø 28 Tage. 0,8–1,3 gilt als sicherer Bereich, über 1,5 als Belastungssprung.
- **Zonen:** % des max. Pulses: Z1 < 60, Z2 60–70, Z3 70–80, Z4 80–90, Z5 ≥ 90.
- **Laufökonomie:** Meter pro Minute ÷ Ø-Puls, nur Läufe draußen. „vs. Trend“ = Abweichung vom Median der 10 vorherigen Läufe.
- **Tageszuordnung:** Schlaf und Ruhepuls gehören zum Datum des Aufwachens. Die Nacht nach einem Training am Montag ist also der Dienstag.

## Bekannte Unsicherheiten

- Die API ist undokumentiert und kann sich jederzeit ändern.
- Paginierung der Workout-Liste, das Format des Pulsverlaufs und die Felder der Tageswerte (`slp.rhr`, Schlafphasen) (`heart_rate` in `run/detail.json`) sind aus Community-Projekten abgeleitet. Liefert der Parser Unplausibles, bleibt `hrBins` leer und die Belastung wird aus dem Ø-Puls geschätzt.
- Sporttyp-Codes: 1 Laufen, 8/11 Laufband, 9 Rad draußen, 10 Indoor-Cycling. Andere landen unter „Sonstiges“. Weitere Codes in `SPORTS` in `public/index.html` ergänzen.

## Lokal testen

`public/index.html?demo` zeigt das Dashboard mit Beispieldaten. Mit Backend: `npm i && npx netlify dev`.
