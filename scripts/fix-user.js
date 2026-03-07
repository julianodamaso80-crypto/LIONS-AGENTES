const { Pool } = require('pg');

(async () => {
  const pool = new Pool({
    connectionString: 'postgresql://postgres:rULbaSrKWKlAPevKNWJeZwzDvetMoyof@yamabiko.proxy.rlwy.net:56118/railway',
    ssl: { rejectUnauthorized: false }
  });

  try {
    // 1. Criar empresa para o usuario existente
    const company = await pool.query(
      `INSERT INTO companies (company_name, status, plan_type, max_users)
       VALUES ($1, 'active', 'trial', 5) RETURNING id, company_name`,
      ['Empresa de JULIANO DAMASO']
    );
    const companyId = company.rows[0].id;
    console.log('Empresa criada:', companyId, company.rows[0].company_name);

    // 2. Criar creditos iniciais
    await pool.query(
      'INSERT INTO company_credits (company_id, balance_brl) VALUES ($1, 0)',
      [companyId]
    );
    console.log('Creditos iniciais criados');

    // 3. Vincular usuario a empresa como owner
    const updated = await pool.query(
      `UPDATE users_v2 SET company_id = $1, role = 'admin_company', is_owner = true
       WHERE email = 'damasojuliano@gmail.com' RETURNING id, email, company_id, role, is_owner`,
      [companyId]
    );
    console.log('Usuario atualizado:', updated.rows[0]);

    console.log('\nDONE! Agora limpe os cookies e faca login novamente.');
  } catch (err) {
    console.error('ERRO:', err.message);
  } finally {
    await pool.end();
  }
})();
