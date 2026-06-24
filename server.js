'use strict';

const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const express = require('express');
const { Server } = require('socket.io');

const PORT = Number(process.env.PORT || 3000);
const WORLD = 4800;
const TICK_RATE = 40;
const SNAPSHOT_RATE = 20;
const DT = 1 / TICK_RATE;
const MAX_PLAYERS = 24;
const INVENTORY_SLOTS = 5;
const ROOM_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const MODES = {
  solo: { label: 'Solo', teamSize: 1 },
  duo: { label: 'Duo', teamSize: 2 },
  squad: { label: 'Squad', teamSize: 4 }
};

const RARITIES = {
  common: { label: 'Common', damage: 1, cooldown: 1, weight: 36 },
  uncommon: { label: 'Uncommon', damage: 1.06, cooldown: 0.98, weight: 27 },
  rare: { label: 'Rare', damage: 1.12, cooldown: 0.96, weight: 19 },
  epic: { label: 'Epic', damage: 1.18, cooldown: 0.94, weight: 11 },
  legendary: { label: 'Legendary', damage: 1.25, cooldown: 0.91, weight: 6 },
  mythic: { label: 'Mythic', damage: 1.32, cooldown: 0.88, weight: 1 }
};

// These are game-balance values only. They are not real-world specifications.
const WEAPONS = {
  pumpScatter: {
    name: 'Pump Scatter', category: 'Scatter', ammoType: 'shells',
    damage: 10, speed: 830, cooldown: 780, magazine: 5, reload: 1700,
    spread: 0.25, pellets: 8, range: 370, chestWeight: 18
  },
  tacticalScatter: {
    name: 'Tactical Scatter', category: 'Scatter', ammoType: 'shells',
    damage: 7, speed: 850, cooldown: 430, magazine: 8, reload: 1550,
    spread: 0.2, pellets: 6, range: 420, chestWeight: 13
  },
  heavyPulse: {
    name: 'Heavy Pulse', category: 'Pulse', ammoType: 'medium',
    damage: 22, speed: 1060, cooldown: 160, magazine: 30, reload: 1750,
    spread: 0.06, pellets: 1, range: 930, chestWeight: 17
  },
  rangerPulse: {
    name: 'Ranger Pulse', category: 'Pulse', ammoType: 'medium',
    damage: 18, speed: 1080, cooldown: 115, magazine: 30, reload: 1550,
    spread: 0.045, pellets: 1, range: 920, chestWeight: 16
  },
  cyclone: {
    name: 'Cyclone', category: 'Rapid', ammoType: 'light',
    damage: 11, speed: 920, cooldown: 74, magazine: 50, reload: 1900,
    spread: 0.095, pellets: 1, range: 660, chestWeight: 16
  },
  compactBurst: {
    name: 'Compact Burst', category: 'Rapid', ammoType: 'light',
    damage: 13, speed: 950, cooldown: 90, magazine: 30, reload: 1450,
    spread: 0.075, pellets: 1, range: 720, chestWeight: 14
  },
  impactSidearm: {
    name: 'Impact Sidearm', category: 'Sidearm', ammoType: 'medium',
    damage: 38, speed: 1120, cooldown: 420, magazine: 7, reload: 1350,
    spread: 0.035, pellets: 1, range: 880, chestWeight: 10
  },
  longshot: {
    name: 'Longshot', category: 'Longshot', ammoType: 'heavy',
    damage: 125, speed: 1520, cooldown: 1250, magazine: 5, reload: 2300,
    spread: 0.012, pellets: 1, range: 1450, chestWeight: 8
  }
};

const AMMO_LABELS = {
  light: 'Light Ammo',
  medium: 'Medium Ammo',
  shells: 'Shells',
  heavy: 'Heavy Ammo'
};

const CONSUMABLES = {
  bandage: { name: 'Bandage', maxStack: 5, duration: 1500 },
  medkit: { name: 'Medkit', maxStack: 3, duration: 3200 },
  smallShield: { name: 'Small Shield', maxStack: 6, duration: 1400 },
  bigShield: { name: 'Big Shield', maxStack: 3, duration: 2600 },
  fusionJuice: { name: 'Fusion Juice', maxStack: 2, duration: 2100 }
};

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.json({ ok: true, rooms: rooms.size, version: '6.0.0' }));

const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' },
  pingInterval: 10000,
  pingTimeout: 20000
});

const rooms = new Map();
let entityCounter = 1;
const id = (prefix = 'e') => `${prefix}${entityCounter++}`;
const now = () => Date.now();
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rand = (a, b) => a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(rand(a, b + 1));
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function weightedPick(entries, weightGetter) {
  const total = entries.reduce((sum, entry) => sum + weightGetter(entry), 0);
  let cursor = Math.random() * total;
  for (const entry of entries) {
    cursor -= weightGetter(entry);
    if (cursor <= 0) return entry;
  }
  return entries[entries.length - 1];
}

function randomRarity() {
  return weightedPick(Object.keys(RARITIES), key => RARITIES[key].weight);
}

function randomWeaponType() {
  return weightedPick(Object.keys(WEAPONS), key => WEAPONS[key].chestWeight);
}

function resolvedWeaponDef(weapon) {
  const base = WEAPONS[weapon.type];
  const rarity = RARITIES[weapon.rarity] || RARITIES.common;
  return {
    ...base,
    damage: base.damage * rarity.damage,
    cooldown: base.cooldown * rarity.cooldown
  };
}

function sanitizeName(name) {
  const clean = String(name || 'Player').replace(/[<>]/g, '').trim().slice(0, 18);
  return clean || 'Player';
}

function createRoomCode() {
  for (let attempt = 0; attempt < 100; attempt++) {
    let code = '';
    for (let i = 0; i < 5; i++) code += ROOM_CHARS[randi(0, ROOM_CHARS.length - 1)];
    if (!rooms.has(code)) return code;
  }
  return String(Date.now()).slice(-5);
}

function emptyAmmo() {
  return { light: 0, medium: 0, shells: 0, heavy: 0 };
}

function emptyInventory() {
  return Array.from({ length: INVENTORY_SLOTS }, () => null);
}

function isWeaponItem(item) {
  return Boolean(item && (item.kind === 'weapon' || (!item.kind && WEAPONS[item.type])) && WEAPONS[item.type]);
}

function isConsumableItem(item) {
  return Boolean(item && item.kind === 'consumable' && CONSUMABLES[item.type]);
}

function makeWeaponItem(type, rarity, ammo) {
  return { kind: 'weapon', type, rarity, ammo };
}

function makeConsumableItem(type, amount = 1) {
  return { kind: 'consumable', type, amount };
}

function countConsumable(player, type) {
  return player.inventory.reduce((sum, item) => sum + (isConsumableItem(item) && item.type === type ? item.amount : 0), 0);
}

function findConsumableSlot(player, type) {
  return player.inventory.findIndex(item => isConsumableItem(item) && item.type === type && item.amount > 0);
}

function addConsumableToInventory(player, type, amount) {
  const def = CONSUMABLES[type];
  if (!def || amount <= 0) return 0;
  let remaining = amount;
  for (const item of player.inventory) {
    if (!isConsumableItem(item) || item.type !== type || item.amount >= def.maxStack) continue;
    const moved = Math.min(remaining, def.maxStack - item.amount);
    item.amount += moved;
    remaining -= moved;
    if (remaining <= 0) return amount;
  }
  while (remaining > 0) {
    const empty = player.inventory.findIndex(item => !item);
    if (empty < 0) break;
    const moved = Math.min(remaining, def.maxStack);
    player.inventory[empty] = makeConsumableItem(type, moved);
    remaining -= moved;
  }
  return amount - remaining;
}

