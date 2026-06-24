'use strict';

const socket = io();
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d', { alpha: false });

const menu = document.getElementById('menu');
const lobby = document.getElementById('lobby');
const endScreen = document.getElementById('endScreen');
const settingsMenu = document.getElementById('settingsMenu');
const mapOverlay = document.getElementById('mapOverlay');
const fullMapCanvas = document.getElementById('fullMap');
const mapCtx = fullMapCanvas.getContext('2d');
const hud = document.getElementById('hud');
const nameInput = document.getElementById('nameInput');
const codeInput = document.getElementById('codeInput');
const menuError = document.getElementById('menuError');
const roomCodeEl = document.getElementById('roomCode');
const playerList = document.getElementById('playerList');
const hostControls = document.getElementById('hostControls');
const countdown = document.getElementById('countdown');
const topMessage = document.getElementById('topMessage');
const inventory = document.getElementById('inventory');
const interactionHint = document.getElementById('interactionHint');
const endTitle = document.getElementById('endTitle');
const endText = document.getElementById('endText');
const shareAddress = document.getElementById('shareAddress');
const modePicker = document.getElementById('modePicker');
const changeTeamButton = document.getElementById('changeTeamButton');
const teamStatus = document.getElementById('teamStatus');

const healthFill = document.getElementById('healthFill');
const shieldFill = document.getElementById('shieldFill');
const healthValue = document.getElementById('healthValue');
const shieldValue = document.getElementById('shieldValue');
const matchStats = document.getElementById('matchStats');
const hudMode = document.getElementById('hudMode');
const hudTeam = document.getElementById('hudTeam');
const weaponName = document.getElementById('weaponName');
const ammoText = document.getElementById('ammoText');
const reloadTrack = document.getElementById('reloadTrack');
const reloadFill = document.getElementById('reloadFill');
const actionText = document.getElementById('actionText');
const actionTrack = document.getElementById('actionTrack');
const actionFill = document.getElementById('actionFill');
const fpsCounter = document.getElementById('fpsCounter');

const qualitySelect = document.getElementById('qualitySelect');
const fpsSelect = document.getElementById('fpsSelect');
const showFpsCheckbox = document.getElementById('showFpsCheckbox');
const keybindGrid = document.getElementById('keybindGrid');
const bindHelp = document.getElementById('bindHelp');

let myId = null;
let currentRoom = null;
let world = null;
let weapons = null;
let rarities = null;
let ammoLabels = null;
let snapshot = null;
let mouse = { x: 0, y: 0, down: false };
let keys = Object.create(null);
let camera = { x: 1600, y: 1600 };
let lastFrame = performance.now();
let lastRenderAt = 0;
let gameActive = false;
let settingsOpen = false;
let mapOpen = false;
let rebindingAction = null;
let frameCounter = 0;
let fpsSampleStarted = performance.now();
let measuredFps = 0;
let worldDecor = [];
let chestStateMap = new Map();
let renderPlayers = new Map();
let inventorySlots = [];
let currentScreen = 'menu';

const modeLabels = { solo: 'SOLO', duo: 'DUO', squad: 'SQUAD' };
const rarityColors = {
  common: '#c4ccd2', uncommon: '#65dc73', rare: '#54a7ff',
  epic: '#b36eff', legendary: '#ffd34e', mythic: '#ff5d5d'
};
const teamColors = ['#69f7ff', '#ff7b9c', '#ffd166', '#78e08f', '#b388ff', '#ff9f43', '#4dd0e1', '#f78fb3'];
const actionLabels = {
  bandage: 'משתמש בתחבושת', medkit: 'משתמש בערכת ריפוי',
  smallShield: 'שותה מגן קטן', bigShield: 'שותה מגן גדול',
  fusionJuice: 'שותה Fusion Juice'
};

const DEFAULT_BINDS = Object.freeze({
  up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD',
  jump: 'Space', interact: 'KeyE', reload: 'KeyR', map: 'KeyM',
  slot1: 'Digit1', slot2: 'Digit2', slot3: 'Digit3', slot4: 'Digit4', slot5: 'Digit5'
});
const BIND_LABELS = {
  up: 'תנועה למעלה', down: 'תנועה למטה', left: 'תנועה שמאלה', right: 'תנועה ימינה',
  jump: 'קפיצה מהמטוס', interact: 'פתיחה / איסוף', reload: 'טעינה', map: 'פתיחת מפה',
  slot1: 'ציוד 1', slot2: 'ציוד 2', slot3: 'ציוד 3', slot4: 'ציוד 4', slot5: 'ציוד 5'
};

const CLIENT_SETTINGS_KEY = 'neonDropClientV6';
let clientSettings = loadClientSettings();
let binds = { ...DEFAULT_BINDS, ...(clientSettings.binds || {}) };

