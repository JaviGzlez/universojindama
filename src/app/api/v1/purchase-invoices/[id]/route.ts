import { api, dbError } from "@/lib/api/http";

export const GET = api<{ id: string }>(async ({ supabase }, { id }) => {
  const { data, error } = await supabase.from("purchase_invoices")
    .select("id, restaurant_id, supplier_id, number, invoice_date, status, discount_total, shipping, tax_total, total, notes, posted_at, version, lines:purchase_lines(id, ingredient_id, supplier_product_id, description, packs, pack_quantity, pack_unit, pack_price, discount_pct, tax_rate, base_quantity, price_per_base_unit, line_net)")
    .eq("id", id).single();
  if (error) dbError(error);
  return Response.json({ data }, { headers: { etag: `"${(data as { version: number }).version}"` } });
});
