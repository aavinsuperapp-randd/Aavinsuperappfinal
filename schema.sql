-- AAVIN BMC Monitoring System Database Schema
-- Run this in your Supabase SQL Editor to set up the profiles table and RLS policies.

-- ==============================================================================
-- BMC TABLE
-- ==============================================================================
create table if not exists public.bmcs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  district text not null,
  location text not null,
  latitude numeric,
  longitude numeric,
  contact_number text not null,
  profile_image_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.bmcs enable row level security;

-- Workers and GMs can read active BMCs
create policy "Anyone authenticated can view active BMCs"
on public.bmcs for select
using (auth.role() = 'authenticated');

-- Only admin email can insert/update/delete BMCs
create policy "Only admin can manage BMCs"
on public.bmcs for all
using (auth.jwt() ->> 'email' = 'admin@gmail.com')
with check (auth.jwt() ->> 'email' = 'admin@gmail.com');

-- ==============================================================================


-- 1. Create Profiles Table
create table public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    name text not null,
    dob date not null,
    email text not null unique,
    profile_image_url text,
    role text not null check (role in ('user', 'gm', 'admin')),
    status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- 2. Enable Row Level Security
alter table public.profiles enable row level security;

-- 3. Create RLS Policies

-- Policy: Allow users to view their own profile details
create policy "Allow users to view own profile"
on public.profiles for select
using (auth.uid() = id);

-- Policy: Allow users to insert their own profile during registration
create policy "Allow users to insert own profile"
on public.profiles for insert
with check (auth.uid() = id and status = 'pending');

-- Policy: Allow users to update their own profile details (excluding role and status updates)
create policy "Allow users to update own details"
on public.profiles for update
using (auth.uid() = id)
with check (
    auth.uid() = id
    -- Prevent users from changing their own role or status
    and role = (select role from public.profiles where id = auth.uid())
    and status = (select status from public.profiles where id = auth.uid())
);

-- Policy: Allow Administrator (using the admin@gmail.com email check) full control
create policy "Allow Admins full access"
on public.profiles for all
using (auth.jwt() ->> 'email' = 'admin@gmail.com')
with check (auth.jwt() ->> 'email' = 'admin@gmail.com');

-- 4. Create Storage Bucket for Profile Images (Optional helper SQL)
-- Note: You should also create a public bucket named 'profile_images' via the Supabase Dashboard
-- and configure its security policy to allow public reads and authenticated uploads.

-- ==============================================================================
-- TRIGGER FOR AUTOMATIC PROFILE CREATION
-- ==============================================================================
-- This trigger automatically creates a row in public.profiles when a new user signs up.
-- This ensures profile creation works even if Email Confirmation is enabled (which delays login).

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  role_val text;
begin
  -- For admin seeding, allow role to be passed, otherwise default to user.
  -- But if it's from the registration form, it's in raw_user_meta_data.
  role_val := new.raw_user_meta_data ->> 'role';
  if role_val is null then
    role_val := 'user';
  end if;

  insert into public.profiles (id, name, dob, email, role, status)
  values (
    new.id,
    COALESCE(new.raw_user_meta_data ->> 'name', 'Administrator'),
    COALESCE((new.raw_user_meta_data ->> 'dob')::date, '1990-01-01'::date),
    new.email,
    role_val,
    'pending'
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();


-- ==============================================================================
-- ADMIN ACCOUNT SETUP INSTRUCTIONS:
-- ==============================================================================
-- To create the Administrator user:
-- 1. Go to your Supabase project dashboard -> Authentication -> Users.
-- 2. Click "Add User" -> "Create New User".
-- 3. Enter Email: admin@gmail.com and Password: superpass123
--    (Ensure "Auto Confirm User" is checked if email confirmations are enabled).
-- 4. Log in to the AAVIN BMC Monitoring System using these credentials.
--    The system will automatically detect this specific email on first login and 
--    auto-seed their admin profile record into the public.profiles table.
-- ==============================================================================