function consumeOne(player, type) {
  const slot = findConsumableSlot(player, type);
  if (slot < 0) return false;
  const item = player.inventory[slot];
  item.amount -= 1;
  if (item.amount <= 0) player.inventory[slot] = null;
  return true;
}

function makePlayer(socketId, name, isBot = false) {
  return {
    id: socketId,
    name: sanitizeName(name),
    isBot,
    connected: true,
    teamId: 1,
    x: WORLD / 2,
    y: WORLD / 2,
    angle: 0,
    radius: 18,
    phase: 'lobby',
    fallProgress: 0,
    jumpDelay: rand(2.5, 9),
    dropTarget: { x: WORLD / 2, y: WORLD / 2 },
    alive: true,
    health: 100,
    shield: 0,
    kills: 0,
    inventory: emptyInventory(),
    ammo: emptyAmmo(),
    activeSlot: 0,
    regenPool: 0,
    regenTickAt: 0,
    input: { up: false, down: false, left: false, right: false, angle: 0, shoot: false },
    lastShotAt: 0,
    reloadStartedAt: 0,
    reloadUntil: 0,
    actionStartedAt: 0,
    actionUntil: 0,
    actionType: null,
    lastZoneDamageAt: 0,
    botThinkAt: 0,
    botTarget: null,
    botLootTarget: null,
    botWander: { x: WORLD / 2, y: WORLD / 2 },
    botStrafeDirection: Math.random() < 0.5 ? -1 : 1,
    botStrafeUntil: 0,
    botAimError: 0,
    botSkill: isBot ? rand(0.58, 0.9) : 1,
    socketId: isBot ? null : socketId
  };
}

function assignTeamsFresh(room) {
  const players = [...room.players.values()].sort((a, b) => Number(a.isBot) - Number(b.isBot));
  if (room.mode === 'solo') {
    players.forEach((player, index) => { player.teamId = index + 1; });
    return;
  }
  const teamSize = MODES[room.mode].teamSize;
  players.forEach((player, index) => { player.teamId = Math.floor(index / teamSize) + 1; });
}

function cyclePlayerTeam(room, player) {
  if (room.mode === 'solo') return;
  const teamSize = MODES[room.mode].teamSize;
  const maxTeams = Math.max(2, Math.ceil(room.players.size / teamSize));
  for (let offset = 1; offset <= maxTeams; offset++) {
    const next = ((player.teamId - 1 + offset) % maxTeams) + 1;
    const count = [...room.players.values()].filter(p => p.id !== player.id && p.teamId === next).length;
    if (count < teamSize) {
      player.teamId = next;
      return;
    }
  }
}

function createRoom(hostSocket, name) {
  const code = createRoomCode();
  const player = makePlayer(hostSocket.id, name);
  const room = {
    code,
    hostId: hostSocket.id,
    mode: 'solo',
    state: 'lobby',
    createdAt: now(),
    countdownEnd: 0,
    players: new Map([[player.id, player]]),
    world: null,
    plane: null,
    bullets: [],
    items: [],
    zone: null,
    startedWith: 0,
    resultAt: 0
  };
  assignTeamsFresh(room);
  rooms.set(code, room);
  hostSocket.join(code);
  hostSocket.data.roomCode = code;
  return room;
}

function lobbyPayload(room) {
  return {
    code: room.code,
    state: room.state,
    hostId: room.hostId,
    mode: room.mode,
    modeLabel: MODES[room.mode].label,
    teamSize: MODES[room.mode].teamSize,
    countdownEnd: room.countdownEnd,
    maxPlayers: MAX_PLAYERS,
    players: [...room.players.values()].map(p => ({
      id: p.id,
      name: p.name,
      isBot: p.isBot,
      isHost: p.id === room.hostId,
      connected: p.connected,
      teamId: p.teamId
    }))
  };
}

function emitLobby(room) {
  io.to(room.code).emit('lobbyState', lobbyPayload(room));
}

function makeHouse(x, y, w, h, doorSide = 'bottom', style = 'house') {
  const thickness = 16;
  const doorSize = 64;
  const walls = [];
  const halfDoor = doorSize / 2;
  if (doorSide === 'bottom' || doorSide === 'top') {
    const doorY = doorSide === 'bottom' ? y + h - thickness : y;
    const otherY = doorSide === 'bottom' ? y : y + h - thickness;
    walls.push({ x, y: otherY, w, h: thickness });
    walls.push({ x, y, w: thickness, h });
    walls.push({ x: x + w - thickness, y, w: thickness, h });
    walls.push({ x, y: doorY, w: w / 2 - halfDoor, h: thickness });
    walls.push({ x: x + w / 2 + halfDoor, y: doorY, w: w / 2 - halfDoor, h: thickness });
  } else {
    const doorX = doorSide === 'right' ? x + w - thickness : x;
    const otherX = doorSide === 'right' ? x : x + w - thickness;
    walls.push({ x, y, w, h: thickness });
    walls.push({ x, y: y + h - thickness, w, h: thickness });
    walls.push({ x: otherX, y, w: thickness, h });
    walls.push({ x: doorX, y, w: thickness, h: h / 2 - halfDoor });
    walls.push({ x: doorX, y: y + h / 2 + halfDoor, w: thickness, h: h / 2 - halfDoor });
  }
  let doorOutside;
  let doorInside;
  if (doorSide === 'bottom') {
    doorOutside = { x: x + w / 2, y: y + h + 30 };
    doorInside = { x: x + w / 2, y: y + h - 38 };
  } else if (doorSide === 'top') {
    doorOutside = { x: x + w / 2, y: y - 30 };
    doorInside = { x: x + w / 2, y: y + 38 };
  } else if (doorSide === 'right') {
    doorOutside = { x: x + w + 30, y: y + h / 2 };
    doorInside = { x: x + w - 38, y: y + h / 2 };
  } else {
    doorOutside = { x: x - 30, y: y + h / 2 };
    doorInside = { x: x + 38, y: y + h / 2 };
  }
  return { id: id('h'), x, y, w, h, doorSide, style, walls, doorOutside, doorInside };
}

function collidesCircleRect(x, y, radius, rect) {
  const cx = clamp(x, rect.x, rect.x + rect.w);
  const cy = clamp(y, rect.y, rect.y + rect.h);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy < radius * radius;
}

function collidesWorld(world, x, y, radius) {
  if (x - radius < 0 || y - radius < 0 || x + radius > WORLD || y + radius > WORLD) return true;
  for (const house of world.houses) {
    for (const wall of house.walls) if (collidesCircleRect(x, y, radius, wall)) return true;
  }
  for (const obstacle of world.obstacles) {
    const rr = radius + obstacle.r;
    const dx = x - obstacle.x;
    const dy = y - obstacle.y;
    if (dx * dx + dy * dy < rr * rr) return true;
  }
  return false;
}

function randomOpenPosition(world, margin = 100) {
  for (let i = 0; i < 300; i++) {
    const x = rand(margin, WORLD - margin);
    const y = rand(margin, WORLD - margin);
    if (!collidesWorld(world, x, y, 25)) return { x, y };
  }
  return { x: WORLD / 2, y: WORLD / 2 };
}

