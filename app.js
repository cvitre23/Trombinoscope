import {
  schoolYear, openVault, readCurrent, replaceRecord, newSalt,
  deriveKey, encryptDirectory, decryptDirectory, nextPurge
} from './vault.js';
import { createPasskey, readPasskey, protectKey, recoverKey } from './passkey.js';

const el = id => document.getElementById(id);
const say = message => { el('message').textContent = message; };
const avatars = ['🦊', '🐼', '🐸', '🦉', '🐱', '🐻', '🐰', '🐨'];
let db;
let record;
let directory;
let key;
let activeClass;
let session = 0;
let busy = false;
let editingStudent;
let draftPhoto;
let photoSelection = 0;
let passkeySetup;
let passkeyRequest;
const idleMinutes = 5;
const minPassword = 12;
const pickerGraceMs = 2 * 60 * 1000;
let idleTimer;
let pickerOpenedAt = 0;
let hiddenAt = 0;
const supportsPasskeys = !!(window.PublicKeyCredential && navigator.credentials);

function showLock() {
  el('locked').hidden = false;
  el('unlocked').hidden = true;
  el('unlock').hidden = !db;
  el('reset').hidden = !record;
  el('unlock-passkey').hidden = !record?.passkey || !supportsPasskeys;
  el('lock-title').textContent = record ? 'Trombinoscope verrouillé' : 'Créer le Trombinoscope';
  el('lock-help').textContent = record
    ? 'Saisis ton mot de passe pour afficher les classes.'
    : 'Choisis un mot de passe d’au moins 12 caractères (une phrase facile à retenir convient). Il n’existe aucun moyen de le récupérer.';
  el('unlock-button').textContent = record ? 'Déverrouiller' : 'Créer le Trombinoscope';
  el('password').minLength = record ? 1 : minPassword;
  el('confirm-field').hidden = !!record;
  el('password-confirm').required = !record;
  el('password').autocomplete = record ? 'current-password' : 'new-password';
}

function lock() {
  session++;
  clearTimeout(idleTimer);
  pickerOpenedAt = 0;
  passkeyRequest?.abort();
  clearPasskeySetup();
  closeZoom();
  if (cropState) closeCropper(null);
  directory = key = activeClass = undefined;
  for (const id of ['unlock', 'add-class']) el(id).reset();
  resetStudentForm();
  for (const id of ['students', 'class-tiles']) el(id).replaceChildren();
  for (const id of ['manage', 'class-options', 'security', 'add-class-fold']) el(id).open = false;
  el('empty').textContent = '';
  el('directory-title').textContent = 'Mes classes';
  if (db) showLock();
  say('');
}

function showPhoto(photo) {
  const preview = el('photo-preview');
  if (photo) preview.src = photo;
  else preview.removeAttribute('src');
  preview.hidden = !photo;
  el('remove-photo').hidden = !photo;
}

let zoomTimer;
function closeZoom() {
  clearTimeout(zoomTimer);
  el('zoom').hidden = true;
  el('zoom-img').removeAttribute('src');
  el('zoom-name').textContent = '';
}

function openZoom(student) {
  if (!student.photo) return;
  clearTimeout(zoomTimer);
  el('zoom-img').src = student.photo;
  el('zoom-name').textContent = student.name;
  el('zoom').hidden = false;
  zoomTimer = setTimeout(closeZoom, 3000);
}

function selectClass(id) {
  if (busy) return;
  resetStudentForm();
  el('manage').open = el('class-options').open = false;
  say('');
  activeClass = id;
  showDirectory();
  el('directory-title').focus();
}

function renderTiles() {
  el('class-tiles').replaceChildren(...directory.map(group => {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tile';
    const name = document.createElement('span');
    name.className = 'tile-name';
    name.textContent = group.name;
    const count = document.createElement('span');
    count.className = 'tile-count';
    count.textContent = group.students.length + (group.students.length > 1 ? ' élèves' : ' élève');
    button.append(el('tile-icon').content.cloneNode(true), name, count);
    button.addEventListener('click', () => selectClass(group.id));
    item.append(button);
    return item;
  }));
}

function fillClassSelect(select, selected) {
  select.replaceChildren(...(directory || []).map(group => new Option(group.name, group.id)));
  if (selected) select.value = selected;
}

