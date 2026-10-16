const { Pool } = require('pg');

let pool;
let ready;

function getPool() {
  if (!pool) {
    const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    const local = /localhost|127\.0\.0\.1/.test(url);
    pool = new Pool({
      connectionString: url,
      max: 3,
      idleTimeoutMillis: 10000,
      ssl: local ? false : { rejectUnauthorized: false }
    });
  }
  return pool;
}

// Creates the tables the first time the server talks to the database.
function init() {
  if (!ready) {
    const p = getPool();
    ready = p
      .query(`CREATE TABLE IF NOT EXISTS messages (
        id         SERIAL PRIMARY KEY,
        name       TEXT NOT NULL,
        email      TEXT NOT NULL,
        message    TEXT NOT NULL,
        is_read    BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`)
      .then(() =>
        p.query(`CREATE TABLE IF NOT EXISTS events (
          id         SERIAL PRIMARY KEY,
          visitor_id TEXT NOT NULL,
          kind       TEXT NOT NULL,
          section    TEXT,
          referrer   TEXT,
          device     TEXT,
          country    TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`)
      )
      .then(() => p.query('CREATE INDEX IF NOT EXISTS events_created_idx ON events (created_at)'))
      .catch((err) => {
        ready = null;
        throw err;
      });
  }
  return ready;
}

async function query(text, params) {
  await init();
  return getPool().query(text, params);
}

module.exports = { query };