function generateWorld() {
  const houses = [];
  const obstacles = [];
  const chests = [];
  const townCenters = [
    { name: 'Neon Center', x: 2400, y: 2380, style: 'city' },
    { name: 'Pine Village', x: 820, y: 830, style: 'village' },
    { name: 'Harbor Point', x: 3910, y: 780, style: 'harbor' },
    { name: 'Dusty Depot', x: 950, y: 3750, style: 'industrial' },
    { name: 'Sunset Hills', x: 3820, y: 3790, style: 'suburb' },
    { name: 'Lakeview', x: 2450, y: 750, style: 'lake' },
    { name: 'Quarry Row', x: 2450, y: 4050, style: 'industrial' }
  ];
  const roads = [];
  const center = townCenters[0];
  for (let i = 1; i < townCenters.length; i++) {
    roads.push({ id: id('r'), x1: center.x, y1: center.y, x2: townCenters[i].x, y2: townCenters[i].y, width: 74 });
  }
  roads.push({ id: id('r'), x1: townCenters[1].x, y1: townCenters[1].y, x2: townCenters[5].x, y2: townCenters[5].y, width: 62 });
  roads.push({ id: id('r'), x1: townCenters[3].x, y1: townCenters[3].y, x2: townCenters[6].x, y2: townCenters[6].y, width: 62 });
  roads.push({ id: id('r'), x1: townCenters[2].x, y1: townCenters[2].y, x2: townCenters[4].x, y2: townCenters[4].y, width: 62 });

  const doorSides = ['bottom', 'top', 'left', 'right'];
  for (const town of townCenters) {
    const houseTotal = town.style === 'city' ? 8 : town.style === 'village' || town.style === 'suburb' ? 7 : 6;
    for (let i = 0; i < houseTotal; i++) {
      const large = town.style === 'industrial' && i % 3 === 0;
      const w = large ? randi(260, 340) : randi(175, 270);
      const h = large ? randi(210, 290) : randi(145, 225);
      const angle = (i / houseTotal) * Math.PI * 2 + rand(-0.18, 0.18);
      const ring = town.style === 'city' ? (i % 2 ? 330 : 520) : randi(260, 460);
      const x = clamp(town.x + Math.cos(angle) * ring - w / 2, 55, WORLD - w - 55);
      const y = clamp(town.y + Math.sin(angle) * ring - h / 2, 55, WORLD - h - 55);
      const house = makeHouse(x, y, w, h, pick(doorSides), town.style);
      houses.push(house);
      const chestCount = large ? randi(2, 3) : (Math.random() < 0.38 ? 2 : 1);
      for (let chestIndex = 0; chestIndex < chestCount; chestIndex++) {
        chests.push({
          id: id('c'),
          houseId: house.id,
          x: x + rand(50, w - 50),
          y: y + rand(50, h - 50),
          opened: false
        });
      }
    }
  }

  for (let i = 0; i < 165; i++) {
    const obstacle = {
      id: id('o'),
      kind: Math.random() < 0.67 ? 'tree' : 'rock',
      x: rand(70, WORLD - 70),
      y: rand(70, WORLD - 70),
      r: rand(24, 40)
    };
    let bad = false;
    for (const house of houses) {
      if (obstacle.x > house.x - 48 && obstacle.x < house.x + house.w + 48 && obstacle.y > house.y - 48 && obstacle.y < house.y + house.h + 48) {
        bad = true;
        break;
      }
    }
    if (!bad) obstacles.push(obstacle);
  }

  return { size: WORLD, houses, obstacles, chests, townCenters, roads };
}

function resetPlayerForMatch(player, plane, world) {
  player.x = plane.x;
  player.y = plane.y;
  player.angle = 0;
  player.phase = 'plane';
  player.fallProgress = 0;
  player.alive = true;
  player.health = 100;
  player.shield = 0;
  player.kills = 0;
  player.inventory = emptyInventory();
  player.ammo = emptyAmmo();
  player.activeSlot = 0;
  player.regenPool = 0;
  player.regenTickAt = 0;
  player.lastShotAt = 0;
  player.reloadStartedAt = 0;
  player.reloadUntil = 0;
  player.actionStartedAt = 0;
  player.actionUntil = 0;
  player.actionType = null;
  player.lastZoneDamageAt = 0;
  player.jumpDelay = rand(2.5, 9);
  player.botThinkAt = 0;
  player.botTarget = null;
  player.botLootTarget = null;
  player.botWander = randomOpenPosition(world, 120);
  player.botStrafeDirection = Math.random() < 0.5 ? -1 : 1;
  player.botStrafeUntil = 0;
  player.botAimError = 0;
  player.dropTarget = pick(world.townCenters);
}

function startMatch(room) {
  room.state = 'plane';
  room.world = generateWorld();
  room.items = [];
  room.bullets = [];
  const horizontal = Math.random() < 0.5;
  room.plane = horizontal
    ? { x: -260, y: rand(800, WORLD - 800), vx: 320, vy: 0, startedAt: now(), finished: false }
    : { x: rand(800, WORLD - 800), y: -260, vx: 0, vy: 320, startedAt: now(), finished: false };
  room.zone = {
    x: WORLD / 2 + rand(-180, 180),
    y: WORLD / 2 + rand(-180, 180),
    radius: 2250,
    startRadius: 2250,
    targetRadius: 220,
    shrinkStartsAt: now() + 45000,
    shrinkEndsAt: now() + 245000
  };
  room.startedWith = room.players.size;
  room.resultAt = 0;
  for (const player of room.players.values()) resetPlayerForMatch(player, room.plane, room.world);
  io.to(room.code).emit('gameStarted', {
    roomCode: room.code,
    mode: room.mode,
    world: room.world,
    weapons: WEAPONS,
    rarities: RARITIES,
    ammoLabels: AMMO_LABELS,
    plane: room.plane,
    zone: room.zone
  });
  emitLobby(room);
}

function startCountdown(room) {
  room.state = 'countdown';
  room.countdownEnd = now() + 8000;
  emitLobby(room);
}

function activeWeapon(player) {
  const item = player.inventory[player.activeSlot] || null;
  return isWeaponItem(item) ? item : null;
}

function activeConsumable(player) {
  const item = player.inventory[player.activeSlot] || null;
  return isConsumableItem(item) ? item : null;
}

function cancelReload(player) {
  player.reloadStartedAt = 0;
  player.reloadUntil = 0;
}

function cancelAction(player) {
  player.actionStartedAt = 0;
  player.actionUntil = 0;
  player.actionType = null;
}

function tryReload(player) {
  const weapon = activeWeapon(player);
  if (!weapon || player.reloadUntil > now() || player.actionUntil > now()) return;
  const def = resolvedWeaponDef(weapon);
  const reserve = player.ammo[def.ammoType] || 0;
  if (weapon.ammo >= def.magazine || reserve <= 0) return;
  player.reloadStartedAt = now();
  player.reloadUntil = now() + def.reload;
}

function finishReload(player) {
  const weapon = activeWeapon(player);
  if (!weapon) return cancelReload(player);
  const def = resolvedWeaponDef(weapon);
  const need = def.magazine - weapon.ammo;
  const moved = Math.min(need, player.ammo[def.ammoType] || 0);
  weapon.ammo += moved;
  player.ammo[def.ammoType] -= moved;
  cancelReload(player);
}

