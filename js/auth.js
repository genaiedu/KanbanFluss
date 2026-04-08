// js/auth.js — Authentifizierung (Lehrer normal, Schüler mit INI + Passwort)
import { S, getUser, saveUser } from './state.js';

const STUDENT_CFG_KEY = 'kf_student_config';

function getStudentConfig() {
  try { return JSON.parse(localStorage.getItem(STUDENT_CFG_KEY) || 'null'); } catch(e) { return null; }
}
function saveStudentConfig(cfg) {
  localStorage.setItem(STUDENT_CFG_KEY, JSON.stringify(cfg));
}

// ── APP STARTEN ──────────────────────────────────────────
window.initApp = function() {
  document.getElementById('loading-screen').style.display = 'none';
  const isStudent = sessionStorage.getItem('kf_role') === 'schueler';

  if (isStudent) {
    initStudentAuth();
  } else {
    // Lehrer: immer Login-Formular zeigen (Passwort für Hash B nötig)
    const user = getUser();
    const screen = document.getElementById('auth-screen');
    screen.style.display = 'flex';
    // Gespeicherte Werte vorausfüllen
    const nameEl  = document.getElementById('teacher-login-name');
    const emailEl = document.getElementById('teacher-login-email');
    if (nameEl  && user.displayName)   nameEl.value  = user.displayName;
    if (emailEl && user.teacherEmail)  emailEl.value = user.teacherEmail;
    setTimeout(() => {
      const focus = user.teacherEmail
        ? document.getElementById('teacher-login-pw')
        : document.getElementById('teacher-login-name');
      if (focus) focus.focus();
    }, 100);
  }
};

// ── SCHÜLER-AUTHENTIFIZIERUNG ────────────────────────────
async function initStudentAuth() {
  document.getElementById('student-auth-screen').style.display = 'flex';
  const config = getStudentConfig();
  if (!config) {
    await showTeacherSelection();
  } else {
    showStudentLogin(config);
  }
}

// Gespeichertes INI-Objekt während der Registrierung
let _pendingIni = null;

async function showTeacherSelection() {
  _setStudentStep('teacher');
  _pendingIni = null;
  const errEl = document.getElementById('ini-load-error');
  if (errEl) errEl.textContent = '';
  const input = document.getElementById('ini-file-input');
  if (input) input.value = '';
}

// Wird vom <input type="file"> aufgerufen
window.loadIniFromFile = async function(event) {
  const file  = event.target.files[0];
  const errEl = document.getElementById('ini-load-error');
  errEl.textContent = '';
  if (!file) return;

  try {
    const text   = await file.text();
    const iniObj = JSON.parse(text);
    if (!iniObj.kanbanfluss_ini) throw new Error('Keine gültige KanbanFluss-INI-Datei.');

    _pendingIni = iniObj;
    _setStudentStep('register');
    document.getElementById('student-teacher-label').textContent = iniObj.teacherName || file.name.replace(/\.ini$/i,'');
    document.getElementById('student-reg-error').textContent     = '';
    setTimeout(() => document.getElementById('student-reg-name').focus(), 100);
  } catch(e) {
    errEl.textContent = 'Fehler: ' + e.message;
    event.target.value = '';
  }
};

window.submitStudentRegister = async function() {
  const name  = document.getElementById('student-reg-name').value.trim();
  const pw    = document.getElementById('student-reg-pw').value;
  const pw2   = document.getElementById('student-reg-pw2').value;
  const errEl = document.getElementById('student-reg-error');
  errEl.textContent = '';

  if (!_pendingIni)  { errEl.textContent = 'Bitte zuerst die INI-Datei auswählen.'; return; }
  if (!name)         { errEl.textContent = 'Bitte Namen eingeben.'; return; }
  if (pw.length < 4) { errEl.textContent = 'Passwort muss mindestens 4 Zeichen haben.'; return; }
  if (pw !== pw2)    { errEl.textContent = 'Passwörter stimmen nicht überein.'; return; }

  const btn = document.getElementById('student-reg-submit');
  btn.disabled = true; btn.textContent = 'Wird eingerichtet…';

  try {
    const iniObj      = _pendingIni;
    const teacherName = iniObj.teacherName;
    const teacherID   = iniObj.teacherID || null;
    const verifyToken = await window.kfCrypto.createToken(pw);

    let pupilID = null;
    if (teacherID && window.fbStudentAuth) {
      try {
        const fb = await window.fbStudentAuth(name, pw, teacherID);
        pupilID = fb.uid;
      } catch(fbErr) {
        console.warn('Firebase-Auth fehlgeschlagen (offline?):', fbErr.message);
      }
    }

    saveStudentConfig({ teacherName, publicKeyJwk: iniObj.publicKey, verifyToken, teacherID, pupilID });
    saveUser({ displayName: name, groupId: '' });

    window._kfSession = {
      studentPassword: pw, teacherPublicKeyJwk: iniObj.publicKey,
      teacherName, teacherID, pupilID, isStudent: true
    };
    enterApp(getUser(), true);
  } catch(e) {
    errEl.textContent = 'Fehler: ' + e.message;
    btn.disabled = false; btn.textContent = 'Anmelden';
  }
};

