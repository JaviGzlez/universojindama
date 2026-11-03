-- Universo Jindama · Datos iniciales: organización y primeros establecimientos.
-- Solo estructura: no se cargan precios, tarifas ni costes de ejemplo.

insert into public.organizations (name, slug)
values ('Grupo Jindama', 'grupo-jindama')
on conflict (slug) do nothing;

insert into public.restaurants (organization_id, name, slug)
select o.id, v.name, v.slug
from public.organizations o
cross join (values
  ('Jindama', 'jindama'),
  ('Jaleo', 'jaleo'),
  ('Juye Burger', 'juye-burger')
) as v(name, slug)
where o.slug = 'grupo-jindama'
on conflict (organization_id, slug) do nothing;