function completeAction(player) {
  const type = player.actionType;
  if (type === 'bandage' && countConsumable(player, type) > 0 && player.health < 100) {
    if (consumeOne(player, type)) player.health = Math.min(75, player.health + 25);
  } else if (type === 'medkit' && countConsumable(player, type) > 0 && player.health < 100) {
    if (consumeOne(player, type)) player.health = 100;
  } else if (type === 'smallShield' && countConsumable(player, type) > 0 && player.shield < 100) {
    if (consumeOne(player, type)) player.shield = Math.min(50, player.shield + 25);
  } else if (type === 'bigShield' && countConsumable(player, type) > 0 && player.shield < 100) {
    if (consumeOne(player, type)) player.shield = Math.min(100, player.shield + 50);
  } else if (type === 'fusionJuice' && countConsumable(player, type) > 0 && (player.health < 100 || player.shield < 100)) {
    if (consumeOne(player, type)) {
      player.regenPool = Math.min(150, player.regenPool + 75);
      player.regenTickAt = now();
    }
  }
  cancelAction(player);
}

function startConsumable(player, type) {
  if (!player.alive || player.phase !== 'landed' || player.reloadUntil > now() || player.actionUntil > now()) return false;
  const def = CONSUMABLES[type];
  if (!def || countConsumable(player, type) <= 0) return false;
  const valid = {
    bandage: player.health < 75,
    medkit: player.health < 100,
    smallShield: player.shield < 50,
    bigShield: player.shield < 100,
    fusionJuice: player.health < 100 || player.shield < 100
  };
  if (!valid[type]) return false;
  player.actionType = type;
  player.actionStartedAt = now();
  player.actionUntil = now() + def.duration;
  return true;
}

function useActiveConsumable(player) {
  const item = activeConsumable(player);
  if (!item) return false;
  return startConsumable(player, item.type);
}

function useBestHealth(player) {
  if (countConsumable(player, 'medkit') > 0 && player.health <= 50) return startConsumable(player, 'medkit');
  if (countConsumable(player, 'bandage') > 0 && player.health < 75) return startConsumable(player, 'bandage');
  if (countConsumable(player, 'medkit') > 0 && player.health < 100) return startConsumable(player, 'medkit');
  return false;
}

function useBestShield(player) {
  if (countConsumable(player, 'smallShield') > 0 && player.shield < 50) return startConsumable(player, 'smallShield');
  if (countConsumable(player, 'bigShield') > 0 && player.shield < 100) return startConsumable(player, 'bigShield');
  return false;
}

function useBestFusion(player) {
  if (countConsumable(player, 'fusionJuice') > 0 && (player.health < 100 || player.shield < 100)) return startConsumable(player, 'fusionJuice');
  return false;
}

function tryShoot(room, player) {
  if (!player.alive || player.phase !== 'landed') return;
  const weapon = activeWeapon(player);
  if (!weapon || player.reloadUntil > now() || player.actionUntil > now()) return;
  const def = resolvedWeaponDef(weapon);
  if (weapon.ammo <= 0) {
    tryReload(player);
    return;
  }
  const t = now();
  if (t - player.lastShotAt < def.cooldown) return;
  player.lastShotAt = t;
  weapon.ammo -= 1;

  for (let i = 0; i < def.pellets; i++) {
    const angle = player.angle + rand(-def.spread, def.spread);
    room.bullets.push({
      id: id('b'),
      ownerId: player.id,
      ownerTeamId: player.teamId,
      x: player.x + Math.cos(angle) * 25,
      y: player.y + Math.sin(angle) * 25,
      vx: Math.cos(angle) * def.speed,
      vy: Math.sin(angle) * def.speed,
      damage: def.damage,
      life: def.range / def.speed,
      type: weapon.type,
      rarity: weapon.rarity
    });
  }
}

function sameTeam(room, a, b) {
  return room.mode !== 'solo' && a.teamId === b.teamId;
}

function applyDamage(target, amount, attacker, room) {
  if (!target.alive || (attacker && sameTeam(room, target, attacker))) return;
  cancelAction(target);
  const shieldHit = Math.min(target.shield, amount);
  target.shield -= shieldHit;
  target.health -= amount - shieldHit;
  if (target.health <= 0) {
    target.health = 0;
    target.alive = false;
    target.phase = 'eliminated';
    target.regenPool = 0;
    cancelReload(target);
    cancelAction(target);
    if (attacker && attacker.id !== target.id) attacker.kills += 1;
    dropPlayerLoot(room, target);
  }
}

function spawnGroundItem(room, base, item) {
  room.items.push({ id: id('i'), ...base, ...item });
}

function dropPlayerLoot(room, player) {
  const offsets = [[-42, -10], [0, -18], [42, -10], [-28, 32], [28, 32]];
  player.inventory.forEach((item, index) => {
    if (!item) return;
    const base = { x: player.x + offsets[index][0], y: player.y + offsets[index][1] };
    if (isWeaponItem(item)) spawnGroundItem(room, base, { type: 'weapon', weapon: { ...item } });
    else if (isConsumableItem(item)) spawnGroundItem(room, base, { type: item.type, amount: item.amount });
  });
  for (const [ammoType, amount] of Object.entries(player.ammo)) {
    if (amount > 0) spawnGroundItem(room, { x: player.x + rand(-48, 48), y: player.y + rand(52, 78) }, { type: 'ammo', ammoType, amount: Math.min(80, amount) });
  }
}

function spawnWeaponLoot(room, chest, slotIndex = 0) {
  const type = randomWeaponType();
  const rarity = randomRarity();
  const def = WEAPONS[type];
  const angle = rand(0, Math.PI * 2);
  const d = 34 + slotIndex * 12;
  spawnGroundItem(
    room,
    { x: chest.x + Math.cos(angle) * d, y: chest.y + Math.sin(angle) * d, houseId: chest.houseId || null },
    {
      type: 'weapon',
      weapon: makeWeaponItem(type, rarity, def.magazine),
      bonusAmmo: Math.max(def.magazine, randi(Math.ceil(def.magazine * 0.8), Math.ceil(def.magazine * 1.8)))
    }
  );
  return def.ammoType;
}

function spawnChestLoot(room, chest) {
  // Every chest always gives at least one weapon.
  const primaryAmmoType = spawnWeaponLoot(room, chest, 0);
  const bonusRolls = randi(1, 3);
  for (let i = 0; i < bonusRolls; i++) {
    const roll = Math.random();
    const angle = rand(0, Math.PI * 2);
    const d = 48 + i * 14;
    const base = { x: chest.x + Math.cos(angle) * d, y: chest.y + Math.sin(angle) * d, houseId: chest.houseId || null };
    if (roll < 0.34) {
      const amount = primaryAmmoType === 'shells' ? randi(8, 18) : primaryAmmoType === 'heavy' ? randi(6, 14) : randi(24, 50);
      spawnGroundItem(room, base, { type: 'ammo', ammoType: primaryAmmoType, amount });
    } else if (roll < 0.49) {
      spawnGroundItem(room, base, { type: 'bandage', amount: randi(1, 3) });
    } else if (roll < 0.59) {
      spawnGroundItem(room, base, { type: 'medkit', amount: 1 });
    } else if (roll < 0.76) {
      // A small-shield chest drop is always a stack of three.
      spawnGroundItem(room, base, { type: 'smallShield', amount: 3 });
    } else if (roll < 0.87) {
      spawnGroundItem(room, base, { type: 'bigShield', amount: 1 });
    } else if (roll < 0.95) {
      spawnGroundItem(room, base, { type: 'fusionJuice', amount: 1 });
    } else {
      spawnWeaponLoot(room, chest, i + 1);
    }
  }
}