const weaponSpritePaths = {
  pumpScatter: 'assets/gear/scatter.svg', tacticalScatter: 'assets/gear/tactical-scatter.svg',
  heavyPulse: 'assets/gear/heavy-pulse.svg', rangerPulse: 'assets/gear/ranger-pulse.svg',
  cyclone: 'assets/gear/cyclone.svg', compactBurst: 'assets/gear/compact-burst.svg',
  impactSidearm: 'assets/gear/impact.svg', longshot: 'assets/gear/longshot.svg'
};
const itemSpritePaths = {
  bandage: 'assets/items/bandage.svg', medkit: 'assets/items/medkit.svg',
  smallShield: 'assets/items/small-shield.svg', bigShield: 'assets/items/big-shield.svg',
  fusionJuice: 'assets/items/fusion-juice.svg', ammo: 'assets/items/ammo.svg'
};
const sprites = new Map();
for (const [key, src] of Object.entries({ ...weaponSpritePaths, ...itemSpritePaths })) {
  const image = new Image();
  image.decoding = 'async';
  image.src = src;
  sprites.set(key, image);
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const me = () => snapshot?.players?.find(p => p.id === myId);
const teamColor = teamId => teamColors[(Math.max(1, teamId) - 1) % teamColors.length];

function loadClientSettings() {
  try {
    return { quality: 'medium', maxFps: 60, showFps: false, binds: {}, ...JSON.parse(localStorage.getItem(CLIENT_SETTINGS_KEY) || '{}') };
  } catch {
    return { quality: 'medium', maxFps: 60, showFps: false, binds: {} };
  }
}

function saveClientSettings() {
  clientSettings.binds = binds;
  localStorage.setItem(CLIENT_SETTINGS_KEY, JSON.stringify(clientSettings));
}

function pixelRatioForQuality() {
  const device = window.devicePixelRatio || 1;
  if (clientSettings.quality === 'low') return 1;
  if (clientSettings.quality === 'high') return Math.min(device, 2);
  return Math.min(device, 1.5);
}

function resizeCanvas() {
  const ratio = pixelRatioForQuality();
  canvas.width = Math.max(1, Math.floor(window.innerWidth * ratio));
  canvas.height = Math.max(1, Math.floor(window.innerHeight * ratio));
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.imageSmoothingEnabled = clientSettings.quality !== 'low';
}
window.addEventListener('resize', resizeCanvas);

function applyClientSettings() {
  qualitySelect.value = clientSettings.quality;
  fpsSelect.value = String(clientSettings.maxFps);
  showFpsCheckbox.checked = Boolean(clientSettings.showFps);
  fpsCounter.classList.toggle('hidden', !clientSettings.showFps);
  resizeCanvas();
  if (world) prepareWorldDecor();
  updateControlLabels();
}

function setScreen(which) {
  currentScreen = which;
  menu.classList.toggle('hidden', which !== 'menu');
  lobby.classList.toggle('hidden', which !== 'lobby');
  endScreen.classList.toggle('hidden', which !== 'end');
  hud.classList.toggle('hidden', which !== 'game');
  if (which !== 'game') { closeSettings(); closeMap(); }
}

function showError(text) { menuError.textContent = text || ''; }
function playerName() { return (nameInput.value || 'Player').trim().slice(0, 18); }
function sendAction(type, extra = {}) { if (gameActive && !settingsOpen && !mapOpen) socket.emit('action', { type, ...extra }); }

function codeLabel(code) {
  const aliases = {
    Space: 'SPACE', Escape: 'ESC', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    ShiftLeft: 'L-SHIFT', ShiftRight: 'R-SHIFT', ControlLeft: 'L-CTRL', ControlRight: 'R-CTRL',
    Mouse0: 'MOUSE 1'
  };
  if (aliases[code]) return aliases[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `NUM ${code.slice(6)}`;
  return code.replace(/Left|Right/g, '').toUpperCase();
}

function renderKeybinds() {
  keybindGrid.innerHTML = '';
  for (const action of Object.keys(DEFAULT_BINDS)) {
    const row = document.createElement('div');
    row.className = 'bindRow';
    const label = document.createElement('span');
    label.textContent = BIND_LABELS[action];
    const button = document.createElement('button');
    button.className = 'bindButton';
    button.dataset.action = action;
    button.textContent = codeLabel(binds[action]);
    button.addEventListener('click', () => beginRebind(action, button));
    row.append(label, button);
    keybindGrid.appendChild(row);
  }
}

function beginRebind(action, button) {
  rebindingAction = action;
  for (const bindButton of keybindGrid.querySelectorAll('.bindButton')) bindButton.classList.remove('listening');
  button.classList.add('listening');
  button.textContent = 'לחץ מקש…';
  bindHelp.textContent = 'לחץ על המקש הרצוי. ESC מבטל.';
}

function finishRebind(code) {
  if (!rebindingAction) return;
  if (code !== 'Escape') {
    for (const [action, boundCode] of Object.entries(binds)) {
      if (action !== rebindingAction && boundCode === code) binds[action] = DEFAULT_BINDS[action];
    }
    binds[rebindingAction] = code;
    saveClientSettings();
  }
  rebindingAction = null;
  bindHelp.textContent = 'לחץ על כפתור ואז על המקש החדש.';
  renderKeybinds();
  updateControlLabels();
}

function updateControlLabels() {
  document.getElementById('mapKey').textContent = codeLabel(binds.map);
  document.getElementById('reloadKey').textContent = codeLabel(binds.reload);
  document.getElementById('interactKey').textContent = codeLabel(binds.interact);
  interactionHint.textContent = `${codeLabel(binds.interact)} — פתיחה / איסוף`;
  document.getElementById('controlsHint').textContent =
    `${codeLabel(binds.up)}/${codeLabel(binds.left)}/${codeLabel(binds.down)}/${codeLabel(binds.right)} תנועה · עכבר ירי/שימוש · ${codeLabel(binds.interact)} פתיחה · ${codeLabel(binds.reload)} טעינה · ${codeLabel(binds.map)} מפה · ESC הגדרות`;
  inventorySlots.forEach((slot, index) => { slot.root.dataset.key = codeLabel(binds[`slot${index + 1}`]); });
}

function openSettings() {
  if (!gameActive || settingsOpen) return;
  closeMap();
  settingsOpen = true;
  mouse.down = false;
  keys = Object.create(null);
  settingsMenu.classList.remove('hidden');
  socket.emit('input', { up: false, down: false, left: false, right: false, angle: 0, shoot: false });
}

function closeSettings() {
  settingsOpen = false;
  rebindingAction = null;
  settingsMenu.classList.add('hidden');
  bindHelp.textContent = 'לחץ על כפתור ואז על המקש החדש.';
  renderKeybinds();
}

function openMap() {
  if (!gameActive || !world || !snapshot || mapOpen) return;
  closeSettings();
  mapOpen = true;
  mouse.down = false;
  keys = Object.create(null);
  mapOverlay.classList.remove('hidden');
  socket.emit('input', { up: false, down: false, left: false, right: false, angle: 0, shoot: false });
  drawFullMap();
}

function closeMap() {
  mapOpen = false;
  mapOverlay.classList.add('hidden');
}

function toggleMap() {
  mapOpen ? closeMap() : openMap();
}

function resetToMenu() {
  socket.emit('leaveRoom');
  currentRoom = null;
  world = null;
  snapshot = null;
  gameActive = false;
  closeMap();
  renderPlayers.clear();
  history.replaceState({}, '', location.pathname);
  setScreen('menu');
}

const inviteCode = new URLSearchParams(location.search).get('room');
if (inviteCode) codeInput.value = inviteCode.toUpperCase().slice(0, 5);

// Lobby controls
document.getElementById('createButton').addEventListener('click', () => {
  showError('');
  socket.emit('createRoom', { name: playerName() }, response => {
    if (!response?.ok) return showError(response?.error || 'לא ניתן ליצור חדר');
    myId = response.playerId;
    currentRoom = response.room;
    renderLobby(currentRoom);
    setScreen('lobby');
  });
});

document.getElementById('joinButton').addEventListener('click', () => {
  showError('');
  socket.emit('joinRoom', { name: playerName(), code: codeInput.value }, response => {
    if (!response?.ok) return showError(response?.error || 'לא ניתן להצטרף');
    myId = response.playerId;
    currentRoom = response.room;
    renderLobby(currentRoom);
    setScreen('lobby');
  });
});

document.getElementById('addBotButton').addEventListener('click', () => socket.emit('addBot'));
document.getElementById('startButton').addEventListener('click', () => socket.emit('startGame', response => {
  if (!response?.ok) alert(response?.error || 'לא ניתן להתחיל');
}));
document.getElementById('leaveButton').addEventListener('click', resetToMenu);
document.getElementById('copyButton').addEventListener('click', async () => {
  const link = `${location.origin}${location.pathname}?room=${currentRoom?.code || ''}`;
  try {
    await navigator.clipboard.writeText(link);
    document.getElementById('copyButton').textContent = 'הועתק!';
    setTimeout(() => { document.getElementById('copyButton').textContent = 'העתק הזמנה'; }, 1400);
  } catch { prompt('העתק את קישור ההזמנה:', link); }
});
modePicker.addEventListener('click', event => {
  const button = event.target.closest('[data-mode]');
  if (!button || currentRoom?.hostId !== myId || currentRoom.state !== 'lobby') return;
  socket.emit('setMode', button.dataset.mode, response => {
    if (!response?.ok) alert(response?.error || 'לא ניתן לשנות מצב');
  });
});
changeTeamButton.addEventListener('click', () => socket.emit('cycleTeam'));

// HUD buttons
document.getElementById('mapButton').addEventListener('click', toggleMap);
document.getElementById('closeMapButton').addEventListener('click', closeMap);
document.getElementById('reloadButton').addEventListener('click', () => sendAction('reload'));
document.getElementById('interactButton').addEventListener('click', () => sendAction('interact'));

// Settings controls
document.getElementById('resumeButton').addEventListener('click', closeSettings);
document.getElementById('exitMatchButton').addEventListener('click', resetToMenu);
document.getElementById('resetKeysButton').addEventListener('click', () => {
  binds = { ...DEFAULT_BINDS };
  saveClientSettings();
  renderKeybinds();
  updateControlLabels();
});
qualitySelect.addEventListener('change', () => {
  clientSettings.quality = qualitySelect.value;
  saveClientSettings();
  applyClientSettings();
});
fpsSelect.addEventListener('change', () => {
  clientSettings.maxFps = Number(fpsSelect.value) || 0;
  saveClientSettings();
});
showFpsCheckbox.addEventListener('change', () => {
  clientSettings.showFps = showFpsCheckbox.checked;
  saveClientSettings();
  fpsCounter.classList.toggle('hidden', !clientSettings.showFps);
});

socket.on('lobbyState', room => {
  currentRoom = room;
  renderLobby(room);
  if (room.state === 'lobby' || room.state === 'countdown') {
    gameActive = false;
    if (!endScreen.classList.contains('hidden')) setScreen('lobby');
    else if (world == null) setScreen('lobby');
  }
});

socket.on('gameStarted', data => {
  world = data.world;
  weapons = data.weapons;
  rarities = data.rarities;
  ammoLabels = data.ammoLabels;
  snapshot = null;
  gameActive = true;
  settingsOpen = false;
  closeMap();
  renderPlayers.clear();
  prepareWorldDecor();
  buildInventorySlots();
  history.replaceState({}, '', `?room=${data.roomCode}`);
  setScreen('game');
});

socket.on('snapshot', data => {
  snapshot = data;
  chestStateMap = new Map((data.chests || []).map(chest => [chest.id, chest.opened]));
  if (gameActive) { updateHud(); if (mapOpen) drawFullMap(); }
});

socket.on('matchEnded', result => {
  gameActive = false;
  const won = result?.winners?.some(player => player.id === myId);
  const names = result?.winners?.map(player => player.name).join(', ');
  endTitle.textContent = won ? 'ניצחתם!' : 'המשחק הסתיים';
  endText.textContent = names
    ? `${names} ניצחו בקבוצה ${result.winnerTeamId} עם ${result.totalKills} הדחות ביחד.`
    : 'לא נשארה קבוצה מנצחת.';
  setScreen('end');
});

function renderLobby(room) {
  if (!room) return;
  roomCodeEl.textContent = room.code;
  const invite = `${location.origin}${location.pathname}?room=${room.code}`;
  shareAddress.textContent = `קישור לחברים: ${invite}`;
  const isHost = room.hostId === myId;
  const myself = room.players.find(player => player.id === myId);
  hostControls.classList.toggle('hidden', !isHost || room.state !== 'lobby');
  changeTeamButton.classList.toggle('hidden', room.mode === 'solo' || room.state !== 'lobby');
  teamStatus.textContent = room.mode === 'solo' ? 'כל שחקן לעצמו' : `הקבוצה שלך: ${myself?.teamId || '-'}`;

  for (const button of modePicker.querySelectorAll('[data-mode]')) {
    button.classList.toggle('active', button.dataset.mode === room.mode);
    button.disabled = !isHost || room.state !== 'lobby';
  }

  const orderedPlayers = [...room.players].sort((a, b) => a.teamId - b.teamId || Number(a.isBot) - Number(b.isBot));
  playerList.innerHTML = '';
  for (const player of orderedPlayers) {
    const row = document.createElement('div');
    row.className = 'playerRow';
    row.style.setProperty('--team-color', teamColor(player.teamId));
    const left = document.createElement('div');
    const role = player.isHost ? 'מנהל החדר' : player.isBot ? 'בוט' : 'שחקן';
    left.innerHTML = `<strong>${escapeHtml(player.name)}</strong><div class="playerMeta">${role}</div>`;
    row.appendChild(left);
    const actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.style.alignItems = 'center';
    actions.style.gap = '7px';
    const badge = document.createElement('span');
    badge.className = 'teamBadge';
    badge.textContent = room.mode === 'solo' ? 'SOLO' : `קבוצה ${player.teamId}`;
    actions.appendChild(badge);
    if (isHost && player.isBot && room.state === 'lobby') {
      const remove = document.createElement('button');
      remove.className = 'removeBot';
      remove.textContent = 'הסר';
      remove.addEventListener('click', () => socket.emit('removeBot', player.id));
      actions.appendChild(remove);
    }
    row.appendChild(actions);
    playerList.appendChild(row);
  }
  countdown.classList.toggle('hidden', room.state !== 'countdown');
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
}

setInterval(() => {
  if (currentRoom?.state === 'countdown') {
    const seconds = Math.max(0, Math.ceil((currentRoom.countdownEnd - Date.now()) / 1000));
    countdown.textContent = `המשחק מתחיל בעוד ${seconds}`;
  }
}, 150);

window.addEventListener('keydown', event => {
  if (rebindingAction) {
    event.preventDefault();
    finishRebind(event.code);
    return;
  }
  if (event.code === 'Escape' && gameActive) {
    event.preventDefault();
    if (mapOpen) closeMap();
    else settingsOpen ? closeSettings() : openSettings();
    return;
  }
  if (!gameActive || settingsOpen) return;
  if (event.code === binds.map && !event.repeat) {
    event.preventDefault();
    toggleMap();
    return;
  }
  if (mapOpen) return;
  keys[event.code] = true;
  if ([binds.jump, binds.up, binds.down, binds.left, binds.right].includes(event.code)) event.preventDefault();
  if (event.repeat) return;
  if (event.code === binds.jump) sendAction('jump');
  if (event.code === binds.interact) sendAction('interact');
  if (event.code === binds.reload) sendAction('reload');
  for (let i = 1; i <= 5; i++) if (event.code === binds[`slot${i}`]) sendAction('slot', { slot: i - 1 });
});
window.addEventListener('keyup', event => { keys[event.code] = false; });
canvas.addEventListener('mousemove', event => { mouse.x = event.clientX; mouse.y = event.clientY; });
canvas.addEventListener('mousedown', event => { if (event.button === 0 && !settingsOpen && !mapOpen) mouse.down = true; });
window.addEventListener('mouseup', () => { mouse.down = false; });
canvas.addEventListener('contextmenu', event => event.preventDefault());
canvas.addEventListener('wheel', event => {
  if (settingsOpen || mapOpen) return;
  const player = me();
  if (!player) return;
  const direction = event.deltaY > 0 ? 1 : -1;
  const slot = (player.activeSlot + direction + player.inventory.length) % player.inventory.length;
  sendAction('slot', { slot });
}, { passive: true });

setInterval(() => {
  if (!gameActive || !snapshot) return;
  const player = me();
  if (!player) return;
  const centerX = window.innerWidth / 2;
  const centerY = window.innerHeight / 2;
  const angle = Math.atan2(mouse.y - centerY, mouse.x - centerX);
  socket.emit('input', {
    up: !settingsOpen && !mapOpen && Boolean(keys[binds.up]),
    down: !settingsOpen && !mapOpen && Boolean(keys[binds.down]),
    left: !settingsOpen && !mapOpen && Boolean(keys[binds.left]),
    right: !settingsOpen && !mapOpen && Boolean(keys[binds.right]),
    angle,
    shoot: !settingsOpen && !mapOpen && mouse.down
  });
}, 1000 / 40);

function isWeaponInventoryItem(item) { return Boolean(item && (item.kind === 'weapon' || weapons?.[item.type])); }
function isConsumableInventoryItem(item) { return Boolean(item && item.kind === 'consumable'); }
function activeWeaponFor(player) {
  const item = player?.inventory?.[player.activeSlot] || null;
  return isWeaponInventoryItem(item) ? item : null;
}

const consumableNames = {
  bandage: 'Bandage', medkit: 'Medkit', smallShield: 'Small Shield',
  bigShield: 'Big Shield', fusionJuice: 'Fusion Juice'
};

function buildInventorySlots() {
  inventory.innerHTML = '';
  inventorySlots = [];
  for (let index = 0; index < 5; index++) {
    const root = document.createElement('div');
    root.className = 'slot';
    root.dataset.key = codeLabel(binds[`slot${index + 1}`]);
    const image = document.createElement('img');
    image.alt = '';
    const name = document.createElement('div');
    name.className = 'slotName';
    const ammo = document.createElement('div');
    ammo.className = 'slotAmmo';
    root.append(image, name, ammo);
    root.addEventListener('click', () => sendAction('slot', { slot: index }));
    inventory.appendChild(root);
    inventorySlots.push({ root, image, name, ammo });
  }
}

function updateHud() {
  const player = me();
  if (!player) return;
  const alive = snapshot.players.filter(p => p.alive).length;
  healthFill.style.width = `${clamp(player.health, 0, 100)}%`;
  shieldFill.style.width = `${clamp(player.shield, 0, 100)}%`;
  healthValue.textContent = Math.ceil(player.health);
  shieldValue.textContent = Math.ceil(player.shield);
  hudMode.textContent = modeLabels[snapshot.mode] || snapshot.mode.toUpperCase();
  hudTeam.textContent = snapshot.mode === 'solo' ? 'לבד' : `קבוצה ${player.teamId}`;
  matchStats.textContent = `נשארו: ${alive} · קבוצות: ${snapshot.remainingTeams} · הדחות: ${player.kills}`;

  const activeItem = player.inventory?.[player.activeSlot] || null;
  const activeWeapon = activeWeaponFor(player);
  if (activeWeapon) {
    const def = weapons?.[activeWeapon.type];
    const reserve = player.ammo?.[def?.ammoType] || 0;
    weaponName.textContent = `${def?.name || activeWeapon.type} · ${rarities?.[activeWeapon.rarity]?.label || activeWeapon.rarity}`;
    weaponName.style.color = rarityColors[activeWeapon.rarity] || '#b9d5df';
    ammoText.textContent = `${activeWeapon.ammo} / ${reserve}`;
  } else if (isConsumableInventoryItem(activeItem)) {
    weaponName.textContent = consumableNames[activeItem.type] || activeItem.type;
    weaponName.style.color = activeItem.type.includes('Shield') ? '#62b8ff' : activeItem.type === 'fusionJuice' ? '#35e1d0' : '#ff7a89';
    ammoText.textContent = `×${activeItem.amount || 1}`;
  } else {
    weaponName.textContent = 'ללא ציוד';
    weaponName.style.color = '#b9d5df';
    ammoText.textContent = '—';
  }

  const serverNow = snapshot.serverTime;
  if (player.reloadUntil > serverNow && player.reloadStartedAt) {
    const duration = player.reloadUntil - player.reloadStartedAt;
    const progress = clamp((serverNow - player.reloadStartedAt) / duration, 0, 1);
    reloadTrack.classList.remove('hidden');
    reloadFill.style.width = `${progress * 100}%`;
    actionText.textContent = 'טוען מחסנית…';
  } else {
    reloadTrack.classList.add('hidden');
    reloadFill.style.width = '0%';
  }

  if (player.actionUntil > serverNow && player.actionStartedAt) {
    const duration = player.actionUntil - player.actionStartedAt;
    const progress = clamp((serverNow - player.actionStartedAt) / duration, 0, 1);
    actionTrack.classList.remove('hidden');
    actionFill.style.width = `${progress * 100}%`;
    actionText.textContent = actionLabels[player.actionType] || 'משתמש בפריט…';
  } else {
    actionTrack.classList.add('hidden');
    actionFill.style.width = '0%';
    if (!(player.reloadUntil > serverNow)) actionText.textContent = player.regenPool > 0 ? `Fusion פעיל: ${Math.ceil(player.regenPool)}` : '';
  }

  if (inventorySlots.length !== 5) buildInventorySlots();
  player.inventory.forEach((item, index) => {
    const slot = inventorySlots[index];
    const weaponItem = isWeaponInventoryItem(item);
    const def = weaponItem ? weapons?.[item.type] : null;
    const reserve = weaponItem && def ? player.ammo?.[def.ammoType] || 0 : 0;
    const rarityColor = weaponItem ? (rarityColors[item.rarity] || '#7eeaff')
      : item?.type === 'smallShield' || item?.type === 'bigShield' ? '#45aaff'
      : item?.type === 'fusionJuice' ? '#35e1d0'
      : item ? '#ff6678' : '#7eeaff';
    slot.root.classList.toggle('active', index === player.activeSlot);
    slot.root.classList.toggle('consumableSlot', isConsumableInventoryItem(item));
    slot.root.style.setProperty('--rarity-color', rarityColor);
    slot.root.dataset.key = codeLabel(binds[`slot${index + 1}`]);
    if (weaponItem) {
      slot.image.src = weaponSpritePaths[item.type] || itemSpritePaths.ammo;
      slot.image.classList.remove('hidden');
      slot.name.textContent = def?.name || item.type;
      slot.name.style.color = rarityColor;
      slot.ammo.textContent = `${item.ammo} / ${reserve}`;
    } else if (isConsumableInventoryItem(item)) {
      slot.image.src = itemSpritePaths[item.type] || itemSpritePaths.medkit;
      slot.image.classList.remove('hidden');
      slot.name.textContent = consumableNames[item.type] || item.type;
      slot.name.style.color = rarityColor;
      slot.ammo.textContent = `×${item.amount || 1} · לחץ לירי/שימוש`;
    } else {
      slot.image.removeAttribute('src');
      slot.image.classList.add('hidden');
      slot.name.textContent = 'ריק';
      slot.name.style.color = '#8ca3ad';
      slot.ammo.textContent = '—';
    }
  });

  if (player.phase === 'plane') topMessage.textContent = `${codeLabel(binds.jump)} — קפוץ מהמטוס`;
  else if (player.phase === 'falling') topMessage.textContent = 'נחיתה… השתמש במקשי התנועה לכיוון';
  else if (!player.alive) topMessage.textContent = 'הודחת — צפייה במשחק';
  else topMessage.textContent = snapshot.zone && dist(player, snapshot.zone) > snapshot.zone.radius ? 'מחוץ לאזור הבטוח!' : '';

  let near = false;
  if (player.phase === 'landed') {
    for (const chest of world?.chests || []) if (!chestStateMap.get(chest.id) && dist(player, chest) < 80) { near = true; break; }
    if (!near) for (const item of snapshot.items || []) if (dist(player, item) < 72) { near = true; break; }
  }
  interactionHint.classList.toggle('hidden', !near);
}

function prepareWorldDecor() {
  worldDecor = [];
  if (!world) return;
  let seed = 987654321;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const count = clientSettings.quality === 'low' ? 90 : clientSettings.quality === 'high' ? 340 : 190;
  for (let i = 0; i < count; i++) {
    worldDecor.push({ x: random() * world.size, y: random() * world.size, r: 1 + random() * 3, a: .025 + random() * .06 });
  }
}

function worldToScreen(x, y) { return { x: x - camera.x + window.innerWidth / 2, y: y - camera.y + window.innerHeight / 2 }; }
function onScreenWorld(x, y, radius = 80) {
  const sx = x - camera.x + window.innerWidth / 2;
  const sy = y - camera.y + window.innerHeight / 2;
  return sx > -radius && sy > -radius && sx < window.innerWidth + radius && sy < window.innerHeight + radius;
}

function getRenderPlayer(player) {
  let rendered = renderPlayers.get(player.id);
  if (!rendered) {
    rendered = { x: player.x, y: player.y, angle: player.angle };
    renderPlayers.set(player.id, rendered);
  }
  const factor = player.id === myId ? .48 : .32;
  rendered.x += (player.x - rendered.x) * factor;
  rendered.y += (player.y - rendered.y) * factor;
  let angleDelta = player.angle - rendered.angle;
  while (angleDelta > Math.PI) angleDelta -= Math.PI * 2;
  while (angleDelta < -Math.PI) angleDelta += Math.PI * 2;
  rendered.angle += angleDelta * .42;
  return rendered;
}

function updateCamera(dt) {
  const player = me();
  let target = player;
  if (!player?.alive) target = snapshot?.players?.find(p => p.alive && p.teamId === player?.teamId) || snapshot?.players?.find(p => p.alive) || player;
  if (!target) return;
  const rendered = getRenderPlayer(target);
  const smooth = 1 - Math.pow(0.0008, dt);
  camera.x += (rendered.x - camera.x) * smooth;
  camera.y += (rendered.y - camera.y) * smooth;
}

function roundedPath(x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function drawGrid() {
  ctx.fillStyle = '#1b5745';
  ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
  if (clientSettings.quality !== 'low') {
    for (const dot of worldDecor) {
      if (!onScreenWorld(dot.x, dot.y, 10)) continue;
      const p = worldToScreen(dot.x, dot.y);
      ctx.fillStyle = `rgba(214,255,224,${dot.a})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, dot.r, 0, Math.PI * 2); ctx.fill();
    }
  }
  const grid = 120;
  ctx.strokeStyle = 'rgba(255,255,255,.025)';
  ctx.lineWidth = 1;
  const startX = -((camera.x - window.innerWidth / 2) % grid);
  const startY = -((camera.y - window.innerHeight / 2) % grid);
  for (let x = startX; x < window.innerWidth; x += grid) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, window.innerHeight); ctx.stroke(); }
  for (let y = startY; y < window.innerHeight; y += grid) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(window.innerWidth, y); ctx.stroke(); }
}

function drawWorld() {
  if (!world) return;
  const topLeft = worldToScreen(0, 0);
  ctx.strokeStyle = '#07251f';
  ctx.lineWidth = 20;
  ctx.strokeRect(topLeft.x, topLeft.y, world.size, world.size);

  if (world.roads?.length) {
    ctx.save();
    ctx.strokeStyle = '#827767';
    ctx.globalAlpha = .34;
    ctx.lineCap = 'round';
    for (const road of world.roads) {
      const a = worldToScreen(road.x1, road.y1);
      const b = worldToScreen(road.x2, road.y2);
      ctx.lineWidth = road.width || 60;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.strokeStyle = 'rgba(235,220,180,.18)';
      ctx.lineWidth = 3;
      ctx.setLineDash([18, 22]);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = '#827767';
    }
    ctx.restore();
  }

  for (const house of world.houses) {
    if (!onScreenWorld(house.x + house.w / 2, house.y + house.h / 2, Math.max(house.w, house.h))) continue;
    const p = worldToScreen(house.x, house.y);
    if (clientSettings.quality !== 'low') {
      ctx.fillStyle = 'rgba(0,0,0,.18)';
      roundedPath(p.x + 9, p.y + 12, house.w, house.h, 7); ctx.fill();
    }
    const shellColor = house.style === 'industrial' ? '#66727b' : house.style === 'harbor' ? '#557c87' : house.style === 'city' ? '#8a6c58' : '#9b724d';
    const floorColor = house.style === 'industrial' ? '#a8b0b4' : house.style === 'harbor' ? '#a6ced0' : house.style === 'city' ? '#c9ad8d' : '#d5b984';
    ctx.fillStyle = shellColor;
    roundedPath(p.x, p.y, house.w, house.h, 6); ctx.fill();
    ctx.fillStyle = floorColor;
    ctx.fillRect(p.x + 16, p.y + 16, house.w - 32, house.h - 32);

    if (clientSettings.quality !== 'low') {
      ctx.strokeStyle = 'rgba(98,63,37,.18)';
      ctx.lineWidth = 2;
      for (let yy = p.y + 24; yy < p.y + house.h - 20; yy += 24) {
        ctx.beginPath(); ctx.moveTo(p.x + 18, yy); ctx.lineTo(p.x + house.w - 18, yy); ctx.stroke();
      }
      ctx.fillStyle = '#8f4f55';
      roundedPath(p.x + house.w * .38, p.y + house.h * .35, house.w * .25, house.h * .22, 7); ctx.fill();
      ctx.fillStyle = 'rgba(255,221,150,.18)';
      ctx.fillRect(p.x + 28, p.y + 30, 55, 34);
      ctx.fillRect(p.x + house.w - 95, p.y + house.h - 70, 58, 36);
    }

    ctx.fillStyle = '#5d3925';
    for (const wall of house.walls) {
      const w = worldToScreen(wall.x, wall.y);
      ctx.fillRect(w.x, w.y, wall.w, wall.h);
    }

    ctx.fillStyle = '#2d1a12';
    if (house.doorSide === 'bottom') ctx.fillRect(p.x + house.w / 2 - 25, p.y + house.h - 11, 50, 11);
    else if (house.doorSide === 'top') ctx.fillRect(p.x + house.w / 2 - 25, p.y, 50, 11);
    else if (house.doorSide === 'right') ctx.fillRect(p.x + house.w - 11, p.y + house.h / 2 - 25, 11, 50);
    else ctx.fillRect(p.x, p.y + house.h / 2 - 25, 11, 50);

    if (clientSettings.quality === 'high') {
      ctx.fillStyle = '#8bd7ef';
      ctx.fillRect(p.x + 28, p.y - 3, 38, 8);
      ctx.fillRect(p.x + house.w - 66, p.y + house.h - 5, 38, 8);
    }
  }

  for (const town of world.townCenters || []) {
    if (!onScreenWorld(town.x, town.y, 180)) continue;
    const p = worldToScreen(town.x, town.y);
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = '900 21px Arial';
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(0,0,0,.52)';
    ctx.strokeText(town.name, p.x, p.y);
    ctx.fillStyle = '#f4f0d9';
    ctx.fillText(town.name, p.x, p.y);
    ctx.restore();
  }

  for (const obstacle of world.obstacles) {
    if (!onScreenWorld(obstacle.x, obstacle.y, obstacle.r + 20)) continue;
    const p = worldToScreen(obstacle.x, obstacle.y);
    if (obstacle.kind === 'tree') {
      if (clientSettings.quality !== 'low') {
        ctx.fillStyle = 'rgba(0,0,0,.18)';
        ctx.beginPath(); ctx.ellipse(p.x + 7, p.y + 15, obstacle.r * .9, obstacle.r * .45, 0, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = '#6e472e';
      ctx.beginPath(); ctx.arc(p.x, p.y + 10, obstacle.r * .35, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#22683e';
      ctx.beginPath(); ctx.arc(p.x, p.y - 4, obstacle.r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#3f9158';
      ctx.beginPath(); ctx.arc(p.x - 9, p.y - 12, obstacle.r * .58, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.fillStyle = '#66767f';
      ctx.beginPath(); ctx.arc(p.x, p.y, obstacle.r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#aab8be'; ctx.lineWidth = 3; ctx.stroke();
      if (clientSettings.quality === 'high') {
        ctx.strokeStyle = 'rgba(255,255,255,.28)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(p.x - 5, p.y - 5, obstacle.r * .62, Math.PI, Math.PI * 1.6); ctx.stroke();
      }
    }
  }

  for (const chest of world.chests) {
    if (!onScreenWorld(chest.x, chest.y, 45)) continue;
    const opened = chestStateMap.get(chest.id);
    const p = worldToScreen(chest.x, chest.y);
    ctx.save();
    ctx.translate(p.x, p.y);
    if (!opened && clientSettings.quality !== 'low') {
      ctx.shadowBlur = 18;
      ctx.shadowColor = '#ffdc58';
    }
    ctx.fillStyle = opened ? '#5f5648' : '#d89418';
    roundedPath(-20, -15, 40, 30, 5); ctx.fill();
    ctx.fillStyle = opened ? '#81776a' : '#ffe16d';
    ctx.fillRect(-20, -5, 40, 7);
    ctx.fillStyle = '#4b3012';
    ctx.fillRect(-3, -8, 6, 17);
    ctx.strokeStyle = '#432d13'; ctx.lineWidth = 3;
    roundedPath(-20, -15, 40, 30, 5); ctx.stroke();
    ctx.restore();
  }
}

function drawSprite(image, x, y, w, h) {
  if (image?.complete && image.naturalWidth) ctx.drawImage(image, x, y, w, h);
  else {
    ctx.fillStyle = '#d7eaf2';
    roundedPath(x, y, w, h, 5); ctx.fill();
  }
}

function itemSprite(item) {
  if (item.type === 'weapon') return sprites.get(item.weapon.type);
  if (item.type === 'ammo') return sprites.get('ammo');
  return sprites.get(item.type);
}

function itemRarityColor(item) {
  if (item.type === 'weapon') return rarityColors[item.weapon.rarity] || '#c4ccd2';
  if (item.type === 'smallShield' || item.type === 'bigShield') return '#45aaff';
  if (item.type === 'fusionJuice') return '#35e1d0';
  if (item.type === 'bandage' || item.type === 'medkit') return '#ff6678';
  return '#ffe06c';
}

function drawItems(time) {
  for (const item of snapshot?.items || []) {
    if (!onScreenWorld(item.x, item.y, 70)) continue;
    const p = worldToScreen(item.x, item.y);
    const bob = Math.sin(time * .004 + String(item.id).length * 1.7) * 3;
    const color = itemRarityColor(item);
    ctx.save();
    ctx.translate(p.x, p.y + bob);
    if (clientSettings.quality !== 'low') {
      ctx.shadowBlur = clientSettings.quality === 'high' ? 18 : 10;
      ctx.shadowColor = color;
    }
    ctx.fillStyle = 'rgba(5,12,18,.9)';
    roundedPath(-33, -24, 66, 48, 10); ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = item.type === 'weapon' ? 3 : 2;
    roundedPath(-33, -24, 66, 48, 10); ctx.stroke();
    drawSprite(itemSprite(item), -27, -18, 54, 36);

    const count = item.amount || (item.type === 'weapon' ? 1 : 0);
    if (count > 1) {
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#071118';
      ctx.beginPath(); ctx.arc(24, 17, 11, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 12px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(`×${count}`, 24, 17);
    }
    ctx.restore();
  }
}

function drawZone() {
  if (!snapshot?.zone) return;
  const p = worldToScreen(snapshot.zone.x, snapshot.zone.y);
  ctx.save();
  ctx.fillStyle = 'rgba(111,57,169,.22)';
  ctx.beginPath();
  ctx.rect(0, 0, window.innerWidth, window.innerHeight);
  ctx.arc(p.x, p.y, snapshot.zone.radius, 0, Math.PI * 2, true);
  ctx.fill('evenodd');
  ctx.strokeStyle = 'rgba(167,111,255,.88)';
  ctx.lineWidth = 5;
  ctx.beginPath(); ctx.arc(p.x, p.y, snapshot.zone.radius, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}

function drawPlane() {
  if (!snapshot?.plane || snapshot.plane.finished) return;
  const p = worldToScreen(snapshot.plane.x, snapshot.plane.y);
  const angle = Math.atan2(snapshot.plane.vy, snapshot.plane.vx);
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(angle);
  if (clientSettings.quality !== 'low') { ctx.shadowBlur = 16; ctx.shadowColor = 'rgba(0,0,0,.4)'; }
  ctx.fillStyle = '#dfeaf0';
  ctx.beginPath(); ctx.moveTo(45, 0); ctx.lineTo(-33, -16); ctx.lineTo(-18, 0); ctx.lineTo(-33, 16); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#69cdea'; ctx.fillRect(-7, -47, 15, 94);
  ctx.fillStyle = '#315c70'; ctx.fillRect(-30, -4, 65, 8);
  ctx.restore();
}

function drawPlayers() {
  const self = me();
  const liveIds = new Set();
  for (const player of snapshot?.players || []) {
    liveIds.add(player.id);
    if (player.phase === 'plane' || !player.alive) continue;
    const rendered = getRenderPlayer(player);
    if (!onScreenWorld(rendered.x, rendered.y, 85)) continue;
    const p = worldToScreen(rendered.x, rendered.y);
    const isMe = player.id === myId;
    const teammate = self && snapshot.mode !== 'solo' && player.teamId === self.teamId;
    ctx.save();
    ctx.translate(p.x, p.y);
    if (clientSettings.quality !== 'low') {
      ctx.fillStyle = 'rgba(0,0,0,.25)';
      ctx.beginPath(); ctx.ellipse(5, 13, 22, 10, 0, 0, Math.PI * 2); ctx.fill();
    }
    if (player.phase === 'falling') {
      const scale = 1.8 - player.fallProgress * .8;
      ctx.save();
      ctx.scale(scale, scale);
      ctx.fillStyle = '#f5f7fa';
      ctx.beginPath(); ctx.arc(0, -25, 28, Math.PI, 0); ctx.fill();
      ctx.strokeStyle = '#d2dde4'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-24, -24); ctx.lineTo(-8, -2); ctx.moveTo(24, -24); ctx.lineTo(8, -2); ctx.stroke();
      ctx.restore();
    }

    ctx.rotate(rendered.angle);
    const bodyColor = isMe ? '#69f7ff' : teammate ? teamColor(player.teamId) : player.isBot ? '#ffb76a' : '#ff6e91';
    ctx.fillStyle = bodyColor;
    ctx.beginPath(); ctx.arc(0, 0, 19, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = teammate ? '#fff' : 'rgba(0,0,0,.42)';
    ctx.lineWidth = teammate ? 3 : 2; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.28)';
    ctx.beginPath(); ctx.arc(-6, -7, 6, 0, Math.PI * 2); ctx.fill();

    const active = activeWeaponFor(player);
    if (active) {
      const image = sprites.get(active.type);
      drawSprite(image, 5, -16, 44, 28);
    } else {
      ctx.fillStyle = '#d9edf5'; ctx.fillRect(8, -4, 27, 8);
    }
    ctx.rotate(-rendered.angle);

    ctx.fillStyle = 'rgba(0,0,0,.72)'; ctx.fillRect(-27, -46, 54, 6);
    ctx.fillStyle = '#49a9ff'; ctx.fillRect(-27, -46, 54 * (player.shield / 100), 6);
    ctx.fillStyle = 'rgba(0,0,0,.72)'; ctx.fillRect(-27, -37, 54, 6);
    ctx.fillStyle = '#5ee776'; ctx.fillRect(-27, -37, 54 * (player.health / 100), 6);
    ctx.fillStyle = '#fff'; ctx.font = '12px Arial'; ctx.textAlign = 'center';
    ctx.fillText(`${player.name}${snapshot.mode !== 'solo' ? ` [${player.teamId}]` : ''}`, 0, -53);
    ctx.restore();
  }
  for (const id of renderPlayers.keys()) if (!liveIds.has(id)) renderPlayers.delete(id);
}

function drawBullets() {
  for (const bullet of snapshot?.bullets || []) {
    if (!onScreenWorld(bullet.x, bullet.y, 12)) continue;
    const p = worldToScreen(bullet.x, bullet.y);
    ctx.fillStyle = rarityColors[bullet.rarity] || '#fff09a';
    ctx.beginPath(); ctx.arc(p.x, p.y, clientSettings.quality === 'low' ? 3 : 4, 0, Math.PI * 2); ctx.fill();
  }
}

function drawFullMap() {
  if (!world || !snapshot) return;
  const w = fullMapCanvas.width;
  const h = fullMapCanvas.height;
  mapCtx.clearRect(0, 0, w, h);
  mapCtx.fillStyle = '#123f35';
  mapCtx.fillRect(0, 0, w, h);
  const pad = 34;
  const mapSize = Math.min(w - pad * 2, h - pad * 2);
  const ox = (w - mapSize) / 2;
  const oy = (h - mapSize) / 2;
  const scale = mapSize / world.size;
  const sx = value => ox + value * scale;
  const sy = value => oy + value * scale;

  mapCtx.save();
  mapCtx.beginPath();
  mapCtx.rect(ox, oy, mapSize, mapSize);
  mapCtx.clip();

  mapCtx.strokeStyle = 'rgba(160,145,120,.72)';
  mapCtx.lineCap = 'round';
  for (const road of world.roads || []) {
    mapCtx.lineWidth = Math.max(3, (road.width || 60) * scale);
    mapCtx.beginPath();
    mapCtx.moveTo(sx(road.x1), sy(road.y1));
    mapCtx.lineTo(sx(road.x2), sy(road.y2));
    mapCtx.stroke();
  }

  for (const house of world.houses || []) {
    mapCtx.fillStyle = house.style === 'industrial' ? '#82909a'
      : house.style === 'harbor' ? '#69a1aa'
      : house.style === 'city' ? '#ad8b70'
      : '#c5a46e';
    mapCtx.fillRect(sx(house.x), sy(house.y), Math.max(2, house.w * scale), Math.max(2, house.h * scale));
  }

  if (snapshot.zone) {
    mapCtx.strokeStyle = '#c090ff';
    mapCtx.lineWidth = 4;
    mapCtx.beginPath();
    mapCtx.arc(sx(snapshot.zone.x), sy(snapshot.zone.y), snapshot.zone.radius * scale, 0, Math.PI * 2);
    mapCtx.stroke();
  }

  const self = me();
  for (const player of snapshot.players || []) {
    if (!player.alive) continue;
    const visible = player.id === myId || (snapshot.mode !== 'solo' && self && player.teamId === self.teamId);
    if (!visible) continue;
    mapCtx.fillStyle = player.id === myId ? '#ffffff' : teamColor(player.teamId);
    mapCtx.beginPath();
    mapCtx.arc(sx(player.x), sy(player.y), player.id === myId ? 7 : 5, 0, Math.PI * 2);
    mapCtx.fill();
    if (player.id === myId) {
      mapCtx.strokeStyle = '#071118';
      mapCtx.lineWidth = 2;
      mapCtx.stroke();
    }
  }

  if (snapshot.plane && !snapshot.plane.finished) {
    mapCtx.fillStyle = '#eaf7ff';
    mapCtx.beginPath();
    mapCtx.arc(sx(snapshot.plane.x), sy(snapshot.plane.y), 5, 0, Math.PI * 2);
    mapCtx.fill();
  }
  mapCtx.restore();

  mapCtx.strokeStyle = '#d8eef4';
  mapCtx.lineWidth = 3;
  mapCtx.strokeRect(ox, oy, mapSize, mapSize);

  mapCtx.textAlign = 'center';
  mapCtx.textBaseline = 'middle';
  mapCtx.font = '900 18px Arial';
  for (const town of world.townCenters || []) {
    const tx = sx(town.x);
    const ty = sy(town.y);
    mapCtx.lineWidth = 5;
    mapCtx.strokeStyle = 'rgba(0,0,0,.7)';
    mapCtx.strokeText(town.name, tx, ty);
    mapCtx.fillStyle = '#fff7d7';
    mapCtx.fillText(town.name, tx, ty);
  }
}

function drawMinimap() {
  if (!world || !snapshot) return;
  const size = 170;
  const x = window.innerWidth - size - 18;
  const y = 18;
  const self = me();
  ctx.save();
  ctx.globalAlpha = .94;
  ctx.fillStyle = '#0a1b20'; ctx.fillRect(x, y, size, size);
  ctx.strokeStyle = '#9fc2cf'; ctx.lineWidth = 2; ctx.strokeRect(x, y, size, size);
  const scale = size / world.size;
  for (const house of world.houses) {
    ctx.fillStyle = 'rgba(255,255,255,.14)';
    ctx.fillRect(x + house.x * scale, y + house.y * scale, Math.max(2, house.w * scale), Math.max(2, house.h * scale));
  }
  if (snapshot.zone) {
    ctx.strokeStyle = '#b482ff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x + snapshot.zone.x * scale, y + snapshot.zone.y * scale, snapshot.zone.radius * scale, 0, Math.PI * 2); ctx.stroke();
  }
  for (const player of snapshot.players) {
    if (!player.alive) continue;
    const visible = player.id === myId || (snapshot.mode !== 'solo' && self && player.teamId === self.teamId);
    if (!visible) continue;
    ctx.fillStyle = player.id === myId ? '#fff' : teamColor(player.teamId);
    ctx.beginPath(); ctx.arc(x + player.x * scale, y + player.y * scale, player.id === myId ? 4 : 3, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

function updateFps(time) {
  frameCounter += 1;
  const elapsed = time - fpsSampleStarted;
  if (elapsed >= 500) {
    measuredFps = Math.round(frameCounter * 1000 / elapsed);
    frameCounter = 0;
    fpsSampleStarted = time;
    fpsCounter.textContent = `FPS: ${measuredFps}`;
  }
}

function frame(time) {
  requestAnimationFrame(frame);
  const maxFps = Number(clientSettings.maxFps) || 0;
  if (maxFps > 0 && time - lastRenderAt < 1000 / maxFps - .4) return;
  const dt = Math.min(.05, (time - lastFrame) / 1000);
  lastFrame = time;
  lastRenderAt = time;
  updateFps(time);
  drawGrid();
  if (gameActive && snapshot && world) {
    updateCamera(dt);
    drawWorld();
    drawItems(time);
    drawPlayers();
    drawBullets();
    drawPlane();
    drawZone();
    drawMinimap();
  } else {
    ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
  }
}

renderKeybinds();
applyClientSettings();
requestAnimationFrame(frame);
