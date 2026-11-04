import { expect, it } from "vitest";
import { emailDeUsuario, normalizarUsuario, PATRON_USUARIO, usuarioDeEmail } from "./usuarios";

it("convierte usuario ↔ correo interno", () => {
  expect(normalizarUsuario(" María ")).toBe("maria");
  expect(emailDeUsuario("Manuel")).toBe("manuel@usuarios.universojindama.com");
  expect(emailDeUsuario("javi@gmail.com")).toBe("javi@gmail.com");
  expect(usuarioDeEmail("admin@usuarios.universojindama.com")).toBe("admin");
  expect(PATRON_USUARIO.test("maria")).toBe(true);
  expect(PATRON_USUARIO.test("a")).toBe(false);
  expect(PATRON_USUARIO.test("con espacio")).toBe(false);
});
