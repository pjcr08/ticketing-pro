import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import Stripe from 'stripe';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from './db.js';

dotenv.config();
const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Webhook de Stripe (debe ir antes de express.json())
app.post('/api/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
        event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const sessionId = session.id;

        try {
            await pool.query('BEGIN');

            const compraRes = await pool.query(
                `UPDATE compras SET estado = 'completado' WHERE stripe_session_id = $1 RETURNING id`,
                [sessionId]
            );

            if (compraRes.rows.length > 0) {
                const compraId = compraRes.rows[0].id;
                const metadata = session.metadata;
                const tipoEntradaId = parseInt(metadata.tipo_entrada_id);
                const cantidad = parseInt(metadata.cantidad);

                for (let i = 0; i < cantidad; i++) {
                    const codigoUnico = crypto.randomBytes(6).toString('hex').toUpperCase();
                    await pool.query(
                        `INSERT INTO tickets (compra_id, tipo_entrada_id, codigo_unico) VALUES ($1, $2, $3)`,
                        [compraId, tipoEntradaId, codigoUnico]
                    );
                }
            }

            await pool.query('COMMIT');
        } catch (error) {
            await pool.query('ROLLBACK');
            console.error('Error al procesar el webhook:', error);
        }
    }

    res.json({ received: true });
});

app.use(cors());
app.use(express.json());

// Endpoint para obtener los eventos y sus tipos de entrada
app.get('/api/eventos', async (req, res) => {
    try {
        const eventosRes = await pool.query('SELECT * FROM eventos ORDER BY fecha ASC');
        const eventos = eventosRes.rows;

        for (let evento of eventos) {
            const tiposRes = await pool.query('SELECT * FROM tipos_entrada WHERE evento_id = $1', [evento.id]);
            evento.tipos_entrada = tiposRes.rows;
        }

        res.json(eventos);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/crear-pago', async (req, res) => {
    const { tipo_entrada_id, cantidad, comprador_nombre, comprador_email } = req.body;

    try {
        const tipoRes = await pool.query('SELECT * FROM tipos_entrada WHERE id = $1', [tipo_entrada_id]);
        if (tipoRes.rows.length === 0) return res.status(404).json({ error: 'Entrada no encontrada' });

        const tipo = tipoRes.rows[0];
        const precioTotal = tipo.precio * cantidad;

        const compraRes = await pool.query(
            `INSERT INTO compras (comprador_nombre, comprador_email, total, estado) VALUES ($1, $2, $3, 'pendiente') RETURNING id`,
            [comprador_nombre, comprador_email, precioTotal]
        );
        const compraId = compraRes.rows[0].id;

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{
                price_data: {
                    currency: 'eur',
                    product_data: { name: tipo.nombre },
                    unit_amount: Math.round(tipo.precio * 100),
                },
                quantity: cantidad,
            }],
            mode: 'payment',
            success_url: `${req.protocol}://${req.get('host')}/?exito=true`,
            cancel_url: `${req.protocol}://${req.get('host')}/?cancelado=true`,
            customer_email: comprador_email,
            metadata: {
                compra_id: compraId,
                tipo_entrada_id: tipo_entrada_id,
                cantidad: cantidad
            }
        });

        await pool.query('UPDATE compras SET stripe_session_id = $1 WHERE id = $2', [session.id, compraId]);

        res.json({ url: session.url });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Servir archivos estáticos si decides poner el index.html en el backend
app.use(express.static(path.join(__dirname)));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor profesional corriendo en puerto ${PORT}`));
