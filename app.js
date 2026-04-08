// app.js — Einstiegspunkt: Importiert alle Module
// Die eigentliche Logik steckt jetzt in den Dateien unter js/

import './js/state.js?v=42';
import './js/helpers.js?v=42';
import './js/crypto.js?v=42';
import './js/settings.js?v=42';
import './js/auth.js?v=42';
import './js/boards.js?v=42';
import './js/columns.js?v=42';
import './js/cards.js?v=42';
import './js/admin.js?v=42';
import './js/grading.js?v=42';
import './js/tools.js?v=42';
import './js/ui.js?v=42';

// Dynamischer Import — App startet auch wenn Firebase-CDN nicht erreichbar ist
import('./js/firebase-service.js?v=42').catch(e => console.warn('Firebase nicht verfügbar (offline?):', e.message));

console.log('KanbanFluss: Alle Module geladen ✓');