function resetStudentForm(student) {
  photoSelection++;
  editingStudent = student?.id;
  draftPhoto = student?.photo;
  el('add-student').reset();
  el('first-name').value = student?.name || '';
  fillClassSelect(el('student-class'), activeClass);
  el('student-form-title').textContent = student ? 'Modifier la fiche' : 'Ajouter une fiche';
  el('save-student').textContent = student ? 'Enregistrer la fiche' : 'Ajouter la fiche';
  el('save-student').disabled = false;
  el('cancel-edit').hidden = !student;
  el('photo-status').textContent = '';
  showPhoto(draftPhoto);
}

async function refreshRecord() {
  const current = await readCurrent(db, schoolYear());
  record = current.record;
  if (current.expired) {
    lock();
    say('Les données de l’année précédente ont été effacées.');
  }
  return current.expired;
}

function showDirectory() {
  el('locked').hidden = true;
  el('unlocked').hidden = false;
  el('passkey-panel').hidden = !supportsPasskeys;
  el('prepare-passkey').textContent = record.passkey ? 'Désactiver la clé d’accès' : 'Continuer';
  const current = directory.find(group => group.id === activeClass);
  activeClass = current?.id;
  el('home').hidden = !!current;
  el('class-view').hidden = !current;
  el('back').hidden = !current;
  el('directory-title').textContent = current?.name || 'Mes classes';
  renderTiles();
  el('empty-home').hidden = directory.length > 0;
  if (!directory.length) el('add-class-fold').open = true;
  el('rename-class-name').value = current?.name || '';
  if (!editingStudent) fillClassSelect(el('student-class'), current?.id);
  el('idle-minutes').textContent = idleMinutes;
  el('purge-date').textContent = '1er août ' + nextPurge().getFullYear();
  armIdleLock();
  el('empty').textContent = !current ? ''
    : current.students.length ? '' : 'Cette classe ne contient aucune fiche.';
  el('students').replaceChildren(...(current?.students || []).map(student => {
    const card = document.createElement('li');
    card.className = 'card';
    const portrait = document.createElement(student.photo ? 'img' : 'span');
    if (student.photo) {
      portrait.src = student.photo;
      portrait.alt = '';
      portrait.tabIndex = 0;
      portrait.setAttribute('role', 'button');
      portrait.setAttribute('aria-label', 'Agrandir la photo de ' + student.name);
      portrait.addEventListener('click', () => openZoom(student));
      portrait.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openZoom(student);
        }
      });
    } else {
      portrait.className = 'avatar';
      portrait.setAttribute('aria-hidden', 'true');
      portrait.textContent = avatars[student.avatar];
    }
    const name = document.createElement('p');
    name.textContent = student.name;
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'secondary';
    edit.textContent = 'Modifier';
    edit.setAttribute('aria-label', 'Modifier la fiche de ' + student.name);
    edit.addEventListener('click', () => {
      if (busy) return;
      resetStudentForm(student);
      el('manage').open = true;
      el('student-panel').scrollIntoView({ block: 'center' });
      el('first-name').focus();
    });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'plain';
    remove.textContent = 'Supprimer';
    remove.setAttribute('aria-label', 'Supprimer la fiche de ' + student.name);
    remove.addEventListener('click', () => run(async token => {
      if (!confirm('Supprimer cette fiche ?')) return;
      const next = directory.map(group => group.id === current.id
        ? { ...group, students: group.students.filter(item => item.id !== student.id) }
        : group);
      if (await save(next, token, current.id, 'Fiche supprimée.') && editingStudent === student.id) {
        resetStudentForm();
      }
    }));
    card.append(portrait, name, edit, remove);
    return card;
  }));
}

async function run(operation) {
  if (busy) return;
  busy = true;
  const token = session;
  try {
    await operation(token);
  } catch (error) {
    if (token === session) say(error.message || 'L’action a échoué.');
  } finally {
    busy = false;
  }
}