function showStudentLogin(config) {
  _setStudentStep('login');
  const user = getUser();
  document.getElementById('student-login-username').textContent = user.displayName || '–';
  document.getElementById('student-login-teacher').textContent  = config.teacherName;
  document.getElementById('student-login-error').textContent    = '';
  setTimeout(() => document.getElementById('student-login-pw').focus(), 100);
}

window.submitStudentLogin = async function() {
  const config = getStudentConfig();
  const pw     = document.getElementById('student-login-pw').value;
  const errEl  = document.getElementById('student-login-error');
  errEl.textContent = '';
  if (!pw) { errEl.textContent = 'Bitte Passwort eingeben.'; return; }

  const btn = document.getElementById('student-login-submit');
  btn.disabled = true; btn.textContent = 'Prüfe…';

  const ok = await window.kfCrypto.checkToken(config.verifyToken, pw);
  if (!ok) {
    errEl.textContent = 'Falsches Passwort.';
    btn.disabled = false; btn.textContent = 'Anmelden';
    return;
  }

  const user = getUser();
  let { teacherID, pupilID } = config;

  // Firebase-Login im Hintergrund (falls teacherID bekannt)
  if (teacherID && window.fbStudentAuth) {
    try {
      const fb = await window.fbStudentAuth(user.displayName, pw, teacherID);
      pupilID = fb.uid;
      // pupilID in Config persistieren falls neu
      if (fb.uid !== config.pupilID) saveStudentConfig({ ...config, pupilID: fb.uid });
    } catch(fbErr) {
      console.warn('Firebase-Auth fehlgeschlagen (offline?):', fbErr.message);
    }
  }

  window._kfSession = {
    studentPassword: pw, teacherPublicKeyJwk: config.publicKeyJwk,
    teacherName: config.teacherName, teacherID, pupilID, isStudent: true
  };
  enterApp(user, true);
};

window.resetStudentAuth = async function() {
  const ok = await showConfirm(
    'Neu anmelden?\n\nDeine Boards bleiben gespeichert, aber du musst einen neuen Lehrer auswählen und ein neues Passwort setzen.',
    'Ja, neu anmelden', 'Abbrechen'
  );
  if (!ok) return;
  localStorage.removeItem(STUDENT_CFG_KEY);
  window._kfSession = null;
  await showTeacherSelection();
};

function _setStudentStep(step) {
  ['teacher','register','login'].forEach(s => {
    const el = document.getElementById(`student-step-${s}`);
    if (el) el.style.display = s === step ? 'block' : 'none';
  });
}

