insert into public.deployment_environment (id, environment) values (true, 'DEMO') on conflict (id) do update set environment = 'DEMO';
