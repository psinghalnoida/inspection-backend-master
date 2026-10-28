-- Add is_direct_assign to surveys: marks surveys that skip payment
ALTER TABLE surveys
  ADD COLUMN is_direct_assign BOOLEAN NOT NULL DEFAULT FALSE
  AFTER surveyor_mobile;

-- Add is_direct_assign to assigners: controls whether the assigner can use direct assignment by phone
ALTER TABLE assigners
  ADD COLUMN is_direct_assign BOOLEAN NOT NULL DEFAULT TRUE
  AFTER can_assign_surveyor;
