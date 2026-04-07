#!/bin/bash
# KanbanFluss starten — Doppelklick genügt!
cd "$(dirname "$0")"
PORT=8080

# Prüfen ob der Port schon belegt ist
if lsof -ti tcp:$PORT > /dev/null 2>&1; then
  echo "Server läuft bereits auf Port $PORT"
else
  echo "Starte lokalen Webserver auf Port $PORT..."
  python3 -m http.server $PORT &>/dev/null &
  sleep 1
fi

URL="http://localhost:$PORT/app.html"
echo "Öffne KanbanFluss im Browser..."

# Chrome bevorzugen (unterstützt Speichern-Dialog beim Export)
if open -a "Google Chrome" "$URL" 2>/dev/null; then
  echo "Geöffnet in Google Chrome."
else
  open "$URL"
  echo "Geöffnet im Standard-Browser."
fi

echo ""
echo "KanbanFluss läuft auf $URL"
echo "Dieses Fenster kann offen bleiben (Server läuft im Hintergrund)."
echo "Zum Beenden: Strg+C"
wait