const RARITY_VALUE = { common: 1, uncommon: 2, rare: 3, epic: 4, legendary: 5, mythic: 6 };

function equipmentScore(weapon) {
  if (!isWeaponItem(weapon)) return 0;
  const def = WEAPONS[weapon.type];
  const rarity = RARITY_VALUE[weapon.rarity] || 1;
  return rarity * 100 + def.damage * def.pellets * 1.8 + def.magazine * 0.7 + (1200 / Math.max(70, def.cooldown));
}

function botWeaponSlot(player, incoming) {
  const empty = player.inventory.findIndex(value => !value);
  if (empty >= 0) return empty;
  let worstIndex = -1;
  let worstScore = Infinity;
  player.inventory.forEach((item, index) => {
    if (!isWeaponItem(item)) return;
    const score = equipmentScore(item);
    if (score < worstScore) {
      worstScore = score;
      worstIndex = index;
    }
  });
  if (worstIndex >= 0 && equipmentScore(incoming) > worstScore * 1.04) return worstIndex;
  if (!hasWeapon(player)) return player.inventory.findIndex(isConsumableItem);
  return -1;
}

function pointInsideHouse(point, house, margin = 0) {
  return point.x > house.x + margin && point.x < house.x + house.w - margin && point.y > house.y + margin && point.y < house.y + house.h - margin;
}

function inventoryDropForItem(room, player, item, x = player.x, y = player.y) {
  if (!item) return;
  if (isWeaponItem(item)) spawnGroundItem(room, { x, y }, { type: 'weapon', weapon: { ...item } });
  else if (isConsumableItem(item)) spawnGroundItem(room, { x, y }, { type: item.type, amount: item.amount });
}

function pickupWeapon(room, player, item) {
  let slot = player.isBot ? botWeaponSlot(player, item.weapon) : player.inventory.findIndex(value => !value);
  if (!player.isBot && slot < 0) slot = player.activeSlot;
  if (slot < 0) return false;
  if (!player.isBot && player.inventory[slot]) inventoryDropForItem(room, player, player.inventory[slot], item.x, item.y);
  const def = WEAPONS[item.weapon.type];
  player.inventory[slot] = { ...item.weapon, kind: 'weapon' };
  player.ammo[def.ammoType] = Math.min(999, (player.ammo[def.ammoType] || 0) + (item.bonusAmmo || Math.ceil(def.magazine * 0.8)));
  player.activeSlot = slot;
  cancelReload(player);
  cancelAction(player);
  return true;
}

function interact(room, player) {
  if (!player.alive || player.phase !== 'landed' || player.actionUntil > now()) return;
  let nearestChest = null;
  let nearestChestDist = 78;
  for (const chest of room.world.chests) {
    if (chest.opened) continue;
    const d = distance(player, chest);
    if (d < nearestChestDist) {
      nearestChestDist = d;
      nearestChest = chest;
    }
  }
  if (nearestChest) {
    nearestChest.opened = true;
    spawnChestLoot(room, nearestChest);
    return;
  }

  let itemIndex = -1;
  let itemDist = 72;
  for (let i = 0; i < room.items.length; i++) {
    const d = distance(player, room.items[i]);
    if (d < itemDist) {
      itemDist = d;
      itemIndex = i;
    }
  }
  if (itemIndex < 0) return;
  const item = room.items[itemIndex];
  let picked = false;
  if (item.type === 'weapon') {
    picked = pickupWeapon(room, player, item);
  } else if (CONSUMABLES[item.type]) {
    const moved = addConsumableToInventory(player, item.type, item.amount || 1);
    if (moved > 0) {
      item.amount = (item.amount || 1) - moved;
      picked = item.amount <= 0;
    }
  } else if (item.type === 'ammo') {
    player.ammo[item.ammoType] = Math.min(999, (player.ammo[item.ammoType] || 0) + (item.amount || 20));
    picked = true;
  }
  if (picked) room.items.splice(itemIndex, 1);
}

function jumpFromPlane(room, player) {
  if (!player.alive || player.phase !== 'plane') return;
  player.phase = 'falling';
  player.x = room.plane.x;
  player.y = room.plane.y;
  player.fallProgress = 0;
}

function movePlayer(room, player, dt) {
  if (!player.alive || (player.phase !== 'landed' && player.phase !== 'falling')) return;
  let dx = Number(player.input.right) - Number(player.input.left);
  let dy = Number(player.input.down) - Number(player.input.up);
  const moving = dx !== 0 || dy !== 0;
  if (moving && player.actionUntil > now()) cancelAction(player);
  const length = Math.hypot(dx, dy) || 1;
  dx /= length;
  dy /= length;
  const speed = player.phase === 'falling' ? 150 : 235;
  const nx = player.x + dx * speed * dt;
  const ny = player.y + dy * speed * dt;
  if (player.phase === 'falling') {
    player.x = clamp(nx, 20, WORLD - 20);
    player.y = clamp(ny, 20, WORLD - 20);
  } else {
    if (!collidesWorld(room.world, nx, player.y, player.radius)) player.x = nx;
    if (!collidesWorld(room.world, player.x, ny, player.radius)) player.y = ny;
  }
  player.angle = Number.isFinite(player.input.angle) ? player.input.angle : player.angle;
}

function hasWeapon(player) {
  return player.inventory.some(isWeaponItem);
}

function itemUsefulForBot(bot, item) {
  if (item.type === 'weapon') return botWeaponSlot(bot, item.weapon) >= 0;
  if (item.type === 'ammo') return true;
  if (CONSUMABLES[item.type]) {
    const current = countConsumable(bot, item.type);
    const free = bot.inventory.some(value => !value);
    return free || current < CONSUMABLES[item.type].maxStack;
  }
  return false;
}

function botLootPriority(bot, item) {
  if (item.type === 'weapon') return !hasWeapon(bot) ? 1400 : 480 + equipmentScore(item.weapon) * .34;
  if (item.type === 'fusionJuice') return (200 - bot.health - bot.shield) * 3 + 390;
  if (item.type === 'smallShield' || item.type === 'bigShield') return (100 - bot.shield) * 3 + 300;
  if (item.type === 'medkit' || item.type === 'bandage') return (100 - bot.health) * 3 + 260;
  if (item.type === 'ammo') return 190;
  return 0;
}

function nearestLootTarget(room, bot) {
  let target = null;
  let bestScore = -Infinity;
  for (const item of room.items) {
    if (!itemUsefulForBot(bot, item)) continue;
    const d = distance(bot, item);
    if (d > 1750) continue;
    const score = botLootPriority(bot, item) - d * .48;
    if (score > bestScore) {
      bestScore = score;
      target = item;
    }
  }
  for (const chest of room.world.chests) {
    if (chest.opened) continue;
    const d = distance(bot, chest);
    if (d > 2200) continue;
    const score = (!hasWeapon(bot) ? 1500 : 300) - d * .4;
    if (score > bestScore) {
      bestScore = score;
      target = chest;
    }
  }
  return target;
}

function findNearestEnemy(room, bot, maxDistance = 1600) {
  let target = null;
  let best = maxDistance;
  for (const other of room.players.values()) {
    if (!other.alive || other.id === bot.id || other.phase !== 'landed' || sameTeam(room, bot, other)) continue;
    const d = distance(bot, other);
    if (d < best) {
      best = d;
      target = other;
    }
  }
  return target;
}

