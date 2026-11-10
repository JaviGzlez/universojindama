import { ListaRecetas } from "./lista";

export const metadata = { title: "Platos" };

export default async function Platos({ params, searchParams }: { params: Promise<{ rid: string }>; searchParams: Promise<{ q?: string }> }) {
  const { rid } = await params;
  const { q } = await searchParams;
  return <ListaRecetas rid={rid} kind="dish" buscar={q} />;
}