async function save(next, token, selected, message) {
  if (token !== session || !key) return false;
  const previous = record;
  if (previous.year < schoolYear()) {
    await refreshRecord();
    return false;
  }
  const candidate = await encryptDirectory(next, key, previous.salt, previous.year, previous.passkey);
  if (token !== session) return false;
  let replaced;
  try {
    replaced = await replaceRecord(db, previous.revision, candidate);
  } catch (error) {
    if (error?.name === 'QuotaExceededError') {
      throw new Error('Espace de stockage insuffisant sur l’iPad. Rien n’a été modifié.');
    }
    throw error;
  }
  if (!replaced) {
    lock();
    await refreshRecord();
    showLock();
    say('Les données ont changé dans une autre fenêtre. Ouvre de nouveau le Trombinoscope.');
    return false;
  }
  if (token !== session) return false;
  record = candidate;
  directory = next;
  if (passkeySetup) clearPasskeySetup();
  if (activeClass !== selected) resetStudentForm();
  activeClass = selected;
  showDirectory();
  say(message);
  return true;
}

async function unlock(token, password, confirmation) {
  if (await refreshRecord() || token !== session) return;
  showLock();
  const previous = record;
  if (!previous && password.length < minPassword) throw new Error('Choisis au moins ' + minPassword + ' caractères.');
  if (!previous && password !== confirmation) throw new Error('Les deux mots de passe sont différents.');
  const salt = previous?.salt || newSalt();
  const nextKey = await deriveKey(password, salt);
  if (token !== session) return;
  let next;
  if (previous) {
    try {
      next = await decryptDirectory(previous, nextKey);
    } catch {
      throw new Error('Mot de passe incorrect ou données illisibles.');
    }
    const latest = await readCurrent(db, schoolYear());
    if (token !== session) return;
    if (latest.record?.revision !== previous.revision) {
      record = latest.record;
      showLock();
      say(latest.expired ? 'Les données de l’année précédente ont été effacées.'
        : 'Les données ont changé. Réessaie.');
      return;
    }
  } else {
    next = [];
    const candidate = await encryptDirectory(next, nextKey, salt, schoolYear());
    if (token !== session) return;
    if (!await replaceRecord(db, undefined, candidate)) {
      await refreshRecord();
      if (token === session) {
        showLock();
        say('Un Trombinoscope existe déjà. Déverrouille-le.');
      }
      return;
    }
    if (token !== session) return;
    record = candidate;
    navigator.storage?.persist?.().catch(() => {});
  }
  key = nextKey;
  directory = next;
  showDirectory();
  el('directory-title').focus();
}

function clearPasskeySetup() {
  passkeySetup = undefined;
  el('passkey-setup').reset();
  el('passkey-setup').hidden = false;
  el('confirm-passkey').hidden = true;
  el('confirm-passkey').textContent = 'Créer une clé d’accès';
  el('cancel-passkey').hidden = true;
  el('passkey-status').textContent = '';
}

async function requestPasskey(operation) {
  const controller = new AbortController();
  passkeyRequest = controller;
  try {
    return await operation(controller.signal);
  } catch (error) {
    if (error.name === 'NotAllowedError' || error.name === 'AbortError') {
      throw new Error('Vérification annulée ou indisponible. Le mot de passe reste utilisable.');
    }
    throw error;
  } finally {
    passkeyRequest = undefined;
  }
}

async function updatePasskey(previous, passkey, token) {
  if (token !== session) return;
  if (previous.year < schoolYear()) {
    await refreshRecord();
    return;
  }
  const { passkey: oldPasskey, ...fields } = previous;
  const candidate = { ...fields, revision: crypto.randomUUID(), ...(passkey && { passkey }) };
  if (!await replaceRecord(db, previous.revision, candidate)) {
    if (token !== session) return;
    lock();
    await refreshRecord();
    showLock();
    say('Les données ont changé. Déverrouille de nouveau le Trombinoscope.');
    return;
  }
  if (token !== session) return;
  record = candidate;
  clearPasskeySetup();
  showDirectory();
  say('');
  el('passkey-status').textContent = passkey ? 'Clé d’accès activée.' : 'Clé d’accès désactivée dans le Trombinoscope.';
}

el('passkey-setup').addEventListener('submit', event => {
  event.preventDefault();
  if (busy || !key) return;
  const password = el('passkey-password').value;
  el('passkey-password').value = '';
  run(async token => {
    const previous = record;
    const checkedKey = await deriveKey(password, previous.salt, !previous.passkey);
    if (token !== session) return;
    try {
      await decryptDirectory(previous, checkedKey);
    } catch {
      throw new Error('Mot de passe incorrect ou données illisibles.');
    }
    if (token !== session) return;
    if (previous.passkey) {
      await updatePasskey(previous, undefined, token);
      return;
    }
    passkeySetup = { key: checkedKey, record: previous };
    el('passkey-setup').hidden = true;
    el('confirm-passkey').hidden = false;
    el('cancel-passkey').hidden = false;
    el('confirm-passkey').focus();
  });
});

