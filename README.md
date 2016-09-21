# tucanveranstaltungswatcher
## Beschreibung
Ziel dieses Tools ist es, Schnittstellenkurse zu identifizieren, zu denen es keine TUCaN-Veranstaltung mehr gibt. 

Getestet werden alle Kurse, die eine idnumber haben. Das Skript versucht aus shortname/fullname eine TUCaN-Veranstaltungsnummer zu extrahieren. 
Anschließend wird damit und dem Semester (abgeleitet aus Kurskategorie) auf TUCaN nach Veranstaltungen gesucht. 
Die Links der Treffer werden darauf geprüft, ob sie die idnumber enthalten. Ist dies der Fall gelten sie als 'intakt'.

## Installation
1. node.js installieren: https://nodejs.org/en/
2. im Verzeichnis npm install ausführen
3. das Moodle-Plugin littlehelpers installieren: https://github.com/eLearning-TUDarmstadt/moodle-local_littlehelpers

## Konfiguration
Die Konfiguration erfolgt oben in der Datei index.js

## Ausführung
Starten lässt sich das Tool über
´´´
npm start 'derMoodleUsername' 'dasPasswort'
´´´
starten. Der genutzt Account muss systemweit Course Creator oder Administrator sein.

Die Ausführung kann mit Strg+C unterbrochen werden. Je nach Einstellung macht das Tool beim nächsten Mal mit den ungeprüften oder kaputten Kursen weiter
und überspringt bereits geprüfte Kurse.

Fehler "Error: .wait() timed out after 2000msec" können ignoriert werden. Sie deuten darauf hin, dass die TUCaN-Suche ergebnislos war.

Der Fortschritt/das Ergebnis lässt sich mit der Datei index.html verfolgen.