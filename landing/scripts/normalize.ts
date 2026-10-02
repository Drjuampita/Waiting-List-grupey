// Uso: npm run normalize -- "<correo>"  → imprime el correo normalizado (para ARCO y búsquedas).
import { normalizeEmail } from '../lib/normalizeEmail';

const input = process.argv[2];
const result = normalizeEmail(input);
if (!result.ok) {
  console.error('Correo inválido');
  process.exit(1);
}
console.log(result.normalized);
