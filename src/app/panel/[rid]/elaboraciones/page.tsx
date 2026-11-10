import { ListaRecetas } from "../recetas/lista";

export const metadata = { title: "Elaboraciones" };

export default async function Elaboraciones({ params, searchParams }: { params: Promise<{ rid: string }>; searchParams: Promise<{ q?: string }> }) {
  const { rid } = await params;
  const { q } = await searchParams;
  return <ListaRecetas rid={rid} kind="preparation" buscar={q} />;
}
