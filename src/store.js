// Per-user settings (location and place name), persisted to a JSON file readable by the owner only.

const fs = require('fs');
const path = require('path');

const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, '..', 'data', 'connections.json');

function load(file = DATA_FILE) {
  try {
    return new Map(Object.entries(JSON.parse(fs.readFileSync(file, 'utf8'))));
  } catch (err) {
    if (err.code !== 'ENOENT') console.error(`Could not read ${file}: ${err.message}`);
    return new Map();
  }
}

function save(map, file = DATA_FILE) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(map), null, 2), { mode: 0o600 });
    fs.renameSync(tmp, file);
  } catch (err) {
    console.error(`Could not write ${file}: ${err.message}`);
  }
}

function createStore(file = DATA_FILE) {
  const map = load(file);
  return {
    get: (uuid) => map.get(uuid) || null,
    update(uuid, patch) {
      const next = { ...(map.get(uuid) || {}), ...patch, updated_at: new Date().toISOString() };
      map.set(uuid, next);
      save(map, file);
      return next;
    },
    delete(uuid) {
      if (map.delete(uuid)) save(map, file);
    },
    all: () => [...map.values()],
    size: () => map.size,
  };
}

module.exports = { createStore };