el('confirm-passkey').addEventListener('click', () => run(async token => {
  const pending = passkeySetup;
  if (!pending) return;
  if (!pending.credential) {
    pending.credential = await requestPasskey(createPasskey);
    if (token !== session) return;
    el('confirm-passkey').textContent = 'Vérifier et activer la clé d’accès';
    el('passkey-status').textContent = 'Vérifie que la clé d’accès peut ouvrir le coffre pour terminer.';
    return;
  }
  const secret = await requestPasskey(signal => readPasskey(pending.credential, signal));
  if (token !== session) {
    new Uint8Array(secret).fill(0);
    return;
  }
  const passkey = await protectKey(pending.credential, secret, pending.record, pending.key);
  await updatePasskey(pending.record, passkey, token);
}));

el('cancel-passkey').addEventListener('click', () => {
  if (!busy) clearPasskeySetup();
});

el('unlock-passkey').addEventListener('click', () => run(async token => {
  const previous = record;
  if (!previous?.passkey) return;
  if (previous.year < schoolYear()) {
    await refreshRecord();
    return;
  }
  const secret = await requestPasskey(signal => readPasskey(previous.passkey, signal));
  if (token !== session) {
    new Uint8Array(secret).fill(0);
    return;
  }
  let nextKey;
  let next;
  try {
    nextKey = await recoverKey(previous, secret);
    next = await decryptDirectory(previous, nextKey);
  } catch {
    throw new Error('La clé d’accès n’a pas pu ouvrir le coffre. Utilise le mot de passe.');
  }
  if (await refreshRecord() || token !== session) return;
  if (record?.revision !== previous.revision) {
    showLock();
    say('Les données ont changé. Réessaie.');
    return;
  }
  key = nextKey;
  directory = next;
  showDirectory();
  say('');
  el('directory-title').focus();
}));

async function loadImage(file) {
  const supported = /^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type) ||
    (!file.type && /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name));
  if (!supported || file.size > 25 * 1024 * 1024) {
    throw new Error('Choisis une photo JPEG, PNG, WebP, HEIC ou HEIF de 25 Mo maximum.');
  }
  const source = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = source;
    await image.decode();
    return image;
  } catch {
    throw new Error('Ce navigateur ne peut pas lire cette image. Essaie avec une photo JPEG.');
  } finally {
    URL.revokeObjectURL(source);
  }
}

// Recadrage manuel : on déplace et on zoome la photo derrière un ovale.
// Tout se passe dans un canvas local ; rien ne quitte l'appareil.
const cropW = 360;
const cropH = 480;
let cropState;

function closeCropper(result) {
  const state = cropState;
  cropState = undefined;
  el('cropper').hidden = true;
  const canvas = el('crop-canvas');
  canvas.getContext('2d').clearRect(0, 0, cropW, cropH);
  state?.finish(result);
}

function drawCrop(guide) {
  const { image, scale, x, y } = cropState;
  const canvas = el('crop-canvas');
  const context = canvas.getContext('2d');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, cropW, cropH);
  context.drawImage(image, x, y, image.naturalWidth * scale, image.naturalHeight * scale);
  if (!guide) return;
  context.save();
  context.fillStyle = 'rgba(10, 30, 26, .62)';
  context.beginPath();
  context.rect(0, 0, cropW, cropH);
  context.ellipse(cropW / 2, cropH / 2, cropW / 2 - 3, cropH / 2 - 3, 0, 0, Math.PI * 2);
  context.fill('evenodd');
  context.strokeStyle = '#fff';
  context.lineWidth = 3;
  context.setLineDash([10, 7]);
  context.beginPath();
  context.ellipse(cropW / 2, cropH / 2, cropW / 2 - 3, cropH / 2 - 3, 0, 0, Math.PI * 2);
  context.stroke();
  context.restore();
}

function clampCrop() {
  const s = cropState;
  s.zoom = Math.min(4, Math.max(1, s.zoom));
  s.scale = s.min * s.zoom;
  const w = s.image.naturalWidth * s.scale;
  const h = s.image.naturalHeight * s.scale;
  s.x = Math.min(0, Math.max(cropW - w, s.x));
  s.y = Math.min(0, Math.max(cropH - h, s.y));
  el('crop-zoom').value = String(s.zoom);
}