// ── LEHRER: FIREBASE-LOGIN (einmalig, danach automatisch) ──
window.teacherLogin = async function() {
  const name  = document.getElementById('teacher-login-name')?.value.trim();
  const email = document.getElementById('teacher-login-email')?.value.trim().toLowerCase();
  const pw    = document.getElementById('teacher-login-pw')?.value;
  const errEl = document.getElementById('profile-error');
  if (errEl) errEl.textContent = '';

  if (!name)         { if (errEl) errEl.textContent = 'Bitte Namen eingeben.'; return; }
  if (!email)        { if (errEl) errEl.textContent = 'Bitte E-Mail eingeben.'; return; }
  if (pw.length < 6) { if (errEl) errEl.textContent = 'Passwort: mindestens 6 Zeichen.'; return; }

  const btn = document.getElementById('teacher-login-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Verbinde…'; }

  try {
    // Passwort-Splitting: Hash A → Firebase, Hash B → Verschlüsselung (bleibt lokal)
    const [hashA, hashB] = await Promise.all([
      window.fbDeriveAuthKey(pw, email),
      window.fbDeriveEncKey(pw, email),
    ]);

    // Firebase-Login oder automatische Registrierung
    const uid = await window.fbTeacherAuth(email, hashA);

    // INI aus Firebase laden — oder neu erstellen (erster Start)
    let iniObj;
    if (await window.fbIniExists(uid)) {
      const iniJson = await window.fbDownloadIni(uid);
      iniObj = JSON.parse(iniJson);
      // Passwort durch Entschlüsselung prüfen
      try { await window.kfCrypto.getPrivKeyFromIni(iniObj, hashB); }
      catch(_) { throw new Error('Falsches Passwort.'); }
    } else {
      // Erster Start: RSA-Schlüsselpaar + INI erstellen und hochladen
      const iniJson = await window.kfCrypto.createIni(name, hashB, uid);
      iniObj = JSON.parse(iniJson);
      await window.fbUploadIni(iniJson, uid);
    }

    // Session einrichten — kein weiteres Passwort nötig für diese Sitzung
    window._loadedIni = iniObj;
    if (typeof window.setTeacherSessionKey === 'function') window.setTeacherSessionKey(hashB);

    const user = { displayName: name, groupId: 'default', teacherEmail: email };
    saveUser(user);
    enterApp(user, false);
  } catch(e) {
    const msg = e.code === 'auth/wrong-password' ? 'Falsches Passwort.'
              : e.code === 'auth/too-many-requests' ? 'Zu viele Versuche. Bitte kurz warten.'
              : e.message;
    if (errEl) errEl.textContent = 'Fehler: ' + msg;
    if (btn) { btn.disabled = false; btn.textContent = 'Anmelden'; }
  }
};

// ── IN DIE APP WECHSELN ──────────────────────────────────
function enterApp(user, isStudent) {
  S.currentUser = user;

  const ss = document.getElementById('student-auth-screen');
  if (ss) ss.style.display = 'none';
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app-screen').classList.add('visible');

  const nameDisplay  = document.getElementById('user-name-display');
  const groupDisplay = document.getElementById('sidebar-user-group');
  if (nameDisplay)  nameDisplay.textContent  = user.displayName || 'Nutzer';
  if (groupDisplay) groupDisplay.textContent = user.groupId || '';

  const teacherGrid = document.getElementById('sidebar-teacher-grid');
  const sendBtn     = document.getElementById('sidebar-send-btn');
  const badge       = document.getElementById('sidebar-role-badge');

  if (isStudent) {
    if (teacherGrid) teacherGrid.style.display = 'none';
    // "An Lehrkraft senden" nur zeigen wenn teacherID bekannt
    if (sendBtn) sendBtn.style.display = window._kfSession?.teacherID ? '' : 'none';
    if (badge) {
      badge.textContent = 'Schüler';
      badge.style.background = 'rgba(34,197,94,0.15)';
      badge.style.color = '#4ade80';
      badge.style.borderColor = 'rgba(34,197,94,0.35)';
    }
    S.isAdminMode = false;
  } else {
    if (teacherGrid) teacherGrid.style.display = 'grid';
    if (sendBtn)     sendBtn.style.display     = 'none';
    if (badge) {
      badge.textContent = 'Lehrkraft';
      badge.style.background = 'rgba(99,102,241,0.2)';
      badge.style.color = '#818cf8';
      badge.style.borderColor = 'rgba(99,102,241,0.35)';
    }
    S.isAdminMode = true;
  }

  const sidebar = document.getElementById('sidebar-el');
  if (sidebar) {
    sidebar.classList.remove('collapsed');
    if (typeof setAllGrips === 'function') setAllGrips('260px');
  }

  if (typeof loadSavedBg      === 'function') loadSavedBg();
  if (typeof loadSavedOverlay === 'function') loadSavedOverlay();
  if (typeof loadSavedTheme   === 'function') loadSavedTheme();
  if (typeof loadImageCount   === 'function') loadImageCount();
  if (typeof loadAgingUnit    === 'function') loadAgingUnit();
  if (typeof loadBoards       === 'function') loadBoards();
}

