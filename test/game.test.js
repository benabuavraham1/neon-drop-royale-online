'use strict';

const assert = require('node:assert/strict');
const {
  WORLD,
  WEAPONS,
  makePlayer,
  makeWeaponItem,
  addConsumableToInventory,
  countConsumable,
  assignTeamsFresh,
  cyclePlayerTeam,
  spawnChestLoot,
  generateWorld,
  updateRoom,
  sameTeam
} = require('../server');

function testLargerNamedMap() {
  const world = generateWorld();
  assert.equal(WORLD, 4800);
  assert.equal(world.size, 4800);
  assert.ok(world.townCenters.length >= 7, 'expected named towns');
  assert.ok(world.townCenters.every(town => typeof town.name === 'string' && town.name.length > 0));
  assert.ok(world.houses.length >= 40, 'expected many houses');
  assert.ok(world.chests.length >= world.houses.length, 'expected chests inside houses');
  assert.ok(world.roads.length >= 6, 'expected roads between towns');
}

function testChestAlwaysContainsWeapon() {
  for (let run = 0; run < 250; run++) {
    const room = { items: [] };
    spawnChestLoot(room, { x: 100, y: 100, houseId: 'house1' });
    const weapon = room.items.find(item => item.type === 'weapon');
    assert.ok(weapon, `run ${run} did not contain a weapon`);
    assert.equal(weapon.weapon.kind, 'weapon');
    assert.equal(weapon.houseId, 'house1');
  }
}

function testSmallShieldChestStacks() {
  let found = 0;
  for (let run = 0; run < 700; run++) {
    const room = { items: [] };
    spawnChestLoot(room, { x: 100, y: 100 });
    for (const item of room.items.filter(value => value.type === 'smallShield')) {
      found += 1;
      assert.equal(item.amount, 3, 'small shield chest drops must be stacks of three');
    }
  }
  assert.ok(found > 0, 'expected to observe at least one small shield chest drop');
}

function testHealsUseInventorySlotsAndStack() {
  const player = makePlayer('p', 'Player');
  assert.equal(addConsumableToInventory(player, 'smallShield', 3), 3);
  assert.equal(addConsumableToInventory(player, 'smallShield', 3), 3);
  assert.equal(countConsumable(player, 'smallShield'), 6);
  const shieldSlot = player.inventory.find(item => item?.type === 'smallShield');
  assert.deepEqual(shieldSlot, { kind: 'consumable', type: 'smallShield', amount: 6 });
  assert.equal(addConsumableToInventory(player, 'medkit', 2), 2);
  assert.ok(player.inventory.some(item => item?.kind === 'consumable' && item.type === 'medkit'));
}

function testSniperDamageIsMeaningfullyHigher() {
  assert.ok(WEAPONS.longshot.damage >= 120, 'longshot should remove a large amount of HP/shield');
  assert.ok(WEAPONS.longshot.damage >= WEAPONS.rangerPulse.damage * 5);
}

function testTeamAssignment() {
  const room = { mode: 'squad', players: new Map() };
  for (let i = 0; i < 9; i++) {
    const player = makePlayer(`p${i}`, `Player ${i}`, i >= 5);
    room.players.set(player.id, player);
  }
  assignTeamsFresh(room);
  const teams = [...room.players.values()].map(player => player.teamId);
  assert.deepEqual(teams.slice(0, 4), [1, 1, 1, 1]);
  assert.deepEqual(teams.slice(4, 8), [2, 2, 2, 2]);
  assert.equal(teams[8], 3);
}

function testTeamCyclingAndFriendlyFireRule() {
  const a = makePlayer('a', 'A');
  const b = makePlayer('b', 'B');
  const c = makePlayer('c', 'C');
  const room = { mode: 'duo', players: new Map([[a.id, a], [b.id, b], [c.id, c]]) };
  assignTeamsFresh(room);
  assert.equal(a.teamId, 1);
  assert.equal(b.teamId, 1);
  assert.equal(c.teamId, 2);
  assert.equal(sameTeam(room, a, b), true);
  cyclePlayerTeam(room, b);
  assert.equal(b.teamId, 2);
  assert.equal(sameTeam(room, a, b), false);
}

function testBotAcquiresTargetAndFires() {
  const bot = makePlayer('bot-test', 'Bot Test', true);
  const human = makePlayer('human-test', 'Human');
  bot.teamId = 1;
  human.teamId = 2;
  bot.phase = 'landed';
  human.phase = 'landed';
  bot.x = 1000;
  bot.y = 1000;
  human.x = 1320;
  human.y = 1000;
  bot.inventory[0] = makeWeaponItem('rangerPulse', 'common', 30);
  bot.ammo.medium = 90;
  bot.activeSlot = 0;
  bot.botThinkAt = 0;
  bot.botSkill = 1;

  const room = {
    code: 'TEST',
    mode: 'solo',
    state: 'playing',
    players: new Map([[bot.id, bot], [human.id, human]]),
    world: { size: WORLD, houses: [], obstacles: [], chests: [], townCenters: [], roads: [] },
    items: [],
    bullets: [],
    plane: { x: 0, y: 0, vx: 0, vy: 0, startedAt: Date.now() - 10000, finished: true },
    zone: { x: 2400, y: 2400, radius: 5000, startRadius: 5000, targetRadius: 5000, shrinkStartsAt: Date.now() + 100000, shrinkEndsAt: Date.now() + 200000 },
    startedWith: 2,
    resultAt: 0
  };

  updateRoom(room, 1 / 40);
  assert.ok(bot.lastShotAt > 0, 'bot should actively fire when it has a visible enemy');
  assert.ok(room.bullets.length > 0, 'bot shot should create a projectile');
}

testLargerNamedMap();
testChestAlwaysContainsWeapon();
testSmallShieldChestStacks();
testHealsUseInventorySlotsAndStack();
testSniperDamageIsMeaningfullyHigher();
testTeamAssignment();
testTeamCyclingAndFriendlyFireRule();
testBotAcquiresTargetAndFires();
console.log('All V6 game logic tests passed.');