function zoomCrop(next, anchorX = cropW / 2, anchorY = cropH / 2) {
  const s = cropState;
  const ix = (anchorX - s.x) / s.scale;
  const iy = (anchorY - s.y) / s.scale;
  s.zoom = next;
  s.scale = s.min * Math.min(4, Math.max(1, next));
  s.x = anchorX - ix * s.scale;
  s.y = anchorY - iy * s.scale;
  clampCrop();
  drawCrop(true);
}

function resetCrop() {
  const s = cropState;
  s.zoom = 1;
  s.scale = s.min;
  s.x = (cropW - s.image.naturalWidth * s.scale) / 2;
  // Les visages sont rarement au centre exact : cadre placé un peu plus haut.
  s.y = (cropH - s.image.naturalHeight * s.scale) * 0.35;
  clampCrop();
  drawCrop(true);
}

function cropPhoto(image) {
  return new Promise(finish => {
    cropState = {
      image, finish, zoom: 1, x: 0, y: 0, scale: 1, pointers: new Map(),
      min: Math.max(cropW / image.naturalWidth, cropH / image.naturalHeight)
    };
    el('crop-canvas').width = cropW;
    el('crop-canvas').height = cropH;
    el('cropper').hidden = false;
    resetCrop();
    el('crop-canvas').focus();
  });
}

function cropPoint(event) {
  const rect = el('crop-canvas').getBoundingClientRect();
  return { x: (event.clientX - rect.left) * cropW / rect.width, y: (event.clientY - rect.top) * cropH / rect.height };
}

