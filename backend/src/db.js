require('dotenv').config({ quiet: true });
const { Pool } = require('pg');

module.exports = new Pool({ connectionString: process.env.DATABASE_URL });