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
    const user = getUser();
    document.getElementById('auth-screen').style.display = 'flex';
    const nameEl  = document.getElementById('teacher-login-name');
    const emailEl = document.getElementById('teacher-login-email');
    if (nameEl  && user.displayName)  nameEl.value  = user.displayName;
    if (emailEl && user.teacherEmail) emailEl.value = user.teacherEmail;

    if (user.teacherEmail) {
      _showTeacherLogin(user);  // Wiederanmeldung: nur Passwort
    } else {
      _showTeacherRegister();   // Erstanmeldung: alle Felder
    }
  }
};

// ── LEHRER: Wiederanmeldung (nur Passwort) ───────────────
function _showTeacherLogin(user) {
  document.getElementById('teacher-name-group').style.display  = 'none';
  document.getElementById('teacher-email-group').style.display = 'none';
  document.getElementById('teacher-auth-title').textContent    = 'Willkommen zurück';
  document.getElementById('teacher-auth-subtitle').innerHTML   =
    `<strong>${user.displayName || ''}</strong> &middot; ${user.teacherEmail}`;
  document.getElementById('teacher-login-btn').textContent = 'Anmelden';
  document.getElementById('teacher-switch-link').style.display = '';
  document.getElementById('profile-error').textContent = '';
  setTimeout(() => document.getElementById('teacher-login-dbpw')?.focus(), 100);
}

// ── LEHRER: Erstanmeldung / Kontowechsel (alle Felder) ───
function _showTeacherRegister() {
  document.getElementById('teacher-name-group').style.display  = '';
  document.getElementById('teacher-email-group').style.display = '';
  document.getElementById('teacher-auth-title').textContent    = 'Konto einrichten';
  document.getElementById('teacher-auth-subtitle').textContent = 'Einmalige Einrichtung — danach automatisch.';
  document.getElementById('teacher-login-btn').textContent = 'Konto erstellen';
  document.getElementById('teacher-switch-link').style.display = 'none';
  document.getElementById('profile-error').textContent = '';
  setTimeout(() => document.getElementById('teacher-login-name')?.focus(), 100);
}

// Öffentlich — für "Anderes Konto"-Button
window.showTeacherRegister = function() {
  // Email + Name leeren damit kein altes Konto vorausgefüllt bleibt
  const nameEl  = document.getElementById('teacher-login-name');
  const emailEl = document.getElementById('teacher-login-email');
  if (nameEl)  nameEl.value  = '';
  if (emailEl) emailEl.value = '';
  _showTeacherRegister();
};

// ── SCHÜLER-AUTHENTIFIZIERUNG ────────────────────────────
async function initStudentAuth() {
  document.getElementById('student-auth-screen').style.display = 'flex';
  // Kennung vorausfüllen falls bekannt
  const config = getStudentConfig();
  const idEl   = document.getElementById('student-login-id');
  if (idEl && config?.studentID) idEl.value = config.studentID;
  document.getElementById('student-login-error').textContent = '';
  setTimeout(() => {
    const focus = config?.studentID
      ? document.getElementById('student-ini-input')
      : document.getElementById('student-login-id');
    if (focus) focus.focus?.();
  }, 100);
}

// ── INI-Datei auswählen (Schüler-Login — immer erforderlich)
let _pendingStudentIni = null;
window.loadStudentIni = async function(event) {
  const file = event.target.files[0];
  const statusEl = document.getElementById('student-ini-status');
  if (!file) return;
  try {
    const iniObj = JSON.parse(await file.text());
    if (!iniObj.kanbanfluss_ini) throw new Error('Keine gültige KanbanFluss-INI-Datei.');
    if (!iniObj.teacherID)       throw new Error('INI enthält keine teacherID — bitte neuere INI vom Lehrer holen.');
    _pendingStudentIni = iniObj;
    statusEl.style.color = '#4ade80';
    statusEl.textContent = `✓ INI von "${iniObj.teacherName || 'Lehrer'}" geladen`;
  } catch(e) {
    _pendingStudentIni = null;
    statusEl.style.color = '#ef4444';
    statusEl.textContent = '❌ ' + e.message;
    event.target.value = '';
  }
};