(() => {
  const canvas = el('crop-canvas');
  const distance = () => {
    const [a, b] = [...cropState.pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  canvas.addEventListener('pointerdown', event => {
    if (!cropState) return;
    canvas.setPointerCapture(event.pointerId);
    cropState.pointers.set(event.pointerId, cropPoint(event));
    if (cropState.pointers.size === 2) cropState.pinch = { d: distance(), zoom: cropState.zoom };
  });
  canvas.addEventListener('pointermove', event => {
    const s = cropState;
    if (!s || !s.pointers.has(event.pointerId)) return;
    const point = cropPoint(event);
    if (s.pointers.size === 2 && s.pinch) {
      s.pointers.set(event.pointerId, point);
      zoomCrop(s.pinch.zoom * distance() / s.pinch.d);
      return;
    }
    const before = s.pointers.get(event.pointerId);
    s.x += point.x - before.x;
    s.y += point.y - before.y;
    s.pointers.set(event.pointerId, point);
    clampCrop();
    drawCrop(true);
  });
  for (const type of ['pointerup', 'pointercancel']) {
    canvas.addEventListener(type, event => {
      if (!cropState) return;
      cropState.pointers.delete(event.pointerId);
      cropState.pinch = undefined;
    });
  }
  canvas.addEventListener('wheel', event => {
    if (!cropState) return;
    event.preventDefault();
    const point = cropPoint(event);
    zoomCrop(cropState.zoom * (event.deltaY < 0 ? 1.08 : 1 / 1.08), point.x, point.y);
  }, { passive: false });
  canvas.addEventListener('keydown', event => {
    const s = cropState;
    if (!s) return;
    const step = 12;
    const moves = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    if (moves[event.key]) {
      s.x += moves[event.key][0];
      s.y += moves[event.key][1];
    } else if (event.key === '+' || event.key === '=') {
      zoomCrop(s.zoom * 1.1);
      event.preventDefault();
      return;
    } else if (event.key === '-') {
      zoomCrop(s.zoom / 1.1);
      event.preventDefault();
      return;
    } else return;
    event.preventDefault();
    clampCrop();
    drawCrop(true);
  });
  el('crop-zoom').addEventListener('input', event => { if (cropState) zoomCrop(Number(event.target.value)); });
  el('crop-reset').addEventListener('click', () => { if (cropState) resetCrop(); });
  el('crop-cancel').addEventListener('click', () => closeCropper(null));
  el('crop-ok').addEventListener('click', () => {
    if (!cropState) return;
    drawCrop(false);
    closeCropper(el('crop-canvas').toDataURL('image/jpeg', 0.85));
  });
})();

async function selectPhoto(input) {
  pickerOpenedAt = 0;
  const file = input.files[0];
  input.value = '';
  if (!file || !directory || busy) return;
  const selection = ++photoSelection;
  const status = el('photo-status');
  el('save-student').disabled = true;
  status.textContent = 'Préparation de la photo…';
  try {
    const image = await loadImage(file);
    if (selection !== photoSelection) return;
    status.textContent = 'Place le visage dans l’ovale.';
    const photo = await cropPhoto(image);
    if (selection !== photoSelection) return;
    if (!photo) {
      status.textContent = 'Photo non modifiée.';
      return;
    }
    draftPhoto = photo;
    showPhoto(photo);
    status.textContent = 'Photo prête. Enregistre la fiche pour la conserver.';
  } catch (error) {
    if (selection === photoSelection) status.textContent = error.message;
  } finally {
    if (selection === photoSelection) el('save-student').disabled = false;
  }
}

for (const [button, field] of [['take-photo', 'camera-file'], ['import-photo', 'library-file']]) {
  const input = el(field);
  el(button).addEventListener('click', () => {
    if (!directory || busy) return;
    pickerOpenedAt = Date.now();
    input.click();
  });
  input.addEventListener('cancel', () => { pickerOpenedAt = 0; });
  input.addEventListener('change', () => selectPhoto(input));
}
el('remove-photo').addEventListener('click', () => {
  if (busy) return;
  photoSelection++;
  draftPhoto = undefined;
  showPhoto(undefined);
  el('save-student').disabled = false;
  el('photo-status').textContent = 'Photo retirée. Enregistre la fiche pour confirmer.';
});
el('cancel-edit').addEventListener('click', () => {
  if (!busy) resetStudentForm();
});

el('unlock').addEventListener('submit', event => {
  event.preventDefault();
  const password = el('password').value;
  const confirmation = el('password-confirm').value;
  el('password').value = '';
  el('password-confirm').value = '';
  run(token => unlock(token, password, confirmation));
});
el('reset').addEventListener('click', () => run(async token => {
  if (!confirm('Effacer définitivement toutes les classes, fiches et photos de cet iPad ? Cette action est irréversible.')) return;
  if (token !== session) return;
  const deleted = await replaceRecord(db, record?.revision, undefined);
  if (token !== session) return;
  await refreshRecord();
  if (token !== session) return;
  showLock();
  say(deleted ? 'Toutes les données ont été effacées.' : 'Les données ont changé. Réessaie.');
}));
el('lock').addEventListener('click', () => {
  lock();
  el('password').focus();
});
function checkYearOnReturn() {
  if (record && record.year < schoolYear()) {
    lock();
    refreshRecord().catch(() => say('La vérification de l’année scolaire a échoué. Réessaie en déverrouillant.'));
  }
}

// L’appareil photo ou la photothèque peuvent masquer la page : on tolère ce cas
// pendant 2 minutes au plus. Toute autre mise en arrière-plan verrouille.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    hiddenAt = Date.now();
    if (!directory || !pickerOpenedAt || hiddenAt - pickerOpenedAt > pickerGraceMs) lock();
    return;
  }
  if (directory && pickerOpenedAt && Date.now() - hiddenAt > pickerGraceMs) lock();
  pickerOpenedAt = 0;
  checkYearOnReturn();
});

function armIdleLock() {
  clearTimeout(idleTimer);
  if (directory) idleTimer = setTimeout(() => {
    if (busy) return armIdleLock();
    lock();
    say('Verrouillage automatique après inactivité.');
  }, idleMinutes * 60 * 1000);
}
for (const type of ['pointerdown', 'keydown', 'scroll']) {
  document.addEventListener(type, () => { if (directory) armIdleLock(); }, { passive: true, capture: true });
}
window.addEventListener('pagehide', lock);
window.addEventListener('pageshow', event => { if (event.persisted) checkYearOnReturn(); });