function setBotMovement(bot, target, stopDistance = 30) {
  const dx = target.x - bot.x;
  const dy = target.y - bot.y;
  const d = Math.hypot(dx, dy);
  bot.input.angle = Math.atan2(dy, dx);
  bot.input.left = dx < -stopDistance;
  bot.input.right = dx > stopDistance;
  bot.input.up = dy < -stopDistance;
  bot.input.down = dy > stopDistance;
  return d;
}

function stopBotMovement(bot) {
  bot.input.up = false;
  bot.input.down = false;
  bot.input.left = false;
  bot.input.right = false;
}

function botSelectSlot(bot, targetDistance) {
  let bestIndex = -1;
  let bestScore = -Infinity;
  bot.inventory.forEach((weapon, index) => {
    if (!isWeaponItem(weapon)) return;
    const def = resolvedWeaponDef(weapon);
    const reserve = bot.ammo[def.ammoType] || 0;
    if (weapon.ammo <= 0 && reserve <= 0) return;
    let role = 0;
    if (targetDistance < 240) role = def.category === 'Scatter' ? 300 : def.category === 'Rapid' ? 210 : 70;
    else if (targetDistance < 700) role = def.category === 'Rapid' ? 250 : def.category === 'Pulse' ? 230 : 90;
    else role = def.category === 'Longshot' ? 430 : def.category === 'Pulse' ? 230 : 20;
    const score = role + equipmentScore(weapon);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });
  if (bestIndex >= 0 && bot.activeSlot !== bestIndex) {
    bot.activeSlot = bestIndex;
    cancelReload(bot);
    cancelAction(bot);
  }
}

function hasLineOfSight(world, a, b) {
  const d = distance(a, b);
  const steps = Math.min(28, Math.max(3, Math.ceil(d / 60)));
  for (let i = 2; i < steps - 1; i++) {
    const t = i / steps;
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t;
    if (collidesWorld(world, x, y, 4)) return false;
  }
  return true;
}

function botCanRecover(bot, nearbyEnemyDistance) {
  return nearbyEnemyDistance > 430 && bot.actionUntil <= now() && bot.reloadUntil <= now();
}

function botTryRecovery(bot, nearbyEnemyDistance) {
  if (!botCanRecover(bot, nearbyEnemyDistance) || bot.regenPool > 0) return false;
  const missingTotal = (100 - bot.health) + (100 - bot.shield);
  if (countConsumable(bot, 'fusionJuice') > 0 && missingTotal >= 65) return startConsumable(bot, 'fusionJuice');
  if (bot.health <= 45 && countConsumable(bot, 'medkit') > 0) return startConsumable(bot, 'medkit');
  if (bot.health < 75 && countConsumable(bot, 'bandage') > 0) return startConsumable(bot, 'bandage');
  if (bot.shield < 50 && countConsumable(bot, 'smallShield') > 0) return startConsumable(bot, 'smallShield');
  if (bot.shield < 100 && countConsumable(bot, 'bigShield') > 0) return startConsumable(bot, 'bigShield');
  return false;
}

function estimatedTargetPoint(target, projectileSpeed, shooterDistance) {
  const moveX = Number(target.input.right) - Number(target.input.left);
  const moveY = Number(target.input.down) - Number(target.input.up);
  const length = Math.hypot(moveX, moveY) || 1;
  const leadSeconds = clamp(shooterDistance / Math.max(700, projectileSpeed), 0, .65);
  return {
    x: target.x + (moveX / length) * 235 * leadSeconds,
    y: target.y + (moveY / length) * 235 * leadSeconds
  };
}

function botCombatMovement(bot, target, distanceToTarget, preferredDistance) {
  const dx = target.x - bot.x;
  const dy = target.y - bot.y;
  const angle = Math.atan2(dy, dx);
  if (now() >= bot.botStrafeUntil) {
    bot.botStrafeUntil = now() + randi(700, 1500);
    if (Math.random() < .45) bot.botStrafeDirection *= -1;
  }
  let moveAngle;
  if (distanceToTarget > preferredDistance + 100) moveAngle = angle;
  else if (distanceToTarget < preferredDistance - 90) moveAngle = angle + Math.PI;
  else moveAngle = angle + bot.botStrafeDirection * Math.PI / 2;
  const x = Math.cos(moveAngle);
  const y = Math.sin(moveAngle);
  bot.input.left = x < -.18;
  bot.input.right = x > .18;
  bot.input.up = y < -.18;
  bot.input.down = y > .18;
}

function updateBot(room, bot) {
  if (!bot.alive) return;
  if (bot.actionUntil > now()) {
    stopBotMovement(bot);
    bot.input.shoot = false;
    return;
  }
  const elapsed = (now() - room.plane.startedAt) / 1000;
  if (bot.phase === 'plane' && elapsed >= bot.jumpDelay) jumpFromPlane(room, bot);
  if (bot.phase === 'falling') {
    setBotMovement(bot, bot.dropTarget, 15);
    bot.input.shoot = false;
    return;
  }
  if (bot.phase !== 'landed') return;

  const closestEnemy = findNearestEnemy(room, bot, 1700);
  const enemyDistance = closestEnemy ? distance(bot, closestEnemy) : Infinity;
  const outsideZone = room.zone && distance(bot, room.zone) > room.zone.radius - 100;

  if (botTryRecovery(bot, enemyDistance)) {
    stopBotMovement(bot);
    bot.input.shoot = false;
    return;
  }

  if (now() >= bot.botThinkAt) {
    bot.botThinkAt = now() + randi(100, 190);
    bot.botTarget = hasWeapon(bot) && closestEnemy ? closestEnemy.id : null;
    bot.botLootTarget = (!bot.botTarget || enemyDistance > 1150) ? nearestLootTarget(room, bot) : null;
    bot.botAimError = rand(-1, 1) * (1 - bot.botSkill) * .16;
    if (!bot.botTarget && !bot.botLootTarget && distance(bot, bot.botWander) < 90) bot.botWander = randomOpenPosition(room.world, 150);
  }

  const target = bot.botTarget ? room.players.get(bot.botTarget) : null;
  if (target && target.alive && !sameTeam(room, bot, target)) {
    const d = distance(bot, target);
    botSelectSlot(bot, d);
    const weapon = activeWeapon(bot);
    if (weapon) {
      const def = resolvedWeaponDef(weapon);
      const visible = hasLineOfSight(room.world, bot, target);
      const preferred = def.category === 'Scatter' ? 185 : def.category === 'Rapid' ? 320 : def.category === 'Longshot' ? 900 : 540;
      if (visible) botCombatMovement(bot, target, d, preferred);
      else setBotMovement(bot, target, 45);
      const aimPoint = estimatedTargetPoint(target, def.speed, d);
      bot.input.angle = Math.atan2(aimPoint.y - bot.y, aimPoint.x - bot.x) + bot.botAimError;
      bot.input.shoot = visible && d < def.range * .97;
      if (weapon.ammo <= 0) {
        bot.input.shoot = false;
        tryReload(bot);
      }
      if (outsideZone && d > 500) {
        setBotMovement(bot, room.zone, 45);
        bot.input.shoot = false;
      }
      return;
    }
    bot.botTarget = null;
  }

  bot.input.shoot = false;
  if (outsideZone) {
    setBotMovement(bot, room.zone, 40);
    return;
  }

  if (bot.botLootTarget) {
    const liveTarget = room.items.find(item => item.id === bot.botLootTarget.id)
      || room.world.chests.find(chest => chest.id === bot.botLootTarget.id && !chest.opened);
    if (liveTarget) {
      const house = liveTarget.houseId ? room.world.houses.find(value => value.id === liveTarget.houseId) : null;
      if (house && !pointInsideHouse(bot, house, 8)) {
        const dDoor = setBotMovement(bot, house.doorOutside, 14);
        if (dDoor < 42) setBotMovement(bot, house.doorInside, 10);
      } else {
        const d = setBotMovement(bot, liveTarget, 16);
        if (d < 74) interact(room, bot);
      }
    } else {
      bot.botLootTarget = null;
    }
  } else {
    setBotMovement(bot, bot.botWander, 30);
  }

  const weapon = activeWeapon(bot);
  if (weapon) {
    const def = resolvedWeaponDef(weapon);
    if (weapon.ammo <= 0 || (weapon.ammo < Math.max(2, Math.floor(def.magazine * .24)) && enemyDistance > 520)) tryReload(bot);
  }
}

