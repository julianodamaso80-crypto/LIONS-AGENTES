const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

async function runSchema() {
  const databaseUrl = process.env.URL_DO_BANCO_DE_DADOS;

  if (!databaseUrl) {
    console.error('ERRO: Variavel URL_DO_BANCO_DE_DADOS nao definida.');
    console.error('');
    console.error('Use assim:');
    console.error('  URL_DO_BANCO_DE_DADOS="postgresql://user:pass@host:port/db" node scripts/run-schema.js');
    process.exit(1);
  }

  const schemaPath = path.join(__dirname, '..', 'db', 'schema.sql');

  if (!fs.existsSync(schemaPath)) {
    console.error('ERRO: Arquivo db/schema.sql nao encontrado.');
    process.exit(1);
  }

  const sql = fs.readFileSync(schemaPath, 'utf-8');
  console.log(`Schema carregado: ${sql.length} caracteres`);

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
  });

  try {
    console.log('Conectando ao banco de dados...');
    const client = await pool.connect();
    console.log('Conectado com sucesso!');
    console.log('');
    console.log('Executando schema.sql...');

    await client.query(sql);

    console.log('');
    console.log('Schema executado com SUCESSO!');
    console.log('');

    // Listar tabelas criadas
    const tables = await client.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);
    console.log(`Tabelas no banco (${tables.rows.length}):`);
    tables.rows.forEach((r) => console.log(`  - ${r.table_name}`));

    client.release();
  } catch (err) {
    console.error('');
    console.error('ERRO ao executar schema:');
    console.error(err.message);
    if (err.position) {
      const lines = sql.substring(0, parseInt(err.position)).split('\n');
      console.error(`Linha aproximada: ${lines.length}`);
      console.error(`Contexto: ${lines[lines.length - 1]}`);
    }
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runSchema();