el('zoom').addEventListener('click', closeZoom);
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !el('zoom').hidden) closeZoom();
});
el('back').addEventListener('click', () => {
  closeZoom();
  if (busy) return;
  resetStudentForm();
  el('manage').open = el('class-options').open = false;
  say('');
  activeClass = undefined;
  showDirectory();
  el('directory-title').focus();
});
el('add-class').addEventListener('submit', event => {
  event.preventDefault();
  run(async token => {
    const name = el('class-name').value.trim();
    if (!name) throw new Error('Saisis un nom de classe.');
    const group = { id: crypto.randomUUID(), name, students: [] };
    if (await save([...directory, group], token, undefined, 'Classe ajoutée.')) event.target.reset();
  });
});
el('remove-class').addEventListener('click', () => run(async token => {
  const group = directory.find(item => item.id === activeClass);
  if (!group || !confirm('Supprimer la classe « ' + group.name + ' » et toutes ses fiches ?')) return;
  await save(directory.filter(item => item.id !== group.id), token, undefined, 'Classe supprimée.');
}));
el('rename-class').addEventListener('submit', event => {
  event.preventDefault();
  run(async token => {
    const name = el('rename-class-name').value.trim();
    if (!name) throw new Error('Saisis un nom de classe.');
    const next = directory.map(group => group.id === activeClass ? { ...group, name } : group);
    await save(next, token, activeClass, 'Classe renommée.');
  });
});
el('add-student').addEventListener('submit', event => {
  event.preventDefault();
  if (el('save-student').disabled) return;
  run(async token => {
    const group = directory.find(item => item.id === activeClass);
    if (!group) throw new Error('Crée d’abord une classe.');
    const target = directory.find(item => item.id === el('student-class').value) || group;
    const name = el('first-name').value.trim();
    if (!name) throw new Error('Saisis un prénom.');
    const previous = group.students.find(student => student.id === editingStudent);
    const { photo: _old, ...kept } = previous || {};
    const student = previous ? { ...kept, name, ...(draftPhoto && { photo: draftPhoto }) } : {
      id: crypto.randomUUID(), name, ...(draftPhoto && { photo: draftPhoto }),
      avatar: Math.floor(Math.random() * avatars.length)
    };
    const next = directory.map(item => {
      let students = item.students.filter(entry => entry.id !== student.id);
      if (item.id === target.id) {
        const index = item.students.findIndex(entry => entry.id === student.id);
        if (index >= 0) students = item.students.map(entry => entry.id === student.id ? student : entry);
        else students = [...students, student];
      }
      return { ...item, students };
    });
    const message = !previous ? 'Fiche ajoutée.'
      : target.id !== group.id ? 'Fiche déplacée vers « ' + target.name + ' ».' : 'Fiche modifiée.';
    if (await save(next, token, target.id, message)) {
      resetStudentForm();
    }
  });
});

async function enableOffline() {
  try {
    if (!('serviceWorker' in navigator)) throw new Error();
    const worker = navigator.serviceWorker;
    const ready = () => { el('offline').textContent = 'Mode hors ligne prêt sur cet appareil.'; };
    const hadController = !!worker.controller;
    worker.addEventListener('controllerchange', () => {
      if (!worker.controller) return;
      el('offline').textContent = hadController
        ? 'Nouvelle version installée. Ferme puis rouvre le Trombinoscope pour l’utiliser.'
        : 'Mode hors ligne prêt sur cet appareil.';
    });
    const registration = await worker.register('./sw.js', { updateViaCache: 'none' });
    if (navigator.onLine) registration.update().catch(() => {});
    if (worker.controller) ready();
    const pending = registration.installing || registration.waiting;
    if (pending) pending.addEventListener('statechange', () => {
      if (pending.state === 'redundant' && !worker.controller) {
        el('offline').textContent = 'Mode hors ligne indisponible. Recharge la page avec une connexion.';
      }
    });
  } catch {
    el('offline').textContent = 'Mode hors ligne indisponible dans ce navigateur.';
  }
}

async function start() {
  if (!window.isSecureContext || !crypto.subtle || location.protocol === 'file:') {
    el('lock-title').textContent = 'Ouvre l’adresse HTTPS';
    el('lock-help').textContent = 'Publie les fichiers sur GitHub Pages puis ouvre le lien du site.';
    el('offline').textContent = '';
    return;
  }
  enableOffline();
  try {
    db = await openVault();
    await refreshRecord();
    showLock();
  } catch {
    el('unlock').hidden = true;
    el('lock-title').textContent = 'Stockage local indisponible';
    el('lock-help').textContent = 'Vérifie les réglages de Safari ou du navigateur, puis recharge la page.';
  }
}

start();
