-- NOVA PostgreSQL schema for Render.
-- The application can apply this file automatically on its first database-backed request.
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text not null,
  role text not null default 'member' check (role in ('member','admin')),
  email_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists profiles (
  user_id uuid primary key references users(id) on delete cascade,
  display_name text not null default '',
  avatar_url text,
  bio text not null default '',
  skills text[] not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists services (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references users(id) on delete cascade,
  title text not null check (char_length(title) between 5 and 120),
  description text not null,
  category text not null,
  price numeric(12,2) not null check (price >= 0),
  status text not null default 'draft' check (status in ('draft','published','paused')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references users(id) on delete cascade,
  title text not null check (char_length(title) between 5 and 160),
  description text not null,
  category text not null default 'عام',
  budget_min numeric(12,2) check (budget_min is null or budget_min >= 0),
  budget_max numeric(12,2) check (budget_max is null or budget_max >= budget_min),
  status text not null default 'open' check (status in ('open','in_progress','completed','cancelled')),
  created_at timestamptz not null default now()
);

create table if not exists project_proposals (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  freelancer_id uuid not null references users(id) on delete cascade,
  cover_letter text not null,
  bid_amount numeric(12,2) not null check (bid_amount >= 0),
  delivery_days integer not null check (delivery_days > 0),
  status text not null default 'pending' check (status in ('pending','accepted','rejected','withdrawn')),
  created_at timestamptz not null default now(),
  unique(project_id, freelancer_id)
);

create table if not exists support_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  subject text not null,
  status text not null default 'open' check (status in ('open','in_progress','answered','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists support_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references support_tickets(id) on delete cascade,
  sender_id uuid not null references users(id) on delete cascade,
  message text not null,
  created_at timestamptz not null default now()
);

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  title text not null,
  body text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists audit_logs (
  id bigserial primary key,
  actor_id uuid references users(id) on delete set null,
  action text not null,
  target_type text,
  target_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_sessions_user on sessions(user_id);
create index if not exists idx_sessions_expiry on sessions(expires_at);
create index if not exists idx_services_status_created on services(status, created_at desc);
create index if not exists idx_services_seller on services(seller_id);
create index if not exists idx_projects_status_created on projects(status, created_at desc);
create index if not exists idx_proposals_project on project_proposals(project_id);
create index if not exists idx_support_user on support_tickets(user_id, created_at desc);
create index if not exists idx_support_messages_ticket on support_messages(ticket_id, created_at);
create index if not exists idx_notifications_user on notifications(user_id, created_at desc);
 
-- NOVA public community and private direct-message conversations.
create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  conversation_type text not null check (conversation_type in ('public','direct')),
  title text,
  participant_one_id uuid references users(id) on delete cascade,
  participant_two_id uuid references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  check (
    (conversation_type = 'public' and participant_one_id is null and participant_two_id is null)
    or
    (conversation_type = 'direct' and participant_one_id is not null and participant_two_id is not null and participant_one_id < participant_two_id)
  ),
  unique(participant_one_id, participant_two_id)
);

insert into conversations(id, conversation_type, title)
values ('00000000-0000-4000-8000-000000000001', 'public', 'مجتمع NOVA')
on conflict (id) do nothing;

create table if not exists conversation_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  sender_id uuid not null references users(id) on delete cascade,
  body text not null default '',
  created_at timestamptz not null default now(),
  check (char_length(body) <= 5000)
);

create table if not exists chat_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references conversation_messages(id) on delete cascade,
  uploaded_by uuid not null references users(id) on delete cascade,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  data bytea not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_conversations_direct_participants
  on conversations(participant_one_id, participant_two_id)
  where conversation_type = 'direct';
create index if not exists idx_conversation_messages_recent
  on conversation_messages(conversation_id, created_at desc);
create index if not exists idx_chat_attachments_message
  on chat_attachments(message_id);
create index if not exists idx_chat_attachments_uploader
  on chat_attachments(uploaded_by);

