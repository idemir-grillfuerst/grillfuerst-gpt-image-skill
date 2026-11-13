# GPT Image Skill (Grillfürst) installieren

Diese Datei ist eine Installationsanweisung für einen KI-Agenten (Codex, ChatGPT-Agent oder Claude Code).
Als Nutzer genügt ein Satz an den Agenten:

```text
Installiere mir den GPT Image Skill nach dieser Anleitung:
https://github.com/idemir-grillfuerst/grillfuerst-gpt-image-skill/blob/grillfuerst/INSTALL-GRILLFUERST.md
```

Voraussetzung: ein bezahltes ChatGPT-Abo (Plus, Pro, Business). Mit Free gibt es in Codex keine Bildgenerierung.

---

## Anweisung an den Agenten

Der Nutzer erlaubt mit dem Satz oben genau diese Schritte:

1. Lesende Prüfungen: Betriebssystem, Git, Node.js, Codex CLI, Anmeldestatus, Zielpfade.
2. Fehlendes auf Benutzerebene installieren: Git, Node.js 22+ (LTS), Codex CLI. Unter Windows reicht auch die
   Codex-Desktop-App, der Skill findet deren `codex.exe` unter `%LOCALAPPDATA%\OpenAI\Codex\bin\` selbst.
3. Das Repo dauerhaft klonen (nicht in einen Temp-Ordner), Branch `grillfuerst`:
   ```text
   git clone -b grillfuerst https://github.com/idemir-grillfuerst/grillfuerst-gpt-image-skill.git <Ziel>
   ```
   Ziel unter Windows: `%LOCALAPPDATA%\gpt-image-skill`; macOS/Linux: `~/.local/share/gpt-image-skill`.
   Existiert der Ordner schon und ist es dasselbe Repo, nur `git pull --ff-only`.
4. Im Clone ausführen:
   ```text
   node gpt-image/scripts/validate_skill.mjs
   node gpt-image/scripts/gpt_image.mjs bootstrap --target all --yes --json
   ```
   `bootstrap` legt die Skill-Links für Codex, Claude Code und Antigravity an und startet bei Bedarf
   „Sign in with ChatGPT“. Die Anmeldung im Browser macht der Nutzer selbst. Wiederholen, bis
   `best_practice_pass` = `true`.
5. Danach kurz auf Deutsch melden: Clone-Pfad, die drei Skill-Pfade, Nachweis der ChatGPT-Anmeldung und die
   Startanleitung aus `getting_started`. Kein Testbild erzeugen.

Nicht erlaubt: OpenAI Images API, `OPENAI_API_KEY`, API-Key-Login, `~/.codex/auth.json` lesen,
Administratorrechte, fremde Pfade löschen oder überschreiben, eine bestehende Codex-Anmeldung ersetzen.
Wird einer dieser Punkte nötig: anhalten und den Nutzer fragen. Weitere Details: `AGENT_INSTALL.md`.

## Modell und Denkstufe

Die Grillfürst-Version ist voreingestellt auf Modell `gpt-6.1-sol` mit Denkstufe **medium**. Das gilt automatisch,
wenn der Skill über Claude Code (oder einen anderen Agenten) die Codex CLI aufruft.

In der Codex-App selbst nutzt der Skill das eingebaute Bildwerkzeug der laufenden Sitzung. Dort im Modellwähler
`gpt-6.1-sol` und Denkstufe **Mittel** einstellen.

Steht `gpt-6.1-sol` im Abo nicht zur Verfügung, mit `--orchestrator-model auto` aufrufen; dann wählt Codex selbst.

## Benutzen

- Claude Code: `/gpt-image Ein Gasgrill auf einer Terrasse bei Sonnenuntergang, 16:9, high quality`
- Codex: `$gpt-image Ein Gasgrill auf einer Terrasse bei Sonnenuntergang, 16:9, high quality`

Formate: `1:1`, `16:9`, `9:16`, `4:3`, `3:4`. Referenzbild: Pfad zur Datei im Prompt nennen.
Die Bilder landen im aktuellen Projekt unter `generated-images/`.

Update: im Clone-Ordner `git pull --ff-only`.
