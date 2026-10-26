import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false } // Necesario para bases de datos en la nube como Render o Supabase
});

const crearTablas = async () => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS eventos (
                id SERIAL PRIMARY KEY,
                titulo VARCHAR(255) NOT NULL,
                descripcion TEXT,
                fecha TIMESTAMP NOT NULL,
                lugar VARCHAR(255) NOT NULL
            );

            CREATE TABLE IF NOT EXISTS tipos_entrada (
                id SERIAL PRIMARY KEY,
                evento_id INT REFERENCES eventos(id) ON DELETE CASCADE,
                nombre VARCHAR(100) NOT NULL,
                precio DECIMAL(10,2) NOT NULL,
                cupo_maximo INT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS compras (
                id SERIAL PRIMARY KEY,
                comprador_nombre VARCHAR(255) NOT NULL,
                comprador_email VARCHAR(255) NOT NULL,
                total DECIMAL(10,2) NOT NULL,
                stripe_session_id VARCHAR(255) UNIQUE,
                estado VARCHAR(50) DEFAULT 'pendiente',
                fecha_compra TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS tickets (
                id SERIAL PRIMARY KEY,
                compra_id INT REFERENCES compras(id) ON DELETE CASCADE,
                tipo_entrada_id INT REFERENCES tipos_entrada(id),
                codigo_unico VARCHAR(50) UNIQUE NOT NULL,
                usado BOOLEAN DEFAULT FALSE
            );
        `);
        console.log('Tablas de PostgreSQL creadas o verificadas correctamente.');
    } catch (error) {
        console.error('Error al crear las tablas:', error);
    }
};

crearTablas();

export default pool;