// ── SCHÜLER-LOGIN (einheitlicher Flow — jedes Mal INI + zwei Passwörter)
window.submitStudentLogin = async function() {
  const id       = document.getElementById('student-login-id').value.trim();
  const dbPw     = document.getElementById('student-login-dbpw').value;
  const cryptoPw = document.getElementById('student-login-cryptopw').value;
  const errEl    = document.getElementById('student-login-error');
  errEl.textContent = '';

  if (!id)                  { errEl.textContent = 'Bitte Kennung eingeben.'; return; }
  if (!_pendingStudentIni)  { errEl.textContent = 'Bitte INI-Datei des Lehrers auswählen.'; return; }
  if (!dbPw)                { errEl.textContent = 'Bitte Datenbankpasswort eingeben.'; return; }
  if (!cryptoPw)            { errEl.textContent = 'Bitte Cryptopasswort eingeben.'; return; }

  const btn = document.getElementById('student-login-submit');
  btn.disabled = true; btn.textContent = 'Verbinde…';

  try {
    const iniObj    = _pendingStudentIni;
    const teacherID = iniObj.teacherID;

    // Firebase-Auth (Account wird beim ersten Mal automatisch angelegt)
    const fbResult = await window.fbStudentAuth(id, dbPw, teacherID);
    const pupilID  = fbResult.uid;

    // Kennung lokal speichern (für Vorausfüllen beim nächsten Login)
    saveStudentConfig({ studentID: id, teacherID, teacherName: iniObj.teacherName,
      publicKeyJwk: iniObj.publicKey, pupilID });
    saveUser({ displayName: id, groupId: '' });

    // Session — cryptoPw bleibt lokal, verlässt nie das Gerät
    window._kfSession = {
      studentPassword:      cryptoPw,
      teacherPublicKeyJwk:  iniObj.publicKey,
      teacherName:          iniObj.teacherName,
      teacherID, pupilID,   isStudent: true
    };
    enterApp(getUser(), true);
  } catch(e) {
    errEl.textContent = 'Fehler: ' + e.message;
    btn.disabled = false; btn.textContent = 'Anmelden';
  }
};

// ── LEHRER: LOGIN (DB-Passwort für Firebase, Crypto-Passwort für INI) ──
window.teacherLogin = async function() {
  const name     = document.getElementById('teacher-login-name')?.value.trim();
  const email    = document.getElementById('teacher-login-email')?.value.trim().toLowerCase();
  const dbPw     = document.getElementById('teacher-login-dbpw')?.value ?? '';
  const cryptoPw = document.getElementById('teacher-login-cryptopw')?.value ?? '';
  const errEl    = document.getElementById('profile-error');
  if (errEl) errEl.textContent = '';

  if (!name)           { if (errEl) errEl.textContent = 'Bitte Namen eingeben.'; return; }
  if (!email)          { if (errEl) errEl.textContent = 'Bitte E-Mail eingeben.'; return; }
  if (dbPw.length < 6) { if (errEl) errEl.textContent = 'Datenbankpasswort: mindestens 6 Zeichen.'; return; }
  if (!cryptoPw)       { if (errEl) errEl.textContent = 'Bitte Cryptopasswort eingeben.'; return; }

  const btn = document.getElementById('teacher-login-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Verbinde…'; }

  try {
    // Firebase-Auth mit Datenbankpasswort (Account wird beim ersten Mal angelegt)
    await window.fbTeacherAuth(email, dbPw);

    // Cryptopasswort in Session hinterlegen — INI wird separat geladen/erstellt
    if (typeof window.setTeacherSessionKey === 'function') window.setTeacherSessionKey(cryptoPw);

    const user = { displayName: name, groupId: 'default', teacherEmail: email };
    saveUser(user);
    enterApp(user, false);
  } catch(e) {
    const msg = e.code === 'auth/wrong-password' ? 'Falsches Datenbankpasswort.'
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

  const rightPanel  = document.getElementById('right-panel');
  const sendBtn     = document.getElementById('sidebar-send-btn');
  const badge       = document.getElementById('sidebar-role-badge');

  const appScreen = document.getElementById('app-screen');

  if (isStudent) {
    if (rightPanel) rightPanel.style.display = 'none';
    if (appScreen)  appScreen.classList.remove('has-right-panel');
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
    if (rightPanel) rightPanel.style.display = 'flex';
    if (appScreen)  appScreen.classList.add('has-right-panel');
    if (sendBtn)    sendBtn.style.display    = 'none';
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

// ── INI-DATEI LADEN (Lehrer — lädt eigene vollständige INI mit Privatschlüssel) ──
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
      } catch(_) { resolve(null); }
    };
    input.click();
  });

  if (!iniObj) { showToast('Keine gültige INI-Datei.', 'error'); return; }

  // Privatschlüssel mit Session-Cryptopasswort verifizieren
  const cryptoPw = window._teacherSessionPasswordExport?.() ?? null;
  if (cryptoPw && iniObj.encryptedPrivateKey) {
    try {
      await window.kfCrypto.getPrivKeyFromIni(iniObj, cryptoPw);
    } catch(_) {
      showToast('❌ INI passt nicht zum Cryptopasswort dieser Sitzung.', 'error');
      return;
    }
  }

  window._loadedIni = iniObj;
  showToast(`✅ INI von "${iniObj.teacherName || 'Lehrer'}" geladen — Privatschlüssel aktiv.`);
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
    ['teacher-login-pw',   () => teacherLogin()],
    ['teacher-login-name', () => teacherLogin()],
    ['teacher-login-email',() => teacherLogin()],
    ['edit-profile-name',  () => saveProfileEdit()],
    ['student-login-pw',   () => submitStudentLogin()],
    ['student-login-id',   () => submitStudentLogin()],
    ['student-reg-pw2',    () => submitStudentRegister()],
  ].forEach(([id, fn]) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('keydown', e => { if (e.key === 'Enter') fn(); });
  });
});
