/**
 * Se entra con nombre de usuario, sin correo. Supabase exige un email por
 * cuenta, así que se genera uno interno en un subdominio que no recibe correo.
 * Nadie lo ve: en la web solo aparece el nombre de usuario.
 */
export const DOMINIO_USUARIOS = "usuarios.universojindama.com";

export const PATRON_USUARIO = /^[a-z0-9][a-z0-9._-]{1,29}$/;

/** Normaliza lo que escribe la persona: minúsculas, sin acentos ni espacios. */
export function normalizarUsuario(valor: string) {
  return valor
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, "");
}

/** «manuel» → «manuel@usuarios.universojindama.com». Si ya es un correo, se respeta. */
export function emailDeUsuario(valor: string) {
  const v = normalizarUsuario(valor);
  return v.includes("@") ? v : `${v}@${DOMINIO_USUARIOS}`;
}

/** «manuel@usuarios.universojindama.com» → «manuel». Otros correos se muestran completos. */
export function usuarioDeEmail(email: string | null | undefined) {
  if (!email) return "";
  const sufijo = `@${DOMINIO_USUARIOS}`;
  return email.endsWith(sufijo) ? email.slice(0, -sufijo.length) : email;
}