// ── PROFIL BEARBEITEN (Lehrer) ────────────────────────────
window.openProfileEdit = function() {
  const user  = getUser();
  const modal = document.getElementById('modal-profile-edit');
  if (!modal) return;
  document.getElementById('edit-profile-name').value  = user.displayName || '';
  document.getElementById('edit-profile-group').value = user.groupId || '';
  modal.style.display = 'flex';
};

window.saveProfileEdit = function() {
  const name  = document.getElementById('edit-profile-name')?.value.trim()  || '';
  const group = document.getElementById('edit-profile-group')?.value.trim() || '';
  if (!name) return;
  const user = { displayName: name, groupId: group || 'default' };
  saveUser(user);
  S.currentUser = user;
  const nd = document.getElementById('user-name-display');
  const gd = document.getElementById('sidebar-user-group');
  if (nd) nd.textContent = name;
  if (gd) gd.textContent = group;
  closeModal('modal-profile-edit');
  showToast('Profil gespeichert');
};

// ── INI-DATEI LADEN (jederzeit zugänglich) ────────────────
window.loadTeacherIni = async function() {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.ini,.json';
  input.style.display = 'none';
  document.body.appendChild(input);

  const iniObj = await new Promise(resolve => {
    input.onchange = async (e) => {
      const f = e.target.files[0];
      document.body.removeChild(input);
      if (!f) { resolve(null); return; }
      try {
        const obj = JSON.parse(await f.text());
        resolve(obj.kanbanfluss_ini ? obj : null);
      } catch(e) { resolve(null); }
    };
    input.click();
  });

  if (!iniObj) { showToast('Keine gültige INI-Datei.', 'error'); return; }

  // Für Lehrer: für nächsten Import merken (kein erneuter Upload nötig)
  window._loadedIni = iniObj;

  const session = window._kfSession;
  if (session?.isStudent) {
    // Für Schüler: Lehrer-Schlüssel aktualisieren (z.B. anderer Lehrer)
    session.teacherPublicKeyJwk = iniObj.publicKey;
    session.teacherName = iniObj.teacherName;
    const cfg = getStudentConfig() || {};
    cfg.publicKeyJwk = iniObj.publicKey;
    cfg.teacherName = iniObj.teacherName;
    saveStudentConfig(cfg);
  }

  showToast(`INI von "${iniObj.teacherName || 'Lehrer'}" geladen`);
};

// ── ABMELDEN (zurück zum Begrüßungsbildschirm, alle Daten löschen) ──
window.logoutUser = async function() {
  const isStudent = window._kfSession?.isStudent;
  const ok = await showConfirm(
    '⚠️ Abmelden?\n\nAlle Boards und Daten werden von diesem Gerät gelöscht.\nVorher exportieren falls nötig!',
    'Ja, abmelden & löschen', 'Abbrechen'
  );
  if (!ok) return;

  // Alle Daten löschen
  localStorage.removeItem('kf_user');
  localStorage.removeItem('kanban_data');
  localStorage.removeItem('kanban_settings');
  localStorage.removeItem(STUDENT_CFG_KEY);
  window._kfSession = null;
  if (typeof window.resetToolsSession === 'function') window.resetToolsSession();
  if (typeof window.fbSignOut === 'function') window.fbSignOut();

  document.getElementById('app-screen').classList.remove('visible');

  if (isStudent) {
    const ss = document.getElementById('student-auth-screen');
    ss.style.display = 'flex';
    _setStudentStep('teacher');
  } else {
    document.getElementById('auth-screen').style.display = 'flex';
    const el = document.getElementById('profile-name');
    if (el) { el.value = ''; setTimeout(() => el.focus(), 100); }
  }
};

// ── ENTER-TASTEN ──────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  [
    ['teacher-login-pw',  () => teacherLogin()],
    ['teacher-login-name',() => teacherLogin()],
    ['teacher-login-email',()=> teacherLogin()],
    ['edit-profile-name', () => saveProfileEdit()],
    ['student-login-pw',  () => submitStudentLogin()],
    ['student-reg-pw2',   () => submitStudentRegister()],
  ].forEach(([id, fn]) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('keydown', e => { if (e.key === 'Enter') fn(); });
  });
});