function aliveTeams(room) {
  return new Set([...room.players.values()].filter(p => p.alive).map(p => p.teamId));
}

function allAssignedTeams(room) {
  return new Set([...room.players.values()].map(p => p.teamId));
}

function updateRoom(room, dt) {
  const t = now();
  if (room.state === 'countdown' && t >= room.countdownEnd) startMatch(room);
  if (!['plane', 'playing'].includes(room.state)) return;

  if (room.plane && !room.plane.finished) {
    room.plane.x += room.plane.vx * dt;
    room.plane.y += room.plane.vy * dt;
    const out = room.plane.x > WORLD + 230 || room.plane.y > WORLD + 230;
    if (out) {
      room.plane.finished = true;
      for (const player of room.players.values()) if (player.phase === 'plane') jumpFromPlane(room, player);
    }
  }

  let anyFalling = false;
  for (const player of room.players.values()) {
    if (player.isBot) updateBot(room, player);
    if (player.reloadUntil && t >= player.reloadUntil) finishReload(player);
    if (player.actionUntil && t >= player.actionUntil) completeAction(player);
    if (player.alive && player.regenPool > 0 && t >= player.regenTickAt) {
      player.regenTickAt = t + 250;
      const amount = Math.min(3, player.regenPool);
      let remaining = amount;
      if (player.health < 100) {
        const healed = Math.min(remaining, 100 - player.health);
        player.health += healed;
        remaining -= healed;
      }
      if (remaining > 0 && player.shield < 100) {
        const shielded = Math.min(remaining, 100 - player.shield);
        player.shield += shielded;
        remaining -= shielded;
      }
      player.regenPool -= amount - remaining;
      if ((player.health >= 100 && player.shield >= 100) || player.regenPool <= 0) player.regenPool = 0;
    }
    if (player.phase === 'plane') {
      player.x = room.plane.x;
      player.y = room.plane.y;
    } else if (player.phase === 'falling') {
      anyFalling = true;
      player.fallProgress += dt / 2.5;
      movePlayer(room, player, dt);
      if (player.fallProgress >= 1) {
        player.fallProgress = 1;
        player.phase = 'landed';
        if (collidesWorld(room.world, player.x, player.y, player.radius)) {
          const pos = randomOpenPosition(room.world, 80);
          player.x = pos.x;
          player.y = pos.y;
        }
      }
    } else if (player.phase === 'landed') {
      movePlayer(room, player, dt);
      if (player.input.shoot) tryShoot(room, player);
    }
  }
  if (room.state === 'plane' && room.plane.finished && !anyFalling) room.state = 'playing';

  for (let i = room.bullets.length - 1; i >= 0; i--) {
    const bullet = room.bullets[i];
    bullet.x += bullet.vx * dt;
    bullet.y += bullet.vy * dt;
    bullet.life -= dt;
    let remove = bullet.life <= 0 || collidesWorld(room.world, bullet.x, bullet.y, 4);
    if (!remove) {
      const attacker = room.players.get(bullet.ownerId);
      for (const target of room.players.values()) {
        if (!target.alive || target.id === bullet.ownerId || target.phase !== 'landed') continue;
        if (attacker && sameTeam(room, attacker, target)) continue;
        const rr = target.radius + 5;
        const dx = target.x - bullet.x;
        const dy = target.y - bullet.y;
        if (dx * dx + dy * dy <= rr * rr) {
          applyDamage(target, bullet.damage, attacker, room);
          remove = true;
          break;
        }
      }
    }
    if (remove) room.bullets.splice(i, 1);
  }

  if (room.zone) {
    if (t >= room.zone.shrinkStartsAt) {
      const progress = clamp((t - room.zone.shrinkStartsAt) / (room.zone.shrinkEndsAt - room.zone.shrinkStartsAt), 0, 1);
      room.zone.radius = room.zone.startRadius + (room.zone.targetRadius - room.zone.startRadius) * progress;
    }
    for (const player of room.players.values()) {
      if (!player.alive || player.phase !== 'landed') continue;
      if (distance(player, room.zone) > room.zone.radius && t - player.lastZoneDamageAt >= 1000) {
        player.lastZoneDamageAt = t;
        applyDamage(player, 5, null, room);
      }
    }
  }

  const livingTeams = aliveTeams(room);
  if (room.startedWith > 1 && livingTeams.size <= 1 && !room.resultAt) {
    room.resultAt = t;
    room.state = 'ended';
    const winningTeamId = [...livingTeams][0] || null;
    const winners = winningTeamId == null
      ? []
      : [...room.players.values()].filter(p => p.teamId === winningTeamId).map(p => ({ id: p.id, name: p.name, kills: p.kills }));
    io.to(room.code).emit('matchEnded', {
      mode: room.mode,
      winnerTeamId: winningTeamId,
      winners,
      totalKills: winners.reduce((sum, p) => sum + p.kills, 0)
    });
    setTimeout(() => {
      const current = rooms.get(room.code);
      if (!current || current.state !== 'ended') return;
      current.state = 'lobby';
      current.countdownEnd = 0;
      for (const p of current.players.values()) {
        p.phase = 'lobby';
        p.alive = true;
        p.health = 100;
        p.shield = 0;
      }
      emitLobby(current);
    }, 7000);
  }
}

function snapshot(room) {
  return {
    serverTime: now(),
    state: room.state,
    mode: room.mode,
    plane: room.plane,
    zone: room.zone,
    remainingTeams: aliveTeams(room).size,
    players: [...room.players.values()].map(p => ({
      id: p.id,
      name: p.name,
      isBot: p.isBot,
      isHost: p.id === room.hostId,
      teamId: p.teamId,
      x: p.x,
      y: p.y,
      angle: p.angle,
      phase: p.phase,
      fallProgress: p.fallProgress,
      alive: p.alive,
      health: p.health,
      shield: p.shield,
      kills: p.kills,
      inventory: p.inventory,
      ammo: p.ammo,
      activeSlot: p.activeSlot,
      consumables: Object.fromEntries(Object.keys(CONSUMABLES).map(type => [type, countConsumable(p, type)])),
      regenPool: p.regenPool,
      reloadStartedAt: p.reloadStartedAt,
      reloadUntil: p.reloadUntil,
      actionStartedAt: p.actionStartedAt,
      actionUntil: p.actionUntil,
      actionType: p.actionType
    })),
    bullets: room.bullets,
    items: room.items,
    chests: room.world ? room.world.chests.map(c => ({ id: c.id, opened: c.opened })) : []
  };
}

