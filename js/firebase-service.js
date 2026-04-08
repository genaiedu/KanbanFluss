// js/firebase-service.js — Zero-Knowledge Firebase-Dienste
// Nutzt Firebase für Auth, Storage und Firestore-Benachrichtigungen.
// Das lokale Passwort wird NIEMALS an Firebase übertragen (Zero-Knowledge).

import { initializeApp }
  from 'https://www.gstatic.com/firebasejs/10.14.0/firebase-app.js';
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut }
  from 'https://www.gstatic.com/firebasejs/10.14.0/firebase-auth.js';
import { getFirestore, doc, setDoc, getDoc, onSnapshot, serverTimestamp }
  from 'https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js';
import { getStorage, ref, uploadString, getDownloadURL, listAll }
  from 'https://www.gstatic.com/firebasejs/10.14.0/firebase-storage.js';

const _cfg = {
  apiKey:            'AIzaSyDbmsJsffbuKI0w_xIKoTMhg6zpvFbnXK0',
  authDomain:        'kamban-thomaeum.firebaseapp.com',
  projectId:         'kamban-thomaeum',
  storageBucket:     'kamban-thomaeum.firebasestorage.app',
  messagingSenderId: '879714830960',
  appId:             '1:879714830960:web:24780643fd1cccd42082b5',
};

const _app     = initializeApp(_cfg);
const _auth    = getAuth(_app);
const _db      = getFirestore(_app);
const _storage = getStorage(_app);

// ── Hash A: Firebase-Passwort ableiten (Zero-Knowledge)
// Das Original-Passwort (Hash B) bleibt lokal für die AES-Verschlüsselung.
async function _deriveFirebasePw(localPw, teacherID, username) {
  const enc = new TextEncoder();
  const km  = await crypto.subtle.importKey('raw', enc.encode(localPw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode('kf-auth|' + teacherID + '|' + username), iterations: 100000, hash: 'SHA-256' },
    km, 256
  );
  return Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function _sanitize(name) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20) || 'schueler';
}

// ── LEHRER: Firebase-Konto erstellen (einmalig)
window.fbTeacherRegister = async function(email, password) {
  const cred = await createUserWithEmailAndPassword(_auth, email, password);
  return cred.user.uid;
};

// ── LEHRER: Firebase-Login
window.fbTeacherLogin = async function(email, password) {
  const cred = await signInWithEmailAndPassword(_auth, email, password);
  return cred.user.uid;
};

// ── SCHÜLER: Firebase-Auth (Login oder automatische Registrierung)
// Leitet eine Fake-E-Mail und ein Hash-A-Passwort ab — beides nie lokal nutzbar.
window.fbStudentAuth = async function(username, localPw, teacherID) {
  const safe  = _sanitize(username);
  const email = `${safe}.${teacherID}@kanbanfluss.app`;
  const fbPw  = await _deriveFirebasePw(localPw, teacherID, safe);

  try {
    const cred = await signInWithEmailAndPassword(_auth, email, fbPw);
    return { uid: cred.user.uid, email };
  } catch(e) {
    if (['auth/user-not-found', 'auth/invalid-credential', 'auth/invalid-email'].includes(e.code)) {
      const cred = await createUserWithEmailAndPassword(_auth, email, fbPw);
      return { uid: cred.user.uid, email };
    }
    throw e;
  }
};

// ── SCHÜLER: Verschlüsseltes Board an Lehrkraft senden
window.fbSendToTeacher = async function(encryptedJson, teacherID, pupilID, schuelerName) {
  if (!_auth.currentUser) throw new Error('Nicht bei Firebase angemeldet.');
  await uploadString(ref(_storage, `briefkasten/${teacherID}/${pupilID}/schueler.enc`), encryptedJson);
  await setDoc(doc(_db, 'briefkaesten', teacherID, 'schueler', pupilID), {
    hatNeueDaten: true,
    schuelerName,
    gesendetAm: serverTimestamp(),
  });
};

// ── LEHRER: Alle Schülereinreichungen herunterladen
window.fbGetStudentBoards = async function(teacherID) {
  if (!_auth.currentUser) throw new Error('Nicht bei Firebase angemeldet.');
  const result = await listAll(ref(_storage, `briefkasten/${teacherID}`));
  const boards = [];
  for (const prefix of result.prefixes) {
    const pupilID = prefix.name;
    try {
      const url  = await getDownloadURL(ref(_storage, `briefkasten/${teacherID}/${pupilID}/schueler.enc`));
      const text = await fetch(url).then(r => r.text());
      const snap = await getDoc(doc(_db, 'briefkaesten', teacherID, 'schueler', pupilID));
      const meta = snap.exists() ? snap.data() : {};
      boards.push({ pupilID, encryptedJson: text, schuelerName: meta.schuelerName || pupilID });
    } catch(_) { /* Schüler ohne Datei überspringen */ }
  }
  return boards;
};

// ── LEHRER: Kommentiertes Board an Schüler zurückschicken
window.fbReturnToStudent = async function(encryptedJson, teacherID, pupilID) {
  if (!_auth.currentUser) throw new Error('Nicht bei Firebase angemeldet.');
  await uploadString(ref(_storage, `briefkasten/${teacherID}/${pupilID}/lehrer.enc`), encryptedJson);
  await setDoc(doc(_db, 'briefkaesten', teacherID, 'schueler', pupilID), {
    hatNeueAntwort: true,
    geantwortetAm:  serverTimestamp(),
  }, { merge: true });
};

// ── SCHÜLER: Auf Antwort der Lehrkraft lauschen (gibt unsubscribe zurück)
window.fbListenForReturn = function(teacherID, pupilID, onNewData) {
  return onSnapshot(doc(_db, 'briefkaesten', teacherID, 'schueler', pupilID), async snap => {
    if (!snap.exists() || !snap.data().hatNeueAntwort) return;
    try {
      const url  = await getDownloadURL(ref(_storage, `briefkasten/${teacherID}/${pupilID}/lehrer.enc`));
      const text = await fetch(url).then(r => r.text());
      onNewData(text);
    } catch(_) { /* noch keine Datei vorhanden */ }
  });
};

// ── Abmelden
window.fbSignOut = () => signOut(_auth).catch(() => {});

// ── Aktuell angemeldeter Nutzer
window.fbCurrentUser = () => _auth.currentUser;

console.log('Firebase-Service geladen ✓');
