import { redirect } from "next/navigation";

/** El equipo se gestiona ahora en Administración. */
export default function Usuarios() {
  redirect("/panel/administracion");
}