function leaveRoom(socket) {
  const code = socket.data.roomCode;
  if (!code) return;
  const room = rooms.get(code);
  socket.leave(code);
  socket.data.roomCode = null;
  if (!room) return;
  room.players.delete(socket.id);
  if (room.players.size === 0) {
    rooms.delete(code);
    return;
  }
  if (room.hostId === socket.id) {
    const nextHost = [...room.players.values()].find(p => !p.isBot) || room.players.values().next().value;
    room.hostId = nextHost.id;
  }
  if (room.state === 'lobby') assignTeamsFresh(room);
  emitLobby(room);
}

io.on('connection', socket => {
  socket.on('createRoom', (payload, ack = () => {}) => {
    leaveRoom(socket);
    const room = createRoom(socket, payload?.name);
    ack({ ok: true, room: lobbyPayload(room), playerId: socket.id });
    emitLobby(room);
  });

  socket.on('joinRoom', (payload, ack = () => {}) => {
    const code = String(payload?.code || '').trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) return ack({ ok: false, error: 'החדר לא נמצא' });
    if (room.state !== 'lobby') return ack({ ok: false, error: 'המשחק בחדר כבר התחיל' });
    if (room.players.size >= MAX_PLAYERS) return ack({ ok: false, error: 'החדר מלא' });
    leaveRoom(socket);
    const player = makePlayer(socket.id, payload?.name);
    room.players.set(player.id, player);
    assignTeamsFresh(room);
    socket.join(code);
    socket.data.roomCode = code;
    ack({ ok: true, room: lobbyPayload(room), playerId: socket.id });
    emitLobby(room);
  });

  socket.on('setMode', (mode, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.hostId !== socket.id || room.state !== 'lobby') return ack({ ok: false, error: 'רק מנהל החדר יכול לשנות מצב' });
    if (!MODES[mode]) return ack({ ok: false, error: 'מצב לא תקין' });
    room.mode = mode;
    assignTeamsFresh(room);
    emitLobby(room);
    ack({ ok: true });
  });

  socket.on('cycleTeam', (ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    const player = room?.players.get(socket.id);
    if (!room || !player || room.state !== 'lobby') return ack({ ok: false });
    cyclePlayerTeam(room, player);
    emitLobby(room);
    ack({ ok: true });
  });

  socket.on('addBot', (ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.hostId !== socket.id || room.state !== 'lobby') return ack({ ok: false });
    if (room.players.size >= MAX_PLAYERS) return ack({ ok: false, error: 'החדר מלא' });
    const bot = makePlayer(id('bot'), `Bot ${randi(10, 99)}`, true);
    room.players.set(bot.id, bot);
    assignTeamsFresh(room);
    emitLobby(room);
    ack({ ok: true });
  });

  socket.on('removeBot', (botId, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.hostId !== socket.id || room.state !== 'lobby') return ack({ ok: false });
    const bot = room.players.get(botId);
    if (!bot?.isBot) return ack({ ok: false });
    room.players.delete(botId);
    assignTeamsFresh(room);
    emitLobby(room);
    ack({ ok: true });
  });

  socket.on('startGame', (ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return ack({ ok: false, error: 'החדר לא קיים' });
    if (room.hostId !== socket.id) return ack({ ok: false, error: 'רק מנהל החדר יכול להתחיל' });
    if (room.state !== 'lobby') return ack({ ok: false, error: 'החדר לא במצב המתנה' });
    if (room.players.size < 2) return ack({ ok: false, error: 'צריך לפחות שני שחקנים או להוסיף בוט' });
    if (allAssignedTeams(room).size < 2) return ack({ ok: false, error: 'צריך לפחות שתי קבוצות שונות' });
    startCountdown(room);
    ack({ ok: true });
  });

  socket.on('input', input => {
    const room = rooms.get(socket.data.roomCode);
    const player = room?.players.get(socket.id);
    if (!player || player.isBot) return;
    const shoot = Boolean(input?.shoot);
    const pressedThisFrame = shoot && !player.input.shoot;
    if (pressedThisFrame && activeConsumable(player)) useActiveConsumable(player);
    player.input = {
      up: Boolean(input?.up),
      down: Boolean(input?.down),
      left: Boolean(input?.left),
      right: Boolean(input?.right),
      angle: Number(input?.angle) || 0,
      shoot
    };
  });

  socket.on('action', action => {
    const room = rooms.get(socket.data.roomCode);
    const player = room?.players.get(socket.id);
    if (!room || !player) return;
    switch (action?.type) {
      case 'jump': jumpFromPlane(room, player); break;
      case 'interact': interact(room, player); break;
      case 'reload': tryReload(player); break;
      case 'health': useBestHealth(player); break;
      case 'shield': useBestShield(player); break;
      case 'bandage': startConsumable(player, 'bandage'); break;
      case 'medkit': startConsumable(player, 'medkit'); break;
      case 'smallShield': startConsumable(player, 'smallShield'); break;
      case 'bigShield': startConsumable(player, 'bigShield'); break;
      case 'fusion': useBestFusion(player); break;
      case 'fusionJuice': startConsumable(player, 'fusionJuice'); break;
      case 'slot':
        player.activeSlot = clamp(Number(action.slot) || 0, 0, INVENTORY_SLOTS - 1);
        cancelReload(player);
        cancelAction(player);
        break;
    }
  });

  socket.on('leaveRoom', () => leaveRoom(socket));
  socket.on('disconnect', () => leaveRoom(socket));
});

let tickTimer = null;
let snapshotTimer = null;

function startServer() {
  if (!tickTimer) {
    tickTimer = setInterval(() => {
      for (const room of rooms.values()) updateRoom(room, DT);
    }, 1000 / TICK_RATE);
  }
  if (!snapshotTimer) {
    snapshotTimer = setInterval(() => {
      for (const room of rooms.values()) {
        if (['plane', 'playing', 'ended'].includes(room.state)) io.to(room.code).emit('snapshot', snapshot(room));
      }
    }, 1000 / SNAPSHOT_RATE);
  }
  return httpServer.listen(PORT, '0.0.0.0', () => {
    const localUrl = `http://localhost:${PORT}`;
    console.log('\nNeon Drop Royale server is running');
    console.log(`Local:   ${localUrl}`);
    for (const [name, list] of Object.entries(os.networkInterfaces())) {
      for (const net of list || []) {
        if (net.family === 'IPv4' && !net.internal) console.log(`${name.padEnd(8)} http://${net.address}:${PORT}`);
      }
    }
    console.log('\nKeep this window open while playing.\n');

    // Open the game automatically when launched manually with: node server.js
    if (require.main === module && process.platform === 'win32') {
      const { exec } = require('child_process');
      setTimeout(() => exec(`start "" "${localUrl}"`), 700);
    }
  });
}

if (require.main === module) startServer();

module.exports = {
  WORLD,
  MODES,
  RARITIES,
  WEAPONS,
  CONSUMABLES,
  makePlayer,
  makeWeaponItem,
  addConsumableToInventory,
  countConsumable,
  assignTeamsFresh,
  cyclePlayerTeam,
  spawnChestLoot,
  generateWorld,
  updateRoom,
  sameTeam,
  startServer,
  httpServer,
  io
};
